import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button';
import { Input } from './Input';
import { Sheet } from './Sheet';
import { Badge } from './Badge';
import { Select } from './Select';
import { KpiTile } from './KpiTile';
import { ForkBar } from './ForkBar';
import { RankBar } from './RankBar';

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
