const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { queryAll, queryOne, run } = require('../db/database');
const { benefitsToList } = require('./surveyController');
const { CAPABILITIES } = require('../config/capabilities');

function hashPassword(pwd) {
  return bcrypt.hashSync(String(pwd || ''), 10);
}

function verifyPassword(pwd, user) {
  if (!user) return false;
  if (user.password_hash) {
    if (user.password_hash.startsWith('$2a$') || user.password_hash.startsWith('$2b$') || user.password_hash.startsWith('$2y$')) {
      try {
        if (bcrypt.compareSync(pwd, user.password_hash)) return true;
      } catch (e) {}
    }
    const sha = crypto.createHash('sha256').update(String(pwd || '')).digest('hex');
    if (user.password_hash === sha) return true;
  }
  return false;
}

function makeToken(user) {
  return jwt.sign(
    { id: user.id, login: user.login, role: user.role, fio: user.fio },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

async function getPeriodInfo() {
  const p = await queryOne('SELECT * FROM periods ORDER BY id DESC LIMIT 1');
  return p ? {
    name: p.name,
    state: p.state,
    from: p.from_date || '',
    to: p.to_date || '',
    by: p.updated_by || '',
    at: p.updated_at || ''
  } : { name: 'Обзор рынка', state: 'открыт' };
}

async function getUserPayload(user) {
  const unitsList = user.units
    ? (Array.isArray(user.units) ? user.units : user.units.split(';').map(s => s.trim()).filter(Boolean))
    : [];

  // group_key может отсутствовать до миграции — та же защита, что у dirs
  // ниже: вход не должен падать, если сервер стартовал раньше миграции.
  const allUnits = await (async () => {
    try {
      return await queryAll("SELECT unit, dir, COALESCE(group_key,'') AS group_key FROM divisions ORDER BY num ASC, unit ASC");
    } catch (e) {
      console.error('Колонка group_key недоступна:', e.message);
      return (await queryAll('SELECT unit, dir FROM divisions ORDER BY num ASC, unit ASC'))
        .map(d => ({ ...d, group_key: '' }));
    }
  })();

  // Подсчёт прогресса по доступным подразделениям
  const compRows = await queryAll('SELECT unit, actual FROM competitors');
  const survRows = await queryAll("SELECT unit FROM surveys WHERE state != 'удалена'");

  const compMap = {};
  compRows.forEach(c => {
    if (!compMap[c.unit]) compMap[c.unit] = { total: 0, done: 0, ask: 0 };
    compMap[c.unit].total++;
    const act = (c.actual || '').toLowerCase();
    if (act === 'актуально' || act === 'не актуально') compMap[c.unit].done++;
    else if (act === 'уточнить') compMap[c.unit].ask++;
  });

  const survMap = {};
  survRows.forEach(s => {
    survMap[s.unit] = (survMap[s.unit] || 0) + 1;
  });

  // Получаем список назначенных подразделений
  let visibleUnits = [];
  if (user.role === 'admin' || user.role === 'cb') {
    visibleUnits = allUnits.map(d => ({
      unit: d.unit,
      dir: d.dir,
      group: d.group_key || '',
      total: (compMap[d.unit] || {}).total || 0,
      done: (compMap[d.unit] || {}).done || 0,
      ask: (compMap[d.unit] || {}).ask || 0,
      surveys: survMap[d.unit] || 0
    }));
  } else {
    visibleUnits = allUnits.filter(d => unitsList.includes(d.unit)).map(d => ({
      unit: d.unit,
      dir: d.dir,
      group: d.group_key || '',
      total: (compMap[d.unit] || {}).total || 0,
      done: (compMap[d.unit] || {}).done || 0,
      ask: (compMap[d.unit] || {}).ask || 0,
      surveys: survMap[d.unit] || 0
    }));
  }

  // Справочники.
  // Колонка dirs добавляется миграцией на старте; если та не прошла, читаем без
  // неё, а не роняем вход — см. комментарий к safeNames ниже.
  const withDirs = async (sql, fallbackSql) => {
    try {
      return await queryAll(sql);
    } catch (e) {
      console.error('Колонка dirs недоступна, читаем без неё:', e.message);
      return await queryAll(fallbackSql);
    }
  };
  const dictCompanies = await withDirs(
    "SELECT name, segment, region, COALESCE(dirs, '') AS dirs FROM dictionary_companies ORDER BY name ASC",
    'SELECT name, segment, region FROM dictionary_companies ORDER BY name ASC');
  const dictPositionsRows = await withDirs(
    "SELECT name, COALESCE(dirs, '') AS dirs FROM dictionary_positions ORDER BY name ASC",
    'SELECT name FROM dictionary_positions ORDER BY name ASC');
  const dictPositions = dictPositionsRows.map(x => x.name);

  // Направления подразделений, доступных пользователю: по ним отбираются
  // должности и компании его профиля. Раньше «штатка» подразделения не
  // показывалась никому и никогда — привязки должности к чему-либо просто не
  // существовало в схеме, и экран всегда писал «штатка не заведена».
  const userDirs = [...new Set(visibleUnits.map(u => (u.dir || '').trim()).filter(Boolean))];
  const inDirs = (raw) => {
    const own = String(raw || '').split(';').map(s => s.trim()).filter(Boolean);
    if (!own.length) return false;
    return own.some(d => userDirs.includes(d));
  };
  const positionsByDir = dictPositionsRows.filter(p => inDirs(p.dirs)).map(p => p.name);

  // Штатное расписание по конкретным подразделениям пользователя. Это точнее
  // направления: в исходном штатном расписании должности расписаны по отделам,
  // и руководителю на шаге 2 нужен список именно своего отдела, а не всех 255
  // должностей направления.
  const positionsByUnit = {};
  try {
    // Раньше здесь стояло исключение для admin и cb — «анкеты они не заполняют,
    // незачем раздувать ответ». Но открыть подразделение и посмотреть его
    // данные они могут, и у них экран всегда писал «штатка не заведена»,
    // независимо от того, загружено расписание или нет. Именно под админом
    // проверяют результат загрузки, так что исключение маскировало сам факт
    // импорта. Всё расписание — 1340 строк, это несколько десятков килобайт.
    const myUnits = visibleUnits.map(x => x.unit);
    if (myUnits.length) {
      const rows = myUnits.length > 200
        ? await queryAll('SELECT unit, position FROM unit_positions ORDER BY position ASC')
        : await queryAll(
            `SELECT unit, position FROM unit_positions WHERE unit IN (${myUnits.map(() => '?').join(',')})
             ORDER BY position ASC`, myUnits);
      const allowed = new Set(myUnits);
      rows.forEach(r => {
        if (!allowed.has(r.unit)) return;
        if (!positionsByUnit[r.unit]) positionsByUnit[r.unit] = [];
        positionsByUnit[r.unit].push(r.position);
      });
    }
  } catch (e) {
    // Таблицы ещё нет — экран просто останется на общем справочнике.
    console.error('Штатное расписание недоступно:', e.message);
  }

  // Смежные группы (см. миграцию group_key) — площадки с одинаковой
  // структурой должностей («Служба охраны Анхор/ТМК/Фаровон/Навобод»).
  // positionsByGroup — объединённый уникальный список должностей по всей
  // группе, а не по одной площадке: не заставляет вносить одну и ту же
  // должность несколько раз для каждой площадки. companiesByGroup — уже
  // использованные кем-то из группы названия компаний, подсказками при
  // добавлении новой площадки в группу — только имена, не оценки/заметки.
  // Считаем только для групп, где есть хоть одно подразделение пользователя
  // — не тянем чужие группы в ответ.
  const positionsByGroup = {};
  const companiesByGroup = {};
  try {
    const myGroups = [...new Set(visibleUnits.map(x => x.group).filter(Boolean))];
    if (myGroups.length) {
      const placeholders = myGroups.map(() => '?').join(',');
      const groupDivs = await queryAll(
        `SELECT unit, group_key FROM divisions WHERE group_key IN (${placeholders})`, myGroups);
      const unitsInGroup = groupDivs.map(d => d.unit);
      const unitToGroup = {};
      groupDivs.forEach(d => { unitToGroup[d.unit] = d.group_key; });

      if (unitsInGroup.length) {
        const up = unitsInGroup.map(() => '?').join(',');
        const posRows = await queryAll(
          `SELECT unit, position FROM unit_positions WHERE unit IN (${up})`, unitsInGroup);
        posRows.forEach(r => {
          const g = unitToGroup[r.unit];
          if (!g) return;
          if (!positionsByGroup[g]) positionsByGroup[g] = new Set();
          positionsByGroup[g].add(r.position);
        });

        const compRowsGroup = await queryAll(
          `SELECT unit, company FROM competitors WHERE unit IN (${up})`, unitsInGroup);
        compRowsGroup.forEach(r => {
          const g = unitToGroup[r.unit];
          if (!g) return;
          if (!companiesByGroup[g]) companiesByGroup[g] = new Set();
          companiesByGroup[g].add(r.company);
        });
      }
    }
  } catch (e) {
    console.error('Смежные группы недоступны:', e.message);
  }
  const setsToArrays = (obj) => {
    const out = {};
    Object.keys(obj).forEach(k => { out[k] = [...obj[k]].sort((a, b) => a.localeCompare(b, 'ru')); });
    return out;
  };

  // Сегменты и регионы — из живых данных, а не из списка, придуманного при
  // переносе с Apps Script: там было 7 сегментов («Телеком», «Банки и Финтех»…),
  // которых нет ни в одной строке базы, при 60 реальных. Выбрать корректное
  // значение из такого списка было невозможно.
  const segRows = await queryAll(
    `SELECT DISTINCT TRIM(segment) AS v FROM dictionary_companies WHERE TRIM(COALESCE(segment,'')) <> ''
     UNION SELECT DISTINCT TRIM(segment) FROM competitors WHERE TRIM(COALESCE(segment,'')) <> ''
     ORDER BY v`
  );
  const regRows = await queryAll(
    `SELECT DISTINCT TRIM(region) AS v FROM dictionary_companies WHERE TRIM(COALESCE(region,'')) <> ''
     UNION SELECT DISTINCT TRIM(region) FROM competitors WHERE TRIM(COALESCE(region,'')) <> ''
     ORDER BY v`
  );

  // Сегменты и регионы теперь ещё и настоящие справочники, которые админ ведёт
  // руками: значение, заведённое заранее, должно быть доступно для выбора до
  // того, как появится первая строка с ним.
  //
  // Отдельным запросом с проглатыванием ошибки — намеренно. getUserPayload
  // выполняется при каждом входе, и если миграция на живой базе почему-то не
  // прошла, обращение к несуществующей таблице заблокировало бы вход всем
  // 111 пользователям. Списки при этом останутся прежними, собранными по
  // живым данным, — то есть деградация, а не отказ.
  const safeNames = async (table) => {
    try {
      const rows = await queryAll(
        `SELECT TRIM(name) AS v FROM ${table} WHERE TRIM(COALESCE(name,'')) <> ''`);
      return rows.map(r => r.v);
    } catch (e) {
      console.error(`Справочник ${table} недоступен:`, e.message);
      return [];
    }
  };
  const uniqSorted = (a, b) => [...new Set([...a, ...b])].sort((x, y) => x.localeCompare(y, 'ru'));

  const segments = uniqSorted(segRows.map(x => x.v), await safeNames('dictionary_segments'));
  const regions = uniqSorted(regRows.map(x => x.v), await safeNames('dictionary_regions'));

  // Конкуренты для пользователя
  const userUnitNames = visibleUnits.map(x => x.unit);
  let userCompetitors = [];
  let userSurveys = [];

  if (userUnitNames.length > 0) {
    const placeholders = userUnitNames.map(() => '?').join(',');
    userCompetitors = await queryAll(`SELECT * FROM competitors WHERE unit IN (${placeholders})`, userUnitNames);
    userSurveys = await queryAll(`SELECT * FROM surveys WHERE unit IN (${placeholders}) AND state != 'удалена'`, userUnitNames);
  }

  const period = await getPeriodInfo();

  // dir_head/head сами не выбирают, за какое подразделение отвечают —
  // назначение только сверху вниз: админ закрепляет направление за dir_head,
  // тот сам назначает ответственных по своим отделам (см. saveDivision).
  // Раньше needsUnitPick открывал им тот же свободный пикер по всем 326
  // подразделениям, что и рядовому сотруднику — то есть руководитель мог
  // сам выбрать себе направление без ведома администратора.
  const selfAssignRoles = ['dir_head', 'head'];
  const canSelfPick = !selfAssignRoles.includes(user.role);

  // Права из конструктора ролей и доступов — фронт по ним показывает/прячет
  // разделы админки (та же граница, что requireCapability проверяет на
  // сервере на каждом запросе; здесь — только для отрисовки навигации).
  // 'admin' получает полный список без обращения к таблице.
  let capabilities = [];
  if (user.role === 'admin') {
    capabilities = CAPABILITIES.map(c => c.id);
  } else {
    try {
      const capRows = await queryAll('SELECT capability FROM role_capabilities WHERE role = ?', [user.role]);
      capabilities = capRows.map(r => r.capability);
    } catch (e) {
      console.error('Права доступа недоступны:', e.message);
    }
  }

  return {
    user: {
      login: user.login,
      fio: user.fio,
      role: user.role,
      phone: user.phone || '',
      hasTelegram: !!user.telegram_chat_id,
      // Сырой список назначенных подразделений (не обогащённый прогрессом) —
      // нужен фронту dir_head, чтобы понять, каким направлением он управляет,
      // и построить экран «Назначить ответственных» по его отделам.
      units: unitsList,
      capabilities
    },
    period,
    needsUnitPick: unitsList.length === 0 && user.role !== 'admin' && user.role !== 'cb' && canSelfPick,
    needsAssignment: unitsList.length === 0 && selfAssignRoles.includes(user.role),
    units: visibleUnits,
    allUnits: allUnits,
    rows: userCompetitors.map(c => ({
      id: c.cid,
      unit: c.unit,
      company: c.company,
      type: c.type || '',
      segment: c.segment || '',
      region: c.region || '',
      prio: c.prio || '',
      status: c.status || '',
      note: c.note || '',
      actual: c.actual || 'уточнить',
      by: c.updated_by || '',
      at: c.updated_at || ''
    })),
    surveys: userSurveys.map(s => ({
      id: s.sid,
      unit: s.unit,
      company: s.company,
      posOur: s.pos_our,
      posTheir: s.pos_their || '',
      grade: s.grade || '',
      payFrom: s.pay_from || '',
      payTo: s.pay_to || '',
      cur: s.cur || 'сомони',
      payPer: s.pay_per || 'в месяц',
      bonHas: s.bon_has || 'не знаю',
      bonSize: s.bon_size || '',
      bonType: s.bon_type || '',
      bonPer: s.bon_per || '',
      // Массив, а не строка: фронт держит льготы списком (чипы с
      // множественным выбором) и вызывает на них .map. Строка из базы
      // роняла отрисовку всего шага 2.
      benefits: benefitsToList(s.benefits),
      note: s.note || '',
      source: s.source || '',
      trust: s.trust || '',
      // svCard() уже читает r.by/r.at для подписи «кто и когда внёс запись» —
      // поле просто никогда не приходило с сервера, подпись не появлялась.
      by: s.created_by || '',
      at: s.created_at || ''
    })),
    // openAddSheet() ищет подсказки по компании как c.name/c.seg/c.region (объекты),
    // а не по голым строкам — раньше здесь были только имена, автодополнение
    // компаний было сломано (TypeError при вводе 2+ символов).
    companies: dictCompanies.map(c => ({ name: c.name, seg: c.segment, region: c.region })),
    companiesAll: dictCompanies,
    // positions — должности направления пользователя (его «штатка»),
    // positionsAll — весь справочник холдинга. Пока админ не прикрепил
    // должности к направлениям, первый список пуст, и пикер сразу показывает
    // общий: пустой экран без выбора мы уже проходили.
    positions: positionsByDir.length ? positionsByDir : dictPositions,
    positionsAll: dictPositions,
    // Штатка по подразделениям: фронт уже читает S.data.positionsByUnit[unit]
    // при построении чек-листа шага 2 — до загрузки штатного расписания объект
    // всегда был пуст, отсюда «Для этого подразделения штатка не заведена».
    positionsByUnit,
    // Смежные группы площадок (group_key) — см. комментарий выше по коду.
    positionsByGroup: setsToArrays(positionsByGroup),
    companiesByGroup: setsToArrays(companiesByGroup),
    segments,
    regions,
    // Список компаний в стоп-листе ("нельзя включать в обзор") — сейчас нет ни
    // таблицы, ни админ-экрана для его ведения, поэтому пусто, а не выдумано.
    // openAddSheet() уже безусловно читает S.data.banned.filter(...), без этого
    // поля ввод 2+ символов в поле "Название компании" падал с TypeError.
    banned: [],
    // Фиксированные списки для формы шага 2 (зарплата/бонусы/источник) — той же
    // природы, что segments/regions выше: не БД-справочник, а константы, уже
    // зашитые в текст интерфейса и в дизайн-канву (SurveyForm.dc.html).
    benefits: ['Оплата питания / Обеды', 'Корпоративная мобильная связь', 'Медицинское страхование (ДМС)', 'Компенсация ГСМ / Транспорт', 'Обучение и тренинги за счет компании', 'Служебный автомобиль', 'Скидки на продукцию компании', 'Оплата жилья / Релокационный пакет', 'Фитнес / Спортзал'],
    // Тип/приоритет конкурента и всё остальное в ref — тот же фиксированный
    // список, что и segments/regions/benefits выше. Фронт (rowCard, openAddSheet,
    // openSurveySheet) безусловно читает эти поля при рендере каждой строки —
    // без них открытие подразделения с конкурентами или "+ Должность, которой
    // нет в списке" падает с TypeError, и экран выглядит просто пустым/нерабочим.
    // Это поле целиком выпало при переносе с Apps Script на Node/Express;
    // 24.08.2026 нашли и добавили types/priorities, но пропустили остальные
    // шесть — теперь добавлены все разом, по одному разу пройдясь по всем
    // вызовам ref.* и S.data.* во фронтенде.
    ref: {
      types: ['прямой', 'косвенный', 'потенциальный'],
      priorities: ['высокий', 'средний', 'низкий'],
      currencies: ['сомони', 'доллар США', 'рубль'],
      // ЧТС (часовая тарифная ставка) — у рабочих специальностей оклад
      // назначается за час, и пересчитывать его в месяц вручную значит
      // получить в базе цифру, которой нет ни в одном штатном расписании.
      payPeriods: ['в час (ЧТС)', 'в день', 'в месяц', 'в год'],
      // Тип переменной части отвечает на вопрос «за что», периодичность —
      // «как часто». Раньше это дублировалось: в типах уже были «Квартальная
      // премия» и «Годовой бонус», и рядом отдельно спрашивалась
      // периодичность — можно было выбрать «Квартальная премия / в год».
      bonusTypes: ['KPI / % от оклада', 'Премия за результат', 'Процент от маржи / продаж', 'Проектный бонус', '13-я зарплата', 'Фиксированная премия'],
      bonusPeriods: ['в месяц', 'в квартал', 'в полугодие', 'в год', 'разово'],
      sources: ['Рыночные данные C&B', 'Резюме соискателей', 'HR контакты', 'Интервью', 'Аналитика рынка', 'Опрос'],
      trust: ['высокая', 'средняя', 'низкая']
    }
  };
}

exports.login = async (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) {
    return res.status(400).json({ ok: false, error: 'Введите логин и пароль' });
  }

  try {
    const user = await queryOne("SELECT * FROM users WHERE LOWER(login) = LOWER(?) AND archived_at IS NULL", [login.trim()]);

    if (!user) {
      return res.status(401).json({ ok: false, error: 'Неверный логин или пароль' });
    }

    if (!user.active) {
      return res.status(403).json({ ok: false, error: 'Учетная запись заблокирована' });
    }

    if (!verifyPassword(password, user)) {
      return res.status(401).json({ ok: false, error: 'Неверный логин или пароль' });
    }

    const now = new Date().toISOString();
    await run('UPDATE users SET last_login_at = ? WHERE id = ?', [now, user.id]);
    await run('INSERT INTO audit_log (login, action, detail, ip) VALUES (?, ?, ?, ?)', [
      user.login,
      'вход',
      'Успешная авторизация',
      req.ip || ''
    ]);

    const token = makeToken(user);
    const data = await getUserPayload(user);

    res.json({
      ok: true,
      token,
      data
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ ok: false, error: 'Внутренняя ошибка сервера при входе' });
  }
};

exports.resume = async (req, res) => {
  try {
    const data = await getUserPayload(req.user);
    res.json({
      ok: true,
      token: makeToken(req.user),
      data
    });
  } catch (err) {
    console.error('Resume error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка обновления сессии' });
  }
};

