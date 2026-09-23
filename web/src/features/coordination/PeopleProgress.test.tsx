import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PeopleProgress } from './PeopleProgress';
import type { CoordinationPerson } from '../../api/contract';

const person = (over: Partial<CoordinationPerson> = {}): CoordinationPerson => ({
  login: 'ivanov', fio: 'Иванов Иван', units: ['Цех 1'],
  positionsTotal: 5, positionsDecided: 3, lastLoginAt: '2026-09-01', hasTelegram: true, ...over
});

test('человек без Telegram помечен, но выбираем', async () => {
  const onToggle = vi.fn();
  render(<PeopleProgress people={[person({ hasTelegram: false })]} selected={new Set()} onToggle={onToggle} />);
  expect(screen.getByText('нет Telegram')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Иванов Иван' }));
  expect(onToggle).toHaveBeenCalledWith('ivanov');
});

test('выбранный человек отмечен галочкой', () => {
  render(<PeopleProgress people={[person()]} selected={new Set(['ivanov'])} onToggle={() => {}} />);
  expect(screen.getByRole('checkbox', { name: 'Иванов Иван' })).toBeChecked();
});

test('без входа показывает «ещё не заходил»', () => {
  render(<PeopleProgress people={[person({ lastLoginAt: '' })]} selected={new Set()} onToggle={() => {}} />);
  expect(screen.getByText(/ещё не заходил/)).toBeInTheDocument();
});

test('без людей — сообщение', () => {
  render(<PeopleProgress people={[]} selected={new Set()} onToggle={() => {}} />);
  expect(screen.getByText('Людей не найдено.')).toBeInTheDocument();
});
