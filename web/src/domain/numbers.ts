export const MAX_MONEY = 1e9;

export function trim(v: unknown): string {
  return String(v == null ? '' : v).trim();
}

/** '12 000,50' → 12000.5; '' → 0; мусор → null. Повторяет src/services/surveyValidation.js. */
export function parseMoney(raw: unknown): number | null {
  const s = trim(raw).replace(/\s+/g, '').replace(',', '.');
  if (s === '') return 0;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** 12000.5 → «12 000,5». Неразрывные пробелы, чтобы число не разрывалось переносом. */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}
