import { useMemo, useState } from 'react';

export type SortDir = 'asc' | 'desc';

/** Клиентская сортировка по клику на заголовок столбца — тройной цикл: asc → desc → без сортировки. */
export function useSort<T>(rows: T[], accessor: (row: T, key: string) => unknown) {
  const [key, setKey] = useState<string | undefined>(undefined);
  const [dir, setDir] = useState<SortDir>('asc');

  function sortBy(k: string) {
    if (k !== key) { setKey(k); setDir('asc'); return; }
    if (dir === 'asc') { setDir('desc'); return; }
    setKey(undefined);
  }

  const sorted = useMemo(() => {
    if (!key) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = accessor(a, key);
      const bv = accessor(b, key);
      const an = typeof av === 'number', bn = typeof bv === 'number';
      const cmp = an && bn
        ? (av as number) - (bv as number)
        : String(av ?? '').localeCompare(String(bv ?? ''), 'ru', { numeric: true });
      return dir === 'asc' ? cmp : -cmp;
    });
    return copy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, key, dir]);

  return { sorted, sortKey: key, sortDir: dir, sortBy };
}
