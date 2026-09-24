import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CoordinationScreen } from './CoordinationScreen';
import { ToastHost } from '../../design/Toast';
import * as api from '../../api/coordination';
import type { CoordinationResponse } from '../../api/contract';

vi.mock('../shell/Shell', () => ({ useScreenTitle: () => {} }));

const data: CoordinationResponse = {
  ok: true,
  units: [{ unit: 'Цех 1', dir: 'Дивизион Север', hrbp: '', resp: '', head: '', positionsTotal: 5, positionsDecided: 3, state: 'в процессе', lastActivityAt: '' }],
  people: [
    { login: 'ivanov', fio: 'Иванов Иван', units: ['Цех 1'], positionsTotal: 5, positionsDecided: 3, lastLoginAt: '2026-09-01', hasTelegram: true },
    { login: 'petrov', fio: 'Петров Пётр', units: ['Цех 1'], positionsTotal: 5, positionsDecided: 3, lastLoginAt: '', hasTelegram: false }
  ],
  feed: []
};

let get: ReturnType<typeof vi.fn>;
let remind: ReturnType<typeof vi.fn>;

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastHost><CoordinationScreen /></ToastHost>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  get = vi.fn().mockResolvedValue(data);
  remind = vi.fn().mockResolvedValue({ ok: true, sent: 1, skipped: 1 });
  vi.spyOn(api, 'coordinationApi', 'get').mockReturnValue({ get, remind } as never);
});

test('кнопка «Напомнить» выключена, пока никто не выбран', async () => {
  renderScreen();
  expect(await screen.findByRole('button', { name: 'Напомнить' })).toBeDisabled();
});

async function expandDir() {
  await userEvent.click(await screen.findByText(/Дивизион Север/));
}

test('выбор людей включает кнопку и отправляет ровно выбранные логины', async () => {
  renderScreen();
  await expandDir();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Иванов Иван' }));
  const btn = screen.getByRole('button', { name: /Напомнить/ });
  expect(btn).toBeEnabled();
  await userEvent.click(btn);
  await waitFor(() => expect(remind).toHaveBeenCalledWith(['ivanov']));
});

test('после отправки показан тост с числами из ответа сервера', async () => {
  renderScreen();
  await expandDir();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Иванов Иван' }));
  await userEvent.click(screen.getByRole('button', { name: /Напомнить/ }));
  expect(await screen.findByText(/Отправлено 1, пропущено 1/)).toBeInTheDocument();
});

test('без подразделений — сообщение вместо колонок', async () => {
  get.mockResolvedValue({ ok: true, units: [], people: [], feed: [] });
  renderScreen();
  expect(await screen.findByText('Закреплённых направлений не найдено.')).toBeInTheDocument();
});
