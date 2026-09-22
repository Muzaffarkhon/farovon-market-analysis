import { groupCapabilities } from './groupCapabilities';

test('группирует по resource с сохранением порядка', () => {
  const g = groupCapabilities([
    { id: 'users:view', resource: 'users', resourceLabel: 'Пользователи', label: 'Просмотр' },
    { id: 'users:edit', resource: 'users', resourceLabel: 'Пользователи', label: 'Правка' },
    { id: 'period:view', resource: 'period', resourceLabel: 'Период', label: 'Просмотр' }
  ]);
  expect(g.map(x => x.label)).toEqual(['Пользователи', 'Период']);
  expect(g[0].items).toHaveLength(2);
});
