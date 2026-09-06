// ═══════════════════════════════════════════════════════════
// ЖИВОЕ ОБНОВЛЕНИЕ: дашборд и админка (периоды/гранты/пользователи)
// ═══════════════════════════════════════════════════════════
// Тот же приём, что в соседнем проекте (faravon-cafeteria/_live-refresh.tsx):
// основной канал — SSE (/api/stream), сервер шлёт событие `update`, когда
// меняются релевантные данные. EventSource переподключается сам (браузерная
// логика по заголовку `retry`), поэтому короткоживущее соединение не мешает.
// Подстраховка на случай, если SSE режет корпоративный прокси: обновление
// при возврате фокуса на вкладку и редкий фолбэк-таймер.
//
// Куки httpOnly-сессии (см. authController.js:SESSION_COOKIE) уходят вместе
// с запросом EventSource автоматически — отдельно передавать токен не нужно.
(function(){
  var FALLBACK_MS = 90000;
  var es = null;
  var stopped = false;

  function loggedIn(){ return !!(window.S && S.token); }

  function refreshCurrentView(){
    if(!loggedIn() || document.visibilityState !== 'visible') return;
    if(S.appView === 'dashboard'){
      if(typeof fetchDashboard === 'function') fetchDashboard(true);
    } else if(S.appView === 'admin'){
      if(typeof renderAdminPanel === 'function') renderAdminPanel();
    }
  }

  function connect(){
    if(stopped || es || !loggedIn() || document.visibilityState !== 'visible') return;
    try {
      es = new EventSource('/api/stream');
      es.addEventListener('update', refreshCurrentView);
      es.onerror = function(){
        // На скрытой вкладке рвём соединение сами, чтобы не держать его
        // впустую; иначе EventSource переподключится сам по `retry`.
        if(document.visibilityState === 'hidden' && es){
          es.close();
          es = null;
        }
      };
    } catch(e){ es = null; }
  }

  function disconnect(){
    if(es){ es.close(); es = null; }
  }

  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'visible'){
      refreshCurrentView();
      connect();
    } else {
      disconnect();
    }
  });

  window.addEventListener('focus', refreshCurrentView);
  setInterval(refreshCurrentView, FALLBACK_MS);

  // S.token появляется только после входа/резюме сессии — ждём его, иначе
  // первое соединение уйдёт без куки и получит 401.
  var waitForLogin = setInterval(function(){
    if(loggedIn()){
      clearInterval(waitForLogin);
      connect();
    }
  }, 1000);
})();
