import { render, screen } from '@testing-library/react';
import { App } from './App';

test('рендерит заголовок', () => {
  render(<App />);
  expect(screen.getByRole('heading')).toHaveTextContent('Обзор рынка');
});
