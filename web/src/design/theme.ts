export type Theme = 'light' | 'dark';
const KEY = 'theme';

export function getTheme(): Theme {
  const t = document.documentElement.getAttribute('data-theme');
  return t === 'dark' ? 'dark' : 'light';
}

export function setTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t);
  try { window.localStorage.setItem(KEY, t); } catch { /* приватный режим — тема живёт до перезагрузки */ }
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}
