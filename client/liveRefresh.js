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

  // Полная перерисовка текущего раздела на живом обновлении не должна
  // выдёргивать пользователя из того, чем он занят прямо сейчас — иначе
  // это ощущается как «страница дёргается сама по себе». Откладываем
  // обновление (не отменяем, просто ждём и проверяем снова), пока:
  //  1) открыт кастомный выпадающий список (.nselect.open) — иначе
  //     перерисовка вырывает его из рук посреди выбора;
  //  2) фокус стоит в поле ввода/textarea/select — человек что-то печатает
  //     или выбирает, где угодно в приложении, не только в админке;
  //  3) на вкладке «Роли и доступы» (по ролям или персонально) есть
  //     несохранённые правки — иначе loadAdminRoles() их молча затрёт
  //     свежими данными с сервера, а заодно и сбросит выбранный режим
  //     («Персонально» → «По ролям»), если бы правки не переносились.
  function isUiBusy(){
    if(document.querySelector('.nselect.open')) return true;
    // Открытое модальное окно (карточка пользователя, отчёт импорта, диалог
    // подтверждения и т.п.) — пока оно на экране, человек посреди действия,
    // даже если между кликами фокус не стоит ни в одном поле ввода.
    if(document.querySelector('.sheet')) return true;
    var ae = document.activeElement;
    if(ae){
      var tag = ae.tagName;
      if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ae.isContentEditable) return true;
    }
    if(window.S){
      if(typeof rcIsDirty === 'function' && S.rc && rcIsDirty()) return true;
      if(typeof ucapIsDirty === 'function' && S.ucap && ucapIsDirty()) return true;
    }
    // Открытая анкета грейдирования/риска незаменимости — отвечают кликами по
    // карточкам вариантов, а не вводом в поле, так что фокус в INPUT выше это
    // не поймает. Полная перерисовка текущего раздела стёрла бы уже отмеченные
    // (но не сохранённые) ответы.
    if(window.GR && (GR.form || GR.riskForm)) return true;
    return false;
  }

  function refreshCurrentView(){
    if(!loggedIn() || document.visibilityState !== 'visible') return;
    if(isUiBusy()){
      setTimeout(refreshCurrentView, 3000);
      return;
    }
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
      if(data.version){
        var srvVer = 'v' + String(data.version).replace(/^v/, '');
        if(window.APP_VERSION && window.APP_VERSION !== srvVer){
          window.APP_VERSION = srvVer;
          if(typeof APP_VERSION !== 'undefined') APP_VERSION = srvVer;
          document.querySelectorAll('.sheet-ver-badge').forEach(function(b){ b.textContent = srvVer; });
          var pv = document.querySelector('.profile-ver');
          if(pv) pv.textContent = 'Обзор рынка вознаграждений · Фаровон · ' + srvVer;
          var rr = document.getElementById('railRole');
          if(rr && rr.textContent && rr.title){
            rr.title = rr.textContent + ' · ' + srvVer;
          }
        }
      }
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
