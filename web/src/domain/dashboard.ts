import type { ForkStats } from '../api/contract';

/**
 * Раскладка горизонтальной шкалы вилки (`ForkBar`) в проценты: тонкая линия
 * min–max, закрашенный блок P25–P75, риска медианы. Домен шкалы — не
 * собственный min–max строки (тогда линия всегда была бы во всю ширину и
 * строки с разным уровнем оклада нельзя было бы сравнить на глаз), а общий
 * `domainMax` — наибольшее значение среди строк, которые рисуются рядом
 * (единая шкала таблицы/списка). 0 — левый край домена, оклад отрицательным
 * не бывает.
 */
export interface ForkLayout {
  lineLeft: number; lineWidth: number;
  boxLeft: number; boxWidth: number;
  medianLeft: number;
  /** min === max — вилки нет, одна точка; лучше явно показать точку, чем «плоскую» шкалу шириной 0. */
  degenerate: boolean;
}

export function forkLayout(stats: Pick<ForkStats, 'min' | 'p25' | 'median' | 'p75' | 'max'>, domainMax: number): ForkLayout {
  const max = domainMax > 0 ? domainMax : (stats.max > 0 ? stats.max : 1);
  const pct = (v: number) => Math.max(0, Math.min(100, (v / max) * 100));

  if (stats.min === stats.max) {
    const p = pct(stats.min);
    return { lineLeft: p, lineWidth: 0, boxLeft: p, boxWidth: 0, medianLeft: p, degenerate: true };
  }

  const lineLeft = pct(stats.min);
  const boxLeft = pct(stats.p25);
  return {
    lineLeft,
    lineWidth: pct(stats.max) - lineLeft,
    boxLeft,
    boxWidth: pct(stats.p75) - boxLeft,
    medianLeft: pct(stats.median),
    degenerate: false
  };
}
