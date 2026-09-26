import { useId } from 'react';

/**
 * Один общий набор векторных иконок на всё приложение (левое меню, шапка,
 * нижняя панель на телефоне, карточки администрирования) — раньше в левом
 * меню/шапке были не настоящие иконки, а текстовые Unicode-значки (▤ ◧ ⚙
 * и т.д.), при попытке сделать их «объёмными» через градиент текста —
 * мылились на мелком кегле. Векторный SVG такого не боится: заливка через
 * <linearGradient> — часть самой отрисовки контура, не растровая маска.
 */
export type IconName =
  | 'collect' | 'grid' | 'dashboard' | 'chart' | 'coordination' | 'grades' | 'risk'
  | 'money' | 'shield' | 'settings' | 'refresh' | 'contrast' | 'more' | 'menu'
  | 'users' | 'units' | 'book' | 'dict' | 'clock' | 'chat' | 'send' | 'log' | 'tools' | 'sun' | 'moon';

const ICON_PATHS: Record<IconName, string> = {
  collect: '<rect x="6" y="3" width="12" height="18" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M9 3h6v2.5a1 1 0 0 1-1 1H10a1 1 0 0 1-1-1V3z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8.5 11h7M8.5 14.5h7M8.5 18h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  grid: '<rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M3 9.5h18M9 4v16M15 4v16" stroke="currentColor" stroke-width="1.5"/>',
  dashboard: '<path d="M4 19V13M10 19V7M16 19v-9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="19" cy="6" r="2" stroke="currentColor" stroke-width="1.8"/>',
  chart: '<path d="M18 20V10M12 20V4M6 20v-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  coordination: '<circle cx="9" cy="8" r="3.2" stroke="currentColor" stroke-width="1.9"/><path d="M3.5 19c.7-3.3 3-5 5.5-5s4.8 1.7 5.5 5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="17" cy="8.5" r="2.6" stroke="currentColor" stroke-width="1.9"/><path d="M15.3 19c.5-2.6 1.9-4.3 4.7-4.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  grades: '<path d="M3.5 20.5h5.5V15H3.5v5.5zM9 20.5h6V9.5H9v11zM15 20.5h5.5V4H15v16.5z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  risk: '<path d="M12 3.5L21 19H3L12 3.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9.5v4.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="16.6" r="0.95" fill="currentColor"/>',
  money: '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5v9M9.5 9.8c0-1.3 1.1-2 2.5-2s2.5.7 2.5 1.8c0 2.4-5 1.2-5 3.6 0 1.1 1.1 1.8 2.5 1.8s2.5-.7 2.5-2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  shield: '<path d="M12 3l7 3v6c0 4.2-2.9 7.9-7 9-4.1-1.1-7-4.8-7-9V6l7-3z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.2 12.2l2 2 3.6-3.8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  settings: '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M17.7 6.3l-1.5 1.5M7.8 16.2l-1.5 1.5M17.7 17.7l-1.5-1.5M7.8 7.8L6.3 6.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  refresh: '<path d="M20 12a8 8 0 1 0-2.2 5.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M20 7.5V12h-4.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  contrast: '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17V3.5z" fill="currentColor"/>',
  more: '<circle cx="5.5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="18.5" cy="12" r="1.7" fill="currentColor"/>',
  menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  users: '<circle cx="9" cy="8" r="3.2" stroke="currentColor" stroke-width="1.9"/><path d="M3.5 19c.7-3.3 3-5 5.5-5s4.8 1.7 5.5 5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="17" cy="8.5" r="2.6" stroke="currentColor" stroke-width="1.9"/><path d="M15.3 19c.5-2.6 1.9-4.3 4.7-4.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  units: '<rect x="3" y="3" width="7" height="9" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="14" y="3" width="7" height="5" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="14" y="12" width="7" height="9" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="3" y="16" width="7" height="5" rx="1.5" stroke="currentColor" stroke-width="2"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v18H6.5A2.5 2.5 0 0 1 4 18.5v-13z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H12v18h5.5a2.5 2.5 0 0 0 2.5-2.5v-13z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  dict: '<circle cx="9" cy="12" r="6" stroke="currentColor" stroke-width="1.8"/><circle cx="15" cy="12" r="6" stroke="currentColor" stroke-width="1.8"/>',
  clock: '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.9"/><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  chat: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5v-8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  send: '<path d="M4 12l16-8-6 16-2.5-6.5L4 12z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>',
  log: '<path d="M5 3.5h11l3 3V20.5H5V3.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8.5 10h7M8.5 13.5h7M8.5 17h4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  tools: '<path d="M14.7 6.3a4 4 0 0 1 5.6 5.6l-1 1-5.6-5.6 1-1z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M13.3 7.7L4.5 16.5a2 2 0 0 0 0 2.8l.2.2a2 2 0 0 0 2.8 0l8.8-8.8" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M5 19l-1.5 1.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  sun: '<circle cx="12" cy="12" r="4.3" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.5v2.4M12 19.1v2.4M21.5 12h-2.4M4.9 12H2.5M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7M18.4 18.4l-1.7-1.7M7.3 7.3L5.6 5.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'
};

/**
 * `gradient` (по умолчанию включён) — лёгкая градиентная заливка контура
 * (светлее сверху, акцентный цвет снизу) через настоящий SVG
 * <linearGradient>, а не CSS-фильтр/маску: остаётся резким на любом
 * размере. `gradient={false}` — для мест, где иконка и так на сплошной
 * заливке нужного цвета (например активная приподнятая кнопка в
 * TabBar.tsx — там уже белый цвет через currentColor важнее объёма).
 */
export function Icon({ name, gradient = true, className, size = 20 }: {
  name: IconName; gradient?: boolean; className?: string; size?: number;
}) {
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const gradId = 'ic-' + rawId;
  const html = gradient ? ICON_PATHS[name].replaceAll('currentColor', `url(#${gradId})`) : ICON_PATHS[name];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      {gradient && (
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0%" stopColor="color-mix(in srgb, var(--accent) 55%, white)" />
            <stop offset="100%" stopColor="var(--accent)" />
          </linearGradient>
        </defs>
      )}
      <g dangerouslySetInnerHTML={{ __html: html }} />
    </svg>
  );
}
