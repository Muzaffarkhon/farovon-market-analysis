/**
 * РАЗОВЫЙ скрипт. Откатывает два ошибочных слияния пользователей, которые
 * сделала авто-нормализация (mergeDuplicateUsers) на старте сервера до того,
 * как её убрали из migrate().
 *
 * Ошибочно слиты как «дубликаты» (на деле — разные люди, однофамильцы):
 *   #57 hakimov.mn2  Хакимов Мирзомуин Наимович   → был влит в #16 hakimov.mn
 *   #44 mavlonov.sa2 Мавлонов Шахзод Абдумаликович → был влит в #43 mavlonov.sa
 *
 * Что делает:
 *   1. Снимает архив с #57 и #44 (archived_at=NULL, active=1) и возвращает им
 *      их подразделение из исходного CSV.
 *   2. Убирает у «основных» #16 и #43 подразделение, которое к ним приклеилось
 *      при слиянии, — возвращает к исходному единственному юниту.
 *
 * Значения units взяты из data/(Свод данных) ... - Пользователи.csv:
 *   hakimov.mn   → «Отдел проектирование новых проектов»
 *   hakimov.mn2  → «Департамент дистрибуции»
 *   mavlonov.sa  → «Процессный офис»
 *   mavlonov.sa2 → «Финансовый департамент (общий)»
 *
 * Роли (role) НЕ трогаем — их слияние не меняло.
 *
 * Запуск:  node src/tools/restoreWrongMerges.js
 */
require('dotenv').config();
const { run, queryAll } = require('../db/database');

const PLAN = [
  {
    id: 57, login: 'hakimov.mn2',
    sql: 'UPDATE users SET archived_at = NULL, active = 1, units = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 57',
    args: ['Департамент дистрибуции']
  },
  {
    id: 16, login: 'hakimov.mn',
    sql: 'UPDATE users SET units = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 16',
    args: ['Отдел проектирование новых проектов']
  },
  {
    id: 44, login: 'mavlonov.sa2',
    sql: 'UPDATE users SET archived_at = NULL, active = 1, units = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 44',
    args: ['Финансовый департамент (общий)']
  },
  {
    id: 43, login: 'mavlonov.sa',
    sql: 'UPDATE users SET units = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 43',
    args: ['Процессный офис']
  }
];

async function dump(label) {
  const rows = await queryAll(
    'SELECT id, login, fio, role, active, archived_at, units FROM users WHERE id IN (16,43,44,57) ORDER BY id'
  );
  console.log(`\n--- ${label} ---`);
  rows.forEach(u => console.log(
    `#${u.id} ${u.login.padEnd(13)} role=${String(u.role).padEnd(8)} active=${u.active} archived=${u.archived_at || 'NULL'}  units="${u.units}"`
  ));
}

(async () => {
  await dump('ДО');

  for (const p of PLAN) {
    await run(p.sql, p.args);
    console.log(`✔ ${p.login} (#${p.id})`);
  }

  await dump('ПОСЛЕ');
  console.log('\nГотово. Проверьте раздел «Пользователи» и карточки затронутых подразделений в приложении.');
  process.exit(0);
})().catch(err => {
  console.error('❌ Ошибка:', err);
  process.exit(1);
});
