import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompanyForm } from './CompanyForm';
import type { Ref, SurveyDraft } from '../../api/contract';

const refs: Ref = {
  schedules: ['5/2 · 40 часов'],
  bonusTypes: ['KPI / % от оклада'],
  bonusPeriods: ['в месяц'],
  sources: ['Интервью'],
  trust: ['высокая', 'средняя', 'низкая']
};

const empty: SurveyDraft = {
  company: 'А', posOur: 'Б', payFrom: '', payTo: '', cur: 'сомони', payPer: 'в месяц',
  bonHas: '', bonuses: [], benefits: [], extra: '', schedule: '', source: '', trust: '', note: ''
};

function setup(draft: SurveyDraft = empty) {
  const onChange = vi.fn();
  const onSave = vi.fn();
  const utils = render(
    <CompanyForm draft={draft} refs={refs} benefits={[]} saving={false} onChange={onChange} onSave={onSave} />
  );
  const rerenderWith = (next: SurveyDraft) => utils.rerender(
    <CompanyForm draft={next} refs={refs} benefits={[]} saving={false} onChange={onChange} onSave={onSave} />
  );
  return { ...utils, onChange, onSave, rerenderWith };
}

test('у новой компании раскрыт только «Оклад»', () => {
  setup();
  expect(screen.getByLabelText('Оклад от')).toBeVisible();
  expect(screen.queryByLabelText('График работы')).not.toBeInTheDocument();
});

test('заполнили оклад — сам раскрылся «График работы»', async () => {
  const { rerenderWith } = setup();
  rerenderWith({ ...empty, payFrom: '100' });
  expect(await screen.findByLabelText('График работы')).toBeVisible();
});

test('ручное закрытие блока не переоткрывается автораскрытием', async () => {
  const { rerenderWith } = setup({ ...empty, payFrom: '100' });
  await userEvent.click(screen.getByRole('button', { name: /График работы/ }));
  expect(screen.queryByLabelText('График работы')).not.toBeInTheDocument();
  rerenderWith({ ...empty, payFrom: '150' });
  expect(screen.queryByLabelText('График работы')).not.toBeInTheDocument();
});

// ── Enter: «с этим блоком закончил» ────────────────────────────────────────

/** Заполненный блок при открытии карточки свёрнут — раскрываем заголовком. */
const openBlock = (title: RegExp) => userEvent.click(screen.getByRole('button', { name: title }));

test('Enter в блоке сворачивает его и открывает следующий', async () => {
  setup();
  expect(screen.getByLabelText('Оклад от')).toBeVisible();
  await userEvent.type(screen.getByLabelText('Оклад от'), '{Enter}');
  expect(screen.queryByLabelText('Оклад от')).not.toBeInTheDocument();
  expect(await screen.findByLabelText('График работы')).toBeVisible();
});

test('Enter при ошибке в блоке не пускает дальше и показывает её сразу', async () => {
  setup({ ...empty, payFrom: 'абв' });
  await openBlock(/^Оклад/);
  await userEvent.type(screen.getByLabelText('Оклад от'), '{Enter}');
  expect(screen.getByText('Только число')).toBeVisible();
  expect(screen.getByLabelText('Оклад от')).toBeVisible();
});

test('Enter не пускает дальше, если «от» больше «до»', async () => {
  setup({ ...empty, payFrom: '9000', payTo: '1000' });
  await openBlock(/^Оклад/);
  await userEvent.type(screen.getByLabelText('Оклад до'), '{Enter}');
  expect(screen.getByText('«До» не может быть меньше «от»')).toBeVisible();
  expect(screen.getByLabelText('Оклад до')).toBeVisible();
});

test('Enter в комментарии переносит строку, а не прыгает дальше', async () => {
  const { onChange } = setup({
    ...empty, payFrom: '1', schedule: '5/2 · 40 часов', bonHas: 'нет',
    source: 'Интервью', trust: 'высокая', note: 'первая'
  });
  await userEvent.click(screen.getByRole('button', { name: /Комментарий/ }));
  await userEvent.type(screen.getByLabelText('Комментарий'), '{Enter}');
  expect(screen.getByLabelText('Комментарий')).toBeVisible();
  expect(onChange).toHaveBeenCalled();
});

test('пройденный по Enter пустой блок не открывается обратно сам', async () => {
  setup({ ...empty, payFrom: '100', schedule: '5/2 · 40 часов', bonHas: 'нет' });
  await userEvent.click(screen.getByRole('button', { name: /Льготы и соцпакет/ }));
  await userEvent.type(screen.getByLabelText('Прочие выплаты'), '{Enter}');
  expect(screen.queryByLabelText('Прочие выплаты')).not.toBeInTheDocument();
  expect(await screen.findByLabelText('Источник')).toBeVisible();
});

test('сохранение блокируется ошибкой и раскрывает нужный блок', async () => {
  const { onSave } = setup({ ...empty, payFrom: '100' });
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(onSave).not.toHaveBeenCalled();
  expect(await screen.findByText('Укажите график работы')).toBeVisible();
});

