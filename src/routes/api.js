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
const liveController = require('../controllers/liveController');
const gradingController = require('../controllers/gradingController');
const supportController = require('../controllers/supportController');

// Широкий лимит на весь /api (флуд-предохранитель). Точечные лимиты — ниже.
router.use(apiLimiter);

// ─── Публичные роуты авторизации ───
router.post('/auth/login', authLimiter, authController.login);
// Выход — просто гасит httpOnly-куку сессии, JWT для этого не нужен.
router.post('/auth/logout', authController.logout);

// Сюда Telegram шлёт входящие сообщения — без JWT, проверяется секретным заголовком
router.post('/telegram/webhook', webhookLimiter, telegramController.webhook);

// Юзернейм бота для экрана входа (кнопка «Открыть бота») — до логина у
// человека ещё нет JWT, а сам username не секрет.
router.get('/telegram/bot-info', telegramController.botInfo);

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

// Живое обновление (опрос) — дашборд и часть админки, см. liveController.js.
// Фронт раз в ~20 с сверяет подпись и перерисовывает раздел при изменении.
router.get('/live-signature', liveController.signature);

// Профиль и сессия
router.get('/auth/resume', authController.resume);
router.post('/auth/change-password', authController.changePassword);
router.post('/auth/change-name', authController.changeName);
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
router.post('/admin/divisions/create', requireCapability('divisions:edit'), adminController.createDivision);
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
router.post('/admin/import-staff-directory', requireCapability('service:edit'), adminController.importStaffDirectory);
router.get('/admin/staff-directory', requireCapability('dictionary:view'), adminController.listStaffDirectory);
router.post('/admin/staff-directory', requireCapability('dictionary:create', 'dictionary:edit'), adminController.saveStaffDirectory);
router.post('/admin/staff-directory/delete', requireCapability('dictionary:edit'), adminController.deleteStaffDirectory);
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

// Персональные права — та же admin-only логика, что и у конструктора ролей.
router.get('/admin/user-capabilities', requireRoles('admin'), adminController.getUserCapabilities);
router.post('/admin/user-capabilities', requireRoles('admin'), adminController.setUserCapabilities);

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

// ─── Грейдирование должностей и риски незаменимости ключевого персонала ───
// Границы видимости (кто чьи подразделения видит) — внутри контроллера:
// admin и cb видят холдинг целиком, остальные роли только свои подразделения.
// Справочник формулировок анкет (факторы, расшифровка баллов) — нужен обоим
// разделам, поэтому пускаем по любому из четырёх прав.
router.get('/grading/factors', requireCapability('grading:view', 'grading:edit', 'keyrisk:view', 'keyrisk:edit', 'grading:factors'), gradingController.getFactors);
// Правка самих вопросов анкеты — отдельное право: заполнять анкету и менять
// её формулировки для всего холдинга должны разные люди.
router.post('/admin/grading-factors', requireCapability('grading:factors'), gradingController.saveFactor);
router.post('/admin/grading-factors/reset', requireCapability('grading:factors'), gradingController.resetFactor);
router.get('/grading/blocks', requireCapability('grading:view', 'grading:edit'), gradingController.getBlocks);
// Админка: управление составом индустриальных блоков — отдельное право,
// заполнять анкету и перекраивать блоки должны разные люди.
router.get('/admin/grading-blocks', requireCapability('grading:blocks'), gradingController.getAdminBlocks);
router.get('/admin/grading-blocks/positions', requireCapability('grading:blocks'), gradingController.getAdminBlockPositions);
router.post('/admin/grading-blocks/reassign', requireCapability('grading:blocks'), gradingController.reassignBlockPosition);
router.post('/admin/grading-blocks/reset-evaluation', requireCapability('grading:blocks'), gradingController.resetEvaluation);
// Карточка сравнения: кто из комиссии что выбрал по каждому фактору, до утверждения итога.
router.get('/admin/grading-blocks/committee-breakdown', requireCapability('grading:blocks', 'grading:committee'), gradingController.getCommitteeBreakdown);
// Комиссия: кто входит в оценку блока вслепую, и принудительное подведение
// итога, если кворум набрать уже некому.
router.get('/admin/grading-committee', requireCapability('grading:committee'), gradingController.getCommittee);
router.post('/admin/grading-committee/add', requireCapability('grading:committee'), gradingController.addCommitteeMember);
router.post('/admin/grading-committee/remove', requireCapability('grading:committee'), gradingController.removeCommitteeMember);
router.get('/admin/grading-committee/pending', requireCapability('grading:committee'), gradingController.getCommitteePending);
router.post('/admin/grading-committee/finalize', requireCapability('grading:committee'), gradingController.forceFinalizeCommittee);
router.get('/grading/positions', requireCapability('grading:view', 'grading:edit'), gradingController.getPositions);
router.post('/grading/evaluate', requireCapability('grading:edit'), gradingController.evaluate);
router.get('/grading/stats', requireCapability('grading:view', 'grading:edit'), gradingController.getStats);

router.get('/key-personnel/list', requireCapability('keyrisk:view', 'keyrisk:edit'), gradingController.listRisks);
router.get('/key-personnel/unit-employees', requireCapability('keyrisk:edit'), gradingController.unitEmployees);
router.post('/key-personnel/evaluate', requireCapability('keyrisk:edit'), gradingController.evaluateRiskCard);
router.get('/key-personnel/heatmap', requireCapability('keyrisk:view', 'keyrisk:edit'), gradingController.getHeatmap);

// ─── Чат поддержки (гости бота, которых Telegram-бот не смог опознать) ───
router.get('/admin/support/threads', requireCapability('support:manage'), supportController.listThreads);
router.get('/admin/support/threads/:id', requireCapability('support:manage'), supportController.getThread);
router.post('/admin/support/reply', requireCapability('support:manage'), supportController.reply);
router.post('/admin/support/close', requireCapability('support:manage'), supportController.close);
router.get('/admin/support/unread-count', requireCapability('support:manage'), supportController.unreadCount);
router.post('/admin/support/link-employee', requireCapability('support:manage'), supportController.linkEmployee);
router.get('/admin/support/quick-replies', requireCapability('support:manage'), supportController.listQuickReplies);
router.post('/admin/support/quick-replies', requireCapability('support:manage'), supportController.saveQuickReply);
router.post('/admin/support/quick-replies/delete', requireCapability('support:manage'), supportController.deleteQuickReply);

module.exports = router;
