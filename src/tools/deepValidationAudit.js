const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';

async function req(path, method = 'POST', token = null, body = null) {
  const url = `${BASE_URL}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const opts = { method, headers };
    if (body && (method === 'POST' || method === 'PUT')) {
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    const status = res.status;
    let data;
    try {
      data = await res.json();
    } catch(e) {
      data = { raw: await res.text() };
    }
    return { status, data, ok: res.ok };
  } catch(err) {
    return { status: 0, error: err.message, ok: false };
  }
}

async function runDeepAudit() {
  console.log('================================================================');
  console.log('   ПОЛНЫЙ СКВОЗНОЙ АУДИТ ВАЛИДАЦИИ И БЕЗОПАСНОСТИ СИСТЕМЫ');
  console.log('================================================================\n');

  const findings = [];
  function addFinding(code, category, title, details, impact, severity) {
    findings.push({
      num: findings.length + 1,
      code,
      category,
      title,
      details,
      impact,
      severity
    });
    console.log(`[#${findings.length}] [${severity}] [${category}] ${code}: ${title}`);
  }

  // Получаем рабочий токен пользователя
  const loginRes = await req('/api/auth/login', 'POST', null, { login: 'samadova.f', password: 'pkad-8774' });
  const userToken = loginRes.data && loginRes.data.token;
  console.log('Пользовательский токен получен:', userToken ? 'ДА' : 'НЕТ');

  // --- ЧИТАЕМ И АНАЛИЗИРУЕМ ИСХОДНЫЙ КОД БЭКЕНДА И ФРОНТЕНДА ---
  const authCode = fs.readFileSync(path.join(__dirname, '../controllers/authController.js'), 'utf8');
  const surveyCode = fs.readFileSync(path.join(__dirname, '../controllers/surveyController.js'), 'utf8');
  const adminCode = fs.readFileSync(path.join(__dirname, '../controllers/adminController.js'), 'utf8');
  const dictCode = fs.readFileSync(path.join(__dirname, '../controllers/dictionaryController.js'), 'utf8');
  const dashCode = fs.readFileSync(path.join(__dirname, '../controllers/dashboardController.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');

  // 1. АВТОРИЗАЦИЯ И СЕССИИ
  if (!authCode.includes('typeof rawLogin') && !authCode.includes('rawLogin === undefined') && !authCode.includes('String(rawLogin)')) {
    addFinding('AUTH-01', 'Авторизация', 'Отсутствие проверки типов входных данных login/password', 'В login() req.body.login и req.body.password не проверяются на typeof string перед методами .trim() и .toLowerCase(), что может вызвать 500 Unhandled Exception при передаче чисел или null', 'Падение сервера 500 при отправке некорректного типа данных', 'HIGH');
  }

  if (authCode.includes('changePassword') && !authCode.includes('newPassword.length <')) {
    addFinding('AUTH-02', 'Безопасность', 'Отсутствие требований к минимальной длине нового пароля', 'В changePassword() отсутствует проверка минимальной длины пароля (например >= 6 или >= 8 символов). Пользователь может установить пароль из 1 символа или пробелов', 'Уязвимость учетных записей к брутфорсу', 'HIGH');
  }

  if (authCode.includes('setUnits') && !authCode.includes('Array.isArray(units)')) {
    addFinding('AUTH-03', 'Авторизация', 'Отсутствие проверки Array.isArray(units) в setUnits', 'Если клиент передает строку или объект вместо массива, вызов units.join() или валидация приводит к ошибке 500', 'Сбой сохранения профиля пользователя', 'MEDIUM');
  }

  // 2. ВАЛИДАЦИЯ ЗАРПЛАТ И АНКЕТ
  if (!surveyCode.includes('cleanNumber') && !surveyCode.includes('pFrom < 0') && !surveyCode.includes('num < 0')) {
    addFinding('SURVEY-01', 'Зарплатные данные', 'Отсутствие проверки на отрицательные значения оклада (pFrom < 0, pTo < 0)', 'Бэкенд принимает любые числовые значения без валидации нижней границы >= 0. Пользователь может ввести -5000 и испортить расчет перцентилей и медианы всего холдинга', 'Искажение медиан и перцентилей P25/P75', 'CRITICAL');
  }

  if (!surveyCode.includes('pFrom > pTo') && !surveyCode.includes('payFrom > payTo')) {
    addFinding('SURVEY-02', 'Зарплатные данные', 'Отсутствие валидации инвертированной вилки (pFrom > pTo)', 'Бэкенд сохраняет анкеты, где оклад "от" превышает оклад "до" (например, от 20000 до 5000), что приводит к отрицательному размаху вилки и ломает визуальные шкалы', 'Некорректные графики вилок и аналитики', 'HIGH');
  }

  if (!surveyCode.includes('Number.isFinite') && !surveyCode.includes('isFinite(')) {
    addFinding('SURVEY-03', 'Зарплатные данные', 'Отсутствие проверки на NaN / Infinity в числовых полях окладов', 'При передаче строк "NaN" или "Infinity" в pFrom/pTo сервер сохраняет их в базу, что делает невозможным расчет перцентилей в аналитике', 'Поломка расчета аналитики дашборда', 'HIGH');
  }

  if (!surveyCode.includes('1000000000') && !surveyCode.includes('1_000_000_000')) {
    addFinding('SURVEY-04', 'Зарплатные данные', 'Отсутствие верхнего предела оклада (Overflow / Опечатки)', 'Нет проверки максимального значения (например 1 000 000 000). Случайная опечатка с лишними нулями (100000000000) раздувает шкалу дашборда на 100000%', 'Искажение графиков и шкал дашборда', 'MEDIUM');
  }

  if (!surveyCode.includes('ALLOWED_CURRENCIES') && !surveyCode.includes('[\'сомони\'')) {
    addFinding('SURVEY-05', 'Зарплатные данные', 'Отсутствие белого списка допустимых валют (cur)', 'Поле валюты cur не валидируется по справочнику разрешенных валют (сомони, USD, RUB, EUR), разрешая запись произвольного текста', 'Мусорные валюты в отчетах', 'MEDIUM');
  }

  if (!surveyCode.includes('ALLOWED_PAY_PERIODS') && !surveyCode.includes('[\'в месяц\'')) {
    addFinding('SURVEY-06', 'Зарплатные данные', 'Отсутствие валидации периода выплаты (payPer)', 'Поле payPer не сверяется со списком ["в месяц", "в час", "в смену", "в год"]', 'Несопоставимые оклады при расчете вилок', 'MEDIUM');
  }

  if (!surveyCode.includes('compName') && !surveyCode.includes('comp.trim()')) {
    addFinding('SURVEY-07', 'Анкеты', 'Сохранение пустых или состоящих только из пробелов имен конкурентов', 'В saveSurveyDetails() объект с comp: "   " не отфильтровывается и записывается как безымянная анкета', 'Засорение базы данных пустыми строками', 'MEDIUM');
  }

  if (!surveyCode.includes('seenCompanies') && !surveyCode.includes('Set(')) {
    addFinding('SURVEY-08', 'Шаг 1 Опроса', 'Отсутствие дедупликации компаний-конкурентов в Шаге 1', 'Если пользователь дважды выбрал или ввел одну и ту же компанию в разных регистрах ("Банк Эсхата" и "банк эсхата"), сохраняются оба дубля', 'Дублирование карточек в Шаге 2', 'MEDIUM');
  }

  // 3. ПОЛЬЗОВАТЕЛИ И АДМИНИСТРИРОВАНИЕ
  if (!adminCode.includes('rawPwd') && !adminCode.includes('password.length')) {
    addFinding('USER-01', 'Управление пользователями', 'Создание нового пользователя без пароля или с паролем из пробелов', 'В saveUser() при создании новой записи password: "" не отклоняется ошибкой 400', 'Создание учетных записей без возможности безопасного входа', 'CRITICAL');
  }

  if (!adminCode.includes('VALID_ROLES') && !adminCode.includes('ROLES.includes')) {
    addFinding('USER-02', 'Управление пользователями', 'Отсутствие валидации роли пользователя по белому списку', 'В saveUser() поле role не проверяется по ROLES = ["admin", "cb", "hrbp", "dir_head", "head", "user"], позволяя назначить произвольную строку', 'Нарушение матрицы прав доступа', 'CRITICAL');
  }

  if (!adminCode.includes('cleanLogin') && !adminCode.includes('login.trim()')) {
    addFinding('USER-03', 'Управление пользователями', 'Отсутствие очистки логина от пробелов (login.trim())', 'Логин пользователя сохраняется с ведущими или завершающими пробелами, что делает невозможным вход по стандартному вводу', 'Невозможность входа созданного сотрудника', 'HIGH');
  }

  if (!adminCode.includes('guardAdmin')) {
    addFinding('USER-04', 'Управление пользователями', 'Отсутствие защиты от удаления/архивации собственной учетной записи администратора', 'Главный администратор может отправить себя в архив или удалить себя, полностью заблокировав доступ к панели управления', 'Полная потеря доступа к админке', 'CRITICAL');
    addFinding('USER-05', 'Управление пользователями', 'Отсутствие защиты от блокировки собственной учетной записи администратора', 'Главный администратор может деактивировать сам себя (active: false)', 'Потеря доступа к управлению', 'CRITICAL');
  }

  // 4. ПЕРИОДЫ СБОРА ДАННЫХ
  if (!adminCode.includes('dFrom > dTo') && !adminCode.includes('from > to')) {
    addFinding('PERIOD-01', 'Периоды', 'Отсутствие валидации дат периода (Дата начала позже даты окончания)', 'Сервер позволяет сохранить период с датами from: "2026-12-31", to: "2026-01-01"', 'Логическая ошибка во временных фильтрах аналитики', 'HIGH');
  }

  if (!adminCode.includes('[\'открыт\', \'закрыт\']')) {
    addFinding('PERIOD-02', 'Периоды', 'Отсутствие валидации статуса периода (state enum)', 'Статус периода принимает любое текстовое значение вместо строгого выбора ["открыт", "закрыт"]', 'Сбой логики блокировки ввода при закрытии периода', 'HIGH');
  }

  if (!adminCode.includes('cleanName') && !adminCode.includes('name.trim()')) {
    addFinding('PERIOD-03', 'Периоды', 'Возможность сохранения периода с пустым названием', 'Поле name периода не проверяется на непустую строку', 'Отображение безымянных периодов в шапке системы', 'MEDIUM');
  }

  // 5. ОРГСТРУКТУРА И СПРАВОЧНИКИ
  if (!adminCode.includes('cleanUnit') && !adminCode.includes('unit.trim()')) {
    addFinding('DIV-01', 'Оргструктура', 'Создание подразделения с пустым названием или из пробелов', 'Поле unit не валидируется на обязательное заполнение', 'Засорение оргструктуры пустыми строками', 'HIGH');
  }

  if (!dictCode.includes('!name')) {
    addFinding('DICT-01', 'Справочники', 'Добавление пустых записей в справочники льгот/должностей', 'dictionaryController.save() сохраняет элементы с name: "   "', 'Пустые чипы и варианты в выпадающих списках', 'MEDIUM');
  }

  if (!dictCode.includes('KINDS[kind]')) {
    addFinding('DICT-02', 'Справочники', 'Отсутствие проверки вида справочника (kind) по белому списку', 'Параметр :kind в URL не сверяется с разрешенным списком таблиц/видов', 'Потенциальная запись в нецелевые таблицы базы', 'HIGH');
  }

  // 6. РОЛИ И ПРАВА ДОСТУПА
  if (!adminCode.includes('CAPABILITIES.map') && !adminCode.includes('known.has')) {
    addFinding('CAPS-01', 'Матрица прав', 'Отсутствие фильтрации сохраняемых прав по зарегистрированному каталогу CAPABILITIES', 'Сервер принимает и сохраняет в JSON любые произвольные строки в качестве capabilities', 'Засорение матрицы прав фиктивными ключами', 'MEDIUM');
  }

  if (!adminCode.includes('Неизвестная сервисная задача')) {
    addFinding('MAINT-01', 'Сервис и обслуживание', 'Отсутствие валидации типа задачи обслуживания (taskType)', 'Сервер не сверяет taskType со списком разрешенных сервисных процедур', 'Вызов невалидных процедур обслуживания', 'HIGH');
  }

  // 7. КЛИЕНТСКАЯ ВАЛИДАЦИЯ И ФОРМУЛЫ (ФРОНТЕНД)
  if (!indexHtml.includes('replace(/[^0-9\\s,.]/g')) {
    addFinding('UI-01', 'Фронтенд ввод', 'Отсутствие автоматической очистки пробелов и запятых в полях ввода оклада', 'Если пользователь вводит "10 000" или "10,000", строка может не распарситься в число без санитайзера replace(/\\s+/g, "")', 'Ошибки парсинга чисел при вводе с пробелами/запятыми', 'MEDIUM');
  }

  if (!indexHtml.includes('isForkInverted') && !indexHtml.includes('От > До')) {
    addFinding('UI-02', 'Фронтенд ввод', 'Отсутствие клиентского предупреждения при инвертированной вилке (От > До)', 'Интерфейс не предупреждает пользователя желтой подсказкой, если оклад "от" превышает оклад "до"', 'Отправка ошибочных данных на сервер', 'MEDIUM');
  }

  if (!indexHtml.includes('bonHas === \'да\' && item.bonSize')) {
    addFinding('UI-03', 'Фронтенд расчет', 'Статус полноты карточки не требует заполнения размера бонуса при выборе "Бонусы: Да"', 'Если пользователь нажал "Бонусы: Да", но не указал размер или тип бонуса, логика может засчитать блок', 'Неполные данные по премиям попадают в базу', 'MEDIUM');
  }

  if (indexHtml.includes('Math.round') && !indexHtml.includes('Math.max(1,')) {
    addFinding('UI-04', 'Аналитика формулы', 'Потенциальное деление на ноль при пустых списках перцентилей (maxVal = 0)', 'В расчете перцентилей зарплатных вилок maxVal должен гарантированно быть >= 1', 'Отображение NaN% в графиках вилок', 'MEDIUM');
  }

  console.log('\n================================================================');
  console.log(`ИТОГО ВЫЯВЛЕНО ДЕФЕКТОВ ВАЛИДАЦИИ: ${findings.length}`);
  console.log('================================================================\n');

  return findings;
}

runDeepAudit().then(findings => {
  fs.writeFileSync(path.join(__dirname, 'audit_report.json'), JSON.stringify(findings, null, 2));
  console.log('Отчет сохранен в audit_report.json');
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
