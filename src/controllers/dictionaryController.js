const { queryAll, queryOne, run } = require('../db/database');

/**
 * Справочники системы: компании, должности, сегменты, регионы.
 *
 * Раньше единственным способом что-то сюда добавить была кнопка «+ Добавить»
 * внутри анкеты, а удалить — никак. Сегменты и регионы вообще не были
 * таблицами: их собирали DISTINCT'ом по строкам, поэтому «удалить сегмент»
 * означало найти и переписать все строки, где он встречается.
 *
 * Здесь справочники — обычные таблицы с CRUD. Значение, добавленное админом,
 * сразу приходит всем в payload; удаление вычищает значение и из связанных
 * данных, но только после того, как пользователю показали, сколько строк оно
 * затронет: за одним названием компании может стоять несколько сотен строк
 * конкурентов и анкет, и «удалить» здесь не то же самое, что «убрать из
 * выпадающего списка».
 */

// Что именно затронет удаление и куда значение проросло в данных.
const KINDS = {
  companies: {
    table: 'dictionary_companies',
    title: 'компания',
    uses: [
      { sql: 'SELECT COUNT(*) AS n FROM competitors WHERE company = ?', label: ['строка участников рынка', 'строки участников рынка', 'строк участников рынка'] },
      { sql: "SELECT COUNT(*) AS n FROM surveys WHERE company = ? AND state != 'удалена'", label: ['анкета по должностям', 'анкеты по должностям', 'анкет по должностям'] }
    ],
    purge: [
      'DELETE FROM competitors WHERE company = ?',
      'DELETE FROM surveys WHERE company = ?'
    ]
  },
  positions: {
    table: 'dictionary_positions',
    title: 'должность',
    uses: [
      { sql: "SELECT COUNT(*) AS n FROM surveys WHERE (pos_our = ? OR pos_their = ?) AND state != 'удалена'", label: ['анкета по должностям', 'анкеты по должностям', 'анкет по должностям'], twice: true }
    ],
    purge: ['DELETE FROM surveys WHERE pos_our = ? OR pos_their = ?']
  },
  segments: {
    table: 'dictionary_segments',
    title: 'сегмент',
    uses: [
      { sql: 'SELECT COUNT(*) AS n FROM dictionary_companies WHERE segment = ?', label: ['компания в справочнике', 'компании в справочнике', 'компаний в справочнике'] },
      { sql: 'SELECT COUNT(*) AS n FROM competitors WHERE segment = ?', label: ['строка участников рынка', 'строки участников рынка', 'строк участников рынка'] }
    ],
    // Сегмент — свойство компании, а не сама запись: удаляя его, очищаем поле,
    // а не сносим компанию вместе с накопленными по ней данными.
    purge: [
      "UPDATE dictionary_companies SET segment = '' WHERE segment = ?",
      "UPDATE competitors SET segment = '' WHERE segment = ?"
    ]
  },
  regions: {
    table: 'dictionary_regions',
    title: 'регион',
    uses: [
      { sql: 'SELECT COUNT(*) AS n FROM dictionary_companies WHERE region = ?', label: ['компания в справочнике', 'компании в справочнике', 'компаний в справочнике'] },
      { sql: 'SELECT COUNT(*) AS n FROM competitors WHERE region = ?', label: ['строка участников рынка', 'строки участников рынка', 'строк участников рынка'] }
    ],
    purge: [
      "UPDATE dictionary_companies SET region = '' WHERE region = ?",
      "UPDATE competitors SET region = '' WHERE region = ?"
    ]
  }
};

/** «1 строка», «2 строки», «5 строк» — иначе предупреждение читается как мусор. */
function plural(n, forms) {
  if (!Array.isArray(forms)) return forms;
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

async function countUses(kind, name) {
  const cfg = KINDS[kind];
  const out = [];
  let total = 0;
  for (const u of cfg.uses) {
    const row = await queryOne(u.sql, u.twice ? [name, name] : [name]);
    const n = (row && row.n) || 0;
    total += n;
    if (n) out.push(`${n} ${plural(n, u.label)}`);
  }
  return { total, parts: out };
}

async function audit(login, action, detail) {
  await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [login, action, detail]);
}

