import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PositionForm } from './PositionForm';
import { ConfirmHost } from '../../design/Confirm';
import type { GradingFactor, GradingPosition } from '../../api/contract';

const criteria: GradingFactor[] = [
  { code: 'К1', title: 'Квалификация', help: '', options: ['Первый', 'Второй', 'Третий', 'Четвёртый', 'Пятый'], examples: ['Уборщик', 'Кассир', 'Мастер', 'Директор', 'Гендиректор'] }
];

const position = (over: Partial<GradingPosition> = {}): GradingPosition => ({
  job_title: 'Бухгалтер', unit_count: 3, staff_count: 5, evaluation_id: null,
  factor_1: null, factor_2: null, factor_3: null, factor_4: null, factor_5: null, factor_6: null, factor_7: null,
  weighted_score: null, grade_level: null, evaluated_by: null, notes: null, updated_at: null,
  submitted_count: 0, units: [], ...over
});

test('кнопка «Отправить оценку» выключена, пока не выбраны все факторы', () => {
  render(<PositionForm row={position()} criteria={criteria} committeeSize={0} onClose={() => {}} onSubmit={() => {}} submitting={false} />);
  expect(screen.getByRole('button', { name: 'Отправить оценку' })).toBeDisabled();
});

test('выбор варианта включает кнопку и передаёт выбранный балл в onSubmit', async () => {
  const onSubmit = vi.fn();
  render(<PositionForm row={position()} criteria={criteria} committeeSize={0} onClose={() => {}} onSubmit={onSubmit} submitting={false} />);
  // Кнопки подписаны буквами (a…e) в перемешанном порядке — какую ни возьми, это валидный ответ.
  const letterButtons = screen.getAllByRole('button').filter(b => /^[a-f]$/.test(b.textContent ?? ''));
  await userEvent.click(letterButtons[0]);
  const btn = screen.getByRole('button', { name: 'Отправить оценку' });
  expect(btn).toBeEnabled();
  await userEvent.click(btn);
  expect(onSubmit).toHaveBeenCalledWith({ jobTitle: 'Бухгалтер', factors: [expect.any(Number)], notes: '' });
});

test('утверждённая комиссией должность — форма недоступна на запись', () => {
  render(<PositionForm row={position({ grade_level: 3 })} criteria={criteria} committeeSize={5} onClose={() => {}} onSubmit={() => {}} submitting={false} />);
  expect(screen.getByText(/уже утверждена комиссией/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Отправить оценку' })).not.toBeInTheDocument();
});

test('без комиссии оценённую должность можно переоценить — форма не заблокирована, но и не подставлена', async () => {
  render(<PositionForm row={position({ grade_level: 3, factor_1: 4 })} criteria={criteria} committeeSize={0} onClose={() => {}} onSubmit={() => {}} submitting={false} />);
  const btn = screen.getByRole('button', { name: 'Отправить оценку' });
  expect(btn).toBeDisabled();
  const letterButtons = screen.getAllByRole('button').filter(b => /^[a-f]$/.test(b.textContent ?? ''));
  await userEvent.click(letterButtons[0]);
  expect(btn).toBeEnabled();
});

test('своя слепая заявка предзаполняет комментарий, но не ответы шкалы', () => {
  render(<PositionForm
    row={position({ my_submission: { factor_1: 5, factor_2: 0, factor_3: 0, factor_4: 0, factor_5: 0, factor_6: 0, factor_7: 0, notes: 'моя заметка' } })}
    criteria={criteria} committeeSize={7} onClose={() => {}} onSubmit={() => {}} submitting={false}
  />);
  expect(screen.getByDisplayValue('моя заметка')).toBeInTheDocument();
  expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument();
});

test('без права управления блоками кнопок сброса/восстановления нет даже у утверждённой оценки', () => {
  render(<PositionForm row={position({ grade_level: 3, has_reset_backup: true })} criteria={criteria} committeeSize={5} onClose={() => {}} onSubmit={() => {}} submitting={false} />);
  expect(screen.queryByRole('button', { name: 'Сбросить оценку' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Восстановить оценку' })).not.toBeInTheDocument();
});

test('с правом управления блоками админ видит и сброс, и восстановление прямо в карточке', async () => {
  const onReset = vi.fn();
  const onRestore = vi.fn();
  render(
    <ConfirmHost>
      <PositionForm
        row={position({ grade_level: 3, has_reset_backup: true })} criteria={criteria} committeeSize={5}
        onClose={() => {}} onSubmit={() => {}} submitting={false}
        canManage onReset={onReset} onRestore={onRestore}
      />
    </ConfirmHost>
  );
  await userEvent.click(screen.getByRole('button', { name: 'Сбросить оценку' }));
  await userEvent.click(await screen.findByRole('button', { name: 'ОК' }));
  expect(onReset).toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Восстановить оценку' }));
  await userEvent.click(await screen.findByRole('button', { name: 'ОК' }));
  expect(onRestore).toHaveBeenCalled();
});
