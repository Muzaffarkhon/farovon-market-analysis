import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Badge } from '../../design/Badge';
import { Card } from '../../design/Card';
import { Input } from '../../design/Input';
import { useSessionData } from '../auth/useSession';
import { useScreenTitle } from '../shell/Shell';
import s from './Survey.module.css';

export function UnitsScreen() {
  useScreenTitle('Подразделения');
  const { units, user } = useSessionData();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return units;
    return units.filter(u => u.unit.toLowerCase().includes(q) || (u.dir || '').toLowerCase().includes(q));
  }, [units, search]);

  if (!units.length) {
    return (
      <p className={s.empty}>
        {user.role === 'admin' || user.role === 'cb'
          ? 'Подразделения не заведены.'
          : 'Вам пока не назначено ни одного подразделения — обратитесь к HR BP.'}
      </p>
    );
  }

  return (
    <div>
      {units.length > 3 && (
        <div className={s.head}>
          <Input className={s.search} label="Поиск" placeholder="Подразделение или направление" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      )}
      <div className={s.list}>
        {shown.map(u => (
          <Card key={u.unit} onClick={() => navigate(`/survey/${encodeURIComponent(u.unit)}`)} arrow>
            <div className={s.cardTop}>
              <span className={s.cardTitle}>{u.unit}</span>
              {u.surveys > 0 && <Badge tone="ok">{u.surveys} записей</Badge>}
            </div>
            {u.dir && <div className={s.cardSub}>{u.dir}</div>}
          </Card>
        ))}
        {!shown.length && <p className={s.empty}>Ничего не найдено.</p>}
      </div>
    </div>
  );
}
