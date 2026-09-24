import { useState } from 'react';
import { authApi } from '../../api/auth';
import { telegramApi } from '../../api/telegram';
import { ApiError } from '../../api/client';
import { Badge } from '../../design/Badge';
import { Button } from '../../design/Button';
import { useConfirm } from '../../design/Confirm';
import { Input } from '../../design/Input';
import { useToast } from '../../design/Toast';
import { useScreenTitle } from '../shell/Shell';
import { useSession, useSessionData } from './useSession';
import { TelegramLinkSheet } from './TelegramLinkSheet';
import s from '../admin/Admin.module.css';

export function ProfileScreen() {
  useScreenTitle('Профиль');
  const { user } = useSessionData();
  const { setData } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [fio, setFio] = useState(user.fio);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tgSheetOpen, setTgSheetOpen] = useState(false);

  async function saveFio() {
    const trimmed = fio.trim();
    if (!trimmed || trimmed === user.fio) return;
    setError('');
    setSaving(true);
    try {
      const r = await authApi.changeName(trimmed);
      setData(r.data);
      toast.show('ФИО обновлено', 'ok');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось изменить ФИО');
    } finally {
      setSaving(false);
    }
  }

  async function unlinkTelegram() {
    const ok = await confirm({ title: 'Отвязать Telegram?', message: 'Уведомления и вход через бота перестанут работать, пока не привяжете заново.', okLabel: 'Отвязать', danger: true });
    if (!ok) return;
    try {
      await telegramApi.unlink();
      const r = await authApi.resume();
      setData(r.data);
      toast.show('Telegram отвязан', 'ok');
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Не удалось отвязать', 'error');
    }
  }

  return (
    <div className={s.form} style={{ maxWidth: 480 }}>
      <div>
        <div className={s.hint} style={{ marginBottom: 4 }}>ФИО</div>
        <Input label="ФИО" value={fio} onChange={e => setFio(e.target.value)} error={error} />
        <div className={s.formFoot}>
          <Button size="sm" loading={saving} disabled={!fio.trim() || fio.trim() === user.fio} onClick={saveFio}>Сохранить</Button>
        </div>
      </div>

      <div>
        <div className={s.hint} style={{ marginBottom: 4 }}>Telegram</div>
        {user.hasTelegram ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Badge tone="ok">Привязан</Badge>
            <Button size="sm" variant="danger" onClick={unlinkTelegram}>Отвязать</Button>
          </div>
        ) : (
          <Button size="sm" onClick={() => setTgSheetOpen(true)}>Привязать Telegram</Button>
        )}
      </div>

      {tgSheetOpen && <TelegramLinkSheet onClose={() => setTgSheetOpen(false)} />}
    </div>
  );
}
