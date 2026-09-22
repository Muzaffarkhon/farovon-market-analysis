import { Button } from '../../design/Button';
import { Sheet } from '../../design/Sheet';
import s from './Survey.module.css';

/**
 * Разнос по смежной группе должен быть видимым: перед сохранением показываем,
 * на сколько площадок уйдут данные, с возможностью отказаться (ТЗ 3.3).
 */
export function GroupSpreadDialog({ open, units, onClose, onOnlyHere, onSpread }: {
  open: boolean;
  units: string[];
  onClose: () => void;
  onOnlyHere: () => void;
  onSpread: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Данные уйдут на несколько площадок"
      footer={
        <div className={s.actions}>
          <Button onClick={onSpread}>На все {units.length}</Button>
          <Button variant="secondary" onClick={onOnlyHere}>Только сюда</Button>
        </div>
      }
    >
      <p style={{ marginTop: 0 }}>
        У этого подразделения есть смежные площадки с такой же должностью. Запись сохранится сразу во всех:
      </p>
      <ul>
        {units.map(u => <li key={u}>{u}</li>)}
      </ul>
    </Sheet>
  );
}