test('полная запись сохраняется', async () => {
  const { onSave } = setup({
    ...empty, payFrom: '100', payTo: '200', schedule: '5/2 · 40 часов',
    bonHas: 'нет', source: 'Интервью', trust: 'высокая'
  });
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(onSave).toHaveBeenCalled();
});

test('блок с ошибкой помечен и в свёрнутом виде', async () => {
  setup({ ...empty, payFrom: '100' });
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  const head = await screen.findByRole('button', { name: /График работы/ });
  expect(head).toHaveTextContent('!');
});

test('после неудачного сохранения курсор уводится к полю с ошибкой', async () => {
  setup({ ...empty, payFrom: '100' });
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(await screen.findByLabelText('График работы')).toHaveFocus();
});

test('ошибки сервера показываются под полями', () => {
  render(
    <CompanyForm
      draft={{ ...empty, payFrom: '100' }} refs={refs} benefits={[]} saving={false}
      serverFields={{ payFrom: 'Слишком большое число' }}
      onChange={vi.fn()} onSave={vi.fn()}
    />
  );
  expect(screen.getByText('Слишком большое число')).toBeInTheDocument();
});

test('«есть ли премии: да» открывает список видов', () => {
  setup({ ...empty, payFrom: '1', schedule: '5/2 · 40 часов', bonHas: 'да', bonuses: [{ type: '', size: '', per: '' }] });
  expect(screen.getByLabelText('Размер')).toBeInTheDocument();
});

test('счётчик заполненности не дублируется в форме — он в списке компаний', () => {
  setup({ ...empty, payFrom: '1', payTo: '2' });
  expect(screen.queryByText('2 из 9')).not.toBeInTheDocument();
});

test('ошибка снимается, как только поле исправили', async () => {
  const { rerenderWith } = setup({ ...empty, payFrom: '100' });
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(await screen.findByText('Укажите график работы')).toBeVisible();

  rerenderWith({ ...empty, payFrom: '100', schedule: '5/2 · 40 часов' });
  expect(screen.queryByText('Укажите график работы')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /График работы/ })).not.toHaveTextContent('!');
});

test('правка одного поля не гасит ошибки других', async () => {
  const { rerenderWith } = setup({ ...empty, payFrom: '100' });
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  // Заполнили только график — блок «Премии и бонусы» раскрывается сам
  // следующим, и его ошибка должна остаться на месте.
  rerenderWith({ ...empty, payFrom: '100', schedule: '5/2 · 40 часов' });
  expect(await screen.findByText('Укажите, есть ли премии')).toBeVisible();
  expect(screen.getByRole('button', { name: /Откуда данные/ })).toHaveTextContent('!');
});

// ── Премии: при «да» каждый вид должен быть заполнен целиком ───────────────

const withBonus = (bonuses: SurveyDraft['bonuses']) => ({
  ...empty, payFrom: '100', schedule: '5/2 · 40 часов',
  source: 'Интервью', trust: 'высокая', bonHas: 'да', bonuses
});

test('вид премии без периодичности не даёт сохранить', async () => {
  const { onSave } = setup(withBonus([{ type: 'KPI / % от оклада', size: '2000', per: '' }]));
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(onSave).not.toHaveBeenCalled();
  expect(await screen.findByText(/укажите вид, размер и периодичность/i)).toBeVisible();
});

test('незаполненное поле вида премии подсвечено', async () => {
  setup(withBonus([{ type: 'KPI / % от оклада', size: '2000', per: '' }]));
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(await screen.findByLabelText('Как часто')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Размер')).not.toHaveAttribute('aria-invalid');
});

test('блок премий не считается заполненным, пока вид неполный', () => {
  setup(withBonus([{ type: 'KPI / % от оклада', size: '2000', per: '' }]));
  expect(screen.getByRole('button', { name: /Премии и бонусы/ })).not.toHaveTextContent('✓');
});

test('полностью заполненный вид премии проходит', async () => {
  const { onSave } = setup(withBonus([{ type: 'KPI / % от оклада', size: '2000', per: 'в месяц' }]));
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(onSave).toHaveBeenCalled();
});

test('случайно добавленный пустой вид не мешает сохранить', async () => {
  const { onSave } = setup(withBonus([
    { type: 'KPI / % от оклада', size: '2000', per: 'в месяц' },
    { type: '', size: '', per: '' }
  ]));
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(onSave).toHaveBeenCalled();
});

test('начатый наполовину второй вид сохранить не даёт', async () => {
  const { onSave } = setup(withBonus([
    { type: 'KPI / % от оклада', size: '2000', per: 'в месяц' },
    { type: 'KPI / % от оклада', size: '', per: '' }
  ]));
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(onSave).not.toHaveBeenCalled();
});

test('Enter не пропускает дальше неполный вид премии', async () => {
  // Блок премий неполный, поэтому раскрыт сам — открывать заголовком не нужно.
  setup(withBonus([{ type: 'KPI / % от оклада', size: '2000', per: '' }]));
  await userEvent.type(screen.getByLabelText('Размер'), '{Enter}');
  expect(screen.getByText(/укажите вид, размер и периодичность/i)).toBeVisible();
  expect(screen.getByLabelText('Как часто')).toBeVisible();
});
