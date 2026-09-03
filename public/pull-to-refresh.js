// ═══════════════════════════════════════════════════════════
// PULL-TO-REFRESH: обновление страницы перетаскиванием сверху вниз
// ═══════════════════════════════════════════════════════════
(function initPullToRefresh(){
  if (typeof window === 'undefined' || !('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
    return;
  }

  var THRESHOLD = 55;
  var MAX_PULL = 75;

  var startY = 0;
  var startX = 0;
  var isPulling = false;
  var isRefreshing = false;
  var hapticTriggered = false;
  var pullDistance = 0;

  // Индикатор Pull-to-refresh
  var el = document.createElement('div');
  el.id = 'ptrIndicator';
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = 'position:fixed;top:0;left:50%;transform:translate3d(-50%,-48px,0);z-index:9998;pointer-events:none;display:flex;align-items:center;justify-content:center;gap:8px;background:var(--card,#ffffff);border:1px solid var(--line,#e2e8f0);box-shadow:0 6px 20px rgba(0,0,0,0.14);border-radius:9999px;padding:6px 14px;opacity:0;transition:transform 0.25s cubic-bezier(0.2,0.8,0.2,1),opacity 0.2s ease;font-size:12px;font-weight:500;color:var(--text,#0f172a);';

  el.innerHTML =
    '<span id="ptrIcon" style="display:inline-flex;align-items:center;justify-content:center;color:var(--accent,#2563eb);transition:transform 0.08s linear">' +
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>' +
    '</span>' +
    '<span id="ptrText">Потяните для обновления</span>';

  if (!document.getElementById('ptrAnimStyles')) {
    var st = document.createElement('style');
    st.id = 'ptrAnimStyles';
    st.textContent = '@keyframes ptrSpin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}';
    document.head.appendChild(st);
  }

  document.body.appendChild(el);

  var iconEl = document.getElementById('ptrIcon');
  var textEl = document.getElementById('ptrText');

  function triggerHaptic(){
    try {
      var tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback;
      if (tg && tg.impactOccurred) {
        tg.impactOccurred('light');
      } else if (navigator.vibrate) {
        navigator.vibrate(10);
      }
    } catch(e){}
  }

  function getScrollTop(target){
    if (document.querySelector('.sheet:not(.hidden), .menu-scrim:not(.hidden)')) {
      return 999;
    }

    var curr = target;
    while (curr && curr !== document.body && curr !== document.documentElement) {
      if (curr.scrollTop > 0) return curr.scrollTop;
      curr = curr.parentElement;
    }

    var wrap = document.getElementById('body');
    if (wrap && wrap.scrollTop > 0) return wrap.scrollTop;

    return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
  }

  window.addEventListener('touchstart', function(e){
    if (isRefreshing) return;

    var scrollTop = getScrollTop(e.target);
    if (scrollTop > 1) {
      isPulling = false;
      return;
    }

    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    isPulling = true;
    hapticTriggered = false;
    pullDistance = 0;
  }, { passive: true });

  window.addEventListener('touchmove', function(e){
    if (!isPulling || isRefreshing) return;

    var currentY = e.touches[0].clientY;
    var currentX = e.touches[0].clientX;
    var deltaY = currentY - startY;
    var deltaX = currentX - startX;

    var scrollTop = getScrollTop(e.target);
    if (scrollTop > 1 || deltaY <= 0) {
      if (pullDistance > 0) {
        pullDistance = 0;
        el.style.transform = 'translate3d(-50%,-48px,0)';
        el.style.opacity = '0';
      }
      return;
    }

    // Отсекаем горизонтальные свайпы
    if (Math.abs(deltaX) * 1.2 > deltaY) return;

    pullDistance = Math.min(Math.pow(deltaY, 0.8) * 1.6, MAX_PULL);

    if (pullDistance > 6 && e.cancelable) {
      e.preventDefault();
    }

    el.style.transition = 'none';
    el.style.transform = 'translate3d(-50%,' + (pullDistance - 44) + 'px,0)';
    el.style.opacity = pullDistance > 8 ? '1' : '0';

    var deg = Math.min(180, (pullDistance / THRESHOLD) * 180);
    iconEl.style.transform = 'rotate(' + deg + 'deg)';

    if (pullDistance >= THRESHOLD) {
      textEl.textContent = 'Отпустите для обновления';
      if (!hapticTriggered) {
        hapticTriggered = true;
        triggerHaptic();
      }
    } else {
      textEl.textContent = 'Потяните для обновления';
      if (hapticTriggered) {
        hapticTriggered = false;
      }
    }
  }, { passive: false });

  function finishRefresh(){
    isRefreshing = false;
    el.style.transition = 'transform 0.25s cubic-bezier(0.2,0.8,0.2,1),opacity 0.2s ease';
    el.style.transform = 'translate3d(-50%,-48px,0)';
    el.style.opacity = '0';
    iconEl.style.animation = 'none';
    iconEl.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>';
  }

  window.addEventListener('touchend', function(){
    if (!isPulling) return;
    isPulling = false;

    if (pullDistance >= THRESHOLD && !isRefreshing) {
      isRefreshing = true;
      el.style.transition = 'transform 0.2s ease,opacity 0.2s ease';
      el.style.transform = 'translate3d(-50%,48px,0)';
      el.style.opacity = '1';
      textEl.textContent = 'Обновление…';
      iconEl.style.transform = 'none';
      iconEl.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>';
      iconEl.style.animation = 'ptrSpin 0.85s linear infinite';

      try {
        if (typeof window.doRefresh_ === 'function' && window.S && window.S.token) {
          window.doRefresh_();
          setTimeout(finishRefresh, 800);
        } else {
          setTimeout(function(){
            window.location.reload();
          }, 400);
        }
      } catch(err) {
        setTimeout(function(){
          window.location.reload();
        }, 400);
      }
    } else {
      pullDistance = 0;
      el.style.transition = 'transform 0.25s cubic-bezier(0.2,0.8,0.2,1),opacity 0.2s ease';
      el.style.transform = 'translate3d(-50%,-48px,0)';
      el.style.opacity = '0';
    }
  }, { passive: true });

  window.addEventListener('touchcancel', function(){
    isPulling = false;
    if (!isRefreshing) {
      pullDistance = 0;
      el.style.transition = 'transform 0.25s cubic-bezier(0.2,0.8,0.2,1),opacity 0.2s ease';
      el.style.transform = 'translate3d(-50%,-48px,0)';
      el.style.opacity = '0';
    }
  }, { passive: true });
})();
