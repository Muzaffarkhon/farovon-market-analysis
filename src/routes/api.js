const express = require('express');
const router = express.Router();

const { authMiddleware, requireRoles, requireCapability } = require('../middleware/auth');
const authController = require('../controllers/authController');
const surveyController = require('../controllers/surveyController');
const dashboardController = require('../controllers/dashboardController');
const adminController = require('../controllers/adminController');
const dictionaryController = require('../controllers/dictionaryController');
const telegramController = require('../controllers/telegramController');

// ─── Публичные роуты авторизации ───
router.post('/auth/login', authController.login);

// Сюда Telegram шлёт входящие сообщения — без JWT, проверяется секретным заголовком
router.post('/telegram/webhook', telegramController.webhook);

// ─── Защищенные роуты (требуют JWT) ───
router.use(authMiddleware);

// Профиль и сессия
router.get('/auth/resume', authController.resume);
router.post('/auth/change-password', authController.changePassword);
router.post('/auth/set-units', authController.setUnits);
router.post('/telegram/link', telegramController.link);
router.post('/telegram/unlink', telegramController.unlink);

// Опрос и данные
router.post('/survey/save', surveyController.saveSurveyData);
router.post('/survey/save-details', surveyController.saveSurveyDetails);
router.post('/survey/dictionary/add', surveyController.addDictionaryItem);

// Дашборд — сводная аналитика по всему холдингу (вилки конкурентов, прогресс
// всех HR BP). Кто именно видит её, кроме admin, теперь настраивается в
// конструкторе ролей (dashboard:view) — раньше было зашито requireRoles(...).
router.all('/dashboard/extended', requireCapability('dashboard:view'), dashboardController.getCBDashboard);
router.all('/dashboard/hrbp', requireCapability('dashboard:view'), dashboardController.getHRBPDashboard);
router.get('/dashboard/export-csv', requireCapability('dashboard:view'), dashboardController.exportCSV);

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

router.get('/admin/dictionary/:kind', requireCapability('dictionary:view'), dictionaryController.list);
router.get('/admin/dictionary/:kind/usage', requireCapability('dictionary:edit'), dictionaryController.usage);
router.post('/admin/dictionary/:kind', requireCapability('dictionary:create', 'dictionary:edit'), dictionaryController.save);
router.post('/admin/dictionary/:kind/delete', requireCapability('dictionary:edit'), dictionaryController.remove);

router.post('/admin/period', requireCapability('period:edit'), adminController.setPeriod);
router.post('/admin/maintenance', requireCapability('service:edit'), adminController.runMaintenance);
router.get('/admin/audit-log', requireCapability('service:view'), adminController.getAuditLog);
router.get('/admin/data-status', requireCapability('service:view'), adminController.getDataStatus);

// Конструктор ролей и доступов — редактирует сам список прав, поэтому
// намеренно admin-only (requireRoles, не requireCapability): выдать
// C&B-аналитику право менять права всей компании было бы той самой
// эскалацией, которую конструктор должен предотвращать.
router.get('/admin/role-capabilities', requireRoles('admin'), adminController.getRoleCapabilities);
router.post('/admin/role-capabilities', requireRoles('admin'), adminController.saveRoleCapabilities);

module.exports = router;
