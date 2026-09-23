import type { CoordinationPerson } from '../../api/contract';
import { Badge } from '../../design/Badge';
import { shortDate } from '../registry/format';
import s from './Coordination.module.css';

/** Люди с их охватом — чекбоксы для выбора адресатов напоминания. */
export function PeopleProgress({ people, selected, onToggle }: {
  people: CoordinationPerson[];
  selected: Set<string>;
  onToggle: (login: string) => void;
}) {
  return (
    <div className={s.column}>
      <h3 className={s.sectionTitle}>Люди</h3>
      {people.map(p => (
        <label key={p.login} className={s.personRow}>
          <input
            type="checkbox" aria-label={p.fio}
            checked={selected.has(p.login)}
            onChange={() => onToggle(p.login)}
          />
          <span className={s.personMain}>
            <b>{p.fio}</b>
            <span className={s.personMeta}>
              {p.positionsDecided} из {p.positionsTotal}
              {p.lastLoginAt ? ` · заходил ${shortDate(p.lastLoginAt)}` : ' · ещё не заходил'}
            </span>
          </span>
          {!p.hasTelegram && <Badge tone="warn">нет Telegram</Badge>}
        </label>
      ))}
      {!people.length && <p className={s.empty}>Людей не найдено.</p>}
    </div>
  );
}
