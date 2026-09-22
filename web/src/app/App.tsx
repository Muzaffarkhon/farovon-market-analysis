import { BrowserRouter } from 'react-router';
import { Providers } from './providers';
import { AppRoutes, BASENAME } from './routes';

export function App() {
  return (
    <Providers>
      <BrowserRouter basename={BASENAME}>
        <AppRoutes />
      </BrowserRouter>
    </Providers>
  );
}
