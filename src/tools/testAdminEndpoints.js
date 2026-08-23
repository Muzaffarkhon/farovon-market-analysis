const app = require('../server');

async function testAdmin() {
  const server = app.listen(3098, async () => {
    console.log('Testing Admin Endpoints...');

    // 1. Login as admin
    const loginRes = await fetch('http://localhost:3098/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'admin', password: '09630801' })
    });
    const loginData = await loginRes.json();
    const token = loginData.token;
    console.log('Admin login:', loginData.ok, 'token exists:', !!token);

    // 2. Test Get Users
    const usersRes = await fetch('http://localhost:3098/api/admin/users', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const usersData = await usersRes.json();
    console.log('Admin getUsers:', usersData.ok, 'count:', usersData.users ? usersData.users.length : 0);

    // 3. Test Get Divisions
    const divsRes = await fetch('http://localhost:3098/api/admin/divisions', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const divsData = await divsRes.json();
    console.log('Admin getDivisions:', divsData.ok, 'count:', divsData.divisions ? divsData.divisions.length : 0);

    // 4. Test Audit Log
    const auditRes = await fetch('http://localhost:3098/api/admin/audit-log', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const auditData = await auditRes.json();
    console.log('Admin auditLog:', auditData.ok, 'logs:', auditData.logs ? auditData.logs.length : 0);

    // 5. Test Extended Dashboard
    const dashRes = await fetch('http://localhost:3098/api/dashboard/extended', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const dashData = await dashRes.json();
    console.log('Dashboard extended:', dashData.ok, 'totalDivs:', dashData.summary && dashData.summary.totalDivisions);

    server.close();
    process.exit(0);
  });
}

testAdmin().catch(e => {
  console.error(e);
  process.exit(1);
});
