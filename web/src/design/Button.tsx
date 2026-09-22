import type { ButtonHTMLAttributes } from 'react';
import s from './Button.module.css';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  loading?: boolean;
};

export function Button({ variant = 'primary', size = 'md', loading, disabled, className, children, type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      className={[s.btn, s[variant], s[size], className].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {children}
    </button>
  );
}
