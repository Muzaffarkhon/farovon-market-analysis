import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RiskList } from './RiskList';
import type { KeyRisk, SessionData } from '../../api/contract';

let session = { user: { role: 'hrbp' } } as unknown as SessionData;
vi.mock('../auth/useSession', () => ({ useSessionData: () => session }));

const risk = (over: Partial<KeyRisk> = {}): KeyRisk => ({
  id: 1, unit: 'Цех 1', employee_fio: 'Иванов Иван', job_title: 'Мастер',
  bus_factor: 4, replacement_time: 4, knowledge_monopoly: 3, financial_risk: 4,
  total_risk_score: 15, risk_status: 'critical', action_plan: 'Назначить дублёра', evaluator_fio: 'HR', updated_at: '', ...over
});

test('не admin не видит кнопку «Удалить»', () => {
  session = { user: { role: 'hrbp' } } as unknown as SessionData;
  render(<RiskList rows={[risk()]} onEdit={() => {}} onDelete={() => {}} />);
  expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument();
});

test('admin видит и может нажать «Удалить»', async () => {
  session = { user: { role: 'admin' } } as unknown as SessionData;
  const onDelete = vi.fn();
  render(<RiskList rows={[risk()]} onEdit={() => {}} onDelete={onDelete} />);
  await userEvent.click(screen.getByRole('button', { name: 'Удалить' }));
  expect(onDelete).toHaveBeenCalledWith(1);
});

test('«Оценить заново» передаёт саму запись', async () => {
  session = { user: { role: 'hrbp' } } as unknown as SessionData;
  const onEdit = vi.fn();
  const row = risk();
  render(<RiskList rows={[row]} onEdit={onEdit} onDelete={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: 'Оценить заново' }));
  expect(onEdit).toHaveBeenCalledWith(row);
});

test('без записей — сообщение', () => {
  session = { user: { role: 'hrbp' } } as unknown as SessionData;
  render(<RiskList rows={[]} onEdit={() => {}} onDelete={() => {}} />);
  expect(screen.getByText('Никто не требует особого внимания.')).toBeInTheDocument();
});
