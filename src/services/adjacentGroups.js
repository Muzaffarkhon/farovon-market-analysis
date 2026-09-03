'use strict';

/**
 * Автоопределение смежных групп подразделений.
 *
 * Смежная группа — площадки с одинаковой структурой должностей, отличающиеся
 * только регионом (см. divisions.group_key). Раньше группу заводил админ
 * вручную; здесь мы её ПРЕДЛАГАЕМ по названию подразделения, а админ
 * подтверждает одной кнопкой (записывается тот же group_key).
 *
 * Эвристика намеренно консервативная — предлагаем группу только когда:
 *  - у подразделения не задан ручной group_key (ручной всегда главнее);
 *  - совпадает направление (dir) и «имя роли» (название без кода и без
 *    хвостового региона);
 *  - в группе ≥2 площадок И они реально в разных регионах.
 * Одиночки не предлагаются. saveSurveyDetails и так игнорирует группы <2.
 */

// Города / регионы Таджикистана, которые встречаются хвостом в названиях
// подразделений. Список для ОТСЕЧЕНИЯ хвоста и определения региона.
const REGION_TOKENS = [
  'Душанбе', 'Худжанд', 'Бохтар', 'Куляб', 'Кулоб', 'Хорог', 'Истаравшан',
  'Турсунзаде', 'Турсунзода', 'Вахдат', 'Канибадам', 'Исфара', 'Пенджикент',
  'Панджакент', 'Рашт', 'Дангара', 'Гиссар', 'Хисор', 'Яван', 'Спитамен',
  'Гафуров', 'Б.Гафуров', 'Согд', 'Хатлон', 'РРП', 'ГБАО', 'Курган-Тюбе',
  'Кургантюбе', 'Нурек', 'Норак', 'Леваканд', 'Джиликуль', 'Восе', 'Фархор',
  'Шаартуз', 'Кабадиён', 'Носири-Хусрав', 'Джаббор-Расулов', 'Аштский',
  'Раштский', 'Пяндж', 'Балхи', 'Кушониён', 'Абдурахмони-Джоми'
];

function norm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

// Отбрасываем ведущий числовой код («0101 », «12.3 »).
function stripCode(name) {
  return String(name || '').replace(/^\s*\d+[\s.\-–]*/, '').trim();
}

function regionRe(token) {
  return new RegExp('(^|[\\s,–-])' + token.replace(/[.\-]/g, '\\$&') + '\\s*$', 'i');
}

/** Регион подразделения по хвосту названия ('' если не распознан). */
function detectRegion(unitName) {
  const n = stripCode(unitName);
  for (const t of REGION_TOKENS) {
    if (regionRe(t).test(n)) return t;
  }
  return '';
}

/** «Имя роли» — название без кода и без хвостового региона, нормализованное. */
function roleName(unitName) {
  let n = stripCode(unitName);
  const reg = detectRegion(unitName);
  if (reg) n = n.replace(regionRe(reg), '').trim();
  return norm(n);
}

/**
 * @param {Array<{unit:string, dir?:string, group_key?:string, region?:string}>} divisions
 * @returns {Array<{key:string, dir:string, units:Array<{unit:string, region:string}>}>}
 */
function suggestAdjacentGroups(divisions) {
  const buckets = {};
  (divisions || []).forEach(d => {
    if (!d || !d.unit) return;
    if (String(d.group_key || '').trim()) return; // ручной ключ — не предлагаем
    const rn = roleName(d.unit);
    if (!rn) return;
    const key = norm(d.dir || '') + ' :: ' + rn;
    (buckets[key] = buckets[key] || []).push(d);
  });

  const out = [];
  Object.keys(buckets).forEach(bk => {
    const arr = buckets[bk];
    if (arr.length < 2) return;
    const withReg = arr.map(d => ({
      unit: d.unit,
      region: detectRegion(d.unit) || String(d.region || '').trim()
    }));
    const distinct = new Set(withReg.map(x => x.region).filter(Boolean));
    if (distinct.size < 2) return; // нет различия по региону — не смежная группа

    // Человекочитаемый ключ — имя роли из первого подразделения (без кода/региона).
    const first = arr[0];
    let label = stripCode(first.unit);
    const reg0 = detectRegion(first.unit);
    if (reg0) label = label.replace(regionRe(reg0), '').trim();

    out.push({
      key: label,
      dir: first.dir || '',
      units: withReg.sort((a, b) => a.unit.localeCompare(b.unit, 'ru'))
    });
  });

  return out.sort((a, b) => a.key.localeCompare(b.key, 'ru'));
}

module.exports = { suggestAdjacentGroups, detectRegion, roleName };
