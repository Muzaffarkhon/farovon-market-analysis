/**
 * Справочники валюты и периода выплаты. Списки обязаны совпадать с
 * ALLOWED_CURRENCIES / ALLOWED_PAY_PERIODS в src/controllers/surveyController.js —
 * сервер отвергает всё, чего в них нет (ТЗ 11), а не подменяет молча.
 */
export const CURRENCIES = ['сомони', 'usd', 'rub', 'eur', 'доллар', 'рубль', 'евро', 'tjs'] as const;

export const PAY_PERIODS = ['в месяц', 'в час', 'в час (чтс)', 'в смену', 'в год', 'в день', 'сдельно (за услугу)'] as const;

/** По умолчанию — сомони. Валюта НЕ наследуется от другой должности (ТЗ 3.2). */
export const DEFAULT_CURRENCY = 'сомони';
export const DEFAULT_PAY_PERIOD = 'в месяц';

/** Сдельная оплата: такие записи не попадают в месячные вилки и медиану рынка. */
export function isPieceRate(payPer: string): boolean {
  return /сдельно/i.test(String(payPer || ''));
}

/** Валюты для выпадающего списка: только основные, без синонимов-дублей. */
export const CURRENCY_OPTIONS = ['сомони', 'usd', 'rub', 'eur'].map(v => ({ value: v, label: v }));
export const PAY_PERIOD_OPTIONS = PAY_PERIODS.map(v => ({ value: v, label: v }));
