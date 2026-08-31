// Отчёт: у кого из пользователей пароль всё ещё хранится старым несолёным
// SHA-256-хэшем, а не bcrypt. Такие хэши мигрируют на bcrypt автоматически
// при первом успешном входе (см. authController.login), но пока их не ноль,
// ветку проверки SHA в verifyPassword убирать нельзя.
//
// Запуск:  node src/tools/reportLegacyHashes.js
// Только чтение, ничего не меняет.

require('dotenv').config();
const { queryAll } = require('../db/database');

const isBcryptHash = (h) => /^\$2[aby]\$/.test(String(h || ''));

(async () => {
  const users = await queryAll(
    "SELECT login, fio, role, active, archived_at, last_login_at, password_hash FROM users ORDER BY fio ASC"
  );

  const legacy = users.filter(u => !isBcryptHash(u.password_hash));
  const bcryptCount = users.length - legacy.length;

  console.log(`Всего пользователей:      ${users.length}`);
  console.log(`С bcrypt-хэшем:           ${bcryptCount}`);
  console.log(`С устаревшим (SHA/иным):  ${legacy.length}`);

  if (legacy.length) {
    console.log('\nУчётки со старым хэшем (мигрируют при следующем входе):');
    legacy.forEach(u => {
      const tag = [
        u.archived_at ? 'архив' : null,
        !u.active ? 'неактивна' : null,
        u.last_login_at ? `посл. вход ${String(u.last_login_at).slice(0, 10)}` : 'ни разу не входил'
      ].filter(Boolean).join(', ');
      console.log(`  • ${u.login}  (${u.role})  — ${u.fio}${tag ? `  [${tag}]` : ''}`);
    });
    console.log('\nКогда список опустеет — можно удалить SHA-ветку из verifyPassword (src/controllers/authController.js).');
  } else {
    console.log('\n✅ Старых хэшей не осталось — ветку SHA в verifyPassword можно удалять.');
  }

  process.exit(0);
})().catch(err => {
  console.error('Ошибка:', err.message);
  process.exit(1);
});
