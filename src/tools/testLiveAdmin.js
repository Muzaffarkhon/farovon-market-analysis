const LIVE_URL = 'https://farovon-market-analysis.onrender.com';

async function testLiveAdmin() {
  console.log('Testing Live Admin on Render...');

  const loginRes = await fetch(`${LIVE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'admin', password: '09630801' })
  });
  const loginData = await loginRes.json();
  if (!loginData.ok) {
    console.log('❌ Admin login failed:', loginData.error);
    return;
  }
  const token = loginData.token;
  console.log('✅ Admin login OK');

  const usersRes = await fetch(`${LIVE_URL}/api/admin/users`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const usersData = await usersRes.json();
  console.log('Admin getUsers live:', usersData.ok, 'count:', usersData.users ? usersData.users.length : 0, 'error:', usersData.error);

  const divsRes = await fetch(`${LIVE_URL}/api/admin/divisions`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const divsData = await divsRes.json();
  console.log('Admin getDivisions live:', divsData.ok, 'count:', divsData.divisions ? divsData.divisions.length : 0);
}

testLiveAdmin();
