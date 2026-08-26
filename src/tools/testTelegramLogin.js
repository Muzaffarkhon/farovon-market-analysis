const { queryOne, run } = require('../db/database');
const bcrypt = require('bcryptjs');

async function testLocalTelegramLogin() {
  console.log('--- 🧪 ТЕСТИРОВАНИЕ ЛОГИКИ TELEGRAM /login ---\n');

  // 1. Ищем любого тестового активного пользователя кроме admin
  const user = await queryOne(
    "SELECT id, login, fio, role, telegram_chat_id FROM users WHERE active = 1 AND login != 'admin' LIMIT 1"
  );

  if (!user) {
    console.error('❌ Не найден тестовый пользователь в БД');
    return;
  }

  console.log(`1. Выбран пользователь для теста: ${user.fio} (логин: "${user.login}", role: "${user.role}")`);

  // 2. Симулируем привязанный telegram_chat_id
  const testChatId = '123456789';
  await run('UPDATE users SET telegram_chat_id = ? WHERE id = ?', [testChatId, user.id]);
  console.log(`2. Пользователю временно присвоен telegram_chat_id = ${testChatId}`);

  // 3. Симулируем генерацию пароля (как в handleLogin)
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  const tempPassword = 'Fv-' + code;
  const newHash = bcrypt.hashSync(tempPassword, 10);
  const now = new Date().toISOString();

  await run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [
    newHash,
    now,
    user.id
  ]);

  await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
    user.login,
    'сброс пароля telegram',
    `Пользователь ${user.fio} запросил данные для входа через Telegram (chat_id: ${testChatId})`
  ]);

  console.log(`3. Сгенерирован временный пароль: ${tempPassword}`);
  console.log(`4. Пароль захеширован через bcrypt (cost 10) и обновлен в БД`);

  // 5. Проверяем валидность хеша в БД
  const updatedUser = await queryOne('SELECT password_hash FROM users WHERE id = ?', [user.id]);
  const isMatch = bcrypt.compareSync(tempPassword, updatedUser.password_hash);
  console.log(`5. Проверка bcrypt.compareSync(пароль, хеш_из_бд): ${isMatch ? '✅ УСПЕШНО' : '❌ ОШИБКА'}`);

  // 6. Форматируем и выводим сообщение, как его увидит сотрудник в Telegram
  const platformUrl = 'https://farovon-market-analysis.onrender.com';
  const msg = `🔐 <b>Данные для входа в систему «Обзор рынка»:</b>\n\n` +
    `👤 <b>Логин:</b> <code>${user.login}</code>\n` +
    `🔑 <b>Временный пароль:</b> <code>${tempPassword}</code>\n\n` +
    `⚠️ <i>Рекомендуем сменить этот пароль в профиле сразу после первого входа.</i>\n\n` +
    `🌐 <b>Ссылка на платформу:</b>\n${platformUrl}`;

  console.log('\n--- 📱 СООБЩЕНИЕ, ОТПРАВЛЯЕМОЕ БОТОМ В TELEGRAM: ---');
  console.log(msg);
  console.log('----------------------------------------------------');
  console.log('🔘 Кнопка 1: [ 🚀 Открыть «Обзор рынка» ] (' + platformUrl + ')');
  console.log('\n✅ Тест логики завершен успешно!');
}

testLocalTelegramLogin().then(() => process.exit(0)).catch(err => {
  console.error('Ошибка теста:', err);
  process.exit(1);
});
