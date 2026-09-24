import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DirectionGroups } from './DirectionGroups';
import type { CoordinationPerson, CoordinationUnit } from '../../api/contract';

const unit = (over: Partial<CoordinationUnit> = {}): CoordinationUnit => ({
  unit: 'Цех 1', dir: 'Дивизион Север', hrbp: '', resp: '', head: '',
  positionsTotal: 5, positionsDecided: 3, state: 'в процессе', lastActivityAt: '', ...over
});
const person = (over: Partial<CoordinationPerson> = {}): CoordinationPerson => ({
  login: 'ivanov', fio: 'Иванов Иван', units: ['Цех 1'],
  positionsTotal: 5, positionsDecided: 3, lastLoginAt: '2026-09-01', hasTelegram: true, ...over
});

function renderGroups(units: CoordinationUnit[], people: CoordinationPerson[], selected = new Set<string>(), onToggle = () => {}) {
  return render(<DirectionGroups units={units} people={people} selected={selected} onToggle={onToggle} />);
}

test('направление свёрнуто по умолчанию — ни подразделения, ни люди не видны', () => {
  renderGroups([unit()], [person()]);
  expect(screen.getByText(/Дивизион Север/)).toBeInTheDocument();
  expect(screen.queryByText('Цех 1')).not.toBeInTheDocument();
  expect(screen.queryByText('Иванов Иван')).not.toBeInTheDocument();
});

test('клик по направлению разворачивает и подразделения, и людей вместе', async () => {
  renderGroups([unit()], [person()]);
  await userEvent.click(screen.getByText(/Дивизион Север/));
  expect(screen.getByText('Подразделения')).toBeInTheDocument();
  expect(screen.getByText('Цех 1')).toBeInTheDocument();
  expect(screen.getByText('Люди')).toBeInTheDocument();
  expect(screen.getByText('Иванов Иван')).toBeInTheDocument();
});

test('выбор человека вызывает onToggle', async () => {
  const onToggle = vi.fn();
  renderGroups([unit()], [person()], new Set(), onToggle);
  await userEvent.click(screen.getByText(/Дивизион Север/));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Иванов Иван' }));
  expect(onToggle).toHaveBeenCalledWith('ivanov');
});

test('направление с отстающим подразделением идёт выше почти решённого', () => {
  renderGroups([
    unit({ dir: 'Готовое направление', unit: 'Цех A', positionsDecided: 5, positionsTotal: 5 }),
    unit({ dir: 'Отстающее направление', unit: 'Цех B', positionsDecided: 0, positionsTotal: 5 })
  ], []);
  const labels = screen.getAllByText(/Готовое направление|Отстающее направление/).map(e => e.textContent);
  expect(labels[0]).toMatch(/Отстающее направление/);
  expect(labels[1]).toMatch(/Готовое направление/);
});

test('человек с подразделениями из двух направлений появляется в обоих', async () => {
  const p = person({ units: ['Цех 1', 'Цех 2'] });
  const units = [unit(), unit({ unit: 'Цех 2', dir: 'Дивизион Юг' })];
  renderGroups(units, [p]);
  await userEvent.click(screen.getByText(/Дивизион Север/));
  await userEvent.click(screen.getByText(/Дивизион Юг/));
  expect(screen.getAllByText('Иванов Иван')).toHaveLength(2);
});

test('без подразделений — сообщение', () => {
  renderGroups([], []);
  expect(screen.getByText('Подразделений не найдено.')).toBeInTheDocument();
});
