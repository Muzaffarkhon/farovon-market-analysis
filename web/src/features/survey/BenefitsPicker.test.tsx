import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BenefitsPicker } from './BenefitsPicker';

const groups = [
  { category: 'Здоровье и страхование', items: ['Медицинское страхование (ДМС)', 'Страхование жизни'] },
  { category: 'Транспорт', items: ['Компенсация ГСМ', 'Служебный автомобиль'] }
];

test('частые льготы видны сразу, разделы свёрнуты', () => {
  render(<BenefitsPicker groups={groups} selected={[]} onChange={() => {}} />);
  expect(screen.getByRole('button', { name: 'Медицинское страхование (ДМС)' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Компенсация ГСМ' })).not.toBeInTheDocument();
});

test('раздел раскрывается заголовком, частая льгота в нём не повторяется', async () => {
  render(<BenefitsPicker groups={groups} selected={[]} onChange={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: /Здоровье и страхование/ }));
  expect(screen.getByRole('button', { name: 'Страхование жизни' })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Медицинское страхование (ДМС)' })).toHaveLength(1);
});

test('свёрнутый раздел показывает, что в нём отмечено', () => {
  render(<BenefitsPicker groups={groups} selected={['Компенсация ГСМ']} onChange={() => {}} />);
  expect(screen.getByText('Компенсация ГСМ')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Компенсация ГСМ' })).not.toBeInTheDocument();
});
