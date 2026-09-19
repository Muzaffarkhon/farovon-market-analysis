const zlib = require('zlib');

/**
 * Минимальное чтение .xlsx без внешних библиотек: имена листов и значения ячеек
 * (то, что Excel сохранил как результат формул). Форматирование, картинки и
 * комментарии не читаются — для импорта обзоров зарплат нужны только таблицы.
 *
 * .xlsx — это zip; берём центральный каталог, распаковываем нужные файлы через
 * zlib.inflateRawSync и разбираем XML регулярками (структура листа простая и
 * стабильная: <c r="B7" t="s"><v>12</v></c>).
 */

function readZipEntries(buf) {
  // Ищем запись конца центрального каталога (EOCD) с конца файла.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Файл не похож на .xlsx (нет структуры zip)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    entries.set(name, { method, compSize, localOff });
    p += 46 + nameLen + extraLen + commLen;
  }
  return entries;
}

function readEntry(buf, entries, name) {
  const e = entries.get(name);
  if (!e) return null;
  const lp = e.localOff;
  const nameLen = buf.readUInt16LE(lp + 26);
  const extraLen = buf.readUInt16LE(lp + 28);
  const start = lp + 30 + nameLen + extraLen;
  const raw = buf.slice(start, start + e.compSize);
  const data = e.method === 0 ? raw : zlib.inflateRawSync(raw);
  return data.toString('utf8');
}

function unescapeXml(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function textOf(xml) {
  // Склеиваем все <t> внутри строки (в том числе rich text из нескольких <r>).
  const out = [];
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = re.exec(xml))) out.push(unescapeXml(m[1]));
  return out.join('');
}

function colIndex(ref) {
  const letters = ref.replace(/[0-9]/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function loadWorkbook(buf) {
  const entries = readZipEntries(buf);
  const wbXml = readEntry(buf, entries, 'xl/workbook.xml');
  const relsXml = readEntry(buf, entries, 'xl/_rels/workbook.xml.rels') || '';
  if (!wbXml) throw new Error('Не найден xl/workbook.xml — это не .xlsx');

  const rels = {};
  (relsXml.match(/<Relationship\b[^>]*>/g) || []).forEach(tag => {
    const id = (tag.match(/\bId="([^"]*)"/) || [])[1];
    const target = (tag.match(/\bTarget="([^"]*)"/) || [])[1];
    if (id && target) rels[id] = target.replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/');
  });

  const sheets = [];
  (wbXml.match(/<sheet\b[^>]*>/g) || []).forEach(tag => {
    const name = unescapeXml((tag.match(/\bname="([^"]*)"/) || [])[1] || '');
    const rid = (tag.match(/\br:id="([^"]*)"/) || [])[1];
    const state = (tag.match(/\bstate="([^"]*)"/) || [])[1] || 'visible';
    if (name && rid && rels[rid]) sheets.push({ name, path: rels[rid], hidden: state !== 'visible' });
  });

  let shared = null;
  const loadShared = () => {
    if (shared) return shared;
    shared = [];
    const xml = readEntry(buf, entries, 'xl/sharedStrings.xml');
    if (xml) (xml.match(/<si\b[\s\S]*?<\/si>/g) || []).forEach(si => shared.push(textOf(si)));
    return shared;
  };

  return {
    sheetNames: () => sheets.filter(s => !s.hidden).map(s => s.name),
    /** Строки листа как массив массивов; пустые ячейки — ''. maxRows ограничивает объём. */
    readSheet(name, maxRows = 5000) {
      const sh = sheets.find(s => s.name === name);
      if (!sh) throw new Error('Лист «' + name + '» не найден');
      const xml = readEntry(buf, entries, sh.path);
      if (!xml) throw new Error('Не удалось прочитать лист');
      const strings = loadShared();
      const rows = [];
      const rowRe = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
      let rm;
      while ((rm = rowRe.exec(xml))) {
        if (rows.length >= maxRows) break;
        const rowXml = rm[1] || '';
        const rIdx = Number(((rm[0].match(/\br="(\d+)"/) || [])[1]) || rows.length + 1) - 1;
        const cells = [];
        const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
        let cm;
        while ((cm = cellRe.exec(rowXml))) {
          const attrs = cm[1];
          const ref = (attrs.match(/\br="([A-Z]+[0-9]+)"/) || [])[1];
          if (!ref) continue;
          const type = (attrs.match(/\bt="([^"]*)"/) || [])[1];
          const body = cm[2] || '';
          let val = '';
          if (type === 'inlineStr') val = textOf(body);
          else {
            const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
            if (v !== undefined) {
              if (type === 's') val = strings[Number(v)] || '';
              else if (type === 'str' || type === 'e') val = unescapeXml(v);
              else if (type === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
              else val = v;
            }
          }
          cells[colIndex(ref)] = val;
        }
        while (rows.length < rIdx) rows.push([]);
        rows[rIdx] = Array.from(cells, c => (c === undefined ? '' : c));
      }
      return rows;
    }
  };
}

module.exports = { loadWorkbook };
