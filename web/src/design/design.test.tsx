import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';
import { Input } from './Input';
import { Sheet } from './Sheet';
import { Badge } from './Badge';
import { Select } from './Select';
import { Combobox } from './Combobox';
import { KpiTile } from './KpiTile';
import { ForkBar } from './ForkBar';
import { RankBar } from './RankBar';
import { ScaleInput } from './ScaleInput';

test('Button loading блокирует и помечает aria-busy', () => {
  render(<Button loading>Сохранить</Button>);
  const b = screen.getByRole('button', { name: 'Сохранить' });
  expect(b).toBeDisabled();
  expect(b).toHaveAttribute('aria-busy', 'true');
});

test('Input показывает ошибку и связывает её с полем', () => {
  render(<Input label="Оклад от" error="Только число" />);
  const i = screen.getByLabelText('Оклад от');
  expect(i).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText('Только число')).toBeInTheDocument();
});

test('Select с placeholder даёт пустой первый вариант', () => {
  render(<Select label="График" placeholder="— не выбрано —" options={[{ value: 'a', label: 'А' }]} />);
  const sel = screen.getByLabelText('График') as HTMLSelectElement;
  expect(sel.options).toHaveLength(2);
  expect(sel.options[0].value).toBe('');
});

const cities = [{ value: 'khu', label: 'Худжанд' }, { value: 'dus', label: 'Душанбе' }, { value: 'buston', label: 'Бустон' }];

test('Combobox: список открывается по фокусу и фильтруется по вводу', async () => {
  render(<Combobox label="Город" options={cities} value="" onChange={() => {}} />);
  const input = screen.getByLabelText('Город');
  await userEvent.click(input);
  expect(screen.getByRole('option', { name: 'Худжанд' })).toBeInTheDocument();
  await userEvent.type(input, 'буст');
  expect(screen.queryByRole('option', { name: 'Худжанд' })).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Бустон' })).toBeInTheDocument();
});

test('Combobox: клик по варианту вызывает onChange и закрывает список', async () => {
  const onChange = vi.fn();
  render(<Combobox label="Город" options={cities} value="" onChange={onChange} />);
  await userEvent.click(screen.getByLabelText('Город'));
  await userEvent.click(screen.getByRole('option', { name: 'Душанбе' }));
  expect(onChange).toHaveBeenCalledWith('dus');
  expect(screen.queryByRole('option', { name: 'Душанбе' })).not.toBeInTheDocument();
});

test('Combobox: выбранное значение показано подписью, не кодом', () => {
  render(<Combobox label="Город" options={cities} value="khu" onChange={() => {}} />);
  expect(screen.getByLabelText('Город')).toHaveValue('Худжанд');
});

test('Combobox: кнопка «Очистить» сбрасывает значение', async () => {
  const onChange = vi.fn();
  render(<Combobox label="Город" options={cities} value="khu" onChange={onChange} />);
  await userEvent.click(screen.getByLabelText('Очистить'));
  expect(onChange).toHaveBeenCalledWith('');
});

test('Sheet закрывается по Esc', () => {
  const onClose = vi.fn();
  render(<Sheet open onClose={onClose} title="Компании">x</Sheet>);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).toHaveBeenCalled();
});

test('Badge выводит текст', () => {
  render(<Badge tone="ok">40 из 40</Badge>);
  expect(screen.getByText('40 из 40')).toBeInTheDocument();
});

test('KpiTile показывает число, единицу и подпись', () => {
  render(<KpiTile label="Медиана рынка" value="7 400" unit="сомони" />);
  expect(screen.getByText('Медиана рынка')).toBeInTheDocument();
  expect(screen.getByText('7 400')).toBeInTheDocument();
  expect(screen.getByText('сомони')).toBeInTheDocument();
});

const forkStats = { count: 5, min: 2000, p25: 3000, median: 4000, p75: 5000, max: 6000, avg: 4000 };

test('ForkBar рисует подпись и правое значение', () => {
  render(<ForkBar label="Бухгалтер" stats={forkStats} domainMax={10000} rightValue="4 000" />);
  expect(screen.getByText('Бухгалтер')).toBeInTheDocument();
  expect(screen.getByText('4 000')).toBeInTheDocument();
});

test('RankBar показывает процент и подпись, ширина полосы ограничена 0–100%', () => {
  const { container } = render(<RankBar label="ДМС" pct={130} count={12} />);
  expect(screen.getByText('ДМС')).toBeInTheDocument();
  expect(screen.getByText(/130%/)).toBeInTheDocument();
  const bar = container.querySelector('i') as HTMLElement;
  expect(bar.style.width).toBe('100%');
});

const scaleOptions = ['Первый вариант', 'Второй вариант', 'Третий вариант', 'Четвёртый вариант', 'Пятый вариант'];
const scaleExamples = ['Уборщик', 'Кассир', 'Мастер', 'Директор направления', 'Генеральный директор'];

test('ScaleInput: кнопки подписаны буквами, не баллом, и каждая ведёт на свой уникальный балл', async () => {
  const onChange = vi.fn();
  render(<ScaleInput label="К1" value={0} onChange={onChange} options={scaleOptions} />);
  const buttons = screen.getAllByRole('button');
  expect(buttons.map(b => b.textContent)).toEqual(['a', 'b', 'c', 'd', 'e']);
  for (const b of buttons) await userEvent.click(b);
  expect(onChange.mock.calls.map(c => c[0]).sort()).toEqual([1, 2, 3, 4, 5]);
});

test('ScaleInput: повторный клик по уже выбранной букве снимает ответ', async () => {
  const onChange = vi.fn();
  const { rerender } = render(<ScaleInput label="К1" value={0} onChange={onChange} options={scaleOptions} />);
  const first = screen.getAllByRole('button')[0];
  await userEvent.click(first);
  const chosenScore = onChange.mock.calls[0][0];
  rerender(<ScaleInput label="К1" value={chosenScore} onChange={onChange} options={scaleOptions} />);
  await userEvent.click(screen.getByRole('button', { pressed: true }));
  expect(onChange).toHaveBeenLastCalledWith(0);
});

test('ScaleInput: эталон показан только под выбранным вариантом', () => {
  render(<ScaleInput label="К1" value={2} onChange={() => {}} options={scaleOptions} examples={scaleExamples} />);
  expect(screen.getByText(/Кассир/)).toBeInTheDocument();
  expect(screen.queryByText(/Мастер/)).not.toBeInTheDocument();
});

test('ScaleInput: без выбора текст варианта не показан', () => {
  render(<ScaleInput label="К1" value={0} onChange={() => {}} options={scaleOptions} />);
  expect(screen.queryByText('Первый вариант')).not.toBeInTheDocument();
});
