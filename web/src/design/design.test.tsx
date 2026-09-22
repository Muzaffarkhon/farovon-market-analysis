import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button';
import { Input } from './Input';
import { Sheet } from './Sheet';
import { Badge } from './Badge';
import { Select } from './Select';

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
