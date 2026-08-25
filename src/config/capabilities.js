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
  { id: 'dashboard:view', resource: 'dashboard', resourceLabel: 'Дашборд', label: 'Аналитическая сводка' }
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
  hrbp: ['dashboard:view', 'divisions:view', 'dictionary:view', 'period:view', 'period:edit'],
  // dir_head: с PR #25 видит и правит divisions (только свои отделы — это
  // ограничение уже в adminController.saveDivision, не здесь) и читает
  // список пользователей для пикера «кого назначить».
  dir_head: ['divisions:view', 'divisions:edit', 'users:view'],
  head: [],
  user: []
};

module.exports = { CAPABILITIES, ROLES, DEFAULT_ROLE_CAPABILITIES };