/** Полный список одного справочника вместе со счётчиком использований. */
exports.list = async (req, res) => {
  const kind = req.params.kind;
  if (!KINDS[kind]) return res.status(400).json({ ok: false, error: 'Неизвестный справочник' });

  try {
    let items;

    if (kind === 'companies') {
      const rows = await queryAll(`
        SELECT d.name, d.segment, d.region, COALESCE(d.dirs, '') AS dirs,
               (SELECT COUNT(*) FROM competitors c WHERE c.company = d.name) AS used
        FROM dictionary_companies d ORDER BY d.name ASC`);
      items = rows.map(r => ({
        name: r.name,
        segment: r.segment || '',
        region: r.region || '',
        dirs: String(r.dirs || '').split(';').map(s => s.trim()).filter(Boolean),
        used: r.used || 0
      }));
    } else if (kind === 'positions') {
      const rows = await queryAll(`
        SELECT d.name, COALESCE(d.dirs, '') AS dirs,
               (SELECT COUNT(*) FROM surveys s WHERE (s.pos_our = d.name OR s.pos_their = d.name)
                  AND s.state != 'удалена') AS used
        FROM dictionary_positions d ORDER BY d.name ASC`);
      items = rows.map(r => ({
        name: r.name,
        dirs: String(r.dirs || '').split(';').map(s => s.trim()).filter(Boolean),
        used: r.used || 0
      }));
    } else {
      const field = kind === 'segments' ? 'segment' : 'region';
      const rows = await queryAll(`
        SELECT d.name,
               (SELECT COUNT(*) FROM competitors c WHERE c.${field} = d.name) AS used
        FROM ${KINDS[kind].table} d ORDER BY d.name ASC`);
      items = rows.map(r => ({ name: r.name, used: r.used || 0 }));
    }

    // Направления берём из оргструктуры: отдельного справочника направлений нет,
    // и заводить второй источник правды рядом с divisions.dir нельзя — они
    // разойдутся при первой же правке подразделения.
    const dirRows = await queryAll(
      "SELECT DISTINCT TRIM(dir) AS v FROM divisions WHERE TRIM(COALESCE(dir,'')) <> '' ORDER BY v"
    );

    res.json({ ok: true, kind, items, dirs: dirRows.map(r => r.v) });
  } catch (err) {
    console.error('dictionary list error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка загрузки справочника' });
  }
};

