import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accessApi } from '../../api/access';
import { ApiError } from '../../api/client';
import { Skeleton } from '../../design/Skeleton';
import { useToast } from '../../design/Toast';
import { groupCapabilities } from './groupCapabilities';
import s from './Access.module.css';

export function RoleMatrixTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['roleMatrix'], queryFn: accessApi.roleMatrix });
  const save = useMutation({
    mutationFn: (a: { role: string; capabilities: string[] }) => accessApi.saveRole(a.role, a.capabilities),
    onSuccess: () => { toast.show('Сохранено', 'ok'); void qc.invalidateQueries({ queryKey: ['roleMatrix'] }); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось сохранить', 'error')
  });

  if (q.isLoading) return <Skeleton lines={8} />;
  if (q.error || !q.data) return <p className={s.empty}>{q.error instanceof ApiError ? q.error.message : 'Не удалось загрузить'}</p>;

  const { roles, matrix, capabilities } = q.data;
  const editable = roles.filter(r => !r.is_admin);
  const groups = groupCapabilities(capabilities);

  function toggle(role: string, cap: string) {
    const current = matrix[role] ?? [];
    const next = current.includes(cap) ? current.filter(c => c !== cap) : [...current, cap];
    save.mutate({ role, capabilities: next });
  }

  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Право</th>
            {editable.map(r => (
              <th key={r.key} className={s.role} title={r.note}>
                {r.label}<div className={s.sub}>{r.users} чел.</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <GroupRows key={g.resource} label={g.label} caps={g.items} roles={editable.map(r => r.key)} matrix={matrix} onToggle={toggle} busy={save.isPending} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupRows({ label, caps, roles, matrix, onToggle, busy }: {
  label: string; caps: { id: string; label: string }[]; roles: string[];
  matrix: Record<string, string[]>; onToggle: (role: string, cap: string) => void; busy: boolean;
}) {
  return (
    <>
      <tr className={s.groupRow}><td colSpan={roles.length + 1}>{label}</td></tr>
      {caps.map(c => (
        <tr key={c.id}>
          <td className={s.capName}>{c.label}</td>
          {roles.map(r => (
            <td key={r} className={s.cell}>
              <input
                type="checkbox"
                className={s.check}
                aria-label={`${c.label} — ${r}`}
                checked={(matrix[r] ?? []).includes(c.id)}
                disabled={busy}
                onChange={() => onToggle(r, c.id)}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
