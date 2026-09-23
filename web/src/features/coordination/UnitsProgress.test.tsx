import { render, screen } from '@testing-library/react';
import { UnitsProgress } from './UnitsProgress';
import type { CoordinationUnit } from '../../api/contract';

const unit = (over: Partial<CoordinationUnit> = {}): CoordinationUnit => ({
  unit: 'Цех 1', dir: 'Дивизион Север', hrbp: '', resp: '', head: '',
  positionsTotal: 5, positionsDecided: 4, state: 'в процессе', lastActivityAt: '', ...over
});

test('отстающее подразделение (0 из 5) идёт выше почти решённого (4 из 5)', () => {
  render(<UnitsProgress units={[
    unit({ unit: 'Почти готово', positionsDecided: 4, positionsTotal: 5 }),
    unit({ unit: 'Отстающее', positionsDecided: 0, positionsTotal: 5 })
  ]} />);
  const labels = screen.getAllByText(/Почти готово|Отстающее/).map(e => e.textContent);
  expect(labels).toEqual(['Отстающее', 'Почти готово']);
});

test('подразделение без штатки (0 из 0) не выглядит срочным — идёт последним', () => {
  render(<UnitsProgress units={[
    unit({ unit: 'Без штатки', positionsDecided: 0, positionsTotal: 0, state: 'не начато' }),
    unit({ unit: 'В работе', positionsDecided: 1, positionsTotal: 5 })
  ]} />);
  const labels = screen.getAllByText(/Без штатки|В работе/).map(e => e.textContent);
  expect(labels).toEqual(['В работе', 'Без штатки']);
});

test('без подразделений — сообщение', () => {
  render(<UnitsProgress units={[]} />);
  expect(screen.getByText('Подразделений не найдено.')).toBeInTheDocument();
});
