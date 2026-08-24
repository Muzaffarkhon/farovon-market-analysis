const { queryOne, queryAll, run, batch } = require('../db/database');

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
  if (Array.isArray(v)) return v.filter(Boolean).join(';');
  return String(v == null ? '' : v);
}

function benefitsToList(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  return String(v == null ? '' : v)
    .split(/[;,]/).map(s => s.trim()).filter(Boolean);
}

exports.benefitsToList = benefitsToList;

exports.saveSurveyData = async (req, res) => {
  const { unit, rows, added, note, submit } = req.body;
  if (!unit) {
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

    // 1. Обновляем существующие строки конкурентов
    (rows || []).forEach(r => {
      if (r.id) {
        stmts.push({
          sql: `UPDATE competitors SET actual = ?, note = ?, updated_by = ?, updated_at = ? WHERE cid = ? AND unit = ?`,
          args: [r.actual || 'уточнить', r.note || '', req.user.fio || req.user.login, now, r.id, unit]
        });
      }
    });

    // 2. Вставляем добавленные компании
    (added || []).forEach(a => {
      const cid = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      newIds.push(cid);
      stmts.push({
        sql: `INSERT INTO competitors (cid, num, dir, unit, resp, hrbp, company, type, segment, region, prio, status, src, note, actual, updated_by, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          cid,
          0,
          a.dir || '',
          unit,
          req.user.fio,
          '',
          a.company,
          a.type || '',
          a.segment || '',
          a.region || '',
          a.prio || '',
          a.status || '',
          a.src || 'форма',
          a.note || '',
          a.actual || 'актуально',
          req.user.fio || req.user.login,
          now
        ]
      });
    });

    // 3. Журнал
    stmts.push({
      sql: `INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)`,
      args: [
        req.user.login,
        submit ? 'отправка подразделения' : 'сохранение участников рынка',
        `Подразделение: ${unit}, обновлено строк: ${(rows || []).length}, добавлено: ${(added || []).length}`
      ]
    });

    if (stmts.length > 0) {
      await batch(stmts);
    }

    res.json({
      ok: true,
      newIds,
      at: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    });
  } catch (err) {
    console.error('Save survey data error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка сохранения данных по компаниям' });
  }
};

exports.saveSurveyDetails = async (req, res) => {
  const { unit, upsert, remove } = req.body;
  if (!unit) {
    return res.status(400).json({ ok: false, error: 'Не указано подразделение' });
  }

  try {
    const period = (await queryOne('SELECT state, name FROM periods ORDER BY id DESC LIMIT 1')) || { state: 'открыт', name: 'Обзор рынка' };
    if (period.state === 'закрыт' && req.user.role !== 'hrbp' && req.user.role !== 'admin' && req.user.role !== 'cb') {
      return res.status(403).json({ ok: false, error: 'Период сбора данных закрыт' });
    }

    const now = new Date().toISOString();
    const newIds = [];
    const stmts = [];

    // Удаление
    if (Array.isArray(remove) && remove.length) {
      remove.forEach(sid => {
        stmts.push({
          sql: "UPDATE surveys SET state = 'удалена' WHERE sid = ? AND unit = ?",
          args: [sid, unit]
        });
      });
    }

    // Вставка / Обновление
    (upsert || []).forEach(s => {
      let sid = s.id;
      if (sid && !sid.startsWith('tmp')) {
        stmts.push({
          sql: `UPDATE surveys
                SET company = ?, pos_our = ?, pos_their = ?, grade = ?, pay_from = ?, pay_to = ?, cur = ?, pay_per = ?,
                    bon_has = ?, bon_size = ?, bon_type = ?, bon_per = ?, benefits = ?, extra = ?, source = ?, trust = ?, note = ?
                WHERE sid = ? AND unit = ?`,
          args: [
            s.company, s.posOur, s.posTheir || '', s.grade || '',
            Number(s.payFrom) || 0, Number(s.payTo) || 0, s.cur || 'сомони', s.payPer || 'в месяц',
            s.bonHas || 'не знаю', s.bonSize || '', s.bonType || '', s.bonPer || '',
            benefitsToText(s.benefits), s.extra || '', s.source || '', s.trust || '', s.note || '',
            sid, unit
          ]
        });
        newIds.push(sid);
      } else {
        sid = 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        newIds.push(sid);
        stmts.push({
          sql: `INSERT INTO surveys (sid, unit, company, pos_our, pos_their, grade, pay_from, pay_to, cur, pay_per, bon_has, bon_size, bon_type, bon_per, benefits, extra, source, trust, note, created_by, created_at, state, period)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'активна', ?)`,
          args: [
            sid, unit, s.company, s.posOur, s.posTheir || '', s.grade || '',
            Number(s.payFrom) || 0, Number(s.payTo) || 0, s.cur || 'сомони', s.payPer || 'в месяц',
            s.bonHas || 'не знаю', s.bonSize || '', s.bonType || '', s.bonPer || '',
            benefitsToText(s.benefits), s.extra || '', s.source || '', s.trust || '', s.note || '',
            req.user.fio || req.user.login, now, period.name
          ]
        });
      }
    });

    stmts.push({
      sql: 'INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)',
      args: [
        req.user.login,
        'сохранение данных по должностям',
        `Подразделение: ${unit}, сохранено анкет: ${(upsert || []).length}, удалено: ${(remove || []).length}`
      ]
    });

    if (stmts.length > 0) {
      await batch(stmts);
    }

    res.json({
      ok: true,
      newIds,
      added: (upsert || []).filter(x => !x.id || x.id.startsWith('tmp')).length,
      updated: (upsert || []).filter(x => x.id && !x.id.startsWith('tmp')).length,
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
