import { useState } from 'react';
import { Button } from '../../design/Button';
import { useSession } from './useSession';
import s from './LoginScreen.module.css';

/**
 * Руководитель направления/отдела (dir_head, head) без назначенного
 * подразделения — сам выбрать его не может (setUnits это запрещает и на
 * сервере), только ждать, пока администратор назначит. «Проверить снова»
 * просто перезапрашивает сессию — как только units появятся, needsAssignment
 * станет false и RequireAuth пропустит дальше.
 */
export function AssignmentPendingScreen() {
  const { refresh, logout } = useSession();
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    try { await refresh(); } finally { setBusy(false); }
  }

  return (
    <div className={s.wrap}>
      <div className={s.card}>
        <h1 className={s.title}>Назначение ещё не выполнено</h1>
        <p className={s.hint}>Администратор ещё не назначил вам подразделение. Обратитесь к нему или проверьте позже.</p>
        <Button loading={busy} onClick={check}>Проверить снова</Button>
        <Button variant="ghost" onClick={() => void logout()}>Выйти</Button>
      </div>
    </div>
  );
}
