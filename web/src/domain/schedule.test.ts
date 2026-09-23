import { scheduleLabel } from './schedule';

test('вместо часов в неделю показывает время работы', () => {
  expect(scheduleLabel('5/2 · 40 часов')).toBe('5/2 · 08:00–17:00');
  expect(scheduleLabel('6/1 · 54 часа')).toBe('6/1 · 08:00–18:00');
});

test('графики без фиксированного времени остаются как есть', () => {
  expect(scheduleLabel('Сменный 2/2')).toBe('Сменный 2/2');
  expect(scheduleLabel('Вахтовый')).toBe('Вахтовый');
});
