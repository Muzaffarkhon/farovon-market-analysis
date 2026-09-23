import type { RegistryRow } from '../../api/contract';

/** «2026-09-01 10:00:00» → «01.09.2026». Пустое — прочерк. */
export function shortDate(iso: string): string {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : (iso || '—');
}

export function money(v: number): string {
  return v > 0 ? Math.round(v).toLocaleString('ru-RU') : '—';
}

/** «сомони / мес» — валюта и период одной короткой ячейкой. */
export function perLabel(row: Pick<RegistryRow, 'cur' | 'payPer'>): string {
  const p = String(row.payPer || 'в месяц').toLowerCase();
  const short = /час/.test(p) ? 'час' : /дн|день/.test(p) ? 'день' : /год/.test(p) ? 'год' : /смен/.test(p) ? 'смена' : /сдельн/.test(p) ? 'сдельно' : 'мес';
  return `${row.cur || 'сомони'} / ${short}`;
}

/** Вилка одной строкой — для карточки на узком экране. */
export function payRange(row: Pick<RegistryRow, 'payFrom' | 'payTo'>): string {
  if (row.payFrom > 0 && row.payTo > 0 && row.payFrom !== row.payTo) return `${money(row.payFrom)} – ${money(row.payTo)}`;
  return money(row.payFrom || row.payTo);
}

/** Длинные названия направлений в таблице сокращаем — иначе колонка съедает половину. */
export function shortDir(v: string): string {
  return String(v || '—')
    .replace('Департамент ', 'Деп. ')
    .replace('Дивизион ', 'Див. ')
    .replace('Обзор рынка — не распределено', 'не распределено');
}

export const UNMAPPED = '(не сопоставлено)';
export const isUnmapped = (row: Pick<RegistryRow, 'posOur'>) => !row.posOur || row.posOur === UNMAPPED;

/** Свободный текст (комментарий, прочие выплаты) в таблице — коротко, полный текст в title. */
export function truncate(v: string, max = 40): string {
  const s = String(v || '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** «Источник записи» — вручную заведена или пришла импортом из Excel (см. recordSourceOf в registryService.js). */
export const RECORD_SOURCE_LABEL: Record<string, string> = { manual: 'Вручную', import: 'Импорт из Excel' };
export const recordSourceLabel = (v: string) => RECORD_SOURCE_LABEL[v] ?? v;
