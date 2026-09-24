import type { LockGroup } from '../../../api/contract';
import { Button } from '../../../design/Button';
import { useConfirm } from '../../../design/Confirm';
import { Sheet } from '../../../design/Sheet';
import { Skeleton } from '../../../design/Skeleton';
import s from '../Admin.module.css';

/**
 * «Блокировка» здесь — не технический лок, а авторство: последняя правка
 * строки участника рынка/анкеты хранит имя автора (`updated_by`/`created_by`),
 * и пока оно стоит, строку не может взять на себя другой сборщик того же
 * подразделения. Снятие — просто очистка этого поля.
 */
export function LocksSheet({ locks, loading, unlocking, onUnlock, onClose }: {
  locks: LockGroup[] | undefined;
  loading: boolean;
  unlocking: boolean;
  onUnlock: (a: { targetOwner?: string; targetRole?: string }) => void;
  onClose: () => void;
}) {
  const confirm = useConfirm();

  async function unlockOwner(owner: string) {
    const ok = await confirm({ message: `Снять блокировки пользователя «${owner}»?`, okLabel: 'Снять' });
    if (ok) onUnlock({ targetOwner: owner });
  }

  async function unlockAll() {
    const ok = await confirm({ title: 'Снять все блокировки', message: 'Авторство будет снято со всех участников рынка и анкет. Действие необратимо.', okLabel: 'Снять все', danger: true });
    if (ok) onUnlock({ targetOwner: 'all' });
  }

  return (
    <Sheet open onClose={onClose} title="Блокировки записей" variant="modal">
      {loading ? <Skeleton lines={5} /> : (
        <div className={s.form}>
          {!locks?.length && <p className={s.empty}>Заблокированных записей нет.</p>}
          {!!locks?.length && (
            <>
              <div className={s.tableWrap} style={{ maxHeight: 360 }}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th>Автор</th>
                      <th>Роль</th>
                      <th>Участников рынка</th>
                      <th>Анкет</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {locks.map(l => (
                      <tr key={l.owner}>
                        <td>{l.owner}</td>
                        <td>{l.role}</td>
                        <td>{l.comps}</td>
                        <td>{l.survs}</td>
                        <td><Button size="sm" variant="secondary" loading={unlocking} onClick={() => unlockOwner(l.owner)}>Снять</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={s.formFoot}>
                <Button variant="danger" loading={unlocking} onClick={unlockAll}>Снять все блокировки</Button>
              </div>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
