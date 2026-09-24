/** Общие хелперы сортировки для сгруппированных по направлению списков
 * (UnitsProgress, PeopleProgress) — сначала самые отстающие. */
export function pctOf(total: number, decided: number) {
  return total > 0 ? decided / total : Infinity;
}

export function sortByPct<T extends { pct: number }>(list: T[]) {
  return [...list].sort((a, b) => a.pct - b.pct);
}
