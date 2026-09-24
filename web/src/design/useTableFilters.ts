import { useMemo, useState } from 'react';

/**
 * Обобщённая версия панели фильтров реестра (features/registry/RegistryFilters.tsx)
 * для любой таблицы админки: одно поле фильтра на каждый значимый столбец,
 * а не общий поиск по нескольким полям сразу или один произвольный список
 * сверху. Текст — подстрока, `numeric` — старое поведение из клиента
 * (client/app-core.js, enhanceTableFilters): `>N`, `<N`, `>=N`, `<=N`, `=N`,
 * диапазон `N-M`.
 */
export type TableFilterField<T> = {
  key: string;
  label: string;
  get: (row: T) => string;
  kind?: 'text' | 'select' | 'numeric';
  /** Для kind: 'select' — если не задано, варианты считаются из данных. */
  options?: string[];
  /** get() возвращает несколько значений через ', ' (напр. список направлений) — совпадение по вхождению, не по равенству всей строки. */
  multi?: boolean;
};

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function matchNumeric(cellText: string, q: string): boolean {
  const n = parseFloat(cellText.replace(/[^\d.,-]/g, '').replace(',', '.'));
  const cmp = q.match(/^(>=|<=|>|<|=)\s*(-?[\d.]+)$/);
  if (cmp) {
    if (Number.isNaN(n)) return false;
    const v = parseFloat(cmp[2]);
    switch (cmp[1]) {
      case '>': return n > v;
      case '<': return n < v;
      case '>=': return n >= v;
      case '<=': return n <= v;
      default: return n === v;
    }
  }
  const range = q.match(/^(-?[\d.]+)\s*[-–—]\s*(-?[\d.]+)$/);
  if (range) {
    if (Number.isNaN(n)) return false;
    const a = parseFloat(range[1]);
    const b = parseFloat(range[2]);
    return n >= Math.min(a, b) && n <= Math.max(a, b);
  }
  return norm(cellText).includes(norm(q));
}

export function useTableFilters<T>(rows: T[], fields: TableFilterField<T>[]) {
  const [values, setValues] = useState<Record<string, string>>({});

  const optionsByField = useMemo(() => {
    const map: Record<string, string[]> = {};
    fields.forEach(f => {
      if (f.kind !== 'select') return;
      if (f.options) { map[f.key] = f.options; return; }
      const set = new Set<string>();
      rows.forEach(row => {
        const v = f.get(row);
        if (!v) return;
        if (f.multi) v.split(', ').forEach(x => x && set.add(x));
        else set.add(v);
      });
      map[f.key] = [...set].sort((a, b) => a.localeCompare(b, 'ru'));
    });
    return map;
  }, [rows, fields]);

  const filtered = useMemo(() => {
    const qs = fields.map(f => ({ f, q: (values[f.key] ?? '').trim() })).filter(x => x.q);
    if (!qs.length) return rows;
    return rows.filter(row => qs.every(({ f, q }) => {
      const text = f.get(row) ?? '';
      if (f.kind === 'numeric') return matchNumeric(text, q);
      if (f.kind === 'select') return f.multi ? text.split(', ').includes(q) : text === q;
      return norm(text).includes(norm(q));
    }));
  }, [rows, fields, values]);

  const active = fields.filter(f => (values[f.key] ?? '').trim());

  return {
    values,
    setValue: (key: string, v: string) => setValues(prev => ({ ...prev, [key]: v })),
    optionsByField,
    filtered,
    active,
    reset: () => setValues({})
  };
}
