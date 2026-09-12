/**
 * Каталог прав для конструктора ролей и доступов (админка → «Роли и доступы»).
 *
 * Права — не то же самое, что роли (users.role). Роли остаются фиксированным
 * списком (admin/cb/hrbp/dir_head/head/user) — от них зависит структурная
 * бизнес-логика (каскадное назначение dir_head/head, видимость своих
 * подразделений, блокировка чужих данных), которую опасно делать
 * настраиваемой на живой базе 111 пользователей. Права — это ТОЛЬКО доступ
 * к разделам админки (просмотр / редактирование / добавление), тонкая
 * настройка поверх ролей.
 *
 * 'admin' в эту таблицу никогда не попадает — у него все права всегда,
 * проверка обходит таблицу целиком (см. requireCapability в middleware/auth.js
 * и getUserPayload в authController.js). Это то же самое соглашение
 * «protected role», что в PayMarket (org_roles.is_protected).
 */

const CAPABILITIES = [
  { id: 'divisions:view', resource: 'divisions', resourceLabel: 'Оргструктура', label: 'Просмотр' },
  { id: 'divisions:edit', resource: 'divisions', resourceLabel: 'Оргструктура', label: 'Назначение ответственных' },
  { id: 'users:view', resource: 'users', resourceLabel: 'Пользователи', label: 'Просмотр' },
  { id: 'users:create', resource: 'users', resourceLabel: 'Пользователи', label: 'Добавление' },
  { id: 'users:edit', resource: 'users', resourceLabel: 'Пользователи', label: 'Редактирование, блокировка, архив' },
  { id: 'dictionary:view', resource: 'dictionary', resourceLabel: 'Справочники', label: 'Просмотр' },
  { id: 'dictionary:create', resource: 'dictionary', resourceLabel: 'Справочники', label: 'Добавление' },
  { id: 'dictionary:edit', resource: 'dictionary', resourceLabel: 'Справочники', label: 'Редактирование, удаление' },
  { id: 'period:view', resource: 'period', resourceLabel: 'Период сбора', label: 'Просмотр' },
  { id: 'period:edit', resource: 'period', resourceLabel: 'Период сбора', label: 'Открытие/закрытие периода' },
  { id: 'service:view', resource: 'service', resourceLabel: 'Сервис и Журнал', label: 'Просмотр журнала и статуса данных' },
  { id: 'service:edit', resource: 'service', resourceLabel: 'Сервис и Журнал', label: 'Запуск сервисных задач' },
  { id: 'dashboard:view', resource: 'dashboard', resourceLabel: 'Дашборд', label: 'Аналитическая сводка' },
  { id: 'benchmarks:view', resource: 'benchmarks', resourceLabel: 'Бенчмаркинг', label: 'Просмотр сравнений' },
  { id: 'benchmarks:view_licensed', resource: 'benchmarks', resourceLabel: 'Бенчмаркинг', label: 'Просмотр лицензированных обзоров (B1, Antal)' },
  { id: 'benchmarks:import', resource: 'benchmarks', resourceLabel: 'Бенчмаркинг', label: 'Загрузка и импорт датасетов' },
  { id: 'benchmarks:map', resource: 'benchmarks', resourceLabel: 'Бенчмаркинг', label: 'Сопоставление должностей' },
  { id: 'grading:view', resource: 'grading', resourceLabel: 'Грейдирование должностей', label: 'Просмотр грейдов и сводки' },
  { id: 'grading:edit', resource: 'grading', resourceLabel: 'Грейдирование должностей', label: 'Оценка должностей' },
  { id: 'keyrisk:view', resource: 'keyrisk', resourceLabel: 'Риски ключевого персонала', label: 'Просмотр матрицы рисков' },
  { id: 'keyrisk:edit', resource: 'keyrisk', resourceLabel: 'Риски ключевого персонала', label: 'Заполнение анкет риска' },
  { id: 'grading:factors', resource: 'grading', resourceLabel: 'Грейдирование должностей', label: 'Правка вопросов анкет (формулировки и баллы)' },
  { id: 'grading:blocks', resource: 'grading', resourceLabel: 'Грейдирование должностей', label: 'Управление индустриальными блоками и распределением должностей' },
  { id: 'grading:committee', resource: 'grading', resourceLabel: 'Грейдирование должностей', label: 'Состав комиссии по блокам и принудительное подведение итога' },
  { id: 'support:manage', resource: 'support', resourceLabel: 'Чат поддержки', label: 'Просмотр и ответы в чате поддержки Telegram-бота' }
];

