import { forkLayout } from './dashboard';

test('раскладка по общему домену — доля от максимума среди сравниваемых строк', () => {
  const l = forkLayout({ min: 2000, p25: 3000, median: 4000, p75: 5000, max: 6000 }, 10000);
  expect(l.lineLeft).toBe(20);
  expect(l.lineWidth).toBe(40); // 60% - 20%
  expect(l.boxLeft).toBe(30);
  expect(l.boxWidth).toBe(20); // 50% - 30%
  expect(l.medianLeft).toBe(40);
  expect(l.degenerate).toBe(false);
});

test('вырожденный случай min === max — точка, без деления на ноль', () => {
  const l = forkLayout({ min: 5000, p25: 5000, median: 5000, p75: 5000, max: 5000 }, 10000);
  expect(l.degenerate).toBe(true);
  expect(l.lineWidth).toBe(0);
  expect(l.boxWidth).toBe(0);
  expect(Number.isFinite(l.medianLeft)).toBe(true);
  expect(l.medianLeft).toBe(50);
});

test('нулевой domainMax не делит на ноль — падает на max строки', () => {
  const l = forkLayout({ min: 1000, p25: 1500, median: 2000, p75: 2500, max: 3000 }, 0);
  expect(l.lineWidth).toBeGreaterThan(0);
  expect(Number.isFinite(l.lineLeft)).toBe(true);
});

test('значения не выходят за пределы 0–100%', () => {
  const l = forkLayout({ min: 0, p25: 1000, median: 2000, p75: 3000, max: 4000 }, 1000);
  expect(l.medianLeft).toBeLessThanOrEqual(100);
  expect(l.boxLeft + l.boxWidth).toBeLessThanOrEqual(100);
});