/** Добавление или правка значения. Переименование тянет за собой все данные. */
exports.save = async (req, res) => {
  const kind = req.params.kind;
  if (!KINDS[kind]) return res.status(400).json({ ok: false, error: 'Неизвестный справочник' });

  const name = String(req.body.name || '').trim();
  const prev = String(req.body.prev || '').trim();
  if (!name) return res.status(400).json({ ok: false, error: 'Укажите название' });

  const segment = String(req.body.segment || '').trim();
  const region = String(req.body.region || '').trim();
  const dirs = Array.isArray(req.body.dirs) ? req.body.dirs.filter(Boolean).join(';') : '';

  try {
    const dup = await queryOne(`SELECT name FROM ${KINDS[kind].table} WHERE LOWER(name) = LOWER(?)`, [name]);
    if (dup && dup.name !== prev) {
      return res.status(400).json({ ok: false, error: `Уже есть: «${dup.name}»` });
    }

    if (!prev) {
      if (kind === 'companies') {
        await run('INSERT INTO dictionary_companies (name, segment, region, dirs) VALUES (?, ?, ?, ?)',
          [name, segment, region, dirs]);
      } else if (kind === 'positions') {
        await run('INSERT INTO dictionary_positions (name, dirs) VALUES (?, ?)', [name, dirs]);
      } else {
        await run(`INSERT INTO ${KINDS[kind].table} (name) VALUES (?)`, [name]);
      }
      await audit(req.user.login, 'справочник: добавление', `${KINDS[kind].title} «${name}»`);
      return res.json({ ok: true, name });
    }

    // Правка. Название — natural key: связанные строки ссылаются на текст, а не
    // на id, поэтому переименование обязано пройти по всем таблицам, иначе
    // строки просто перестанут находиться (тот же класс поломки, что чинила
    // утилита «Проверка привязки к оргструктуре»).
    if (kind === 'companies') {
      await run('UPDATE dictionary_companies SET name = ?, segment = ?, region = ?, dirs = ? WHERE name = ?',
        [name, segment, region, dirs, prev]);
      if (name !== prev) {
        await run('UPDATE competitors SET company = ? WHERE company = ?', [name, prev]);
        await run('UPDATE surveys SET company = ? WHERE company = ?', [name, prev]);
      }
      if (segment) await run('UPDATE competitors SET segment = ? WHERE company = ?', [segment, name]);
      if (region) await run('UPDATE competitors SET region = ? WHERE company = ?', [region, name]);
    } else if (kind === 'positions') {
      await run('UPDATE dictionary_positions SET name = ?, dirs = ? WHERE name = ?', [name, dirs, prev]);
      if (name !== prev) {
        await run('UPDATE surveys SET pos_our = ? WHERE pos_our = ?', [name, prev]);
        await run('UPDATE surveys SET pos_their = ? WHERE pos_their = ?', [name, prev]);
      }
    } else {
      const field = kind === 'segments' ? 'segment' : 'region';
      await run(`UPDATE ${KINDS[kind].table} SET name = ? WHERE name = ?`, [name, prev]);
      if (name !== prev) {
        await run(`UPDATE dictionary_companies SET ${field} = ? WHERE ${field} = ?`, [name, prev]);
        await run(`UPDATE competitors SET ${field} = ? WHERE ${field} = ?`, [name, prev]);
      }
    }

    await audit(req.user.login, 'справочник: правка',
      `${KINDS[kind].title} «${prev}»${name !== prev ? ` → «${name}»` : ''}`);
    res.json({ ok: true, name });
  } catch (err) {
    console.error('dictionary save error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка сохранения' });
  }
};

/**
 * Сколько данных заденет удаление. Отдельный запрос, чтобы диалог подтверждения
 * показывал реальные цифры до того, как что-то удалено.
 */
exports.usage = async (req, res) => {
  const kind = req.params.kind;
  if (!KINDS[kind]) return res.status(400).json({ ok: false, error: 'Неизвестный справочник' });
  const name = String(req.query.name || '').trim();
  if (!name) return res.status(400).json({ ok: false, error: 'Укажите название' });

  try {
    const u = await countUses(kind, name);
    res.json({ ok: true, name, total: u.total, parts: u.parts });
  } catch (err) {
    console.error('dictionary usage error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка проверки' });
  }
};

/** Удаление. Без confirm=true не трогает ничего — только сообщает объём. */
exports.remove = async (req, res) => {
  const kind = req.params.kind;
  if (!KINDS[kind]) return res.status(400).json({ ok: false, error: 'Неизвестный справочник' });

  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ ok: false, error: 'Укажите название' });

  try {
    const u = await countUses(kind, name);

    if (u.total > 0 && req.body.confirm !== true) {
      return res.json({ ok: false, needsConfirm: true, total: u.total, parts: u.parts });
    }

    const cfg = KINDS[kind];
    for (const sql of cfg.purge) {
      const twice = (sql.match(/\?/g) || []).length > 1;
      await run(sql, twice ? [name, name] : [name]);
    }
    await run(`DELETE FROM ${cfg.table} WHERE name = ?`, [name]);

    await audit(req.user.login, 'справочник: удаление',
      `${cfg.title} «${name}»` + (u.total ? `, затронуто: ${u.parts.join(', ')}` : ''));

    res.json({ ok: true, removed: name, total: u.total, parts: u.parts });
  } catch (err) {
    console.error('dictionary remove error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка удаления' });
  }
};
