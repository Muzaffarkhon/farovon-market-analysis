const express = require('express');
const router = express.Router();

const { authMiddleware, requireRoles } = require('../middleware/auth');
const authController = require('../controllers/authController');
const surveyController = require('../controllers/surveyController');
const dashboardController = require('../controllers/dashboardController');
const adminController = require('../controllers/adminController');

// ─── Публичные роуты авторизации ───
router.post('/auth/login', authController.login);

// ─── Защищенные роуты (требуют JWT) ───
router.use(authMiddleware);

// Профиль и сессия
router.get('/auth/resume', authController.resume);
router.post('/auth/change-password', authController.changePassword);
router.post('/auth/set-units', authController.setUnits);

// Опрос и данные
router.post('/survey/save', surveyController.saveSurveyData);
router.post('/survey/save-details', surveyController.saveSurveyDetails);
router.post('/survey/dictionary/add', surveyController.addDictionaryItem);

// Дашборд
router.all('/dashboard/extended', requireRoles('admin', 'cb', 'hrbp', 'dir_head'), dashboardController.getCBDashboard);
router.all('/dashboard/hrbp', requireRoles('admin', 'cb', 'hrbp', 'dir_head'), dashboardController.getHRBPDashboard);
router.get('/dashboard/export-csv', requireRoles('admin', 'cb', 'hrbp', 'dir_head'), dashboardController.exportCSV);

// Панель Администратора (только admin и cb)
router.get('/admin/users', requireRoles('admin', 'cb'), adminController.getUsers);
router.post('/admin/users', requireRoles('admin', 'cb'), adminController.saveUser);
router.post('/admin/users/:login/toggle', requireRoles('admin', 'cb'), adminController.toggleUser);
router.post('/admin/users/:login/reset-password', requireRoles('admin', 'cb'), adminController.resetPassword);

router.get('/admin/divisions', requireRoles('admin', 'cb', 'hrbp'), adminController.getDivisions);
router.post('/admin/divisions', requireRoles('admin', 'cb'), adminController.saveDivision);

router.post('/admin/period', requireRoles('admin', 'cb', 'hrbp'), adminController.setPeriod);
router.post('/admin/maintenance', requireRoles('admin', 'cb'), adminController.runMaintenance);
router.get('/admin/audit-log', requireRoles('admin', 'cb'), adminController.getAuditLog);

module.exports = router;
