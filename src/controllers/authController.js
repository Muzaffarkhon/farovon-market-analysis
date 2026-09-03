const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { queryAll, queryOne, run } = require('../db/database');
const { benefitsToList } = require('./surveyController');

// Приведение строки surveys к форме для фронта. Вынесено, чтобы одинаково
// маппить и анкеты пользователя, и анкеты смежной группы (для «заполнить раз
// на всю группу»).
function mapSurveyRow(s) {
  return {
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
    schedule: s.schedule || '',
    benefits: benefitsToList(s.benefits),
    note: s.note || '',
    source: s.source || '',
    trust: s.trust || '',
    by: s.created_by || '',
    at: s.created_at || ''
  };
}
const { CAPABILITIES } = require('../config/capabilities');

function hashPassword(pwd) {
  return bcrypt.hashSync(String(pwd || ''), 12);
}

// Требования к новому паролю (смена в профиле). Внутренний инструмент, но
// «123456» тоже быть не должно: минимум 8 символов, хотя бы одна буква и одна
// цифра. Возвращает текст ошибки либо null.
function passwordPolicyError(pwd) {
  const s = String(pwd || '');
  if (s.length < 8) return 'Пароль должен содержать минимум 8 символов';
  if (!/[A-Za-zА-Яа-я]/.test(s) || !/[0-9]/.test(s)) {
    return 'Пароль должен содержать хотя бы одну букву и одну цифру';
  }
  return null;
}

// Блокировка учётки при подборе пароля: после MAX_FAILED_LOGINS неудач подряд
// вход по паролю запрещается на LOCK_MINUTES минут. Счётчик обнуляется при
// первом успешном входе. Работает поверх общего rate-limit по IP
// (src/middleware/rateLimit.js) — тот бьёт по адресу, этот по конкретной учётке.
const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

const isBcryptHash = (h) => /^\$2[aby]\$/.test(String(h || ''));

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
    { expiresIn: config.jwtExpiresIn, algorithm: 'HS256' }
  );
}

