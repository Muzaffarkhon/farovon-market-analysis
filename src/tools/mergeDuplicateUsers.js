const { queryAll, queryOne, run, batch } = require('../db/database');

/**
 * Нормализация токенов ФИО для поиска дубликатов (Фамилия + Имя)
 */
function getFioTokens(fio) {
  if (!fio || typeof fio !== 'string') return [];
  return fio
    .toLowerCase()
    .replace(/[^a-zа-яёғӣқўҳҷ0-9\s]/gi, '')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 2);
}

function getFioKey(fio) {
  const tokens = getFioTokens(fio);
  if (!tokens.length) return '';
  return tokens.slice(0, 2).sort().join('_');
}

/**
 * Ранг роли для выбора основного рабочего аккаунта
 */
const ROLE_RANK = {
  admin: 10,
  cb: 9,
  dir_head: 8,
  head: 7,
  hrbp: 6,
  user: 5,
  guest: 1
};

function areFioMatching(fio1, fio2) {
  const t1 = getFioTokens(fio1);
  const t2 = getFioTokens(fio2);
  if (!t1.length || !t2.length) return false;
  const common = t1.filter(w => t2.includes(w));
  return common.length >= 2 || (t1.length === 1 && t2.length === 1 && t1[0] === t2[0]);
}

async function mergeDuplicateUsers() {
  console.log('🔄 Запуск нормализации и объединения дубликатов пользователей...');

  const users = await queryAll('SELECT * FROM users WHERE archived_at IS NULL');
  console.log(`Найдено активных пользователей: ${users.length}`);

  const processed = new Set();
  const clusters = [];

  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    if (processed.has(u.id)) continue;
    const group = [u];
    processed.add(u.id);

    for (let j = i + 1; j < users.length; j++) {
      const other = users[j];
      if (processed.has(other.id)) continue;
      if (areFioMatching(u.fio, other.fio)) {
        group.push(other);
        processed.add(other.id);
      }
    }
    clusters.push(group);
  }

  let mergedCount = 0;
  let updatedFioCount = 0;

  for (const list of clusters) {
    if (list.length > 1) {
      // 1. Сортируем: сначала с наивысшей ролью, затем с большим количеством подразделений
      list.sort((a, b) => {
        const rankA = ROLE_RANK[a.role] || 0;
        const rankB = ROLE_RANK[b.role] || 0;
        if (rankB !== rankA) return rankB - rankA;
        const unitsCountA = (a.units || '').split(';').filter(Boolean).length;
        const unitsCountB = (b.units || '').split(';').filter(Boolean).length;
        return unitsCountB - unitsCountA;
      });

      const primary = list[0];
      const duplicates = list.slice(1);

      // 2. Ищем самое полное ФИО (с отчеством)
      let bestFio = primary.fio;
      for (const u of list) {
        if ((u.fio || '').trim().split(/\s+/).length > bestFio.trim().split(/\s+/).length) {
          bestFio = u.fio.trim();
        }
      }

      // 3. Объединяем подразделения со всех аккаунтов
      const allUnitsSet = new Set();
      list.forEach(u => {
        (u.units || '').split(';').map(x => x.trim()).filter(Boolean).forEach(un => allUnitsSet.add(un));
      });
      const mergedUnits = Array.from(allUnitsSet).join('; ');

      console.log(`⚡ Объединение группы: ${primary.fio} <-> ${duplicates.map(d => d.fio).join(', ')}`);
      console.log(`   Основной: ${primary.login} (${primary.fio}) -> Новое ФИО: ${bestFio}`);

      // 4. Обновляем основной аккаунт
      await run(
        'UPDATE users SET fio = ?, units = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [bestFio, mergedUnits, primary.id]
      );

      // 5. Архивируем дубликаты
      for (const dup of duplicates) {
        await run(
          'UPDATE users SET archived_at = CURRENT_TIMESTAMP, active = 0, units = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          ['', dup.id]
        );
        mergedCount++;
      }
      updatedFioCount++;
    }
  }

  // 6. Синхронизируем ФИО в таблице divisions
  console.log('🔄 Синхронизация ФИО в подразделениях (divisions)...');
  const activeUsers = await queryAll('SELECT id, fio FROM users WHERE archived_at IS NULL');
  const divisions = await queryAll('SELECT id, unit, head, resp, hrbp FROM divisions');

  let divUpdates = 0;
  for (const div of divisions) {
    let newHead = div.head;
    let newResp = div.resp;
    let newHrbp = div.hrbp;

    // Приводим ФИО в карточке подразделения к каноничному написанию из users —
    // но только когда это однозначно. Раньше здесь брался ПЕРВЫЙ нечёткий
    // матч (совпадение фамилии + ещё одного токена), из-за чего у однофамильцев
    // значение переписывалось на чужого и «плавало» от запуска к запуску —
    // каждый прогон отчитывался о десятках «обновлённых» подразделений.
    const matchFio = (val) => {
      if (!val || typeof val !== 'string') return val;
      const trimmed = val.trim();
      // Уже точно совпадает с активным пользователем — не трогаем.
      if (activeUsers.some(u => (u.fio || '').trim() === trimmed)) return val;
      // Иначе переписываем только при ЕДИНСТВЕННОМ нечётком кандидате.
      const candidates = activeUsers.filter(u => areFioMatching(trimmed, u.fio));
      return candidates.length === 1 ? candidates[0].fio : val;
    };

    if (div.head) newHead = matchFio(div.head);
    if (div.resp) newResp = matchFio(div.resp);
    if (div.hrbp) newHrbp = matchFio(div.hrbp);

    if (newHead !== div.head || newResp !== div.resp || newHrbp !== div.hrbp) {
      await run(
        'UPDATE divisions SET head = ?, resp = ?, hrbp = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [newHead, newResp, newHrbp, div.id]
      );
      divUpdates++;
    }
  }

  console.log(`✅ Успешно! Объединено дубликатов: ${mergedCount}, обновлено полных ФИО: ${updatedFioCount}, обновлено подразделений: ${divUpdates}`);
  return { mergedCount, updatedFioCount, divUpdates };
}

if (require.main === module) {
  mergeDuplicateUsers()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Ошибка слияния:', err);
      process.exit(1);
    });
}

module.exports = { mergeDuplicateUsers, getFioKey, getFioTokens };
