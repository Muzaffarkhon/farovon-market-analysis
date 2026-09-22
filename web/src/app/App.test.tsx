import { render, screen } from '@testing-library/react';
import { App } from './App';

test('без сессии показывает экран входа', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue({ status: 401, ok: false, json: async () => ({ ok: false, error: 'Требуется авторизация' }) }) as never;
  window.history.pushState({}, '', '/new/');
  render(<App />);
  expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument();
});
