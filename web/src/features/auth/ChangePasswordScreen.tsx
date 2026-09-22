import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { authApi } from '../../api/auth';
import { ApiError } from '../../api/client';
import { Button } from '../../design/Button';
import { Input } from '../../design/Input';
import { useToast } from '../../design/Toast';
import { useSession } from './useSession';
import s from './LoginScreen.module.css';

export function ChangePasswordScreen() {
  const { refresh, data } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== repeat) { setError('Пароли не совпадают'); return; }
    setError('');
    setBusy(true);
    try {
      await authApi.changePassword(oldPassword, newPassword);
      await refresh();
      toast.show('Пароль изменён', 'ok');
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сменить пароль');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.wrap}>
      <form className={s.card} onSubmit={submit}>
        <h1 className={s.title}>Смена пароля</h1>
        {data?.mustChangePassword && <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14 }}>Вы вошли с временным паролем — задайте свой.</p>}
        <Input label="Текущий пароль" type="password" value={oldPassword} onChange={e => setOld(e.target.value)} autoComplete="current-password" required />
        <Input label="Новый пароль" type="password" value={newPassword} onChange={e => setNew(e.target.value)} autoComplete="new-password" hint="Не короче 8 символов, буква и цифра" required />
        <Input label="Повторите новый пароль" type="password" value={repeat} onChange={e => setRepeat(e.target.value)} autoComplete="new-password" required />
        {error && <div className={s.error} role="alert">{error}</div>}
        <Button type="submit" loading={busy}>Сохранить</Button>
      </form>
    </div>
  );
}
