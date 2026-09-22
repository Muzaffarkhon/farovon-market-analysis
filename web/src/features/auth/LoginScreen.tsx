import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { authApi } from '../../api/auth';
import { ApiError } from '../../api/client';
import { Button } from '../../design/Button';
import { Input } from '../../design/Input';
import { useSession } from './useSession';
import s from './LoginScreen.module.css';

export function LoginScreen() {
  const { setData } = useSession();
  const navigate = useNavigate();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await authApi.login(login.trim(), password);
      setData(r.data);
      navigate(r.data.mustChangePassword ? '/change-password' : '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.wrap}>
      <form className={s.card} onSubmit={submit}>
        <h1 className={s.title}>Обзор рынка</h1>
        <Input label="Логин" value={login} onChange={e => setLogin(e.target.value)} autoComplete="username" autoFocus required />
        <Input label="Пароль" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
        {error && <div className={s.error} role="alert">{error}</div>}
        <Button type="submit" loading={busy}>Войти</Button>
      </form>
    </div>
  );
}
