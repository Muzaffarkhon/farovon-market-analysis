'use strict';

const { queryOne, queryAll } = require('../db/database');

/** Список ФИО через запятую → массив непустых строк без лишних пробелов. */
function splitFioList(str) {
  if (!str) return [];
  return String(str)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/** Массив ФИО → строка через запятую, без дублей (без учёта регистра). */
function joinFioList(arr) {
  const unique = [];
  const seen = new Set();
  (arr || []).forEach(item => {
    const clean = String(item || '').trim();
    if (clean && !seen.has(clean.toLowerCase())) {
      seen.add(clean.toLowerCase());
      unique.push(clean);
    }
  });
  return unique.join(', ');
}

/**
 * Находим пользователя точным поиском по ФИО (без учёта регистра), а если не
 * нашли — нечётким сопоставлением по совпадению минимум двух слов (фамилия +
 * имя). Единая точка сопоставления «текстовое ФИО → учётная запись» — её же
 * использует бэкфилл division_assignments (src/db/migrate.js) и точки записи
 * в adminController.js, чтобы не разойтись в двух копиях одной эвристики.
 */
async function findUserByFioFlexible(fioText) {
  if (!fioText || !String(fioText).trim()) return null;
  const raw = String(fioText).trim();
  let u = await queryOne('SELECT id, fio, units FROM users WHERE LOWER(TRIM(fio)) = LOWER(?) AND archived_at IS NULL', [raw]);
  if (u) return u;

  const words = raw.toLowerCase().replace(/[^a-zа-яёғӣқўҳҷ0-9\s]/gi, '').split(/\s+/).filter(w => w.length > 2);
  if (words.length >= 2) {
    const allUsers = await queryAll('SELECT id, fio, units FROM users WHERE archived_at IS NULL');
    for (const user of allUsers) {
      const uWords = (user.fio || '').toLowerCase().replace(/[^a-zа-яёғӣқўҳҷ0-9\s]/gi, '').split(/\s+/).filter(w => w.length > 2);
      const matched = words.filter(w => uWords.includes(w));
      if (matched.length >= 2) {
        return user;
      }
    }
  }
  return null;
}

module.exports = { splitFioList, joinFioList, findUserByFioFlexible };
