const fs = require('fs');
const path = require('path');
const config = require('../config');

let db = null;

function getDb() {
  if (db) return db;

  const dbDir = path.dirname(config.dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  try {
    const Database = require('better-sqlite3');
    db = new Database(config.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Run schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      db.exec(schemaSql);
    }
  } catch (err) {
    console.error('Failed to initialize better-sqlite3 database:', err.message);
    throw err;
  }

  return db;
}

module.exports = {
  getDb
};
