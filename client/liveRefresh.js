// ═══════════════════════════════════════════════════════════
// ЖИВОЕ ОБНОВЛЕНИЕ: дашборд и админка (периоды/гранты/пользователи)
// ═══════════════════════════════════════════════════════════
// Канал — опрос (был SSE /api/stream, но на serverless-хостинге открытое
// соединение держит инвокацию функции на весь свой срок). Раз в POLL_MS,
// пока вкладка активна, дёргаем /api/live-signature и сравниваем компактную
// «подпись» релевантных данных: если изменилась — перерисовываем текущий
// раздел. Плюс мгновенное обновление при возврате фокуса на вкладку.
//
// Токен сессии кладём в заголовок Authorization через общий fetchJson
// (см. app-core.js) — тот же путь, что у остальных вызовов API.
(function(){
  var POLL_MS = 20000;      // основной интервал опроса
  var FALLBACK_MS = 90000;  // страховочная перерисовка, даже если подпись «не изменилась»
  var stopped = false;
  var lastSig = null;
  var polling = false;
  var timer = null;

  function loggedIn(){ return !!(window.S && S.token); }

  function refreshCurrentView(){
    if(!loggedIn() || document.visibilityState !== 'visible') return;
    if(S.appView === 'dashboard'){
      if(typeof fetchDashboard === 'function') fetchDashboard(true);
    } else if(S.appView === 'admin'){
      if(typeof renderAdminPanel === 'function') renderAdminPanel();
    }
  }

  function poll(){
    if(stopped || polling) return;
    if(!loggedIn() || document.visibilityState !== 'visible') return;
    if(typeof fetchJson !== 'function') return;
    polling = true;
    fetchJson('/api/live-signature', { token: S.token }).then(function(data){
      polling = false;
      if(!data || data.ok === false || typeof data.sig !== 'string') return;
      if(lastSig === null){
        // Первый удачный опрос принимаем за базу — не перерисовываем, иначе
        // каждый вход выглядел бы как изменение.
        lastSig = data.sig;
        return;
      }
      if(data.sig !== lastSig){
        lastSig = data.sig;
        refreshCurrentView();
      }
    }).catch(function(){ polling = false; });
  }

  function start(){
    if(timer) return;
    timer = setInterval(poll, POLL_MS);
    poll();
  }

  function stop(){
    if(timer){ clearInterval(timer); timer = null; }
  }

  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'visible'){
      refreshCurrentView();
      start();
    } else {
      stop();
    }
  });

  window.addEventListener('focus', refreshCurrentView);
  setInterval(refreshCurrentView, FALLBACK_MS);

  // S.token появляется только после входа/резюме сессии — ждём его.
  var waitForLogin = setInterval(function(){
    if(loggedIn()){
      clearInterval(waitForLogin);
      start();
    }
  }, 1000);
})();
