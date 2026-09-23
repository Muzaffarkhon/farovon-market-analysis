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
 * Возвращает предикат по строке divisions {unit, dir, hrbp, …} либо null —
 * null означает «без ограничений».
 */
function unitScopeFilter(user) {
  if (!user || user.role === 'admin' || user.role === 'cb') return null;
  const units = Array.isArray(user.units) ? user.units : [];
  const fio = String(user.fio || '').toLowerCase();
  return (d) => {
    if (user.role === 'hrbp') {
      return d.hrbp ? String(d.hrbp).toLowerCase() === fio : true;
    }
    return units.includes(d.unit) || (!!d.dir && units.includes(d.dir));
  };
}

module.exports = { unitScopeFilter };
