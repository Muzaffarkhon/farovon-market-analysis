const express = require('express');
const router = express.Router();

const { authMiddleware, requireRoles } = require('../middleware/auth');
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

// Опрос и данные
router.post('/survey/save', surveyController.saveSurveyData);
router.post('/survey/save-details', surveyController.saveSurveyDetails);
router.post('/survey/dictionary/add', surveyController.addDictionaryItem);

// Дашборд — сводная аналитика по всему холдингу (вилки конкурентов, прогресс
// всех HR BP). Руководителю направления (dir_head) по роли не нужна: он видит
// свои подразделения. Убран и из навигации, и отсюда — иначе доступ остался бы
// открытым в обход интерфейса.
router.all('/dashboard/extended', requireRoles('admin', 'cb', 'hrbp'), dashboardController.getCBDashboard);
router.all('/dashboard/hrbp', requireRoles('admin', 'cb', 'hrbp'), dashboardController.getHRBPDashboard);
router.get('/dashboard/export-csv', requireRoles('admin', 'cb', 'hrbp'), dashboardController.exportCSV);

// Панель Администратора (только admin и cb)
router.get('/admin/users', requireRoles('admin', 'cb'), adminController.getUsers);
router.post('/admin/users', requireRoles('admin', 'cb'), adminController.saveUser);
router.post('/admin/users/:login/toggle', requireRoles('admin', 'cb'), adminController.toggleUser);
router.post('/admin/users/:login/reset-password', requireRoles('admin', 'cb'), adminController.resetPassword);
router.get('/admin/users-archive', requireRoles('admin', 'cb'), adminController.getArchivedUsers);
router.post('/admin/users/:login/archive', requireRoles('admin', 'cb'), adminController.archiveUser);
router.post('/admin/users/:login/restore', requireRoles('admin', 'cb'), adminController.restoreUser);

router.get('/admin/divisions', requireRoles('admin', 'cb', 'hrbp'), adminController.getDivisions);
router.post('/admin/divisions', requireRoles('admin', 'cb'), adminController.saveDivision);

// Справочники. Читать может и HR BP — список нужен ему для сверки, но правка и
// удаление тянут за собой живые данные, поэтому только admin/cb.
router.get('/admin/dictionary/:kind', requireRoles('admin', 'cb', 'hrbp'), dictionaryController.list);
router.get('/admin/dictionary/:kind/usage', requireRoles('admin', 'cb'), dictionaryController.usage);
router.post('/admin/dictionary/:kind', requireRoles('admin', 'cb'), dictionaryController.save);
router.post('/admin/dictionary/:kind/delete', requireRoles('admin', 'cb'), dictionaryController.remove);

router.post('/admin/period', requireRoles('admin', 'cb', 'hrbp'), adminController.setPeriod);
router.post('/admin/maintenance', requireRoles('admin', 'cb'), adminController.runMaintenance);
router.get('/admin/audit-log', requireRoles('admin', 'cb'), adminController.getAuditLog);
router.get('/admin/data-status', requireRoles('admin', 'cb'), adminController.getDataStatus);

module.exports = router;
