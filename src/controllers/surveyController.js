const { getDb } = require('../db/database');

exports.saveSurveyData = (req, res) => {
  const { unit, rows, added, note, submit } = req.body;
  if (!unit) {
    return res.status(400).json({ ok: false, error: 'Не указано подразделение' });
  }

  const db = getDb();
  const period = db.prepare('SELECT state FROM periods ORDER BY id DESC LIMIT 1').get();
  if (period && period.state === 'закрыт' && req.user.role !== 'hrbp' && req.user.role !== 'admin' && req.user.role !== 'cb') {
    return res.status(403).json({ ok: false, error: 'Период сбора данных закрыт' });
  }

  const now = new Date().toISOString();
  const newIds = [];

  db.transaction(() => {
    // 1. Обновляем существующие строки конкурентов
    const updateStmt = db.prepare(`
      UPDATE competitors
      SET actual = ?, note = ?, updated_by = ?, updated_at = ?
      WHERE cid = ? AND unit = ?
    `);

    (rows || []).forEach(r => {
      if (r.id) {
        updateStmt.run(r.actual || 'уточнить', r.note || '', req.user.fio || req.user.login, now, r.id, unit);
      }
    });

    // 2. Вставляем добавленные компании
    const insertStmt = db.prepare(`
      INSERT INTO competitors (cid, num, dir, unit, resp, hrbp, company, type, segment, region, prio, status, src, note, actual, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    (added || []).forEach(a => {
      const cid = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      newIds.push(cid);
      insertStmt.run(
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
      );
    });

    // 3. Журнал
    db.prepare('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)').run(
      req.user.login,
      submit ? 'отправка подразделения' : 'сохранение конкурентов',
      `Подразделение: ${unit}, обновлено строк: ${(rows || []).length}, добавлено: ${(added || []).length}`
    );
  })();

  res.json({
    ok: true,
    newIds,
    at: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  });
};

exports.saveSurveyDetails = (req, res) => {
  const { unit, upsert, remove } = req.body;
  if (!unit) {
    return res.status(400).json({ ok: false, error: 'Не указано подразделение' });
  }

  const db = getDb();
  const period = db.prepare('SELECT state, name FROM periods ORDER BY id DESC LIMIT 1').get() || { state: 'открыт', name: 'Обзор рынка' };
  if (period.state === 'закрыт' && req.user.role !== 'hrbp' && req.user.role !== 'admin' && req.user.role !== 'cb') {
    return res.status(403).json({ ok: false, error: 'Период сбора данных закрыт' });
  }

  const now = new Date().toISOString();
  const newIds = [];

  db.transaction(() => {
    // Удаление
    if (Array.isArray(remove) && remove.length) {
      const deleteStmt = db.prepare('UPDATE surveys SET state = "удалена" WHERE sid = ? AND unit = ?');
      remove.forEach(sid => deleteStmt.run(sid, unit));
    }

    // Вставка / Обновление
    const updateStmt = db.prepare(`
      UPDATE surveys
      SET company = ?, pos_our = ?, pos_their = ?, grade = ?, pay_from = ?, pay_to = ?, cur = ?, pay_per = ?,
          bon_has = ?, bon_size = ?, bon_type = ?, bon_per = ?, benefits = ?, extra = ?, source = ?, trust = ?, note = ?
      WHERE sid = ? AND unit = ?
    `);

    const insertStmt = db.prepare(`
      INSERT INTO surveys (sid, unit, company, pos_our, pos_their, grade, pay_from, pay_to, cur, pay_per, bon_has, bon_size, bon_type, bon_per, benefits, extra, source, trust, note, created_by, created_at, state, period)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'активна', ?)
    `);

    (upsert || []).forEach(s => {
      let sid = s.id;
      if (sid && !sid.startsWith('tmp')) {
        updateStmt.run(
          s.company, s.posOur, s.posTheir || '', s.grade || '',
          Number(s.payFrom) || 0, Number(s.payTo) || 0, s.cur || 'сомони', s.payPer || 'в месяц',
          s.bonHas || 'не знаю', s.bonSize || '', s.bonType || '', s.bonPer || '',
          s.benefits || '', s.extra || '', s.source || '', s.trust || '', s.note || '',
          sid, unit
        );
        newIds.push(sid);
      } else {
        sid = 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        newIds.push(sid);
        insertStmt.run(
          sid, unit, s.company, s.posOur, s.posTheir || '', s.grade || '',
          Number(s.payFrom) || 0, Number(s.payTo) || 0, s.cur || 'сомони', s.payPer || 'в месяц',
          s.bonHas || 'не знаю', s.bonSize || '', s.bonType || '', s.bonPer || '',
          s.benefits || '', s.extra || '', s.source || '', s.trust || '', s.note || '',
          req.user.fio || req.user.login, now, period.name
        );
      }
    });

    db.prepare('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)').run(
      req.user.login,
      'сохранение данных по должностям',
      `Подразделение: ${unit}, сохранено анкет: ${(upsert || []).length}, удалено: ${(remove || []).length}`
    );
  })();

  res.json({
    ok: true,
    newIds,
    added: (upsert || []).filter(x => !x.id || x.id.startsWith('tmp')).length,
    updated: (upsert || []).filter(x => x.id && !x.id.startsWith('tmp')).length,
    removed: (remove || []).length
  });
};

exports.addDictionaryItem = (req, res) => {
  const { block, name, segment, region } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ ok: false, error: 'Укажите название' });
  }

  const cleanName = name.trim();
  const db = getDb();

  if (block === 'companies') {
    db.prepare('INSERT OR IGNORE INTO dictionary_companies (name, segment, region) VALUES (?, ?, ?)').run(
      cleanName, segment || '', region || ''
    );
    const list = db.prepare('SELECT name, segment, region FROM dictionary_companies ORDER BY name ASC').all();
    return res.json({
      ok: true,
      name: cleanName,
      list: list.map(x => x.name),
      all: list
    });
  } else if (block === 'positions') {
    db.prepare('INSERT OR IGNORE INTO dictionary_positions (name) VALUES (?)').run(cleanName);
    const list = db.prepare('SELECT name FROM dictionary_positions ORDER BY name ASC').all().map(x => x.name);
    return res.json({
      ok: true,
      name: cleanName,
      list
    });
  }

  res.status(400).json({ ok: false, error: 'Неизвестный блок' });
};
