const crypto = require('crypto');
const { queryOne, queryAll, run, batch } = require('../db/database');
const { resolveEditablePeriod } = require('../services/periodAccessService');

// Гарантированно уникальный id строки анкеты/конкурента. Date.now() в цикле
// одинаков, а Math.random().slice(2,7) — всего ~60 млн вариантов, при десятках
// строк в одном батче коллизия реальна и роняет весь batch (all-or-nothing).
function newRowId(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + crypto.randomUUID().slice(0, 12);
}

const ALLOWED_CURRENCIES = ['сомони', 'usd', 'rub', 'eur', 'доллар', 'рубль', 'евро', 'tjs'];
const ALLOWED_PAY_PERIODS = ['в месяц', 'в час', 'в час (чтс)', 'в смену', 'в год', 'в день'];

// Нормализация для сопоставления должностей/компаний (то же, что norm() на
// фронте): регистр, ё→е, схлопнутые пробелы, trim.
function norm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function cleanNumber(val, fieldName) {
  if (val === undefined || val === null || val === '') return 0;
  // Пробел, запятая и точка — разделители тысяч ("10 000" / "10,000" / "10.000").
  // Дробных окладов в вилках нет, поэтому убираем их все. Раньше здесь было
  // .replace(',', '.') — "10,000" превращалось в 10 и валило проверку "от > до".
  const num = Number(String(val).replace(/[\s .,]/g, ''));
  if (!Number.isFinite(num) || isNaN(num)) {
    throw new Error(`Поле "${fieldName}" должно быть корректным числом`);
  }
  if (num < 0) {
    throw new Error(`Поле "${fieldName}" не может быть отрицательным (${num})`);
  }
  if (num > 1000000000) {
    throw new Error(`Поле "${fieldName}" превышает максимально допустимое значение 1 000 000 000`);
  }
  return num;
}

/**
 * Если у подразделения несколько ответственных («Ответственный за обзор»
 * допускает несколько ФИО), нельзя, чтобы один затирал уже сохранённые
 * данные другого. Строка «принадлежит» тому, кто первым её сохранил —
 * дальше правит только он сам (по ФИО) или admin/cb.
 */
function isOwnedByOther(existingOwner, user, ownerRowSource) {
  if (user.role === 'admin' || user.role === 'cb') return false;
  if (String(ownerRowSource || '').trim().toLowerCase().startsWith('импорт')) return false;
  const owner = String(existingOwner || '').trim().toLowerCase();
  if (!owner || owner === 'импорт') return false;
  const mine = String(user.fio || user.login || '').trim().toLowerCase();
  return owner !== mine;
}

/**
 * Льготы: на фронте это массив (чипы с множественным выбором), в базе —
 * текстовое поле. Раньше массив уходил в libSQL как есть, а обратно приходил
 * строкой — и `r.benefits.slice(0,3).map(...)` в карточке записи падал с
 * TypeError, потому что slice у строки возвращает строку. Одна сохранённая
 * запись с льготами делала весь шаг 2 пустым: исключение прерывало отрисовку
 * до вставки в DOM, и пользователь видел белый экран при живых данных.
 *
 * Поэтому граница приводится явно в обе стороны, разделитель ';' — тот же,
 * что у units и dirs.
 */
function benefitsToText(v) {
  if (Array.isArray(v)) return v.filter(Boolean).map(s => String(s).trim()).filter(Boolean).join(';');
  return String(v == null ? '' : v);
}

function benefitsToList(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  return String(v == null ? '' : v)
    .split(/[;,]/).map(s => s.trim()).filter(Boolean);
}

exports.benefitsToList = benefitsToList;

/**
 * Переменная часть: на фронте — массив item.bonuses = [{type,size,per}]
 * (несколько видов премии сразу). В базе — JSON-строка в surveys.bonuses,
 * плюс колонки bon_has/bon_size/bon_type/bon_per держат ПЕРВЫЙ элемент для
 * обратной совместимости с аналитикой/импортом/дашбордами.
 *
 * normalizeBonuses — вход (что угодно) → чистый массив [{type,size,per}].
 * bonusesLegacy — массив → {bonHas,bonSize,bonType,bonPer} для bon_* колонок.
 * bonusesFromRow — строка БД → массив (JSON или синтез из bon_* у старых строк).
 */
