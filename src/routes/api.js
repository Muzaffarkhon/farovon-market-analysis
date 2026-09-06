const express = require('express');
const router = express.Router();

const { authMiddleware, requireRoles, requireCapability } = require('../middleware/auth');
const { apiLimiter, authLimiter, webhookLimiter } = require('../middleware/rateLimit');
const refCache = require('../services/refCache');
const authController = require('../controllers/authController');
const surveyController = require('../controllers/surveyController');
const dashboardController = require('../controllers/dashboardController');
const adminController = require('../controllers/adminController');
const dictionaryController = require('../controllers/dictionaryController');
const telegramController = require('../controllers/telegramController');
const benchmarkController = require('../controllers/benchmarkController');

// Широкий лимит на весь /api (флуд-предохранитель). Точечные лимиты — ниже.
router.use(apiLimiter);

// ─── Публичные роуты авторизации ───
router.post('/auth/login', authLimiter, authController.login);
// Выход — просто гасит httpOnly-куку сессии, JWT для этого не нужен.
router.post('/auth/logout', authController.logout);

// Сюда Telegram шлёт входящие сообщения — без JWT, проверяется секретным заголовком
router.post('/telegram/webhook', webhookLimiter, telegramController.webhook);

// ─── Защищенные роуты (требуют JWT) ───
router.use(authMiddleware);

// Сброс кэша справочников (src/services/refCache.js) после успешной правки,
// затрагивающей справочные наборы. Один хук вместо invalidate() в каждом
// контроллере.
//  - /admin/*                — оргструктура, справочники, права ролей, период;
//  - /survey/dictionary/add  — добавление значения в справочник из анкеты;
//  - /survey/save            — пишет divisions.survey_note и вставляет
//                              competitors с segment/region (они попадают в
//                              кэшируемые segments/regions).
// /survey/save-details не трогает кэшируемые таблицы (только surveys) — не в списке.
router.use((req, res, next) => {
  if (!refCache.touchesRefData(req.method, req.path)) return next();

  // Успех = статус < 400 И тело не {ok:false}: часть контроллеров сигналит
  // ошибку / needsConfirm статусом 200 — на них кэш сбрасывать не нужно.
  let bodyOk = true;
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    if (body && body.ok === false) bodyOk = false;
    return sendJson(body);
  };
  res.on('finish', () => {
    if (res.statusCode < 400 && bodyOk) refCache.invalidate();
  });
  next();
});

// Профиль и сессия
router.get('/auth/resume', authController.resume);
router.post('/auth/change-password', authController.changePassword);
router.post('/auth/set-units', authController.setUnits);
router.post('/auth/onboarded', authController.markOnboarded);
router.post('/telegram/link', telegramController.link);
router.post('/telegram/unlink', telegramController.unlink);

// Опрос и данные
router.post('/survey/save', surveyController.saveSurveyData);
router.post('/survey/save-details', surveyController.saveSurveyDetails);
router.post('/survey/for-period', surveyController.getSurveysForPeriod);
router.post('/survey/dictionary/add', surveyController.addDictionaryItem);

// Дашборд — сводная аналитика по всему холдингу (вилки конкурентов, прогресс
// всех HR BP). Кто именно видит её, кроме admin, теперь настраивается в
// конструкторе ролей (dashboard:view) — раньше было зашито requireRoles(...).
router.post('/dashboard/extended', requireCapability('dashboard:view'), dashboardController.getCBDashboard);
router.post('/dashboard/hrbp', requireCapability('dashboard:view'), dashboardController.getHRBPDashboard);
router.get('/dashboard/export-csv', requireCapability('dashboard:view'), dashboardController.exportCSV);
// Журнал выгрузок: фронт вызывает перед скачиванием CSV (файл собирается в браузере).
router.post('/audit/export', requireCapability('dashboard:view'), dashboardController.logExport);

// Панель Администратора. Доступ к разделам теперь по конструктору ролей
// (см. src/config/capabilities.js) вместо жёстко зашитых requireRoles(...).
// saveUser/dictionaryController.save обслуживают одним POST и создание, и
// правку — маршрут пускает по любому из двух прав, точная граница внутри
// обработчика (см. adminController.saveUser, dictionaryController.save).
router.get('/admin/users', requireCapability('users:view'), adminController.getUsers);
router.post('/admin/users', requireCapability('users:create', 'users:edit'), adminController.saveUser);
router.post('/admin/users/:login/toggle', requireCapability('users:edit'), adminController.toggleUser);
router.post('/admin/users/:login/reset-password', requireCapability('users:edit'), adminController.resetPassword);
router.get('/admin/users-archive', requireCapability('users:view'), adminController.getArchivedUsers);
router.post('/admin/users/:login/archive', requireCapability('users:edit'), adminController.archiveUser);
router.post('/admin/users/:login/restore', requireCapability('users:edit'), adminController.restoreUser);

