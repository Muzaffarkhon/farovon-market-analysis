const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const config = require('../config');

function getAppVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
    return pkg.version || '2.5.0';
  } catch (e) {
    return '2.5.0';
  }
}
const { queryAll, queryOne, run } = require('../db/database');
const { cached, invalidate } = require('../services/refCache');
const { getActivePeriod } = require('../services/periodService');
const { isHiddenCompany } = require('../services/companyFilter');
const { mapSurveyRow } = require('./surveyController');
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

// Абсолютный потолок жизни сессии. Скользящее окно (/auth/resume каждые ~3 ч
// выдаёт новый 7-дневный токен) удобно, но без потолка украденный токен можно
// продлевать бесконечно. `sess` — момент первого входа, переносится из токена
// в токен при обновлении; старше SESSION_MAX_AGE_MS — resume отказывает,
// нужен повторный вход по паролю.
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней

function makeToken(user, sessionStart) {
  return jwt.sign(
    {
      id: user.id, login: user.login, role: user.role, fio: user.fio,
      sess: sessionStart || Date.now()
    },
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
  const p = await getActivePeriod();
  return p ? {
    id: p.id,
    name: p.name,
    state: p.state,
    from: p.from_date || '',
    to: p.to_date || '',
    by: p.updated_by || '',
    at: p.updated_at || ''
  } : { id: null, name: 'Обзор рынка', state: 'открыт' };
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

  // 1. Параллельный запуск всех базовых справочников и агрегатов в 1 сетевом раунде.
  //    Справочные (не пользовательские) наборы идут через refCache — короткий TTL
  //    + сброс при правках через админку, чтобы не бить в Turso на каждый
  //    вход/resume. compRows/survRows не кэшируем: это данные пользователя,
  //    меняются постоянно и должны отражаться сразу.
  const period = await cached('period', () => getPeriodInfo(), 30 * 1000);

  const myPeriodGrantsRaw = await queryAll(
    `SELECT g.period_id AS "periodId", p.name AS "periodName", g.expires_at AS "expiresAt"
     FROM period_edit_grants g JOIN periods p ON p.id = g.period_id
     WHERE g.user_login = ? AND g.expires_at > CURRENT_TIMESTAMP`,
    [user.login]
  );

  const [
    allUnits,
    compRows,
    survRows,
    selRows,
    dictCompanies,
    dictPositionsRows,
    segRows,
    regRows,
    customSegments,
    customRegions,
    roleCaps
  ] = await Promise.all([
    cached('divisions', async () => {
      try {
        return await queryAll("SELECT unit, dir, COALESCE(group_key,'') AS group_key, COALESCE(survey_note,'') AS survey_note, COALESCE(resp,'') AS resp, COALESCE(head,'') AS head FROM divisions ORDER BY num ASC, unit ASC");
      } catch (e) {
        try {
          return (await queryAll("SELECT unit, dir, COALESCE(group_key,'') AS group_key, COALESCE(resp,'') AS resp, COALESCE(head,'') AS head FROM divisions ORDER BY num ASC, unit ASC")).map(d => ({ ...d, survey_note: '' }));
        } catch (e2) {
          return (await queryAll('SELECT unit, dir FROM divisions ORDER BY num ASC, unit ASC')).map(d => ({ ...d, group_key: '', survey_note: '', resp: '', head: '' }));
        }
      }
    }),
    queryAll('SELECT unit, company, actual FROM competitors'),
    queryAll("SELECT unit, pos_our, company, pay_from, pay_to FROM surveys WHERE state != 'удалена' AND period_id = ?", [period.id]),
    // Position-first Шаг 1: выбор компаний по должности (заменяет прежний
    // унитарный на весь unit флаг competitors.actual) — источник прогресса
    // «проверено/на уточнении» ниже.
    queryAll('SELECT unit, pos_our, company FROM position_company_selections WHERE period_id = ?', [period.id]),
    cached('dictCompanies', () => withDirs(
      "SELECT name, segment, region, COALESCE(dirs, '') AS dirs FROM dictionary_companies ORDER BY name ASC",
      'SELECT name, segment, region FROM dictionary_companies ORDER BY name ASC'
    )),
    cached('dictPositions', () => withDirs(
      "SELECT name, COALESCE(dirs, '') AS dirs FROM dictionary_positions ORDER BY name ASC",
      'SELECT name FROM dictionary_positions ORDER BY name ASC'
    )),
    cached('segments', () => queryAll(`SELECT DISTINCT TRIM(segment) AS v FROM dictionary_companies WHERE TRIM(COALESCE(segment,'')) <> ''
              UNION SELECT DISTINCT TRIM(segment) FROM competitors WHERE TRIM(COALESCE(segment,'')) <> '' ORDER BY v`)),
    cached('regions', () => queryAll(`SELECT DISTINCT TRIM(region) AS v FROM dictionary_companies WHERE TRIM(COALESCE(region,'')) <> ''
              UNION SELECT DISTINCT TRIM(region) FROM competitors WHERE TRIM(COALESCE(region,'')) <> '' ORDER BY v`)),
    cached('customSegments', () => safeNames('dictionary_segments')),
    cached('customRegions', () => safeNames('dictionary_regions')),
    (user.role === 'admin')
      ? Promise.resolve([])
      : cached('roleCaps:' + user.role, () => queryAll('SELECT capability FROM role_capabilities WHERE role = ?', [user.role]).catch(() => []))
  ]);

  // ООО / ҶДММ исключены из обзора рынка — фильтруем на выдаче (см.
  // services/companyFilter). Дальше по коду используем только compRowsShown.
  const compRowsShown = compRows.filter(c => !isHiddenCompany(c.company));

  // Подсчёт прогресса по доступным подразделениям (в памяти). Position-first
  // Шаг 1: «total» — сколько пар «должность × компания» отмечено релевантными
  // для сравнения (position_company_selections), «done» — сколько из них уже
  // закрыто реальными данными по рынку (surveys с окладом). Унитарный флаг
  // «уточнить» (competitors.actual) упразднён — «ask» оставлен нулём ради
  // обратной совместимости формы ответа, фронт его больше не показывает.
  const normPos = (v) => String(v == null ? '' : v).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  const filledSurveyKeys = new Set();
  survRows.forEach(s => {
    if (Number(s.pay_from) > 0 || Number(s.pay_to) > 0) {
      filledSurveyKeys.add(`${s.unit}|${normPos(s.pos_our)}|${normPos(s.company)}`);
    }
  });
  const selRowsShown = selRows.filter(c => !isHiddenCompany(c.company));
  const compMap = {};
  selRowsShown.forEach(c => {
    if (!compMap[c.unit]) compMap[c.unit] = { total: 0, done: 0, ask: 0 };
    compMap[c.unit].total++;
    if (filledSurveyKeys.has(`${c.unit}|${normPos(c.pos_our)}|${normPos(c.company)}`)) compMap[c.unit].done++;
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

  // Уникальные компании по видимым подразделениям. Одна компания-конкурент
  // привязана к десяткам отделов («Далерон» — к 130), поэтому построчная сумма
  // total/done/ask по отделам раздувается (до 3632 связок при ~194 компаниях).
  // Для плашек «участники рынка проверены / на уточнении» нужен счёт уникальных
  // company: «проверено» — все связи компании актуально/не актуально; «на
  // уточнении» — хоть одна связь в статусе «уточнить».
  const visibleUnitSet = new Set(visibleUnits.map(u => u.unit));
  const compByName = new Map();
  selRowsShown.forEach(c => {
    if (!visibleUnitSet.has(c.unit)) return;
    const name = String(c.company || '').trim().toLowerCase();
    if (!name) return;
    let e = compByName.get(name);
    if (!e) { e = { anyDone: false }; compByName.set(name, e); }
    if (filledSurveyKeys.has(`${c.unit}|${normPos(c.pos_our)}|${normPos(c.company)}`)) e.anyDone = true;
  });
  let marketCompaniesDone = 0;
  const marketAskCompanies = 0;
  compByName.forEach(e => {
    if (e.anyDone) marketCompaniesDone++;
  });
  const marketCompanies = compByName.size;

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
    ? queryAll(`SELECT * FROM surveys WHERE unit IN (${myUnits.map(() => '?').join(',')}) AND state != 'удалена' AND period_id = ?`, [...myUnits, period.id])
    : Promise.resolve([]);

  const staffingPromise = (async () => {
    if (!myUnits.length) return;
    try {
      // >200 подразделений (admin / cb) — читается вся таблица штатки на каждый
      // вход/resume; она меняется только «Загрузкой штатного расписания», поэтому
      // полный вариант кэшируем. Узкий срез по своим unit'ам — как было.
      const rows = myUnits.length > 200
        ? await cached('staffingAll', () => queryAll('SELECT unit, position FROM unit_positions ORDER BY position ASC'))
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
          queryAll(`SELECT * FROM surveys WHERE unit IN (${up}) AND state != 'удалена' AND period_id = ?`, [...unitsInGroup, period.id])
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
          if (isHiddenCompany(r.company)) return; // ООО / ҶДММ — вне обзора
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
    // Раньше сюда шли только права роли: личные надбавки работали на сервере,
    // но в меню не появлялись, а личные отключения меню бы не убирали.
    // Не кэшируется — это персональные данные сотрудника, запрос крошечный.
    const personal = await queryAll(
      "SELECT capability, COALESCE(effect, 'grant') AS effect FROM user_capabilities WHERE user_login = ?",
      [user.login]
    ).catch(() => []);
    const set = new Set((roleCaps || []).map(r => r.capability));
    personal.forEach(p => { if (p.effect === 'deny') set.delete(p.capability); else set.add(p.capability); });
    capabilities = [...set];
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
    appVersion: getAppVersion(),
    period,
    myPeriodGrants: myPeriodGrantsRaw,
    mustChangePassword: !!user.must_change_password,
    needsUnitPick: unitsList.length === 0 && user.role !== 'admin' && user.role !== 'cb' && canSelfPick,
    needsAssignment: unitsList.length === 0 && selfAssignRoles.includes(user.role),
    units: visibleUnits,
    // Уникальные компании по видимым подразделениям — вместо суммы построчных
    // total/done/ask по отделам (одна компания висит на десятках подразделений).
    marketCompanies,
    marketCompaniesDone,
    marketAskCompanies,
    allUnits: allUnits,
    rows: userCompetitors.filter(c => !isHiddenCompany(c.company)).map(c => ({
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
    // Льготы разложены по разделам: форма шага 2 рендерит сгруппированные чипы
    // (заголовок + чипы под ним). В таблицу surveys по-прежнему уходит плоский
    // список выбранных строк (benefitsToList), структура — только для показа.
    benefits: [
      { category: 'Питание и связь', items: [
        'Оплата питания / Обеды', 'Корпоративная мобильная связь'
      ] },
      { category: 'Здоровье и страхование', items: [
        'Медицинское страхование (ДМС)', 'Страхование жизни / от несчастных случаев',
        'Санаторно-курортное лечение', 'Фитнес / Спортзал'
      ] },
      { category: 'Транспорт', items: [
        'Компенсация ГСМ / Топливо', 'Служебный автомобиль', 'Корпоративный транспорт / развозка',
        'Компенсация такси', 'Парковочное место'
      ] },
      { category: 'Жильё и переезд', items: [
        'Оплата жилья / Релокационный пакет', 'Служебное жильё / общежитие'
      ] },
      { category: 'Обучение и развитие', items: [
        'Обучение и тренинги за счет компании', 'Оплата профессиональных сертификаций',
        'Изучение языков за счет компании'
      ] },
      { category: 'Финансовая помощь', items: [
        'Беспроцентный заём / рассрочка', 'Материальная помощь (свадьба, рождение, похороны)',
        'Компенсация представительских расходов'
      ] },
      { category: 'Скидки и товары', items: [
        'Скидки на продукцию компании', 'Продукты / товары компании (бесплатно)'
      ] },
      { category: 'Семья и отдых', items: [
        'Корпоративные мероприятия / тимбилдинги', 'Подарки детям сотрудников к праздникам',
        'Дополнительный оплачиваемый отпуск', 'Оплата детского сада / школы'
      ] }
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
    // Абсолютный потолок: сессию, начатую более SESSION_MAX_AGE_MS назад,
    // не продлеваем — нужен повторный вход по паролю. Токены, выпущенные до
    // ввода клейма `sess` (старая версия), потолка не имеют и получают свежий
    // `sess` при первом resume — де-факто отсчёт для них стартует с этого
    // момента (одноразовая миграция, не лазейка: JWT всё равно живёт ≤7 дней).
    const sessStart = Number(req.tokenClaims && req.tokenClaims.sess) || 0;
    if (sessStart && Date.now() - sessStart > SESSION_MAX_AGE_MS) {
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      return res.status(401).json({
        ok: false, error: 'SESSION_EXPIRED',
        message: 'Сессия истекла — войдите заново'
      });
    }

    const data = await getUserPayload(req.user);
    const token = makeToken(req.user, sessStart || Date.now());
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

/**
 * Смена собственного ФИО. ФИО в этой схеме продублировано строкой во многих
 * местах (divisions.head/resp/hrbp, competitors.resp/hrbp/updated_by,
 * surveys.created_by, periods.updated_by) и служит ключом сопоставления
 * пользователя с оргструктурой — поэтому меняем его сразу везде, одной
 * операцией, и запрещаем коллизию с ФИО другого активного пользователя.
 */
exports.changeName = async (req, res) => {
  const newFio = String((req.body && req.body.fio) || '').replace(/\s+/g, ' ').trim();
  if (newFio.length < 3 || newFio.length > 120 || !/[A-Za-zА-Яа-яЁёҒғӢӣҚқҲҳҶҷӮ]/.test(newFio)) {
    return res.status(400).json({ ok: false, error: 'Введите корректное ФИО (3–120 символов)' });
  }

  try {
    const me = await queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!me) return res.status(404).json({ ok: false, error: 'Пользователь не найден' });

    const oldFio = String(me.fio || '').trim();
    const sessStart = Number(req.tokenClaims && req.tokenClaims.sess) || Date.now();

    if (newFio === oldFio) {
      return res.json({ ok: true, message: 'ФИО без изменений', data: await getUserPayload(me) });
    }

    const clash = await queryOne(
      'SELECT 1 FROM users WHERE id <> ? AND archived_at IS NULL AND LOWER(TRIM(fio)) = LOWER(?)',
      [me.id, newFio]
    );
    if (clash) {
      return res.status(409).json({ ok: false, error: 'Пользователь с таким ФИО уже есть' });
    }

    // Колонки, где ФИО лежит строкой. Часть из них — списки через запятую
    // (competitors.resp = «Иванов И., Петров П.»), поэтому правим поэлементно:
    // подстроку внутри чужого имени не трогаем.
    const NAME_COLS = [
      ['divisions', 'head'], ['divisions', 'resp'], ['divisions', 'hrbp'],
      ['competitors', 'resp'], ['competitors', 'hrbp'], ['competitors', 'updated_by'],
      ['surveys', 'created_by'], ['periods', 'updated_by'],
    ];
    let refs = 0;
    for (const [table, col] of NAME_COLS) {
      let rows;
      try {
        rows = await queryAll(`SELECT DISTINCT ${col} AS v FROM ${table} WHERE ${col} LIKE ?`, ['%' + oldFio + '%']);
      } catch (e) {
        continue; // колонки может не быть в старой схеме
      }
      for (const r of rows) {
        const parts = String(r.v || '').split(',').map(s => s.trim());
        if (!parts.includes(oldFio)) continue;
        const next = parts.map(p => (p === oldFio ? newFio : p)).join(', ');
        if (next === r.v) continue;
        const upd = await run(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`, [next, r.v]);
        refs += upd.rowsAffected || 0;
      }
    }

    await run('UPDATE users SET fio = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newFio, me.id]);
    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      me.login, 'смена ФИО', `«${oldFio}» → «${newFio}» (обновлено ссылок: ${refs})`
    ]);
    invalidate(); // сброс кэша оргструктуры — иначе у других стой фио до TTL

    const fresh = await queryOne('SELECT * FROM users WHERE id = ?', [me.id]);
    const token = makeToken(fresh, sessStart);
    setSessionCookie(res, token);
    res.json({ ok: true, message: 'ФИО обновлено', token, data: await getUserPayload(fresh) });
  } catch (err) {
    console.error('changeName error:', err);
    res.status(500).json({ ok: false, error: 'Не удалось изменить ФИО' });
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

// Экспортируется для юнит-тестов (test/).
exports.passwordPolicyError = passwordPolicyError;
exports.verifyPassword = verifyPassword;