function normalizeBonuses(v) {
  let arr = v;
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr); } catch (_) { arr = []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(b => b && typeof b === 'object')
    .map(b => ({
      type: String(b.type || '').trim(),
      size: String(b.size == null ? '' : b.size).trim(),
      per: String(b.per || '').trim()
    }))
    .filter(b => b.type || b.size || b.per);
}

function bonusesLegacy(list, bonHasRaw) {
  const first = list[0] || null;
  // bon_has: 'да' если есть хоть один вид; иначе — что пришло с фронта
  // ('нет' / 'не знаю'), по умолчанию 'не знаю'.
  const bonHas = list.length ? 'да' : String(bonHasRaw || 'не знаю').trim();
  return {
    bonHas,
    bonSize: first ? first.size : '',
    bonType: first ? first.type : '',
    bonPer: first ? first.per : ''
  };
}

function bonusesFromRow(row) {
  const parsed = normalizeBonuses(row && row.bonuses);
  if (parsed.length) return parsed;
  // старая запись без JSON — синтезируем один элемент из bon_* при наличии
  const t = String((row && row.bon_type) || '').trim();
  const s = String((row && row.bon_size) || '').trim();
  const p = String((row && row.bon_per) || '').trim();
  if (t || s || p) return [{ type: t, size: s, per: p }];
  return [];
}

exports.normalizeBonuses = normalizeBonuses;
exports.bonusesLegacy = bonusesLegacy;
exports.bonusesFromRow = bonusesFromRow;

