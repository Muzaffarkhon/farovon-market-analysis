import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssignmentPendingScreen } from './AssignmentPendingScreen';

const refresh = vi.fn().mockResolvedValue(undefined);
const logout = vi.fn();
vi.mock('./useSession', () => ({ useSession: () => ({ refresh, logout }) }));

test('«Проверить снова» перечитывает сессию', async () => {
  const user = userEvent.setup();
  render(<AssignmentPendingScreen />);
  await user.click(screen.getByRole('button', { name: 'Проверить снова' }));
  expect(refresh).toHaveBeenCalled();
});
