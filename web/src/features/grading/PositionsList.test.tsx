import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PositionsList } from './PositionsList';
import type { GradingLevel, GradingPosition } from '../../api/contract';

const grades: GradingLevel[] = [{ grade: 3, from: 2.6, name: 'Группа III', label: '' }];

const position = (over: Partial<GradingPosition> = {}): GradingPosition => ({
  job_title: 'Бухгалтер', unit_count: 3, staff_count: 5, evaluation_id: null,
  factor_1: null, factor_2: null, factor_3: null, factor_4: null, factor_5: null, factor_6: null, factor_7: null,
  weighted_score: null, grade_level: null, evaluated_by: null, notes: null, updated_at: null,
  submitted_count: 0, units: [], ...over
});

test('не начатая должность показывает статус «не начата»', () => {
  render(<PositionsList rows={[position()]} committeeSize={0} grades={grades} onSelect={() => {}} />);
  expect(screen.getByText('не начата')).toBeInTheDocument();
});

test('комиссия сдала часть — «идёт оценка N из M»', () => {
  render(<PositionsList rows={[position({ submitted_count: 3 })]} committeeSize={7} grades={grades} onSelect={() => {}} />);
  expect(screen.getByText('идёт оценка 3 из 7')).toBeInTheDocument();
});

test('оценённая должность показывает балл и название группы', () => {
  render(<PositionsList rows={[position({ grade_level: 3, weighted_score: 2.8 })]} committeeSize={0} grades={grades} onSelect={() => {}} />);
  expect(screen.getByText('2.8 · Группа III')).toBeInTheDocument();
});

test('клик по строке вызывает onSelect с этой должностью', async () => {
  const row = position();
  const onSelect = vi.fn();
  render(<PositionsList rows={[row]} committeeSize={0} grades={grades} onSelect={onSelect} />);
  await userEvent.click(screen.getByText('Бухгалтер'));
  expect(onSelect).toHaveBeenCalledWith(row);
});

test('без должностей — сообщение', () => {
  render(<PositionsList rows={[]} committeeSize={0} grades={grades} onSelect={() => {}} />);
  expect(screen.getByText('В блоке нет должностей.')).toBeInTheDocument();
});