const ROLES = ['cb', 'hrbp', 'dir_head', 'head', 'user'];

/**
 * Значения по умолчанию — сняты 1:1 с requireRoles(...) на живых маршрутах
 * до введения этой таблицы, чтобы миграция на проде ничего не поменяла для
 * 111 живых пользователей в момент выкатки.
 */
const DEFAULT_ROLE_CAPABILITIES = {
  // cb: до этой правки requireRoles('admin','cb') стоял почти на каждом
  // маршруте админки — то есть cb был «вторым админом» по факту.
  cb: CAPABILITIES.map(c => c.id),
  // hrbp: видел дашборд, оргструктуру и справочники (requireRoles(...,'hrbp')
  // на GET-маршрутах), и мог менять период — тот же набор ролей стоял и на
  // /admin/period.
  // hrbp + новые модули: HR BP смотрит грейды и матрицу рисков по своим
  // направлениям, но анкеты заполняют комиссия (грейды) и руководители (риски).
  hrbp: ['dashboard:view', 'divisions:view', 'dictionary:view', 'period:view', 'period:edit',
    'grading:view', 'keyrisk:view'],
  // dir_head: с PR #25 видит и правит divisions (только свои отделы — это
  // ограничение уже в adminController.saveDivision, не здесь) и читает
  // список пользователей для пикера «кого назначить».
  // dir_head и head заполняют анкеты рисков по своим подразделениям — именно
  // они знают, кто в цехе уникальный носитель знаний. Видимость ограничена
  // закреплёнными подразделениями в самом контроллере (gradingController).
  dir_head: ['divisions:view', 'divisions:edit', 'users:view',
    'grading:view', 'keyrisk:view', 'keyrisk:edit'],
  // head: видит и может назначать ответственных в подразделениях своей ветки
  // оргструктуры (подотделах), а также просматривать список пользователей.
  head: ['divisions:view', 'divisions:edit', 'users:view',
    'grading:view', 'keyrisk:view', 'keyrisk:edit'],
  user: []
};

/**
 * Пояснение к «структурным» ролям — их поведение зашито в код и НЕ настраивается
 * галочками прав. Показывается в конструкторе только для справки, чтобы админ
 * понимал, чем условный dir_head отличается от своей новой роли.
 */
const STRUCTURAL_NOTES = {
  admin: 'Полный доступ ко всему и всегда. Не удаляется, права не редактируются.',
  cb: 'Видит данные всех подразделений на дашборде и в анкетах; может править в закрытый период; не блокируется чужими авторскими замками.',
  hrbp: 'Видит на дашборде только свои направления; может править в закрытый период.',
  dir_head: 'Видит и назначает ответственных только по своим отделам; своё подразделение ему назначает администратор.',
  head: 'Видит свои подразделения и подотделы, может назначать ответственных внутри своей ветки оргструктуры.',
  user: 'Видит и заполняет только назначенные ему подразделения.'
};

// Роли, чей ключ упоминается в коде (структурная логика). Их нельзя удалить или
// переименовать ключ; label и права (кроме admin) — можно.
const RESERVED_ROLE_KEYS = ['admin', 'cb', 'hrbp', 'dir_head', 'head', 'user'];

const ROLE_LABELS = {
  admin: 'Администратор',
  cb: 'C&B Аналитик',
  hrbp: 'HR BP',
  dir_head: 'Руководитель направления',
  head: 'Руководитель отдела',
  user: 'Сотрудник'
};

module.exports = {
  CAPABILITIES, ROLES, DEFAULT_ROLE_CAPABILITIES,
  STRUCTURAL_NOTES, RESERVED_ROLE_KEYS, ROLE_LABELS
};
