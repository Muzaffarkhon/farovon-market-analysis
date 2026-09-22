import { Badge } from '../../design/Badge';
import { Button } from '../../design/Button';
import s from './Survey.module.css';

/**
 * «Сравнивать не с кем» — полноценный ответ, а не пропуск (ТЗ 3.1).
 * Решение обратимо: можно передумать и добавить компанию.
 */
export function NoComparisonButton({ marked, busy, onMark, onClear, size = 'md', showBadge = true }: {
  marked: boolean;
  busy: boolean;
  onMark: () => void;
  onClear: () => void;
  size?: 'md' | 'sm';
  /** На карточке должности состояние уже показано бейджем — второй раз не повторяем. */
  showBadge?: boolean;
}) {
  if (marked) {
    return (
      <span className={s.noCmp}>
        {showBadge && <Badge tone="muted">не с кем</Badge>}
        <Button variant="ghost" size="sm" loading={busy} onClick={onClear}>Передумал</Button>
      </span>
    );
  }
  return (
    <Button variant="secondary" size={size} loading={busy} onClick={onMark}>
      Сравнивать не с кем
    </Button>
  );
}
