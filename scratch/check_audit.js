const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { queryAll } = require('../src/db/database');

async function main() {
  try {
    const logs = await queryAll('SELECT * FROM audit_log ORDER BY id DESC LIMIT 15');
    console.log('--- RECENT AUDIT LOGS ---');
    logs.forEach(l => {
      console.log(`[${l.created_at}] [${l.login}] Action: "${l.action}" | Detail: "${l.detail}"`);
    });
  } catch (e) {
    console.error('Error fetching audit logs:', e.message);
  }
}
main();