router.get('/admin/divisions', requireCapability('divisions:view'), adminController.getDivisions);
router.post('/admin/divisions', requireCapability('divisions:edit'), adminController.saveDivision);
router.post('/admin/divisions/move', requireCapability('divisions:edit'), adminController.moveDivisionCascade);
router.post('/admin/divisions/batch-assign', requireCapability('divisions:edit'), adminController.batchAssignCascade);
router.post('/admin/divisions/adjacent-group', requireCapability('divisions:edit'), adminController.applyAdjacentGroup);
router.post('/admin/divisions/adjacent-group/clear', requireCapability('divisions:edit'), adminController.clearAdjacentGroup);

router.get('/admin/dictionary/:kind', requireCapability('dictionary:view'), dictionaryController.list);
router.get('/admin/dictionary/:kind/usage', requireCapability('dictionary:edit'), dictionaryController.usage);
router.post('/admin/dictionary/:kind', requireCapability('dictionary:create', 'dictionary:edit'), dictionaryController.save);
router.post('/admin/dictionary/:kind/delete', requireCapability('dictionary:edit'), dictionaryController.remove);

router.post('/admin/period', requireCapability('period:edit'), adminController.setPeriod);
router.post('/admin/period-grants', requireCapability('period:edit'), adminController.grantPeriodEdit);
router.post('/admin/period-grants/revoke', requireCapability('period:edit'), adminController.revokePeriodEdit);
router.get('/admin/period-grants', requireCapability('period:edit'), adminController.listPeriodGrants);
router.get('/admin/period-grants/users', requireCapability('period:edit'), adminController.getUsersForPeriodGrants);
router.post('/admin/periods/delete', requireCapability('period:edit'), adminController.deletePeriod);
router.post('/admin/maintenance', requireCapability('service:edit'), adminController.runMaintenance);
router.post('/admin/import-survey', requireCapability('service:edit'), adminController.importSurvey);
router.get('/admin/audit-log', requireCapability('service:view'), adminController.getAuditLog);
router.get('/admin/data-status', requireCapability('service:view'), adminController.getDataStatus);

// Конструктор ролей и доступов — редактирует сам список прав, поэтому
// намеренно admin-only (requireRoles, не requireCapability): выдать
// C&B-аналитику право менять права всей компании было бы той самой
// эскалацией, которую конструктор должен предотвращать.
router.get('/admin/role-capabilities', requireRoles('admin'), adminController.getRoleCapabilities);
router.post('/admin/role-capabilities', requireRoles('admin'), adminController.saveRoleCapabilities);
router.post('/admin/roles', requireRoles('admin'), adminController.createRole);
router.post('/admin/roles/:key/rename', requireRoles('admin'), adminController.renameRole);
router.post('/admin/roles/:key/delete', requireRoles('admin'), adminController.deleteRole);

// ─── Мультиисточниковый бенчмаркинг вознаграждений ───
router.get('/benchmarks/sources', requireCapability('benchmarks:view'), benchmarkController.getSources);
router.post('/benchmarks/sources', requireCapability('benchmarks:import'), benchmarkController.createSource);
router.get('/benchmarks/datasets', requireCapability('benchmarks:view'), benchmarkController.getDatasets);
router.post('/benchmarks/datasets/:id/delete', requireCapability('benchmarks:import'), benchmarkController.deleteDataset);
router.get('/benchmarks/positions/:sourceKey', requireCapability('benchmarks:view'), benchmarkController.getSourcePositions);
router.get('/benchmarks/mappings', requireCapability('benchmarks:view'), benchmarkController.getMappings);
router.get('/benchmarks/suggest-mappings/:sourceKey', requireCapability('benchmarks:map'), benchmarkController.suggestMappings);
router.post('/benchmarks/mappings', requireCapability('benchmarks:map'), benchmarkController.saveMapping);
router.post('/benchmarks/mappings/:id/delete', requireCapability('benchmarks:map'), benchmarkController.deleteMapping);
router.post('/benchmarks/import/dry-run', requireCapability('benchmarks:import'), benchmarkController.dryRunImport);
router.post('/benchmarks/import/commit', requireCapability('benchmarks:import'), benchmarkController.commitImport);
router.get('/benchmarks/compare', requireCapability('benchmarks:view'), benchmarkController.compare);
router.get('/benchmarks/export', requireCapability('benchmarks:view'), benchmarkController.exportMatrix);
router.get('/benchmarks/summary-widgets', requireCapability('benchmarks:view'), benchmarkController.getSummaryWidgets);

module.exports = router;
