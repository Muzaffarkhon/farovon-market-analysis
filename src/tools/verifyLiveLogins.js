const LIVE_URL = 'https://farovon-market-analysis.onrender.com';

const testAccounts = [
  { login: 'admin', pass: '09630801', name: 'Администратор' },
  { login: 'cb', pass: '00000000', name: 'C&B Отдел' },
  { login: 'samadova.f', pass: 'pkad-8774', name: 'Самадова Фарзона' },
  { login: 'buzurukov.ha', pass: 'cjmy-7695', name: 'Бузуруков Хушвахт' },
  { login: 'bahodurova.sa', pass: 'bmsb-6388', name: 'Баходурова Сабохат' }
];

async function verifyLive() {
  console.log(`🌐 Проверка живого сервера: ${LIVE_URL}`);

  try {
    const health = await fetch(`${LIVE_URL}/health`);
    console.log('Health status:', health.status);
  } catch (e) {
    console.log('Health check pending/deploying:', e.message);
  }

  for (const acc of testAccounts) {
    try {
      const res = await fetch(`${LIVE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: acc.login, password: acc.pass })
      });
      const data = await res.json();
      if (data.ok) {
        console.log(`✅ [УСПЕХ] ${acc.name} (${acc.login}) вошёл! Роль: ${data.data.user.role}, Доступных подразделений: ${data.data.units ? data.data.units.length : 0}`);
      } else {
        console.log(`❌ [ОШИБКА] ${acc.name} (${acc.login}) не вошёл:`, data.error);
      }
    } catch (e) {
      console.log(`⚠️ Ошибка запроса для ${acc.login}:`, e.message);
    }
  }
}

verifyLive();
