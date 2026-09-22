import { useParams } from 'react-router';
import { useScreenTitle } from '../shell/Shell';

export function UnitScreen() {
  const { unit = '' } = useParams();
  useScreenTitle(unit);
  return <p>Экран подразделения — в работе.</p>;
}