exports.changePassword = async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ ok: false, error: 'Новый пароль должен содержать минимум 6 символов' });
  }

  try {
    const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);

    if (!verifyPassword(oldPassword, user)) {
      return res.status(400).json({ ok: false, error: 'Неверный текущий пароль' });
    }

    const newHash = hashPassword(newPassword);
    const now = new Date().toISOString();
    await run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [
      newHash,
      now,
      user.id
    ]);
    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      user.login,
      'смена пароля',
      'Пользователь изменил свой пароль'
    ]);

    res.json({ ok: true, message: 'Пароль успешно изменён' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка смены пароля' });
  }
};

exports.setUnits = async (req, res) => {
  const { units } = req.body;
  if (!Array.isArray(units) || !units.length) {
    return res.status(400).json({ ok: false, error: 'Выберите хотя бы одно подразделение' });
  }

  // Руководителям направлений и отделов подразделение назначает администратор
  // или вышестоящий руководитель — самим выбирать себе зону ответственности
  // нельзя. Проверка и на фронте (кнопка там не появляется), и здесь — эндпоинт
  // вызывается напрямую.
  if (req.user.role === 'dir_head' || req.user.role === 'head') {
    return res.status(403).json({
      ok: false,
      error: 'Подразделение для вашей роли назначает администратор. Обратитесь к нему.'
    });
  }

  try {
    const unitsStr = units.join('; ');
    await run('UPDATE users SET units = ? WHERE id = ?', [unitsStr, req.user.id]);

    const updatedUser = await queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const data = await getUserPayload(updatedUser);

    res.json({ ok: true, data });
  } catch (err) {
    console.error('Set units error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка выбора подразделения' });
  }
};
