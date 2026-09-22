import { useParams } from 'react-router';
import { useScreenTitle } from '../shell/Shell';

export function SheetScreen() {
  const { position = '' } = useParams();
  useScreenTitle(position);
  return <p>Лист заполнения — в работе.</p>;
}
