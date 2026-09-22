import { getTheme, setTheme, toggleTheme } from './theme';

test('setTheme выставляет атрибут и localStorage', () => {
  setTheme('dark');
  expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  expect(window.localStorage.getItem('theme')).toBe('dark');
});

test('toggleTheme переключает', () => {
  setTheme('light');
  expect(toggleTheme()).toBe('dark');
  expect(getTheme()).toBe('dark');
});
