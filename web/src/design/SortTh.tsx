import s from './SortTh.module.css';
import type { SortDir } from './useSort';

export function SortTh({ label, sortKey, activeKey, dir, onSort, numeric, className }: {
  label: string;
  sortKey: string;
  activeKey: string | undefined;
  dir: SortDir;
  onSort: (key: string) => void;
  numeric?: boolean;
  className?: string;
}) {
  const active = activeKey === sortKey;
  return (
    <th className={className}>
      <button type="button" className={[s.btn, numeric ? s.numeric : ''].join(' ')} onClick={() => onSort(sortKey)}>
        {label}
        <span className={s.mark}>{active ? (dir === 'asc' ? '↑' : '↓') : ''}</span>
      </button>
    </th>
  );
}