// #22 — сессия дублируется в httpOnly-куку. В обычном браузере (одно
// происхождение) её хватает; фронт тогда не кладёт токен в localStorage.
const SESSION_COOKIE = 'farovon_session';
function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/'
  });
}
exports.logout = async (req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
};

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

  const withDirs = async (sql, fallbackSql) => {
    try {
      return await queryAll(sql);
    } catch (e) {
      return await queryAll(fallbackSql);
    }
  };

  const safeNames = async (table) => {
    try {
      const rows = await queryAll(`SELECT TRIM(name) AS v FROM ${table} WHERE TRIM(COALESCE(name,'')) <> ''`);
      return rows.map(r => r.v);
    } catch (e) {
      return [];
    }
  };

  // 1. Параллельный запуск всех базовых справочников и агрегатов в 1 сетевом раунде
  const [
    allUnits,
    compRows,
    survRows,
    dictCompanies,
    dictPositionsRows,
    segRows,
    regRows,
    customSegments,
    customRegions,
    period,
    roleCaps
  ] = await Promise.all([
    (async () => {
      try {
        return await queryAll("SELECT unit, dir, COALESCE(group_key,'') AS group_key, COALESCE(survey_note,'') AS survey_note FROM divisions ORDER BY num ASC, unit ASC");
      } catch (e) {
        try {
          return (await queryAll("SELECT unit, dir, COALESCE(group_key,'') AS group_key FROM divisions ORDER BY num ASC, unit ASC")).map(d => ({ ...d, survey_note: '' }));
        } catch (e2) {
          return (await queryAll('SELECT unit, dir FROM divisions ORDER BY num ASC, unit ASC')).map(d => ({ ...d, group_key: '', survey_note: '' }));
        }
      }
    })(),
    queryAll('SELECT unit, actual FROM competitors'),
    queryAll("SELECT unit FROM surveys WHERE state != 'удалена'"),
    withDirs(
      "SELECT name, segment, region, COALESCE(dirs, '') AS dirs FROM dictionary_companies ORDER BY name ASC",
      'SELECT name, segment, region FROM dictionary_companies ORDER BY name ASC'
    ),
    withDirs(
      "SELECT name, COALESCE(dirs, '') AS dirs FROM dictionary_positions ORDER BY name ASC",
      'SELECT name FROM dictionary_positions ORDER BY name ASC'
    ),
    queryAll(`SELECT DISTINCT TRIM(segment) AS v FROM dictionary_companies WHERE TRIM(COALESCE(segment,'')) <> ''
              UNION SELECT DISTINCT TRIM(segment) FROM competitors WHERE TRIM(COALESCE(segment,'')) <> '' ORDER BY v`),
    queryAll(`SELECT DISTINCT TRIM(region) AS v FROM dictionary_companies WHERE TRIM(COALESCE(region,'')) <> ''
              UNION SELECT DISTINCT TRIM(region) FROM competitors WHERE TRIM(COALESCE(region,'')) <> '' ORDER BY v`),
    safeNames('dictionary_segments'),
    safeNames('dictionary_regions'),
    getPeriodInfo(),
    (user.role === 'admin') ? Promise.resolve([]) : queryAll('SELECT capability FROM role_capabilities WHERE role = ?', [user.role]).catch(() => [])
  ]);

  // Подсчёт прогресса по доступным подразделениям (в памяти)
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
      surveys: survMap[d.unit] || 0,
      note: d.survey_note || ''
    }));
  } else {
    visibleUnits = allUnits.filter(d => unitsList.includes(d.unit)).map(d => ({
      unit: d.unit,
      dir: d.dir,
      group: d.group_key || '',
      total: (compMap[d.unit] || {}).total || 0,
      done: (compMap[d.unit] || {}).done || 0,
      ask: (compMap[d.unit] || {}).ask || 0,
      surveys: survMap[d.unit] || 0,
      note: d.survey_note || ''
    }));
  }

  const dictPositions = dictPositionsRows.map(x => x.name);

  const userDirs = [...new Set(visibleUnits.map(u => (u.dir || '').trim()).filter(Boolean))];
  const inDirs = (raw) => {
    const own = String(raw || '').split(';').map(s => s.trim()).filter(Boolean);
    if (!own.length) return false;
    return own.some(d => userDirs.includes(d));
  };
  const positionsByDir = dictPositionsRows.filter(p => inDirs(p.dirs)).map(p => p.name);

  // 2. Параллельный запуск штатного расписания, смежных групп и строк пользователя
  const myUnits = visibleUnits.map(x => x.unit);
  const myGroups = [...new Set(visibleUnits.map(x => x.group).filter(Boolean))];

  const positionsByUnit = {};
  const positionsByGroup = {};
  const companiesByGroup = {};
  const surveysByGroup = {}; // groupKey -> [строки анкет всех площадок группы] (для «заполнить раз на всю группу»)

  const userCompetitorsPromise = (myUnits.length > 0)
    ? queryAll(`SELECT * FROM competitors WHERE unit IN (${myUnits.map(() => '?').join(',')})`, myUnits)
    : Promise.resolve([]);

  const userSurveysPromise = (myUnits.length > 0)
    ? queryAll(`SELECT * FROM surveys WHERE unit IN (${myUnits.map(() => '?').join(',')}) AND state != 'удалена'`, myUnits)
    : Promise.resolve([]);

  const staffingPromise = (async () => {
    if (!myUnits.length) return;
    try {
      const rows = myUnits.length > 200
        ? await queryAll('SELECT unit, position FROM unit_positions ORDER BY position ASC')
        : await queryAll(`SELECT unit, position FROM unit_positions WHERE unit IN (${myUnits.map(() => '?').join(',')}) ORDER BY position ASC`, myUnits);
      const allowed = new Set(myUnits);
      rows.forEach(r => {
        if (!allowed.has(r.unit)) return;
        if (!positionsByUnit[r.unit]) positionsByUnit[r.unit] = [];
        positionsByUnit[r.unit].push(r.position);
      });
    } catch (e) {}
  })();

  const groupsPromise = (async () => {
    if (!myGroups.length) return;
    try {
      const ph = myGroups.map(() => '?').join(',');
      const groupDivs = await queryAll(`SELECT unit, group_key FROM divisions WHERE group_key IN (${ph})`, myGroups);
      const unitsInGroup = groupDivs.map(d => d.unit);
      const unitToGroup = {};
      groupDivs.forEach(d => { unitToGroup[d.unit] = d.group_key; });

      if (unitsInGroup.length) {
        const up = unitsInGroup.map(() => '?').join(',');
        const [posRows, compRowsGroup, survRowsGroup] = await Promise.all([
          queryAll(`SELECT unit, position FROM unit_positions WHERE unit IN (${up})`, unitsInGroup),
          queryAll(`SELECT unit, company FROM competitors WHERE unit IN (${up})`, unitsInGroup),
          queryAll(`SELECT * FROM surveys WHERE unit IN (${up}) AND state != 'удалена'`, unitsInGroup)
        ]);

        posRows.forEach(r => {
          const g = unitToGroup[r.unit];
          if (!g) return;
          if (!positionsByGroup[g]) positionsByGroup[g] = new Set();
          positionsByGroup[g].add(r.position);
        });

        compRowsGroup.forEach(r => {
          const g = unitToGroup[r.unit];
          if (!g) return;
          if (!companiesByGroup[g]) companiesByGroup[g] = new Set();
          companiesByGroup[g].add(r.company);
        });

        survRowsGroup.forEach(r => {
          const g = unitToGroup[r.unit];
          if (!g) return;
          if (!surveysByGroup[g]) surveysByGroup[g] = [];
          surveysByGroup[g].push(mapSurveyRow(r));
        });
      }
    } catch (e) {}
  })();

  const [userCompetitors, userSurveys] = await Promise.all([
    userCompetitorsPromise,
    userSurveysPromise,
    staffingPromise,
    groupsPromise
  ]);

  const setsToArrays = (obj) => {
    const out = {};
    Object.keys(obj).forEach(k => { out[k] = [...obj[k]].sort((a, b) => a.localeCompare(b, 'ru')); });
    return out;
  };

  const uniqSorted = (a, b) => [...new Set([...a, ...b])].sort((x, y) => x.localeCompare(y, 'ru'));
  const segments = uniqSorted(segRows.map(x => x.v), customSegments);
  const regions = uniqSorted(regRows.map(x => x.v), customRegions);

  const selfAssignRoles = ['dir_head', 'head'];
  const canSelfPick = !selfAssignRoles.includes(user.role);

  let capabilities = [];
  if (user.role === 'admin') {
    capabilities = CAPABILITIES.map(c => c.id);
  } else {
    capabilities = (roleCaps || []).map(r => r.capability);
  }

  return {
    user: {
      login: user.login,
      fio: user.fio,
      role: user.role,
      phone: user.phone || '',
      hasTelegram: !!user.telegram_chat_id,
      // Прошёл обучающий тур (серверная отметка вместо localStorage) — фронт
      // не показывает ни подсказку-карточку, ни авто-старт тура, если true.
      onboarded: !!user.onboarded_at,
      // Сырой список назначенных подразделений (не обогащённый прогрессом) —
      // нужен фронту dir_head, чтобы понять, каким направлением он управляет,
      // и построить экран «Назначить ответственных» по его отделам.
      units: unitsList,
      capabilities
    },
    period,
    mustChangePassword: !!user.must_change_password,
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
    // benefits приводятся к массиву (фронт держит льготы списком и зовёт .map);
    // by/at нужны svCard() для подписи «кто и когда внёс». См. mapSurveyRow.
    surveys: userSurveys.map(mapSurveyRow),
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
    surveysByGroup,
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
    benefits: [
      'Оплата питания / Обеды', 'Корпоративная мобильная связь', 'Медицинское страхование (ДМС)',
      'Страхование жизни / от несчастных случаев', 'Компенсация ГСМ / Топливо', 'Служебный автомобиль',
      'Корпоративный транспорт / развозка', 'Компенсация такси', 'Оплата жилья / Релокационный пакет',
      'Служебное жильё / общежитие', 'Парковочное место', 'Обучение и тренинги за счет компании',
      'Оплата профессиональных сертификаций', 'Изучение языков за счет компании',
      'Санаторно-курортное лечение', 'Фитнес / Спортзал', 'Скидки на продукцию компании',
      'Продукты / товары компании (бесплатно)', 'Беспроцентный заём / рассрочка',
      'Материальная помощь (свадьба, рождение, похороны)', 'Корпоративные мероприятия / тимбилдинги',
      'Подарки детям сотрудников к праздникам', 'Дополнительный оплачиваемый отпуск',
      'Компенсация представительских расходов', 'Оплата детского сада / школы'
    ],
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
      // График работы: раньше было свободное поле — расходились написания
      // одного и того же («6/1 54ч» / «6/1 · 54 часа»). Теперь выбор из чипов.
      schedules: ['5/2 · 40 часов', '5/2 · 45 часов', '6/1 · 48 часов', '6/1 · 50 часов', '6/1 · 54 часа', 'Сменный 2/2', 'Вахтовый', 'Свободный / гибкий'],
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
  const rawLogin = req.body && req.body.login;
  const rawPass = req.body && req.body.password;
  if (rawLogin === undefined || rawLogin === null || rawPass === undefined || rawPass === null) {
    return res.status(400).json({ ok: false, error: 'Введите логин и пароль' });
  }

  const login = String(rawLogin).trim();
  const password = String(rawPass);
  if (!login || !password) {
    return res.status(400).json({ ok: false, error: 'Введите логин и пароль' });
  }

  try {
    const user = await queryOne("SELECT * FROM users WHERE LOWER(login) = LOWER(?) AND archived_at IS NULL", [login]);

    if (!user) {
      return res.status(401).json({ ok: false, error: 'Неверный логин или пароль' });
    }

    if (!user.active) {
      return res.status(403).json({ ok: false, error: 'Учетная запись заблокирована' });
    }

    const now = new Date().toISOString();

    // Учётка временно заблокирована после серии неудачных попыток?
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const mins = Math.max(1, Math.ceil((new Date(user.locked_until) - new Date()) / 60000));
      await run('INSERT INTO audit_log (login, action, detail, ip) VALUES (?, ?, ?, ?)', [
        user.login, 'вход отклонён', `Учётка заблокирована ещё ${mins} мин (подбор пароля)`, req.ip || ''
      ]);
      return res.status(429).json({
        ok: false,
        error: `Слишком много неудачных попыток. Вход в эту учётную запись временно заблокирован (~${mins} мин).`
      });
    }

    if (!verifyPassword(password, user)) {
      const failed = (user.failed_login_count || 0) + 1;
      if (failed >= MAX_FAILED_LOGINS) {
        const lockUntil = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
        await run('UPDATE users SET failed_login_count = 0, locked_until = ? WHERE id = ?', [lockUntil, user.id]);
        await run('INSERT INTO audit_log (login, action, detail, ip) VALUES (?, ?, ?, ?)', [
          user.login, 'учётка заблокирована', `${MAX_FAILED_LOGINS} неудачных входов подряд, блок на ${LOCK_MINUTES} мин`, req.ip || ''
        ]);
        return res.status(429).json({
          ok: false,
          error: `Слишком много неудачных попыток. Вход в эту учётную запись заблокирован на ${LOCK_MINUTES} минут.`
        });
      }
      await run('UPDATE users SET failed_login_count = ? WHERE id = ?', [failed, user.id]);
      return res.status(401).json({ ok: false, error: 'Неверный логин или пароль' });
    }

    // Успешный вход: снимаем счётчик/блок, если были.
    if (user.failed_login_count || user.locked_until) {
      await run('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?', [user.id]);
    }

    // Разовая миграция старых несолёных SHA-256-хэшей на bcrypt — прозрачно,
    // при первом же входе с верным паролем. Ветка SHA в verifyPassword
    // останется, пока по журналу не убедимся, что таких хэшей не осталось.
    if (!isBcryptHash(user.password_hash)) {
      try {
        await run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [hashPassword(password), now, user.id]);
        await run('INSERT INTO audit_log (login, action, detail, ip) VALUES (?, ?, ?, ?)', [
          user.login, 'миграция пароля', 'Хэш пароля переведён с SHA-256 на bcrypt при входе', req.ip || ''
        ]);
      } catch (e) {
        console.error('Password rehash error:', e.message);
      }
    }

    await run('UPDATE users SET last_login_at = ? WHERE id = ?', [now, user.id]);
    await run('INSERT INTO audit_log (login, action, detail, ip) VALUES (?, ?, ?, ?)', [
      user.login,
      'вход',
      'Успешная авторизация',
      req.ip || ''
    ]);

    const token = makeToken(user);
    setSessionCookie(res, token);
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
    const token = makeToken(req.user);
    setSessionCookie(res, token);
    res.json({
      ok: true,
      token,
      data
    });
  } catch (err) {
    console.error('Resume error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка обновления сессии' });
  }
};

