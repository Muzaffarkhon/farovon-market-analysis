const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function hashPassword(pwd) {
  return crypto.createHash('sha256').update(String(pwd || '')).digest('hex');
}

function parseCsv(content) {
  const rows = [];
  let currentRow = [];
  let currentVal = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    const next = content[i + 1];

    if (c === '"') {
      if (inQuotes && next === '"') {
        currentVal += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      currentRow.push(currentVal);
      currentVal = '';
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && next === '\n') i++;
      currentRow.push(currentVal);
      if (currentRow.length > 0 && currentRow.some(x => x.trim() !== '')) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentVal = '';
    } else {
      currentVal += c;
    }
  }

  if (currentVal !== '' || currentRow.length > 0) {
    currentRow.push(currentVal);
    if (currentRow.some(x => x.trim() !== '')) {
      rows.push(currentRow);
    }
  }

  return rows;
}

const baseDir = path.resolve(__dirname, '..', '..');
const dataDir = path.join(baseDir, 'data');
console.log('Using dataDir:', dataDir);

// 1. Пароли и телефоны
const pwdFile = path.join(dataDir, '(Свод данных) Конкуренты по подразделениям ОБЩИЙ - Пароли (выдать).csv');
const pwdMap = {};
const phoneMap = {};
if (fs.existsSync(pwdFile)) {
  const pwdRows = parseCsv(fs.readFileSync(pwdFile, 'utf8'));
  for (let i = 1; i < pwdRows.length; i++) {
    const r = pwdRows[i];
    const log = (r[2] || '').trim().toLowerCase();
    if (log) {
      pwdMap[log] = (r[3] || '').trim();
      phoneMap[log] = (r[4] || '').trim();
    }
  }
}

// 2. Пользователи
const userFile = path.join(dataDir, '(Свод данных) Конкуренты по подразделениям ОБЩИЙ - Пользователи.csv');
const users = [];
const userMap = {};

// Гарантируем системных пользователей
const defaultAdmins = [
  { login: 'admin', raw_password: 'admin123', fio: 'Главный Администратор', role: 'admin', phone: '', units: '', active: 1 },
  { login: 'cb', raw_password: 'cb123', fio: 'C&B Аналитик', role: 'cb', phone: '', units: '', active: 1 }
];

defaultAdmins.forEach(u => {
  u.password_hash = hashPassword(u.raw_password);
  users.push(u);
  userMap[u.login.toLowerCase()] = u;
});

if (fs.existsSync(userFile)) {
  const uRows = parseCsv(fs.readFileSync(userFile, 'utf8'));
  for (let i = 1; i < uRows.length; i++) {
    const r = uRows[i];
    const login = (r[0] || '').trim();
    if (!login) continue;
    const norm = login.toLowerCase();
    if (userMap[norm]) continue;

    const rawPwd = pwdMap[norm] || '123456';
    const pwdHash = (r[1] || '').trim() || hashPassword(rawPwd);
    const fio = (r[2] || '').trim() || login;
    let role = (r[3] || 'user').trim().toLowerCase();
    if (role === 'guest') role = 'user';
    const units = (r[4] || '').trim();
    const active = r[5] === '0' || r[5] === 'false' || r[5] === 'нет' ? 0 : 1;
    const phone = phoneMap[norm] || '';

    const uObj = {
      login,
      password_hash: pwdHash,
      raw_password: rawPwd,
      fio,
      role,
      phone,
      units,
      active
    };
    users.push(uObj);
    userMap[norm] = uObj;
  }
}

// 3. Подразделения (326 строк)
const divFile = path.join(dataDir, '(Свод данных) Конкуренты по подразделениям ОБЩИЙ - Подразделения.csv');
const divisions = [];
if (fs.existsSync(divFile)) {
  const dRows = parseCsv(fs.readFileSync(divFile, 'utf8'));
  for (let i = 1; i < dRows.length; i++) {
    const r = dRows[i];
    const unit = (r[4] || '').trim();
    if (!unit) continue;
    divisions.push({
      num: parseInt(r[0], 10) || i,
      dir_id: (r[1] || '').trim(),
      dir: (r[2] || '').trim(),
      unit_id: (r[3] || '').trim(),
      unit: unit,
      level: parseInt(r[5], 10) || 1,
      head_id: (r[6] || '').trim(),
      head: (r[7] || '').trim(),
      resp_id: (r[8] || '').trim(),
      resp: (r[9] || '').trim(),
      hrbp_id: (r[10] || '').trim(),
      hrbp: (r[11] || '').trim(),
      cnt: parseInt(r[12], 10) || 0,
      note: (r[13] || '').trim()
    });
  }
}

