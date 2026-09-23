import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { BlocksList } from './BlocksList';
import type { GradingBlock } from '../../api/contract';

const block = (over: Partial<GradingBlock> = {}): GradingBlock => ({
  key: 'office', label: 'Офис', sort: 1, position_count: 10, evaluated_count: 4, ...over
});

test('карточка блока показывает прогресс и ведёт на /grading/<key>', () => {
  render(<MemoryRouter><BlocksList blocks={[block()]} /></MemoryRouter>);
  expect(screen.getByText('Офис')).toBeInTheDocument();
  expect(screen.getByText('4 из 10 оценено')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Офис/ })).toHaveAttribute('href', '/grading/office');
});

test('без блоков — сообщение', () => {
  render(<MemoryRouter><BlocksList blocks={[]} /></MemoryRouter>);
  expect(screen.getByText('Блоки не настроены.')).toBeInTheDocument();
});
