import type { ReactNode } from 'react';
import s from './Badge.module.css';

export type BadgeTone = 'neutral' | 'muted' | 'warn' | 'ok';

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={[s.badge, s[tone]].join(' ')}>{children}</span>;
}