// 4. Конкуренты (715 строк)
const compFile = path.join(dataDir, '(Свод данных) Конкуренты по подразделениям ОБЩИЙ - Конкуренты.csv');
const competitors = [];
const compDictSet = new Set();
if (fs.existsSync(compFile)) {
  const cRows = parseCsv(fs.readFileSync(compFile, 'utf8'));
  for (let i = 1; i < cRows.length; i++) {
    const r = cRows[i];
    const unit = (r[4] || '').trim();
    const company = (r[10] || '').trim();
    if (!unit || !company) continue;

    compDictSet.add(company);
    competitors.push({
      id: (r[21] || '').trim() || `comp_${i}`,
      dir: (r[2] || '').trim(),
      unit: unit,
      resp: (r[6] || '').trim(),
      hrbp: (r[8] || '').trim(),
      company: company,
      type: (r[11] || '').trim() || 'Отраслевой',
      segment: (r[12] || '').trim() || 'Общий',
      region: (r[13] || '').trim() || 'Вся страна',
      prio: (r[14] || '').trim() || 'Основной',
      status: (r[15] || '').trim() || 'подтверждено',
      src: (r[16] || '').trim() || 'база',
      note: (r[17] || '').trim(),
      actual: (r[18] || '').trim() || 'актуально',
      filled_by: (r[19] || '').trim(),
      filled_at: (r[20] || '').trim()
    });
  }
}

// 5. Справочники
const refFile = path.join(dataDir, '(Свод данных) Конкуренты по подразделениям ОБЩИЙ - Справочник.csv');
const segments = new Set();
const regions = new Set();
const defaultPositions = [
  'Руководитель отдела продаж', 'HR Business Partner (HR BP)', 'C&B Аналитик', 'Главный бухгалтер',
  'Бухгалтер', 'Ведущий юрисконсульт', 'Юрист', 'Инженер-технолог', 'Начальник производства',
  'Менеджер по закупкам', 'Менеджер по логистике', 'Бренд-менеджер', 'Торговый представитель',
  'Оператор 1C', 'Супервайзер', 'Водитель-экспедитор', 'Кладовщик'
];

if (fs.existsSync(refFile)) {
  const rRows = parseCsv(fs.readFileSync(refFile, 'utf8'));
  for (let i = 1; i < rRows.length; i++) {
    const r = rRows[i];
    const block = (r[0] || '').trim().toLowerCase();
    const val = (r[1] || '').trim();
    if (!val) continue;
    if (block.includes('сегмент')) segments.add(val);
    else if (block.includes('регион')) regions.add(val);
    else if (block.includes('должност')) defaultPositions.push(val);
    else if (block.includes('компан')) compDictSet.add(val);
  }
}

