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
  { id: 'survey:fill', resource: 'survey', resourceLabel: 'Сбор данных', label: 'Заполнение анкет по рынку' },
  { id: 'divisions:view', resource: 'divisions', resourceLabel: 'Оргструктура', label: 'Просмотр' },
  { id: 'divisions:edit', resource: 'divisions', resourceLabel: 'Оргструктура', label: 'Назначение ответственных' },
  { id: 'users:view', resource: 'users', resourceLabel: 'Пользователи', label: 'Просмотр' },
  // users:create сознательно нет в каталоге: добавлять новых пользователей
  // может только встроенный суперадмин (login «admin»), это не делегируется
  // ни ролям, ни персональным исключениям (см. adminController.saveUser).
  { id: 'users:edit', resource: 'users', resourceLabel: 'Пользователи', label: 'Редактирование, блокировка, архив' },
  { id: 'dictionary:view', resource: 'dictionary', resourceLabel: 'Справочники', label: 'Просмотр' },
  { id: 'dictionary:create', resource: 'dictionary', resourceLabel: 'Справочники', label: 'Добавление' },
  { id: 'dictionary:edit', resource: 'dictionary', resourceLabel: 'Справочники', label: 'Редактирование, удаление' },
  { id: 'period:view', resource: 'period', resourceLabel: 'Период сбора', label: 'Просмотр' },
  { id: 'period:edit', resource: 'period', resourceLabel: 'Период сбора', label: 'Открытие/закрытие периода' },
  { id: 'service:view', resource: 'service', resourceLabel: 'Сервис и Журнал', label: 'Просмотр журнала и статуса данных' },
  { id: 'service:edit', resource: 'service', resourceLabel: 'Сервис и Журнал', label: 'Запуск сервисных задач' },
  { id: 'dashboard:view', resource: 'dashboard', resourceLabel: 'Дашборд', label: 'Аналитическая сводка' },
  { id: 'coordination:view', resource: 'coordination', resourceLabel: 'Координация', label: 'Прогресс по направлениям и людям' },
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
  { id: 'support:manage', resource: 'support', resourceLabel: 'Чат поддержки', label: 'Просмотр и ответы в чате поддержки Telegram-бота' },
  { id: 'broadcast:send', resource: 'broadcast', resourceLabel: 'Рассылка', label: 'Отправка рассылок сотрудникам через Telegram-бота и просмотр истории' },
  // Пересмотр заработной платы (docs/superpowers/specs/2026-09-22-comp-review-design.md,
  // согласовано с заказчиком 22.09.2026). «Менеджер C&B» и HRD — не роли
  // системы (ROLES фиксирован), права выдаются конкретным людям персонально
  // (HRD — Сатторов Илхомчон Ахмадчонович, см. §9.1 документа); ему же можно
  // отдельно выдать comp:vote — тогда он ещё и голосует в комиссии.
  { id: 'comp:submit', resource: 'comp', resourceLabel: 'Пересмотр заработной платы', label: 'Подача заявки (черновик), видит свои заявки' },
  { id: 'comp:review_cb', resource: 'comp', resourceLabel: 'Пересмотр заработной платы', label: 'Проверка C&B — рыночные данные, передача дальше или возврат на доработку, видит все заявки' },
  { id: 'comp:approve_hrd', resource: 'comp', resourceLabel: 'Пересмотр заработной платы', label: 'Согласование HRD' },
  { id: 'comp:vote', resource: 'comp', resourceLabel: 'Пересмотр заработной платы', label: 'Голосование в комиссии' },
  { id: 'comp:payroll', resource: 'comp', resourceLabel: 'Пересмотр заработной платы', label: 'Оформление одобренных изменений в 1С (урезанный экран)' },
  { id: 'comp:admin', resource: 'comp', resourceLabel: 'Пересмотр заработной платы', label: 'Состав и кворум комиссии, режим голосования, принудительное закрытие' }
];

const ROLES = ['cb', 'hrbp', 'dir_head', 'head', 'user'];

/**
 * Значения по умолчанию — сняты 1:1 с requireRoles(...) на живых маршрутах
 * до введения этой таблицы, чтобы миграция на проде ничего не поменяла для
 * 111 живых пользователей в момент выкатки.
 */
const DEFAULT_ROLE_CAPABILITIES = {
  // cb: до этой правки requireRoles('admin','cb') стоял почти на каждом
  // маршруте админки — то есть cb был «вторым админом» по факту. Сужено
  // 24.09.2026 до того, что C&B-аналитик реально делает: управление
  // учётками (users:edit — users:create вообще не делегируется, см. ниже)
  // и рассылки/сервисные задачи — не его функция. Это только дефолт для
  // новых сред (INSERT OR IGNORE при миграции): уже выданные в проде
  // права не трогает — при рестарте сервера просто не переустанавливает
  // убранные вручную через «Роли и доступы» строки обратно.
  // comp:review_cb — по роли (это буквально работа C&B-аналитика). Остальные
  // права пересмотра ЗП (approve_hrd/vote/payroll/admin) — не по умолчанию,
  // только персонально конкретным людям, как решено в §9.1 документа.
  cb: CAPABILITIES.map(c => c.id).filter(id =>
    !['users:edit', 'broadcast:send', 'service:edit', 'comp:approve_hrd', 'comp:vote', 'comp:payroll', 'comp:admin'].includes(id)),
  // hrbp: видел дашборд, оргструктуру и справочники (requireRoles(...,'hrbp')
  // на GET-маршрутах), и мог менять период — тот же набор ролей стоял и на
  // /admin/period.
  // hrbp + новые модули: HR BP смотрит грейды и матрицу рисков по своим
  // направлениям, но анкеты заполняют комиссия (грейды) и руководители (риски).
  hrbp: ['survey:fill', 'dashboard:view', 'coordination:view', 'divisions:view', 'dictionary:view', 'period:view', 'period:edit',
    'grading:view', 'keyrisk:view', 'comp:submit'],
  // dir_head: с PR #25 видит и правит divisions (только свои отделы — это
  // ограничение уже в adminController.saveDivision, не здесь) и читает
  // список пользователей для пикера «кого назначить».
  // dir_head и head заполняют анкеты рисков по своим подразделениям — именно
  // они знают, кто в цехе уникальный носитель знаний. Видимость ограничена
  // закреплёнными подразделениями в самом контроллере (gradingController).
  dir_head: ['survey:fill', 'coordination:view', 'divisions:view', 'divisions:edit', 'users:view',
    'grading:view', 'keyrisk:view', 'keyrisk:edit'],
  // head: видит и может назначать ответственных в подразделениях своей ветки
  // оргструктуры (подотделах), а также просматривать список пользователей.
  head: ['survey:fill', 'divisions:view', 'divisions:edit', 'users:view',
    'grading:view', 'keyrisk:view', 'keyrisk:edit'],
  // user: раньше маршруты сбора были открыты любому авторизованному —
  // survey:fill по умолчанию сохраняет это поведение, но делает его управляемым.
  user: ['survey:fill']
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