exports.saveSurveyData = async (req, res) => {
  const { unit, rows, added, note, submit } = req.body;
  if (!unit || !String(unit).trim()) {
    return res.status(400).json({ ok: false, error: 'Не указано подразделение' });
  }

  try {
    const period = await queryOne('SELECT state FROM periods ORDER BY id DESC LIMIT 1');
    if (period && period.state === 'закрыт' && req.user.role !== 'hrbp' && req.user.role !== 'admin' && req.user.role !== 'cb') {
      return res.status(403).json({ ok: false, error: 'Период сбора данных закрыт' });
    }

    const now = new Date().toISOString();
    const newIds = [];
    const stmts = [];

    // 1. Обновляем существующие строки конкурентов — но только те, что не
    // заняты другим ответственным (см. isOwnedByOther выше).
    const editIds = (rows || []).filter(r => r && r.id).map(r => r.id);
    const ownerByCid = {};
    if (editIds.length) {
      const placeholders = editIds.map(() => '?').join(',');
      const existing = await queryAll(
        `SELECT cid, company, updated_by, src FROM competitors WHERE unit = ? AND cid IN (${placeholders})`,
        [unit, ...editIds]);
      existing.forEach(x => { ownerByCid[x.cid] = x; });
    }

    const blocked = [];
    (rows || []).forEach(r => {
      if (!r || !r.id) return;
      const existing = ownerByCid[r.id];
      // 3-й аргумент (источник строки) — как в saveSurveyDetails: импортные
      // строки не «принадлежат» импортёру и правятся любым ответственным.
      if (existing && isOwnedByOther(existing.updated_by, req.user, existing.src)) {
        blocked.push({ id: r.id, company: existing.company, owner: existing.updated_by });
        return;
      }
      stmts.push({
        sql: `UPDATE competitors SET actual = ?, note = ?, updated_by = ?, updated_at = ? WHERE cid = ? AND unit = ?`,
        args: [r.actual || 'уточнить', String(r.note || '').trim(), req.user.fio || req.user.login, now, r.id, unit]
      });
    });

    // 2. Вставляем добавленные компании (с дедупликацией и фильтрацией пустых)
    const seenCompanies = new Set();
    (added || []).forEach(a => {
      if (!a) return;
      const compName = String(a.company || '').trim();
      if (!compName) return;
      const normKey = compName.toLowerCase();
      if (seenCompanies.has(normKey)) return;
      seenCompanies.add(normKey);

      const cid = newRowId('c');
      newIds.push(cid);
      stmts.push({
        sql: `INSERT INTO competitors (cid, num, dir, unit, resp, hrbp, company, type, segment, region, prio, status, src, note, actual, updated_by, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          cid,
          0,
          String(a.dir || '').trim(),
          unit,
          req.user.fio || req.user.login,
          '',
          compName,
          String(a.type || '').trim(),
          String(a.segment || '').trim(),
          String(a.region || '').trim(),
          String(a.prio || '').trim(),
          String(a.status || '').trim(),
          String(a.src || 'форма').trim(),
          String(a.note || '').trim(),
          a.actual || 'актуально',
          req.user.fio || req.user.login,
          now
        ]
      });
    });

    // 3. Комментарий по подразделению — свободный текст ответственного о рынке
    // труда. Одна запись на unit, хранится на строке divisions. Приходит с
    // каждым сохранением (фронт держит его в S.note); пишем, только если поле
    // вообще прислано — старый клиент без него ничего не затрёт.
    if (note !== undefined) {
      stmts.push({
        sql: `UPDATE divisions SET survey_note = ? WHERE unit = ?`,
        args: [String(note == null ? '' : note).trim().slice(0, 4000), unit]
      });
    }

    // 4. Журнал
    stmts.push({
      sql: `INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)`,
      args: [
        req.user.login,
        submit ? 'отправка подразделения' : 'сохранение участников рынка',
        `Подразделение: ${unit}, обновлено строк: ${(rows || []).length}, добавлено: ${newIds.length}`
      ]
    });

    if (stmts.length > 0) {
      await batch(stmts);
    }

    res.json({
      ok: true,
      newIds,
      blocked,
      at: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    });
  } catch (err) {
    console.error('Save survey data error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка сохранения данных по компаниям' });
  }
};

exports.saveSurveyDetails = async (req, res) => {
  const { unit, upsert, remove, groupKey, periodId } = req.body;
  if (!unit || !String(unit).trim()) {
    return res.status(400).json({ ok: false, error: 'Не указано подразделение' });
  }

  if (upsert !== undefined && upsert !== null && !Array.isArray(upsert)) {
    return res.status(400).json({ ok: false, error: 'Данные анкет должны быть массивом' });
  }

  if (remove !== undefined && remove !== null && !Array.isArray(remove)) {
    return res.status(400).json({ ok: false, error: 'Список на удаление должен быть массивом' });
  }

  // Предварительная валидация всех элементов ДО вызова базы данных
  const validatedItems = [];
  for (let i = 0; i < (upsert || []).length; i++) {
    const s = upsert[i];
    if (!s) continue;
    const compName = String(s.company || '').trim();
    const posOurName = String(s.posOur || '').trim();
    if (!compName) {
      return res.status(400).json({ ok: false, error: `В записи #${i + 1} не указано название компании-конкурента` });
    }
    if (!posOurName) {
      return res.status(400).json({ ok: false, error: `В записи #${i + 1} (${compName}) не указана должность` });
    }

    let pFrom = 0, pTo = 0;
    try {
      pFrom = cleanNumber(s.payFrom, 'Оклад от');
      pTo = cleanNumber(s.payTo, 'Оклад до');
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }

    if (pFrom > 0 && pTo > 0 && pFrom > pTo) {
      return res.status(400).json({
        ok: false,
        error: `В записи "${compName}" оклад "от" (${pFrom.toLocaleString('ru-RU')}) не может превышать оклад "до" (${pTo.toLocaleString('ru-RU')})`
      });
    }

    let cur = String(s.cur || 'сомони').trim().toLowerCase();
    if (!ALLOWED_CURRENCIES.includes(cur)) cur = 'сомони';

    let payPer = String(s.payPer || 'в месяц').trim().toLowerCase();
    if (!ALLOWED_PAY_PERIODS.includes(payPer)) payPer = 'в месяц';

    // Переменная часть: фронт шлёт s.bonuses = [{type,size,per}]. Старый клиент
    // (или импорт) шлёт плоские bonHas/bonSize/bonType/bonPer — синтезируем один.
    let bonList = normalizeBonuses(s.bonuses);
    if (!bonList.length && (s.bonType || s.bonSize || s.bonPer)) {
      bonList = normalizeBonuses([{ type: s.bonType, size: s.bonSize, per: s.bonPer }]);
    }
    const bonLeg = bonusesLegacy(bonList, s.bonHas);

    validatedItems.push({
      id: s.id,
      company: compName,
      posOur: posOurName,
      posTheir: String(s.posTheir || '').trim(),
      grade: String(s.grade || '').trim(),
      pFrom,
      pTo,
      cur,
      payPer,
      bonuses: JSON.stringify(bonList),
      bonHas: bonLeg.bonHas,
      bonSize: bonLeg.bonSize,
      bonType: bonLeg.bonType,
      bonPer: bonLeg.bonPer,
      benefits: benefitsToText(s.benefits),
      schedule: String(s.schedule || '').trim(),
      extra: String(s.extra || '').trim(),
      source: String(s.source || '').trim(),
      trust: String(s.trust || '').trim(),
      note: String(s.note || '').trim()
    });
  }

  try {
    const resolved = await resolveEditablePeriod(periodId, req.user);
    if (!resolved.ok) {
      return res.status(resolved.status).json({ ok: false, error: resolved.error });
    }
    const period = resolved.period;
    // Проверка «период закрыт → только элевейтед-роли» имеет смысл ТОЛЬКО
    // для текущего (последнего) периода — это временное состояние между
    // закрытием и открытием следующего года. Для архивного периода admin
    // уже разрешён resolveEditablePeriod безусловно, а для остальных ролей
    // единственный путь сюда — живой грант, который сам по себе достаточное
    // разрешение (иначе грант никогда бы не сработал ни для кого, кроме
    // hrbp/admin/cb, что противоречит всей цели этой задачи).
    const latestRow = await queryOne('SELECT id, state FROM periods ORDER BY id DESC LIMIT 1');
    const isCurrentPeriod = !latestRow || period.id === latestRow.id;
    if (isCurrentPeriod && period.state === 'закрыт' && req.user.role !== 'hrbp' && req.user.role !== 'admin' && req.user.role !== 'cb') {
      return res.status(403).json({ ok: false, error: 'Период сбора данных закрыт' });
    }

    // ── Смежная группа: «заполнил раз → на все площадки» ────────────────────
    // Если у подразделения задана смежная группа — валидированные записи
    // применяются ко ВСЕМ её площадкам. groupKey с фронта — подсказка; если
    // он не пришёл (устаревшая вкладка, ещё не подхватила новую группу) —
    // берём group_key из divisions по самому unit. Так разнос работает сразу
    // после объединения, без перезагрузки у заполняющего.
    let cleanGroupKey = groupKey ? String(groupKey).trim() : '';
    if (!cleanGroupKey) {
      const ownGrp = await queryOne('SELECT group_key FROM divisions WHERE unit = ?', [String(unit).trim()]);
      if (ownGrp && String(ownGrp.group_key || '').trim()) cleanGroupKey = String(ownGrp.group_key).trim();
    }
    if (cleanGroupKey) {
      const groupUnits = (await queryAll(
        'SELECT unit FROM divisions WHERE group_key = ?', [cleanGroupKey]
      )).map(r => r.unit).filter(Boolean);

      if (groupUnits.length < 2 || !groupUnits.includes(String(unit).trim())) {
        // Не настоящая группа или unit не из неё — падаем на обычный путь.
      } else if (groupUnits.length > 50) {
        return res.status(400).json({ ok: false, error: 'Слишком большая смежная группа' });
      } else {
        const isElevated = req.user.role === 'admin' || req.user.role === 'cb' || req.user.role === 'hrbp';
        const myUnits = Array.isArray(req.user.units) ? req.user.units : [];
        if (!isElevated && !groupUnits.some(u => myUnits.includes(u))) {
          return res.status(403).json({ ok: false, error: 'Нет доступа к смежной группе этого подразделения' });
        }

        const nowIso = new Date().toISOString();
        const ph = groupUnits.map(() => '?').join(',');
        const existingRows = await queryAll(
          `SELECT sid, unit, pos_our, company FROM surveys WHERE unit IN (${ph}) AND state = 'активна' AND period_id = ?`,
          [...groupUnits, period.id]
        );
        // индекс: unit -> "posKey|coKey" -> sid; и обратный sid -> "posKey|coKey"
        const idx = {};
        const sidToKey = {};
        existingRows.forEach(r => {
          const k = norm(r.pos_our) + '|' + norm(r.company);
          (idx[r.unit] = idx[r.unit] || {})[k] = r.sid;
          sidToKey[r.sid] = k;
        });

        const gStmts = [];
        let upserted = 0;
        validatedItems.forEach(s => {
          const k = norm(s.posOur) + '|' + norm(s.company);
          groupUnits.forEach(gu => {
            const sid = (idx[gu] || {})[k];
            if (sid) {
              gStmts.push({
                sql: `UPDATE surveys
                      SET company = ?, pos_our = ?, pos_their = ?, grade = ?, pay_from = ?, pay_to = ?, cur = ?, pay_per = ?,
                          bon_has = ?, bon_size = ?, bon_type = ?, bon_per = ?, bonuses = ?, benefits = ?, schedule = ?, extra = ?, source = ?, trust = ?, note = ?
                      WHERE sid = ? AND unit = ? AND period_id = ?`,
                args: [
                  s.company, s.posOur, s.posTheir, s.grade, s.pFrom, s.pTo, s.cur, s.payPer,
                  s.bonHas, s.bonSize, s.bonType, s.bonPer, s.bonuses, s.benefits, s.schedule, s.extra, s.source, s.trust, s.note,
                  sid, gu, period.id
                ]
              });
            } else {
              const newSid = newRowId('s');
              gStmts.push({
                sql: `INSERT INTO surveys (sid, unit, company, pos_our, pos_their, grade, pay_from, pay_to, cur, pay_per, bon_has, bon_size, bon_type, bon_per, bonuses, benefits, schedule, extra, source, trust, note, created_by, created_at, state, period, period_id)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'активна', ?, ?)`,
                args: [
                  newSid, gu, s.company, s.posOur, s.posTheir, s.grade, s.pFrom, s.pTo, s.cur, s.payPer,
                  s.bonHas, s.bonSize, s.bonType, s.bonPer, s.bonuses, s.benefits, s.schedule, s.extra, s.source, s.trust, s.note,
                  req.user.fio || req.user.login, nowIso, period.name, period.id
                ]
              });
            }
            upserted++;
          });
        });

        // remove: пары {posOur, company} → удаляем во всех площадках группы.
        // Устаревшая вкладка могла прислать sid-строки — переводим их в пары
        // по обратному индексу.
        let removedPairs = 0;
        (Array.isArray(remove) ? remove : []).forEach(rm => {
          let k = null;
          if (rm && typeof rm === 'object') {
            k = norm(rm.posOur || rm.pos_our) + '|' + norm(rm.company);
          } else if (typeof rm === 'string' || typeof rm === 'number') {
            k = sidToKey[String(rm)] || null;
          }
          if (!k) return;
          groupUnits.forEach(gu => {
            const sid = (idx[gu] || {})[k];
            if (sid) {
              gStmts.push({ sql: "UPDATE surveys SET state = 'удалена' WHERE sid = ? AND unit = ? AND period_id = ?", args: [sid, gu, period.id] });
              removedPairs++;
            }
          });
        });

        gStmts.push({
          sql: 'INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)',
          args: [
            req.user.login,
            'сохранение данных по должностям (смежная группа)',
            `Группа: ${cleanGroupKey}, площадок: ${groupUnits.length}, записей: ${validatedItems.length}, удалено пар: ${(Array.isArray(remove) ? remove.length : 0)}`
          ]
        });

        if (gStmts.length > 0) await batch(gStmts);

        return res.json({
          ok: true, group: true, units: groupUnits.length,
          upserted, removed: removedPairs, newIds: [], blocked: []
        });
      }
    }
    // ── /Смежная группа ───────────────────────────────────────────────────

    const now = new Date().toISOString();
    const newIds = [];
    const stmts = [];
    const blocked = [];

    // Владельцы существующих записей
    const touchedSids = ([]).concat(
      Array.isArray(remove) ? remove.map(String).filter(Boolean) : [],
      validatedItems.filter(s => s.id && !String(s.id).startsWith('tmp')).map(s => s.id)
    );
    const ownerBySid = {};
    if (touchedSids.length) {
      const placeholders = touchedSids.map(() => '?').join(',');
      const existing = await queryAll(
        `SELECT sid, company, created_by, source FROM surveys WHERE unit = ? AND sid IN (${placeholders}) AND period_id = ?`,
        [unit, ...touchedSids, period.id]);
      existing.forEach(x => { ownerBySid[x.sid] = x; });
    }

    // Удаление
    if (Array.isArray(remove) && remove.length) {
      remove.forEach(sid => {
        const existing = ownerBySid[sid];
        if (existing && isOwnedByOther(existing.created_by, req.user, existing.source)) {
          blocked.push({ id: sid, company: existing.company, owner: existing.created_by, action: 'remove' });
          return;
        }
        stmts.push({
          sql: "UPDATE surveys SET state = 'удалена' WHERE sid = ? AND unit = ? AND period_id = ?",
          args: [sid, unit, period.id]
        });
      });
    }

    // Вставка / Обновление
    validatedItems.forEach(s => {
      let sid = s.id;
      if (sid && !String(sid).startsWith('tmp')) {
        const existing = ownerBySid[sid];
        if (existing && isOwnedByOther(existing.created_by, req.user, existing.source)) {
          blocked.push({ id: sid, company: existing.company, owner: existing.created_by, action: 'edit' });
          newIds.push(sid);
          return;
        }
        stmts.push({
          sql: `UPDATE surveys
                SET company = ?, pos_our = ?, pos_their = ?, grade = ?, pay_from = ?, pay_to = ?, cur = ?, pay_per = ?,
                    bon_has = ?, bon_size = ?, bon_type = ?, bon_per = ?, bonuses = ?, benefits = ?, schedule = ?, extra = ?, source = ?, trust = ?, note = ?
                WHERE sid = ? AND unit = ? AND period_id = ?`,
          args: [
            s.company, s.posOur, s.posTheir, s.grade,
            s.pFrom, s.pTo, s.cur, s.payPer,
            s.bonHas, s.bonSize, s.bonType, s.bonPer, s.bonuses,
            s.benefits, s.schedule, s.extra, s.source, s.trust, s.note,
            sid, unit, period.id
          ]
        });
        newIds.push(sid);
      } else {
        sid = newRowId('s');
        newIds.push(sid);
        stmts.push({
          sql: `INSERT INTO surveys (sid, unit, company, pos_our, pos_their, grade, pay_from, pay_to, cur, pay_per, bon_has, bon_size, bon_type, bon_per, bonuses, benefits, schedule, extra, source, trust, note, created_by, created_at, state, period, period_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'активна', ?, ?)`,
          args: [
            sid, unit, s.company, s.posOur, s.posTheir, s.grade,
            s.pFrom, s.pTo, s.cur, s.payPer,
            s.bonHas, s.bonSize, s.bonType, s.bonPer, s.bonuses,
            s.benefits, s.schedule, s.extra, s.source, s.trust, s.note,
            req.user.fio || req.user.login, now, period.name, period.id
          ]
        });
      }
    });

    stmts.push({
      sql: 'INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)',
      args: [
        req.user.login,
        'сохранение данных по должностям',
        `Подразделение: ${unit}, сохранено анкет: ${validatedItems.length}, удалено: ${(remove || []).length}`
      ]
    });

    if (stmts.length > 0) {
      await batch(stmts);
    }

    res.json({
      ok: true,
      newIds,
      blocked,
      added: validatedItems.filter(x => !x.id || String(x.id).startsWith('tmp')).length,
      updated: validatedItems.filter(x => x.id && !String(x.id).startsWith('tmp')).length,
      removed: (remove || []).length
    });
  } catch (err) {
    console.error('Save survey details error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка сохранения данных по должностям' });
  }
};

/**
 * Добавление значения в справочник прямо из анкеты — кнопка «+ Добавить» в
 * пикере. Раньше поддерживались только компании и должности, а сегменты с
 * регионами вообще не были таблицами; теперь блоков четыре.
 *
 * Для должности можно передать unit: тогда она не просто попадёт в общий
 * справочник, но и прикрепится к направлению этого подразделения — то есть
 * появится в «штатке» у всех, кто это направление ведёт.
 */
exports.addDictionaryItem = async (req, res) => {
  const { block, name, segment, region, unit } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ ok: false, error: 'Укажите название' });
  }

  const cleanName = name.trim();

  try {
    if (block === 'companies') {
      await run('INSERT OR IGNORE INTO dictionary_companies (name, segment, region) VALUES (?, ?, ?)', [
        cleanName, segment || '', region || ''
      ]);
      const list = await queryAll('SELECT name, segment, region FROM dictionary_companies ORDER BY name ASC');
      return res.json({
        ok: true,
        name: cleanName,
        list: list.map(x => x.name),
        all: list
      });
    }

    if (block === 'positions') {
      await run('INSERT OR IGNORE INTO dictionary_positions (name) VALUES (?)', [cleanName]);

      // Прикрепляем к направлению подразделения. Колонки dirs может не быть,
      // если миграция ещё не прошла, — тогда должность просто останется общей,
      // а не приведёт к ошибке при сохранении анкеты.
      let dirsOfUser = [];
      if (unit) {
        try {
          const d = await queryOne('SELECT dir FROM divisions WHERE unit = ?', [unit]);
          const dir = d && String(d.dir || '').trim();
          if (dir) {
            const cur = await queryOne("SELECT COALESCE(dirs,'') AS dirs FROM dictionary_positions WHERE name = ?", [cleanName]);
            const own = String((cur && cur.dirs) || '').split(';').map(s => s.trim()).filter(Boolean);
            if (!own.includes(dir)) {
              own.push(dir);
              await run('UPDATE dictionary_positions SET dirs = ? WHERE name = ?', [own.join(';'), cleanName]);
            }
            dirsOfUser = [dir];
          }
        } catch (e) {
          console.error('Не удалось прикрепить должность к направлению:', e.message);
        }
      }

      const allRows = await queryAll('SELECT name FROM dictionary_positions ORDER BY name ASC');
      const all = allRows.map(x => x.name);

      let list = all;
      if (dirsOfUser.length) {
        try {
          const scoped = await queryAll(
            "SELECT name, COALESCE(dirs,'') AS dirs FROM dictionary_positions WHERE COALESCE(dirs,'') <> '' ORDER BY name ASC");
          const own = scoped.filter(p => String(p.dirs || '').split(';').map(s => s.trim()).includes(dirsOfUser[0]));
          if (own.length) list = own.map(x => x.name);
        } catch (e) { /* остаёмся на общем списке */ }
      }

      return res.json({ ok: true, name: cleanName, list, all });
    }

    if (block === 'segments' || block === 'regions') {
      const table = block === 'segments' ? 'dictionary_segments' : 'dictionary_regions';
      await run(`INSERT OR IGNORE INTO ${table} (name) VALUES (?)`, [cleanName]);
      const rows = await queryAll(`SELECT name FROM ${table} ORDER BY name ASC`);
      return res.json({ ok: true, name: cleanName, list: rows.map(x => x.name) });
    }

    res.status(400).json({ ok: false, error: 'Неизвестный блок' });
  } catch (err) {
    console.error('Add dictionary error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка добавления в справочник' });
  }
};

/**
 * Анкеты подразделения за КОНКРЕТНЫЙ год — используется формой заполнения,
 * когда человек с активным грантом переключается на архивный год (см.
 * docs/superpowers/specs/2026-09-05-archive-edit-access-design.md). Та же
 * проверка доступа, что и на сохранении — resolveEditablePeriod.
 */
exports.getSurveysForPeriod = async (req, res) => {
  const { unit, periodId } = req.body;
  if (!unit || !String(unit).trim()) {
    return res.status(400).json({ ok: false, error: 'Не указано подразделение' });
  }

  try {
    const resolved = await resolveEditablePeriod(periodId, req.user);
    if (!resolved.ok) {
      return res.status(resolved.status).json({ ok: false, error: resolved.error });
    }

    const surveys = await queryAll(
      "SELECT * FROM surveys WHERE unit = ? AND state != 'удалена' AND period_id = ?",
      [String(unit).trim(), resolved.period.id]
    );

    res.json({ ok: true, surveys });
  } catch (err) {
    console.error('getSurveysForPeriod error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка загрузки анкет за период' });
  }
};
