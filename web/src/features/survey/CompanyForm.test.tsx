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
