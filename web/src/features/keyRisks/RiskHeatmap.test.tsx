import { render, screen } from '@testing-library/react';
import { RiskHeatmap } from './RiskHeatmap';

test('строка направления показывает три уровня риска', () => {
  render(<RiskHeatmap rows={[{ dir: 'Дивизион Север', standard: 5, attention: 2, critical: 1, total: 8 }]} />);
  expect(screen.getByText('Дивизион Север')).toBeInTheDocument();
  expect(screen.getByText('5')).toBeInTheDocument();
  expect(screen.getByText('2')).toBeInTheDocument();
  expect(screen.getByText('1')).toBeInTheDocument();
});

test('нулевые ячейки показывают прочерк', () => {
  render(<RiskHeatmap rows={[{ dir: 'Цех', standard: 0, attention: 0, critical: 0, total: 0 }]} />);
  expect(screen.getAllByText('—')).toHaveLength(3);
});

test('пустая карта — сообщение', () => {
  render(<RiskHeatmap rows={[]} />);
  expect(screen.getByText('Пока ничего не оценено.')).toBeInTheDocument();
});
