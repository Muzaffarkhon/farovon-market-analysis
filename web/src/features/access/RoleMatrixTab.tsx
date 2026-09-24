import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RoleInfo } from '../../api/contract';
import { accessApi } from '../../api/access';
import { ApiError } from '../../api/client';
import { Button } from '../../design/Button';
import { useConfirm } from '../../design/Confirm';
import { Skeleton } from '../../design/Skeleton';
import { useToast } from '../../design/Toast';
import { CreateRoleForm } from './CreateRoleForm';
import { groupCapabilities } from './groupCapabilities';
import s from './Access.module.css';

/**
 * Конструктор ролей из старого клиента (client/app.js, roleAdd/roleSaveAll):
 * создание и переименование — обычные операции, но удаление роли необратимо
 * и сервер сам блокирует его, пока на роли остались активные пользователи
 * (см. adminController.deleteRole) — подтверждение здесь только предупреждает
 * о необратимости, проверку по факту делает бэкенд.
 */
export function RoleMatrixTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['roleMatrix'], queryFn: accessApi.roleMatrix });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['roleMatrix'] });

  const save = useMutation({
    mutationFn: (a: { role: string; capabilities: string[] }) => accessApi.saveRole(a.role, a.capabilities),
    onSuccess: () => { toast.show('Сохранено', 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось сохранить', 'error')
  });

  const create = useMutation({
    mutationFn: (label: string) => accessApi.createRole(label),
    onSuccess: r => { toast.show(`Роль «${r.label}» создана`, 'ok'); invalidate(); setCreating(false); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось создать роль', 'error')
  });

  const rename = useMutation({
    mutationFn: (a: { key: string; label: string }) => accessApi.renameRole(a.key, a.label),
    onSuccess: () => { toast.show('Роль переименована', 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось переименовать', 'error')
  });

  const remove = useMutation({
    mutationFn: (key: string) => accessApi.deleteRole(key),
    onSuccess: () => { toast.show('Роль удалена', 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось удалить роль', 'error')
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

  async function doDelete(role: RoleInfo) {
    const ok = await confirm({
      title: 'Удалить роль',
      message: `Роль «${role.label}» и её права будут удалены. Действие необратимо.`,
      okLabel: 'Удалить', danger: true
    });
    if (ok) remove.mutate(role.key);
  }

  return (
    <div className={s.tableWrapFill}>
      <div className={s.footer} style={{ borderTop: 'none', paddingTop: 0 }}>
        <div />
        <Button size="sm" onClick={() => setCreating(true)}>Создать роль</Button>
      </div>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Право</th>
            {editable.map(r => (
              <th key={r.key} className={s.role} title={r.note}>
                <RoleHeader role={r} onRename={label => rename.mutate({ key: r.key, label })} onDelete={() => doDelete(r)} />
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

      {creating && (
        <CreateRoleForm submitting={create.isPending} onClose={() => setCreating(false)} onSubmit={label => create.mutate(label)} />
      )}
    </div>
  );
}

function RoleHeader({ role, onRename, onDelete }: { role: RoleInfo; onRename: (label: string) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(role.label);

  function save() {
    setEditing(false);
    const trimmed = label.trim();
    if (trimmed && trimmed !== role.label) onRename(trimmed);
    else setLabel(role.label);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      {editing ? (
        <input
          autoFocus
          value={label}
          onChange={e => setLabel(e.target.value)}
          onBlur={save}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setLabel(role.label); setEditing(false); } }}
          style={{ width: '100%', textAlign: 'center' }}
        />
      ) : (
        <button type="button" className={s.userBtn} style={{ padding: 0, minHeight: 0, fontWeight: 600 }} onClick={() => setEditing(true)}>
          {role.label}
        </button>
      )}
      <div className={s.sub}>{role.users} чел.</div>
      {!role.is_protected && (
        <button
          type="button"
          className={s.userBtn}
          style={{ padding: 0, minHeight: 0, color: 'var(--danger)', fontWeight: 'normal', opacity: role.users > 0 ? 0.5 : 1, cursor: role.users > 0 ? 'not-allowed' : 'pointer' }}
          disabled={role.users > 0}
          title={role.users > 0 ? 'Роль назначена пользователям — сначала смените им роль' : undefined}
          onClick={onDelete}
        >
          Удалить
        </button>
      )}
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
