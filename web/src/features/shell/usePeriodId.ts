import { useSearchParams } from 'react-router';

/** Период из адреса (?period=ID); пусто — текущий. Ссылка открывает тот же период. */
export function usePeriodId(): number | null {
  const [params] = useSearchParams();
  const raw = params.get('period');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
