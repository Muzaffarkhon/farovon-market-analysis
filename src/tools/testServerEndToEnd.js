const app = require('../server');

async function runLocalServerTest() {
  const server = app.listen(3099, async () => {
    console.log('Testing local server on port 3099 connected to Turso...');

    // 1. Test Admin Login
    const adminRes = await fetch('http://localhost:3099/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'admin', password: '09630801' })
    });
    const adminData = await adminRes.json();
    console.log('Admin login test:', adminData.ok, 'user:', adminData.data && adminData.data.user && adminData.data.user.login, 'units:', adminData.data && adminData.data.units && adminData.data.units.length);

    // 2. Test Samadova Login
    const samRes = await fetch('http://localhost:3099/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'samadova.f', password: 'pkad-8774' })
    });
    const samData = await samRes.json();
    console.log('Samadova login test:', samData.ok, 'fio:', samData.data && samData.data.user && samData.data.user.fio);

    // 3. Test CB Login
    const cbRes = await fetch('http://localhost:3099/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'cb', password: '00000000' })
    });
    const cbData = await cbRes.json();
    console.log('CB login test:', cbData.ok, 'user:', cbData.data && cbData.data.user && cbData.data.user.login);

    // 4. Test wrong password
    const wrongRes = await fetch('http://localhost:3099/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'admin', password: 'wrongpassword' })
    });
    const wrongData = await wrongRes.json();
    console.log('Wrong password test (should be false):', wrongData.ok);

    server.close();
    process.exit(0);
  });
}

runLocalServerTest().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
