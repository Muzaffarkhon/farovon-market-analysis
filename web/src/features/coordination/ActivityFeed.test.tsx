import { render, screen } from '@testing-library/react';
import { ActivityFeed } from './ActivityFeed';

test('запись ленты показывает компанию, должность, подразделение и автора', () => {
  render(<ActivityFeed feed={[{ unit: 'Цех 1', dir: 'Дивизион Север', company: 'Алиф', posOur: 'Токарь', by: 'hrbp1', at: '2026-09-01 10:00:00' }]} />);
  expect(screen.getByText('Алиф', { exact: false })).toBeInTheDocument();
  expect(screen.getByText(/Токарь/)).toBeInTheDocument();
  expect(screen.getByText(/hrbp1/)).toBeInTheDocument();
});

test('пустая лента — сообщение', () => {
  render(<ActivityFeed feed={[]} />);
  expect(screen.getByText('Пока ничего не внесено.')).toBeInTheDocument();
});