// Пользователь прошёл (или закрыл) обучающий тур. Идемпотентно: пишем время
// только если отметки ещё не было, повторные вызовы ничего не меняют. Снять
// отметку через API нельзя — тур повторно запускается вручную («Помощь» →
// «Пройти обучение»), навязывать его снова не нужно.
exports.markOnboarded = async (req, res) => {
  try {
    await run(
      'UPDATE users SET onboarded_at = ? WHERE id = ? AND onboarded_at IS NULL',
      [new Date().toISOString(), req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('markOnboarded error:', err);
    res.status(500).json({ ok: false, error: 'Не удалось сохранить отметку об обучении' });
  }
};

exports.changePassword = async (req, res) => {
  const rawOld = req.body && req.body.oldPassword;
  const rawNew = req.body && req.body.newPassword;
  const oldPassword = String(rawOld || '');
  const newPassword = String(rawNew || '').trim();
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ ok: false, error: 'Введите текущий и новый пароль' });
  }
  const policyErr = passwordPolicyError(newPassword);
  if (policyErr) {
    return res.status(400).json({ ok: false, error: policyErr });
  }

  try {
    const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);

    if (!verifyPassword(oldPassword, user)) {
      return res.status(400).json({ ok: false, error: 'Неверный текущий пароль' });
    }

    const newHash = hashPassword(newPassword);
    const now = new Date().toISOString();
    await run('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?', [
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
  const units = req.body && req.body.units;
  if (!Array.isArray(units) || !units.length) {
    return res.status(400).json({ ok: false, error: 'Выберите хотя бы одно подразделение' });
  }

  const cleanedUnits = units.map(u => String(u || '').trim()).filter(Boolean);
  if (!cleanedUnits.length) {
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
    const unitsStr = cleanedUnits.join('; ');
    await run('UPDATE users SET units = ? WHERE id = ?', [unitsStr, req.user.id]);

    const updatedUser = await queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const data = await getUserPayload(updatedUser);

    res.json({ ok: true, data });
  } catch (err) {
    console.error('Set units error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка выбора подразделения' });
  }
};
