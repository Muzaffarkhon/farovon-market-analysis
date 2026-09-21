const { queryOne, run } = require('../db/database');

/**
 * Онлайн-курс валют к сомони (TJS). Источник — open.er-api.com (без ключа,
 * обновляется раз в сутки). Курс кладём в fx_rates по дате: повторные запросы
 * в тот же день идут из базы, а если сервис недоступен — берём последний
 * сохранённый курс и помечаем его как устаревший.
 *
 * Считаем через доллар (rates[TJS] / rates[X]): напрямую сервис отдаёт
 * курс с шестью знаками, и для узбекского сума (0,00078) теряется точность.
 */

const ALIASES = { 'сомони': 'TJS', 'сом': 'TJS', 'TJS': 'TJS', 'сум': 'UZS', 'UZS': 'UZS', 'USD': 'USD', '$': 'USD',
  'EUR': 'EUR', '€': 'EUR', 'RUB': 'RUB', '₽': 'RUB', 'KZT': 'KZT', 'CNY': 'CNY', 'TRY': 'TRY', 'GBP': 'GBP' };

const CURRENCIES = [
  { code: 'TJS', label: 'Сомони (TJS)' },
  { code: 'USD', label: 'Доллар США (USD)' },
  { code: 'EUR', label: 'Евро (EUR)' },
  { code: 'RUB', label: 'Российский рубль (RUB)' },
  { code: 'UZS', label: 'Узбекский сум (UZS)' },
  { code: 'KZT', label: 'Казахстанский тенге (KZT)' },
  { code: 'CNY', label: 'Китайский юань (CNY)' }
];

function normCode(currency) {
  const raw = String(currency || 'TJS').trim();
  return ALIASES[raw] || ALIASES[raw.toUpperCase()] || raw.toUpperCase();
}

const today = () => new Date().toISOString().slice(0, 10);

async function fetchUsdRates() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.result !== 'success' || !data.rates || !data.rates.TJS) throw new Error('пустой ответ');
    return data.rates;
  } finally {
    clearTimeout(timer);
  }
}

/** Сколько сомони в одной единице валюты: { currency, rate, date, source, stale }. */
async function getRate(currency) {
  const code = normCode(currency);
  if (code === 'TJS') return { currency: 'TJS', rate: 1, date: today(), source: 'сомони', stale: false };

  const d = today();
  const cached = await queryOne('SELECT rate_to_base, date FROM fx_rates WHERE currency = ? AND date = ?', [code, d]);
  if (cached) return { currency: code, rate: Number(cached.rate_to_base), date: cached.date, source: 'open.er-api.com', stale: false };

  try {
    const usd = await fetchUsdRates();
    if (!usd[code]) throw new Error('валюта не поддерживается');
    const rate = usd.TJS / usd[code];
    await run(
      'INSERT INTO fx_rates (currency, date, rate_to_base) VALUES (?, ?, ?) ON CONFLICT(currency, date) DO UPDATE SET rate_to_base = excluded.rate_to_base',
      [code, d, rate]
    );
    return { currency: code, rate, date: d, source: 'open.er-api.com', stale: false };
  } catch (err) {
    const last = await queryOne('SELECT rate_to_base, date FROM fx_rates WHERE currency = ? ORDER BY date DESC LIMIT 1', [code]);
    if (last) return { currency: code, rate: Number(last.rate_to_base), date: last.date, source: 'сохранённый курс', stale: true };
    throw new Error('Не удалось получить курс ' + code + ': ' + err.message);
  }
}

module.exports = { getRate, normCode, CURRENCIES };