// 6. Базовые демо-анкеты для перцентильного анализа (если база свежая)
const surveys = [
  { id: 'sv_1', unit: '0201 Отдел оптовых продаж Худжанд', company: 'МегаФон Таджикистан', pos_our: 'Руководитель отдела продаж', pay_from: 14000, pay_to: 18000, cur: 'сомони', pay_per: 'в месяц', bon_has: 'да', bon_size: '20%', bon_type: 'Квартальная премия', bon_per: 'в квартал', benefits: 'Оплата питания / Обеды; Корпоративная мобильная связь; ДМС', source: 'Рыночные данные C&B', trust: 'высокая', state: 'активна' },
  { id: 'sv_2', unit: '0201 Отдел оптовых продаж Худжанд', company: 'Tcell', pos_our: 'Руководитель отдела продаж', pay_from: 15000, pay_to: 20000, cur: 'сомони', pay_per: 'в месяц', bon_has: 'да', bon_size: '25%', bon_type: 'KPI / Ежемесячный %', bon_per: 'в месяц', benefits: 'Оплата питания / Обеды; Корпоративная мобильная связь; Компенсация ГСМ', source: 'Резюме соискателей', trust: 'высокая', state: 'активна' },
  { id: 'sv_3', unit: '0201 Отдел оптовых продаж Худжанд', company: 'Алиф Банк', pos_our: 'Руководитель отдела продаж', pay_from: 16000, pay_to: 22000, cur: 'сомони', pay_per: 'в месяц', bon_has: 'да', bon_size: '30%', bon_type: 'Годовой бонус', bon_per: 'в год', benefits: 'Обучение за счет компании; ДМС; Корпоративная связь', source: 'HR контакты', trust: 'средняя', state: 'активна' },
  { id: 'sv_4', unit: '0201 Отдел оптовых продаж Худжанд', company: 'Оби Зулол', pos_our: 'Руководитель отдела продаж', pay_from: 12000, pay_to: 16000, cur: 'сомони', pay_per: 'в месяц', bon_has: 'да', bon_size: '15%', bon_type: 'KPI / Ежемесячный %', bon_per: 'в месяц', benefits: 'Питание; ГСМ / Транспорт', source: 'Интервью', trust: 'высокая', state: 'активна' },
  { id: 'sv_5', unit: '0101 Дирекция по персоналу', company: 'МегаФон Таджикистан', pos_our: 'HR Business Partner (HR BP)', pay_from: 10000, pay_to: 14000, cur: 'сомони', pay_per: 'в месяц', bon_has: 'да', bon_size: '20%', bon_type: 'Квартальная премия', bon_per: 'в квартал', benefits: 'ДМС; Связь; Обучение', source: 'Аналитика рынка', trust: 'высокая', state: 'активна' },
  { id: 'sv_6', unit: '0101 Дирекция по персоналу', company: 'Алиф Банк', pos_our: 'HR Business Partner (HR BP)', pay_from: 12000, pay_to: 16000, cur: 'сомони', pay_per: 'в месяц', bon_has: 'да', bon_size: '25%', bon_type: 'Годовой бонус', bon_per: 'в год', benefits: 'ДМС; Обучение; Питание', source: 'Опрос', trust: 'высокая', state: 'активна' },
  { id: 'sv_7', unit: '0102 Финансовая дирекция', company: 'Банк Эсхата', pos_our: 'Главный бухгалтер', pay_from: 11000, pay_to: 15000, cur: 'сомони', pay_per: 'в месяц', bon_has: 'нет', bon_size: '', bon_type: '', bon_per: '', benefits: 'ДМС; Питание', source: 'HeadHunter / Рекрутинг', trust: 'высокая', state: 'активна' },
  { id: 'sv_8', unit: '0102 Финансовая дирекция', company: 'Хумо', pos_our: 'Главный бухгалтер', pay_from: 12000, pay_to: 17000, cur: 'сомони', pay_per: 'в месяц', bon_has: 'да', bon_size: '15%', bon_type: 'Годовой бонус', bon_per: 'в год', benefits: 'ДМС; Мобильная связь', source: 'Интервью', trust: 'высокая', state: 'активна' }
];

const bundle = {
  version: '2.0.0',
  generated_at: new Date().toISOString(),
  period: {
    name: 'Обзор рынка 2026',
    state: 'открыт',
    from: '2026-08-01',
    to: '2026-08-31',
    updated_by: 'Система'
  },
  users,
  divisions,
  competitors,
  surveys,
  dictionaries: {
    companies: Array.from(compDictSet).filter(Boolean).sort(),
    positions: Array.from(new Set(defaultPositions)).filter(Boolean).sort(),
    segments: Array.from(segments).filter(Boolean).sort(),
    regions: Array.from(regions).filter(Boolean).sort(),
    benefits: [
      'Оплата питания / Обеды',
      'Корпоративная мобильная связь',
      'Медицинское страхование (ДМС)',
      'Компенсация ГСМ / Транспорт',
      'Обучение и тренинги за счет компании',
      'Служебный автомобиль',
      'Скидки на продукцию компании',
      'Оплата жилья / Релокационный пакет',
      'Фитнес / Спортзал'
    ],
    bonusTypes: [
      'KPI / Ежемесячный %',
      'Квартальная премия',
      'Полугодовой бонус',
      'Годовой бонус (13-я ЗП)',
      'Процент от маржи / продаж',
      'Проектный бонус'
    ]
  }
};

const outDir = path.join(__dirname, '../data');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'seedBundle.json');
fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2), 'utf8');

console.log('BUNDLE_SUCCESS: ' + outPath);
console.log(`users: ${bundle.users.length}, divs: ${bundle.divisions.length}, comps: ${bundle.competitors.length}`);
process.exit(0);
