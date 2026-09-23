import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RiskForm } from './RiskForm';
import * as api from '../../api/keyRisks';
import type { GradingFactor, SessionData } from '../../api/contract';

const session = {
  units: [{ unit: 'Цех 1', dir: '', group: '', total: 0, done: 0, surveys: 0, note: '' }]
} as unknown as SessionData;
vi.mock('../auth/useSession', () => ({ useSessionData: () => session }));

const riskFactors: GradingFactor[] = [
  { code: 'К1', title: 'Незаменимость', help: '', options: ['О1', 'О2', 'О3', 'О4', 'О5'], examples: [] },
  { code: 'К2', title: 'Срок замены', help: '', options: ['О1', 'О2', 'О3', 'О4', 'О5'], examples: [] },
  { code: 'К3', title: 'Монополия на знания', help: '', options: ['О1', 'О2', 'О3', 'О4', 'О5'], examples: [] },
  { code: 'К4', title: 'Финансовый риск', help: '', options: ['О1', 'О2', 'О3', 'О4', 'О5'], examples: [] }
];

let unitEmployees: ReturnType<typeof vi.fn>;

/** Подразделение и сотрудник — Combobox (поиск), не нативный select. */
async function pick(label: string, optionName: string | RegExp) {
  await userEvent.click(screen.getByLabelText(label));
  await userEvent.click(await screen.findByRole('option', { name: optionName }));
}

function renderForm(props: Partial<Parameters<typeof RiskForm>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RiskForm riskFactors={riskFactors} editing={null} onClose={() => {}} onSubmit={() => {}} submitting={false} {...props} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  unitEmployees = vi.fn().mockResolvedValue({ ok: true, rows: [{ fio: 'Иванов Иван', position: 'Мастер' }] });
  vi.spyOn(api, 'keyRisksApi', 'get').mockReturnValue({ unitEmployees, evaluate: vi.fn(), list: vi.fn(), heatmap: vi.fn(), delete: vi.fn() } as never);
});

test('выбор подразделения подгружает сотрудников этого юнита', async () => {
  renderForm();
  await pick('Подразделение', 'Цех 1');
  await waitFor(() => expect(unitEmployees).toHaveBeenCalledWith('Цех 1'));
  await userEvent.click(screen.getByLabelText('Сотрудник'));
  expect(await screen.findByRole('option', { name: 'Иванов Иван' })).toBeInTheDocument();
});

test('отправка передаёт подразделение, сотрудника, должность и все четыре ответа', async () => {
  const onSubmit = vi.fn();
  renderForm({ onSubmit });
  await pick('Подразделение', 'Цех 1');
  await pick('Сотрудник', 'Иванов Иван');
  await userEvent.selectOptions(screen.getByLabelText('Незаменимость'), '4');
  await userEvent.selectOptions(screen.getByLabelText('Срок замены'), '3');
  await userEvent.selectOptions(screen.getByLabelText('Монополия на знания'), '2');
  await userEvent.selectOptions(screen.getByLabelText('Финансовый риск'), '5');
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить оценку' }));
  expect(onSubmit).toHaveBeenCalledWith({
    unit: 'Цех 1', employee_fio: 'Иванов Иван', job_title: 'Мастер',
    bus_factor: 4, replacement_time: 3, knowledge_monopoly: 2, financial_risk: 5,
    action_plan: ''
  });
});

test('кнопка выключена, пока не заполнены все ответы', async () => {
  renderForm();
  expect(screen.getByRole('button', { name: 'Сохранить оценку' })).toBeDisabled();
});

test('сотрудник без должности в справочнике — подсказка видна, кнопка не блокируется этим (как в старом клиенте, решает сервер)', async () => {
  unitEmployees.mockResolvedValue({ ok: true, rows: [{ fio: 'Без должности', position: '' }] });
  renderForm();
  await pick('Подразделение', 'Цех 1');
  await pick('Сотрудник', /Без должности/);
  expect(await screen.findByText(/не указана в справочнике штата/)).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Незаменимость'), '1');
  await userEvent.selectOptions(screen.getByLabelText('Срок замены'), '1');
  await userEvent.selectOptions(screen.getByLabelText('Монополия на знания'), '1');
  await userEvent.selectOptions(screen.getByLabelText('Финансовый риск'), '1');
  expect(screen.getByRole('button', { name: 'Сохранить оценку' })).toBeEnabled();
});
