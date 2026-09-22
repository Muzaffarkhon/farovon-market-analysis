'use strict';

// Наполнение базы РАЗРАБОТКИ тем, чего нет в seedBundle.json: штатным
// расписанием (unit_positions). Без него экраны сбора говорят «штатка не
// заведена» — проверять на них нечего.
//
// На боевой базе то же самое делает админ кнопкой в сервисных утилитах
// (adminController.importStaffing) — здесь зовём ровно её, чтобы разбор
// staffing.json не разъехался между двумя местами.

const bcrypt = require('bcryptjs');
const config = require('../config');
const { run, queryOne, queryAll } = require('./database');
const { importStaffing } = require('../controllers/adminController');

// Учётные записи для ручных проверок. Пароль заведомо известный и годится
// ТОЛЬКО для локальной файловой базы — скрипт отказывается работать где-либо
// ещё (см. проверки в seedDev). В боевой базе таких пользователей нет.
const DEV_PASSWORD = 'devtest2026';
const DEV_USERS = [
  { login: 'dev.admin', fio: 'Тестовый Администратор', role: 'admin', units: '' },
  { login: 'dev.cb', fio: 'Тестовый C&B', role: 'cb', units: '' },
  { login: 'dev.user', fio: 'Тестовый Сотрудник', role: 'user', units: null }
];

async function createDevUsers() {
  const hash = bcrypt.hashSync(DEV_PASSWORD, 12);
  // Сотруднику даём подразделение, где реально есть штатка, — иначе экран сбора пуст.
  const withStaff = await queryOne(
    'SELECT unit, COUNT(*) AS n FROM unit_positions GROUP BY unit HAVING n BETWEEN 4 AND 30 ORDER BY n DESC LIMIT 1'
  );
  const unit = withStaff ? withStaff.unit : '';
  for (const u of DEV_USERS) {
    const units = u.units === null ? unit : u.units;
    await run(
      `INSERT INTO users (login, password_hash, fio, role, units, active, must_change_password)
       VALUES (?, ?, ?, ?, ?, 1, 0)
       ON CONFLICT(login) DO UPDATE SET password_hash = excluded.password_hash,
         fio = excluded.fio, role = excluded.role, units = excluded.units,
         active = 1, must_change_password = 0, archived_at = NULL`,
      [u.login, hash, u.fio, u.role, units]
    );
  }
  const group = await queryAll(
    "SELECT unit FROM divisions WHERE COALESCE(group_key,'') <> '' LIMIT 3"
  );
  console.log(`✅ Тестовые пользователи: ${DEV_USERS.map(u => u.login).join(', ')} — пароль ${DEV_PASSWORD}`);
  console.log(`   dev.user закреплён за подразделением: ${unit || '(штатка не найдена)'}`);
  if (group.length) console.log(`   подразделения со смежной группой для проверки разноса: ${group.map(g => g.unit).join(', ')}`);
}

async function seedDev() {
  if (config.isProduction) {
    throw new Error('seedDev не предназначен для продакшена');
  }
  if (!config.usingDevDatabase) {
    throw new Error(
      'DEV_DATABASE_URL не задан — скрипт отказывается работать, чтобы не писать в боевую базу. ' +
      'Добавьте в .env строку DEV_DATABASE_URL=file:./data/dev.db (см. .env.example).'
    );
  }
  console.log(await importStaffing());
  await createDevUsers();
}

if (require.main === module) {
  seedDev()
    .then(() => { console.log('🎉 База разработки готова'); process.exit(0); })
    .catch(err => { console.error('❌', err.message); process.exit(1); });
}

module.exports = { seedDev };
