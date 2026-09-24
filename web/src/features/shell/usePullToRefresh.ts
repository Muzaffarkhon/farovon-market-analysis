import { useEffect, useRef, useState, type RefObject } from 'react';

const THRESHOLD = 64;
const DAMP = 0.5;

/** Внутри ли элемент своего собственного скролл-контейнера (например,
 * .tableWrap реестра) — если да, тянуть вниз-обновление не должно мешать
 * его прокрутке, даже когда сам .main ещё в самом верху. */
function isInNestedScroller(el: Element | null, boundary: Element): boolean {
  let node = el;
  while (node && node !== boundary) {
    const cs = getComputedStyle(node);
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1) return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * Потянуть вниз, чтобы обновить — на телефоне заменяет кнопку «Обновить».
 * Срабатывает только когда контейнер уже прокручен до самого верха
 * (scrollTop === 0), иначе обычный скролл вниз внутри страницы включал бы
 * его при каждом жесте.
 */
export function usePullToRefresh(ref: RefObject<HTMLElement | null>, onRefresh: () => void) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const refreshingRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function onTouchStart(e: TouchEvent) {
      if (refreshingRef.current || el!.scrollTop > 0 || isInNestedScroller(e.target as Element, el!)) {
        startY.current = null;
        return;
      }
      startY.current = e.touches[0].clientY;
    }

    function onTouchMove(e: TouchEvent) {
      if (startY.current == null) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0 || el!.scrollTop > 0) { startY.current = null; setPull(0); return; }
      e.preventDefault();
      setPull(Math.min(dy * DAMP, THRESHOLD * 1.4));
    }

    function onTouchEnd() {
      if (startY.current == null) return;
      startY.current = null;
      setPull(p => {
        if (p >= THRESHOLD) {
          refreshingRef.current = true;
          setRefreshing(true);
          Promise.resolve(onRefresh()).finally(() => {
            refreshingRef.current = false;
            setRefreshing(false);
          });
        }
        return 0;
      });
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [ref, onRefresh]);

  return { pull, refreshing };
}
