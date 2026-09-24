import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { authApi } from '../../api/auth';
import { ApiError } from '../../api/client';
import { Button } from '../../design/Button';
import { Input } from '../../design/Input';
import { useSession, useSessionData } from './useSession';
import s from './LoginScreen.module.css';

/**
 * Первый вход без назначенных подразделений (сервер: needsUnitPick) —
 * человек сам отмечает, за какие подразделения отвечает. Экран блокирующий:
 * RequireAuth.tsx не пускает дальше, пока units не заданы (кроме dir_head/
 * head — им назначает администратор, см. AssignmentPendingScreen).
 */
export function UnitPickScreen() {
  const { data, setData } = useSession();
  const { allUnits } = useSessionData();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allUnits;
    return allUnits.filter(u => u.unit.toLowerCase().includes(q) || u.dir.toLowerCase().includes(q));
  }, [allUnits, query]);

  function toggle(unit: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(unit)) next.delete(unit); else next.add(unit);
      return next;
    });
  }

  async function submit() {
    if (!selected.size) { setError('Выберите хотя бы одно подразделение'); return; }
    setError('');
    setBusy(true);
    try {
      const r = await authApi.setUnits(Array.from(selected));
      setData(r.data);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить выбор');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.wrap}>
      <div className={[s.card, s.cardWide].join(' ')}>
        <h1 className={s.title}>Ваши подразделения</h1>
        <p className={s.hint}>Отметьте подразделения, за которые вы отвечаете, — {data?.user.fio}.</p>
        <Input label="Поиск" placeholder="Название или направление" value={query} onChange={e => setQuery(e.target.value)} />
        <div className={s.list}>
          {filtered.map(u => (
            <label key={u.unit} className={s.listRow}>
              <input type="checkbox" checked={selected.has(u.unit)} onChange={() => toggle(u.unit)} />
              {u.unit}{u.dir ? ` — ${u.dir}` : ''}
            </label>
          ))}
          {!filtered.length && <span className={s.hint}>Ничего не найдено</span>}
        </div>
        {error && <div className={s.error} role="alert">{error}</div>}
        <Button loading={busy} disabled={!selected.size} onClick={submit}>Продолжить</Button>
      </div>
    </div>
  );
}
