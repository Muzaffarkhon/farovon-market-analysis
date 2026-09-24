const { unitsForUser } = require('./divisionAssignmentService');

/**
 * Область видимости данных рынка по роли пользователя.
 *
 * Один предикат на всех потребителей (дашборд, реестр): admin и C&B видят
 * весь рынок, HR BP — подразделения, где он указан HR BP (либо HR BP не задан
 * вовсе), остальные ограниченные роли — закреплённые за ними подразделения и
 * направления из users.units.
 *
 * Раньше эта функция жила приватно в dashboardController. Реестру нужна та же
 * видимость, а две копии рано или поздно разошлись бы — и человек увидел бы в
 * реестре строки, которых нет в его же аналитике.
 *
 * «Это я?» для hrbp проверяется по ID (myHrbpUnits — набор названий
 * подразделений из division_assignments, см. divisionAssignmentService.
 * unitsForUser), не по тексту divisions.hrbp — переименование человека
 * раньше рвало ему видимость (ТЗ, раздел 12, пункт 5). d.hrbp как текст
 * всё ещё нужен для вопроса «а назначен ли тут вообще кто-то» — пустое
 * значение открывает подразделение всем hrbp, это поведение не меняется.
 *
 * Сама функция остаётся синхронной и без обращения к БД — так её можно
 * тестировать как чистую функцию (test/coordinationService.test.js и т.п.);
 * набор myHrbpUnits вызывающая сторона получает заранее (await
 * unitsForUser(...) в контроллере, до вызова unitScopeFilter).
 *
 * Возвращает предикат по строке divisions {unit, dir, hrbp, …} либо null —
 * null означает «без ограничений».
 */
function unitScopeFilter(user, myHrbpUnits) {
  if (!user || user.role === 'admin' || user.role === 'cb') return null;
  const units = Array.isArray(user.units) ? user.units : [];
  if (user.role === 'hrbp') {
    const mine = myHrbpUnits || new Set();
    return (d) => (d.hrbp ? mine.has(d.unit) : true);
  }
  return (d) => units.includes(d.unit) || (!!d.dir && units.includes(d.dir));
}

/**
 * Удобный вариант для контроллеров: сам добирает myHrbpUnits из БД перед
 * вызовом unitScopeFilter. unitScopeFilter при этом остаётся синхронной и
 * тестируемой без БД — см. комментарий выше.
 */
async function unitScopeFilterAsync(user) {
  const mine = user && user.role === 'hrbp' ? await unitsForUser(user.id, 'hrbp') : undefined;
  return unitScopeFilter(user, mine);
}

module.exports = { unitScopeFilter, unitScopeFilterAsync };
