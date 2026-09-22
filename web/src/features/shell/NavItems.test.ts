import { navItemsFor } from './NavItems';
import type { SessionUser } from '../../api/contract';

const base = { id: 1, login: 'u', fio: 'У', units: ['Цех'], onboarded: true, hasTelegram: false };

test('обычный пользователь с survey:fill видит только сбор', () => {
  const items = navItemsFor({ ...base, role: 'user', capabilities: ['survey:fill'] } as SessionUser);
  expect(items.map(i => i.to)).toEqual(['/']);
});

test('admin видит матрицу ролей', () => {
  const items = navItemsFor({ ...base, role: 'admin', capabilities: [] } as SessionUser);
  expect(items.map(i => i.to)).toContain('/access');
});

test('без survey:fill сбор скрыт', () => {
  const items = navItemsFor({ ...base, role: 'user', capabilities: [] } as SessionUser);
  expect(items.map(i => i.to)).not.toContain('/');
});
