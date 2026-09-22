import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accessApi } from '../../api/access';
import { ApiError } from '../../api/client';
import type { Grant } from '../../api/contract';
import { Button } from '../../design/Button';
import { Input } from '../../design/Input';
import { Skeleton } from '../../design/Skeleton';
import { useToast } from '../../design/Toast';
import { groupCapabilities } from './groupCapabilities';
import s from './Access.module.css';

type CapState = 'none' | 'byRole' | 'grant' | 'deny';

function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

export function PersonalGrantsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['userCapabilities'], queryFn: accessApi.userCapabilities });
  const [search, setSearch] = useState('');
  const [login, setLogin] = useState('');
  const [granted, setGranted] = useState<Set<string>>(new Set());
  const [denied, setDenied] = useState<Set<string>>(new Set());
  const [expiresAt, setExpiresAt] = useState('');

  const user = q.data?.users.find(u => u.login === login);
  const roleCaps = useMemo(() => new Set(user ? q.data?.roleCapabilities[user.role] ?? [] : []), [user, q.data]);
  const userGrants: Grant[] = useMemo(() => (q.data?.grants ?? []).filter(g => g.userLogin === login), [q.data, login]);

  // При выборе сотрудника — состояние из его текущих записей.
  useEffect(() => {
    setGranted(new Set(userGrants.filter(g => g.effect === 'grant').map(g => g.capability)));
    setDenied(new Set(userGrants.filter(g => g.effect === 'deny').map(g => g.capability)));
    setExpiresAt(toDateInput(userGrants[0]?.expiresAt ?? null));
  }, [userGrants]);

  const save = useMutation({
    mutationFn: () => accessApi.setUserCapabilities({
      userLogin: login, capabilities: [...granted], denied: [...denied],
      expiresAt: expiresAt ? new Date(expiresAt + 'T23:59:59').toISOString() : null
    }),
    onSuccess: () => { toast.show('Сохранено', 'ok'); void qc.invalidateQueries({ queryKey: ['userCapabilities'] }); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось сохранить', 'error')
  });

  if (q.isLoading) return <Skeleton lines={8} />;
  if (q.error || !q.data) return <p className={s.empty}>{q.error instanceof ApiError ? q.error.message : 'Не удалось загрузить'}</p>;

  const users = q.data.users.filter(u => u.role !== 'admin' && (!search || u.fio.toLowerCase().includes(search.toLowerCase()) || u.login.toLowerCase().includes(search.toLowerCase())));
  const groups = groupCapabilities(q.data.capabilities);

  function stateOf(cap: string): CapState {
    if (granted.has(cap)) return 'grant';
    if (denied.has(cap)) return 'deny';
    if (roleCaps.has(cap)) return 'byRole';
    return 'none';
  }
  function toggle(cap: string) {
    if (roleCaps.has(cap)) {
      setDenied(d => { const n = new Set(d); if (n.has(cap)) n.delete(cap); else n.add(cap); return n; });
      setGranted(g => { const n = new Set(g); n.delete(cap); return n; });
    } else {
      setGranted(g => { const n = new Set(g); if (n.has(cap)) n.delete(cap); else n.add(cap); return n; });
    }
  }
  const stateLabel: Record<CapState, string> = { none: '', byRole: 'по роли', grant: 'лично', deny: 'отключено' };

  return (
    <div className={s.split}>
      <div>
        <Input label="Сотрудник" placeholder="Поиск по ФИО или логину" value={search} onChange={e => setSearch(e.target.value)} />
        <div className={s.userList} style={{ marginTop: 8 }}>
          {users.map(u => (
            <button key={u.login} type="button" className={[s.userBtn, u.login === login ? s.selected : ''].join(' ')} onClick={() => setLogin(u.login)}>
              {u.fio}<div className={s.sub}>{q.data!.roleLabels[u.role] ?? u.role}{u.active ? '' : ' · заблокирован'}</div>
            </button>
          ))}
        </div>
      </div>
      {user ? (
        <div className={s.panel}>
          <strong>{user.fio}</strong>
          {groups.map(g => (
            <div key={g.resource}>
              <div className={s.sub} style={{ marginBottom: 4 }}>{g.label}</div>
              {g.items.map(c => {
                const st = stateOf(c.id);
                const checked = st === 'grant' || st === 'byRole';
                return (
                  <div key={c.id} className={s.capRow}>
                    <input id={'cap-' + c.id} type="checkbox" className={s.check} checked={checked} onChange={() => toggle(c.id)} />
                    <label htmlFor={'cap-' + c.id}>{c.label}</label>
                    {st !== 'none' && <span className={[s.state, s[st]].join(' ')}>{stateLabel[st]}</span>}
                  </div>
                );
              })}
            </div>
          ))}
          <div className={s.footer}>
            <Input label="Действует до" type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} hint="Пусто — бессрочно" />
            <Button onClick={() => save.mutate()} loading={save.isPending}>Сохранить</Button>
          </div>
          {userGrants.length > 0 && (
            <div className={s.sub}>
              Сейчас: {userGrants.map(g => `${g.capability} (${g.effect === 'deny' ? 'отключено' : 'выдано'}${g.expiresAt ? ' до ' + toDateInput(g.expiresAt) : ''}, ${g.grantedBy || '—'})`).join('; ')}
            </div>
          )}
        </div>
      ) : (
        <p className={s.empty}>Выберите сотрудника слева.</p>
      )}
    </div>
  );
}
