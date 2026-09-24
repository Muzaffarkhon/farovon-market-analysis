import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnitsProgress } from './UnitsProgress';
import type { CoordinationUnit } from '../../api/contract';

const unit = (over: Partial<CoordinationUnit> = {}): CoordinationUnit => ({
  unit: 'Цех 1', dir: 'Дивизион Север', hrbp: '', resp: '', head: '',
  positionsTotal: 5, positionsDecided: 4, state: 'в процессе', lastActivityAt: '', ...over
});

test('подразделения свёрнуты в направление, по клику разворачиваются', async () => {
  render(<UnitsProgress units={[
    unit({ unit: 'Почти готово', positionsDecided: 4, positionsTotal: 5 }),
    unit({ unit: 'Отстающее', positionsDecided: 0, positionsTotal: 5 })
  ]} />);
  expect(screen.getByText(/Дивизион Север/)).toBeInTheDocument();
  expect(screen.queryByText('Отстающее')).not.toBeInTheDocument();

  await userEvent.click(screen.getByText(/Дивизион Север/));
  const labels = screen.getAllByText(/Почти готово|Отстающее/).map(e => e.textContent);
  expect(labels).toEqual(['Отстающее', 'Почти готово']);
});

test('направление с отстающим подразделением идёт выше почти решённого', async () => {
  render(<UnitsProgress units={[
    unit({ dir: 'Готовое направление', unit: 'Цех A', positionsDecided: 5, positionsTotal: 5 }),
    unit({ dir: 'Отстающее направление', unit: 'Цех B', positionsDecided: 0, positionsTotal: 5 })
  ]} />);
  const labels = screen.getAllByText(/Готовое направление|Отстающее направление/).map(e => e.textContent);
  expect(labels[0]).toMatch(/Отстающее направление/);
  expect(labels[1]).toMatch(/Готовое направление/);
});

test('подразделение без штатки (0 из 0) не выглядит срочным — идёт последним', async () => {
  render(<UnitsProgress units={[
    unit({ unit: 'Без штатки', positionsDecided: 0, positionsTotal: 0, state: 'не начато' }),
    unit({ unit: 'В работе', positionsDecided: 1, positionsTotal: 5 })
  ]} />);
  await userEvent.click(screen.getByText(/Дивизион Север/));
  const labels = screen.getAllByText(/Без штатки|В работе/).map(e => e.textContent);
  expect(labels).toEqual(['В работе', 'Без штатки']);
});

test('без подразделений — сообщение', () => {
  render(<UnitsProgress units={[]} />);
  expect(screen.getByText('Подразделений не найдено.')).toBeInTheDocument();
});
