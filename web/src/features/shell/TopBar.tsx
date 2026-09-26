import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toggleTheme } from '../../design/theme';
import { useToast } from '../../design/Toast';
import { useSession, useSessionData } from '../auth/useSession';
import { PeriodPicker } from './PeriodPicker';
import { useOnline } from './useOnline';
import s from './Shell.module.css';

export function TopBar({ title }: { title: string }) {
  const { user } = useSessionData();
  const { logout } = useSession();
  const navigate = useNavigate();
  const online = useOnline();
  const qc = useQueryClient();
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // invalidateQueries сам по себе не даёт понять, сработал ли клик: пока
  // запросы перезагружаются, крутим иконку (та же анимация, что и у жеста
  // «потянуть вниз» на телефоне — usePullToRefresh.ts), а по готовности
  // коротко подтверждаем тостом. Минимум 400мс — иначе на быстром кэше
  // спин мелькает и не читается как обратная связь.
  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    const started = Date.now();
    try {
      await qc.invalidateQueries();
    } finally {
      const left = 400 - (Date.now() - started);
      if (left > 0) await new Promise(r => setTimeout(r, left));
      setRefreshing(false);
      toast.show('Обновлено', 'ok');
    }
  };

  return (
    <header className={s.top}>
      <div className={s.left}>
        {/* На телефоне это единственное место, где виден логотип платформы —
            панель слева скрыта, пока её не открыть кнопкой снизу (TabBar.tsx).
            Не кнопка: сворачивания на телефоне нет, просто марка. */}
        <span className={s.logoMark} aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M4 19V10M12 19V5M20 19V13" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </span>
        <h1 className={s.title}>{title}</h1>
      </div>
      <div className={s.right}>
        {!online && <span className={s.offline} role="status">Нет связи</span>}
        <PeriodPicker />
        <span className={s.userLogin}>{user.login}</span>
        <button type="button" className={s.iconBtn} aria-label="Обновить" disabled={refreshing} onClick={() => void handleRefresh()}>
          <span className={[s.iconGlyph, refreshing ? s.pullSpin : ''].join(' ')} aria-hidden="true">⟳</span>
        </button>
        <button type="button" className={s.iconBtn} aria-label="Тема" onClick={() => toggleTheme()}>
          <span className={s.iconGlyph} aria-hidden="true">◐</span>
        </button>
        <div className={s.more}>
          <button type="button" className={s.iconBtn} aria-label="Ещё" aria-expanded={menu} onClick={() => setMenu(m => !m)}>
            <span className={s.iconGlyph} aria-hidden="true">⋯</span>
          </button>
          {menu && (
            <div className={s.menu} role="menu" onMouseLeave={() => setMenu(false)}>
              <div className={s.menuUser}>{user.fio}</div>
              <PeriodPicker variant="menu" />
              <button type="button" role="menuitem" className={s.menuItem} onClick={() => { setMenu(false); navigate('/profile'); }}>Профиль</button>
              <button type="button" role="menuitem" className={s.menuItem} onClick={() => { setMenu(false); navigate('/change-password'); }}>Сменить пароль</button>
              <button type="button" role="menuitem" className={s.menuItem} onClick={() => { setMenu(false); void logout(); }}>Выйти</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
