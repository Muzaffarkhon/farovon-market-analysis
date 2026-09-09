// ═══════════════════════════════════════════════════════════
// app.js — прикладной слой: рендер экранов, дашборд, админка,
// оргструктура, сохранение, старт сессии. Требует app-core.js,
// который ДОЛЖЕН быть подключён раньше (общая глобальная область).
// ═══════════════════════════════════════════════════════════

(function start(){
  var t = store.get(LS_TOKEN);
  // В Telegram без сохранённого токена сессии нет (куку фрейм не отдаёт).
  // В браузере пробуем /auth/resume и без токена — его довезёт httpOnly-кука.
  if(!t && IN_TG){
    show('login');
    try{ $('inLogin').focus(); }catch(e){}
    return;
  }
  show('load');
  call('apiResume', t).then(function(r){
    if(r && r.ok){ persistToken(r); onLoaded(r.data); }
    else { store.del(LS_TOKEN); show('login'); try{ $('inLogin').focus(); }catch(e){} }
  }).catch(function(){ store.del(LS_TOKEN); show('login'); });
})();

$('btnLogin').onclick = doLogin;
$('inPass').addEventListener('keydown', function(e){ if(e.key==='Enter') doLogin(); });
$('inLogin').addEventListener('keydown', function(e){ if(e.key==='Enter') $('inPass').focus(); });

// Глазок: показать/скрыть пароль в окне входа.
(function(){
  var eye = $('pwEye'), pw = $('inPass');
  if(!eye || !pw) return;
  eye.addEventListener('click', function(){
    var reveal = pw.type === 'password';
    pw.type = reveal ? 'text' : 'password';
    eye.innerHTML = icBare(reveal ? 'eye-off' : 'eye', 18);
    eye.setAttribute('aria-label', reveal ? 'Скрыть пароль' : 'Показать пароль');
    pw.focus();
  });
})();

function doLogin(){
  var l = $('inLogin').value.trim(), p = $('inPass').value;
  if(!l || !p){ loginErr('Введите логин и пароль'); return; }
  $('btnLogin').disabled = true; $('btnLogin').textContent = 'Проверяем…';
  call('apiLogin', l, p).then(function(r){
    $('btnLogin').disabled = false; $('btnLogin').textContent = 'Войти';
    if(!r || !r.ok){ loginErr((r&&r.error)||'Ошибка входа'); return; }
    S.token = r.token;
    if(IN_TG) store.set(LS_TOKEN, r.token); // в браузере сессию держит кука
    $('inPass').value = '';
    onLoaded(r.data);
  }).catch(function(){
    $('btnLogin').disabled = false; $('btnLogin').textContent = 'Войти';
    loginErr('Нет связи с сервером. Проверьте интернет.');
  });
}
function loginErr(m){ var e=$('loginErr'); e.textContent=m; e.classList.remove('hidden'); }

function doLogout(){
  var go = function(){
    // Гасим httpOnly-куку на сервере, затем локальные следы.
    call('apiLogout').catch(function(){}).then(function(){
      store.del(LS_TOKEN);
      location.reload();
    });
  };
  if(!S.dirty){ go(); return; }
  askDirty('Выйти без сохранения').then(function(yes){ if(yes) go(); });
}

/**
 * Перечитывает данные с сервера. Называлась «Обновить данные из таблицы» —
 * формулировка осталась от Google-таблицы времён Apps Script, которой больше
 * нет: данные лежат в базе, и кнопка просто подтягивает свежее состояние,
 * если кто-то другой успел его поменять.
 */
function doRefresh(){
  if(!S.dirty){ doRefresh_(); return; }
  askDirty('Обновить данные').then(function(yes){ if(yes) doRefresh_(); });
}

/**
 * Подтянуть справочники в текущую сессию без тоста и без вопроса о черновике.
 * Нужен после правки справочника в админке: значение должно стать доступным в
 * пикерах сразу, но админ в этот момент ничего не заполняет, и сообщение
 * «Данные обновлены» поверх его действия было бы шумом.
 */
function quietRefresh(){
  call('apiRefresh', S.token).then(function(r){
    persistToken(r);
    if(r && r.ok && r.data){
      S.data.segments = r.data.segments || S.data.segments;
      S.data.regions = r.data.regions || S.data.regions;
      S.data.companies = r.data.companies || S.data.companies;
      S.data.companiesAll = r.data.companiesAll || S.data.companiesAll;
      S.data.positions = r.data.positions || S.data.positions;
      S.data.positionsAll = r.data.positionsAll || S.data.positionsAll;
    }
  }).catch(function(){});
}

function doRefresh_(){
  toast('Обновляем…');
  call('apiRefresh', S.token).then(function(r){
    if(!r || !r.ok){ toast((r&&r.error)||'Не удалось обновить', 'no'); return; }
    persistToken(r);
    S.dirty = false;
    onLoaded(r.data);
    toast('Данные обновлены', 'ok');
  }).catch(function(){ toast('Нет связи', 'no'); });
}

/**
 * Права из конструктора ролей и доступов (админка → «Роли и доступы»).
 * 'admin' — всегда true, даже если у него почему-то нет записи в capabilities
 * (сервер и так отдаёт ему полный список, это просто дублирующая подстраховка
 * на фронте — та же граница проверяется на каждом запросе в requireCapability).
 */
function hasCap(id){
  var u = S.data && S.data.user;
  if(!u) return false;
  if(u.role === 'admin') return true;
  return (u.capabilities || []).indexOf(id) >= 0;
}

/** Есть ли доступ хоть к одному разделу админки — все capabilities сейчас об этом. */
function canSeeAdmin(){
  var u = S.data && S.data.user;
  if(!u) return false;
  return u.role === 'admin' || (u.capabilities && u.capabilities.length > 0);
}

/**
 * Кто видит аналитический дашборд. Раньше это был жёсткий список ролей
 * (admin/cb/hrbp) — теперь настраивается через dashboard:view в конструкторе.
 * Проверка одна на все три места, где строится навигация (меню ⋮, рельса,
 * верхние вкладки), чтобы правила не разъезжались между ними.
 */
function canSeeDashboard(){
  return hasCap('dashboard:view');
}

// ═══════════════════════════════════════════════════════════
// ЕДИНАЯ МОДЕЛЬ НАВИГАЦИИ (Фаза 1 редизайна)
// ═══════════════════════════════════════════════════════════
// Раньше список пунктов и правила видимости по роли были продублированы в
// renderRail(), renderTopNav() и меню «⋮» — с расхождениями в подписях
// («Дашборд» / «Аналитический дашборд») и в наборе. Теперь все три
// поверхности строятся из navModel(): один набор, одни правила, одни клики.
function mkActive(view){
  return function(){ return S.appView === view && S.unit === null; };
}

function navModel(){
  var u = (S.data && S.data.user) || {};
  var role = u.role;
  var elevated = (role === 'admin' || role === 'cb');

  var primary = [];
  primary.push({ key:'home', label:'Главная', icon:'home',
    active:mkActive('home'), inTabs:true, run:function(){ switchView('home'); } });

  if(elevated){
    // Admin/CB не заполняют анкеты сами — им нужен отчёт по всем
    // подразделениям (та же сводка, что видит HR BP).
    primary.push({ key:'report', label:'Отчёт по подразделениям', icon:'clipboard',
      active:mkActive('progress'), inTabs:false, run:function(){ openProgress(); } });
  } else {
    primary.push({ key:'units', label:'Подразделения', icon:'units',
      active:mkActive('units'), inTabs:true, run:function(){ switchView('units'); } });
  }

  if(canSeeDashboard()){
    primary.push({ key:'dashboard', label:'Дашборд', icon:'dashboard',
      active:mkActive('dashboard'), inTabs:true, run:function(){ switchView('dashboard'); } });
  }
  if(hasCap('benchmarks:view') || elevated){
    primary.push({ key:'benchmarks', label:'Бенчмаркинг', icon:'chart',
      active:mkActive('benchmarks'), inTabs:true, run:function(){ switchView('benchmarks'); } });
  }
  if(role === 'hrbp'){
    primary.push({ key:'hrbp_summary', label:'Сводка по HR BP', icon:'clipboard',
      active:mkActive('progress'), inTabs:false, run:function(){ openProgress(); } });
  }
  if(role === 'dir_head'){
    primary.push({ key:'dept_assign', label:'Назначить ответственных', icon:'clipboard',
      active:mkActive('dept_assign'), inTabs:false, run:function(){ openDeptAssign(); } });
  }

  var adminAll = [
    { key:'users', atab:'users', label:'Пользователи', icon:'users', cap:'users:view' },
    { key:'archive', atab:'archive', label:'Архив', icon:'archive', cap:'users:view' },
    { key:'divisions', atab:'divisions', label:'Оргструктура', icon:'units', cap:'divisions:view' },
    { key:'dict', atab:'dict', label:'Справочники', icon:'book', cap:'dictionary:view' },
    { key:'period', atab:'period', label:'Период сбора', icon:'clock', cap:'period:view' },
    { key:'tools', atab:'tools', label:'Сервисные утилиты', icon:'wrench', cap:'service:view' },
    { key:'audit', atab:'audit', label:'Журнал действий', icon:'clipboard', cap:'service:view' },
    { key:'roles', atab:'roles', label:'Роли и доступы', icon:'shield', adminOnly:true }
  ];
  var admin = canSeeAdmin() ? adminAll.filter(function(t){
    return t.adminOnly ? role === 'admin' : hasCap(t.cap);
  }).map(function(t){
    t.active = (function(atab){
      return function(){ return S.appView === 'admin' && S.adminTab === atab; };
    })(t.atab);
    t.run = (function(tObj){
      return function(){
        if(window.WorkspaceTabs && WorkspaceTabs.openTab){
          WorkspaceTabs.openTab({
            key: 'admin:' + tObj.atab,
            title: tObj.label,
            icon: tObj.icon,
            state: { appView: 'admin', adminTab: tObj.atab, unit: null },
            run: function(){
              S.adminTab = tObj.atab;
              openAdminPanel();
            }
          });
        } else {
          S.adminTab = tObj.atab;
          switchView('admin');
        }
      };
    })(t);
    return t;
  }) : [];

  // Компактная точка входа в админку для узких поверхностей (вкладки, меню «⋮»).
  // На нижней полосе телефона кнопка «Админка» — категория: тап раскрывает
  // выпадашку с разделами админки (submenu), а не уводит сразу на панель.
  var adminEntry = admin.length ? {
    key:'admin', label:'Панель администратора', tabLabel:'Админка', icon:'admin',
    active:function(){ return S.appView === 'admin'; }, inTabs:true,
    submenu: admin.length >= 2 ? admin : null,
    run:function(){
      if(window.WorkspaceTabs && WorkspaceTabs.openTab){
        var atab = S.adminTab || (admin[0] ? admin[0].atab : 'users');
        var cur = admin.filter(function(x){ return x.atab === atab; })[0] || admin[0];
        WorkspaceTabs.openTab({
          key: 'admin:' + atab,
          title: cur ? cur.label : 'Панель администратора',
          icon: cur ? cur.icon : 'admin',
          state: { appView: 'admin', adminTab: atab, unit: null },
          run: function(){ openAdminPanel(); }
        });
      } else {
        switchView('admin');
      }
    }
  } : null;

  var utility = [
    { key:'refresh', label:'Обновить данные', icon:'refresh', run:function(){ doRefresh(); } },
    { key:'help', label:'Как заполнять', icon:'help', run:function(){ openHelp(); } },
    { key:'profile', label:'Профиль', icon:'profile', run:function(){ openProfile(); } },
    { key:'out', label:'Выйти', icon:'logout', danger:true, run:function(){ doLogout(); } }
  ];

  // Кнопка «Ещё» на нижней полосе телефона — категория со всем, что не влезло
  // в саму полосу: разделы вне вкладок (отчёт по подразделениям / сводка HR BP /
  // назначение ответственных) + служебные действия (обновить / помощь /
  // профиль / выход). Раньше это жило только в меню «⋮».
  var moreItems = primary.filter(function(it){ return !it.inTabs; }).concat(utility);
  var moreEntry = moreItems.length ? {
    key:'more', label:'Ещё', tabLabel:'Ещё', icon:'more',
    active:function(){ return false; }, inTabs:true,
    submenu: moreItems,
    run:function(){}
  } : null;

  return { primary:primary, admin:admin, adminEntry:adminEntry, moreEntry:moreEntry, utility:utility };
}

/** Активировать пункт навигации с проверкой несохранённого черновика. */
function navGo(item){
  if(!item) return;
  if(item.active && item.active()) return;
  if(S.dirty && (!window.WorkspaceTabs || !WorkspaceTabs.openTab)){
    askDirty('Переключить раздел').then(function(yes){
      if(yes){ S.dirty = false; item.run(); }
    });
  } else {
    item.run();
  }
}

/**
 * Меню в шапке. Раньше было полноэкранным оверлеем (.sheet) — по просьбе
 * пользователя переделано в панель, закреплённую у шапки справа, с
 * закрытием по X. Действует одинаково на мобильном и десктопе.
 */
// Меню «⋮» — третья поверхность того же компонента: самая полная (все разделы
// + служебные действия), строится из navModel() тем же navRenderBtn.
function openNavMenu(){
  var m = navModel();

  // Группировка разделов по категориям для мобильных экранов
  var mainItems = [];
  var analyticsItems = [];
  m.primary.forEach(function(it){
    if(it.key === 'dashboard' || it.key === 'benchmarks'){
      analyticsItems.push(it);
    } else {
      mainItems.push(it);
    }
  });

  var adminItems = m.admin || [];
  var utilityItems = m.utility || [];

  var categories = [
    { id:'main', label:'Основные разделы', icon:'units', items:mainItems },
    { id:'analytics', label:'Аналитика', icon:'chart', items:analyticsItems },
    { id:'admin', label:'Администрирование', icon:'admin', items:adminItems },
    { id:'utility', label:'Служебные действия', icon:'wrench', items:utilityItems }
  ].filter(function(cat){ return cat.items && cat.items.length > 0; });

  // Какая категория активна — первая совпавшая (не последняя: раньше при
  // совпадении в двух категориях раскрывалась не та).
  var activeCat = categories.find(function(cat){
    return cat.items.some(function(it){ return it.active && it.active(); });
  });
  var activeCatId = activeCat ? activeCat.id : (categories[0] && categories[0].id) || 'main';

  var body = categories.map(function(cat){
    var isOpen = (cat.id === activeCatId);
    var itemsHtml = cat.items.map(function(it){ return navRenderBtn(it, 'menu-item'); }).join('');
    return '<div class="menu-cat' + (isOpen ? ' is-open' : '') + '" data-cat="' + cat.id + '">' +
      '<button type="button" class="menu-cat-hd" aria-expanded="' + (isOpen ? 'true' : 'false') + '">' +
        '<span class="menu-cat-title">' + ic(cat.icon, 13) + esc(cat.label) + '</span>' +
        '<span class="menu-cat-meta">' +
          '<span class="menu-cat-badge">' + cat.items.length + '</span>' +
          '<svg class="menu-cat-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>' +
        '</span>' +
      '</button>' +
      '<div class="menu-cat-body">' + itemsHtml + '</div>' +
    '</div>';
  }).join('');

  var el = document.createElement('div');
  el.className = 'menu-scrim';
  el.innerHTML = '<div class="menu-pop">'+
    '<div class="menu-pop-hd"><div style="display:flex;align-items:center;gap:8px"><b>'+esc(userLabel())+'</b><span class="sheet-ver-badge">'+(window.APP_VERSION || 'v2.3.0')+'</span></div>'+
      '<button class="menu-x" data-x="1" aria-label="Закрыть">'+icBare('close',16)+'</button></div>'+
    '<div class="menu">'+ body +'</div></div>';
  document.body.appendChild(el);

  el.addEventListener('click', function(e){
    if(e.target === el || e.target.closest('[data-x]')){ el.remove(); return; }

    var catHd = e.target.closest('.menu-cat-hd');
    if(catHd){
      var cat = catHd.closest('.menu-cat');
      if(cat){
        var willOpen = !cat.classList.contains('is-open');
        cat.classList.toggle('is-open', willOpen);
        catHd.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      }
      return;
    }

    if(e.target.closest('button[data-nav]')){ el.remove(); navHandleClick(e); }
  });
}
$('btnMenu').onclick = openNavMenu;

/**
 * Выпадашка разделов для кнопки-категории на нижней полосе телефона
 * (сейчас — «Админка»). Лист снизу, поверх полосы; выбор раздела уводит
 * на него через navGo (с проверкой черновика). Раньше эти разделы были
 * доступны только из меню «⋮».
 */
function openNavSubmenu(item){
  if(!item || !item.submenu || item.submenu.length < 2) return;
  var el = document.createElement('div');
  el.className = 'menu-scrim nav-sub-scrim';
  el.innerHTML = '<div class="nav-submenu-pop" role="menu">'+
    '<div class="nav-submenu-hd"><div style="display:flex;align-items:center;gap:8px">'+ic(item.icon, 14)+esc(item.label)+'<span class="sheet-ver-badge">'+(window.APP_VERSION || 'v2.3.0')+'</span></div>'+
      '<button class="menu-x" data-x="1" aria-label="Закрыть">'+icBare('close', 16)+'</button></div>'+
    '<div class="menu">'+
      item.submenu.map(function(s){ return navRenderBtn(s, 'menu-item'); }).join('')+
    '</div></div>';
  document.body.appendChild(el);

  el.addEventListener('click', function(e){
    if(e.target === el || e.target.closest('[data-x]')){ el.remove(); return; }
    if(e.target.closest('button[data-nav]')){ el.remove(); navHandleClick(e); }
  });
}

function renderTopNav(){ renderNav(); }

function switchView(v){
  if(v === 'home') renderHome();
  else if(v === 'units') renderUnits();
  else if(v === 'dashboard') openDashboard();
  else if(v === 'benchmarks') openBenchmarks();
  else if(v === 'admin') openAdminPanel();
  else if(v === 'progress') openProgress();
  else if(v === 'dept_assign') openDeptAssign();
}

/**
 * Профиль пользователя: сводка (ФИО/роль/логин) + смена пароля + Telegram.
 * Открывается из меню «⋮» и из кнопки профиля в боковой панели (десктоп).
 * Сами формы не дублирует — переиспользует openPassword()/openTelegramLink().
 */
function openProfile(){
  var u = S.data.user;
  var hasTg = !!u.hasTelegram;
  var roleNames = { admin:'Администратор', cb:'C&B Аналитик', hrbp:'HR BP', dir_head:'Руководитель направления', head:'Руководитель отдела', user:'Сотрудник' };
  var fio = userLabel();

  // Уникальных компаний-участников рынка (с сервера); фолбэк — считаем сами по
  // строкам rows, если старый ответ без поля.
  var prMarketCompanies = (S.data.marketCompanies != null)
    ? S.data.marketCompanies
    : (function(){
        var s = {};
        (S.data.rows || []).forEach(function(r){
          var n = String(r.company || '').trim().toLowerCase();
          if(n) s[n] = 1;
        });
        return Object.keys(s).length;
      })();

  var el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = '<div class="sheet-in profile-sheet">'+
    '<div class="sheet-hd"><div style="display:flex;align-items:center;gap:8px"><b>Профиль</b><span class="sheet-ver-badge">'+(window.APP_VERSION || 'v2.3.0')+'</span></div>'+
      '<button class="btn-ghost" data-x="1">Закрыть</button></div>'+
    '<div class="profile-card">'+
      '<div class="profile-av">'+esc(fio.trim().slice(0,1).toUpperCase() || '?')+'</div>'+
      '<div><div class="profile-fio">'+esc(fio)+'</div>'+
        '<div class="profile-sub">'+esc(roleNames[u.role] || u.role)+' · '+esc(u.login)+'</div></div>'+
    '</div>'+
    // Сколько подразделений закреплено — первый вопрос, который задают, когда
    // не находят своё; раньше это нигде не показывалось.
    '<div class="profile-facts">'+
      '<div class="pf"><b>'+((S.data.units || []).length)+'</b><span>'+
        declOfNum((S.data.units || []).length, ['подразделение','подразделения','подразделений'])+'</span></div>'+
      // Уникальные компании, а не строки rows (одна компания привязана к
      // десяткам подразделений — там связок было бы под 3600).
      '<div class="pf"><b>'+(prMarketCompanies)+'</b><span>'+
        declOfNum(prMarketCompanies, ['участник рынка','участника рынка','участников рынка'])+'</span></div>'+
      '<div class="pf"><b>'+((S.data.surveys || []).length)+'</b><span>'+
        declOfNum((S.data.surveys || []).length, ['запись','записи','записей'])+'</span></div>'+
    '</div>'+
    '<button id="prName" class="btn-line">'+ic('profile')+'Изменить ФИО</button>'+
    '<button id="prPwd" class="btn-line">'+ic('key')+'Сменить пароль</button>'+
    '<button id="prTg" class="btn-line">'+(hasTg ? ic('check')+'Telegram привязан' : ic('link')+'Привязать Telegram')+'</button>'+
    '<button id="prUnits" class="btn-line">'+ic('units')+'Мои подразделения</button>'+
    // Руководитель направления сам назначает ответственных по отделам своего
    // направления — админ закрепляет за ним только само направление.
    (u.role === 'dir_head' ? '<button id="prAssign" class="btn-line">'+ic('units')+'Назначить ответственных</button>' : '')+
    '<button id="prHelp" class="btn-line">'+ic('help')+'Как заполнять</button>'+
    '<button id="prRefresh" class="btn-line">'+ic('refresh')+'Обновить данные</button>'+
    '<div class="profile-sep"></div>'+
    '<button id="prOut" class="btn-line btn-danger">'+ic('logout')+'Выйти из системы</button>'+
    '<div class="profile-ver">Обзор рынка вознаграждений · Фаровон · '+(window.APP_VERSION || 'v2.3.0')+'</div>'+
    '</div>';
  document.body.appendChild(el);

  el.addEventListener('click', function(e){
    if(e.target === el || e.target.dataset.x) el.remove();
  });

  el.querySelector('#prName').onclick = function(){ el.remove(); openEditName(); };
  el.querySelector('#prPwd').onclick = function(){ el.remove(); openPassword(); };
  el.querySelector('#prTg').onclick = function(){
    el.remove();
    if(hasTg) confirmUnlinkTelegram(); else openTelegramLink();
  };
  el.querySelector('#prHelp').onclick = function(){ openHelp(); };
  el.querySelector('#prUnits').onclick = function(){ el.remove(); switchView('units'); };
  var prAssign = el.querySelector('#prAssign');
  if(prAssign) prAssign.onclick = function(){ el.remove(); openDeptAssign(); };
  el.querySelector('#prRefresh').onclick = function(){ el.remove(); doRefresh(); };
  el.querySelector('#prOut').onclick = function(){ el.remove(); doLogout(); };
}

/**
 * Смена собственного ФИО. ФИО в системе хранится строкой во многих местах
 * (оргструктура, списки ответственных, история), сервер меняет его сразу
 * везде одной операцией и возвращает свежий payload + токен.
 */
function openEditName(){
  var cur = String((S.data.user && S.data.user.fio) || '').trim();
  var el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = '<div class="sheet-in">'+
    '<div class="sheet-hd"><b>Изменить ФИО</b>'+
      '<button class="btn-ghost" data-x="1">Закрыть</button></div>'+
    '<p style="font-size:14px;color:var(--muted);margin:2px 0 10px">Новое ФИО подставится сразу везде: в оргструктуре, в списках ответственных и в истории изменений.</p>'+
    '<div id="nmErr" class="err hidden"></div>'+
    '<label class="lbl">ФИО полностью</label>'+
    '<input id="nmVal" type="text" autocomplete="name">'+
    '<div style="height:16px"></div>'+
    '<button id="nmGo" class="btn-primary">Сохранить</button>'+
    '</div>';
  document.body.appendChild(el);
  el.querySelector('#nmVal').value = cur;

  var err = function(m){ var e = el.querySelector('#nmErr'); e.textContent = m; e.classList.remove('hidden'); };
  guardClose(el, function(){ return el.querySelector('#nmVal').value.replace(/\s+/g, ' ').trim() !== cur; });

  el.querySelector('#nmGo').onclick = function(){
    var v = el.querySelector('#nmVal').value.replace(/\s+/g, ' ').trim();
    if(v.length < 3){ err('Введите ФИО (минимум 3 символа)'); return; }
    if(v === cur){ el.remove(); return; }
    var btn = this;
    btn.disabled = true; btn.textContent = 'Сохраняем…';
    call('apiChangeName', S.token, v).then(function(r){
      btn.disabled = false; btn.textContent = 'Сохранить';
      if(!r || !r.ok){ err((r && r.error) || 'Не удалось изменить ФИО'); return; }
      persistToken(r);
      if(r.data) S.data = r.data;
      el.remove();
      toast('ФИО обновлено');
      if(typeof renderTopNav === 'function') renderTopNav();
      if(S.appView === 'home' && typeof renderHome === 'function') renderHome();
    }).catch(function(){
      btn.disabled = false; btn.textContent = 'Сохранить';
      err('Нет связи с сервером');
    });
  };

  setTimeout(function(){ el.querySelector('#nmVal').focus(); }, 60);
}

/** Смена собственного пароля. forced=true — принудительно после входа по
 *  временному паролю: без кнопки закрытия, после успеха — перезагрузка. */
function openPassword(forced){
  var el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = '<div class="sheet-in">'+
    '<div class="sheet-hd"><b>'+(forced ? 'Требуется сменить пароль' : 'Сменить пароль')+'</b>'+
      (forced ? '' : '<button class="btn-ghost" data-x="1">Закрыть</button>')+'</div>'+
    (forced ? '<p style="font-size:14px;color:var(--muted);margin:2px 0 10px">Вы вошли по временному паролю. Придумайте свой — без этого продолжить нельзя.</p>' : '')+
    '<div id="pwErr" class="err hidden"></div>'+
    '<label class="lbl" style="margin-top:6px">Текущий'+(forced ? ' (временный)' : '')+' пароль</label>'+
    '<input id="pwOld" type="password" autocomplete="current-password">'+
    '<label class="lbl">Новый пароль</label>'+
    '<input id="pwNew" type="password" autocomplete="new-password" placeholder="минимум 8 символов, буква и цифра">'+
    '<label class="lbl">Повторите новый</label>'+
    '<input id="pwNew2" type="password" autocomplete="new-password">'+
    '<div style="height:16px"></div>'+
    '<button id="pwGo" class="btn-primary">Сменить пароль</button>'+
    '<p style="font-size:14px;color:var(--muted);margin:14px 0 0;text-align:center">'+
      'Запишите новый пароль — восстановить его нельзя,<br>только выдать новый через HR BP.</p>'+
    '</div>';
  document.body.appendChild(el);

  var err = function(m){
    var e = el.querySelector('#pwErr');
    e.textContent = m; e.classList.remove('hidden');
  };

  // В forced-режиме окно закрыть нельзя вообще: нет кнопки закрытия и не вешаем
  // guardClose (клик по фону тоже ничего не делает).
  if(!forced){
    guardClose(el, function(){
      return !!(el.querySelector('#pwOld').value || el.querySelector('#pwNew').value || el.querySelector('#pwNew2').value);
    });
  }

  el.querySelector('#pwGo').onclick = function(){
    var o = el.querySelector('#pwOld').value;
    var n = el.querySelector('#pwNew').value;
    var n2 = el.querySelector('#pwNew2').value;
    if(!o || !n){ err('Заполните все поля'); return; }
    if(n.length < 8){ err('Новый пароль — минимум 8 символов'); return; }
    if(!/[A-Za-zА-Яа-я]/.test(n) || !/[0-9]/.test(n)){ err('Нужна хотя бы одна буква и одна цифра'); return; }
    if(n !== n2){ err('Новые пароли не совпадают'); return; }

    var btn = this;
    btn.disabled = true; btn.textContent = 'Меняем…';
    call('apiChangePassword', S.token, o, n).then(function(r){
      btn.disabled = false; btn.textContent = 'Сменить пароль';
      if(!r || !r.ok){ err((r && r.error) || 'Не удалось сменить пароль'); return; }
      if(forced){ toast('Пароль изменён', 'ok'); setTimeout(function(){ location.reload(); }, 700); return; }
      el.remove();
      toast('Пароль изменён. В следующий раз входите с новым.');
    }).catch(function(){
      btn.disabled = false; btn.textContent = 'Сменить пароль';
      err('Нет связи с сервером');
    });
  };

  setTimeout(function(){ el.querySelector('#pwOld').focus(); }, 60);
}

/** Привязка Telegram — получаем одноразовую ссылку и открываем чат с ботом. */
function openTelegramLink(){
  var el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = '<div class="sheet-in">'+
    '<div class="sheet-hd"><b>Привязать Telegram</b>'+
      '<button class="btn-ghost" data-x="1">Закрыть</button></div>'+
    '<div id="tgBody" class="sp"><i></i> Готовим ссылку…</div>'+
    '</div>';
  document.body.appendChild(el);

  el.addEventListener('click', function(e){
    if(e.target === el || e.target.dataset.x) el.remove();
  });

  call('apiTelegramLink', S.token).then(function(r){
    var box = el.querySelector('#tgBody');
    if(!r || !r.ok){
      box.className = 'err';
      box.textContent = (r && r.error) || 'Не удалось получить ссылку';
      return;
    }
    // Диплинк с кодом подставляет «/start <код>» в поле ввода не у всех
    // клиентов Telegram — если чат с ботом уже открывался раньше, часть
    // клиентов просто открывает чат, ничего не подставляя, и человек не
    // понимает, что сделать. Привязка по номеру телефона (кнопка в самом
    // боте) не зависит от этого — поэтому она теперь основной вариант,
    // а ссылка с кодом — запасной.
    var botUser = (r.deepLink.match(/t\.me\/([^?]+)/) || [])[1] || '';
    box.className = '';
    box.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:6px 4px 0">'+
        '<div style="width:52px;height:52px;border-radius:50%;background:var(--accent-soft);color:var(--accent);'+
          'display:flex;align-items:center;justify-content:center;margin-bottom:12px">'+icBare('link', 24)+'</div>'+
        '<p style="color:var(--muted);font-size:14.5px;line-height:1.5;margin:0">'+
          'Откройте бота'+(botUser?' <b>@'+esc(botUser)+'</b>':'')+', наберите <b>/link</b> и нажмите '+
          'кнопку «Отправить номер телефона» — привяжется по номеру из вашего профиля.</p>'+
      '</div>'+
      '<div style="height:14px"></div>'+
      '<a href="https://t.me/'+esc(botUser)+'" target="_blank" class="btn-primary" '+
        'style="display:flex;align-items:center;justify-content:center;text-decoration:none">'+
        'Открыть '+(botUser?'@'+esc(botUser):'бота')+'</a>'+
      '<p style="color:var(--muted);font-size:13.5px;line-height:1.5;margin-top:14px;text-align:center">'+
        'Или ссылка с кодом (действует '+r.expiresInMinutes+' минут) — у части клиентов Telegram '+
        'сама подставляет команду, тогда останется нажать «Отправить»:</p>'+
      '<a href="'+esc(r.deepLink)+'" target="_blank" class="btn-line" '+
        'style="display:flex;align-items:center;justify-content:center;text-decoration:none">'+
        'Открыть по ссылке с кодом</a>';
  }).catch(function(){
    el.querySelector('#tgBody').className = 'err';
    el.querySelector('#tgBody').textContent = 'Нет связи с сервером';
  });
}

/** Отвязка Telegram — тот же результат, что команда /unlink у самого бота,
 *  но доступно и из приложения на случай, если под рукой нет Telegram. */
function confirmUnlinkTelegram(){
  ask({
    title: 'Отвязать Telegram?',
    html: 'Напоминания и уведомления через бота приходить перестанут. Привязать можно будет заново в любой момент.',
    ok: 'Отвязать',
    cancel: 'Остаться',
    danger: true
  }).then(function(yes){
    if(!yes) return;
    call('apiTelegramUnlink', S.token).then(function(r){
      if(r && r.ok){
        S.data.user.hasTelegram = false;
        toast('Telegram отвязан');
      } else {
        toast((r && r.error) || 'Не удалось отвязать', 'no');
      }
    }).catch(function(){ toast('Нет связи с сервером', 'no'); });
  });
}

/** Подпись пользователя. Если ФИО в таблице не заполнено — показываем логин. */
function userLabel(){
  if(!S.data) return '';
  var f = String(S.data.user.fio || '').trim();
  if(f.length > 1 && !/^\d+$/.test(f)) return f;
  return S.data.user.login;
}

$('btnHelp').onclick = function(){ openHelp(); };
$('railFootBtn').onclick = function(){ openProfile(); };

function openHelp(){
  var el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = '<div class="sheet-in howto-sheet">'+
    '<div class="sheet-hd"><b>Как заполнять</b>'+
      '<button class="btn-ghost" data-x="1">Закрыть</button></div>'+
    '<ol class="howto">'+
      '<li><b>Откройте своё подразделение</b>Если их несколько — по очереди каждое.</li>'+
      '<li><b>Шаг 1. Участники рынка</b>По каждой компании нажмите одну из трёх кнопок: '+
        '«Актуально» — компания релевантна для сравнения, «Не актуально» — нет, '+
        '«Уточнить» — не уверены. Чего не хватает — добавьте кнопкой «+ Добавить компанию».</li>'+
      '<li><b>«Уточнить» — это не «проверено»</b>Такие компании остаются в работе '+
        'и отдельно видны и вам, и HR BP. Вернитесь к ним, когда выясните.</li>'+
      '<li><b>Шаг 2. Данные по рынку</b>Здесь главное. По должностям, которые знаете, '+
        'внесите оклад, бонусы и льготы в компании-участнике. Неполные данные тоже нужны — '+
        'знаете только оклад, впишите оклад.</li>'+
      '<li><b>Должность выбирается из списка</b>Нажмите на поле, найдите нужную через поиск. '+
        'Если такой нет — внизу появится кнопка «Добавить», и должность попадёт в общий справочник.</li>'+
      '<li><b>Нажмите «Сохранить»</b>Одна кнопка сохраняет оба шага сразу. Кнопка появляется, '+
        'когда есть несохранённые изменения, и уходит после сохранения.</li>'+
    '</ol>'+
    '<div class="callout-h">Можно заполнять в несколько заходов — просто сохраняйте по ходу. '+
      'Когда всё готово, нажмите «Сохранить и отправить как готовое» на шаге 1. '+
      'Любое окно закрывается клавишей Esc.</div>'+
    '<div class="howto-acts">'+
      '<button class="btn-line" id="howtoTour">'+ic('target', 14)+'Пройти обучение по интерфейсу</button>'+
      '<button class="btn-primary" data-x="1">Понятно</button>'+
    '</div></div>';
  document.body.appendChild(el);
  el.addEventListener('click', function(e){
    if(e.target === el || e.target.dataset.x){ el.remove(); return; }
    if(e.target.closest('#howtoTour')){ el.remove(); startTour(); }
  });
}

// ═══════════════════════════════════════════════════════════
// ОНБОРДИНГ — подсвечивающий тур по реальному интерфейсу (Фаза 6)
// ═══════════════════════════════════════════════════════════
// Вместо трёх текстовых слайдов — «прожектор» по живым элементам экрана:
// затемняем всё, кроме нужной кнопки/карточки, и рядом показываем подсказку
// «куда нажать и что выбрать». Роль-зависимый набор шагов. Флаг прохождения
// в LS_OB (тот же, что гасит подсказку-карточку в renderUnits). Запустить
// заново — «Помощь» → «Пройти обучение» или ⌘K → «Пройти обучение».

function tourSteps(){
  var r = S.data && S.data.user && S.data.user.role;
  var elevated = (r === 'admin' || r === 'cb');

  if(elevated){
    return [
      { sel:'.rail-item[data-nav], .nav-btn[data-nav]', title:'Разделы',
        body:'Слева (или снизу на телефоне) — переходы между разделами: отчёт, дашборд, бенчмаркинг, админка.' },
      { sel:'#btnCmdk', title:'Быстрый поиск — Ctrl/⌘ + K',
        body:'Отсюда можно за пару клавиш попасть в любой раздел, открыть подразделение или выполнить действие.' },
      { sel:'#topPeriodBadge, .rail-item[data-nav="dashboard"], .nav-btn[data-nav="dashboard"]', title:'Аналитика рынка',
        body:'На «Дашборде» — зарплатные вилки, перцентили, гэп к рынку и прогресс по HR BP.', optional:true },
      { sel:'#btnTheme', title:'Тема оформления',
        body:'Светлая, тёмная или «как в системе» — переключается здесь.' }
    ];
  }

  return [
    { sel:'#unitsContainer .unit', waitFor:true, title:'Начните с вашего подразделения',
      body:'Нажмите на карточку — внутри два шага: отметить компании и внести данные по рынку.',
      cta:'Открыть подразделение', ctaClicks:true },
    { sel:'.b-co-actions .seg, .batch-card .seg', waitFor:true, title:'Шаг 1. Отметьте компании',
      body:'По каждой компании нажмите одну из трёх кнопок: «Актуально» — важна для сравнения, «Не актуально» — нет, «Уточнить» — вернётесь к ней позже.' },
    { sel:'.unit-step-tabs .sub-tab:last-child, [data-tab="survey"]', waitFor:true, title:'Шаг 2. Данные по рынку',
      body:'Здесь главное — внесите оклад, бонусы и льготы по должностям, которые знаете. Неполные данные тоже нужны.' },
    { sel:'#btnHelp', title:'Инструкция всегда рядом',
      body:'Полное описание «Как заполнять» открывается здесь в любой момент. Готово — можно работать.' }
  ];
}

var _tourActive = false;

// Факт прохождения тура: с 2026-09 хранится на учётке (S.data.user.onboarded,
// приходит с /auth/login и /auth/resume). LS_OB остаётся локальным кэшем —
// гасит подсказку сразу, не дожидаясь следующего resume, и работает офлайн /
// в Telegram, где сессия своя.
function obSeen(){
  return !!(S.data && S.data.user && S.data.user.onboarded) || store.get(LS_OB) === '1';
}
// Отметить пройденным: локальный кэш + текущее состояние + серверная отметка
// (идемпотентная, ошибку глотаем — не критично, повторится при след. вызове).
function obMark(){
  store.set(LS_OB, '1');
  if(S.data && S.data.user) S.data.user.onboarded = true;
  try { call('apiMarkOnboarded', S.token).catch(function(){}); } catch(e){}
}

function showOnboarding(){
  if(obSeen()) return;
  startTour();
}

function startTour(){
  if(_tourActive) return;
  var steps = tourSteps().slice();
  if(!steps.length){ obMark(); return; }

  // Тур заполнителя начинается со списка подразделений. Если человек сейчас
  // в другом разделе (запустил «Пройти обучение» из меню) и нет несохранённых
  // правок — сначала возвращаемся туда.
  var role = S.data && S.data.user && S.data.user.role;
  var elevated = (role === 'admin' || role === 'cb');
  if(!elevated && S.appView !== 'units' && !S.dirty && typeof renderUnits === 'function'){
    try { renderUnits(); } catch(e){}
  }

  _tourActive = true;
  var i = 0;
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var mask = document.createElement('div');
  mask.className = 'tour-mask';
  var hole = document.createElement('div');
  hole.className = 'tour-hole';
  var tip = document.createElement('div');
  tip.className = 'tour-tip';
  mask.appendChild(hole);
  document.body.appendChild(mask);
  document.body.appendChild(tip);

  function done(){
    _tourActive = false;
    obMark();
    mask.remove(); tip.remove();
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
  }

  function findEl(sel){
    var list = sel.split(',');
    for(var k = 0; k < list.length; k++){
      var e = document.querySelector(list[k].trim());
      if(e && e.getBoundingClientRect().width > 0) return e;
    }
    return null;
  }

  function waitFor(sel, cb, tries){
    tries = tries || 0;
    var e = findEl(sel);
    if(e) return cb(e);
    if(tries > 40) return cb(null); // ~2 c
    setTimeout(function(){ waitFor(sel, cb, tries + 1); }, 50);
  }

  var curTarget = null;

  function place(){
    if(!curTarget) return;
    var r = curTarget.getBoundingClientRect();
    var pad = 6;
    hole.style.top = (r.top - pad) + 'px';
    hole.style.left = (r.left - pad) + 'px';
    hole.style.width = (r.width + pad * 2) + 'px';
    hole.style.height = (r.height + pad * 2) + 'px';

    // куда ставить подсказку: под элементом, если снизу есть место, иначе над
    var tipH = tip.offsetHeight || 160;
    var below = r.bottom + 12 + tipH < window.innerHeight;
    var top = below ? r.bottom + 12 : Math.max(12, r.top - tipH - 12);
    var left = Math.min(Math.max(12, r.left), window.innerWidth - (tip.offsetWidth || 320) - 12);
    tip.style.top = top + 'px';
    tip.style.left = left + 'px';
  }

  function render(){
    var s = steps[i];
    var last = i === steps.length - 1;
    tip.innerHTML =
      '<div class="tour-step">' + (i + 1) + ' / ' + steps.length + '</div>' +
      '<div class="tour-title">' + esc(s.title) + '</div>' +
      '<div class="tour-body">' + esc(s.body) + '</div>' +
      '<div class="tour-nav">' +
        '<button class="btn-ghost" data-t="skip">Пропустить</button>' +
        (i > 0 ? '<button class="btn-line" data-t="prev">Назад</button>' : '') +
        '<button class="btn-primary" data-t="next">' +
          (s.ctaClicks && s.cta ? esc(s.cta) : (last ? 'Готово' : 'Далее')) +
        '</button>' +
      '</div>';
    // после вставки узнаём высоту и позиционируем
    requestAnimationFrame(place);
  }

  function go(dir){
    var s = steps[i];
    // Если шаг «кликом открывает» экран — нажимаем целевой элемент и ждём след.
    if(dir > 0 && s && s.ctaClicks && curTarget){
      var t = curTarget;
      curTarget = null;
      t.click();
      i++;
      setTimeout(step, 250);
      return;
    }
    i += dir;
    if(i < 0) i = 0;
    if(i >= steps.length){ done(); return; }
    step();
  }

  function step(){
    var s = steps[i];
    var apply = function(el){
      if(!el){
        // элемент не появился — если шаг необязательный, пропускаем дальше;
        // иначе аккуратно завершаем.
        if(s.optional && i < steps.length - 1){ i++; return step(); }
        return done();
      }
      curTarget = el;
      el.scrollIntoView({ block:'center', behavior: reduce ? 'auto' : 'smooth' });
      setTimeout(function(){ render(); place(); }, reduce ? 0 : 180);
    };
    if(s.waitFor) waitFor(s.sel, apply);
    else apply(findEl(s.sel));
  }

  function onKey(e){
    if(e.key === 'Escape'){ e.preventDefault(); done(); }
    else if(e.key === 'ArrowRight' || e.key === 'Enter'){ e.preventDefault(); go(1); }
    else if(e.key === 'ArrowLeft'){ e.preventDefault(); go(-1); }
  }

  tip.addEventListener('click', function(e){
    var b = e.target.closest('[data-t]');
    if(!b) return;
    if(b.dataset.t === 'skip') return done();
    if(b.dataset.t === 'prev') return go(-1);
    go(1);
  });
  mask.addEventListener('click', function(e){
    // клик по затемнению = пропустить; клик по «дырке» проваливается к элементу
    if(e.target === mask) done();
  });
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', place);

  step();
}

function onLoaded(data){
  S.data = data;
  var isElevated = (data.user.role === 'admin' || data.user.role === 'cb');
  S.ro = !!(data.period && data.period.state === 'закрыт' && data.user.role !== 'hrbp' && !isElevated);

  restoreNavState();

  // Свежий вход (нет сохранённой навигации) — на «Главную». Возврат в уже
  // начатую сессию открывает тот раздел, где человек был.
  if(!S.appView) S.appView = 'home';
  show('app');
  renderTopNav();

  // Вошёл по временному паролю — форсируем смену, остальное не показываем.
  if(data.mustChangePassword){ openPassword(true); return; }

  if(data.needsUnitPick) renderUnitPicker();
  else if(data.needsAssignment) renderNeedsAssignment();
  else renderCurrentView();

  // Первый снимок в history — иначе первый «назад» сразу выходит из приложения.
  pushNavHistory(true);

  // Онбординг первого входа — поверх уже отрисованного первого экрана.
  if(!isElevated) showOnboarding();
}

// Отрисовать экран по текущему S.appView / S.unit. Единая точка: и при входе
// (onLoaded), и при «назад/вперёд» браузера (popstate).
function renderCurrentView(){
  if(S.appView === 'home') renderHome();
  else if(S.appView === 'unit' && S.unit) openUnit(S.unit);
  else if(S.appView === 'dashboard') openDashboard();
  else if(S.appView === 'benchmarks') openBenchmarks();
  else if(S.appView === 'progress') openProgress();
  else if(S.appView === 'dept_assign') openDeptAssign();
  else if(S.appView === 'admin') openAdminPanel();
  else renderUnits();
  try { restoreViewScroll(); } catch(e){}
}

// ═══════════════════════════════════════════════════════════
// ЭКРАН: Главная — стартовый экран после входа (все роли)
// ═══════════════════════════════════════════════════════════
/**
 * Обзор + навигация. Цифры и набор карточек-разделов подстраиваются под роль:
 * admin/cb видят агрегат по всем подразделениям, остальные — по своим.
 * Карточки ведут в те же экраны, что и боковая панель (те же open*-функции).
 */
function renderHome(){
  if(window.WorkspaceTabs && WorkspaceTabs.openTab && !WorkspaceTabs.isInsideTabRun){
    WorkspaceTabs.openTab({
      key: 'home',
      title: 'Главная',
      icon: 'home',
      state: { appView: 'home', unit: null },
      run: function(){ renderHome(); }
    });
    return;
  }
  S.appView = 'home';
  S.unit = null;
  S.dirty = false;
  saveNavState();
  setTop('Главная', userLabel(), false);
  $('bar').classList.add('hidden');
  document.body.classList.remove('has-bar');
  $('body').onclick = null;

  var u = S.data.user;
  var r = u.role;
  var isElevated = (r === 'admin' || r === 'cb');
  var roleNames = { admin:'Администратор', cb:'C&B Аналитик', hrbp:'HR BP', dir_head:'Руководитель направления', head:'Руководитель отдела', user:'Сотрудник' };
  var units = S.data.units || [];

  var agg = units.reduce(function(a, x){
    a.total += x.total || 0; a.done += x.done || 0;
    a.ask += x.ask || 0; a.surveys += x.surveys || 0;
    return a;
  }, { total:0, done:0, ask:0, surveys:0 });
  // «Участники рынка» — уникальные компании (с сервера); построчная сумма
  // total/done по отделам задваивает одну компанию десятки раз (agg.* — фолбэк
  // на случай старого ответа без этих полей).
  var mcTotal = (S.data.marketCompanies != null) ? S.data.marketCompanies : agg.total;
  var mcDone = (S.data.marketCompaniesDone != null) ? S.data.marketCompaniesDone : agg.done;
  var pct = mcTotal ? Math.round(mcDone / mcTotal * 100) : 0;

  var p = S.data.period || {};
  var periodOpen = p.state !== 'закрыт';

  function stat(val, label, hint, cls){
    var vHtml;
    if(typeof val === 'number'){
      vHtml = '<span data-countup="'+val+'">0</span>';
    } else if(typeof val === 'string' && /^\d+%$/.test(val)){
      vHtml = '<span data-countup="'+parseInt(val, 10)+'" data-countup-suffix="%">0%</span>';
    } else {
      vHtml = val;
    }
    return '<div class="home-stat">'+
      '<div class="home-stat-v">'+vHtml+'</div>'+
      '<div class="home-stat-l">'+esc(label)+'</div>'+
      (hint ? '<div class="home-stat-h'+(cls ? ' '+cls : '')+'">'+esc(hint)+'</div>' : '')+
    '</div>';
  }

  // Карточки-разделы — те же назначения, что в боковой панели.
  var navCards = [];
  if(isElevated){
    navCards.push({ label:'Отчёт по подразделениям', desc:'Прогресс сбора по всем направлениям', icon:'clipboard', run:openProgress });
  } else {
    navCards.push({ label:'Мои подразделения', desc:'Участники рынка и данные по окладам', icon:'units', run:renderUnits });
  }
  if(canSeeDashboard()){
    navCards.push({ label:'Дашборд', desc:'Вилки окладов, перцентили, гэп к рынку', icon:'dashboard', run:openDashboard });
  }
  if(typeof openBenchmarks === 'function' && (hasCap('benchmarks:view') || isElevated)){
    navCards.push({ label:'Бенчмаркинг', desc:'Сравнение вознаграждений по внешним источникам', icon:'chart', run:openBenchmarks });
  }
  if(r === 'hrbp'){
    navCards.push({ label:'Сводка по HR BP', desc:'Состояние по направлениям, открытие периода', icon:'clipboard', run:openProgress });
  }
  if(r === 'dir_head'){
    navCards.push({ label:'Назначить ответственных', desc:'Закрепить отделы направления за сотрудниками', icon:'users', run:openDeptAssign });
  }
  if(canSeeAdmin()){
    navCards.push({ label:'Админка', desc:'Пользователи, оргструктура, справочники, период', icon:'admin', run:function(){ S.adminTab = 'users'; openAdminPanel(); } });
  }

  var nextStep = '';
  if(!isElevated && periodOpen && mcTotal && mcDone < mcTotal){
    nextStep = 'Идёт сбор. Проверьте участников рынка и внесите оклады — осталось ' + (mcTotal - mcDone) + '.';
  } else if(!isElevated && periodOpen){
    nextStep = 'Участники рынка проверены. Загляните в «Данные по рынку» — не забыты ли оклады по должностям.';
  } else if(!periodOpen){
    nextStep = r === 'hrbp'
      ? 'Период закрыт. Правка вам доступна; открыть период — в «Сводке по HR BP».'
      : 'Период сбора закрыт — данные доступны для просмотра.';
  } else if(isElevated){
    nextStep = 'Период открыт. Незакрытые направления видны в «Отчёте по подразделениям».';
  }

  var firstName = esc(String(u.fio || u.login || '').trim().split(/\s+/)[0] || u.login);

  var h = '<div class="home-scroll">';
  h += '<div class="home-hero">'+
      '<div class="home-hi">Здравствуйте, <span class="home-hi-name">' + firstName + '</span></div>'+
      '<div class="home-role">' + esc(roleNames[r] || r) + '</div>'+
    '</div>';

  h += periodBanner();

  h += '<div class="home-stats">'+
    stat(units.length, isElevated ? 'подразделений' : 'моих подразделений', null) +
    stat(pct + '%', 'участники рынка проверены', mcTotal ? (mcDone + ' из ' + mcTotal) : 'нет данных') +
    stat(agg.surveys, 'записей по рынку', null) +
    stat('<span class="home-period-name">' + esc(p.name || '—') + '</span>', 'период сбора',
         (p.to ? 'до ' + p.to : '') + (periodOpen ? '' : ' · закрыт'), periodOpen ? 'ok' : 'mut') +
  '</div>';

  // Уникальные компании «на уточнении» (с сервера). agg.ask — построчная сумма
  // по отделам, одна компания в ней задваивается десятки раз; для плашки нужен
  // счёт уникальных компаний в подразделениях пользователя.
  var askCompanies = (S.data.marketAskCompanies != null) ? S.data.marketAskCompanies : agg.ask;
  if(askCompanies){
    h += '<div class="note home-hint">На уточнении: <b>' + askCompanies + '</b> ' +
      declOfNum(askCompanies, ['компания', 'компании', 'компаний']) +
      ' — ещё не считаются проверенными.</div>';
  }

  h += '<div class="sec-title home-sec">Разделы</div>';
  h += '<div class="home-cards fx-stagger">' + navCards.map(function(c, i){
    return '<button class="home-card" data-i="' + i + '">'+
      '<span class="home-card-ic">' + ic(c.icon, 18) + '</span>'+
      '<span class="home-card-t">' + esc(c.label) + '</span>'+
      '<span class="home-card-d">' + esc(c.desc) + '</span>'+
    '</button>';
  }).join('') + '</div>';

  if(nextStep){
    h += '<div class="info home-hint">' + ic('target', 14) + ' ' + esc(nextStep) + '</div>';
  }

  h += '</div>';
  $('body').innerHTML = h;

  $('body').querySelector('.home-cards').onclick = function(e){
    var b = e.target.closest('.home-card');
    if(!b) return;
    var c = navCards[+b.dataset.i];
    if(c && typeof c.run === 'function') c.run();
  };
}

/** Плашка о состоянии периода. */
function periodBanner(){
  var p = S.data.period || {};
  if(p.state === 'закрыт'){
    return '<div class="note"><b>Период заполнения закрыт</b>' +
      (p.name ? ' — ' + esc(p.name) : '') + (p.to ? ', ' + esc(p.to) : '') + '.<br>' +
      (S.data.user.role === 'hrbp'
        ? 'Вы HR BP — правка доступна. Открыть период можно в разделе «Сводка».'
        : 'Данные доступны только для просмотра.') + '</div>';
  }
  return p.name ? '<div class="info">Идёт: <b>' + esc(p.name) + '</b>' +
    (p.to ? ' · до ' + esc(p.to) : '') + '</div>' : '';
}

// ═══════════════════════════════════════════════════════════
// ЭКРАН: выбор подразделения
// ═══════════════════════════════════════════════════════════
/**
 * Экран для dir_head/head, за которыми администратор ещё не закрепил
 * направление/отдел. Раньше в этом случае показывался тот же свободный
 * пикер, что и рядовому сотруднику, — то есть руководитель мог сам выбрать
 * себе зону ответственности. Теперь только ждём назначения сверху.
 */
function renderNeedsAssignment(){
  setTop('Назначение ожидается', userLabel(), false);
  $('bar').classList.add('hidden');
  $('body').onclick = null;
  $('body').innerHTML = '<div class="empty" style="max-width:460px;margin:48px auto 0;padding:40px 24px">' +
    '<div style="color:var(--line-strong);margin-bottom:12px;line-height:0">'+icBare('clock', 40)+'</div>' +
    '<b style="display:block;color:var(--text);font-size:15px;margin-bottom:6px">Назначение ещё не выполнено</b>' +
    '<span style="display:block;margin-bottom:16px">За вами пока не закреплено направление или отдел. ' +
    'Назначение выполняет администратор — как только он это сделает, здесь появятся ваши подразделения.</span>' +
    '<button id="naRefresh" class="btn-primary" style="width:auto;padding:0 20px">Проверить снова</button>' +
    '</div>';
  $('naRefresh').onclick = function(){
    this.disabled = true; this.textContent = 'Проверяем…';
    doRefresh();
  };
}

function renderUnitPicker(){
  setTop('Выберите подразделение', userLabel(), false);
  $('body').onclick = null;
  $('body').innerHTML =
    '<div class="unit-picker-card">' +
    '<div class="note">За вами пока не закреплено подразделение. ' +
    'Отметьте те, по которым вы отвечаете за обзор рынка.</div>' +
    '<div class="search-wrap" style="margin-bottom:10px">'+icBare('search')+'<input id="pickFind" placeholder="Поиск по названию…"></div><div id="pickList"></div>' +
    '<div style="height:14px"></div><button id="pickGo" class="btn-primary">Продолжить</button>' +
    '</div>';
  var chosen = {};
  function draw(){
    var q = ($('pickFind').value||'').toLowerCase();
    $('pickList').innerHTML = S.data.allUnits.filter(function(u){
      return !q || u.unit.toLowerCase().indexOf(q) >= 0 || u.dir.toLowerCase().indexOf(q) >= 0;
    }).slice(0,80).map(function(u){
      return '<label class="pickrow"><input type="checkbox" data-u="'+esc(u.unit)+'"'+
        (chosen[u.unit]?' checked':'')+'><span>'+esc(u.unit)+
        '<br><small style="color:var(--muted)">'+esc(u.dir)+'</small></span></label>';
    }).join('') || '<p style="color:var(--muted)">Ничего не найдено</p>';
  }
  draw();
  $('pickFind').oninput = draw;
  $('pickList').onchange = function(e){
    if(e.target.dataset.u) chosen[e.target.dataset.u] = e.target.checked;
  };
  $('pickGo').onclick = function(){
    var list = Object.keys(chosen).filter(function(k){ return chosen[k]; });
    if(!list.length){ toast('Отметьте хотя бы одно подразделение'); return; }
    this.disabled = true; this.textContent = 'Сохраняем…';
    call('apiSetUnits', S.token, list).then(function(r){
      if(r && r.ok){ S.data = r.data; renderUnits(); }
      else { toast((r&&r.error)||'Ошибка'); $('pickGo').disabled=false; $('pickGo').textContent='Продолжить'; }
    });
  };
}

// ═══════════════════════════════════════════════════════════
// ЭКРАН: список подразделений
// ═══════════════════════════════════════════════════════════
function renderUnits(){
  if(window.WorkspaceTabs && WorkspaceTabs.openTab && !WorkspaceTabs.isInsideTabRun){
    WorkspaceTabs.openTab({
      key: 'units',
      title: 'Подразделения',
      icon: 'units',
      state: { appView: 'units', unit: null },
      run: function(){ renderUnits(); }
    });
    return;
  }
  S.appView = 'units';
  S.unit = null;
  S.dirty = false;
  saveNavState();
  setTop('Мои подразделения', userLabel(), false);
  $('bar').classList.add('hidden');

  var u = S.data.units;
  if(!u.length){
    $('body').innerHTML = periodBanner() + '<div class="note">Подразделения не назначены. Обратитесь к HR BP.</div>';
    return;
  }
  var totalAll = 0, doneAll = 0, askAll = 0, svAll = 0;
  u.forEach(function(x){
    totalAll += x.total; doneAll += x.done; askAll += (x.ask||0); svAll += (x.surveys||0);
  });
  // Уникальные компании (с сервера), а не построчная сумма total/done/ask по
  // отделам — одна компания привязана к десяткам подразделений.
  var askCompanies = (S.data.marketAskCompanies != null) ? S.data.marketAskCompanies : askAll;
  var mcTotal = (S.data.marketCompanies != null) ? S.data.marketCompanies : totalAll;
  var mcDone = (S.data.marketCompaniesDone != null) ? S.data.marketCompaniesDone : doneAll;

  // Смежные группы сворачиваются в одну карточку: данные общие, заполняется
  // раз на все площадки (см. openUnit → mergeGroupSurveys, серверный разнос).
  var display = collapseUnitGroups(u);

  // Незаполненные и требующие заполнения подразделения поднимаются выше,
  // чтобы руководитель в первую очередь видел их и заполнил:
  // 0. «Не начато» (0 компаний, 0 анкет) — самый верх
  // 1. Компании начаты/проверены, но анкеты ещё 0
  // 2. «В работе» (анкеты начаты, но ещё не готово)
  // 3. «Готово» — полностью заполненные опускаются вниз
  display.sort(function(a, b){
    var sa = getUnitSortScore(a);
    var sb = getUnitSortScore(b);
    if(sa !== sb) return sa - sb;
    return (a._origIdx || 0) - (b._origIdx || 0);
  });

  var h = periodBanner();

  if(!obSeen()){
    h += '<div class="onboard"><h2>Добро пожаловать в обзор рынка вознаграждений</h2><ol>'+
      '<li>Выберите <b>своё подразделение</b> в списке ниже.</li>'+
      '<li><b>Шаг 1. Участники рынка</b> — отметьте компании («Актуально» / «Не актуально» / «Уточнить»).</li>'+
      '<li><b>Шаг 2. Данные по рынку</b> — внесите зарплаты и льготы по должностям.</li>'+
      '<li>Нажмите <b>«Сохранить»</b> внизу экрана.</li>'+
      '</ol><div class="ob-act">'+
      '<button id="obMore">'+ic('book')+'Инструкция</button>'+
      '<button id="obHide" class="btn-primary onboard-hide">Понятно, скрыть</button>'+
      '</div></div>';
  }

  if(u.length > 2){
    h += '<div class="search-wrap" style="margin-bottom:12px">'+icBare('search')+
      '<input id="unitFilter" placeholder="Быстрый поиск подразделения…" autocomplete="off"></div>';
  }

  h += '<div class="units-summary">'+
    '<span class="us-h">'+display.length+'</span> '+declOfNum(display.length, ['подразделение','подразделения','подразделений'])+
    '<span class="us-dot"></span>'+
    '<b>'+mcDone+'</b> из '+mcTotal+' '+declOfNum(mcTotal, ['компании проверено','компаний проверено','компаний проверено'])+
    (askCompanies ? '<span class="us-dot"></span><span class="us-ask">'+askCompanies+' '+declOfNum(askCompanies, ['компания','компании','компаний'])+' на уточнении</span>' : '')+
    '<span class="us-dot"></span>'+
    '<b>'+svAll+'</b> '+declOfNum(svAll, ['запись по рынку','записи по рынку','записей по рынку'])+
    '</div>';
  h += '<div id="unitsContainer" class="fx-stagger">' + renderUnitCards(display) + '</div>';
  $('body').innerHTML = h;

  if($('obMore')) $('obMore').onclick = openHelp;
  if($('obHide')) $('obHide').onclick = function(){ obMark(); renderUnits(); };

  if($('unitFilter')){
    $('unitFilter').oninput = function(){
      var q = this.value.trim().toLowerCase();
      var filtered = display.filter(function(x){
        if(!q) return true;
        if((x.dir||'').toLowerCase().indexOf(q) >= 0) return true;
        if(x.__group) return x.key.toLowerCase().indexOf(q) >= 0 ||
          x.members.some(function(m){ return m.unit.toLowerCase().indexOf(q) >= 0; });
        return x.unit.toLowerCase().indexOf(q) >= 0;
      });
      $('unitsContainer').innerHTML = renderUnitCards(filtered);
    };
  }

  $('body').onclick = function(e){
    var el = e.target.closest('.unit');
    if(el && el.dataset.u){
      try { markActiveItem('unit_' + el.dataset.u, 'units'); } catch(e2){}
      openUnit(el.dataset.u);
    }
  };
  try { restoreViewScroll('units'); } catch(e){}
}

/**
 * Сворачивает площадки одной смежной группы (u.group) в одну запись
 * {__group:true, key, dir, members:[...], unit:<представитель>, ...агрегаты}.
 * Позиция группы в списке — на месте её первой площадки. Одиночные
 * подразделения проходят как есть.
 */
function collapseUnitGroups(units){
  var out = [], seen = {};
  (units || []).forEach(function(x, idx){
    var g = String(x.group || '').trim();
    if(!g){
      x._origIdx = idx;
      out.push(x);
      return;
    }
    if(seen[g]){
      var grp = seen[g];
      grp.members.push(x);
      grp.total = Math.max(grp.total, x.total || 0);
      grp.done = Math.max(grp.done, x.done || 0);
      grp.ask = Math.max(grp.ask, x.ask || 0);
      grp.surveys = Math.max(grp.surveys, x.surveys || 0);
      return;
    }
    var rec = {
      __group: true,
      _origIdx: idx,
      key: g,
      dir: x.dir || '',
      unit: x.unit,               // представитель — по нему openUnit → currentUnitGroup
      members: [x],
      total: x.total || 0,
      done: x.done || 0,
      ask: x.ask || 0,
      surveys: x.surveys || 0,
      note: ''
    };
    seen[g] = rec;
    out.push(rec);
  });
  return out;
}

/** Короткое имя площадки внутри группы: убираем общий префикс-ключ. */
function shortMemberName(unitName, key){
  var n = String(unitName || '').replace(/^\s*\d+[\s.\-–]*/, '').trim();
  var k = String(key || '').trim();
  if(k && n.toLowerCase().indexOf(k.toLowerCase()) === 0){
    var rest = n.slice(k.length).replace(/^[\s·,–-]+/, '').trim();
    if(rest) return rest;
  }
  return n;
}

function getUnitCardStatus(x){
  var sv = x.surveys || 0;
  var step1done = x.total > 0 && x.done >= x.total && !(x.ask || 0);
  if(x.done === 0 && sv === 0) return { k:'none', t:'Не начато' };
  if(step1done && sv > 0) return { k:'ok', t:'Готово' };
  return { k:'part', t:'В работе' };
}

function getUnitSortScore(x){
  var sv = x.surveys || 0;
  var step1done = x.total > 0 && x.done >= x.total && !(x.ask || 0);
  var isOk = step1done && sv > 0;
  if(isOk) return 3;       // Готово — опускаем вниз
  if(sv > 0) return 2;     // В работе (есть анкеты, но не всё проверено/завершено)
  if(x.done > 0) return 1; // Компании начаты/проверены, но анкеты ещё 0
  return 0;                // Не начато (0 компаний, 0 анкет) — самый верх
}

function renderUnitCards(list){
  if(!list.length) return '<div class="empty">Подразделения не найдены</div>';
  return list.map(function(x){
    if(x.__group) return renderGroupCard(x);
    return renderPlainUnitCard(x);
  }).join('');
}

function renderGroupCard(x){
  var sv = x.surveys || 0;
  var pu = (S.data.positionsByGroup && S.data.positionsByGroup[x.key])
    || (S.data.positionsByUnit && S.data.positionsByUnit[x.unit]) || [];
  var totalSlots = x.total * (pu.length || 0);
  var svPct = totalSlots > 0 ? Math.min(100, Math.round(sv / totalSlots * 100)) : (sv ? 100 : 0);
  var pct = x.total ? Math.round(x.done / x.total * 100) : 0;
  var askPct = x.total ? Math.round((x.ask || 0) / x.total * 100) : 0;
  var st = getUnitCardStatus(x);
  var names = x.members.map(function(m){ return shortMemberName(m.unit, x.key); });

  return '<div class="unit unit--group" data-u="'+esc(x.unit)+'">'+
    '<div class="u-body">'+
      '<div class="u-top">'+
        '<div class="u-name" title="'+esc(x.key)+'">'+esc(x.key)+'</div>'+
        '<span class="u-status is-'+st.k+'">'+st.t+'</span>'+
      '</div>'+
      '<div class="u-dir">'+esc(x.dir)+'</div>'+
      '<div class="u-grp-tag">'+ic('link', 12)+'Смежная группа · '+x.members.length+' '+
        declOfNum(x.members.length, ['площадка','площадки','площадок'])+
        ': '+esc(names.join(', '))+'</div>'+
      '<div class="u-bars">'+
        bar2('Участники рынка', x.done, x.total, pct, askPct) +
        bar2('Данные по рынку', sv, totalSlots > 0 ? totalSlots : null, svPct, 0) +
      '</div>'+
      '<div class="u-grp-hint">'+ic('info', 12)+'Заполняется один раз — данные сохранятся во все площадки группы.</div>'+
    '</div>'+
    '<div class="u-chev"><svg width="20" height="20" viewBox="0 0 24 24" fill="none">'+ICONS.chevron+'</svg></div>'+
  '</div>';
}

function renderPlainUnitCard(x){
    // Кольцо показывало один процент — проверку компаний (шаг 1), и на карточке
    // стояло «100%», хотя главного, данных по рынку (шаг 2), внесено не было.
    // Полос теперь две, по одной на шаг, и подписаны они цифрами, а не только
    // цветом: «14 из 14» и «0 записей» — разные состояния, и путать их нельзя.
    var pct = x.total ? Math.round(x.done/x.total*100) : 0;
    var askPct = x.total ? Math.round((x.ask||0)/x.total*100) : 0;
    var sv = x.surveys || 0;
    var pu = (S.data.positionsByUnit && S.data.positionsByUnit[x.unit]) || [];
    var totalSlots = x.total * (pu.length || 0);
    var svPct = totalSlots > 0 ? Math.min(100, Math.round(sv / totalSlots * 100)) : (sv ? 100 : 0);

    // Статус для мгновенной читаемости списка — не надо вчитываться в полосы.
    var st = getUnitCardStatus(x);

    return '<div class="unit" data-u="'+esc(x.unit)+'">'+
      '<div class="u-body">'+
        '<div class="u-top">'+
          '<div class="u-name" title="'+esc(x.unit)+'">'+esc(x.unit)+'</div>'+
          '<span class="u-status is-'+st.k+'">'+st.t+'</span>'+
        '</div>'+
        '<div class="u-dir">'+esc(x.dir)+'</div>'+
        '<div class="u-bars">'+
          bar2('Участники рынка', x.done, x.total, pct, askPct) +
          bar2('Данные по рынку', sv, totalSlots > 0 ? totalSlots : null, svPct, 0) +
        '</div>'+
        ((x.ask||0) ? '<div class="u-ask">'+ic('warn')+'требует уточнения: '+x.ask+'</div>' : '')+
      '</div>'+
      '<div class="u-chev"><svg width="20" height="20" viewBox="0 0 24 24" fill="none">'+ICONS.chevron+'</svg></div>'+
    '</div>';
}

/**
 * Одна полоса прогресса шага. total === null — считать нечего (у данных по
 * рынку нет знаменателя: сколько должностей «должно быть» заполнено, система
 * не знает), поэтому показываем количество записей, а не долю.
 */
function bar2(label, done, total, pct, askPct){
  var val = total == null
    ? done + ' ' + declOfNum(done, ['запись', 'записи', 'записей'])
    : done + ' из ' + total;
  var cls = pct >= 100 ? ' is-ok' : (pct > 0 ? ' is-part' : '');
  return '<div class="u-bar'+cls+'">'+
    '<div class="u-bar-t"><span>'+esc(label)+'</span><b>'+esc(val)+'</b></div>'+
    '<div class="u-bar-track">'+
      '<i style="width:'+Math.min(100, pct)+'%"></i>'+
      (askPct ? '<u style="width:'+Math.min(100 - pct, askPct)+'%"></u>' : '')+
    '</div></div>';
}

/**
 * Кольцо прогресса: зелёная дуга — проверено, жёлтая — «уточнить».
 * «Уточнить» намеренно не входит в процент: вопрос ещё не закрыт.
 */
function ring(pct, askPct){
  var r = 19, c = 2*Math.PI*r;
  var donePart = c * (pct/100);
  var askPart = c * ((askPct||0)/100);
  var col = pct>=100 ? 'var(--ok)' : (pct>0 ? 'var(--warn)' : 'var(--line)');
  var h = '<div class="ring"><svg width="46" height="46">'+
    '<circle cx="23" cy="23" r="'+r+'" fill="none" stroke="var(--line)" stroke-width="4"/>';
  if(askPart > 0){
    // жёлтую дугу рисуем сразу за зелёной
    h += '<circle cx="23" cy="23" r="'+r+'" fill="none" stroke="var(--warn)" stroke-width="4"'+
      ' stroke-dasharray="'+askPart.toFixed(1)+' '+(c-askPart).toFixed(1)+'"'+
      ' stroke-dashoffset="'+(-donePart).toFixed(1)+'"/>';
  }
  if(donePart > 0){
    h += '<circle cx="23" cy="23" r="'+r+'" fill="none" stroke="'+col+'" stroke-width="4"'+
      ' stroke-dasharray="'+donePart.toFixed(1)+' '+(c-donePart).toFixed(1)+'"'+
      ' stroke-dashoffset="0" stroke-linecap="round"/>';
  }
  return h + '</svg><b>'+pct+'%</b></div>';
}

function updateTopPeriodBadge(){
  var el = $('topPeriodBadge');
  if(!el) return;
  var p = (S.data && S.data.period) || {};
  var name = p.name || 'Обзор рынка — август 2026 г.';
  var closed = p.state === 'закрыт';
  el.innerHTML = '<span class="top-period-pill ' + (closed ? 'is-closed' : '') + '">' +
    '<i class="top-period-dot"></i>' +
    '<span>' + esc(name) + (p.to ? ' · до ' + esc(p.to) : '') + '</span>' +
    '</span>';
}

/**
 * Хлебные крошки для шапки (Фаза 1 редизайна). Строятся из состояния, без
 * изменения 13 вызовов setTop(). Возвращают путь [{label, go?}] — последний
 * элемент текущий (не ссылка), предыдущие ведут на родительский экран.
 */
function crumbTrail(title){
  if(S.unit){
    return [
      { label:'Подразделения', go:function(){ (S.backTo || renderUnits)(); } },
      { label: title || S.unit }
    ];
  }
  if(S.appView === 'admin'){
    return [ { label:'Администрирование' }, { label: title || 'Раздел' } ];
  }
  return [ { label: title } ];
}

/** Переход «назад»/по крошке с проверкой несохранённого черновика. */
function navBack(fn){
  var go = function(){ S.dirty = false; fn(); };
  if(!S.dirty){ go(); return; }
  askDirty('Выйти без сохранения').then(function(yes){ if(yes) go(); });
}

function setTop(title, sub, back, icon){
  var trail = crumbTrail(title);
  if(trail.length >= 2){
    $('ttl').innerHTML = trail.map(function(c, i){
      var sep = i ? '<span class="crumb-sep" aria-hidden="true">›</span>' : '';
      if(i === trail.length - 1) return sep + '<span class="crumb-cur">'+esc(c.label)+'</span>';
      if(!c.go) return sep + '<span class="crumb-root">'+esc(c.label)+'</span>';
      return sep + '<button type="button" class="crumb-link" data-crumb="'+i+'">'+esc(c.label)+'</button>';
    }).join('');
    $('ttl').classList.add('is-crumbs');
    $('btnBack').classList.add('hidden'); // крошки заменяют кнопку «Назад»
    $('ttl').onclick = function(e){
      var b = e.target.closest('button[data-crumb]');
      if(!b) return;
      var c = trail[+b.dataset.crumb];
      if(c && c.go) navBack(c.go);
    };
  } else {
    $('ttl').classList.remove('is-crumbs');
    $('ttl').onclick = null;
    $('ttl').innerHTML = (icon ? ic(icon, 15) : '') + esc(title) + (sub ? '<span class="sub"> · '+esc(sub)+'</span>' : '');
    $('btnBack').classList.toggle('hidden', !back);
  }
  if(window.WorkspaceTabs && WorkspaceTabs.updateActiveTitle){
    WorkspaceTabs.updateActiveTitle(title, icon);
  }
  // has-bar на <body> (не на #body) — CSS-правила отступа под липкую панель и
  // подъёма тостов написаны как `body.has-bar …`; раньше класс вешался на
  // #body, правила не срабатывали и панель наезжала на низ контента.
  document.body.classList.remove('has-bar');
  $('bar').classList.add('hidden');
  updateTopPeriodBadge();
  window.scrollTo(0,0);
}
$('btnBack').onclick = function(){
  navBack(S.backTo || renderUnits);
};

// ═══════════════════════════════════════════════════════════
// ЭКРАН: подразделение (две вкладки)
// ═══════════════════════════════════════════════════════════
/** Насколько заполнена запись анкеты — для выбора представителя при слиянии
 *  данных площадок смежной группы. */
function svFilledScore(r){
  var n = 0;
  ['payFrom','payTo','posTheir','grade','bonSize','extra','source','trust','note','schedule'].forEach(function(k){
    if(String(r[k] == null ? '' : r[k]).trim()) n++;
  });
  if(Array.isArray(r.benefits) && r.benefits.length) n++;
  if(r.bonHas === 'да') n++;
  return n;
}

/** Смежная группа, режим «заполнить раз»: сводим анкеты всех площадок группы
 *  к одному представителю на пару «должность × компания». Представитель —
 *  самая заполненная запись; при равенстве приоритет у текущего подразделения,
 *  затем у более свежей. Локально работаем как с записями текущего unit. */
function mergeGroupSurveys(rows, unit){
  var by = {};
  (rows || []).forEach(function(r){
    var k = norm(r.posOur) + '|' + norm(r.company);
    var cur = by[k];
    if(!cur){ by[k] = r; return; }
    var sc = svFilledScore(r), scCur = svFilledScore(cur);
    if(sc > scCur ||
       (sc === scCur && r.unit === unit && cur.unit !== unit) ||
       (sc === scCur && String(r.at || '') > String(cur.at || ''))){
      by[k] = r;
    }
  });
  return Object.keys(by).map(function(k){
    var x = JSON.parse(JSON.stringify(by[k]));
    x.unit = unit;
    return x;
  });
}

function openUnit(unit, backTo){
  if(window.WorkspaceTabs && WorkspaceTabs.openTab && !WorkspaceTabs.isInsideTabRun){
    WorkspaceTabs.openTab({
      key: 'unit:' + unit,
      title: unit,
      icon: 'units',
      state: { appView: 'unit', unit: unit },
      run: function(){ openUnit(unit, backTo); }
    });
    return;
  }
  S.backTo = backTo || renderUnits;
  S.appView = 'unit';
  S.unit = unit;
  S.tab = 'comp';
  S.editingPeriodId = null;
  saveNavState();
  S.rows = S.data.rows.filter(function(r){ return r.unit === unit; })
                      .map(function(r){ return JSON.parse(JSON.stringify(r)); });
  S.surveys = S.data.surveys.filter(function(r){ return r.unit === unit; })
                            .map(function(r){ return JSON.parse(JSON.stringify(r)); });
  // Смежная группа: Шаг 2 работает на всю группу — подставляем сведённые данные
  // всех её площадок (см. mergeGroupSurveys). Сохранение уходит с groupKey.
  var _grp = currentUnitGroup();
  if(_grp && S.data.surveysByGroup && S.data.surveysByGroup[_grp]){
    S.surveys = mergeGroupSurveys(S.data.surveysByGroup[_grp], unit);
  }
  var uObj = (S.data.units || []).filter(function(x){ return x.unit === unit; })[0];
  S.added = []; S.removed = []; S.note = (uObj && uObj.note) || ''; S.dirty = false;

  var d = null;
  if(!S.ro){
    try{ d = JSON.parse(store.get(LS_DRAFT+unit) || 'null'); }catch(e){ d = null; }
  }
  if(!d){ renderUnit(); return; }

  var draftDone = (d.rows||[]).filter(function(r){ return r.actual && r.actual !== 'не проверено'; }).length + (d.added||[]).length;
  var draftSurveys = (d.surveys||[]).length;
  var draftTime = d.savedAt ? fmtDateTime(d.savedAt) : '';

  ask({
    title: 'Продолжить с последнего места?',
    html: 'В подразделении <b>'+esc(unit)+'</b> сохранён локальный черновик'+(draftTime ? ' от ' + esc(draftTime) : '')+':<br><br>'+
          '• Проверено компаний: <b>'+draftDone+'</b><br>'+
          '• Заполнено по рынку: <b>'+draftSurveys+'</b> записей<br><br>'+
          'Хотите продолжить работу с сохранённого места?',
    ok: 'Продолжить работу',
    cancel: 'Начать заново'
  }).then(function(yes){
    if(yes){
      S.rows = d.rows || S.rows;
      S.added = d.added || [];
      S.surveys = d.surveys || S.surveys;
      S.removed = d.removed || [];
      S.note = d.note || '';
      S.dirty = true;
      S.tab = d.tab || 'comp';
    } else {
      store.del(LS_DRAFT+unit);
    }
    renderUnit();
  });
}

/** Сколько компаний проверено, сколько отложено на уточнение. */
function counts(){
  var all = S.rows.length + S.added.length;
  var done = 0, ask = 0;
  S.rows.forEach(function(r){
    if(r.actual === 'уточнить') ask++;
    else if(r.actual && r.actual !== 'не проверено') done++;
  });
  S.added.forEach(function(r){
    if(r.actual === 'уточнить') ask++;
    else if(r.actual && r.actual !== 'не проверено') done++;
  });
  return { all: all, done: done, ask: ask, left: all - done - ask };
}

function renderUnit(){
  setTop(S.unit, '', true);
  $('body').onclick = null;

  var c = counts();
  var step1done = c.all > 0 && c.done === c.all;

  var inArchiveMode = !!S.editingPeriodId;
  var h = '<div class="unit-content-wrap">'+
    '<div id="unitPeriodBanner"></div>'+
    '<div class="unit-sticky-bar">'+
      '<div class="sub-tabs unit-step-tabs">'+
        (inArchiveMode ? '' :
        '<button data-tab="comp" class="sub-tab '+(S.tab==='comp'?'on':'')+'">'+
          'Шаг 1. Участники рынка'+
          ' <span class="badge '+(step1done?'b-active':'b-dim')+'" style="margin-left:4px">'+c.done+'/'+c.all+'</span>'+
          (c.ask ? ' <span class="badge b-blocked" style="margin-left:4px;color:var(--warn);background:var(--warn-soft)">?'+c.ask+' на уточнении</span>' : '')+
        '</button>')+
        '<button data-tab="survey" class="sub-tab '+(S.tab==='survey'?'on':'')+'">'+
          (inArchiveMode ? 'Данные по рынку (архив)' : 'Шаг 2. Данные по рынку')+
          ' <span class="badge '+(S.surveys.length>0?'b-active':'b-dim')+'" style="margin-left:4px">'+svLabel()+'</span>'+
        '</button>'+
      '</div>'+
      '<div id="unitHeadToolbar" class="unit-head-toolbar"></div>'+
    '</div>'+
    '<div id="tabBody"></div>'+
  '</div>';
  $('body').innerHTML = h;
  renderUnitPeriodBanner();

  if(inArchiveMode) S.tab = 'survey';

  $('body').querySelector('.unit-step-tabs').onclick = function(e){
    var b = e.target.closest('button[data-tab]');
    if(!b || b.dataset.tab === S.tab) return;
    S.tab = b.dataset.tab;
    renderUnit();
  };

  if(S.tab === 'comp' && !inArchiveMode) renderTabComp();
  else renderTabSurvey();

  $('bar').classList.remove('hidden');
  document.body.classList.add('has-bar');
  updateProgress();
}

function renderUnitPeriodBanner(){
  var el = $('unitPeriodBanner');
  if(!el) return;
  var grants = (S.data.myPeriodGrants || []);
  if(!grants.length){ el.innerHTML = ''; return; }

  var curName = (S.data.period && S.data.period.name) || 'текущий';
  var options = [{ id:null, label: curName + ' (текущий)' }].concat(grants.map(function(g){
    return { id: g.periodId, label: g.periodName + ' (архив, ' + periodGrantTimeLeft(g.expiresAt) + ')' };
  }));

  el.innerHTML = '<div class="unit-period-banner" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">'+
    options.map(function(o){
      var on = (S.editingPeriodId || null) === o.id;
      return '<button type="button" class="sub-tab'+(on?' on':'')+'" data-pid="'+esc(o.id==null?'':String(o.id))+'">'+esc(o.label)+'</button>';
    }).join('')+
  '</div>';

  el.querySelectorAll('button[data-pid]').forEach(function(btn){
    btn.onclick = function(){
      var pid = btn.dataset.pid ? Number(btn.dataset.pid) : null;
      switchUnitEditingPeriod(pid);
    };
  });
}

function switchUnitEditingPeriod(periodId){
  if(periodId === (S.editingPeriodId || null)) return;

  function doSwitch(){
    if(periodId == null){
      S.editingPeriodId = null;
      S.surveys = S.data.surveys.filter(function(r){ return r.unit === S.unit; })
                                .map(function(r){ return JSON.parse(JSON.stringify(r)); });
      S.removed = [];
      S.dirty = false;
      $('btnSave').onclick = function(){ save(false); };
      renderUnit();
      return;
    }

    call('apiSurveysForPeriod', S.token, S.unit, periodId).then(function(res){
      if(!res || !res.ok){ toast((res&&res.error)||'Ошибка загрузки архивных данных', 'no'); return; }
      S.editingPeriodId = periodId;
      S.surveys = res.surveys || [];
      S.removed = [];
      S.dirty = false;
      $('btnSave').onclick = function(){ doSaveArchive(); };
      renderUnit();
    });
  }

  if(S.dirty){
    askDirty('Переключить период').then(function(yes){ if(yes) doSwitch(); });
  } else {
    doSwitch();
  }
}

function doSaveArchive(){
  if(S.saving) return;
  S.saving = true;
  $('btnSave').disabled = true;
  $('btnSave').textContent = 'Сохраняем…';

  call('apiSaveSurvey', S.token, { unit: S.unit, upsert: S.surveys, remove: S.removed, periodId: S.editingPeriodId }).then(function(res){
    S.saving = false;
    $('btnSave').disabled = false;
    $('btnSave').textContent = 'Сохранить';

    if(!res || !res.ok){
      toast((res && res.error) || 'Не удалось сохранить', 'no');
      return;
    }

    S.surveys.forEach(function(x, k){
      if(!x.id) x.id = (res.newIds && res.newIds[k]) || x.id;
    });
    S.removed = [];
    S.dirty = false;

    // Часть строк могла принадлежать другому ответственному (см. isOwnedByOther
    // на сервере) — остальное уже сохранилось (newIds выше это учли), но по
    // этим строкам локальное состояние теперь расходится с базой. Полноценный
    // ask()+doRefresh_() как в doSave() тут не подходит — doRefresh_() всегда
    // перечитывает ТЕКУЩИЙ период, а не конкретный архивный S.editingPeriodId —
    // поэтому просто предупреждаем тостом, не притворяясь, что сохранилось всё.
    if(res.blocked && res.blocked.length){
      toast('Не всё сохранено — часть строк уже занята другим: ' +
        res.blocked.map(function(x){ return x.company; }).join(', '), 'no');
    } else {
      toast('Архивные данные сохранены', 'ok');
    }
    renderTabSurvey();
  }).catch(function(){
    S.saving = false;
    $('btnSave').disabled = false;
    $('btnSave').textContent = 'Сохранить';
    toast('Нет связи с сервером', 'no');
  });
}

// ─────────── Вкладка 1: конкуренты ───────────
function renderTabComp(){
  var c = counts();
  var h = '';

  var isAllActual = S.rows.length > 0 && S.rows.every(function(r){ return r.actual === 'актуально'; });

  var tbHtml = '<div class="search-wrap" style="max-width:240px;width:100%;min-width:160px">'+icBare('search')+
      '<input id="compSearch" placeholder="Поиск компании в списке…" autocomplete="off"></div>'+
    '<span class="tbl-count" style="margin:0 2px;white-space:nowrap;font-size:13px">' + S.rows.length + ' ' + declOfNum(S.rows.length, ['компания','компании','компаний']) + '</span>'+
    (!S.ro && S.rows.length > 0 ? '<button type="button" class="btn-ghost toolbar-act" id="btnMarkAllActual" style="font-size:13px;padding:0 8px;min-height:30px;white-space:nowrap">' +
         (isAllActual ? ic('close', 13) + 'Снять отметку' : ic('check', 13) + 'Отметить все «Актуально»') + '</button>' : '');
  var tbSlot = $('unitHeadToolbar');
  if(tbSlot) tbSlot.innerHTML = tbHtml;

  // Отложенные на уточнение показываем отдельно — иначе они теряются в общем списке
  if(c.ask){
    h += '<div class="note" style="margin-bottom:10px">Требует уточнения: <b>'+c.ask+'</b>. '+
      'Эти компании не считаются проверенными — вернитесь к ним, когда выясните.</div>';
  }

  // Смежная группа
  var group = currentUnitGroup();
  if(group && S.data.companiesByGroup && S.data.companiesByGroup[group] && !S.ro){
    var known = {};
    S.rows.concat(S.added).forEach(function(r){ known[norm(r.company)] = true; });
    var groupSuggestions = S.data.companiesByGroup[group].filter(function(c){ return !known[norm(c)]; });
    if(groupSuggestions.length){
      h += '<div class="note" style="margin-bottom:10px">Есть на других площадках этой группы, но не добавлены здесь — добавить в один клик:</div>';
      h += '<div class="chips" style="margin:6px 0 12px">'+
        groupSuggestions.map(function(c){
          return '<button type="button" data-add-group-company="'+esc(c)+'">+ '+esc(c)+'</button>';
        }).join('')+
      '</div>';
    }
  }

  var isAllActual = S.rows.length > 0 && S.rows.every(function(r){ return r.actual === 'актуально'; });

  h += '<div class="card batch-card-wrap fill-card">';

  h += '<div class="batch-card-header fill-card-hd">';
  h += '<b>Компании подразделения</b>';
  h += '<span>Проверьте участников рынка (' + S.rows.length + ' ' + declOfNum(S.rows.length, ['компания','компании','компаний']) + ')</span>';
  h += '</div>';

  h += '<div class="co-list-scroll">';
  h += '<div id="rows" class="batch-list" style="margin:4px 0">';
  h += S.rows.map(function(r,i){ return rowCard(r, i, false); }).join('') ||
       '<div class="empty">Список пуст</div>';
  h += '</div>';

  if(S.added.length){
    h += '<div class="sec-title" style="margin:10px 0 4px">Добавленные компании</div><div id="adds" class="batch-list" style="margin:4px 0">';
    h += S.added.map(function(r,i){ return rowCard(r, i, true); }).join('');
    h += '</div>';
  } else { h += '<div id="adds" class="batch-list" style="margin:0"></div>'; }
  h += '</div>';

  if(!S.ro){
    h += '<button id="btnAdd" class="btn-line" style="margin-top:8px;min-height:34px;font-size:13.5px;border-style:dashed;width:100%">+ Добавить компанию</button>';
  }

  h += '<div style="margin-top:14px">';
  h += '<label class="fill-note-lbl">Комментарий по подразделению</label>';
  h += '<textarea id="unitNote" class="fill-note-ta" placeholder="Что важно знать о рынке труда вашего подразделения"'+
       (S.ro?' disabled':'')+'>'+esc(S.note)+'</textarea>';
  h += '</div>';

  // Кнопка «Перейти к шагу 2» живёт в нижней липкой панели (#bar) и управляется
  // в renderBar(). Раньше здесь была её копия с тем же id="btnNext" — дубль id,
  // не был подключён к обработчику и наезжал на липкую панель снизу.

  h += '</div>';

  $('tabBody').innerHTML = h;
  bindRows();
  $('unitNote').oninput = function(){ S.note = this.value; markDirty(); };
  if($('btnAdd')) $('btnAdd').onclick = openAddSheet;

  if($('btnMarkAllActual')){
    $('btnMarkAllActual').onclick = function(){
      var allCurrentlyActual = S.rows.length > 0 && S.rows.every(function(r){ return r.actual === 'актуально'; });
      if(allCurrentlyActual){
        S.rows.forEach(function(r){ r.actual = 'не проверено'; });
        markDirty();
        renderUnit();
        toast('Отметки со всех компаний сняты');
      } else {
        S.rows.forEach(function(r){ r.actual = 'актуально'; });
        markDirty();
        renderUnit();
        toast('Все компании (' + S.rows.length + ' шт.) отмечены как «Актуально»', 'ok');
      }
    };
  }

  $('tabBody').querySelectorAll('button[data-add-group-company]').forEach(function(btn){
    btn.onclick = function(){
      S.added.push({
        id:'', unit:S.unit, company:this.dataset.addGroupCompany, type:'', prio:'',
        seg:'', region:'', note:'', status:'', src:'', actual:'актуально'
      });
      markDirty();
      renderUnit();
      toast('Компания добавлена. Не забудьте сохранить.');
    };
  });

  if($('compSearch')){
    $('compSearch').oninput = function(){
      var q = norm(this.value);
      $('rows').querySelectorAll('.batch-card').forEach(function(node){
        var r = S.rows[+node.dataset.i] || {};
        var hit = !q || norm(r.company).indexOf(q) >= 0 ||
                  norm(r.seg).indexOf(q) >= 0 || norm(r.region).indexOf(q) >= 0;
        node.classList.toggle('hidden', !hit);
      });
    };
  }
}

/**
 * Строка занята другим ответственным (см. isOwnedByOther на сервере —
 * та же граница, здесь только для UI). Пока не защищено сервером — это
 * просто более честный интерфейс, реальная блокировка проверяется при
 * сохранении и в списке заблокированных из ответа save().
 */
function isLockedForMe(owner){
  if(!owner) return false;
  var role = S.data.user.role;
  if(role === 'admin' || role === 'cb') return false;
  var mine = String(S.data.user.fio || S.data.user.login || '').trim().toLowerCase();
  return String(owner).trim().toLowerCase() !== mine;
}

function rowCard(r, i, isNew){
  var st = r.actual === 'актуально' ? 'st-yes'
         : r.actual === 'не актуально' ? 'st-no'
         : r.actual === 'уточнить' ? 'st-ask' : '';
  var meta = [r.seg, r.region].filter(String).join(' · ');
  var name = r.company || '(название не заполнено в таблице)';
  var locked = isLockedForMe(r.by);
  var isDone = r.actual && r.actual !== 'не проверено';

  var h = '<div class="batch-card '+(isDone?'is-filled ':'')+st+(locked?' row-locked':'')+'" data-i="'+i+'">';
  h += '<div class="batch-card-inner">';
  
  h += '<div class="b-co-left">';
  h += '<div class="batch-co-title">' + ic('units', 13) + '<b>' + esc(name) + '</b>' + (isNew?' <span class="pill p-ok">новая</span>':'') + '</div>';
  if(meta) h += '<span class="b-co-meta">· ' + esc(meta) + '</span>';
  if(locked) h += '<span class="b-co-lock">' + ic('lock',11) + esc(r.by) + '</span>';
  if(r.note) h += '<span class="b-co-note" title="' + esc(r.note) + '">' + ic('pencil', 11) + esc(r.note) + '</span>';
  h += '<button type="button" class="btn-more-chip" data-act="more" title="Параметры">' + ic('wrench', 11) + '<span>Параметры</span><span class="b-arr">' + ic('chevron', 10) + '</span></button>';
  h += '</div>';

  h += '<div class="b-co-actions">';
  h += '<div class="seg">';
  h += [['актуально','Актуально'],['не актуально','Не актуально'],['уточнить','Уточнить']].map(function(pair){
    var v = pair[0], lbl = pair[1];
    return '<button data-act="actual" data-v="'+v+'"'+(r.actual===v?' class="on"':'')+
      ((S.ro||locked)?' disabled':'')+'>'+lbl+'</button>';
  }).join('') + '</div>';
  h += '</div>';

  h += '</div>';

  h += '<div class="more hidden batch-more-panel">';
  h += '<div style="font-size:12.5px;color:var(--muted);margin:4px 0 4px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em">Тип компании</div>';
  h += chips('type', S.data.ref.types, r.type, false);
  h += '<div style="font-size:12.5px;color:var(--muted);margin:8px 0 4px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em">Приоритет</div>';
  h += chips('prio', S.data.ref.priorities, r.prio, false);
  h += '<label class="lbl" style="margin-top:8px">Комментарий'+
       (r.actual === 'уточнить' ? ' — что именно уточнить' : '')+'</label>';
  h += '<textarea data-act="note" placeholder="'+
       (r.actual === 'уточнить' ? 'Что нужно выяснить и у кого' : 'Почему важен / что учесть')+
       '"'+((S.ro||locked)?' disabled':'')+'>'+esc(r.note||'')+'</textarea>';
  h += '</div></div>';
  return h;
}

function bindRows(){
  ['rows','adds'].forEach(function(zone){
    var box = $(zone);
    if(!box) return;
    box.addEventListener('click', function(e){
      var b = e.target.closest('button');
      if(!b) return;
      var card = b.closest('.batch-card');
      if(!card) return;
      var arr = zone === 'rows' ? S.rows : S.added;
      var r = arr[+card.dataset.i];
      var act = b.dataset.act;

      if(act === 'more'){
        var m = card.querySelector('.more');
        var closed = m.classList.toggle('hidden');
        b.classList.toggle('open', !closed);
        return;
      }
      if(S.ro || card.classList.contains('row-locked')) return;
      if(act === 'actual'){
        r.actual = (r.actual === b.dataset.v) ? 'не проверено' : b.dataset.v;
        card.className = 'batch-card ' + (r.actual && r.actual !== 'не проверено' ? 'is-filled ' : '') +
          (r.actual==='актуально'?'st-yes':r.actual==='не актуально'?'st-no':r.actual==='уточнить'?'st-ask':'');
        card.querySelectorAll('.seg button').forEach(function(x){
          x.classList.toggle('on', x.dataset.v === r.actual);
        });

        // Обновляем бейдж статуса в заголовке карточки
        var stTag = r.actual === 'актуально'
          ? '<span class="batch-st-tag ok">' + ic('check', 11) + 'Актуально</span>'
          : r.actual === 'не актуально'
            ? '<span class="batch-st-tag none" style="color:var(--no);background:var(--no-soft)">' + ic('close', 11) + 'Не актуально</span>'
            : r.actual === 'уточнить'
              ? '<span class="batch-st-tag none" style="color:var(--warn);background:var(--warn-soft)">' + ic('warn', 11) + 'Уточнить</span>'
              : '<span class="batch-st-tag none">' + ic('clock', 11) + 'Не проверено</span>';
        var hdTag = card.querySelector('.batch-st-tag');
        if(hdTag) hdTag.outerHTML = stTag;

        markDirty();
        updateProgress();
      }
    });

    box.addEventListener('input', function(e){
      if(e.target.dataset.act === 'note'){
        var card = e.target.closest('.batch-card');
        var arr = zone === 'rows' ? S.rows : S.added;
        arr[+card.dataset.i].note = e.target.value;
        markDirty();
      }
    });

    box.addEventListener('click', function(e){
      var chip = e.target.closest('.chips button');
      if(!chip) return;
      var card = chip.closest('.batch-card');
      var arr = zone === 'rows' ? S.rows : S.added;
      var r = arr[+card.dataset.i];
      var act = chip.dataset.act, v = chip.dataset.v;
      r[act] = (r[act] === v) ? '' : v;
      chip.parentNode.querySelectorAll('button').forEach(function(x){
        x.classList.toggle('on', x.dataset.v === r[act]);
      });
      markDirty();
    });
  });
}

// ─────────── Вкладка 2: данные по рынку ───────────
/**
 * Штатка подразделения и записи, разложенные по должностям.
 * Должности, которых нет в штатке, идут отдельной группой в конце —
 * их вносили вручную, и терять их нельзя.
 */
/** Смежная группа текущего подразделения (площадки с одинаковой структурой
 *  должностей, отличающиеся только регионом/точкой) — см. divisions.group_key. */
function currentUnitGroup(){
  var u = (S.data.units || []).filter(function(x){ return x.unit === S.unit; })[0];
  return u && u.group ? u.group : '';
}

function norm(s){ return String(s == null ? '' : s).toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim(); }

/** Льготы к списку: в базе они текстом, в форме — массивом. */
function benList(v){
  if(Array.isArray(v)) return v.filter(Boolean);
  return String(v == null ? '' : v).split(/[;,]/).map(function(s){ return s.trim(); }).filter(Boolean);
}

/**
 * Переменная часть к массиву [{type,size,per}]. Сервер отдаёт готовый
 * s.bonuses; у старых записей его нет — синтезируем один вид из плоских
 * s.bonType/bonSize/bonPer.
 */
function bonList2(s){
  var arr = s && s.bonuses;
  if(!Array.isArray(arr)) arr = [];
  arr = arr.filter(function(b){ return b && typeof b === 'object'; }).map(function(b){
    return { type: String(b.type || '').trim(), size: String(b.size == null ? '' : b.size).trim(), per: String(b.per || '').trim() };
  }).filter(function(b){ return b.type || b.size || b.per; });
  if(!arr.length){
    var t = String((s && s.bonType) || '').trim();
    var sz = String((s && s.bonSize) || '').trim();
    var p = String((s && s.bonPer) || '').trim();
    if(t || sz || p) arr = [{ type: t, size: sz, per: p }];
  }
  return arr;
}

function survGroups(){
  var group = currentUnitGroup();
  var штатка = group && S.data.positionsByGroup && S.data.positionsByGroup[group]
    ? S.data.positionsByGroup[group]
    : ((S.data.positionsByUnit && S.data.positionsByUnit[S.unit]) || []);
  var groups = [], byPos = {};

  штатка.forEach(function(p){
    var g = { pos: p, items: [], extra: false };
    byPos[norm(p)] = g;
    groups.push(g);
  });

  var tail = [];
  S.surveys.forEach(function(r, i){
    var g = byPos[norm(r.posOur)];
    if(g){ g.items.push(i); return; }
    var t = tail.filter(function(x){ return norm(x.pos) === norm(r.posOur); })[0];
    if(!t){ t = { pos: r.posOur || '(должность не указана)', items: [], extra: true }; tail.push(t); }
    t.items.push(i);
  });

  return { groups: groups.concat(tail), штатка: штатка };
}

function money(r){
  var num = function(x){
    if(!String(x == null ? '' : x).trim()) return '';
    var n = parseMoney(x);
    if(!n) return String(x).trim();
    return n.toLocaleString('ru-RU');
  };
  var f = num(r.payFrom), t = num(r.payTo);
  if(!f && !t) return '';
  var s = (f && t) ? (f + ' – ' + t) : (f || t);
  return s + (r.cur ? ' ' + r.cur : '') + (r.payPer ? ' ' + r.payPer : '');
}

/** Список актуальных компаний текущего подразделения (с шага 1).
 *  В смежной группе — общий список компаний всех площадок группы. */
function getUnitActualCompanies(){
  var grp = currentUnitGroup();
  if(grp && S.data.companiesByGroup && (S.data.companiesByGroup[grp] || []).length){
    return S.data.companiesByGroup[grp].slice();
  }
  var cos = [];
  var seen = {};
  // Компании с отметкой «актуально» или «уточнить»
  S.rows.concat(S.added).forEach(function(r){
    var c = (r.company || '').trim();
    if(!c) return;
    if(r.actual === 'актуально' || r.actual === 'уточнить'){
      if(!seen[norm(c)]){
        seen[norm(c)] = true;
        cos.push(c);
      }
    }
  });
  // Если отметки ещё не проставлены, берём все компании подразделения кроме «не актуально»
  if(!cos.length){
    S.rows.concat(S.added).forEach(function(r){
      var c = (r.company || '').trim();
      if(!c || r.actual === 'не актуально') return;
      if(!seen[norm(c)]){
        seen[norm(c)] = true;
        cos.push(c);
      }
    });
  }
  return cos;
}

/** Расчёт матрицы N x M: (Актуальные компании) x (Должности штатки) */
function svMatrixCounts(){
  var G = survGroups();
  var actualCos = getUnitActualCompanies();
  var totalPositions = G.groups.length;
  var totalCos = actualCos.length;
  var totalSlots = totalPositions * totalCos;

  var filledCount = 0;
  var posMap = {};
  G.groups.forEach(function(g){
    posMap[norm(g.pos)] = { total: totalCos, filled: 0, cosFilled: {} };
  });

  S.surveys.forEach(function(s){
    var posKey = norm(s.posOur);
    var coKey = norm(s.company);
    var isFilled = !!(s.payFrom || s.payTo || s.bonSize || (s.benefits && s.benefits.length) || s.extra || s.note);
    if(isFilled){
      if(posMap[posKey]){
        if(!posMap[posKey].cosFilled[coKey]){
          posMap[posKey].cosFilled[coKey] = true;
          posMap[posKey].filled++;
          filledCount++;
        }
      } else {
        filledCount++;
      }
    }
  });

  var pct = totalSlots > 0 ? Math.min(100, Math.round((filledCount / totalSlots) * 100)) : (filledCount > 0 ? 100 : 0);

  return {
    actualCos: actualCos,
    totalCos: totalCos,
    totalPositions: totalPositions,
    totalSlots: totalSlots,
    filledCount: filledCount,
    pct: pct,
    posMap: posMap
  };
}

/** Подпись на вкладке шага 2: матрица X из Y карточек */
function svLabel(){
  var mc = svMatrixCounts();
  if(mc.totalSlots > 0){
    return mc.filledCount + '/' + mc.totalSlots;
  }
  // Компаний ещё нет — показываем внесённые записи из числа должностей штатки.
  if(mc.totalPositions > 0){
    return S.surveys.length + '/' + mc.totalPositions;
  }
  return String(S.surveys.length);
}

function renderTabSurvey(){
  var G = survGroups();
  var mc = svMatrixCounts();
  var h = '';

  var tbSlot = $('unitHeadToolbar');
  if(tbSlot){
    if(mc.totalSlots > 0){
      tbSlot.innerHTML = '<div class="fill-toolbar-prog">'+
        '<span>Заполнено <b>' + mc.filledCount + '</b> из <b>' + mc.totalSlots + '</b> (' + mc.pct + '%)</span>'+
        '<div class="fill-progress fill-progress--sm'+(mc.pct>=100?' is-done':'')+'"><i style="width:' + mc.pct + '%"></i></div>'+
      '</div>';
    } else if(mc.totalPositions > 0){
      tbSlot.innerHTML = '<div class="fill-toolbar-prog"><span>В штатке подразделения <b>' +
        mc.totalPositions + '</b> ' + declOfNum(mc.totalPositions, ['должность', 'должности', 'должностей']) +
        '. Компании появятся после Шага 1.</span></div>';
    } else {
      tbSlot.innerHTML = '';
    }
  }

  if(!G.штатка.length && !S.surveys.length){
    h += '<div class="empty"><b>Здесь пока пусто</b><br><br>' +
         'Для этого подразделения штатка не заведена.<br>' +
         'Добавьте должность кнопкой ниже — она попадёт и в справочник.<br><br>' +
         'Вносите данные пакетом сразу по всем компаниям.</div>';
  } else {
    h += '<div class="fill-sec-hd">'+
      '<b>Данные по рынку</b>'+
      '<span>' + (mc.totalSlots > 0
        ? 'заполнено ' + mc.filledCount + ' из ' + mc.totalSlots + ' карточек (' + mc.pct + '%)'
        : S.surveys.length + ' ' + declOfNum(S.surveys.length, ['запись','записи','записей'])) + '</span>'+
    '</div>';

    if(mc.totalSlots > 0){
      h += '<div class="fill-progress'+(mc.pct>=100?' is-done':'')+'" style="margin:0 0 14px"><i style="width:' + mc.pct + '%"></i></div>';
    }

    if(currentUnitGroup()){
      h += '<p class="step-hint">'+ic('units', 13)+' Смежная группа «'+esc(currentUnitGroup())+'»: '+
           'заполняете один раз — при сохранении данные разложатся во все площадки группы '+
           '(они различаются только регионом).</p>';
    }

    h += '<div class="pos-grid fx-stagger">' + G.groups.map(function(g, gi){
      var pInfo = mc.posMap[norm(g.pos)];
      var filled = pInfo ? pInfo.filled : g.items.length;
      var total = pInfo ? pInfo.total : mc.totalCos;
      var isAll = total > 0 && filled >= total;
      var isPart = filled > 0 && !isAll;
      var bClass = isAll ? 'pos-badge-ok' : (isPart ? 'pos-badge-part' : 'pos-badge-none');
      var bText = total > 0 ? (filled + ' / ' + total + ' компаний') : (filled + ' записей');

      var cos = g.items.map(function(i){ return S.surveys[i].company; }).filter(String);
      var cls = 'pos' + (isAll ? ' pos-done' : '');

      var x = '<div class="'+cls+'">';
      x += '<div class="pos-head" data-open-pos="'+esc(g.pos)+'">';
      x += '<div class="pos-body"><div class="pos-name">'+esc(g.pos)+
           (g.extra ? ' <span class="pill p-mid">не в штатке</span>' : '')+'</div>';
      x += '<div class="pos-sub">'+ (cos.length
            ? esc(cos.slice(0,3).join(', ')) + (cos.length > 3 ? ' и ещё ' + (cos.length-3) : '')
            : 'данных пока нет') +'</div></div>';
      x += '<span class="pos-badge '+bClass+'">'+bText+'</span>';
      x += '<button type="button" class="btn-ghost pos-edit" data-open-pos="'+esc(g.pos)+'">'+
             ic('pencil', 14) + (filled ? 'Править' : 'Внести') + '</button>';
      x += '</div>';
      x += '</div>';
      return x;
    }).join('') + '</div>';
  }

  if(!S.ro){
    h += '<button id="btnAddSv" class="btn-line" style="margin-top:14px">'+
         '+ Должность, которой нет в списке</button>';
  }
  $('tabBody').innerHTML = h;

  $('tabBody').onclick = function(e){
    var trigger = e.target.closest('[data-open-pos]');
    if(trigger){
      openBatchSurveySheet(trigger.dataset.openPos);
      return;
    }
  };
  if($('btnAddSv')) $('btnAddSv').onclick = function(){ openCustomPositionSheet(); };
}

function openCustomPositionSheet(){
  openPicker({
    title: 'Добавить должность',
    list: function(){ return S.data.positions || []; },
    wide: function(){ return S.data.positionsAll || []; },
    wideLabel: 'Показать все должности холдинга',
    addUnit: S.unit,
    onPick: function(posName){
      if(!posName) return;
      openBatchSurveySheet(posName);
    }
  });
}

/**
 * Пакетный ввод по должности: открывает карточки сразу всех актуальных компаний
 * для выбранной должности, позволяя заполнить всё в один заход.
 */
function openBatchSurveySheet(posName){
  var actualCos = getUnitActualCompanies();
  // Добавляем также любые компании, которые уже были сохранены для этой должности
  S.surveys.forEach(function(s){
    if(norm(s.posOur) === norm(posName) && s.company){
      if(!actualCos.some(function(c){ return norm(c) === norm(s.company); })){
        actualCos.push(s.company);
      }
    }
  });

  if(!actualCos.length){
    toast('Сначала добавьте компании на Шаге 1');
    return;
  }

  var ref = S.data.ref || {};
  var currencies = ref.currencies || ['сомони', 'USD', 'RUB'];
  var payPeriods = ref.payPeriods || ['в месяц', 'в день', 'в час'];
  var bonusTypes = ref.bonusTypes || ['ежемесячный', 'квартальный', 'годовой', 'KPI'];
  var bonusPeriods = ref.bonusPeriods || ['в месяц', 'в квартал', 'в год'];
  var scheduleList = ref.schedules || ['5/2 · 40 часов', '5/2 · 45 часов', '6/1 · 48 часов', '6/1 · 50 часов', '6/1 · 54 часа', 'Сменный 2/2', 'Вахтовый', 'Свободный / гибкий'];
  var sources = ref.sources || ['собеседования', 'бывшие сотрудники', 'сайты вакансий', 'знакомые'];
  var trustList = ref.trust || ['высокая', 'средняя', 'низкая'];
  // Льготы приходят с сервера сгруппированными по разделам:
  // [{category, items:[...]}]. benefitGroups — для рендера чипов с заголовками,
  // benefitsList — плоский список всех значений (нужен STD_BENEFITS и проверкам).
  // Терпим и старый плоский формат на случай устаревшего кэша payload.
  var benefitGroups = Array.isArray(S.data.benefits) && S.data.benefits.length && S.data.benefits[0] && S.data.benefits[0].items
    ? S.data.benefits
    : [{ category: '', items: (S.data.benefits || ['ДМС', 'Питание', 'Связь', 'ГСМ', 'Транспорт']) }];
  var benefitsList = benefitGroups.reduce(function(acc, g){ return acc.concat(g.items || []); }, []);

  // Доводка автозаполнения:
  // — валюта/период новой строки берутся не жёстко «сомони / в месяц», а из
  //   последнего заполнения в этой сессии (S.fillPrefs) или из последней
  //   сохранённой записи; человек в одном подразделении обычно вводит всё в
  //   одной валюте.
  S.fillPrefs = S.fillPrefs || {};
  var lastSv = S.surveys.slice().reverse().find(function(s){ return s && (s.cur || s.payPer); });
  var defCur = S.fillPrefs.cur || (lastSv && lastSv.cur) || 'сомони';
  var defPer = S.fillPrefs.payPer || (lastSv && lastSv.payPer) || 'в месяц';
  // — «Стандартный набор» льгот: чаще всего встречающиеся позиции соцпакета,
  //   отмечаются одной кнопкой. Берём только те, что реально есть в справочнике.
  var STD_BENEFITS = [
    'Медицинское страхование (ДМС)', 'Оплата питания / Обеды',
    'Корпоративная мобильная связь', 'Обучение и тренинги за счет компании',
    'Корпоративный транспорт / развозка'
  ].filter(function(b){ return benefitsList.indexOf(b) >= 0; });

  // Закреплённые сверху в выпадающем списке льгот — стандартный набор без ДМС
  // (ДМС просили не выносить в топ, он остаётся среди обычных пунктов справочника).
  var STD_PINNED = STD_BENEFITS.filter(function(b){ return !/дмс/i.test(b) && !/мед\w*\s+страхован/i.test(b); });

  // Формируем состояние записей по каждой компании
  var entries = actualCos.map(function(co){
    var exist = S.surveys.find(function(s){
      return norm(s.posOur) === norm(posName) && norm(s.company) === norm(co);
    });
    return {
      co: co,
      id: exist ? exist.id : '',
      exist: !!exist,
      payFrom: exist && exist.payFrom ? String(exist.payFrom) : '',
      payTo: exist && exist.payTo ? String(exist.payTo) : '',
      cur: exist ? (exist.cur || defCur) : defCur,
      payPer: exist ? (exist.payPer || defPer) : defPer,
      posTheir: exist ? (exist.posTheir || '') : '',
      grade: exist ? (exist.grade || '') : '',
      schedule: exist ? (exist.schedule || '') : '',
      bonHas: exist ? (exist.bonHas || '') : '',
      // Переменная часть — массив видов [{type,size,per}]. Сервер шлёт exist.bonuses;
      // у старых записей он пуст — синтезируем из плоских bon* полей.
      bonuses: exist ? bonList2(exist) : [],
      bonSize: exist ? (exist.bonSize || '') : '',
      bonType: exist ? (exist.bonType || '') : '',
      bonPer: exist ? (exist.bonPer || '') : '',
      benefits: exist ? benList(exist.benefits) : [],
      extra: exist ? (exist.extra || '') : '',
      source: exist ? (exist.source || '') : '',
      trust: exist ? (exist.trust || '') : '',
      note: exist ? (exist.note || '') : ''
    };
  });

  var el = document.createElement('div');
  el.className = 'sheet';

  function getSurveyItemCompleteness(item){
    var points = 0;
    var totalPoints = 11;

    // 1. Оклад от
    if(item.payFrom && String(item.payFrom).trim()) points++;
    // 2. Оклад до
    if(item.payTo && String(item.payTo).trim()) points++;
    // 3. Должность у них
    if(item.posTheir && String(item.posTheir).trim()) points++;
    // 4. Грейд / Уровень
    if(item.grade && String(item.grade).trim()) points++;
    // 5. Наличие бонусов
    if(item.bonHas && String(item.bonHas).trim()) points++;
    // 6. Размер/параметры бонуса (или если бонусов нет)
    var bonAnyData = Array.isArray(item.bonuses) && item.bonuses.some(function(b){
      return b && (String(b.size == null ? '' : b.size).trim() || b.type);
    });
    if(item.bonHas === 'нет' || (item.bonHas === 'да' && bonAnyData)) points++;
    // 7. Льготы и соцпакет
    if(item.benefits && item.benefits.length > 0) points++;
    // 8. Прочие выплаты
    if(item.extra && String(item.extra).trim()) points++;
    // 9. Откуда данные
    if(item.source && String(item.source).trim()) points++;
    // 10. Надёжность данных
    if(item.trust && String(item.trust).trim()) points++;
    // 11. Комментарий
    if(item.note && String(item.note).trim()) points++;

    if(points === 0) return { pct: 0, status: 'none', label: 'Не заполнено' };
    var pct = Math.round((points / totalPoints) * 100);
    if(pct >= 100){
      return { pct: 100, status: 'ok', label: 'Заполнено 100%' };
    } else {
      return { pct: pct, status: 'part', label: 'Частично (' + pct + '%)' };
    }
  }

  function renderSurveyStTag(comp){
    if(comp.status === 'ok'){
      return '<span class="batch-st-tag ok">' + ic('check', 12) + 'Заполнено 100%</span>';
    } else if(comp.status === 'part'){
      return '<span class="batch-st-tag part">' + ic('clock', 12) + 'Частично (' + comp.pct + '%)</span>';
    } else {
      return '<span class="batch-st-tag none">' + ic('clock', 12) + 'Не заполнено</span>';
    }
  }

  function updateCardCompleteness(card, item){
    var comp = getSurveyItemCompleteness(item);
    var pFrom = parseMoney(item.payFrom);
    var pTo = parseMoney(item.payTo);
    var isForkInverted = (pFrom > 0 && pTo > 0 && pFrom > pTo);

    var hd = card.querySelector('.batch-hd');
    if(hd){
      var oldTag = hd.querySelector('.batch-st-tag');
      if(oldTag) oldTag.remove();
      var temp = document.createElement('div');
      if(isForkInverted){
        temp.innerHTML = '<span class="batch-st-tag err">' + ic('warn', 12) + 'От > До!</span>';
      } else {
        temp.innerHTML = renderSurveyStTag(comp);
      }
      hd.appendChild(temp.firstChild);
    }
    card.classList.toggle('is-filled', comp.status === 'ok' && !isForkInverted);
    card.classList.toggle('is-part', comp.status === 'part' || isForkInverted);
  }

  // Один вид переменной части: размер + вид + периодичность. Строк может быть
  // несколько (item.bonuses). Пустой массив = одна строка-заготовка.
  // Объявлено на уровне openBatchSurveySheet — зовётся и из morePanelHtml,
  // и из обработчика кликов (добавить/убрать вид).
  function bonRowsHtml(item){
    var rows = (Array.isArray(item.bonuses) && item.bonuses.length) ? item.bonuses : [{ type:'', size:'', per:'' }];
    var multi = rows.length > 1;
    return rows.map(function(b, bi){
      return '<div class="b-bon-row" data-bi="'+bi+'">'+
        (multi
          ? '<div class="b-bon-row-hd"><span>Вид '+(bi+1)+'</span>'+
            '<button type="button" class="b-bon-rm" data-act="bon-rm" data-bi="'+bi+'">'+ic('x',11)+' убрать</button></div>'
          : '')+
        '<label class="lbl">Размер</label>'+
        '<input class="b-bon-size" data-bi="'+bi+'" inputmode="decimal" placeholder="Например: 20 или 3000" value="'+esc(b.size || '')+'">'+
        '<label class="lbl" style="margin-top:8px">Вид переменной части</label>'+
        '<div class="chips" data-chips="bonType" data-bi="'+bi+'">'+bonusTypes.map(function(v){
          return '<button type="button" data-act="bonRowType" data-bi="'+bi+'" data-v="'+esc(v)+'"'+(b.type===v?' class="on"':'')+'>'+esc(v)+'</button>';
        }).join('')+'</div>'+
        '<div class="sub-step">'+
          '<label class="lbl" style="margin:0 0 6px">Периодичность получения</label>'+
          '<div class="chips" data-chips="bonPer" data-bi="'+bi+'">'+bonusPeriods.map(function(v){
            return '<button type="button" data-act="bonRowPer" data-bi="'+bi+'" data-v="'+esc(v)+'"'+(b.per===v?' class="on"':'')+'>'+esc(v)+'</button>';
          }).join('')+'</div>'+
        '</div>'+
      '</div>';
    }).join('');
  }

  function renderSheetContent(){
    // turn-7b: на десктопе весь ввод по должности — плоская редактируемая
    // таблица (оклад правится прямо в ячейке), детальные поля (должность у них,
    // бонусы, льготы, источник, комментарий) остаются на «Параметры» под строкой.
    // На телефоне — прежние аккордеон-карточки (turn-7a).
    // Ширину берём по факту окна: класс .compact на <html> в обычном браузере
    // висит всегда (грузится Telegram SDK), поэтому по нему десктоп не отличить.
    var wide = window.innerWidth >= 980;

    function morePanelHtml(item){
      return '<div class="batch-more-panel hidden">'+
        '<label class="lbl">Как эта должность называется у них</label>'+
        '<div class="pick b-pick-their"><span class="'+(item.posTheir?'':'ph')+'">'+esc(item.posTheir || 'Выберите или добавьте')+'</span><i>' + ic('chevron', 12) + '</i></div>'+

        '<label class="lbl">Грейд / Уровень</label>'+
        '<input class="b-grade" placeholder="например: Middle, 1-й разряд" value="'+esc(item.grade)+'">'+

        '<label class="lbl">График работы</label>'+
        chips('schedule', scheduleList, item.schedule, false)+

        '<label class="lbl">Бонусы и премии</label>'+
        chips('bonHas', ['да','нет','не знаю'], item.bonHas, false)+
        '<div class="b-bon-box '+(item.bonHas==='да'?'':'hidden')+'" style="margin-top:8px">'+
          '<div class="b-bon-list">'+bonRowsHtml(item)+'</div>'+
          '<button type="button" class="btn-line b-bon-add" data-act="bon-add">'+ic('plus',12)+' Добавить вид</button>'+
        '</div>'+

        '<label class="lbl" style="margin-top:10px">Льготы и соцпакет</label>'+
        (STD_PINNED.length
          ? '<button type="button" class="bx-std-benefits" data-act="std-benefits">'+ic('bolt',12)+'Отметить частые</button>'
          : '')+
        benefitDropdown(item.benefits, benefitGroups, STD_PINNED)+

        '<label class="lbl" style="margin-top:10px">Прочие выплаты</label>'+
        '<input class="b-extra" placeholder="13-я зарплата, надбавки…" value="'+esc(item.extra)+'">'+

        '<div class="two" style="margin-top:10px">'+
          '<div><label class="lbl">Откуда данные</label>'+chips('source', sources, item.source, false)+'</div>'+
          '<div><label class="lbl">Надёжность</label>'+chips('trust', trustList, item.trust, false)+'</div>'+
        '</div>'+

        '<label class="lbl" style="margin-top:10px">Комментарий</label>'+
        '<textarea class="b-note" placeholder="Что важно знать об условиях">'+esc(item.note)+'</textarea>'+
      '</div>';
    }

    var curOpts = function(sel){ return currencies.map(function(c){ return '<option value="'+esc(c)+'"'+(sel===c?' selected':'')+'>'+esc(c)+'</option>'; }).join(''); };
    var perOpts = function(sel){ return payPeriods.map(function(p){ return '<option value="'+esc(p)+'"'+(sel===p?' selected':'')+'>'+esc(p)+'</option>'; }).join(''); };

    var cardsHtml = entries.map(function(item, idx){
      var comp = getSurveyItemCompleteness(item);
      var stTag = renderSurveyStTag(comp);
      var cls = comp.status === 'ok' ? 'is-filled' : (comp.status === 'part' ? 'is-part' : '');

      if(wide){
        return '<div class="batch-card '+cls+'" data-idx="'+idx+'">'+
          '<div class="bx-row">'+
            '<div class="bx-co">' + ic('units', 14) + '<span>' + esc(item.co) + '</span></div>'+
            '<div class="bx-cell"><input class="b-pay-from" inputmode="decimal" placeholder="от" value="'+esc(item.payFrom)+'"></div>'+
            '<div class="bx-cell"><input class="b-pay-to" inputmode="decimal" placeholder="до" value="'+esc(item.payTo)+'"></div>'+
            '<div class="bx-cell"><select class="b-cur">'+curOpts(item.cur)+'</select></div>'+
            '<div class="bx-cell"><select class="b-pay-per">'+perOpts(item.payPer)+'</select></div>'+
            '<button type="button" class="batch-toggle-more bx-more" data-act="toggle-more">Параметры <span class="b-arr">' + ic('chevron', 12) + '</span></button>'+
            '<div class="batch-hd bx-st">'+stTag+'</div>'+
          '</div>'+
          morePanelHtml(item)+
        '</div>';
      }

      return '<div class="batch-card '+cls+'" data-idx="'+idx+'">'+
        '<div class="batch-hd">'+
          '<div class="batch-co-title">' + ic('units', 14) + '<span>' + esc(item.co) + '</span></div>'+
          stTag+
        '</div>'+
        '<div class="batch-row-main">'+
          '<div>'+
            '<label class="lbl">Оклад ('+esc(item.cur)+')</label>'+
            '<div class="two">'+
              '<div><input class="b-pay-from" inputmode="decimal" placeholder="от" value="'+esc(item.payFrom)+'"></div>'+
              '<div><input class="b-pay-to" inputmode="decimal" placeholder="до" value="'+esc(item.payTo)+'"></div>'+
            '</div>'+
          '</div>'+
          '<div>'+
            '<label class="lbl">Валюта и период</label>'+
            '<div class="two">'+
              '<div><select class="b-cur">'+curOpts(item.cur)+'</select></div>'+
              '<div><select class="b-pay-per">'+perOpts(item.payPer)+'</select></div>'+
            '</div>'+
          '</div>'+
        '</div>'+

        '<button type="button" class="batch-toggle-more" data-act="toggle-more">'+
          '<span>' + ic('wrench', 13) + 'Параметры (должность у них, бонусы, льготы, источник)</span>'+
          '<span class="b-arr">' + ic('chevron', 12) + '</span>'+
        '</button>'+

        morePanelHtml(item)+
      '</div>';
    }).join('');

    el.innerHTML = '<div class="sheet-in batch-sheet'+(wide ? ' batch-sheet--wide' : '')+'">'+
      '<div class="sheet-hd">'+
        '<div>'+
          '<b>Должность: '+esc(posName)+'</b>'+
          '<div style="font-size:13px;color:var(--muted);margin-top:2px">Пакетный ввод данных по '+actualCos.length+' '+declOfNum(actualCos.length, ['компании','компаниям','компаниям'])+'</div>'+
        '</div>'+
        '<button class="btn-ghost" data-x="1">Закрыть</button>'+
      '</div>'+

      '<div class="batch-list'+(wide ? ' batch-list--grid' : '')+'">'+
        (wide ? '<div class="bx-head">'+
          '<span>Компания</span><span>Оклад от*</span><span>Оклад до*</span>'+
          '<span>Валюта</span><span>Период</span><span></span><span>Статус</span>'+
        '</div>' : '')+
        cardsHtml+
      '</div>'+

      // Липкий низ: кнопка сохранения всегда на виду, а над ней — подсказка
      // «ниже ещё N», когда список компаний не помещается на экран (важнее
      // всего в альбомной ориентации, где высота маленькая).
      '<div class="batch-foot">'+
        '<button type="button" class="batch-foot-cue" data-act="scroll-more" hidden>'+ic('chevron', 13)+'<span></span></button>'+
        '<button id="batchSaveBtn" class="btn-primary">' + ic('check', 15) + 'Сохранить данные по должности ('+actualCos.length+')</button>'+
      '</div>'+
    '</div>';
  }

  renderSheetContent();
  document.body.appendChild(el);

  // Перерисовать выпадающий список льгот в карточке из текущего item.benefits
  // (после «Отметить частые» и добавления своей льготы). keepOpen — оставить
  // панель раскрытой, т.к. человек продолжает выбирать.
  function refreshBenefitDropdown(card, item, keepOpen){
    var wrap = card && card.querySelector('.bx-bd');
    if(!wrap) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = benefitDropdown(item.benefits, benefitGroups, STD_PINNED);
    var fresh = tmp.firstChild;
    if(keepOpen){
      fresh.classList.add('open');
      var p = fresh.querySelector('.bx-bd-panel');
      if(p) p.classList.remove('hidden');
    }
    wrap.parentNode.replaceChild(fresh, wrap);
  }

  // ── Подсказка «ниже ещё компании» ───────────────────────────────────────
  // Показываем, только когда список реально не помещается и мы не у конца.
  // Текст — сколько карточек компаний ещё под сгибом.
  function updateScrollCue(){
    if(!el.isConnected){
      window.removeEventListener('resize', updateScrollCue);
      window.removeEventListener('orientationchange', updateScrollCue);
      return;
    }
    var sc = el.querySelector('.sheet-in');
    var cue = el.querySelector('.batch-foot-cue');
    if(!sc || !cue) return;
    var foot = el.querySelector('.batch-foot');
    var footTop = foot ? foot.offsetTop : sc.scrollHeight;
    var viewBottom = sc.scrollTop + sc.clientHeight;
    var remain = footTop - viewBottom;
    if(remain <= 24){ cue.hidden = true; return; }
    var cards = el.querySelectorAll('.batch-card');
    var below = 0;
    for(var i = 0; i < cards.length; i++){
      if(cards[i].offsetTop + cards[i].offsetHeight - 8 > viewBottom) below++;
    }
    cue.querySelector('span').textContent = below
      ? 'ниже ещё ' + below + ' ' + declOfNum(below, ['компания', 'компании', 'компаний'])
      : 'прокрутите вниз';
    cue.hidden = false;
  }
  var _cueSheet = el.querySelector('.sheet-in');
  if(_cueSheet) _cueSheet.addEventListener('scroll', updateScrollCue, { passive: true });
  window.addEventListener('resize', updateScrollCue);
  window.addEventListener('orientationchange', updateScrollCue);
  el.addEventListener('_recue', updateScrollCue);
  setTimeout(updateScrollCue, 60);

  var initialSnapshot = JSON.stringify(entries);
  function isSheetDirty(){
    return JSON.stringify(entries) !== initialSnapshot;
  }

  function saveBatchSurvey(){
    try {
      // Валидация диапазонов окладов перед сохранением
      for(var i = 0; i < entries.length; i++){
        var it = entries[i];
        var pF = parseMoney(it.payFrom);
        var pT = parseMoney(it.payTo);
        if(pF > 0 && pT > 0 && pF > pT){
          toast('В компании "' + it.co + '" оклад "от" (' + pF.toLocaleString('ru-RU') + ') превышает оклад "до" (' + pT.toLocaleString('ru-RU') + ')', 'warn');
          return false;
        }
      }

      // Обязательные поля: у каждой НАЧАТОЙ строки компании должны быть заполнены
      // график, наличие бонусов, источник данных и надёжность — ключевые атрибуты
      // для сравнения, без них запись почти бесполезна. Пустые строки (компанию
      // не трогали) пропускаем.
      var REQUIRED_DETAIL = [
        { key: 'schedule', label: 'График работы',   chips: 'schedule' },
        { key: 'bonHas',   label: 'Бонусы и премии',  chips: 'bonHas' },
        { key: 'source',   label: 'Откуда данные',    chips: 'source' },
        { key: 'trust',    label: 'Надёжность',       chips: 'trust' }
      ];
      [].forEach.call(el.querySelectorAll('.batch-card--needs'), function(c){ c.classList.remove('batch-card--needs'); });
      [].forEach.call(el.querySelectorAll('.chips--invalid'), function(c){ c.classList.remove('chips--invalid'); });
      var reqErrors = [];
      entries.forEach(function(item, ri){
        var started = !!(
          String(item.payFrom || '').trim() || String(item.payTo || '').trim() ||
          String(item.posTheir || '').trim() || String(item.grade || '').trim() ||
          String(item.extra || '').trim() || String(item.note || '').trim() ||
          (Array.isArray(item.benefits) && item.benefits.length) ||
          (Array.isArray(item.bonuses) && item.bonuses.some(function(b){ return b && (b.type || String(b.size == null ? '' : b.size).trim() || b.per); })) ||
          String(item.schedule || '').trim() || String(item.bonHas || '').trim() ||
          String(item.source || '').trim() || String(item.trust || '').trim()
        );
        if(!started) return;
        var miss = REQUIRED_DETAIL.filter(function(f){ return !String(item[f.key] == null ? '' : item[f.key]).trim(); });
        if(!miss.length) return;
        reqErrors.push({ co: item.co, miss: miss });
        var card = el.querySelector('.batch-card[data-idx="' + ri + '"]');
        if(card){
          card.classList.add('batch-card--needs');
          var panel = card.querySelector('.batch-more-panel');
          if(panel && panel.classList.contains('hidden')){
            panel.classList.remove('hidden');
            var mb = card.querySelector('[data-act="toggle-more"]');
            if(mb) mb.classList.add('open');
          }
          miss.forEach(function(f){
            var box = card.querySelector('.chips[data-chips="' + f.chips + '"]');
            if(box) box.classList.add('chips--invalid');
          });
        }
      });
      if(reqErrors.length){
        var first = reqErrors[0];
        toast(
          reqErrors.length === 1
            ? 'Заполните обязательные поля в «' + first.co + '»: ' + first.miss.map(function(f){ return f.label; }).join(', ')
            : 'Не хватает обязательных полей (график, бонусы, источник, надёжность) в ' + reqErrors.length + ' ' + declOfNum(reqErrors.length, ['компании', 'компаниях', 'компаниях']),
          'warn'
        );
        var firstCard = el.querySelector('.batch-card--needs');
        if(firstCard && firstCard.scrollIntoView) firstCard.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return false;
      }

      entries.forEach(function(item){
        var pFromStr = String(item.payFrom == null ? '' : item.payFrom).trim();
        var pToStr = String(item.payTo == null ? '' : item.payTo).trim();
        // Переменная часть: чистим строки массива, пустые отбрасываем.
        var bonusesClean = (item.bonHas === 'да' && Array.isArray(item.bonuses))
          ? item.bonuses.map(function(b){
              return {
                type: String((b && b.type) || '').trim(),
                size: String((b && b.size) == null ? '' : (b && b.size)).trim(),
                per: String((b && b.per) || '').trim()
              };
            }).filter(function(b){ return b.type || b.size || b.per; })
          : [];
        var noteStr = String(item.note == null ? '' : item.note).trim();
        var extraStr = String(item.extra == null ? '' : item.extra).trim();
        var posTheirStr = String(item.posTheir == null ? '' : item.posTheir).trim();
        var gradeStr = String(item.grade == null ? '' : item.grade).trim();
        var scheduleStr = String(item.schedule == null ? '' : item.schedule).trim();
        var benArr = Array.isArray(item.benefits) ? item.benefits : [];

        var isFilled = !!(pFromStr || pToStr || bonusesClean.length || benArr.length || noteStr || extraStr || posTheirStr || gradeStr || (item.bonHas && item.bonHas === 'да'));

        var existIndex = S.surveys.findIndex(function(s){
          return norm(s.posOur) === norm(posName) && norm(s.company) === norm(item.co);
        });

        if(isFilled){
          var record = {
            id: item.id || uid(),
            unit: S.unit,
            company: item.co,
            posOur: posName,
            posTheir: posTheirStr,
            grade: gradeStr,
            schedule: scheduleStr,
            // Нормализуем к чистому числу-строке ("10000"): сервер и дашборд
            // читают это через Number(), а "10 000"/"10,000" туда не годятся.
            payFrom: pFromStr ? String(parseMoney(pFromStr)) : '',
            payTo: pToStr ? String(parseMoney(pToStr)) : '',
            cur: item.cur || 'сомони',
            payPer: item.payPer || 'в месяц',
            bonHas: item.bonHas || '',
            bonuses: bonusesClean,
            // bon* держат первый вид — их читают локальный ре-рендер и старые места
            bonSize: bonusesClean[0] ? bonusesClean[0].size : '',
            bonType: bonusesClean[0] ? bonusesClean[0].type : '',
            bonPer: bonusesClean[0] ? bonusesClean[0].per : '',
            benefits: benArr,
            extra: extraStr,
            source: item.source || '',
            trust: item.trust || '',
            note: noteStr
          };

          if(existIndex >= 0){
            S.surveys[existIndex] = record;
          } else {
            S.surveys.push(record);
          }
        } else if(existIndex >= 0){
          // Если запись была, но пользователь всё стёр.
          var removedRec = S.surveys[existIndex];
          if(currentUnitGroup()){
            // В группе удаляем по паре «должность × компания» во всех площадках.
            S.removed.push({ posOur: posName, company: item.co });
          } else if(removedRec.id && removedRec.id.indexOf('tmp') !== 0){
            S.removed.push(removedRec.id);
          }
          S.surveys.splice(existIndex, 1);
        }
      });

      el.remove();
      markDirty();
      renderUnit();
      // Итог покажет save() ('Сохранено в …' / 'Нет связи…') — оба вызывающих
      // #batchSaveBtn и #cmSave дожимают на сервер сразу после.
      return true;
    } catch(err) {
      console.error('saveBatchSurvey error:', err);
      toast('Ошибка обработки формы: ' + (err.message || err), 'no');
      return false;
    }
  }

  function requestCloseSheet(){
    if(!isSheetDirty()){
      el.remove();
      return;
    }
    var cm = document.createElement('div');
    cm.className = 'sheet sheet--dialog';
    cm.style.zIndex = '120'; // поверх шита (60) и ⌘K (80)
    cm.innerHTML = '<div class="sheet-in dlg">' +
      '<b class="dlg-t dlg-t--warn">' + ic('warn', 18) + 'Несохранённые изменения</b>' +
      '<p class="dlg-x">' +
        'Вы изменили данные по должности <b>«' + esc(posName) + '»</b>. Сохранить их перед выходом?' +
      '</p>' +
      '<div class="dlg-a dlg-a--stack">' +
        '<button class="btn-primary" id="cmSave">' + ic('check', 14) + 'Сохранить и выйти</button>' +
        '<button class="btn-danger" id="cmDiscard">' + ic('trash', 14) + 'Закрыть без сохранения</button>' +
        '<button id="cmStay">' + ic('close', 14) + 'Остаться в карточке</button>' +
      '</div>' +
    '</div>';
    document.body.appendChild(cm);

    cm.querySelector('#cmSave').onclick = function(){
      // Сводим карточку в состояние и сразу дожимаем на сервер — иначе «Сохранить
      // и выйти» лишь клало в черновик, а на сервер уходило только по нижней
      // кнопке (люди на этом спотыкались).
      if(saveBatchSurvey()){ cm.remove(); save(false); }
    };
    cm.querySelector('#cmDiscard').onclick = function(){
      cm.remove();
      el.remove();
    };
    cm.querySelector('#cmStay').onclick = function(){
      cm.remove();
    };
    cm.onclick = function(e){
      if(e.target === cm) cm.remove();
    };
  }

  // Обработчик событий внутри пакетной формы
  el.addEventListener('click', function(e){
    if(e.target === el || e.target.dataset.x){
      requestCloseSheet();
      return;
    }

    // Подсказка «ниже ещё компании» — прокручиваем список почти на экран вниз
    if(e.target.closest('[data-act="scroll-more"]')){
      var sc2 = el.querySelector('.sheet-in');
      if(sc2) sc2.scrollBy({ top: Math.max(160, sc2.clientHeight - 140), behavior: 'smooth' });
      return;
    }

    // «Отметить частые» — одним кликом проставить закреплённый набор льгот
    // (STD_PINNED). Повторный клик, если весь набор уже стоит, — снимает его.
    var stdBtn = e.target.closest('[data-act="std-benefits"]');
    if(stdBtn){
      var stdCard = stdBtn.closest('.batch-card');
      var stdItem = entries[+stdCard.dataset.idx];
      if(!Array.isArray(stdItem.benefits)) stdItem.benefits = [];
      var allOn = STD_PINNED.length > 0 && STD_PINNED.every(function(b){
        return stdItem.benefits.indexOf(b) >= 0;
      });
      if(allOn){
        stdItem.benefits = stdItem.benefits.filter(function(b){ return STD_PINNED.indexOf(b) < 0; });
      } else {
        STD_PINNED.forEach(function(b){
          if(stdItem.benefits.indexOf(b) < 0) stdItem.benefits.push(b);
        });
      }
      refreshBenefitDropdown(stdCard, stdItem, true);
      updateCardCompleteness(stdCard, stdItem);
      toast(allOn ? 'Частые льготы сняты' : 'Частые льготы отмечены', allOn ? '' : 'ok');
      return;
    }

    // Выпадающий список льгот: раскрыть/свернуть
    var bdTog = e.target.closest('[data-act="bd-toggle"]');
    if(bdTog){
      var bdWrap = bdTog.closest('.bx-bd');
      var bdPanel = bdWrap.querySelector('.bx-bd-panel');
      if(bdPanel) bdPanel.classList.toggle('hidden');
      bdWrap.classList.toggle('open', bdPanel && !bdPanel.classList.contains('hidden'));
      setTimeout(function(){ el.dispatchEvent(new Event('_recue')); }, 0);
      return;
    }

    // Льготы → «Добавить» свою (свободный ввод). Сохраняется в записи анкеты.
    var bdAdd = e.target.closest('[data-act="bd-other-add"]');
    if(bdAdd){
      var bdCard = bdAdd.closest('.batch-card');
      var bdItem = entries[+bdCard.dataset.idx];
      var inp = bdCard.querySelector('.bx-bd-other-inp');
      var nv = inp ? String(inp.value || '').trim() : '';
      if(!nv){ if(inp) inp.focus(); return; }
      if(!Array.isArray(bdItem.benefits)) bdItem.benefits = [];
      var exists = bdItem.benefits.some(function(b){ return b.toLowerCase() === nv.toLowerCase(); });
      if(!exists) bdItem.benefits.push(nv);
      refreshBenefitDropdown(bdCard, bdItem, true);
      updateCardCompleteness(bdCard, bdItem);
      toast(exists ? 'Такая льгота уже отмечена' : 'Добавлена льгота: ' + nv, exists ? '' : 'ok');
      return;
    }

    var moreBtn = e.target.closest('[data-act="toggle-more"]');
    if(moreBtn){
      var card = moreBtn.closest('.batch-card');
      var panel = card.querySelector('.batch-more-panel');
      panel.classList.toggle('hidden');
      moreBtn.classList.toggle('open');
      setTimeout(function(){ el.dispatchEvent(new Event('_recue')); }, 0);
      return;
    }

    var card = e.target.closest('.batch-card');
    if(!card) return;
    var idx = +card.dataset.idx;
    var item = entries[idx];

    // Переменная часть: добавить / убрать вид
    if(e.target.closest('[data-act="bon-add"]')){
      if(!Array.isArray(item.bonuses)) item.bonuses = [];
      // пустой массив на экране = одна строка-заготовка; делаем её реальной
      if(!item.bonuses.length) item.bonuses.push({ type:'', size:'', per:'' });
      item.bonuses.push({ type:'', size:'', per:'' });
      var listEl = card.querySelector('.b-bon-list');
      if(listEl) listEl.innerHTML = bonRowsHtml(item);
      updateCardCompleteness(card, item);
      return;
    }
    var bonRm = e.target.closest('[data-act="bon-rm"]');
    if(bonRm){
      var rmI = +bonRm.dataset.bi;
      if(Array.isArray(item.bonuses)) item.bonuses.splice(rmI, 1);
      var listEl2 = card.querySelector('.b-bon-list');
      if(listEl2) listEl2.innerHTML = bonRowsHtml(item);
      updateCardCompleteness(card, item);
      return;
    }
    // Чипы вида/периодичности внутри строки переменной части
    var bonChip = e.target.closest('.chips[data-bi] button');
    if(bonChip){
      var bcI = +bonChip.dataset.bi;
      var bcField = bonChip.dataset.act === 'bonRowPer' ? 'per' : 'type';
      if(!Array.isArray(item.bonuses) || !item.bonuses.length) item.bonuses = [{ type:'', size:'', per:'' }];
      var brow = item.bonuses[bcI];
      if(brow){
        var bcV = bonChip.dataset.v;
        brow[bcField] = (brow[bcField] === bcV) ? '' : bcV;
        bonChip.parentNode.querySelectorAll('button').forEach(function(b){
          b.classList.toggle('on', b.dataset.v === brow[bcField]);
        });
      }
      updateCardCompleteness(card, item);
      return;
    }

    // Пикер должности у конкурента
    var pickTheir = e.target.closest('.b-pick-their');
    if(pickTheir){
      openPicker({
        title: 'Должность в компании ' + item.co,
        list: function(){ return S.data.positionsAll || []; },
        block: 'positions',
        value: item.posTheir,
        onPick: function(v){
          item.posTheir = v;
          pickTheir.querySelector('span').textContent = v || 'Выберите или добавьте';
          pickTheir.querySelector('span').className = v ? '' : 'ph';
          updateCardCompleteness(card, item);
        }
      });
      return;
    }

    // Чипы
    var chip = e.target.closest('.chips button');
    if(chip){
      var box = chip.parentNode;
      var act = chip.dataset.act;
      var v = chip.dataset.v;
      if(box.dataset.multi){
        var k = item.benefits.indexOf(v);
        if(k >= 0) item.benefits.splice(k, 1);
        else item.benefits.push(v);
        chip.classList.toggle('on', k < 0);
      } else {
        item[act] = (item[act] === v && !box.dataset.req) ? '' : v;
        box.querySelectorAll('button').forEach(function(b){
          b.classList.toggle('on', b.dataset.v === item[act]);
        });
        if(act === 'bonHas'){
          var bBox = card.querySelector('.b-bon-box');
          if(bBox) bBox.classList.toggle('hidden', item.bonHas !== 'да');
        }
      }
      updateCardCompleteness(card, item);
    }
  });

  // Синхронизация полей ввода
  el.addEventListener('input', function(e){
    var card = e.target.closest('.batch-card');
    if(!card) return;
    var idx = +card.dataset.idx;
    var item = entries[idx];

    if(e.target.classList.contains('b-pay-from')) item.payFrom = e.target.value.replace(/[^0-9\s,.]/g, '');
    if(e.target.classList.contains('b-pay-to')) item.payTo = e.target.value.replace(/[^0-9\s,.]/g, '');
    if(e.target.classList.contains('b-grade')) item.grade = e.target.value;
    if(e.target.classList.contains('b-bon-size')){
      var szI = +e.target.dataset.bi || 0;
      if(!Array.isArray(item.bonuses) || !item.bonuses.length) item.bonuses = [{ type:'', size:'', per:'' }];
      if(item.bonuses[szI]) item.bonuses[szI].size = e.target.value;
    }
    if(e.target.classList.contains('b-extra')) item.extra = e.target.value;
    if(e.target.classList.contains('b-note')) item.note = e.target.value;
    updateCardCompleteness(card, item);
  });

  el.addEventListener('change', function(e){
    var card = e.target.closest('.batch-card');
    if(!card) return;
    var idx = +card.dataset.idx;
    var item = entries[idx];

    if(e.target.classList.contains('b-cur')){ item.cur = e.target.value; S.fillPrefs.cur = item.cur; }
    if(e.target.classList.contains('b-pay-per')){ item.payPer = e.target.value; S.fillPrefs.payPer = item.payPer; }

    // Галочка льготы в выпадающем списке
    if(e.target.matches('input[data-act="bd-opt"]')){
      if(!Array.isArray(item.benefits)) item.benefits = [];
      var bv = e.target.dataset.v;
      var bk = item.benefits.indexOf(bv);
      if(e.target.checked && bk < 0) item.benefits.push(bv);
      else if(!e.target.checked && bk >= 0) item.benefits.splice(bk, 1);
      var lab = e.target.closest('.bx-bd-opt');
      if(lab) lab.classList.toggle('on', e.target.checked);
      var sum = card.querySelector('.bx-bd-sum');
      if(sum){
        var n = item.benefits.length;
        sum.textContent = n ? n + ' ' + declOfNum(n, ['льгота', 'льготы', 'льгот']) + ' выбрано' : 'Выберите льготы';
        sum.classList.toggle('ph', !n);
      }
    }

    updateCardCompleteness(card, item);
  });

  // Сохранение всей должности
  el.querySelector('#batchSaveBtn').onclick = function(){
    // Свести карточку и сразу сохранить на сервер (не только в черновик).
    if(saveBatchSurvey()) save(false);
  };

  setTimeout(function(){ el.querySelector('.sheet-in').scrollTop = 0; }, 30);
}

// ═══════════════════════════════════════════════════════════
// ОБЩЕЕ: черновик, прогресс
// ═══════════════════════════════════════════════════════════
function markDirty(){
  if(S.ro && !S.editingPeriodId) return;
  var was = S.dirty;
  S.dirty = true;
  // Локальный черновик привязан только к unit, без учёта года — в архивном
  // режиме НЕ сохраняем его, иначе он может подмешать архивные правки в
  // черновик текущего года при следующем обычном открытии этого же
  // подразделения (ключ LS_DRAFT+unit один и тот же для обоих режимов).
  if(!S.editingPeriodId){
    store.set(LS_DRAFT+S.unit, JSON.stringify({
      rows: S.rows,
      added: S.added,
      surveys: S.surveys,
      removed: S.removed,
      note: S.note,
      tab: S.tab || 'comp',
      savedAt: new Date().toISOString()
    }));
  }
  if(!was){
    var b = $('btnSave');
    if(b) b.classList.toggle('hidden', S.ro && !S.editingPeriodId);
  }
}

function updateProgress(){
  var c = counts();

  if(S.tab === 'comp'){
    $('progT').textContent = c.done + ' из ' + c.all;
    if(c.ask){
      $('progS').className = 'ask';
      $('progS').textContent = 'уточнить: ' + c.ask;
    } else {
      $('progS').className = '';
      $('progS').textContent = (c.all && c.done === c.all) ? 'всё проверено' : 'проверено компаний';
    }
  } else {
    var mc = svMatrixCounts();
    if(mc.totalSlots > 0){
      $('progT').textContent = mc.filledCount + ' из ' + mc.totalSlots;
      $('progS').className = '';
      $('progS').textContent = 'карточек заполнено (' + mc.pct + '%)';
    } else if(mc.totalPositions > 0){
      // Компаний ещё нет (Шаг 1 пуст) — знаменателя-матрицы нет, но штатка
      // подразделения известна: показываем её как ориентир.
      $('progT').textContent = S.surveys.length + ' из ' + mc.totalPositions;
      $('progS').className = '';
      $('progS').textContent = declOfNum(mc.totalPositions, ['должность в штатке', 'должности в штатке', 'должностей в штатке']);
    } else {
      $('progT').textContent = S.surveys.length + (S.removed.length ? ' (−'+S.removed.length+')' : '');
      $('progS').className = '';
      $('progS').textContent = 'записей по должностям';
    }
  }

  var t1 = document.querySelector('.tabs button[data-tab="comp"]');
  var t2 = document.querySelector('.tabs button[data-tab="survey"]');
  if(t1){
    t1.innerHTML = '<div class="tab-top-row"><span class="tab-step-lbl">ШАГ 1'+(c.all > 0 && c.done === c.all ? ' ✓' : '')+'</span>'+
      (c.ask ? '<span class="tab-ask-tag">?'+c.ask+' на уточнении</span>' : '')+'</div>'+
      '<div class="tab-main-row"><span class="tab-title">Участники рынка</span><span class="tab-count">'+c.done+'/'+c.all+'</span></div>';
    t1.classList.toggle('done', c.all > 0 && c.done === c.all);
  }
  if(t2){
    t2.innerHTML = '<div class="tab-top-row"><span class="tab-step-lbl">ШАГ 2</span></div>'+
      '<div class="tab-main-row"><span class="tab-title">Данные по рынку</span><span class="tab-count">'+svLabel()+'</span></div>';
    t2.classList.toggle('done', S.surveys.length > 0);
  }

  var nextBtn = $('btnNext');
  if(nextBtn){
    nextBtn.classList.remove('hidden');
    if(S.tab === 'comp'){
      nextBtn.textContent = 'Перейти к шагу 2: Оклады →';
      nextBtn.onclick = function(){ S.tab = 'survey'; renderUnit(); };
    } else {
      nextBtn.textContent = '← Назад к шагу 1: Конкуренты';
      nextBtn.onclick = function(){ S.tab = 'comp'; renderUnit(); };
    }
  }

  $('btnSave').classList.toggle('hidden', (S.ro && !S.editingPeriodId) || !S.dirty);
  $('btnSave').textContent = 'Сохранить';
}

// ═══════════════════════════════════════════════════════════
// ДОБАВЛЕНИЕ КОМПАНИИ-КОНКУРЕНТА
// ═══════════════════════════════════════════════════════════
function openAddSheet(){
  // Запоминаем прошлый выбор на время сессии: компании-конкуренты обычно
  // добавляют пачкой с одинаковыми типом/приоритетом/сегментом/регионом.
  // Любое поле остаётся редактируемым.
  S.lastAdd = S.lastAdd || {};
  var picked = {
    type: S.lastAdd.type || '', prio: S.lastAdd.prio || '',
    seg: S.lastAdd.seg || '', region: S.lastAdd.region || ''
  };
  var pickedBase = JSON.stringify(picked);

  var el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = '<div class="sheet-in">'+
    '<div class="sheet-hd"><b>Добавить компанию</b>'+
      '<button class="btn-ghost" data-x="1">Закрыть</button></div>'+
    '<div id="addWarn"></div>'+
    '<label class="lbl">Название компании</label>'+
    '<input id="addName" placeholder="Начните вводить…" autocomplete="off">'+
    '<div id="addSug"></div>'+
    '<label class="lbl">Тип компании</label>'+ chips('type', S.data.ref.types, picked.type, false) +
    '<label class="lbl">Приоритет</label>'+ chips('prio', S.data.ref.priorities, picked.prio, false) +
    '<label class="lbl">Сегмент</label>'+ pickField('addSeg', picked.seg, 'Выберите сегмент', false) +
    '<label class="lbl">Регион</label>'+ pickField('addReg', picked.region, 'Выберите регион', false) +
    '<label class="lbl">Комментарий</label><textarea id="addNote"></textarea>'+
    '<div style="height:14px"></div>'+
    '<button id="addGo" class="btn-primary">Добавить в список</button></div>';
  document.body.appendChild(el);

  // Сегмент и регион — из справочника, чтобы «Худжанд», «Худжанд (ГО)» и «худжанд»
  // не расползались по таблице тремя разными значениями
  var bindRef = function(id, field, title, block, list){
    var btn = el.querySelector('#'+id);
    btn.onclick = function(){
      openPicker({
        title: title, block: block, list: list(), value: picked[field],
        onPick: function(v){
          picked[field] = v;
          btn.querySelector('span').textContent = v;
          btn.querySelector('span').className = '';
        }
      });
    };
  };
  bindRef('addSeg', 'seg', 'Сегмент', 'segments', function(){ return S.data.segments || []; });
  bindRef('addReg', 'region', 'Регион присутствия', 'regions', function(){ return S.data.regions || []; });

  var isDirty = function(){
    return !!(el.querySelector('#addName').value.trim() || el.querySelector('#addNote').value.trim() ||
      JSON.stringify(picked) !== pickedBase);
  };

  el.addEventListener('click', function(e){
    if(e.target === el || e.target.dataset.x){
      if(!isDirty()){ el.remove(); return; }
      confirmDiscard().then(function(yes){ if(yes) el.remove(); });
      return;
    }
    var b = e.target.closest('.chips button');
    if(!b) return;
    var act = b.dataset.act;
    picked[act] = (picked[act] === b.dataset.v) ? '' : b.dataset.v;
    b.parentNode.querySelectorAll('button').forEach(function(x){
      x.classList.toggle('on', x.dataset.v === picked[act]); });
  });

  var nameEl = el.querySelector('#addName');
  nameEl.oninput = function(){
    var q = this.value.trim().toLowerCase();
    var w = el.querySelector('#addWarn'); w.innerHTML = '';
    if(q.length >= 2){
      var bad = S.data.banned.filter(function(b){ return b.name.toLowerCase().indexOf(q) >= 0; });
      if(bad.length) w.innerHTML = '<div class="note">«'+esc(bad[0].name)+'» — '+esc(bad[0].reason)+
        '. Эту компанию включать в обзор нельзя.</div>';
    }
    var box = el.querySelector('#addSug');
    if(q.length < 2){ box.innerHTML = ''; return; }
    var hit = S.data.companies.filter(function(c){ return c.name.toLowerCase().indexOf(q) >= 0; }).slice(0,7);
    box.innerHTML = hit.length ? '<div class="sug">'+hit.map(function(c){
      return '<button type="button" data-n="'+esc(c.name)+'" data-s="'+esc(c.seg)+'" data-r="'+esc(c.region)+'">'+
        esc(c.name)+'<small>'+esc([c.seg,c.region].filter(String).join(' · '))+'</small></button>'; }).join('')+'</div>' : '';
    box.querySelectorAll('[data-n]').forEach(function(d){
      d.onclick = function(){
        nameEl.value = d.dataset.n;
        if(d.dataset.s){
          picked.seg = d.dataset.s;
          var s = el.querySelector('#addSeg span');
          s.textContent = d.dataset.s; s.className = '';
        }
        if(d.dataset.r){
          picked.region = d.dataset.r;
          var g = el.querySelector('#addReg span');
          g.textContent = d.dataset.r; g.className = '';
        }
        box.innerHTML = '';
      };
    });
  };

  el.querySelector('#addGo').onclick = function(){
    var name = nameEl.value.trim();
    if(!name){ toast('Введите название компании'); return; }
    var dup = S.rows.concat(S.added).some(function(r){
      return r.company.toLowerCase() === name.toLowerCase(); });
    if(dup){ toast('Такая компания уже есть в списке'); return; }
    S.added.push({
      id:'', unit:S.unit, company:name, type:picked.type, prio:picked.prio,
      seg: picked.seg,
      region: picked.region,
      note: el.querySelector('#addNote').value.trim(),
      status:'', src:'', actual:'актуально'
    });
    S.lastAdd = { type:picked.type, prio:picked.prio, seg:picked.seg, region:picked.region };
    el.remove();
    markDirty();
    renderUnit();
    toast('Компания добавлена. Не забудьте сохранить.');
  };
  setTimeout(function(){ nameEl.focus(); }, 60);
}

// ═══════════════════════════════════════════════════════════
// СОХРАНЕНИЕ
// ═══════════════════════════════════════════════════════════
$('btnSave').onclick = function(){ save(false); };

function save(submit){
  if(S.saving || (S.ro && !S.editingPeriodId)) return;
  if(!submit){ doSave(false); return; }

  var c = counts();
  var q = null;
  if(c.left){
    q = { html: 'Не отмечено компаний: <b>'+c.left+'</b>.' +
                (c.ask ? '\nЕщё <b>'+c.ask+'</b> отложено на уточнение — они тоже не считаются проверенными.' : '') };
  } else if(c.ask){
    q = { html: 'Компаний на уточнении: <b>'+c.ask+'</b>.\n' +
                'Они не считаются проверенными — вопрос по ним ещё открыт.' };
  }
  if(!q){ doSave(true); return; }

  ask({
    title: 'Отправить как готовое?',
    html: q.html,
    ok: 'Всё равно отправить',
    cancel: 'Вернуться'
  }).then(function(yes){ if(yes) doSave(true); });
}

function doSave(submit){
  if(S.saving || (S.ro && !S.editingPeriodId)) return;
  S.saving = true;
  $('btnSave').disabled = true;
  $('btnSave').textContent = 'Сохраняем…';

  var unitAtSave = S.unit;

  // Обе вкладки сохраняются вместе — человек не должен думать, где он находится
  var p1 = call('apiSave', S.token, {
    unit: unitAtSave, rows: S.rows, added: S.added, note: S.note, submit: !!submit });

  var saveGroup = currentUnitGroup();
  var needSurvey = S.surveys.length > 0 || S.removed.length > 0;
  var p2 = needSurvey
    ? call('apiSaveSurvey', S.token, saveGroup
        ? { unit: unitAtSave, groupKey: saveGroup, upsert: S.surveys, remove: S.removed }
        : { unit: unitAtSave, upsert: S.surveys, remove: S.removed })
    : Promise.resolve({ ok:true, newIds:[], added:0, updated:0, removed:0 });

  Promise.all([p1, p2]).then(function(res){
    S.saving = false;
    $('btnSave').disabled = false;
    $('btnSave').textContent = 'Сохранить';

    var a = res[0], b = res[1];
    if(!a || !a.ok || !b || !b.ok){
      var msg = (a && !a.ok && a.error) || (b && !b.ok && b.error) || 'Не удалось сохранить';
      toast(msg, 'no');
      if(msg.indexOf('Сессия') === 0){
        store.del(LS_TOKEN);
        setTimeout(function(){ location.reload(); }, 1600);
      }
      return;
    }

    S.dirty = false;
    store.del(LS_DRAFT + unitAtSave);

    // Смежная группа: сервер применил upsert/remove ко всем площадкам и не
    // возвращает пер-строчные ID — локальный кэш не патчим, а перечитываем
    // истину целиком (doRefresh_ → onLoaded).
    if(b && b.group){
      S.removed = [];
      // Конкуренты Шага 1 всё же могли сохраниться (p1) — их ID подхватит refresh.
      toast(submit ? 'Отправлено. Спасибо!' :
        'Сохранено — применено ко всем площадкам группы (' + (b.units || '?') + ')', 'ok');
      doRefresh_();
      return;
    }

    // Конкуренты: добавленные получили ID — переносим в основной список
    S.added.forEach(function(x, k){
      x.id = (a.newIds && a.newIds[k]) || x.id;
      if(x.id){ S.rows.push(x); S.data.rows.push(x); }
    });
    S.added = [];
    syncCache(S.rows, S.data.rows);

    // Обзор: newIds идёт в том же порядке, что и отправленный upsert
    (b.newIds || []).forEach(function(id, k){
      if(id && S.surveys[k]) S.surveys[k].id = id;
    });
    S.removed = [];
    S.data.surveys = S.data.surveys.filter(function(x){ return x.unit !== unitAtSave; })
      .concat(S.surveys.map(function(x){ return JSON.parse(JSON.stringify(x)); }));

    var u = S.data.units.filter(function(x){ return x.unit === unitAtSave; })[0];
    if(u){
      var after = counts();
      u.total = after.all;
      u.done = after.done;
      u.ask = after.ask;
      u.surveys = S.surveys.length;
      u.note = S.note;
    }

    // Часть строк принадлежит другому ответственному (см. isOwnedByOther
    // на сервере) — сохранилось всё остальное, но по этим строкам локальное
    // состояние теперь расходится с базой, поэтому явно предупреждаем и
    // предлагаем обновить, а не притворяемся, что сохранилось всё.
    var blocked = ([]).concat((a.blocked || []), (b.blocked || []));
    if(blocked.length){
      var names = blocked.map(function(x){ return (x.company||'')+' — заполняет '+(x.owner||'кто-то другой'); });
      ask({
        title: 'Часть строк не сохранена',
        html: 'Остальное сохранено. Эти записи уже занял другой ответственный:<br>'+
              names.slice(0,6).map(esc).join('<br>')+(names.length>6?'<br>и ещё '+(names.length-6):''),
        ok: 'Обновить данные',
        cancel: 'Понятно'
      }).then(function(yes){ if(yes) doRefresh_(); });
    }

    toast(submit ? 'Отправлено. Спасибо!' : 'Сохранено в ' + a.at, 'ok');
    if(submit) setTimeout(renderUnits, 900);
    else renderUnit();
  }).catch(function(){
    S.saving = false;
    $('btnSave').disabled = false;
    $('btnSave').textContent = 'Сохранить';
    toast('Нет связи. Черновик сохранён на устройстве — попробуйте позже.', 'no');
  });
}

function syncCache(local, cache){
  var byId = {};
  local.forEach(function(x){ if(x.id) byId[x.id] = x; });
  cache.forEach(function(x){ if(byId[x.id] && byId[x.id] !== x) Object.assign(x, byId[x.id]); });
}

window.addEventListener('beforeunload', function(e){
  if(S.dirty){ e.preventDefault(); e.returnValue = ''; }
});

// ═══════════════════════════════════════════════════════════
// СКЕЛЕТОНЫ ЗАГРУЗКИ (Фаза 7) — по форме контента, а не крутилка
// ═══════════════════════════════════════════════════════════
function skTable(rows){
  rows = rows || 7;
  var body = '';
  for(var i = 0; i < rows; i++){
    body += '<div class="sk-row">'+
      '<div class="sk-line" style="width:26%"></div>'+
      '<div class="sk-line" style="width:16%"></div>'+
      '<div class="sk-line" style="width:12%"></div>'+
      '<div class="sk-line" style="width:20%;margin-left:auto"></div>'+
    '</div>';
  }
  return '<div class="sk">'+
    '<div class="sk-row">'+
      '<div class="sk-line" style="width:38%;height:40px;border-radius:var(--r-xs)"></div>'+
      '<div class="sk-line" style="width:150px;height:40px;margin-left:auto;border-radius:var(--r-xs)"></div>'+
    '</div>'+
    '<div class="sk-block" style="height:1px;margin:2px 0"></div>'+
    body+
  '</div>';
}
function skDash(){
  var t = '', c = '';
  for(var i = 0; i < 4; i++) t += '<div class="sk-block sk-tile" style="flex:1"></div>';
  for(var j = 0; j < 3; j++) c += '<div class="sk-block sk-card" style="flex:1"></div>';
  return '<div class="sk">'+
    '<div class="sk-row" style="gap:10px">'+t+'</div>'+
    '<div class="sk-block sk-chart"></div>'+
    '<div class="sk-row" style="gap:12px;align-items:stretch">'+c+'</div>'+
  '</div>';
}

// ═══════════════════════════════════════════════════════════
// АНАЛИТИЧЕСКИЙ ДАШБОРД (C&B, РУКОВОДСТВО, HR BP)
// ═══════════════════════════════════════════════════════════
function openDashboard(){
  if(window.WorkspaceTabs && WorkspaceTabs.openTab && !WorkspaceTabs.isInsideTabRun){
    WorkspaceTabs.openTab({
      key: 'dashboard',
      title: 'Дашборд',
      icon: 'dashboard',
      state: { appView: 'dashboard', unit: null },
      run: function(){ openDashboard(); }
    });
    return;
  }
  S.appView = 'dashboard';
  S.unit = null;
  saveNavState();
  renderTopNav();
  setTop('Аналитический Дашборд', userLabel(), false, 'dashboard');
  $('bar').classList.add('hidden');
  $('body').onclick = null;
  fetchDashboard(false);
}

/**
 * Сводная строка KPI над графиками дашборда (макет turn-19a): масштаб данных
 * и доверие к ним, одним взглядом перед любой из вкладок. Цифры — из
 * summary дашборда, новых полей у API не просим: «компаний-участников» в
 * контракте нет, поэтому вторая плитка показывает связи по рынку.
 */
function renderDashKpiRow(sm){
  // KPI-плитки нужны только на «Обзоре» — на «Вилках»/«Реестре» они лишь
  // отжимают таблицу вниз. На других вкладках строка пустая и схлопывается.
  if(S.dashTab !== 'overview') return '';
  sm = sm || {};
  function tile(label, val, sub, warn){
    var vHtml = (typeof val === 'number') ? '<span data-countup="'+val+'">0</span>' : val;
    return '<div class="kpi-card"><div class="kpi-t">'+label+'</div>'+
      '<div class="kpi-v">'+vHtml+'</div>'+
      (sub ? '<div class="kpi-s'+(warn?' is-warn':'')+'">'+sub+'</div>' : '')+
    '</div>';
  }
  var med = sm.salaryMedian || 0;
  return '<div class="kpi-grid kpi-grid--dash">'+
    tile('Записей по рынку', (sm.totalSurveyRecords||0), (sm.recordsWithSalary||0)+' с окладом')+
    tile('Компаний в опросе', (sm.companiesInSurvey||0), '')+
    tile('Медиана рынка', med ? med.toLocaleString('ru-RU')+' c' : '—',
      (sm.salaryP25 && sm.salaryP75) ? 'P25 '+sm.salaryP25.toLocaleString('ru-RU')+' · P75 '+sm.salaryP75.toLocaleString('ru-RU') : '')+
    tile('Должностей', (sm.positionsCount||0),
      sm.unmappedRecords ? sm.unmappedRecords+' записей без сопоставления' : '',
      !!sm.unmappedRecords)+
  '</div>';
}

function renderCurrentDashTab(){
  var d = S.dashData || {};
  if(S.dashTab === 'overview'){
    return renderOverviewTab(d);
  } else if(S.dashTab === 'salaries'){
    return renderSalariesTab(d.positions || []);
  } else if(S.dashTab === 'regions'){
    return renderRegionsTab(d.regionStats || []);
  } else if(S.dashTab === 'registry'){
    return renderRegistryTab(d.rows || []);
  } else if(S.dashTab === 'progress'){
    return renderProgressTab(d.hrbpProgress || [], d.dirProgress || []);
  } else if(S.dashTab === 'benefits'){
    return renderBenefitsTab(d.topBenefits || [], d.bonuses || {}, d.topCompetitors || []);
  }
  return '';
}

function fetchDashboard(quiet){
  if(!quiet){
    $('body').innerHTML = skDash();
  }
  return call('apiCBDashboardExtended', S.token, S.dashFilters).then(function(r){
    if(!r || !r.ok){
      if(!quiet) $('body').innerHTML = '<div class="err">'+esc((r&&r.error)||'Не удалось загрузить данные дашборда')+'</div>';
      else toast((r&&r.error)||'Ошибка загрузки', 'no');
      return;
    }
    S.dashData = r;
    if(quiet && $('dashTabContent') && $('dashKpiFrame')){
      $('dashKpiFrame').innerHTML = '';
      if($('dashKpiRow')) $('dashKpiRow').innerHTML = renderDashKpiRow(r.summary || {});
      $('dashTabContent').innerHTML = renderCurrentDashTab();
    } else {
      renderDashboard();
    }
  }).catch(function(){
    if(!quiet) $('body').innerHTML = '<div class="err">Нет связи с сервером. Попробуйте обновить.</div>';
    else toast('Нет связи с сервером', 'no');
  });
}

// ─── Кастомный выпадающий список вместо нативного <select>: скруглённая
// панель, тени, подсветка строк — в стиле сайта. Нативный поповер ОС не
// поддаётся оформлению, поэтому рисуем свой.
function niceSelect(o){
  var items = o.items || [];
  var cur = items.filter(function(it){ return String(it.v) === String(o.value || ''); })[0] || items[0] || { label:'' };
  return '<div class="nselect" id="'+o.id+'" data-value="'+esc(String(o.value || ''))+'"'+
      (o.width ? ' style="width:'+o.width+'px"' : '')+'>'+
    '<button type="button" class="nselect-btn">'+
      '<span class="nselect-cur">'+esc(cur.label)+'</span>'+icBare('chevron', 14)+
    '</button>'+
    '<div class="nselect-panel" hidden>'+
      items.map(function(it){
        return '<button type="button" class="nselect-opt'+(String(it.v) === String(o.value || '') ? ' on' : '')+
          '" data-v="'+esc(String(it.v))+'">'+esc(it.label)+'</button>';
      }).join('')+
    '</div>'+
  '</div>';
}

function wireNiceSelect(id, onPick){
  var root = $(id);
  if(!root) return;
  var btn = root.querySelector('.nselect-btn');
  var panel = root.querySelector('.nselect-panel');
  var onDoc = function(e){ if(!root.contains(e.target)) close(); };
  var onKey = function(e){ if(e.key === 'Escape') close(); };
  function close(){
    panel.hidden = true;
    root.classList.remove('open');
    document.removeEventListener('click', onDoc, true);
    document.removeEventListener('keydown', onKey, true);
  }
  btn.onclick = function(e){
    e.stopPropagation();
    if(panel.hidden){
      panel.hidden = false;
      root.classList.add('open');
      var on = panel.querySelector('.nselect-opt.on');
      if(on) on.scrollIntoView({ block:'nearest' });
      document.addEventListener('click', onDoc, true);
      document.addEventListener('keydown', onKey, true);
    } else { close(); }
  };
  panel.querySelectorAll('.nselect-opt').forEach(function(opt){
    opt.onclick = function(){
      root.dataset.value = this.dataset.v;
      root.querySelector('.nselect-cur').textContent = this.textContent;
      panel.querySelectorAll('.nselect-opt').forEach(function(x){ x.classList.toggle('on', x === opt); });
      close();
      if(onPick) onPick(this.dataset.v);
    };
  });
}

function setNiceSelect(id, v){
  var root = $(id);
  if(!root) return;
  root.dataset.value = v;
  var chosen = null;
  root.querySelectorAll('.nselect-opt').forEach(function(o){
    var m = o.dataset.v === v;
    o.classList.toggle('on', m);
    if(m) chosen = o;
  });
  if(chosen) root.querySelector('.nselect-cur').textContent = chosen.textContent;
}

function renderDashboard(){
  if(!S.dashData) return;
  var d = S.dashData;
  var sm = d.summary || {};

  // 1. Вкладки Дашборда и Метрики в одной строке
  var tabs = [
    { id:'overview', icon:'dashboard', label:'Обзор' },
    { id:'salaries', icon:'wallet', label:'Зарплатные вилки' },
    { id:'regions', icon:'units', label:'По регионам' },
    { id:'benchmarks', icon:'chart', label:'Бенчмаркинг' },
    { id:'registry', icon:'table', label:'Реестр данных' },
    { id:'progress', icon:'target', label:'Прогресс по HR BP' },
    { id:'benefits', icon:'medal', label:'Льготы и Бонусы' }
  ];
  var h = '<div class="sub-tabs sub-tabs--sticky dash-tabbar">'+
    '<div class="dash-tab-strip">'+
      tabs.map(function(t){
        var on = S.dashTab === t.id ? ' on' : '';
        return '<button class="sub-tab'+on+'" data-dtab="'+t.id+'">'+ic(t.icon)+esc(t.label)+'</button>';
      }).join('')+
    '</div>'+
    '<div id="dashKpiFrame" class="kpi-group-frame"></div>'+
  '</div>';

  // 2. Компактная панель фильтров в 1 аккуратную строку
  var allDirs = (d.dirProgress || []).map(function(x){ return x.dir; }).filter(function(x){ return x && x !== 'Без направления'; });
  var allHrbps = (d.hrbpProgress || []).map(function(x){ return x.hrbp; }).filter(function(x){ return x && x !== 'Не назначен'; });
  var allRegions = (d.regions || []);

  // Общий фильтр — направление, HR BP, регион (поиск у «Вилок» и «Реестра»
  // свой). На «Прогрессе» фильтр не применяется — там панель скрыта.
  var filterHidden = (S.dashTab === 'progress' || S.dashTab === 'benchmarks');
  var periodsList = d.periodsList || [];
  h += '<div id="dashFilterBar" class="toolbar dash-filters"'+(filterHidden ? ' style="display:none"' : '')+'>'+
    (periodsList.length > 1 ? niceSelect({ id:'dashPeriod', value:S.dashFilters.period || String(d.viewingPeriodId || ''), width:260,
      items: periodsList.map(function(p){ return { v:String(p.id), label: p.name + (p.at ? ' — ' + fmtDateTime(p.at) : '') }; }) }) : '')+
    niceSelect({ id:'dashDir', value:S.dashFilters.dir, width:190,
      items:[{ v:'', label:'Все направления' }].concat(allDirs.map(function(dir){ return { v:dir, label:dir }; })) })+
    niceSelect({ id:'dashHrbp', value:S.dashFilters.hrbp, width:180,
      items:[{ v:'', label:'Все HR BP' }].concat(allHrbps.map(function(x){ return { v:x, label:x }; })) })+
    (allRegions.length ? niceSelect({ id:'dashRegion', value:S.dashFilters.region, width:170,
      items:[{ v:'', label:'Все регионы' }].concat(allRegions.map(function(x){ return { v:x, label:x }; })) }) : '')+
    '<button id="btnDashReset" class="btn-ghost dash-filter-reset">Сбросить</button>'+
    '<button id="btnDashExport" class="btn-line dash-filter-export">'+ic('download', 14)+'<span class="dash-exp-txt">Экспорт в CSV</span></button>'+
  '</div>';

  // Не-admin/cb видят дашборд только по своим подразделениям — честно помечаем,
  // чтобы цифры не принимали за весь рынок.
  if(d.scoped){
    h += '<div class="info" style="margin-bottom:8px">'+ic('eye', 13)+' Показаны данные только по вашим подразделениям.</div>';
  }

  // 3. Сводная строка KPI перед графиками (turn-19a)
  h += '<div id="dashKpiRow">' + renderDashKpiRow(sm) + '</div>';

  // 4. Контент выбранной вкладки в отдельном контейнере
  h += '<div id="dashTabContent" style="flex:1;min-height:0;display:flex;flex-direction:column">' + renderCurrentDashTab() + '</div>';

  $('body').innerHTML = h;

  // Фильтр «Регион» не нужен на вкладке «По регионам» (таблица и так по всем).
  if(S.dashTab === 'regions'){ var rSel0 = $('dashRegion'); if(rSel0) rSel0.style.display = 'none'; }

  // Слушатели событий дашборда
  $('body').querySelectorAll('button[data-dtab]').forEach(function(btn){
    btn.onclick = function(){
      if(this.dataset.dtab === 'benchmarks'){
        openBenchmarks();
        return;
      }
      S.dashTab = this.dataset.dtab;
      $('body').querySelectorAll('button[data-dtab]').forEach(function(b){ b.classList.remove('on'); });
      this.classList.add('on');
      if($('dashKpiRow')) $('dashKpiRow').innerHTML = renderDashKpiRow((S.dashData && S.dashData.summary) || {});
      if($('dashFilterBar')) $('dashFilterBar').style.display = (S.dashTab === 'progress') ? 'none' : 'flex';
      // Фильтр «Регион» не нужен на самой вкладке «По регионам» (там таблица
      // и так по всем регионам) — прячем/показываем при переключении.
      var rSel = $('dashRegion');
      if(rSel) rSel.style.display = (S.dashTab === 'regions') ? 'none' : '';
      $('dashTabContent').innerHTML = renderCurrentDashTab();
    };
  });

  wireNiceSelect('dashPeriod', function(v){ S.dashFilters.period = v; fetchDashboard(true); });
  wireNiceSelect('dashDir', function(v){ S.dashFilters.dir = v; fetchDashboard(true); });
  wireNiceSelect('dashHrbp', function(v){ S.dashFilters.hrbp = v; fetchDashboard(true); });
  wireNiceSelect('dashRegion', function(v){ S.dashFilters.region = v; fetchDashboard(true); });

  $('btnDashReset').onclick = function(){
    S.dashFilters = { dir:'', hrbp:'', region:'', search:'', period:S.dashFilters.period };
    setNiceSelect('dashDir', '');
    setNiceSelect('dashHrbp', '');
    setNiceSelect('dashRegion', '');
    fetchDashboard(true);
  };

  $('btnDashExport').onclick = exportDashboardCSV;
}

/** Переменная часть по компании → массив [{type,size,per}] для подсказки. */
function varPayKinds(c){
  var vp = c && c.varPay;
  if(vp && Array.isArray(vp.kinds)) return vp.kinds;
  var arr = c && c.bonuses;
  if(Array.isArray(arr) && arr.length) return arr;
  if(c && (c.bonHas === 'да' || c.bonSize || c.bonType)){
    return [{ type: c.bonType || '', size: c.bonSize || '', per: c.bonPer || '' }];
  }
  return [];
}

/** Список видов премии одной строкой на вид — для нативной подсказки (title). */
function varPayTip(kinds){
  return kinds.map(function(k){
    return (k.type || 'премия') + (k.size ? ' — ' + k.size : '') + (k.per ? ' · ' + k.per : '');
  }).join('\n');
}

/** Ячейка «Переменная часть»: короткая пометка, полный список видов — в нативной
 *  подсказке (title). CSS-поповер убран: он срезался прокручиваемой обёрткой
 *  таблицы и мешал горизонтальному скроллу на узких экранах. */
function varPayCell(c){
  var vp = c && c.varPay ? c.varPay : {};
  var kinds = varPayKinds(c);
  var lbl = vp.label || (kinds.length ? kinds.length + ' ' + declOfNum(kinds.length, ['вид','вида','видов']) : '');
  if(!lbl) return '<span style="color:var(--muted)">—</span>';
  if(!kinds.length) return '<span style="color:var(--muted)">'+esc(lbl)+'</span>';
  return '<span class="vp" title="'+esc(varPayTip(kinds))+'">'+esc(lbl)+'</span>';
}

/** Реестр данных: то же самое (общая реализация). */
function regVarPayCell(r){
  return varPayCell(r);
}

/** Ячейка «Совокупно, мес.»: средний оклад + премия, приведённая к месяцу
 *  (только когда размер премии распознан — иначе прочерк). */
function totalPayCell(c){
  var base = c && c.avg || 0;
  var bm = c && c.varPay ? c.varPay.monthly : null;
  if(!(base > 0) || bm == null){
    return '<span style="color:var(--muted)">—</span>';
  }
  return '<span style="color:var(--accent);font-weight:600">≈ '+Math.round(base + bm).toLocaleString('ru-RU')+'</span>';
}

/** Строки таблицы «компания / оклад / переменная часть / совокупно / льготы / прим.» */
function salCoRows(pos){
  return (pos.companies || []).map(function(c){
    var payStr = (c.pFrom || c.pTo)
      ? (c.pFrom ? c.pFrom.toLocaleString('ru-RU') : '—') + ' … ' + (c.pTo ? c.pTo.toLocaleString('ru-RU') : '—') + ' ' + esc(c.cur)
      : 'не указан';
    if(c.hourly){
      var h = c.hourFrom === c.hourTo ? c.hourFrom : (c.hourFrom + '–' + c.hourTo);
      payStr += ' <small style="color:var(--muted)">(ЧТС ' + esc(String(h)) + ' × 168 ч)</small>';
    }
    var bList = (c.benefits || []).map(function(b){ return '<span class="pill p-ok" style="font-size:11.5px;margin-right:3px">'+esc(b)+'</span>'; }).join('');
    return '<tr>'+
      '<td><b>'+esc(c.company)+'</b><br><small style="color:var(--muted)">'+esc(c.unit)+'</small></td>'+
      '<td>'+payStr+'</td>'+
      '<td>'+varPayCell(c)+'</td>'+
      '<td>'+totalPayCell(c)+'</td>'+
      '<td>'+(bList || '<span style="color:var(--muted)">—</span>')+'</td>'+
      '<td><small style="color:var(--muted)">'+esc(c.note || '—')+'</small></td>'+
    '</tr>';
  }).join('');
}

function salCoTable(pos){
  return '<div class="tblwrap"><table class="co-tbl">'+
    '<thead><tr><th>Компания / Отдел</th><th>Вилка оклада</th><th>Переменная часть</th><th>Совокупно, мес.</th><th>Льготы</th><th>Примечание</th></tr></thead>'+
    '<tbody>'+salCoRows(pos)+'</tbody></table></div>';
}

/** Строка-сводка над таблицей компаний: премии по должности одним взглядом. */
function posVarSummary(p){
  var n = (p.companies || []).length;
  var bits = [];
  if(n && p.bonCompanies != null){
    bits.push('премии: <b>'+p.bonCompanies+' из '+n+'</b> '+declOfNum(n, ['компания','компании','компаний'])+
      (p.bonTopPer ? ', чаще ' + esc(p.bonTopPer) : ''));
  }
  if(p.totalMedian > 0){
    // Медиана считается по всем компаниям с окладом (премия 0, если не
    // распознана) — тем же методом, что и бенчмарк. Показываем охват премией.
    var quant = (p.bonQuantified != null) ? p.bonQuantified : (p.bonCompanies || 0);
    bits.push('совокупно, медиана ≈ <b>'+p.totalMedian.toLocaleString('ru-RU')+' c</b>'+
      (quant < n ? ' <span style="color:var(--muted)">(премия с суммой у '+quant+' из '+n+')</span>' : ''));
  }
  return bits.length ? '<div class="pos-var-sum">'+bits.join(' · ')+'</div>' : '';
}

function salForkNums(pos){
  return '<div class="fork-nums">'+
    '<span>Мин: <b>'+pos.min.toLocaleString('ru-RU')+'</b></span>'+
    '<span>P25: <b>'+pos.p25.toLocaleString('ru-RU')+'</b></span>'+
    '<span class="f-med">Медиана: <b>'+pos.median.toLocaleString('ru-RU')+'</b></span>'+
    '<span>P75: <b>'+pos.p75.toLocaleString('ru-RU')+'</b></span>'+
    '<span>Макс: <b>'+pos.max.toLocaleString('ru-RU')+'</b></span>'+
  '</div>';
}

/** Полная карточка вилки (для топ-8). */
function salForkCard(pos, idx){
  var minVal = pos.min || 0;
  var maxVal = Math.max(pos.max || 1, minVal + 1);
  var range = maxVal - minVal;
  var p25Pct = range > 0 ? Math.max(0, Math.min(100, Math.round(((pos.p25 - minVal) / range) * 100))) : 0;
  var p75Pct = range > 0 ? Math.max(0, Math.min(100, Math.round(((pos.p75 - minVal) / range) * 100))) : 100;
  var medPct = range > 0 ? Math.max(0, Math.min(100, Math.round(((pos.median - minVal) / range) * 100))) : 50;
  var wPct = Math.max(p75Pct - p25Pct, 4);
  var bodyId = 'posBody_' + idx;

  var forkVisual = pos.min > 0
    ? salForkNums(pos)+
      '<div class="fork-track-wrap">'+
        '<div class="fork-track-p25-p75" style="left:'+p25Pct+'%;width:'+wPct+'%"></div>'+
        '<div class="fork-track-med" style="left:'+medPct+'%"></div>'+
      '</div>'
    : '<div style="font-size:13.5px;color:var(--muted);margin:6px 0">Нет числовых данных по окладу</div>';

  return '<div class="fork-box" id="posCard_'+idx+'">'+
    '<div class="fork-hd" onclick="togglePosBody(\''+bodyId+'\')">'+
      '<div class="fork-pos">'+esc(pos.pos)+'</div>'+
      '<div class="fork-cnt">'+pos.count+' '+declOfNum(pos.count, ['запись','записи','записей'])+'</div>'+
      (pos.forkSpreadPct ? '<div class="pill p-mid">размах +'+pos.forkSpreadPct+'%</div>' : '')+
      '<div style="font-size:18px;color:var(--muted)">▾</div>'+
    '</div>'+
    forkVisual +
    '<div id="'+bodyId+'" class="fork-body hidden">'+salCoTable(pos)+'</div>'+
  '</div>';
}

function toggleSalRow(tr){
  var next = tr.nextElementSibling;
  if(next && next.classList.contains('sal-detail')) next.classList.toggle('hidden');
}

/**
 * Вкладка «Зарплатные вилки» — топ-8 самых заполненных должностей полными
 * карточками (медиана + коридор P25–P75 + компании по клику), ниже — таблица
 * по ВСЕМ должностям: строка на должность, сортировка по колонкам, полоса
 * «коридор рынка» на общей шкале. Клик по строке разворачивает те же
 * Мин/Макс и таблицу компаний. Только фронт: данные и API не трогаем.
 */
/**
 * turn-18b — гистограмма распределения окладов по всей выборке: один график
 * на «какая типичная вилка», без разбивки по должностям. Строится из средних
 * окладов по компаниям (positions[].companies[].avg), которые уже приходят с
 * дашборда — данные и API не трогаем.
 */
function salHistogram(positions){
  var vals = [];
  positions.forEach(function(p){
    (p.companies || []).forEach(function(c){
      var v = Number(c.avg) || 0;
      // < 100 — это часовые/дневные ставки и опечатки, в месячную гистограмму
      // они не идут (иначе весь график сжимается к нулю).
      if(v >= 100) vals.push(v);
    });
  });
  if(vals.length < 5) return '';

  vals.sort(function(a, b){ return a - b; });
  // Обрезаем верхний хвост по 95-му перцентилю, чтобы единичные высокие оклады
  // не растягивали шкалу и не превращали основную массу в один столбик.
  var lo = vals[0];
  var hi = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.95))];
  if(hi <= lo) hi = vals[vals.length - 1];
  if(hi <= lo) return '';

  var BANDS = 7;
  var step = (hi - lo) / BANDS;
  var buckets = new Array(BANDS).fill(0);
  vals.forEach(function(v){
    var i = Math.min(BANDS - 1, Math.floor((v - lo) / step));
    buckets[i]++;
  });
  var peak = Math.max.apply(null, buckets);
  var modalIdx = buckets.indexOf(peak);
  var median = vals[Math.floor(vals.length / 2)];

  var fmtM = function(n){
    if(n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if(n >= 1e3) return Math.round(n / 1e3) + 'K';
    return String(Math.round(n));
  };

  // Палитра столбцов — последовательный переход в пределах фирменной сине-
  // индиговой гаммы сайта: светлее у низких окладов, глубже у высоких.
  var HIST_RAMP = ['#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#4f46e5', '#4338ca'];
  var bars = buckets.map(function(cnt, i){
    var pct = peak ? Math.round(cnt / peak * 100) : 0;
    var bandLo = lo + step * i;
    var title = fmtM(bandLo) + '–' + fmtM(bandLo + step) + ': ' + cnt + ' ' + declOfNum(cnt, ['запись','записи','записей']);
    var col = HIST_RAMP[Math.min(HIST_RAMP.length - 1, Math.round(i / (BANDS - 1) * (HIST_RAMP.length - 1)))];
    return '<div class="sal-hist-col'+(i === modalIdx ? ' is-modal' : '')+'" title="'+esc(title)+'">'+
      '<div class="sal-hist-bar" style="height:'+Math.max(pct, 3)+'%;background:'+col+'"></div>'+
    '</div>';
  }).join('');

  var ticks = '';
  for(var t = 0; t <= BANDS; t += Math.ceil(BANDS / 4)){
    ticks += '<span>'+fmtM(lo + step * t)+'</span>';
  }

  return '<div class="sal-hist card">'+
    '<div class="sal-hist-hd">'+
      '<b>Распределение окладов</b>'+
      '<span>'+vals.length+' '+declOfNum(vals.length, ['запись','записи','записей'])+' по '+positions.length+' '+declOfNum(positions.length, ['должности','должностям','должностям'])+'</span>'+
    '</div>'+
    '<div class="sal-hist-plot">'+bars+'</div>'+
    '<div class="sal-hist-axis">'+ticks+'</div>'+
    '<div class="sal-hist-stats">'+
      '<div><i>Медиана</i><b>'+fmtM(median)+'</b></div>'+
      '<div><i>Чаще всего</i><b>'+fmtM(lo + step * modalIdx)+'–'+fmtM(lo + step * (modalIdx + 1))+'</b></div>'+
    '</div>'+
  '</div>';
}

// ═══ Вкладка «Обзор» — один экран без таблиц: распределение, ключевые
// должности, топ компаний. Таблицы живут на «Вилках» и «Реестре». ═══

// Кольцевая (donut) диаграмма из сегментов-долек. Сегменты «вырастают» при
// появлении и выпирают наружу при наведении (как разрезанный кусок пирога).
var DONUT_PALETTE = ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#a5b4fc', '#c7d2fe', '#cbd5e1'];

function donutChart(items){
  var total = items.reduce(function(s, it){ return s + it.value; }, 0) || 1;
  var C = 90, R = 80, RIN = 44, PUSH = 11;
  var ang = -Math.PI / 2;
  var pt = function(rad, a){ return (C + rad * Math.cos(a)).toFixed(2) + ' ' + (C + rad * Math.sin(a)).toFixed(2); };
  var segs = items.map(function(it, i){
    var frac = it.value / total;
    var a0 = ang, a1 = ang + Math.max(frac, 0.0001) * Math.PI * 2;
    ang = a1;
    var mid = (a0 + a1) / 2;
    var big = (a1 - a0) > Math.PI ? 1 : 0;
    var d = 'M ' + pt(R, a0) + ' A ' + R + ' ' + R + ' 0 ' + big + ' 1 ' + pt(R, a1) +
            ' L ' + pt(RIN, a1) + ' A ' + RIN + ' ' + RIN + ' 0 ' + big + ' 0 ' + pt(RIN, a0) + ' Z';
    return '<path class="donut-seg" d="' + d + '" fill="' + it.color + '" ' +
      'style="--dx:' + (Math.cos(mid) * PUSH).toFixed(2) + 'px;--dy:' + (Math.sin(mid) * PUSH).toFixed(2) + 'px;' +
      'animation-delay:' + (0.05 + i * 0.09).toFixed(2) + 's">' +
      '<title>' + esc(it.label) + ': ' + it.value + ' (' + Math.round(frac * 100) + '%)</title></path>';
  }).join('');
  return '<svg class="donut" viewBox="0 0 180 180" width="150" height="150" aria-hidden="true">' + segs +
    '<text x="90" y="88" text-anchor="middle" class="donut-c-num">' + total + '</text>' +
    '<text x="90" y="104" text-anchor="middle" class="donut-c-lbl">записей</text>' +
  '</svg>';
}

function overviewBarRow(name, right, pct, color){
  return '<div class="ov-row" style="display:grid;grid-template-columns:1fr auto;gap:3px 12px;align-items:center;'+
      'padding:9px 4px;border-bottom:1px solid var(--line)">'+
    '<div style="font-weight:700;font-size:13.5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(name)+'</div>'+
    '<div style="font-size:13px;font-weight:700;color:var(--muted);white-space:nowrap">'+right+'</div>'+
    '<div class="ov-track" style="grid-column:1/-1;height:6px;border-radius:4px;background:var(--card-2)">'+
      '<div class="ov-fill" style="height:100%;border-radius:4px;width:'+Math.max(2, Math.min(100, pct))+'%;background:'+(color||'var(--accent)')+'"></div>'+
    '</div>'+
  '</div>';
}

function renderOverviewTab(d){
  d = d || {};
  var sm = d.summary || {};
  var positions = (d.positions || []).filter(function(p){ return !/^\(не сопоставлено\)$/i.test((p.pos || '').trim()); });
  var comps = d.topCompetitors || [];

  if(!positions.length && !comps.length){
    return '<div class="empty">Нет данных за выбранный период</div>';
  }

  var cardHd = function(title, hint){
    return '<div class="card-hd">'+
      '<b>'+esc(title)+'</b>'+
      (hint ? '<span class="card-hd-hint">'+esc(hint)+'</span>' : '')+
    '</div>';
  };

  var h = '<div class="dash-tab-scroll">';

  // 1. Распределение окладов — salHistogram уже возвращает самодостаточную
  //    карточку с заголовком, второй раз в .card не оборачиваем.
  var hist = salHistogram(positions);
  if(hist){
    h += '<div style="margin-bottom:12px">'+hist+'</div>';
  }

  // 2. Панели-списки — все сразу, ничего не пропадает при заполнении окладов
  //    Фаровона. Сетка сама раскладывает в 1–3 колонки по ширине экрана.
  var withGap = positions.filter(function(p){ return p.gapPct != null; });
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;align-items:start">';

  // 2·0. Кольцевая диаграмма — записи по направлениям (топ-6 + прочие)
  var dirTally = {};
  (d.rows || []).forEach(function(r){ var k = (r.dir || '').trim() || 'Не указано'; dirTally[k] = (dirTally[k] || 0) + 1; });
  var dirArr = Object.keys(dirTally).map(function(k){ return { label: k, value: dirTally[k] }; })
    .sort(function(a, b){ return b.value - a.value; });
  if(dirArr.length){
    var donutItems = dirArr.slice(0, 6).map(function(it, i){ return { label: it.label, value: it.value, color: DONUT_PALETTE[i] }; });
    var restSum = dirArr.slice(6).reduce(function(s, it){ return s + it.value; }, 0);
    if(restSum) donutItems.push({ label: 'Прочие (' + (dirArr.length - 6) + ')', value: restSum, color: DONUT_PALETTE[6] });
    h += '<div class="card" style="padding:0;overflow:hidden">'+
      cardHd('Записи по направлениям', dirArr.length + ' ' + declOfNum(dirArr.length, ['направление','направления','направлений']))+
      '<div style="display:flex;gap:12px;align-items:center;padding:12px 14px;flex-wrap:wrap">'+
        donutChart(donutItems)+
        '<div style="flex:1;min-width:130px;font-size:12.5px;font-weight:600">'+
          donutItems.map(function(it){
            return '<div style="display:flex;align-items:center;gap:7px;padding:3px 0">'+
              '<span style="width:10px;height:10px;border-radius:3px;flex:none;background:'+it.color+'"></span>'+
              '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(it.label)+'">'+esc(regDirShort(it.label))+'</span>'+
              '<b>'+it.value+'</b></div>';
          }).join('')+
        '</div>'+
      '</div>'+
    '</div>';
  }

  // 2a. Самые массовые должности — всегда
  var byCount = positions.slice().sort(function(a, b){ return (b.count || 0) - (a.count || 0); }).slice(0, 6);
  var maxC = byCount.length ? (byCount[0].count || 1) : 1;
  h += '<div class="card" style="padding:0;overflow:hidden">'+
    cardHd('Самые массовые должности', 'по числу записей')+
    '<div style="padding:2px 12px 6px">';
  byCount.forEach(function(p){
    h += overviewBarRow(p.pos,
      p.count + ' зап.' + (p.median ? ' · мед ' + p.median.toLocaleString('ru-RU') : ''),
      Math.round((p.count || 0) / maxC * 100));
  });
  h += '</div></div>';

  // 2b. Где мы отстаём от рынка — когда заданы оклады Фаровона (иначе подсказка)
  h += '<div class="card" style="padding:0;overflow:hidden">'+
    cardHd('Гэп к рынку', withGap.length ? 'оклад Фаровона vs медиана' : 'нужны оклады Фаровона')+
    '<div style="padding:2px 12px 6px">';
  if(withGap.length){
    withGap.slice().sort(function(a, b){ return a.gapPct - b.gapPct; }).slice(0, 6).forEach(function(p){
      var behind = p.gapPct < 0;
      h += overviewBarRow(p.pos,
        '<span style="color:'+(behind ? 'var(--no)' : 'var(--ok)')+'">'+(behind ? '−' : '+')+Math.abs(p.gapPct)+'%</span> · мед '+p.median.toLocaleString('ru-RU'),
        Math.min(100, Math.abs(p.gapPct) * 2.5), behind ? 'var(--no)' : 'var(--ok)');
    });
  } else {
    h += '<div style="font-size:12.5px;color:var(--muted);padding:10px 2px;line-height:1.45">'+
      'Заполните оклады Фаровона по должностям: Справочники → Должности. Тогда здесь будет отставание/опережение к медиане рынка.</div>';
  }
  h += '</div></div>';

  // 2c. Топ компаний-источников — всегда
  if(comps.length){
    var maxCo = comps[0].count || 1;
    h += '<div class="card" style="padding:0;overflow:hidden">'+
      cardHd('Топ компаний-источников', 'по числу записей')+
      '<div style="padding:2px 12px 6px">';
    comps.slice(0, 6).forEach(function(c){
      h += overviewBarRow(c.company, c.count + ' зап.', Math.round((c.count || 0) / maxCo * 100));
    });
    h += '</div></div>';
  }

  // 2d. Мультиисточниковый бенчмаркинг (B1, Antal, Job Farovon, внутренний сбор)
  h += '<div class="card" style="padding:0;overflow:hidden">'+
    cardHd('Внешний бенчмаркинг', 'B1, Antal, Job Farovon')+
    '<div style="padding:12px 14px">'+
      '<div style="font-size:13.5px;color:var(--muted);line-height:1.45;margin-bottom:10px">'+
        'Мультиисточниковое сопоставление вилок Фаровона с рыночными перцентилями P25–P75 и сводной медианой.'+
      '</div>'+
      '<button class="btn-line bmk-goto" onclick="openBenchmarks()">'+
        ic('chart', 14)+' Перейти к бенчмаркингу →'+
      '</button>'+
    '</div></div>';

  h += '</div>'; // конец grid-ряда

  h += '</div>'; // конец обёртки вкладки
  return h;
}

function renderSalariesTab(positions){
  if(!positions.length){
    return '<div class="empty">По заданным условиям должностей не найдено</div>';
  }

  var sort = S.dashSalSort || { key: 'count', dir: 'desc' };
  var sorted = positions.slice().sort(function(a, b){
    if(sort.key === 'pos'){
      var an = (a.pos || '').toLowerCase(), bn = (b.pos || '').toLowerCase();
      var c = an < bn ? -1 : an > bn ? 1 : 0;
      return sort.dir === 'asc' ? c : -c;
    }
    var av = a[sort.key] || 0, bv = b[sort.key] || 0;
    return sort.dir === 'asc' ? av - bv : bv - av;
  });

  // «(не сопоставлено)» — не должность, а нераспределённые записи после импорта.
  // В вилках не участвуют: показываем баннером-ссылкой в реестр.
  var isUnmapped = function(p){ return /^\(не сопоставлено\)$/i.test((p.pos || '').trim()); };
  var unmappedCnt = positions.filter(isUnmapped).reduce(function(s, p){ return s + (p.count || 0); }, 0);
  var real = positions.filter(function(p){ return !isUnmapped(p); });
  sorted = sorted.filter(function(p){ return !isUnmapped(p); });

  // Общая шкала «коридора рынка»: от минимума мин-границ до максимума макс-границ
  // всех должностей с числами, с небольшим запасом по краям.
  var withData = real.filter(function(p){ return p.min > 0; });
  var scaleLo = withData.length ? Math.min.apply(null, withData.map(function(p){ return p.min; })) : 0;
  var scaleHi = withData.length ? Math.max.apply(null, withData.map(function(p){ return p.max; })) : 1;
  var pad = Math.round((scaleHi - scaleLo) * 0.04);
  scaleLo = Math.max(0, scaleLo - pad);
  scaleHi = scaleHi + pad;
  var scaleRange = Math.max(scaleHi - scaleLo, 1);
  var pcOf = function(v){ return Math.max(0, Math.min(100, (v - scaleLo) / scaleRange * 100)); };
  var fmtK = function(n){ return n >= 1000 ? Math.round(n / 1000) + 'k' : String(Math.round(n)); };

  var h = '<div class="dash-tab-scroll">';

  if(unmappedCnt > 0){
    h += '<div class="sal-unmapped-banner">'+ic('warn', 15)+
      '<span><b>'+unmappedCnt+'</b> '+declOfNum(unmappedCnt, ['запись','записи','записей'])+
      ' без сопоставленной должности — в вилки не входят</span>'+
      '<button class="btn-line" id="salToReg" style="margin-left:auto;min-height:30px;padding:0 12px;font-size:13px;white-space:nowrap">Открыть в реестре</button>'+
    '</div>';
  }

  // Гистограмма переехала на вкладку «Обзор» — здесь только таблица вилок.

  // turn-18c: список должностей сворачивается до 5 самых заполненных, остальные
  // прячутся за «Показать ещё N» — без потери данных; поиск открывает любую
  // должность, не разворачивая весь список.
  var salQ = (S.dashSalSearch || '').trim().toLowerCase();
  var salShowAll = !!S.dashSalShowAll || !!salQ;
  var SAL_LIMIT = 5;
  var salFiltered = sorted.filter(function(p){ return !salQ || (p.pos || '').toLowerCase().indexOf(salQ) >= 0; });
  var salMatchTotal = salFiltered.length;
  var salHidden = 0;
  if(!salShowAll && salFiltered.length > SAL_LIMIT){
    salHidden = salFiltered.length - SAL_LIMIT;
    salFiltered = salFiltered.slice(0, SAL_LIMIT);
  }

  var ourFilled = real.filter(function(p){ return p.ourMid > 0; }).length;

  h += '<div class="dash-sec-head">'+
    '<b>Зарплатные вилки по должностям <span class="dash-sec-n">'+(salQ ? salMatchTotal + ' из ' + real.length : real.length)+'</span></b>'+
    '<span class="search-wrap dash-sec-search">'+icBare('search', 14)+
      '<input id="salSearch" placeholder="Найти должность…" value="'+esc(S.dashSalSearch || '')+'"></span>'+
  '</div>';

  h += '<div class="dash-legend">'+
    '<span><span class="rbar-lg-cor"></span> коридор P25–P75</span>'+
    '<span><span class="rbar-lg-med"></span> медиана рынка</span>'+
    '<span><span class="rbar-lg-our"></span> оклад Фаровона</span>'+
    (ourFilled === 0 ? '<span class="dash-legend-warn">Оклады Фаровона не заданы — Справочники → Должности</span>' : '')+
  '</div>';

  function arrow(k){ return sort.key === k ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''; }

  h += '<div class="tblwrap rtbl"><table class="co-tbl co-tbl--pin sal-tbl"><thead><tr>'+
      '<th data-sort="pos">Должность'+arrow('pos')+'</th>'+
      '<th class="num" data-sort="count">N'+arrow('count')+'</th>'+
      '<th class="num" data-sort="p25">P25'+arrow('p25')+'</th>'+
      '<th class="num" data-sort="median">Медиана'+arrow('median')+'</th>'+
      '<th class="num" data-sort="p75">P75'+arrow('p75')+'</th>'+
      '<th class="num" data-sort="ourMid">Мы'+arrow('ourMid')+'</th>'+
      '<th class="num" data-sort="gapPct">Гэп'+arrow('gapPct')+'</th>'+
      '<th style="min-width:200px">Коридор рынка · '+fmtK(scaleLo)+'–'+fmtK(scaleHi)+' c</th>'+
    '</tr></thead><tbody>';

  salFiltered.forEach(function(p){
    var has = p.min > 0;
    var hasOur = p.ourMid > 0;
    var bar;
    if(has){
      var wl = pcOf(p.min), wr = 100 - pcOf(p.max);
      var cl = pcOf(p.p25), cw = Math.max(2, pcOf(p.p75) - pcOf(p.p25));
      var md = pcOf(p.median);
      bar = '<div class="rbar">'+
        '<div class="rbar-whisk" style="left:'+wl.toFixed(1)+'%;right:'+wr.toFixed(1)+'%"></div>'+
        '<div class="rbar-cor" style="left:'+cl.toFixed(1)+'%;width:'+cw.toFixed(1)+'%"></div>'+
        '<div class="rbar-med" style="left:'+md.toFixed(1)+'%"></div>'+
        (hasOur ? '<div class="rbar-our" style="left:'+pcOf(p.ourMid).toFixed(1)+'%" title="Фаровон: '+p.ourMid.toLocaleString('ru-RU')+'"></div>' : '')+
      '</div>';
    } else {
      bar = '<span style="color:var(--muted);font-size:13px">нет числовых данных</span>';
    }
    var gapCell = (p.gapPct == null)
      ? '<span style="color:var(--muted)">—</span>'
      : '<b style="color:'+(p.gapPct < 0 ? 'var(--no)' : 'var(--ok)')+'">'+
          (p.gapPct < 0 ? '−' : '+')+Math.abs(p.gapPct)+'%</b>';
    h += '<tr class="sal-row" onclick="toggleSalRow(this)">'+
      '<td><b>'+esc(p.pos)+'</b></td>'+
      '<td class="num">'+p.count+'</td>'+
      '<td class="num">'+(has ? p.p25.toLocaleString('ru-RU') : '—')+'</td>'+
      '<td class="num"><b>'+(has ? p.median.toLocaleString('ru-RU') : '—')+'</b></td>'+
      '<td class="num">'+(has ? p.p75.toLocaleString('ru-RU') : '—')+'</td>'+
      '<td class="num">'+(hasOur ? p.ourMid.toLocaleString('ru-RU') : '<span style="color:var(--muted)">—</span>')+'</td>'+
      '<td class="num">'+gapCell+'</td>'+
      '<td>'+bar+'</td>'+
    '</tr>'+
    '<tr class="sal-detail hidden"><td colspan="8">'+
      (has ? salForkNums(p) : '')+
      (hasOur ? '<div style="font-size:13px;margin:6px 0;color:var(--muted)">Оклад Фаровона по этой должности: <b>'+
        (p.ourFrom ? p.ourFrom.toLocaleString('ru-RU') : '—')+' – '+(p.ourTo ? p.ourTo.toLocaleString('ru-RU') : '—')+' c</b>'+
        (p.gapPct != null ? ' · гэп к медиане рынка: <b style="color:'+(p.gapPct < 0 ? 'var(--no)' : 'var(--ok)')+'">'+(p.gapPct < 0 ? '−' : '+')+Math.abs(p.gapPct)+'%</b>' : '')+
      '</div>' : '')+
      posVarSummary(p)+
      salCoTable(p)+
    '</td></tr>';
  });

  h += '</tbody></table></div>';

  if(salHidden > 0){
    h += '<button class="btn-line" id="salShowAll" style="width:100%;margin-top:8px">Показать ещё '+salHidden+' '+declOfNum(salHidden, ['должность','должности','должностей'])+'</button>';
  } else if(salShowAll && !salQ && real.length > SAL_LIMIT){
    h += '<button class="btn-line" id="salCollapse" style="width:100%;margin-top:8px">Свернуть до топ-'+SAL_LIMIT+'</button>';
  }

  h += '<div class="rcards">' + salFiltered.map(function(p){
    var has = p.min > 0;
    var nm = esc(p.pos);
    var gap = (p.gapPct == null) ? ''
      : ' · <b style="color:'+(p.gapPct < 0 ? 'var(--no)' : 'var(--ok)')+'">гэп '+(p.gapPct < 0 ? '−' : '+')+Math.abs(p.gapPct)+'%</b>';
    return '<div class="rcard">'+
      '<div class="rcard-hd"><b class="rcard-title" title="'+nm+'">'+nm+'</b>'+
        '<span class="pill p-mid">'+p.count+' зап.</span></div>'+
      '<div class="rcard-meta">'+(has
        ? 'P25 '+p.p25.toLocaleString('ru-RU')+' · Медиана <b style="color:var(--text)">'+p.median.toLocaleString('ru-RU')+
          '</b> · P75 '+p.p75.toLocaleString('ru-RU')+
          (p.ourMid ? ' · мы '+p.ourMid.toLocaleString('ru-RU') : '')+gap
        : 'нет числовых данных по окладу')+'</div>'+
    '</div>';
  }).join('') + '</div>';

  h += '</div>';

  setTimeout(function(){
    var box = $('dashTabContent');
    if(!box) return;
    box.querySelectorAll('.sal-tbl th[data-sort]').forEach(function(th){
      th.onclick = function(){
        var k = this.dataset.sort;
        var cur = S.dashSalSort || { key: 'count', dir: 'desc' };
        if(cur.key === k){ cur.dir = cur.dir === 'asc' ? 'desc' : 'asc'; }
        else { cur.key = k; cur.dir = (k === 'pos') ? 'asc' : 'desc'; }
        S.dashSalSort = cur;
        box.innerHTML = renderSalariesTab((S.dashData && S.dashData.positions) || []);
      };
    });

    var reRender = function(){ box.innerHTML = renderSalariesTab((S.dashData && S.dashData.positions) || []); };

    var toReg = box.querySelector('#salToReg');
    if(toReg){
      toReg.onclick = function(){
        S.dashTab = 'registry';
        S.dashRegUnmapped = true;
        S.dashRegPage = 1;
        var btn = document.querySelector('button[data-dtab="registry"]');
        if(btn){ btn.click(); }
        else { box.innerHTML = renderRegistryTab((S.dashData && S.dashData.rows) || []); }
      };
    }

    var salInput = box.querySelector('#salSearch');
    if(salInput){
      salInput.oninput = function(){
        var pos = this.selectionStart;
        S.dashSalSearch = this.value;
        S.dashSalShowAll = false;
        reRender();
        var again = box.querySelector('#salSearch');
        if(again){ again.focus(); try{ again.setSelectionRange(pos, pos); }catch(e){} }
      };
    }
    var salMore = box.querySelector('#salShowAll');
    if(salMore) salMore.onclick = function(){ S.dashSalShowAll = true; reRender(); };
    var salLess = box.querySelector('#salCollapse');
    if(salLess) salLess.onclick = function(){ S.dashSalShowAll = false; reRender(); };
  }, 30);

  return h;
}

function togglePosBody(id){
  var el = $(id);
  if(el) el.classList.toggle('hidden');
}

// ═══ Вкладка «Реестр данных» — все собранные наблюдения одной таблицей ═══
// Данные: d.rows из аналитики (analyticsService добавляет сырые строки surveys
// с направлением, регионом и сырым ID_Бизнес). Фильтры направления/HR BP/поиска
// применяются на сервере; здесь — локальный поиск, флажок «несопоставленные» и
// пагинация. Клик по строке открывает карточку наблюдения по центру.
var REG_PER_PAGE = 50;

function regDirShort(s){
  return String(s || '—')
    .replace('Департамент ', 'Деп. ')
    .replace('Дивизион ', 'Див. ')
    .replace('Обзор рынка — не распределено', 'не распределено');
}
function regDate(iso){
  var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? (m[3] + '.' + m[2] + '.' + m[1]) : (iso || '—');
}
function regIsUnmapped(r){
  var p = (r.posOur || '').trim();
  return !p || p === '(не сопоставлено)';
}
function regIsHourly(r){
  return /час/i.test(r.payPer || '') || (r.payFrom > 0 && r.payFrom < 100);
}
function regPerLabel(r){
  var p = String(r.payPer || 'в месяц').toLowerCase();
  var short = /час/.test(p) ? 'час' : (/дн|день/.test(p) ? 'день' : (/год/.test(p) ? 'год' : 'мес'));
  return (r.cur || 'сомони') + ' / ' + short;
}

function renderRegistryTab(rows){
  S.dashRegPage = S.dashRegPage || 1;
  S.dashRegSearch = S.dashRegSearch || '';
  S.dashRegUnmapped = !!S.dashRegUnmapped;

  var q = S.dashRegSearch.trim().toLowerCase();
  var filtered = rows.filter(function(r){
    if(S.dashRegUnmapped && !regIsUnmapped(r)) return false;
    if(!q) return true;
    return [r.company, r.posOur, r.posTheir, r.by, r.dir, r.region]
      .some(function(x){ return String(x || '').toLowerCase().indexOf(q) >= 0; });
  });

  var unmappedTotal = rows.filter(regIsUnmapped).length;
  var totalPages = Math.max(1, Math.ceil(filtered.length / REG_PER_PAGE));
  if(S.dashRegPage > totalPages) S.dashRegPage = totalPages;
  var pg = S.dashRegPage;
  var pageRows = filtered.slice((pg - 1) * REG_PER_PAGE, pg * REG_PER_PAGE);

  var h = '<div class="dash-tab-scroll">';

  // Панель фильтров
  h += '<div class="toolbar" style="margin-bottom:8px;gap:6px;display:flex;align-items:center;flex-wrap:wrap">'+
    '<div class="search-wrap" style="flex:1 1 220px;min-width:180px;max-width:320px">'+icBare('search')+
      '<input id="regSearch" placeholder="Поиск: компания, должность, кто собрал…" value="'+esc(S.dashRegSearch)+'"></div>'+
    '<button id="regUnmap" class="btn-line" style="min-height:32px;font-size:13.5px;padding:0 12px;white-space:nowrap'+
      (S.dashRegUnmapped ? ';border-color:var(--accent);color:var(--accent);background:var(--accent-soft)' : '')+'">'+
      ic('warn', 14)+'Только несопоставленные ('+unmappedTotal+')</button>'+
    tblCount(filtered.length, rows.length, ['запись', 'записи', 'записей'])+
  '</div>';

  // Таблица (широкая) — на ≤560px скрывается, ниже показывается карточный список
  h += '<div class="tblwrap rtbl" style="overflow-x:auto"><table class="co-tbl co-tbl--pin" style="min-width:1040px"><thead><tr>'+
      '<th>Дата</th><th>Направление</th><th>Компания</th><th>Регион</th>'+
      '<th>Наша должность</th><th>Должность у них</th>'+
      '<th class="num">Оклад от</th><th class="num">Оклад до</th>'+
      '<th>Вал. / период</th><th>Переменная часть</th><th>Льготы</th><th></th>'+
    '</tr></thead><tbody>';

  if(!pageRows.length){
    h += '<tr><td colspan="12"><div class="empty" style="padding:24px 12px">Ничего не найдено</div></td></tr>';
  }

  pageRows.forEach(function(r){
    var idx = rows.indexOf(r);
    var hourly = regIsHourly(r);
    var per = regPerLabel(r);
    var payFromCell = hourly
      ? '<span class="pill p-mid" style="font-size:11.5px">'+esc(String(r.payFrom))+'</span>'
      : (r.payFrom ? Number(r.payFrom).toLocaleString('ru-RU') : '—');
    var ourCell = regIsUnmapped(r)
      ? '<span class="pill p-mid" style="font-size:11.5px">не сопоставлено</span>'
      : esc(r.posOur);
    var benN = (r.benefits || []).length;
    h += '<tr class="reg-row" data-reg="'+idx+'">'+
      '<td><span style="white-space:nowrap;color:var(--muted)">'+regDate(r.date)+'</span></td>'+
      '<td><span style="white-space:nowrap" title="'+esc(r.dir || '')+'">'+esc(regDirShort(r.dir))+'</span></td>'+
      '<td><b>'+esc(r.company || '—')+'</b></td>'+
      '<td>'+esc(r.region || '—')+'</td>'+
      '<td>'+ourCell+'</td>'+
      '<td>'+esc(r.posTheir || '—')+'</td>'+
      '<td class="num">'+payFromCell+'</td>'+
      '<td class="num">'+(r.payTo ? Number(r.payTo).toLocaleString('ru-RU') : '—')+'</td>'+
      '<td><span style="white-space:nowrap">'+esc(per)+'</span></td>'+
      '<td>'+regVarPayCell(r)+'</td>'+
      '<td>'+(benN ? '<span class="pill p-ok" style="font-size:11.5px">'+benN+'</span>' : '<span style="color:var(--muted)">—</span>')+'</td>'+
      '<td><span class="btn-link" style="font-size:12.5px;white-space:nowrap;color:var(--accent);cursor:pointer">открыть ›</span></td>'+
    '</tr>';
  });

  h += '</tbody></table></div>';

  // Карточный список для узких экранов (≤560px, парный к .rtbl выше)
  h += '<div class="rcards">';
  if(!pageRows.length){
    h += '<div class="empty" style="padding:24px 12px">Ничего не найдено</div>';
  }
  pageRows.forEach(function(r){
    var idx = rows.indexOf(r);
    var hourly = regIsHourly(r);
    var pay = (r.payFrom && r.payTo && r.payFrom !== r.payTo)
      ? Number(r.payFrom).toLocaleString('ru-RU') + ' – ' + Number(r.payTo).toLocaleString('ru-RU')
      : (r.payFrom ? Number(r.payFrom).toLocaleString('ru-RU') : (r.payTo ? Number(r.payTo).toLocaleString('ru-RU') : '—'));
    var benN = (r.benefits || []).length;
    h += '<div class="rcard reg-row" data-reg="'+idx+'" style="cursor:pointer">'+
      '<div class="rcard-hd">'+
        '<b class="rcard-title" title="'+esc(r.company || '')+'">'+esc(r.company || '—')+'</b>'+
        '<span class="pill '+(hourly?'p-mid':'p-ok')+'" style="font-size:11.5px">'+esc(pay)+' '+esc(regPerLabel(r).split(' / ')[1] || '')+'</span>'+
      '</div>'+
      '<div class="rcard-meta">'+
        (regIsUnmapped(r)
          ? '<span class="pill p-mid" style="font-size:11px">не сопоставлено</span> '
          : '<b style="color:var(--text)">'+esc(r.posOur)+'</b> ')+
        '← '+esc(r.posTheir || '—')+
      '</div>'+
      '<div class="rcard-meta" style="margin-top:2px">'+
        esc(regDirShort(r.dir))+' · '+esc(r.region || '—')+' · '+regDate(r.date)+
        (benN ? ' · льгот: '+benN : '')+
        ((r.varPay && r.varPay.label) ? ' · ' + esc(r.varPay.label) : '')+
      '</div>'+
    '</div>';
  });
  h += '</div>';

  // Пагинация
  if(totalPages > 1){
    h += '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:8px;flex-wrap:wrap">'+
      '<span style="font-size:13px;color:var(--muted)">'+
        ((pg - 1) * REG_PER_PAGE + 1)+'–'+Math.min(pg * REG_PER_PAGE, filtered.length)+' из '+filtered.length+
      '</span>'+
      '<div style="display:flex;gap:4px">'+
        '<button class="btn-line" id="regPrev" style="min-height:30px;padding:0 10px;font-size:13px"'+(pg <= 1 ? ' disabled' : '')+'>‹ Назад</button>'+
        '<span style="font-size:13px;color:var(--muted);align-self:center;padding:0 6px">стр. '+pg+' / '+totalPages+'</span>'+
        '<button class="btn-line" id="regNext" style="min-height:30px;padding:0 10px;font-size:13px"'+(pg >= totalPages ? ' disabled' : '')+'>Вперёд ›</button>'+
      '</div>'+
    '</div>';
  }

  h += '</div>';

  setTimeout(function(){
    var box = $('dashTabContent');
    if(!box) return;
    var reRender = function(){ box.innerHTML = renderRegistryTab((S.dashData && S.dashData.rows) || []); };

    var s = box.querySelector('#regSearch');
    if(s){
      var t = null;
      s.oninput = function(){
        var pos = this.selectionStart;
        clearTimeout(t);
        t = setTimeout(function(){
          S.dashRegSearch = s.value;
          S.dashRegPage = 1;
          reRender();
          var again = box.querySelector('#regSearch');
          if(again){ again.focus(); try{ again.setSelectionRange(pos, pos); }catch(e){} }
        }, 200);
      };
    }
    var u = box.querySelector('#regUnmap');
    if(u) u.onclick = function(){ S.dashRegUnmapped = !S.dashRegUnmapped; S.dashRegPage = 1; reRender(); };

    var pv = box.querySelector('#regPrev');
    if(pv) pv.onclick = function(){ if(S.dashRegPage > 1){ S.dashRegPage--; reRender(); } };
    var nx = box.querySelector('#regNext');
    if(nx) nx.onclick = function(){ S.dashRegPage++; reRender(); };

    box.querySelectorAll('.reg-row[data-reg]').forEach(function(row){
      row.onclick = function(){
        var list = (S.dashData && S.dashData.rows) || [];
        var rec = list[+this.dataset.reg];
        if(rec) openSurveyRecModal(rec);
      };
    });
  }, 30);

  return h;
}

// Карточка одного наблюдения — модальное окно по центру экрана.
function openSurveyRecModal(r){
  var per = regPerLabel(r);
  var pay = (r.payFrom && r.payTo && r.payFrom !== r.payTo)
    ? Number(r.payFrom).toLocaleString('ru-RU') + ' – ' + Number(r.payTo).toLocaleString('ru-RU')
    : (r.payFrom ? Number(r.payFrom).toLocaleString('ru-RU') : (r.payTo ? Number(r.payTo).toLocaleString('ru-RU') : '—'));
  var bonRows = (Array.isArray(r.bonuses) && r.bonuses.length)
    ? r.bonuses
    : ((r.bonHas === 'да' || r.bonSize) ? [{ type: r.bonType, size: r.bonSize, per: r.bonPer }] : []);
  var bonus = bonRows.length
    ? bonRows.map(function(b){
        return esc(b.size || '—') + (b.type ? ' · ' + esc(b.type) : '') + (b.per ? ' · ' + esc(b.per) : '');
      }).join('<br>')
    : '<span style="color:var(--muted)">не указан</span>';
  var chips = (r.benefits || []).length
    ? '<div style="display:flex;flex-wrap:wrap;gap:5px">' + r.benefits.map(function(b){
        return '<span class="pill p-ok" style="font-size:11.5px">'+esc(b)+'</span>';
      }).join('') + '</div>'
    : '<span style="color:var(--muted)">не указаны</span>';
  var ourVal = regIsUnmapped(r)
    ? '<span class="pill p-mid" style="font-size:12px">не сопоставлено</span>'
    : esc(r.posOur);

  function row(dt, dd){
    return '<div style="display:grid;grid-template-columns:130px 1fr;gap:2px 14px;padding:8px 0;border-bottom:1px solid var(--line)">'+
      '<div style="color:var(--muted);font-weight:700;font-size:13px">'+dt+'</div>'+
      '<div style="font-weight:600;font-size:13.5px">'+dd+'</div></div>';
  }

  var el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = '<div class="sheet-in um-modal" style="max-width:560px">'+
    '<div class="sheet-hd"><b>'+esc(r.posTheir || 'Наблюдение')+'</b>'+
      '<button class="btn-ghost" data-x="1">Закрыть</button></div>'+
    '<div style="font-size:13px;color:var(--muted);margin:-6px 0 8px">'+
      esc(r.company || '—')+' · '+esc(r.region || '—')+' · '+regDate(r.date)+'</div>'+
    '<div style="padding:2px 0 4px">'+
      row('Оклад', '<b style="font-size:15px">'+pay+'</b> <span style="font-size:13px;color:var(--muted)">'+esc(per)+'</span>')+
      (regIsHourly(r) ? row('Внимание', '<span style="color:var(--warn)">Часовая ставка — в месячные медианы не входит</span>') : '')+
      row('Наша должность', ourVal)+
      row('Направление', esc(r.dir || '—'))+
      row('Подразделение', esc(r.unit || '—'))+
      (r.idbiz ? row('ID_Бизнес', esc(r.idbiz)) : '')+
      row('Бонус', bonus)+
      row('График работы', r.schedule ? esc(r.schedule) : '<span style="color:var(--muted)">не указан</span>')+
      row('Льготы', chips)+
      row('Источник', esc(r.source || '—'))+
      row('Собрал', esc(r.by || '—'))+
      row('Примечание', r.note ? esc(r.note) : '<span style="color:var(--muted)">—</span>')+
    '</div>'+
  '</div>';
  document.body.appendChild(el);
  guardClose(el, function(){ return false; });
}

/**
 * Счётчик строк над таблицей. Показывается везде, где есть таблица, чтобы
 * было видно, сколько записей всего и сколько осталось после фильтра.
 */
function tblCount(shown, total, words){
  words = words || ['запись', 'записи', 'записей'];
  var filtered = (total != null && total !== shown);
  return '<div class="tbl-count"><b>'+shown+'</b> '+declOfNum(shown, words)+
    (filtered ? '<span class="tbl-count-of">из '+total+'</span>' : '')+'</div>';
}

/**
 * Прогресс по HR BP / дирекциям. Раньше рисовался стопкой блоков .prog-row,
 * у которых не было ни строчки CSS: полосы не появлялись, а два соседних
 * <span> шли инлайн вплотную — «Подразделений: 1 / 23Связей: 14 / 148».
 * Здесь это таблица с закреплённой шапкой и счётчиком строк, как и остальные
 * длинные списки в интерфейсе.
 */
// ─── Вкладка «По регионам»: вилки окладов в разрезе divisions.region ───
// Строки — регионы, метрики те же, что и на «Зарплатных вилках» (месячный
// эквивалент). Данные приходят из regionStats и не зависят от фильтра
// «Регион» (он на этой вкладке скрыт).
function renderRegionsTab(rows){
  if(!rows || !rows.length){
    return '<div class="empty"><b>Разрез по регионам пуст</b><br><br>'+
      'Регион не задан ни у одного подразделения (с данными), либо по ним ещё нет анкет.<br>'+
      'Проставьте регион в Админке → Оргструктура → карточка подразделения.</div>';
  }

  var sort = S.dashRegSort || { key:'median', dir:'desc' };
  var sorted = rows.slice().sort(function(a, b){
    if(sort.key === 'region'){
      var c = (a.region || '').localeCompare(b.region || '', 'ru');
      return sort.dir === 'asc' ? c : -c;
    }
    var av = a[sort.key] || 0, bv = b[sort.key] || 0;
    return sort.dir === 'asc' ? av - bv : bv - av;
  });

  var withData = rows.filter(function(r){ return r.min > 0; });
  var lo = withData.length ? Math.min.apply(null, withData.map(function(r){ return r.min; })) : 0;
  var hi = withData.length ? Math.max.apply(null, withData.map(function(r){ return r.max; })) : 1;
  var pad = Math.round((hi - lo) * 0.04);
  lo = Math.max(0, lo - pad); hi = hi + pad;
  var range = Math.max(hi - lo, 1);
  var pc = function(v){ return Math.max(0, Math.min(100, (v - lo) / range * 100)); };
  var fmtK = function(n){ return n >= 1000 ? Math.round(n / 1000) + 'k' : String(Math.round(n)); };
  var num = function(n){ return n ? Number(n).toLocaleString('ru-RU') : '—'; };
  function arrow(k){ return sort.key === k ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''; }

  var h = '<div class="dash-tab-scroll">';
  h += '<div class="sec-title" style="margin-top:2px">Зарплаты по регионам ('+rows.length+') · месячный эквивалент, сомони</div>';
  h += '<div style="font-size:12.5px;color:var(--muted);margin:2px 2px 8px;display:flex;gap:14px;flex-wrap:wrap">'+
    '<span><span class="rbar-lg-cor"></span> коридор P25–P75</span>'+
    '<span><span class="rbar-lg-med"></span> медиана</span>'+
  '</div>';
  h += '<div class="tblwrap rtbl"><table class="co-tbl co-tbl--pin"><thead><tr>'+
      '<th data-rsort="region">Регион'+arrow('region')+'</th>'+
      '<th class="num" data-rsort="count">N'+arrow('count')+'</th>'+
      '<th class="num" data-rsort="p25">P25'+arrow('p25')+'</th>'+
      '<th class="num" data-rsort="median">Медиана'+arrow('median')+'</th>'+
      '<th class="num" data-rsort="p75">P75'+arrow('p75')+'</th>'+
      '<th class="num" data-rsort="avg">Средн.'+arrow('avg')+'</th>'+
      '<th style="min-width:200px">Коридор · '+fmtK(lo)+'–'+fmtK(hi)+' c</th>'+
    '</tr></thead><tbody>';
  sorted.forEach(function(r){
    var bar = r.min > 0
      ? '<div class="rbar">'+
          '<div class="rbar-whisk" style="left:'+pc(r.min).toFixed(1)+'%;right:'+(100 - pc(r.max)).toFixed(1)+'%"></div>'+
          '<div class="rbar-cor" style="left:'+pc(r.p25).toFixed(1)+'%;width:'+Math.max(2, pc(r.p75) - pc(r.p25)).toFixed(1)+'%"></div>'+
          '<div class="rbar-med" style="left:'+pc(r.median).toFixed(1)+'%"></div>'+
        '</div>'
      : '<span style="color:var(--muted);font-size:13px">нет числовых данных</span>';
    h += '<tr>'+
      '<td><b>'+esc(r.region)+'</b></td>'+
      '<td class="num">'+r.count+'</td>'+
      '<td class="num">'+num(r.p25)+'</td>'+
      '<td class="num"><b>'+num(r.median)+'</b></td>'+
      '<td class="num">'+num(r.p75)+'</td>'+
      '<td class="num">'+num(r.avg)+'</td>'+
      '<td>'+bar+'</td>'+
    '</tr>';
  });
  h += '</tbody></table></div></div>';

  setTimeout(function(){
    var c = $('dashTabContent');
    if(!c) return;
    c.querySelectorAll('th[data-rsort]').forEach(function(th){
      th.style.cursor = 'pointer';
      th.onclick = function(){
        var k = this.dataset.rsort;
        var cur = S.dashRegSort || { key:'median', dir:'desc' };
        if(cur.key === k){ cur.dir = cur.dir === 'asc' ? 'desc' : 'asc'; }
        else { cur.key = k; cur.dir = (k === 'region') ? 'asc' : 'desc'; }
        S.dashRegSort = cur;
        c.innerHTML = renderRegionsTab((S.dashData && S.dashData.regionStats) || []);
      };
    });
  }, 20);

  return h;
}

function progressTable(list, whoLabel, whoOf, unitsLabel, withSurveys){
  if(!list.length) return '<div class="empty">Нет данных</div>';

  var h = tblCount(list.length, null, ['строка', 'строки', 'строк']);
  h += '<div class="tblwrap tblwrap--page rtbl"><table class="co-tbl co-tbl--pin"><thead><tr>'+
      '<th>'+esc(whoLabel)+'</th>'+
      '<th class="num">Готовность</th>'+
      '<th class="num">'+esc(unitsLabel)+'</th>'+
      '<th class="num">Связей</th>'+
      (withSurveys ? '<th class="num">Анкет</th>' : '')+
    '</tr></thead><tbody>';

  h += list.map(function(x){
    var isDone = x.pct >= 100;
    var cls = isDone ? 'p-ok' : (x.pct > 0 ? 'p-mid' : 'p-no');
    return '<tr>'+
      '<td><b>'+esc(whoOf(x))+'</b>'+
        '<div class="prog-bar-bg" style="margin-top:6px">'+
          '<div class="prog-bar-fill" style="width:'+x.pct+'%;background:'+(isDone?'var(--ok)':'var(--accent)')+'"></div>'+
        '</div></td>'+
      '<td class="num"><span class="pill '+cls+'">'+x.pct+'%</span></td>'+
      '<td class="num">'+x.unitsDone+' / '+x.unitsTotal+'</td>'+
      '<td class="num">'+x.compDone+' / '+x.compTotal+'</td>'+
      (withSurveys ? '<td class="num">'+x.surveysTotal+'</td>' : '')+
    '</tr>';
  }).join('');

  h += '</tbody></table></div>';

  // Карточный вариант для узких экранов (turn-24a): строка таблицы → карточка,
  // три числовые колонки сводятся в одну подпись.
  h += '<div class="rcards">' + list.map(function(x){
    var isDone = x.pct >= 100;
    var cls = isDone ? 'p-ok' : (x.pct > 0 ? 'p-mid' : 'p-no');
    var name = esc(whoOf(x));
    return '<div class="rcard">'+
      '<div class="rcard-hd">'+
        '<b class="rcard-title" title="'+name+'">'+name+'</b>'+
        '<span class="pill '+cls+'">'+x.pct+'%</span>'+
      '</div>'+
      '<div class="prog-bar-bg" style="margin:6px 0">'+
        '<div class="prog-bar-fill" style="width:'+x.pct+'%;background:'+(isDone?'var(--ok)':'var(--accent)')+'"></div>'+
      '</div>'+
      '<div class="rcard-meta">'+esc(unitsLabel)+' '+x.unitsDone+'/'+x.unitsTotal+
        ' · Связей '+x.compDone+'/'+x.compTotal+
        (withSurveys ? ' · Анкет '+x.surveysTotal : '')+'</div>'+
    '</div>';
  }).join('') + '</div>';

  return h;
}

function renderProgressTab(hrbpList, dirList){
  S.dashProgSubTab = S.dashProgSubTab || 'hrbp';
  var isHrbp = (S.dashProgSubTab === 'hrbp');

  var h = '<div class="toolbar dash-subtab-bar">'+
    '<div class="seg seg--subtabs">'+
      '<button class="seg-btn'+(isHrbp?' on':'')+'" data-progtab="hrbp">' + ic('users', 14) + 'По HR BP ('+hrbpList.length+')</button>'+
      '<button class="seg-btn'+(!isHrbp?' on':'')+'" data-progtab="dirs">' + ic('units', 14) + 'По Дирекциям ('+dirList.length+')</button>'+
    '</div>';

  if(S.data && (S.data.user.role === 'admin' || S.data.user.role === 'cb')){
    h += '<button id="btnMassReminder" class="btn-primary dash-mass-reminder">'+
      ic('megaphone', 14)+'Напомнить всем должникам в Telegram'+
    '</button>';
  }
  h += '</div>';

  h += '<div id="dashProgSubContent" style="flex:1;min-height:0;display:flex;flex-direction:column">';
  if(isHrbp){
    h += progressTable(hrbpList, 'HR BP', function(x){ return x.hrbp; }, 'Подразделений', true);
  } else {
    h += progressTable(dirList, 'Дирекция', function(x){ return x.dir; }, 'Отделов', false);
  }
  h += '</div>';

  setTimeout(function(){
    var container = $('dashTabContent');
    if(container){
      container.querySelectorAll('button[data-progtab]').forEach(function(btn){
        btn.onclick = function(){
          S.dashProgSubTab = this.dataset.progtab;
          container.querySelectorAll('button[data-progtab]').forEach(function(b){ b.classList.remove('on'); });
          this.classList.add('on');
          var subBox = $('dashProgSubContent');
          if(subBox){
            if(S.dashProgSubTab === 'hrbp'){
              subBox.innerHTML = progressTable(hrbpList, 'HR BP', function(x){ return x.hrbp; }, 'Подразделений', true);
            } else {
              subBox.innerHTML = progressTable(dirList, 'Дирекция', function(x){ return x.dir; }, 'Отделов', false);
            }
          }
        };
      });
    }

    var b = $('btnMassReminder');
    if(b){
      b.onclick = function(){
        ask({
          title: 'Массовое напоминание в Telegram',
          html: 'Бот отправит персональные уведомления всем ответственным и руководителям, у которых остались незаполненные подразделения.',
          ok: 'Отправить напоминания'
        }).then(function(yes){
          if(!yes) return;
          b.disabled = true; b.textContent = 'Отправляем…';
          call('apiSendMassReminder', S.token).then(function(res){
            b.disabled = false; b.innerHTML = ic('megaphone', 14)+'Напомнить всем должникам в Telegram';
            if(res && res.ok){
              toast('Успешно отправлено напоминаний: ' + res.sent);
            } else {
              toast((res && res.error) || 'Ошибка отправки');
            }
          }).catch(function(){
            b.disabled = false; b.innerHTML = ic('megaphone', 14)+'Напомнить всем должникам в Telegram';
            toast('Нет связи');
          });
        });
      };
    }
  }, 50);

  return h;
}

function renderBenefitsTab(benefits, bonuses, topComps){
  S.dashBenefitsSubTab = S.dashBenefitsSubTab || 'benefits';
  var curTab = S.dashBenefitsSubTab;

  var h = '<div class="toolbar dash-subtab-bar">'+
    '<div class="seg seg--subtabs">'+
      '<button class="seg-btn'+(curTab==='benefits'?' on':'')+'" data-bentab="benefits">' + ic('medal', 14) + 'Популярность льгот ('+benefits.length+')</button>'+
      '<button class="seg-btn'+(curTab==='bonuses'?' on':'')+'" data-bentab="bonuses">' + ic('wallet', 14) + 'Премии и бонусы</button>'+
      '<button class="seg-btn'+(curTab==='comps'?' on':'')+'" data-bentab="comps">' + ic('units', 14) + 'Топ компаний ('+topComps.length+')</button>'+
    '</div>'+
  '</div>';

  function renderSubContent(tab){
    if(tab === 'benefits'){
      if(!benefits.length) return '<div class="empty">Нет данных о льготах</div>';
      var out = tblCount(benefits.length, null, ['льгота', 'льготы', 'льгот']);
      out += '<div class="tblwrap tblwrap--page rtbl"><table class="co-tbl co-tbl--pin"><thead><tr>'+
          '<th>Льгота</th><th class="num">Охват рынка</th><th class="num">Упоминаний</th>'+
        '</tr></thead><tbody>'+
        benefits.map(function(b){
          return '<tr>'+
            '<td><b>'+esc(b.name)+'</b>'+
              '<div class="prog-bar-bg" style="margin-top:6px">'+
                '<div class="prog-bar-fill" style="width:'+b.pct+'%"></div>'+
              '</div></td>'+
            '<td class="num"><span class="pill p-ok">'+b.pct+'%</span></td>'+
            '<td class="num">'+b.count+'</td>'+
          '</tr>';
        }).join('')+
      '</tbody></table></div>';
      out += '<div class="rcards">' + benefits.map(function(b){
        var nm = esc(b.name);
        return '<div class="rcard">'+
          '<div class="rcard-hd"><b class="rcard-title" title="'+nm+'">'+nm+'</b>'+
            '<span class="pill p-ok">'+b.pct+'%</span></div>'+
          '<div class="prog-bar-bg" style="margin:6px 0"><div class="prog-bar-fill" style="width:'+b.pct+'%"></div></div>'+
          '<div class="rcard-meta">Упоминаний: '+b.count+'</div>'+
        '</div>';
      }).join('') + '</div>';
      return out;
    } else if(tab === 'bonuses'){
      var bTotal = (bonuses.hasBonus || 0) + (bonuses.noBonus || 0) + (bonuses.unknown || 0);
      var hasPct = bTotal ? Math.round((bonuses.hasBonus / bTotal) * 100) : 0;
      var noPct = bTotal ? Math.round((bonuses.noBonus / bTotal) * 100) : 0;
      var unkPct = bTotal ? Math.round((bonuses.unknown / bTotal) * 100) : 0;

      var bout = '<div class="card bonuses-card" style="flex:none">'+
        '<div class="bonuses-card-t">Наличие премий и бонусов в компаниях рынка</div>'+
        '<div class="fork-nums bonuses-card-nums">'+
          '<span class="is-ok">Премии предусмотрены: <b>'+(bonuses.hasBonus||0)+' ('+hasPct+'%)</b></span>'+
          '<span class="is-no">Без премий: <b>'+(bonuses.noBonus||0)+' ('+noPct+'%)</b></span>'+
          (bonuses.unknown ? '<span class="is-muted">Не указано: <b>'+bonuses.unknown+' ('+unkPct+'%)</b></span>' : '')+
        '</div>'+
        '<div class="prog-bar-bg bonuses-card-bar">'+
          '<div class="prog-bar-fill" style="width:'+hasPct+'%"></div>'+
        '</div>'+
      '</div>';

      // Разбивка по видам и по периодичности — учитывается КАЖДЫЙ вид премии
      // в записи (в компании их может быть несколько).
      var kindRows = Object.keys(bonuses.types || {})
        .map(function(k){ return { k: k, n: bonuses.types[k] }; })
        .sort(function(a, b){ return b.n - a.n; });
      var perRows = Object.keys(bonuses.periods || {})
        .map(function(k){ return { k: k, n: bonuses.periods[k] }; })
        .sort(function(a, b){ return b.n - a.n; });

      var miniTbl = function(title, rowsArr, w1){
        if(!rowsArr.length) return '';
        return '<div class="dash-sec-head" style="margin-top:16px;flex:none"><b>'+title+'</b></div>'+
          '<div class="tblwrap rtbl" style="flex:none"><table class="co-tbl co-tbl--pin"><thead><tr>'+
            '<th>'+w1+'</th><th class="num">Упоминаний</th>'+
          '</tr></thead><tbody>'+
          rowsArr.map(function(r){
            return '<tr><td><b>'+esc(r.k)+'</b></td><td class="num">'+r.n+'</td></tr>';
          }).join('')+
          '</tbody></table></div>';
      };

      bout += miniTbl('Виды переменной части', kindRows, 'Вид');
      bout += miniTbl('Периодичность выплат', perRows, 'Периодичность');
      if(!kindRows.length && !perRows.length){
        bout += '<div class="rcard-meta" style="margin-top:12px">Виды и периодичность премий пока не заполнены в анкетах.</div>';
      }
      return bout;
    } else if(tab === 'comps'){
      if(!topComps.length) return '<div class="empty">Нет данных о компаниях</div>';
      var out = tblCount(topComps.length, null, ['компания', 'компании', 'компаний']);
      out += '<div class="tblwrap tblwrap--page rtbl"><table class="co-tbl co-tbl--pin">'+
        '<thead><tr><th>Компания</th><th class="num">Записей в анкетах</th></tr></thead><tbody>'+
        topComps.map(function(c){
          return '<tr><td><b>'+esc(c.company)+'</b></td><td class="num"><b>'+c.count+'</b></td></tr>';
        }).join('')+
      '</tbody></table></div>';
      out += '<div class="rcards">' + topComps.map(function(c){
        var nm = esc(c.company);
        return '<div class="rcard"><div class="rcard-hd">'+
          '<b class="rcard-title" title="'+nm+'">'+nm+'</b>'+
          '<span class="pill p-ok">'+c.count+'</span></div>'+
          '<div class="rcard-meta">Записей в анкетах</div></div>';
      }).join('') + '</div>';
      return out;
    }
    return '';
  }

  h += '<div id="dashBenefitsSubContent" style="flex:1;min-height:0;display:flex;flex-direction:column">' + renderSubContent(curTab) + '</div>';

  setTimeout(function(){
    var container = $('dashTabContent');
    if(container){
      container.querySelectorAll('button[data-bentab]').forEach(function(btn){
        btn.onclick = function(){
          S.dashBenefitsSubTab = this.dataset.bentab;
          container.querySelectorAll('button[data-bentab]').forEach(function(b){ b.classList.remove('on'); });
          this.classList.add('on');
          var subBox = $('dashBenefitsSubContent');
          if(subBox){
            subBox.innerHTML = renderSubContent(S.dashBenefitsSubTab);
          }
        };
      });
    }
  }, 50);

  return h;
}

function exportDashboardCSV(){
  if(!S.dashData || !S.dashData.positions || !S.dashData.positions.length){
    toast('Нет данных для экспорта');
    return;
  }
  var headers = ['Должность', 'Всего записей', 'С окладом', 'Мин (TJS)', '25% перцентиль (TJS)', 'Медиана (TJS)', '75% перцентиль (TJS)', 'Макс (TJS)', 'Среднее (TJS)', 'Размах вилки (%)', 'Компаний с премией', 'Типичная периодичность премии', 'Совокупно, медиана (TJS)'];
  // Гасим CSV-инъекцию: ячейку, начинающуюся с = + - @ или упр. символа,
  // Excel/Sheets исполняют как формулу — префиксуем апострофом.
  var csvCell = function(v){
    var s = String(v == null ? '' : v);
    if(/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  var rows = S.dashData.positions.map(function(p){
    return [
      csvCell(p.pos),
      p.count,
      p.withSalaryCount,
      p.min,
      p.p25,
      p.median,
      p.p75,
      p.max,
      p.avg,
      p.forkSpreadPct + '%',
      p.bonCompanies != null ? p.bonCompanies : '',
      csvCell(p.bonTopPer || ''),
      p.totalMedian || ''
    ].join(';');
  });

  var csvContent = '\uFEFF' + headers.join(';') + '\n' + rows.join('\n');
  var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'Обзор_рынка_зарплатные_вилки_C&B.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Файл отчёта CSV сформирован и скачан');

  // Журнал выгрузок: кто/когда/откуда/что. Не блокирует скачивание.
  try {
    call('apiAuditExport', S.token, {
      kind: 'дашборд: ' + (S.dashTab || 'salaries'),
      rows: rows.length,
      format: 'csv',
      filters: S.dashFilters || {}
    });
  } catch(e){}
}

function declOfNum(n, titles){
  return titles[(n%10===1 && n%100!==11) ? 0 : (n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20)) ? 1 : 2];
}

// ═══════════════════════════════════════════════════════════
// ПАНЕЛЬ АДМИНИСТРАТОРА
// ═══════════════════════════════════════════════════════════
function openAdminPanel(){
  var atab = S.adminTab || 'users';
  var atabNames = {
    users: 'Пользователи', archive: 'Архив', divisions: 'Оргструктура',
    dict: 'Справочники', period: 'Период сбора', tools: 'Сервисные утилиты',
    audit: 'Журнал действий', roles: 'Роли и доступы'
  };
  var atabIcons = {
    users: 'users', archive: 'archive', divisions: 'units',
    dict: 'book', period: 'clock', tools: 'wrench',
    audit: 'clipboard', roles: 'shield'
  };
  var tabTitle = atabNames[atab] || 'Администрирование';
  var tabIcon = atabIcons[atab] || 'admin';

  if(window.WorkspaceTabs && WorkspaceTabs.openTab && !WorkspaceTabs.isInsideTabRun){
    WorkspaceTabs.openTab({
      key: 'admin:' + atab,
      title: tabTitle,
      icon: tabIcon,
      state: { appView: 'admin', adminTab: atab, unit: null },
      run: function(){ openAdminPanel(); }
    });
    return;
  }
  S.appView = 'admin';
  S.unit = null;
  saveNavState();
  renderTopNav();
  setTop('Администрирование', userLabel(), false, 'admin');
  $('bar').classList.add('hidden');
  $('body').onclick = null;
  renderAdminPanel();
}

function renderAdminPanel(){
  // Какие вкладки видны — по конструктору ролей и доступов (админка → «Роли
  // и доступы»), не по жёстко зашитой роли. Сам конструктор — исключение:
  // admin-only, редактирование прав всей компании не выдаётся правом.
  var allTabs = [
    { id:'users', icon:'users', label:'Пользователи', cap:'users:view' },
    { id:'archive', icon:'archive', label:'Архив', cap:'users:view' },
    // Число подразделений было вписано в подпись строкой «(326)» — оно
    // разъедется, как только оргструктуру поменяют. Берём из данных.
    { id:'divisions', icon:'units', label:'Оргструктура' + (S.data && S.data.allUnits ? ' ('+S.data.allUnits.length+')' : ''), cap:'divisions:view' },
    { id:'dict', icon:'book', label:'Справочники', cap:'dictionary:view' },
    { id:'period', icon:'clock', label:'Период сбора', cap:'period:view' },
    { id:'tools', icon:'wrench', label:'Сервисные утилиты', cap:'service:view' },
    { id:'audit', icon:'clipboard', label:'Журнал действий', cap:'service:view' },
    { id:'roles', icon:'shield', label:'Роли и доступы', adminOnly:true }
  ];
  var tabs = allTabs.filter(function(t){
    return t.adminOnly ? S.data.user.role === 'admin' : hasCap(t.cap);
  });

  if(!tabs.length){
    $('body').innerHTML = '<div class="err">Нет доступа ни к одному разделу администратора.</div>';
    return;
  }
  if(!S.adminTab || !tabs.some(function(t){ return t.id === S.adminTab; })){
    S.adminTab = tabs[0].id;
  }

  saveNavState();
  var curTab = tabs.filter(function(t){ return t.id === S.adminTab; })[0];
  setTop(curTab ? curTab.label : 'Панель Администратора', userLabel(), false, curTab ? curTab.icon : 'admin');

  var adminEl = $('adminContent');
  if(!adminEl){
    $('body').innerHTML = '<div id="adminContent" class="admin-content">' + skTable() + '</div>';
  } else {
    // Сохраняем текущие значения полей фильтров перед обновлением
    if($('uSearch')) S.adminUsersSearch = $('uSearch').value;
    if($('uRole')) S.adminUsersRole = $('uRole').value;
    if($('uDept')) S.adminUsersDept = $('uDept').value;
  }

  if(S.adminTab === 'users') loadAdminUsers();
  else if(S.adminTab === 'archive') loadAdminArchive();
  else if(S.adminTab === 'divisions') loadAdminDivisions();
  else if(S.adminTab === 'dict') renderAdminDict();
  else if(S.adminTab === 'period') renderAdminPeriod();
  else if(S.adminTab === 'tools') renderAdminTools();
  else if(S.adminTab === 'audit') renderAdminAudit();
  else if(S.adminTab === 'roles') loadAdminRoles();
}

// ─── Вкладка: Пользователи ───
function loadAdminUsers(){
  try { saveViewScroll('admin:users'); } catch(e){}
  if($('uSearch')) S.adminUsersSearch = $('uSearch').value;
  if($('uRole')) S.adminUsersRole = $('uRole').value;
  if($('uDept')) S.adminUsersDept = $('uDept').value;

  if(!S.adminUsers || !S.adminUsers.length){
    $('adminContent').innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-dim);font-size:14px">Загрузка пользователей...</div>';
  }
  // список ролей нужен для выпадашки в карточке пользователя — тянем в фоне
  if(!S.rolesList){
    call('apiAdminGetRoleCapabilities', S.token).then(function(rr){
      if(rr && rr.ok) S.rolesList = (rr.roles || []).map(function(x){ return { key:x.key, label:x.label }; });
    }).catch(function(){});
  }
  if(!S.adminDivs || !S.adminDivs.length){
    call('apiAdminGetDivisions', S.token).then(function(dRes){
      if(dRes && dRes.ok){
        S.adminDivs = dRes.divisions || [];
        if($('uDept')) renderAdminUsers();
      }
    }).catch(function(){});
  }
  call('apiAdminGetUsers', S.token).then(function(r){
    if(!r || !r.ok){
      if(!S.adminUsers || !S.adminUsers.length){
        $('adminContent').innerHTML = '<div class="err">'+esc((r&&r.error)||'Ошибка загрузки пользователей')+'</div>';
      }
      return;
    }
    S.adminUsers = r.users || [];
    renderAdminUsers();
  }).catch(function(){
    if(!S.adminUsers || !S.adminUsers.length){
      $('adminContent').innerHTML = '<div class="err">Нет связи с сервером</div>';
    }
  });
}

function userActs(u, compact){
  var login = esc(u.login);

  // Администратора и самого себя блокировать и архивировать нельзя: войти
  // потом будет некому. Суперадминистратор (встроенная учётка «admin») может
  // управлять остальными администраторами.
  var me = S.data && S.data.user ? String(S.data.user.login).toLowerCase() : '';
  var iAmSuper = me === 'admin';
  var isSuperTarget = String(u.login).toLowerCase() === 'admin';
  var locked = String(u.login).toLowerCase() === me || isSuperTarget || (u.role === 'admin' && !iAmSuper);

  if(compact){
    return '<button class="row-menu-trigger" title="Действия" aria-label="Действия с пользователем" onclick="openUserActions(event, \''+login+'\')">'+icBare('more',16)+'</button>';
  }
  return '<button class="btn-line" onclick="openUserModal(\''+login+'\')">'+ic('pencil')+'Изменить</button>'+
    '<button class="btn-line" onclick="adminResetPwd(\''+login+'\')">'+ic('key')+'Сбросить пароль</button>'+
    (locked ? '' :
      '<button class="btn-line '+(u.active?'btn-danger':'')+'" onclick="adminToggleUser(\''+login+'\','+(!u.active)+')">'+
        (u.active ? ic('block')+'Заблокировать' : ic('check')+'Активировать')+
      '</button>'+
      '<button class="btn-line btn-danger" onclick="adminArchiveUser(\''+login+'\')">'+ic('archive')+'В архив</button>');
}

/** Одно контекстное меню убирает постоянный шум из столбца действий.
 *  Доступные операции и защита admin/self остаются теми же, что раньше. */
function closeOverflowMenus(){
  document.querySelectorAll('.row-menu-pop').forEach(function(menu){ menu.remove(); });
}

function openOverflowMenu(e, actions){
  if(e){ e.preventDefault(); e.stopPropagation(); }
  closeOverflowMenus();
  var anchor = e && (e.currentTarget || (e.target && e.target.closest && e.target.closest('button')));
  var hasCoord = e && typeof e.clientX === 'number' && e.clientX > 0;
  var isMousePos = hasCoord && (e._fromCtx || e.type === 'contextmenu' || e.button === 2);
  if(!anchor && !hasCoord) return;

  var menu = document.createElement('div');
  menu.className = 'row-menu-pop';
  menu.setAttribute('role', 'menu');
  actions.forEach(function(action){
    if(action.divider){
      var divider = document.createElement('div');
      divider.className = 'row-menu-divider';
      menu.appendChild(divider);
      return;
    }
    var item = document.createElement('button');
    item.type = 'button';
    item.className = 'row-menu-item' + (action.danger ? ' danger' : '');
    item.setAttribute('role', 'menuitem');
    item.innerHTML = (action.icon ? icBare(action.icon, 15) : '') + '<span>'+esc(action.label)+'</span>';
    item.onclick = function(){ closeOverflowMenus(); action.run(); };
    menu.appendChild(item);
  });
  menu.onclick = function(evt){ evt.stopPropagation(); };
  document.body.appendChild(menu);

  if(isMousePos || (!anchor && hasCoord)){
    var top = Math.min(window.innerHeight - menu.offsetHeight - 8, Math.max(8, e.clientY + 2));
    var left = Math.min(window.innerWidth - menu.offsetWidth - 8, Math.max(8, e.clientX + 2));
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';
  } else if(anchor){
    var rect = anchor.getBoundingClientRect();
    menu.style.top = Math.min(window.innerHeight - menu.offsetHeight - 8, rect.bottom + 4) + 'px';
    menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, rect.right - menu.offsetWidth)) + 'px';
  }
  setTimeout(function(){ document.addEventListener('click', closeOverflowMenus, { once:true }); }, 0);
}

function openUserActions(e, login){
  var u = (S.adminUsers || []).filter(function(item){ return item.login === login; })[0];
  if(!u) return;
  var me = S.data && S.data.user ? String(S.data.user.login).toLowerCase() : '';
  var iAmSuper = me === 'admin';
  var isSuperTarget = String(u.login).toLowerCase() === 'admin';
  var locked = String(u.login).toLowerCase() === me || isSuperTarget || (u.role === 'admin' && !iAmSuper);
  var actions = [
    { label:'Редактировать', icon:'pencil', run:function(){ openUserModal(login); } },
    { label:'Сбросить пароль', icon:'key', run:function(){ adminResetPwd(login); } }
  ];
  if(!locked){
    actions.push({ divider:true });
    actions.push({ label:u.active ? 'Заблокировать' : 'Активировать', icon:u.active ? 'block' : 'check', danger:!!u.active,
      run:function(){ adminToggleUser(login, !u.active); } });
    actions.push({ label:'В архив', icon:'archive', danger:true, run:function(){ adminArchiveUser(login); } });
  }
  openOverflowMenu(e, actions);
}

function openDictActions(e, name){
  openOverflowMenu(e, [
    { label:'Редактировать', icon:'pencil', run:function(){ openDictItem(name); } },
    { divider:true },
    { label:'Удалить', icon:'trash', danger:true, run:function(){ removeDictItem(name); } }
  ]);
}

function renderAdminUsers(){
  var users = S.adminUsers || [];
  var rawSearch = $('uSearch') ? $('uSearch').value : (S.adminUsersSearch || '');
  var roleFilter = $('uRole') ? $('uRole').value : (S.adminUsersRole || '');
  var deptFilter = $('uDept') ? $('uDept').value : (S.adminUsersDept || '');
  S.adminUsersSearch = rawSearch;
  S.adminUsersRole = roleFilter;
  S.adminUsersDept = deptFilter;
  var search = rawSearch.toLowerCase();

  // Список всех уникальных департаментов/направлений
  var dirs = [];
  if(S.adminDivs && S.adminDivs.length){
    var dirSet = {};
    S.adminDivs.forEach(function(d){
      if(d.dir) dirSet[d.dir] = true;
    });
    dirs = Object.keys(dirSet).sort(function(a, b){ return a.localeCompare(b, 'ru'); });
  }

  var filtered = users.filter(function(u){
    var matchSearch = !search || (u.fio && u.fio.toLowerCase().indexOf(search) >= 0) || (u.login && u.login.toLowerCase().indexOf(search) >= 0);
    var matchRole = !roleFilter || u.role === roleFilter;
    var matchDept = true;
    if(deptFilter){
      matchDept = false;
      var uUnits = u.units || [];
      if(uUnits.indexOf(deptFilter) >= 0){
        matchDept = true;
      } else if(S.adminDivs && S.adminDivs.length){
        var deptDivs = S.adminDivs.filter(function(d){ return d.dir === deptFilter; });
        var deptUnitNames = deptDivs.map(function(d){ return d.unit; });
        for(var i = 0; i < uUnits.length; i++){
          if(deptUnitNames.indexOf(uUnits[i]) >= 0){ matchDept = true; break; }
        }
        if(!matchDept){
          var fio = (u.fio || '').trim();
          if(fio){
            for(var j = 0; j < deptDivs.length; j++){
              var d = deptDivs[j];
              if((d.head && d.head.indexOf(fio) >= 0) || (d.resp && d.resp.indexOf(fio) >= 0) || (d.hrbp && d.hrbp.indexOf(fio) >= 0)){
                matchDept = true; break;
              }
            }
          }
        }
      }
    }
    return matchSearch && matchRole && matchDept;
  });

  // Поиск, фильтр роли, фильтр департамента, счётчик и кнопка — одной строкой
  var h = '<div class="toolbar">'+
    '<div class="search-wrap">'+icBare('search')+
      '<input id="uSearch" placeholder="Поиск по ФИО или логину…" value="'+esc(rawSearch)+'"></div>'+
    '<select id="uRole" class="toolbar-select">'+
      '<option value="">Все роли ('+users.length+')</option>'+
      '<option value="admin"'+(roleFilter==='admin'?' selected':'')+'>Администраторы (admin)</option>'+
      '<option value="cb"'+(roleFilter==='cb'?' selected':'')+'>C&B Аналитики (cb)</option>'+
      '<option value="hrbp"'+(roleFilter==='hrbp'?' selected':'')+'>HR BP (hrbp)</option>'+
      '<option value="dir_head"'+(roleFilter==='dir_head'?' selected':'')+'>Руководители направлений</option>'+
      '<option value="head"'+(roleFilter==='head'?' selected':'')+'>Руководители отделов</option>'+
      '<option value="user"'+(roleFilter==='user'?' selected':'')+'>Сотрудники (user)</option>'+
    '</select>'+
    '<select id="uDept" class="toolbar-select" style="max-width:240px">'+
      '<option value="">Все департаменты ('+dirs.length+')</option>'+
      dirs.map(function(dirName){
        return '<option value="'+esc(dirName)+'"'+(deptFilter===dirName?' selected':'')+'>'+esc(dirName)+'</option>';
      }).join('')+
    '</select>'+
    tblCount(filtered.length, users.length, ['пользователь', 'пользователя', 'пользователей'])+
    '<button id="btnAddUser" class="btn-primary toolbar-act">+ Добавить пользователя</button>'+
  '</div>';

  var rows = '', cards = '';
  filtered.forEach(function(u){
    var rBadge = 'b-user';
    if(u.role === 'admin') rBadge = 'b-admin';
    else if(u.role === 'cb') rBadge = 'b-cb';
    else if(u.role === 'hrbp') rBadge = 'b-hrbp';
    else if(u.role === 'dir_head' || u.role === 'head') rBadge = 'b-head';

    rows += '<tr id="urow_'+esc(u.login)+'" data-login="'+esc(u.login)+'" style="cursor:pointer" title="Двойной клик для редактирования">'+
      '<td class="u-t-fio" title="'+esc(u.fio)+'">'+esc(u.fio)+'</td>'+
      '<td class="u-t-login">'+esc(u.login)+
        (u.hasTelegram ? ' <span class="badge b-tg">TG</span>' : '')+
      '</td>'+
      '<td class="u-t-dim">'+esc(u.phone || '—')+'</td>'+
      '<td><span class="badge '+rBadge+'">'+esc(u.role)+'</span></td>'+
      '<td><span class="badge '+(u.active?'b-active':'b-blocked')+'">'+(u.active?'Активен':'Заблокирован')+'</span></td>'+
      '<td class="u-t-dim" title="'+esc((u.units||[]).join('\n'))+'">'+(u.units?u.units.length:0)+'</td>'+
      '<td class="u-t-dim">'+esc(fmtDateTime(u.lastIn) || '—')+'</td>'+
      '<td><div class="u-t-acts">'+userActs(u, true)+'</div></td>'+
    '</tr>';

    cards += '<div class="u-card" id="ucard_'+esc(u.login)+'" data-login="'+esc(u.login)+'" style="cursor:pointer" title="Двойной клик для редактирования">'+
      '<div class="u-hd">'+
        '<div class="u-fio" title="'+esc(u.fio)+'">'+esc(u.fio)+'</div>'+
        '<div>'+
          '<span class="badge '+rBadge+'">'+esc(u.role)+'</span> '+
          '<span class="badge '+(u.active?'b-active':'b-blocked')+'">'+(u.active?'Активен':'Заблокирован')+'</span>'+
        '</div>'+
      '</div>'+
      '<div class="u-meta">'+
        'Логин: <b>'+esc(u.login)+'</b>'+
        (u.phone ? ' · Тел: '+esc(u.phone) : '') +
        (u.hasTelegram ? ' · <span class="badge b-tg">Telegram привязан</span>' : '') +
        '<br>Подразделений: <b title="'+esc((u.units||[]).join('\n'))+'">'+(u.units?u.units.length:0)+'</b>'+
        (u.lastIn ? ' · Вход: '+esc(fmtDateTime(u.lastIn)) : '') +
      '</div>'+
      '<div class="u-acts">'+userActs(u, false)+'</div>'+
    '</div>';
  });

  h += '<div class="tblwrap tblwrap--page"><table class="co-tbl u-tbl">'+
    '<thead><tr>'+
      '<th>ФИО</th><th>Логин</th><th>Телефон</th><th>Роль</th><th>Статус</th>'+
      '<th>Подразделений</th><th>Вход</th><th>Действия</th>'+
    '</tr></thead>'+
    '<tbody>'+rows+'</tbody>'+
  '</table></div>';

  h += '<div class="u-cards fx-stagger">'+cards+'</div>';

  $('adminContent').innerHTML = h;

  // Двойной клик — редактирование, правый клик — меню действий ровно под курсором
  $('adminContent').querySelectorAll('tr[data-login], .u-card[data-login]').forEach(function(el){
    el.ondblclick = function(e){
      if(e.target.closest('button, a, input, select')) return;
      var login = this.dataset.login;
      if(login) openUserModal(login);
    };
    el.oncontextmenu = function(e){
      if(e.target.closest('button, a, input, select')) return;
      var login = this.dataset.login;
      if(login){
        e.preventDefault();
        openUserActions(e, login);
      }
    };
  });

  $('uSearch').oninput = function(){
    var pos = this.selectionStart;
    S.adminUsersSearch = this.value;
    saveNavState();
    renderAdminUsers();
    var again = $('uSearch');
    if(again){ again.focus(); try{ again.setSelectionRange(pos, pos); }catch(e){} }
  };
  $('uRole').onchange = function(){
    S.adminUsersRole = this.value;
    saveNavState();
    renderAdminUsers();
  };
  $('uDept').onchange = function(){
    S.adminUsersDept = this.value;
    saveNavState();
    renderAdminUsers();
  };
  $('btnAddUser').onclick = function(){ openUserModal(null); };
  try { restoreViewScroll('admin:users'); } catch(e){}
}

function openUserModal(login){
  if(login){
    try { markActiveItem('urow_' + login, 'admin:users'); } catch(e){}
  }
  var u = login ? (S.adminUsers || []).filter(function(x){ return x.login === login; })[0] : null;
  var isEdit = !!u;

  var meLogin = S.data && S.data.user ? String(S.data.user.login).toLowerCase() : '';
  var iAmSuper = meLogin === 'admin';
  var editingSuper = isEdit && String(u.login).toLowerCase() === 'admin';
  var adminFieldsLocked = editingSuper || (isEdit && u.role === 'admin' && !iAmSuper);

  var userUnits = {};
  if(u && u.units) u.units.forEach(function(un){ userUnits[un] = true; });

  var el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = '<div class="sheet-in um-modal">'+
    '<div class="sheet-hd"><b>'+(isEdit ? 'Редактирование: ' + esc(u.fio) : 'Новый пользователь')+'</b>'+
      '<button class="btn-ghost" data-x="1">Закрыть</button></div>'+
    '<div id="uModalErr" class="err hidden"></div>'+
    '<label class="lbl" style="margin-top:2px">ФИО *</label>'+
    '<input id="umFio" value="'+esc(u?u.fio:'')+'" placeholder="Иванов Иван Иванович">'+
    '<div class="field-grid">'+
      '<div>'+
        '<label class="lbl">Логин (оставьте пустым для автогенерации)</label>'+
        '<input id="umLogin" value="'+esc(u?u.login:'')+'" placeholder="ivanov" '+(isEdit?'readonly style="opacity:.7"':'')+'>'+
      '</div>'+
      '<div>'+
        '<label class="lbl">Роль</label>'+
        '<select id="umRole" '+(adminFieldsLocked?'disabled style="opacity:.6;cursor:not-allowed"':'')+'>'+ roleOptionsHtml(u ? u.role : 'user') +'</select>'+
      '</div>'+
    '</div>'+
    '<label class="lbl">Телефон (9 цифр для Telegram)</label>'+
    '<input id="umPhone" value="'+esc(u?u.phone:'')+'" placeholder="992900000000">'+
    (isEdit ? '' :
      '<p class="step-hint" style="margin:6px 0 0">Пароль пользователь получает сам в Telegram-боте: '+
      '<b>/link</b> (поделиться номером) → <b>/login</b>. Админ пароль не задаёт и не видит.</p>')+
    '<div style="margin:8px 0 6px">'+
      '<label class="checkline"><input type="checkbox" id="umActive" '+(u&&!u.active?'':'checked')+' '+(adminFieldsLocked?'disabled':'')+'> Пользователь активен</label>'+
    '</div>'+
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">'+
      '<div class="sec-title" style="margin:0">Закрепленные подразделения</div>'+
      '<label class="checkline" style="font-size:13px;cursor:pointer;user-select:none;color:var(--text);display:inline-flex;align-items:center;gap:6px">'+
        '<input type="checkbox" id="umOnlyChecked"> Показать только закреплённые'+
      '</label>'+
    '</div>'+
    '<div class="search-wrap" style="margin-top:6px">'+icBare('search')+
      '<input id="umUnitSearch" placeholder="Фильтр подразделений…"></div>'+
    '<div id="umUnitList" style="max-height:135px;overflow:auto;border:1px solid var(--line);border-radius:10px;margin-top:6px;padding:6px"></div>'+
    '<div style="height:12px"></div>'+
    '<button id="umSave" class="btn-primary">Сохранить</button>'+
  '</div>';

  document.body.appendChild(el);

  function drawUnits(){
    var q = (el.querySelector('#umUnitSearch').value || '').toLowerCase();
    var onlyChecked = el.querySelector('#umOnlyChecked') && el.querySelector('#umOnlyChecked').checked;
    var all = S.data.allUnits || [];
    var list = all.filter(function(x){
      if(onlyChecked && !userUnits[x.unit]) return false;
      return !q || x.unit.toLowerCase().indexOf(q) >= 0 || x.dir.toLowerCase().indexOf(q) >= 0;
    });
    el.querySelector('#umUnitList').innerHTML = list.slice(0, 100).map(function(x){
      var dInfo = (S.adminDivs || []).find(function(d){ return d.unit === x.unit; }) || x;
      var curResp = dInfo.resp ? esc(dInfo.resp) : '<span style="color:var(--warn)">не назначен</span>';
      return '<label class="pickrow"><input type="checkbox" data-u="'+esc(x.unit)+'"'+
        (userUnits[x.unit]?' checked':'')+'><span>'+esc(x.unit)+
        '<br><small style="color:var(--muted)">'+esc(x.dir)+' · Отв: '+curResp+'</small></span></label>';
    }).join('') || '<p style="color:var(--muted);padding:8px">'+(onlyChecked ? 'Нет закреплённых подразделений' : 'Ничего не найдено')+'</p>';
  }
  drawUnits();

  el.querySelector('#umUnitSearch').oninput = drawUnits;
  if(el.querySelector('#umOnlyChecked')){
    el.querySelector('#umOnlyChecked').onchange = drawUnits;
  }
  el.querySelector('#umUnitList').onchange = function(e){
    if(e.target.dataset.u){
      userUnits[e.target.dataset.u] = e.target.checked;
      if(el.querySelector('#umOnlyChecked') && el.querySelector('#umOnlyChecked').checked){
        drawUnits();
      }
    }
  };

  var origUnits = Object.keys(userUnits).filter(function(k){ return userUnits[k]; }).sort().join(',');
  var isDirty = function(){
    var curUnits = Object.keys(userUnits).filter(function(k){ return userUnits[k]; }).sort().join(',');
    return el.querySelector('#umFio').value.trim() !== (u?u.fio:'') ||
      el.querySelector('#umLogin').value.trim() !== (u?u.login:'') ||
      el.querySelector('#umRole').value !== (u?u.role:'user') ||
      el.querySelector('#umPhone').value.trim() !== (u?u.phone:'') ||
      el.querySelector('#umActive').checked !== (u?!!u.active:true) ||
      curUnits !== origUnits;
  };
  guardClose(el, isDirty);

  el.querySelector('#umSave').onclick = function(){
    var fio = el.querySelector('#umFio').value.trim();
    if(!fio){
      var err = el.querySelector('#uModalErr');
      err.textContent = 'Укажите ФИО'; err.classList.remove('hidden'); return;
    }
    var assignedUnits = Object.keys(userUnits).filter(function(k){ return userUnits[k]; });
    var payload = {
      fio: fio,
      login: el.querySelector('#umLogin').value.trim(),
      role: el.querySelector('#umRole').value,
      phone: el.querySelector('#umPhone').value.trim(),
      active: el.querySelector('#umActive').checked,
      units: assignedUnits
    };

    var btn = this;
    btn.disabled = true; btn.textContent = 'Сохраняем…';
    call('apiAdminSaveUser', S.token, payload).then(function(res){
      btn.disabled = false; btn.textContent = 'Сохранить';
      if(res && res.ok){
        el.remove();
        try { markActiveItem('urow_' + payload.login, 'admin:users'); } catch(e){}
        loadAdminUsers();
        if(S.token){
          call('apiAdminGetDivisions', S.token).then(function(dRes){
            if(dRes && dRes.ok && dRes.divisions) S.adminDivs = dRes.divisions;
          }).catch(function(){});
        }
        pushUndo({
          action: 'save_user_units',
          login: payload.login,
          fio: payload.fio,
          oldUnits: origUnits,
          newUnits: assignedUnits
        });
        if(!isEdit){
          ask({
            title: 'Пользователь создан',
            html: 'Логин: <b>'+esc(res.login || payload.login)+'</b><br><br>'+
              'Пароль задаёт себе сам пользователь в Telegram-боте: команда <b>/link</b> '+
              '(поделиться номером телефона из профиля), затем <b>/login</b> — бот пришлёт '+
              'логин и пароль ему в личные сообщения.',
            ok: 'Понятно'
          });
        } else {
          toast('Пользователь сохранён');
        }
      } else {
        var err = el.querySelector('#uModalErr');
        err.textContent = (res && res.error) || 'Ошибка сохранения';
        err.classList.remove('hidden');
      }
    }).catch(function(){
      btn.disabled = false; btn.textContent = 'Сохранить';
      toast('Нет связи');
    });
  };
}

function adminToggleUser(login, active){
  ask({
    title: (active ? 'Активировать' : 'Заблокировать') + ' пользователя?',
    html: 'Пользователь: <b>' + esc(login) + '</b>',
    ok: active ? 'Активировать' : 'Заблокировать',
    danger: !active
  }).then(function(yes){
    if(!yes) return;
    call('apiAdminToggleUser', S.token, login, active).then(function(res){
      if(res && res.ok){
        toast('Статус обновлён');
        loadAdminUsers();
      } else {
        toast((res && res.error) || 'Ошибка');
      }
    });
  });
}

function adminResetPwd(login){
  ask({
    title: 'Сбросить пароль пользователя?',
    html: 'Для <b>'+esc(login)+'</b> будет сгенерирован новый пароль и отправлен '+
      'пользователю в Telegram. Вы пароль не увидите — его знает только владелец аккаунта.',
    ok: 'Сбросить и отправить'
  }).then(function(yes){
    if(!yes) return;
    call('apiAdminResetPassword', S.token, login).then(function(res){
      if(res && res.ok){
        ask({
          title: 'Пароль отправлен',
          html: 'Новый пароль для <b>'+esc(res.login || login)+'</b> сгенерирован и отправлен '+
            'пользователю в личные сообщения Telegram.',
          ok: 'Понятно'
        });
      } else {
        ask({
          title: 'Не удалось сбросить',
          html: esc((res && res.error) || 'Ошибка сброса пароля'),
          ok: 'Понятно'
        });
      }
    });
  });
}

function adminArchiveUser(login){
  ask({
    title: 'Отправить пользователя в архив?',
    html: 'Логин: <b>'+esc(login)+'</b><br>Пропадёт из общего списка и не сможет войти. '+
      'Данные никуда не денутся — вернуть можно из вкладки «Архив».',
    ok: 'В архив',
    danger: true
  }).then(function(yes){
    if(!yes) return;
    call('apiAdminArchiveUser', S.token, login).then(function(res){
      if(res && res.ok){
        toast('Пользователь отправлен в архив');
        loadAdminUsers();
      } else {
        toast((res && res.error) || 'Ошибка');
      }
    });
  });
}

function adminRestoreUser(login){
  ask({
    title: 'Восстановить пользователя?',
    html: 'Логин: <b>'+esc(login)+'</b><br>Снова появится в общем списке и сможет войти.',
    ok: 'Восстановить'
  }).then(function(yes){
    if(!yes) return;
    call('apiAdminRestoreUser', S.token, login).then(function(res){
      if(res && res.ok){
        toast('Пользователь восстановлен');
        loadAdminArchive();
      } else {
        toast((res && res.error) || 'Ошибка');
      }
    });
  });
}

// ─── Вкладка: Архив ───
function loadAdminArchive(){
  call('apiAdminGetArchive', S.token).then(function(r){
    if(!r || !r.ok){
      $('adminContent').innerHTML = '<div class="err">'+esc((r&&r.error)||'Ошибка загрузки архива')+'</div>';
      return;
    }
    S.adminArchive = r.users || [];
    renderAdminArchive();
  }).catch(function(){
    $('adminContent').innerHTML = '<div class="err">Нет связи с сервером</div>';
  });
}

function renderAdminArchive(){
  var users = S.adminArchive || [];

  var h = '<div class="sec-title">В архиве</div>'+
    tblCount(users.length, null, ['учётная запись', 'учётные записи', 'учётных записей']);

  if(!users.length){
    h += '<div class="empty">Архив пуст</div>';
    $('adminContent').innerHTML = h;
    return;
  }

  var rows = '', cards = '';
  users.forEach(function(u){
    rows += '<tr>'+
      '<td class="u-t-fio" title="'+esc(u.fio)+'">'+esc(u.fio)+'</td>'+
      '<td class="u-t-login">'+esc(u.login)+'</td>'+
      '<td><span class="badge b-user">'+esc(u.role)+'</span></td>'+
      '<td class="u-t-dim">'+esc(fmtDateTime(u.archivedAt) || '—')+'</td>'+
      '<td><div class="u-t-acts"><button class="btn-line" onclick="adminRestoreUser(\''+esc(u.login)+'\')">Восстановить</button></div></td>'+
    '</tr>';

    cards += '<div class="u-card">'+
      '<div class="u-hd">'+
        '<div class="u-fio" title="'+esc(u.fio)+'">'+esc(u.fio)+'</div>'+
        '<span class="badge b-user">'+esc(u.role)+'</span>'+
      '</div>'+
      '<div class="u-meta">'+
        'Логин: <b>'+esc(u.login)+'</b>'+
        (u.phone ? ' · Тел: '+esc(u.phone) : '') +
        '<br>В архиве с: '+esc(fmtDateTime(u.archivedAt) || '—') +
      '</div>'+
      '<div class="u-acts">'+
        '<button class="btn-line" onclick="adminRestoreUser(\''+esc(u.login)+'\')">'+ic('undo')+'Восстановить</button>'+
      '</div>'+
    '</div>';
  });

  h += '<div class="tblwrap tblwrap--page"><table class="co-tbl u-tbl">'+
    '<thead><tr><th>ФИО</th><th>Логин</th><th>Роль</th><th>В архиве с</th><th>Действия</th></tr></thead>'+
    '<tbody>'+rows+'</tbody>'+
  '</table></div>';
  h += '<div class="u-cards fx-stagger">'+cards+'</div>';

  $('adminContent').innerHTML = h;
  try { restoreViewScroll('admin:archive'); } catch(e){}
}

// ─── Вкладка: Оргструктура ───
function loadAdminDivisions(){
  try { saveViewScroll('admin:divisions:' + (S.adminDivsView || 'tree')); } catch(e){}
  $('adminContent').innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-dim);font-size:14px">Загрузка оргструктуры...</div>';
  call('apiAdminGetDivisions', S.token).then(function(r){
    if(!r || !r.ok){
      var msg = (r && (r.message || r.error)) || 'Ошибка загрузки оргструктуры';
      $('adminContent').innerHTML = '<div class="err">'+esc(msg)+' <button class="btn-ghost" style="margin-left:12px;color:var(--accent)" onclick="loadAdminDivisions()">Повторить</button></div>';
      return;
    }
    S.adminDivs = r.divisions || [];
    S.adminGroupSuggestions = r.groupSuggestions || [];
    renderAdminDivisions();
    ensureAdminUsers();
  }).catch(function(err){
    var msg = (err && (err.message || err.error)) || 'Нет связи с сервером';
    $('adminContent').innerHTML = '<div class="err">'+esc(msg)+' <button class="btn-ghost" style="margin-left:12px;color:var(--accent)" onclick="loadAdminDivisions()">Повторить</button></div>';
  });
}

function ensureAdminUsers(){
  if(S.adminUsers && S.adminUsers.length) return;
  call('apiAdminGetUsers', S.token).then(function(r){
    if(r && r.ok) S.adminUsers = r.users || [];
  }).catch(function(){});
}

// ── Персональный стек отмены (только своя сессия) ───────────────────────────
// Максимум 10 шагов. Стек живёт в S.myUndoStack — сбрасывается при перезагрузке.
function pushUndo(record){
  S.myUndoStack = S.myUndoStack || [];
  S.myUndoStack.push(record);
  if(S.myUndoStack.length > 10) S.myUndoStack.shift(); // ограничиваем глубину
}

function popUndo(){
  S.myUndoStack = S.myUndoStack || [];
  var rec = S.myUndoStack.pop();
  if(!rec){ toast('Нет действий для отмены', 'no'); return; }

  if(rec.action === 'move_unit'){
    // Обратный вызов: вернуть unit на старое место
    call('apiAdminMoveDivision', S.token, {
      unit: rec.unit,
      targetDir: rec.oldDir,
      parentUnit: rec.oldParentUnit || null
    }).then(function(res){
      if(res && res.ok){
        var d = (S.adminDivs || []).find(function(x){ return x.unit === rec.unit; });
        if(d){ d.dir = rec.oldDir; d.parent_unit = rec.oldParentUnit || null; }
        if(rec.oldParentUnit){
          var oldPDiv = (S.adminDivs || []).find(function(x){ return x.unit === rec.oldParentUnit; });
          if(oldPDiv && oldPDiv.parent_unit){
            S.expandedDir = rec.oldDir;
            S.expandedUnit = oldPDiv.parent_unit;
            S.expandedSubUnit = rec.oldParentUnit;
          } else {
            S.expandedDir = rec.oldDir;
            S.expandedUnit = rec.oldParentUnit;
            S.expandedSubUnit = '';
          }
        } else {
          S.expandedDir = rec.oldDir;
          S.expandedUnit = '';
          S.expandedSubUnit = '';
        }
        S.selectedOrgNode = { type: 'unit', unit: rec.unit, dir: rec.oldDir };
        saveNavState();
        toast('Отменено: «' + rec.unit + '» возвращено в «' + rec.oldDir + '»', 'ok');
        renderAdminDivisions();
      } else {
        S.myUndoStack.push(rec); // не удалось — возвращаем в стек
        toast((res && res.error) || 'Не удалось отменить', 'err');
      }
    }).catch(function(){
      S.myUndoStack.push(rec);
      toast('Нет связи с сервером', 'err');
    });

  } else if(rec.action === 'demote_dir'){
    // Обратный вызов: вернуть все отделы в старое направление
    var tasks = rec.units.map(function(u){
      return call('apiAdminMoveDivision', S.token, {
        unit: u.unit,
        targetDir: u.oldDir,
        parentUnit: u.oldParentUnit || null
      });
    });
    Promise.all(tasks).then(function(){
      rec.units.forEach(function(u){
        var d = (S.adminDivs || []).find(function(x){ return x.unit === u.unit; });
        if(d){ d.dir = u.oldDir; d.parent_unit = u.oldParentUnit || null; }
      });
      S.expandedDir = rec.units[0] ? rec.units[0].oldDir : '';
      S.expandedUnit = '';
      saveNavState();
      toast('Отменено: направление возвращено', 'ok');
      renderAdminDivisions();
    }).catch(function(){
      S.myUndoStack.push(rec);
      toast('Не удалось отменить', 'err');
    });

  } else if(rec.action === 'assign_resp'){
    // Обратный вызов: вернуть прежних ответственных подразделения
    call('apiAdminSaveDivision', S.token, {
      unit: rec.unit,
      resp: rec.oldResp
    }).then(function(res){
      if(res && res.ok){
        var d = (S.adminDivs || []).find(function(x){ return x.unit === rec.unit; });
        if(d) d.resp = rec.oldResp;
        if(S.selectedOrgNode && S.selectedOrgNode.unit === rec.unit){
          S.selectedOrgNode.resp = rec.oldResp;
        }
        if(S.token){
          call('apiAdminGetUsers', S.token).then(function(uRes){
            if(uRes && uRes.ok && uRes.users) S.adminUsers = uRes.users;
          }).catch(function(){});
        }
        toast('Отменено: ответственный «' + rec.unit + '» возвращён', 'ok');
        renderAdminDivisions();
      } else {
        S.myUndoStack.push(rec);
        toast((res && res.error) || 'Не удалось отменить', 'err');
      }
    }).catch(function(){
      S.myUndoStack.push(rec);
      toast('Нет связи с сервером', 'err');
    });

  } else if(rec.action === 'save_user_units'){
    // Обратный вызов: вернуть старые подразделения пользователя
    var oldUnitsArr = (rec.oldUnits || '').split(';').map(function(s){ return s.trim(); }).filter(Boolean);
    var u = (S.adminUsers || []).find(function(x){ return x.login === rec.login; });
    if(u){
      var payload = {
        login: u.login,
        fio: u.fio,
        role: u.role,
        phone: u.phone,
        active: u.active,
        units: oldUnitsArr
      };
      call('apiAdminSaveUser', S.token, payload).then(function(res){
        if(res && res.ok){
          u.units = oldUnitsArr;
          loadAdminUsers();
          if(S.token){
            call('apiAdminGetDivisions', S.token).then(function(dRes){
              if(dRes && dRes.ok && dRes.divisions) S.adminDivs = dRes.divisions;
            }).catch(function(){});
          }
          toast('Отменено: подразделения пользователя «' + (u.fio || u.login) + '» возвращены', 'ok');
        } else {
          S.myUndoStack.push(rec);
          toast((res && res.error) || 'Не удалось отменить', 'err');
        }
      }).catch(function(){
        S.myUndoStack.push(rec);
        toast('Нет связи с сервером', 'err');
      });
    }
  }
}

function batchAssignDirection(dir, roleType){
  var title = roleType === 'hrbp' ? 'Закрепить HR BP за направлением «' + dir + '»' : 'Назначить руководителя направления «' + dir + '»';
  var allUsers = S.adminUsers || [];
  var options = allUsers.filter(function(u){ return u.active !== false; }).map(function(u){
    return '<option value="' + esc(u.fio) + '">' + esc(u.fio) + ' (' + esc(u.role) + ')</option>';
  }).join('');

  ask({
    title: title,
    html: '<p style="font-size:13.5px;color:var(--muted);margin-bottom:8px">Назначение применится ко всем отделам направления <b>«' + esc(dir) + '»</b> каскадно.</p>' +
      '<select id="batchPersonSelect" style="width:100%;height:36px;font-size:14px;border-radius:6px;border:1px solid var(--line);padding:0 8px">' +
        '<option value="">-- Выберите сотрудника --</option>' + options +
      '</select>',
    ok: 'Применить ко всем отделам'
  }).then(function(yes){
    if(!yes) return;
    var sel = document.getElementById('batchPersonSelect');
    var fio = sel ? sel.value : '';
    if(!fio) return;

    call('apiAdminBatchAssignDivision', S.token, { dir: dir, roleType: roleType, personName: fio }).then(function(res){
      if(res && res.ok){
        toast('Направление «' + dir + '» обновлено (' + fio + ')', 'ok');
        (S.adminDivs || []).forEach(function(d){
          if(d.dir === dir) d[roleType] = fio;
        });
        renderAdminDivisions();
      } else {
        toast((res && res.error) || 'Ошибка назначения', 'err');
      }
    });
  });
}

function getInitials(name){
  if(!name) return '—';
  var p = String(name).trim().split(/\s+/).filter(Boolean);
  if(!p.length) return '—';
  if(p.length >= 2) return (p[0].charAt(0) + p[1].charAt(0)).toUpperCase();
  return (p[0].charAt(0) || '—').toUpperCase();
}

/** «Валиев Максудчон Абдуганиевич» → «Валиев М. А.» (фамилия + инициалы).
 *  Неразрывные пробелы, чтобы инициалы не переносились. */
function shortFio(name){
  if(!name) return '';
  var raw = String(name).trim();
  if(!raw) return '';
  if(/^(не назначен|руководитель не назначен|ответственный не назначен|нет|—|-)$/i.test(raw)){
    return raw;
  }
  if(raw.indexOf(',') >= 0){
    return raw.split(/\s*,\s*/).map(function(part){
      return shortFio(part);
    }).filter(Boolean).join(', ');
  }
  var p = raw.split(/\s+/).filter(Boolean);
  if(p.length <= 1) return p[0] || '';
  var initials = p.slice(1).map(function(x){
    return x.charAt(0).toUpperCase() + '.';
  });
  return p[0] + ' ' + initials.join(' ');
}

/** Сравнение ФИО на совпадение персоны (с учетом отчества или сокращений) */
function sameFio(a, b){
  if(!a || !b) return false;
  var sa = String(a).trim().toLowerCase();
  var sb = String(b).trim().toLowerCase();
  if(sa === sb) return true;
  var pa = sa.split(/\s+/);
  var pb = sb.split(/\s+/);
  if(pa[0] && pb[0] && pa[0] === pb[0]){
    if(pa[1] && pb[1]){
      return pa[1].charAt(0) === pb[1].charAt(0);
    }
    return true;
  }
  return false;
}

/** Сворачивание подразделений одной смежной группы в одну карточку/строку */
function collapseDivisionsForOrg(divList){
  var groupsMap = {};
  var result = [];

  (divList || []).forEach(function(d){
    var gk = String(d.group_key || '').trim();
    if(!gk){
      result.push(Object.assign({ isGroup: false }, d));
    } else {
      if(!groupsMap[gk]){
        var gObj = {
          isGroup: true,
          group_key: gk,
          unit: gk,
          dir: d.dir || '',
          head: d.head || '',
          resp: d.resp || '',
          hrbp: d.hrbp || '',
          note: d.note || '',
          org_role: d.org_role || 'line',
          members: [d]
        };
        groupsMap[gk] = gObj;
        result.push(gObj);
      } else {
        var g = groupsMap[gk];
        g.members.push(d);
        if(!g.resp && d.resp) g.resp = d.resp;
        if(!g.head && d.head) g.head = d.head;
        if(!g.hrbp && d.hrbp) g.hrbp = d.hrbp;
      }
    }
  });

  result.forEach(function(item){
    if(item.isGroup){
      item.count = item.members.length;
      var resps = uniqSortedList(item.members.map(function(m){ return m.resp || ''; }).filter(Boolean));
      if(resps.length > 0) item.resp = resps.join(', ');
      var heads = uniqSortedList(item.members.map(function(m){ return m.head || ''; }).filter(Boolean));
      if(heads.length > 0) item.head = heads.join(', ');
      var hrbps = uniqSortedList(item.members.map(function(m){ return m.hrbp || ''; }).filter(Boolean));
      if(hrbps.length > 0) item.hrbp = hrbps.join(', ');
    }
  });

  return result;
}

var _orgClickTimer = null;
var _lastCardClickTime = 0;
var _lastCardClickKey = null;

function renderAdminDivisions(){
  var CARD_W = 245, GAP = 16;
  var oldVp = $('orgViewport');
  var prevScrollLeft = oldVp ? oldVp.scrollLeft : (S.orgScroll ? S.orgScroll.left : null);
  var prevScrollTop = oldVp ? oldVp.scrollTop : (S.orgScroll ? S.orgScroll.top : null);

  var divs = S.adminDivs || [];
  var search = (($('divSearch') && $('divSearch').value) ? $('divSearch').value : '').toLowerCase();
  var staffSearch = (($('staffSearch') && $('staffSearch').value) ? $('staffSearch').value : '').toLowerCase();
  var curView = S.adminDivsView || 'tree';

  // Единый кластер кнопок управления оргструктурой — один и тот же порядок и
  // вид в обоих режимах: Схема · Таблица · Смежные группы · Добавить
  // подразделение (· Отменить). Раньше кнопки были раскиданы — в «Таблице»
  // не было «Смежных групп», отступы и порядок различались между видами.
  function orgToolbarBtns(view){
    var adjN = new Set((S.adminDivs || []).map(function(x){ return String(x.group_key || '').trim(); }).filter(Boolean)).size;
    return '<div class="org-toolbar-btns">'+
      '<div class="seg">'+
        '<button class="seg-btn'+(view === 'tree' ? ' on' : '')+'" id="btnOrgTree">' + ic('units', 13) + ' Схема</button>'+
        '<button class="seg-btn'+(view === 'table' ? ' on' : '')+'" id="btnOrgTable">' + ic('book', 13) + ' Таблица</button>'+
      '</div>'+
      '<button class="btn-line" id="btnAdjGroups" style="gap:5px" title="Смежные группы площадок">'+
        ic('link', 13) + ' Смежные группы' + (adjN ? ' ('+adjN+')' : '')+
      '</button>'+
      (hasCap('divisions:edit') ?
        '<button class="btn-line" id="btnAddDivision" style="gap:5px;color:var(--accent);border-color:var(--accent)" title="Создать новое подразделение">'+
          ic('plus', 13) + ' Добавить подразделение</button>'
        : '')+
      ((S.myUndoStack && S.myUndoStack.length) ?
        '<button class="btn-line" id="btnOrgUndo" title="' + esc('Отменить: ' + (S.myUndoStack[S.myUndoStack.length-1].label || 'последнее действие')) + '" style="gap:5px;color:var(--warn);border-color:var(--warn);background:rgba(245,158,11,0.07)">'+
          ic('undo', 13) + ' Отменить</button>'
        : '')+
    '</div>';
  }

  var filtered = divs.filter(function(d){
    if(!d) return false;
    var uStr = (d.unit || '').toLowerCase();
    var dStr = (d.dir || '').toLowerCase();
    var rStr = (d.resp || '').toLowerCase();
    var hStr = (d.head || '').toLowerCase();
    var hbStr = (d.hrbp || '').toLowerCase();
    return !search || uStr.indexOf(search) >= 0 || dStr.indexOf(search) >= 0 ||
      rStr.indexOf(search) >= 0 || hbStr.indexOf(search) >= 0 || hStr.indexOf(search) >= 0;
  });

  // Группировка по направлениям
  var dirGroups = {};
  filtered.forEach(function(d){
    var dirName = d.dir || 'Без направления';
    if(!dirGroups[dirName]) dirGroups[dirName] = [];
    dirGroups[dirName].push(d);
  });

  var dirNames = Object.keys(dirGroups).sort(function(a, b){
    if(a === 'Без направления') return 1;
    if(b === 'Без направления') return -1;
    return a.localeCompare(b, 'ru');
  });

  // Выбранное направление и отдел при первом старте (если не инициализировано)
  if(S.expandedDir === undefined){
    S.expandedDir = '';
  }
  if(S.expandedUnit === undefined){
    S.expandedUnit = '';
  }
  if(S.expandedSubUnit === undefined){
    S.expandedSubUnit = '';
  }
  if(!S.selectedOrgNode && filtered.length > 0){
    var firstUnit = filtered[0];
    S.selectedOrgNode = { type: 'unit', unit: firstUnit.unit, dir: firstUnit.dir, resp: firstUnit.resp, head: firstUnit.head, hrbp: firstUnit.hrbp };
  } else if(S.selectedOrgNode && S.selectedOrgNode.unit){
    var currentObj = (S.adminDivs || []).find(function(x){ return x.unit === S.selectedOrgNode.unit; });
    if(currentObj){
      S.selectedOrgNode.head = currentObj.head;
      S.selectedOrgNode.resp = currentObj.resp;
      S.selectedOrgNode.hrbp = currentObj.hrbp;
      S.selectedOrgNode.dir = currentObj.dir;
    }
  }

  S.orgZoom = S.orgZoom || 0.85;

  var h = '';

  if(curView === 'tree'){
    h += '<div class="org-workspace-root">'+
      // 1. Верхняя панель управления оргструктурой
      '<div class="org-tree-header-bar">'+
        '<div class="org-tree-header-left">'+
          '<div class="org-top-pill-title">' + ic('units', 16) + '<span>Структура компании</span></div>'+
          '<div class="org-tree-search-wrap">'+
            icBare('search', 14)+
            '<input id="divSearch" placeholder="Поиск подразделения…" value="'+esc(search)+'">'+
          '</div>'+
        '</div>'+
        orgToolbarBtns('tree')+
      '</div>';

    var DIR_W = 260, DIR_GAP = 16;
    var CARD_W = 260, GAP = 16;  // ширина и зазор карточек (строго 260px на всех 5 уровнях)

    // ── Системное распознавание органов корпоративного управления (строгое сопоставление) ──
    var isBoardName = function(n){ var s = (n || '').toLowerCase().trim(); return s === 'совет директоров' || s === 'совет директора'; };
    var isExecName = function(n){ var s = (n || '').toLowerCase().trim(); return s === 'правление' || s === 'правление компании' || s === 'исполнительный орган'; };
    var isAuditName = function(n){ var s = (n || '').toLowerCase().trim(); return s.indexOf('аудит') >= 0; };
    var isGovNode = function(d){
      if(!d) return false;
      var name = typeof d === 'string' ? d : (d.unit || d.dir || '');
      var role = typeof d === 'object' ? (d.org_role || '') : '';
      return isBoardName(name) || isExecName(name) || isAuditName(name) || role === 'governance' || role === 'control';
    };

    var boardDirName = dirNames.find(function(d){ return isBoardName(d); }) || null;
    var execDirName = dirNames.find(function(d){ return isExecName(d); }) || null;

    // Служба внутреннего аудита (орган контроля)
    var auditDiv = (S.adminDivs || []).find(function(x){
      return isAuditName(x.unit) || isAuditName(x.dir) || x.org_role === 'control';
    }) || null;
    var auditUnitName = auditDiv ? auditDiv.unit : 'Служба внутреннего аудита';
    var auditHead = auditDiv ? (auditDiv.head || auditDiv.resp || 'Рабиев Илхомджон') : 'Рабиев Илхомджон';
    var auditDir = auditDiv ? (auditDiv.dir || boardDirName || auditUnitName) : (boardDirName || 'Совет директоров');

    // Руководители Совета директоров и Правления компании
    var boardDiv = (S.adminDivs || []).find(function(x){ return isBoardName(x.unit) || isBoardName(x.dir); }) || null;
    var boardHead = boardDiv ? (boardDiv.head || boardDiv.resp || 'Бобочонов Баходур') : 'Бобочонов Баходур';

    var execDiv = (S.adminDivs || []).find(function(x){ return isExecName(x.unit) || isExecName(x.dir); }) || null;
    var execHead = execDiv ? (execDiv.head || execDiv.resp || boardHead) : boardHead;

    // Линейные операционные направления (АХУ и другие 24 департамента)
    var lineDirNames = dirNames.filter(function(d){
      if(isBoardName(d)) return false;
      if(isExecName(d)) return false;
      if(isAuditName(d)) return false;
      return true;
    });

    var totalLineDirW = lineDirNames.length * DIR_W + Math.max(0, lineDirNames.length - 1) * DIR_GAP;

    // ── Единая координатная сетка ────────────────────────────────────────
    var L2_X = 0; // отправная точка ряда линейных департаментов

    // Верхушка корпоративного управления центрируется строго над серединой ряда линейных направлений
    var L1_X = Math.round(L2_X + totalLineDirW / 2 - 130);

    // Центр выбранного направления
    var expDirIdx = S.expandedDir ? lineDirNames.indexOf(S.expandedDir) : -1;
    var dirCenterX = (expDirIdx >= 0)
      ? (L2_X + expDirIdx * (DIR_W + DIR_GAP) + DIR_W / 2)
      : (L2_X + totalLineDirW / 2);

    // Уровень 3: Отделы выбранного направления (исключая системные органы верхушки)
    var rawActiveDirUnits = (S.expandedDir && dirGroups[S.expandedDir])
      ? dirGroups[S.expandedDir].filter(function(d){
          if(d.parent_unit) return false;
          if(d.unit === S.expandedDir) return false;
          if(isGovNode(d)) return false;
          return true;
        })
      : [];
    var activeDirUnits = collapseDivisionsForOrg(rawActiveDirUnits);
    var totalL3W = activeDirUnits.length * CARD_W + Math.max(0, activeDirUnits.length - 1) * GAP;
    var L3_X = (activeDirUnits.length > 0) ? Math.round(dirCenterX - totalL3W / 2) : L2_X;

    // Уровень 4: Подотделы выбранного отдела
    var expUnitIdx = (activeDirUnits || []).findIndex(function(x){ return x.unit === S.expandedUnit; });
    var unitCenterX = (expUnitIdx >= 0)
      ? (L3_X + expUnitIdx * (CARD_W + GAP) + CARD_W / 2)
      : dirCenterX;
    var l4Subunits = [];
    if(S.expandedUnit && expUnitIdx >= 0){
      l4Subunits = (S.adminDivs || []).filter(function(x){
        return x.parent_unit && x.parent_unit === S.expandedUnit && !isGovNode(x);
      });
    }
    var totalL4W = l4Subunits.length * CARD_W + Math.max(0, l4Subunits.length - 1) * GAP;
    var L4_X = (l4Subunits.length > 0) ? Math.round(unitCenterX - totalL4W / 2) : L3_X;

    // Уровень 5: Подотделы раскрытого подотдела 4-го уровня
    var expSubUnitIdx = (l4Subunits || []).findIndex(function(x){ return x.unit === S.expandedSubUnit; });
    var subunitCenterX = (expSubUnitIdx >= 0)
      ? (L4_X + expSubUnitIdx * (CARD_W + GAP) + CARD_W / 2)
      : unitCenterX;
    var l5Subunits = [];
    if(S.expandedSubUnit && expSubUnitIdx >= 0){
      l5Subunits = (S.adminDivs || []).filter(function(x){
        return x.parent_unit && x.parent_unit === S.expandedSubUnit && !isGovNode(x);
      });
    }
    var totalL5W = l5Subunits.length * CARD_W + Math.max(0, l5Subunits.length - 1) * GAP;
    var L5_X = (l5Subunits.length > 0) ? Math.round(subunitCenterX - totalL5W / 2) : L4_X;

    // ── Единый сдвиг: находим самый левый элемент среди ВСЕХ рядов ─────────
    var candidates = [L1_X, L2_X];
    if(activeDirUnits.length > 0) candidates.push(L3_X);
    if(l4Subunits.length > 0) candidates.push(L4_X);
    if(l5Subunits.length > 0) candidates.push(L5_X);
    var SHIFT = Math.max(0, -Math.min.apply(null, candidates));

    // Финальные координаты (все >= 0)
    var ml1 = L1_X + SHIFT; // margin-left для Уровня 1
    var ml2 = L2_X + SHIFT; // margin-left для Уровня 2
    var ml3 = L3_X + SHIFT; // margin-left для Уровня 3
    var ml4 = L4_X + SHIFT; // margin-left для Уровня 4
    var ml5 = L5_X + SHIFT; // margin-left для Уровня 5

    var isBoardActive = (S.selectedOrgNode && (S.selectedOrgNode.dir === boardDirName || S.selectedOrgNode.unit === 'Совет директоров'));
    var isExecActive = (S.selectedOrgNode && (S.selectedOrgNode.dir === execDirName || S.selectedOrgNode.unit === 'Правление'));
    var isAuditActive = (S.selectedOrgNode && (S.selectedOrgNode.unit === auditUnitName || S.selectedOrgNode.dir === auditDir));

    // 2. Рабочее пространство (холст + правая панель)
    h += '<div class="org-workspace-body">'+
      '<div class="org-chart-canvas-wrap" id="orgViewport">'+
        '<div class="org-tree-flow" style="transform:scale('+S.orgZoom+')">'+

          // ── Ярус корпоративного управления (Farovon Holding -> Совет директоров -> Правление + Служба аудита) ──
          '<div class="org-root-level-wrap" style="margin-left:' + ml1 + 'px">'+
            // Ярус 0: Farovon Holding
            '<div class="org-top-holding-card" title="Farovon Holding — Группа компаний">'+
              '<div style="display:flex;align-items:center;gap:10px">'+
                '<div class="org-holding-avatar">' + ic('units', 18) + '</div>'+
                '<div style="overflow:hidden">'+
                  '<div class="org-root-title" style="height:auto;min-height:auto">Farovon Holding</div>'+
                  '<div class="org-root-sub">Группа компаний</div>'+
                '</div>'+
              '</div>'+
            '</div>'+
            '<div class="org-holding-to-board-stem"></div>'+

            // Ярус 1: Совет директоров
            '<div class="org-board-card' + (isBoardActive ? ' is-active-card' : '') + '" draggable="true" data-org-type="dir" data-dir="'+esc(boardDirName || 'Совет директоров')+'" data-u="'+esc(boardDirName || 'Совет директоров')+'" title="Совет директоров — высший орган управления (клик — открыть состав)">'+
              '<div style="display:flex;align-items:center;gap:10px">'+
                '<div class="org-board-avatar">' + (boardHead ? getInitials(boardHead) : ic('units', 18)) + '</div>'+
                '<div style="overflow:hidden;flex:1">'+
                  '<div class="org-root-title" style="height:auto;min-height:auto">Совет директоров</div>'+
                  '<div class="org-root-sub" title="'+(boardHead ? esc(boardHead) : '')+'">'+(boardHead ? esc(shortFio(boardHead)) : 'Высший орган управления')+'</div>'+
                '</div>'+
              '</div>'+
            '</div>'+

            // Развилка под Советом директоров: Правление (по центру) + Служба внутреннего аудита (сбоку)
            '<div class="org-governance-fork-row">'+
              // Колонка 1: Правление компании (Исполнительный орган)
              '<div class="org-gov-col">'+
                '<div class="org-root-card' + (isExecActive ? ' is-active-card' : '') + '" draggable="true" data-org-type="dir" data-dir="'+esc(execDirName || 'Правление')+'" data-u="'+esc(execDirName || 'Правление')+'" data-drop-root="true" title="Правление компании — исполнительный орган (клик — открыть состав)">'+
                  '<div style="display:flex;align-items:center;gap:10px">'+
                    '<div class="org-root-avatar">' + (execHead ? getInitials(execHead) : ic('units', 18)) + '</div>'+
                    '<div style="overflow:hidden;flex:1">'+
                      '<div class="org-root-title" style="height:auto;min-height:auto">Правление компании</div>'+
                      '<div class="org-root-sub" title="'+(execHead ? esc(execHead) : '')+'">'+(execHead ? esc(shortFio(execHead)) : 'Исполнительный орган')+' • '+lineDirNames.length+' направлений</div>'+
                    '</div>'+
                  '</div>'+
                '</div>'+
                '<div class="org-root-arrow-stem"></div>'+
              '</div>'+

              // Колонка 2: Служба внутреннего аудита (Орган независимого контроля)
              '<div class="org-gov-col">'+
                '<div class="org-root-card org-control-card' + (isAuditActive ? ' is-active-card' : '') + '" draggable="true" data-org-type="unit" data-dir="'+esc(auditDir)+'" data-u="'+esc(auditUnitName)+'" title="Служба внутреннего аудита — независимый орган контроля СД (клик — открыть состав)">'+
                  '<div style="width:100%">'+
                    '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px">'+
                      '<div class="org-root-title" style="font-size:13.5px;height:auto;min-height:auto">'+esc(auditUnitName)+'</div>'+
                      '<span style="font-size:9px;font-weight:700;color:var(--no);background:var(--no-soft);padding:2px 6px;border-radius:4px;text-transform:uppercase;letter-spacing:0.03em;flex-shrink:0">Контроль СД</span>'+
                    '</div>'+
                    '<div style="display:flex;align-items:center;gap:10px">'+
                      '<div class="org-root-avatar" style="width:34px;height:34px;background:var(--no-soft);color:var(--no)">'+getInitials(auditHead || auditUnitName)+'</div>'+
                      '<div style="overflow:hidden;flex:1">'+
                        '<div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+(auditHead ? esc(auditHead) : '')+'">'+(auditHead ? esc(shortFio(auditHead)) : 'Руководитель не назначен')+'</div>'+
                        '<div style="font-size:11.5px;color:var(--muted)">Служба аудита</div>'+
                      '</div>'+
                    '</div>'+
                  '</div>'+
                '</div>'+
              '</div>'+
            '</div>'+
          '</div>';

    // Уровень 2: Все линейные операционные направления (24 направления)
    h += '<div class="org-dirs-level-row' + (lineDirNames.length === 1 ? ' has-single-child' : '') + '" style="margin-left:' + ml2 + 'px">';

    lineDirNames.forEach(function(dir){
      var dList = dirGroups[dir] || [];
      var dirApparatus = dList.find(function(x){ return x.unit === dir; });
      var dirHead = (dirApparatus && dirApparatus.head) ? dirApparatus.head : '';
      var dirHrbp = (dirApparatus && dirApparatus.hrbp) ? dirApparatus.hrbp : '';
      if(!dirHead){
        dList.forEach(function(x){ if(!dirHead && x.head) dirHead = x.head; });
      }
      if(!dirHrbp){
        dList.forEach(function(x){ if(!dirHrbp && x.hrbp) dirHrbp = x.hrbp; });
      }

      var subordinateUnits = dList.filter(function(x){ return !x.parent_unit && x.unit !== dir; });

      var isDirExpanded = (S.expandedDir === dir);
      var isDirActive = (S.selectedOrgNode && S.selectedOrgNode.type === 'dir' && S.selectedOrgNode.dir === dir) || isDirExpanded;
      var isFullBranchExpanded = (isDirExpanded && (subordinateUnits.length === 0 || !!S.expandedUnit));

      var unitCountText = subordinateUnits.length ? subordinateUnits.length + ' ' + (subordinateUnits.length === 1 ? 'отдел' : (subordinateUnits.length >= 2 && subordinateUnits.length <= 4 ? 'отдела' : 'отделов')) : 'Аппарат';

      var leftBtnHtml = subordinateUnits.length
        ? '<button type="button" class="org-expand-all-btn' + (isFullBranchExpanded ? ' is-expanded' : '') + '" title="' + (isFullBranchExpanded ? 'Свернуть всю ветку' : 'Раскрыть всю ветку целиком (все уровни)') + '">' +
            ic('units', 12) + '<span>' + unitCountText + '</span>' +
          '</button>'
        : '<span class="org-card-footer-label">' + unitCountText + '</span>';

      var rightBtnHtml = subordinateUnits.length
        ? '<span class="org-expand-tag' + (isDirExpanded && !isFullBranchExpanded ? ' is-open' : (isFullBranchExpanded ? ' is-branch' : '')) + '" title="' + (isDirExpanded ? 'Свернуть направление' : 'Раскрыть на 1 уровень (по одной ветке)') + '">' +
            '1 уровень ' + (isDirExpanded ? '⌃' : '⌄') +
          '</span>'
        : '<span class="org-expand-tag' + (isDirExpanded ? ' is-open' : '') + '">Состав</span>';

      h += '<div class="org-dir-col-item">'+
        '<div class=\'org-card-box' + (isDirActive ? ' is-active-card is-expanded-dir' : '') + '\' draggable="true" data-org-type="dir" data-dir="'+esc(dir)+'" data-u="'+esc(dir)+'" data-drop-dir="'+esc(dir)+'" title="Двойной клик — аппарат и назначение ответственных">'+
          '<div class="org-card-title">'+esc(dir)+'</div>'+
          '<div class="org-card-profile">'+
            '<div class="org-avatar-circle">'+getInitials(dirHead || dirHrbp || dir)+'</div>'+
            '<div class="org-card-profile-info">'+
              '<div class="org-card-name" title="'+(dirHead ? esc(dirHead) : (dirHrbp ? esc(dirHrbp) : ''))+'">'+(dirHead ? esc(shortFio(dirHead)) : (dirHrbp ? esc(shortFio(dirHrbp)) : 'Руководитель не назначен'))+'</div>'+
              '<div class="org-card-role">'+(dirHead ? 'Руководитель' : (dirHrbp ? 'HR BP' : 'Направление'))+'</div>'+
            '</div>'+
          '</div>'+
          '<div class="org-card-footer">'+
            leftBtnHtml +
            rightBtnHtml +
          '</div>'+
        '</div>'+
      '</div>';
    });

    h += '</div>'; // org-dirs-level-row end

    // Уровень 3: Отделы выбранного направления (центрируются строго под своим направлением)
    if(activeDirUnits.length > 0){
      var isSingleDirUnit = (activeDirUnits.length === 1);
      h += '<div class="org-level-section org-level-3-section" style="margin-left:' + ml3 + 'px">'+
        '<div class="org-child-units-row' + (isSingleDirUnit ? ' has-single-child' : '') + '">';

      activeDirUnits.forEach(function(d){
        if(d.isGroup){
          var isGroupExpanded = (S.expandedUnit === d.unit || S.expandedUnit === d.group_key);
          var isGroupActive = (S.selectedOrgNode && (
            (S.selectedOrgNode.type === 'group' && S.selectedOrgNode.groupKey === d.group_key) ||
            (S.selectedOrgNode.type === 'unit' && S.selectedOrgNode.unit === d.group_key)
          )) || isGroupExpanded;
          var headOrResp = d.head || d.resp || d.hrbp || '';

          h += '<div class="org-child-unit-col">'+
            '<div class=\'org-card-box org-card-box--group' + (isGroupActive ? ' is-active-card' : '') + '\' draggable="false" data-org-type="group" data-group-key="'+esc(d.group_key)+'" data-u="'+esc(d.group_key)+'" data-dir="'+esc(d.dir || '')+'" title="Смежная группа из '+d.count+' площадок (клик — состав, двойной клик — назначить)">'+
              '<div class="org-card-subhd">'+
                '<div class="org-card-title" title="«'+esc(d.group_key)+'»">«'+esc(d.group_key)+'»</div>'+
                '<span class="org-lvl-badge" style="background:var(--accent-soft);color:var(--accent);border-color:transparent;font-size:10.5px">Смежная · '+d.count+'</span>'+
              '</div>'+
              '<div class="org-card-profile">'+
                '<div class="org-avatar-circle org-avatar-circle--unit" style="border-color:var(--accent)">'+getInitials(headOrResp || d.group_key)+'</div>'+
                '<div class="org-card-profile-info">'+
                  '<div class="org-card-name" title="'+(headOrResp ? esc(headOrResp) : '')+'">'+(headOrResp ? esc(shortFio(headOrResp)) : 'Не назначен')+'</div>'+
                  '<div class="org-card-role">'+(d.resp ? 'Ответственный' : (d.head ? 'Руководитель' : 'Смежная группа'))+'</div>'+
                '</div>'+
              '</div>'+
              '<div class="org-card-footer">'+
                '<span>' + d.count + ' площадок</span>'+
                '<button type="button" class="btn-line" data-group-assign="'+esc(d.group_key)+'" style="min-height:22px;padding:0 6px;font-size:11px;border-radius:4px">'+icBare('user', 11)+' Назначить</button>'+
              '</div>'+
            '</div>'+
          '</div>';
          return;
        }

        var isUnitExpanded = (S.expandedUnit === d.unit);
        var isUnitActive = (S.selectedOrgNode && S.selectedOrgNode.type === 'unit' && S.selectedOrgNode.unit === d.unit) || isUnitExpanded;
        var headOrResp = d.head || d.resp || d.hrbp || '';
        var subunitsCount = (S.adminDivs || []).filter(function(x){ return x.parent_unit === d.unit; }).length;
        var unitStaffList = (S.adminUsers || []).filter(function(u){
          return u.unit && u.unit.toLowerCase() === d.unit.toLowerCase();
        });

        h += '<div class="org-child-unit-col">'+
          '<div class=\'org-card-box' + (isUnitActive ? ' is-active-card is-expanded-unit' : '') + '\' draggable="true" data-org-type="unit" data-u="'+esc(d.unit)+'" data-dir="'+esc(d.dir || '')+'" title="Зажмите для переноса, двойной клик — ответственные">'+
            '<div class="org-card-title">'+esc(d.unit)+'</div>'+
            '<div class="org-card-profile">'+
              '<div class="org-avatar-circle org-avatar-circle--unit">'+getInitials(headOrResp || d.unit)+'</div>'+
              '<div class="org-card-profile-info">'+
                '<div class="org-card-name" title="'+(headOrResp ? esc(headOrResp) : '')+'">'+(headOrResp ? esc(shortFio(headOrResp)) : 'Не назначен')+'</div>'+
                '<div class="org-card-role">'+(d.head ? 'Руководитель' : (d.resp ? 'Ответственный' : (d.hrbp ? 'HR BP' : 'Сотрудник')))+'</div>'+
              '</div>'+
            '</div>'+
            '<div class="org-card-footer">'+
              '<span>' + (subunitsCount ? subunitsCount + ' подотд.' : (unitStaffList.length ? unitStaffList.length + ' сотр.' : 'Назначить')) + '</span>'+
              '<span class="org-expand-tag'+(isUnitExpanded?' is-open':'')+'">' + (isUnitExpanded ? (subunitsCount ? 'Подотделы ⌃' : 'Состав ⌃') : (subunitsCount ? 'Подотделы ⌄' : 'Состав ⌄')) + '</span>'+
            '</div>'+
          '</div>'+
        '</div>';
      });

      h += '</div></div>'; // org-child-units-row, org-level-section end
    }

    // Уровень 4: Подотделы выбранного отдела (центрируются строго под своим отделом)
    if(l4Subunits.length > 0){
      var isSingleSubunit = (l4Subunits.length === 1);
      h += '<div class="org-level-section org-level-4-section" style="margin-left:' + ml4 + 'px">'+
        '<div class="org-grandchild-staff-row' + (isSingleSubunit ? ' has-single-child' : '') + '">';
      l4Subunits.forEach(function(su){
        var isSubExpanded = (S.expandedSubUnit === su.unit);
        var isSubActive = (S.selectedOrgNode && S.selectedOrgNode.type === 'unit' && S.selectedOrgNode.unit === su.unit) || isSubExpanded;
        var suHead = su.head || su.resp || su.hrbp || '';
        var subStaffList = (S.adminUsers || []).filter(function(u){
          return u.unit && u.unit.toLowerCase() === su.unit.toLowerCase();
        });
        var subSubunitsCount = (S.adminDivs || []).filter(function(x){
          return x.parent_unit && x.parent_unit === su.unit;
        }).length;

        h += '<div class="org-grandchild-col">'+
          '<div class=\'org-card-box' + (isSubActive ? ' is-active-card' : '') + (isSubExpanded ? ' is-expanded-unit' : '') + '\' draggable="true" data-org-type="unit" data-u="'+esc(su.unit)+'" data-dir="'+esc(su.dir || '')+'" title="Зажмите для переноса, двойной клик — ответственные">'+
            '<div class="org-card-subhd">'+
              '<div class="org-card-title">'+esc(su.unit)+'</div>'+
              '<span class="org-lvl-badge org-lvl-badge--sub">Подотдел</span>'+
            '</div>'+
            '<div class="org-card-profile">'+
              '<div class="org-avatar-circle org-avatar-circle--sub">'+getInitials(suHead || su.unit)+'</div>'+
              '<div class="org-card-profile-info">'+
                '<div class="org-card-name" title="'+(suHead ? esc(suHead) : '')+'">'+(suHead ? esc(shortFio(suHead)) : 'Не назначен')+'</div>'+
                '<div class="org-card-role">'+(su.head ? 'Руководитель' : (su.resp ? 'Ответственный' : (su.hrbp ? 'HR BP' : 'Сотрудник')))+'</div>'+
              '</div>'+
            '</div>'+
            '<div class="org-card-footer">'+
              '<span>' + (subSubunitsCount ? subSubunitsCount + ' подотд.' : (subStaffList.length ? subStaffList.length + ' сотр.' : 'Назначить')) + '</span>'+
              '<span class="org-expand-tag org-expand-tag--sub'+(isSubExpanded?' is-open':'')+'">' +
                (isSubExpanded ? (subSubunitsCount ? 'Подотделы ⌃' : 'Состав ⌃') : (subSubunitsCount ? 'Подотделы ⌄' : 'Состав ⌄')) +
              '</span>'+
            '</div>'+
          '</div>'+
        '</div>';
      });
      h += '</div></div>'; // org-grandchild-staff-row, org-level-section end
    }

    // Уровень 5: Подотделы выбранного подотдела 4-го уровня (центрируются строго под своим подотделом)
    if(l5Subunits.length > 0){
      var isSingleL5 = (l5Subunits.length === 1);
      h += '<div class="org-level-section org-level-5-section" style="margin-left:' + ml5 + 'px">'+
        '<div class="org-grandchild-staff-row' + (isSingleL5 ? ' has-single-child' : '') + '">';
      l5Subunits.forEach(function(l5){
        var isL5Active = (S.selectedOrgNode && S.selectedOrgNode.type === 'unit' && S.selectedOrgNode.unit === l5.unit);
        var l5Head = l5.head || l5.resp || l5.hrbp || '';
        var l5StaffList = (S.adminUsers || []).filter(function(u){
          return u.unit && u.unit.toLowerCase() === l5.unit.toLowerCase();
        });

        h += '<div class="org-grandchild-col">'+
          '<div class=\'org-card-box' + (isL5Active ? ' is-active-card' : '') + '\' draggable="true" data-org-type="unit" data-u="'+esc(l5.unit)+'" data-dir="'+esc(l5.dir || '')+'" title="Зажмите для переноса, двойной клик — ответственные">'+
            '<div class="org-card-subhd">'+
              '<div class="org-card-title">'+esc(l5.unit)+'</div>'+
              '<span class="org-lvl-badge org-lvl-badge--l5">Подотдел L5</span>'+
            '</div>'+
            '<div class="org-card-profile">'+
              '<div class="org-avatar-circle org-avatar-circle--l5">'+getInitials(l5Head || l5.unit)+'</div>'+
              '<div class="org-card-profile-info">'+
                '<div class="org-card-name" title="'+(l5Head ? esc(l5Head) : '')+'">'+(l5Head ? esc(shortFio(l5Head)) : 'Не назначен')+'</div>'+
                '<div class="org-card-role">'+(l5.head ? 'Руководитель' : (l5.resp ? 'Ответственный' : (l5.hrbp ? 'HR BP' : 'Сотрудник')))+'</div>'+
              '</div>'+
            '</div>'+
            '<div class="org-card-footer">'+
              '<span>' + (l5StaffList.length ? l5StaffList.length + ' сотр.' : 'Назначить') + '</span>'+
              '<span class="org-expand-tag org-expand-tag--l5">Состав</span>'+
            '</div>'+
          '</div>'+
        '</div>';
      });
      h += '</div></div>'; // org-grandchild-staff-row, org-level-section end
    }

    h += '</div></div>'; // org-tree-flow, org-chart-canvas-wrap end

    // 3. Плавающий фиксированный виджет зума (неподвижен при скролле и зуме)
    h += '<div class="org-bottom-zoom-pill">'+
      '<button class="btn-ghost" id="btnFindMe" style="padding:2px 8px;min-height:26px;font-size:12.5px;font-weight:600;color:var(--accent)">Найти меня</button>'+
      '<div style="width:1px;height:16px;background:var(--line);margin:0 2px"></div>'+
      '<button class="org-zoom-btn" id="btnZoomOut" title="Уменьшить">−</button>'+
      '<span class="org-zoom-pct" id="btnZoomReset" title="Сбросить к 100%">'+Math.round(S.orgZoom * 100)+'%</span>'+
      '<button class="org-zoom-btn" id="btnZoomIn" title="Увеличить">+</button>'+
    '</div>';

    // 4. Правая панель (или кнопка разворачивания, если скрыта)
    if(S.orgDrawerCollapsed){
      h += '<button class="org-drawer-toggle-btn" id="btnToggleDrawer" title="Показать панель состава">' +
        ic('users', 14) + ' <span>Панель состава</span>' +
      '</button>';
    } else {
      var selNode = S.selectedOrgNode || (filtered.length ? { type: 'unit', unit: filtered[0].unit, dir: filtered[0].dir, resp: filtered[0].resp, head: filtered[0].head, hrbp: filtered[0].hrbp } : null);
      var isGroupSelected = selNode && (selNode.type === 'group' || !!selNode.groupKey);
      var selTitle = selNode ? (isGroupSelected ? 'Смежная группа «' + (selNode.groupKey || selNode.unit) + '»' : (selNode.unit || selNode.dir || selNode.fio || 'Подразделение')) : 'Подразделение';

      var allStaff = (S.adminUsers || []).filter(function(u){
        return !staffSearch || (u.fio && u.fio.toLowerCase().indexOf(staffSearch) >= 0) || (u.role && u.role.toLowerCase().indexOf(staffSearch) >= 0);
      });

      var selDir = selNode ? (selNode.dir || (selNode.type === 'dir' ? selNode.unit : '')) : '';
      var selUnit = selNode ? selNode.unit : '';

      var isDeptStaff = function(u){
        var uUnits = u.units || [];
        if(selUnit && uUnits.indexOf(selUnit) >= 0) return true;
        if(selDir && uUnits.indexOf(selDir) >= 0) return true;
        if(selDir && S.adminDivs && S.adminDivs.length){
          var deptDivs = S.adminDivs.filter(function(d){ return d.dir === selDir; });
          var deptUnitNames = deptDivs.map(function(d){ return d.unit; });
          for(var i = 0; i < uUnits.length; i++){
            if(deptUnitNames.indexOf(uUnits[i]) >= 0) return true;
          }
          var fio = (u.fio || '').trim();
          if(fio){
            for(var j = 0; j < deptDivs.length; j++){
              var d = deptDivs[j];
              if((d.head && d.head.indexOf(fio) >= 0) || (d.resp && d.resp.indexOf(fio) >= 0) || (d.hrbp && d.hrbp.indexOf(fio) >= 0)) return true;
            }
          }
        }
        return false;
      };

      var deptStaff = allStaff.filter(isDeptStaff);
      var showAllStaff = !!S.orgStaffShowAll || (deptStaff.length === 0 && !staffSearch);
      var displayStaff = (showAllStaff || staffSearch) ? allStaff : deptStaff;

      var isBoardSelected = isBoardName(selTitle) || (selNode && isBoardName(selNode.unit || selNode.dir));
      var isExecSelected = isExecName(selTitle) || (selNode && isExecName(selNode.unit || selNode.dir));
      var isAuditSelected = isAuditName(selTitle) || (selNode && isAuditName(selNode.unit || selNode.dir));

      var leaders = [];
      if(selNode && selNode.head){
        var headRole = isBoardSelected ? 'Председатель Совета директоров' :
                       (isExecSelected ? 'Председатель Правления' :
                       (isAuditSelected ? 'Руководитель службы аудита' : (selNode.type === 'dir' ? 'Руководитель направления' : (isGroupSelected ? 'Руководитель' : 'Руководитель отдела'))));
        leaders.push({ fio: selNode.head, role: headRole, badge: 'Руководитель', roleType: 'head' });
      }
      if(!isBoardSelected && !isAuditSelected && selNode && selNode.hrbp && !sameFio(selNode.hrbp, selNode.head)){
        leaders.push({ fio: selNode.hrbp, role: 'HR BP направления', badge: 'HR BP', roleType: 'hrbp' });
      }

      function hasLeaderFio(name){
        if(!name) return true;
        return leaders.some(function(l){
          return sameFio(l.fio, name);
        });
      }

      if(!isBoardSelected && selNode && selNode.resp){
        var respList = String(selNode.resp).split(/[,;\n]+/).map(function(s){ return s.trim(); }).filter(Boolean);
        respList.forEach(function(rFio){
          if(!hasLeaderFio(rFio)){
            leaders.push({ fio: rFio, role: 'Ответственный за рынок', badge: 'Ответственный', roleType: 'resp' });
          }
        });
      } else if(isGroupSelected && selNode && selNode.members){
        var gResps = [];
        selNode.members.forEach(function(m){
          String(m.resp || '').split(/[,;\n]+/).forEach(function(s){
            var clean = s.trim();
            if(clean && gResps.indexOf(clean) < 0 && !hasLeaderFio(clean)){
              gResps.push(clean);
            }
          });
        });
        gResps.forEach(function(rFio){
          leaders.push({ fio: rFio, role: 'Ответственный за рынок', badge: 'Ответственный', roleType: 'resp' });
        });
      }

      var selSub = '';
      if(isGroupSelected){
        selSub = (selNode.members ? selNode.members.length : 0) + ' площадок' + (selNode.dir ? ' · ' + selNode.dir : '');
      } else if(isBoardSelected){
        selSub = 'Высший орган управления';
      } else if(isExecSelected){
        selSub = 'Исполнительный орган';
      } else if(isAuditSelected){
        selSub = 'Служба аудита';
      } else if(selNode && selNode.dir && selNode.dir !== selTitle){
        selSub = 'Направление: ' + selNode.dir;
      } else if(selNode && (selNode.type === 'dir' || selNode.dir === selTitle)){
        selSub = 'Направление компании';
      }

      h += '<div class="org-right-drawer">'+
        '<div class="org-drawer-header">'+
          '<div style="min-width:0;flex:1">'+
            '<div class="org-drawer-title">'+esc(selTitle)+'</div>'+
            (selSub ? '<div class="org-drawer-subtitle">'+esc(selSub)+'</div>' : '')+
          '</div>'+
          '<div style="display:flex;align-items:center;gap:2px;flex-shrink:0">'+
            (isGroupSelected ?
              '<button class="btn-ghost" data-group-assign="'+esc(selNode.groupKey || selNode.unit)+'" title="Назначить ответственного" style="padding:2px 6px;min-height:26px;font-size:12px">' + ic('user', 13) + '</button>' :
              '<button class="btn-ghost" data-act="edit-selected-node" title="Редактировать параметры" style="padding:2px 6px;min-height:26px;font-size:12px">' + ic('pencil', 13) + '</button>'
            )+
            '<button class="btn-ghost" id="btnToggleDrawer" title="Скрыть панель" style="padding:2px 6px;min-height:26px;font-size:12px;color:var(--muted)">' + ic('close', 13) + '</button>'+
          '</div>'+
        '</div>'+


        '<div class="org-drawer-stats">'+
          '<div class="org-stat-pill"><span>Сотрудников</span><b>'+deptStaff.length+'</b></div>'+
          '<div class="org-stat-pill"><span>Руководителей</span><b>'+leaders.length+'</b></div>'+
        '</div>'+

        '<div class="org-drawer-search">'+
          '<div class="search-wrap" style="width:100%">'+icBare('search', 13)+
            '<input id="staffSearch" placeholder="Найти по имени или должности…" value="'+esc(staffSearch)+'"></div>'+
        '</div>'+

        '<div class="org-drawer-body">'+
          (isGroupSelected && selNode.members ?
            '<div style="margin-bottom:12px;padding:10px;border-radius:8px;background:var(--card-hover);font-size:12.5px">'+
              '<div style="font-weight:600;margin-bottom:6px;color:var(--text-dim)">Площадки группы ('+selNode.members.length+'):</div>'+
              '<div style="display:flex;flex-direction:column;gap:4px;max-height:150px;overflow-y:auto">'+
                selNode.members.map(function(m){
                  return '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 6px;border-radius:5px;background:var(--bg)">'+
                    '<span>'+esc(m.unit)+'</span>'+
                    (m.region ? '<span class="badge" style="font-size:10px">'+esc(m.region)+'</span>' : '')+
                  '</div>';
                }).join('')+
              '</div>'+
              '<button type="button" class="btn-line" data-group-assign="'+esc(selNode.groupKey || selNode.unit)+'" style="width:100%;margin-top:8px;min-height:28px;font-size:12px">'+icBare('user',12)+' Назначить ответственного группе</button>'+
            '</div>'
          : '')+
          // Руководители
          (leaders.length ?
            '<div class="org-section-lbl">' + ic('users', 14) + 'Руководители ' + leaders.length + '</div>'+
            leaders.map(function(ldr){
              var fullFio = ldr.fio || '';
              var displayFio = shortFio(fullFio);
              return '<div class="org-staff-row org-leader-drop-zone" draggable="true" data-drag-staff="'+esc(fullFio)+'" data-drop-role="'+(ldr.roleType||'head')+'" title="'+esc(fullFio)+' — ' + esc(ldr.role) + ' (зажмите для переноса)">'+
                '<div class="org-avatar-circle" style="background:var(--accent)">'+getInitials(fullFio)+'</div>'+
                '<div style="flex:1;min-width:0;overflow:hidden">'+
                  '<div style="font-size:13.5px;font-weight:600;color:var(--text);display:flex;align-items:center;justify-content:space-between;gap:6px">'+
                    '<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+esc(fullFio)+'">'+esc(displayFio)+'</span>'+
                    '<span class="org-badge-role">'+esc(ldr.badge)+'</span>'+
                  '</div>'+
                  '<div style="font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+esc(ldr.role)+'">'+esc(ldr.role)+'</div>'+
                '</div>'+
                '<span style="cursor:grab;color:var(--muted);flex-shrink:0">' + icBare('more', 14) + '</span>'+
              '</div>';
            }).join('') :
            '<div class="org-section-lbl">' + ic('users', 14) + 'Руководители</div>'+
            '<div class="org-leader-drop-zone" data-drop-role="head" style="border:1.5px dashed var(--line-strong);border-radius:var(--radius-sm);padding:16px 12px;text-align:center;color:var(--muted);font-size:13px;cursor:pointer">+ Перетащите сотрудника сюда для назначения</div>'
          )+

          // Подчинённые / Сотрудники для назначения
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;margin-bottom:6px">'+
            '<div class="org-section-lbl" style="margin:0">' + ic('users', 14) + (showAllStaff ? 'Все сотрудники (' + displayStaff.length + ')' : 'Сотрудники направления (' + displayStaff.length + ')') + '</div>'+
            '<button type="button" class="btn-ghost" id="btnToggleStaffScope" style="font-size:11.5px;padding:2px 8px;min-height:22px;color:var(--accent);border-radius:4px">' +
              (showAllStaff ? 'Только свои (' + deptStaff.length + ')' : 'Все компании (' + allStaff.length + ')') +
            '</button>'+
          '</div>'+
          (displayStaff.length ? displayStaff.map(function(u){
            var fullFio = u.fio || '';
            var displayFio = shortFio(fullFio);
            return '<div class="org-staff-row" draggable="true" data-drag-staff="'+esc(fullFio)+'" data-staff-role="'+esc(u.role)+'" title="'+esc(fullFio)+' — '+(u.role ? esc(u.role) : 'Сотрудник')+' (зажмите для переноса)">'+
              '<div class="org-avatar-circle" style="background:var(--subtle)">'+getInitials(fullFio)+'</div>'+
              '<div style="flex:1;min-width:0;overflow:hidden">'+
                '<div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+esc(fullFio)+'">'+esc(displayFio)+'</div>'+
                '<div style="font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+(u.role ? esc(u.role) : 'Сотрудник')+'">'+(u.role ? esc(u.role) : 'Сотрудник')+'</div>'+
              '</div>'+
              '<span style="cursor:grab;color:var(--muted);flex-shrink:0">' + icBare('more', 14) + '</span>'+
            '</div>';
          }).join('') : '<p style="padding:12px;color:var(--muted);font-size:13px;text-align:center">Сотрудники не найдены</p>')+

        '</div>'+
      '</div>'; // org-drawer-body, org-right-drawer end
    }

    h += '</div></div>'; // org-workspace-body, org-workspace-root end

  } else {
    // Режим таблицы
    var collapsedRows = collapseDivisionsForOrg(filtered);
    h += '<div class="org-tree-wrapper">'+
      '<div class="org-tree-toolbar">'+
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'+
          '<div class="search-wrap">'+icBare('search')+
            '<input id="divSearch" placeholder="Поиск по отделам и направлениям…" value="'+esc(search)+'"></div>'+
          orgToolbarBtns('table')+
        '</div>'+
        '<div>'+tblCount(collapsedRows.length, (S.adminDivs || []).length, ['позиция', 'позиции', 'позиций'])+'</div>'+
      '</div>'+
      '<div class="tblwrap tblwrap--page"><table class="co-tbl co-tbl--pin">'+
        '<thead><tr><th>Направление / Отдел</th><th>Руководитель / Ответственный</th><th>HR BP</th><th>Действия</th></tr></thead><tbody>'+
        collapsedRows.map(function(d){
          if(d.isGroup){
            var respText = d.resp ? ('<span title="'+esc(d.resp)+'">'+esc(shortFio(d.resp))+'</span>') : (d.head ? ('<span title="'+esc(d.head)+'">'+esc(shortFio(d.head))+'</span>') : '<span style="color:var(--warn)">Не назначен</span>');
            var hrbpText = d.hrbp ? ('<span title="'+esc(d.hrbp)+'">'+esc(shortFio(d.hrbp))+'</span>') : '<span style="color:var(--warn)">Не назначен</span>';
            var memberPreview = d.members.map(function(m){ return esc(m.unit); }).slice(0, 3).join(', ') + (d.count > 3 ? ' и ещё ' + (d.count - 3) : '');
            return '<tr class="tr--group">'+
              '<td><b>«'+esc(d.group_key)+'»</b> <span class="badge" style="font-size:11px;margin-left:6px">Смежная · '+d.count+' площ.</span><br><small style="color:var(--muted)">'+esc(d.dir)+' · '+memberPreview+'</small></td>'+
              '<td>'+respText+'</td>'+
              '<td>'+hrbpText+'</td>'+
              '<td><button class="btn-line" data-group-assign="'+esc(d.group_key)+'" style="min-height:28px;font-size:13px;padding:0 10px">'+icBare('user',14)+' Назначить группе</button></td>'+
            '</tr>';
          }
          return '<tr>'+
            '<td><b>'+esc(d.unit)+'</b><br><small style="color:var(--muted)">'+esc(d.dir)+'</small></td>'+
            '<td>'+(d.resp ? ('<span title="'+esc(d.resp)+'">'+esc(shortFio(d.resp))+'</span>') : (d.head ? ('<span title="'+esc(d.head)+'">'+esc(shortFio(d.head))+'</span>') : '<span style="color:var(--warn)">Не назначен</span>'))+'</td>'+
            '<td>'+(d.hrbp ? ('<span title="'+esc(d.hrbp)+'">'+esc(shortFio(d.hrbp))+'</span>') : '<span style="color:var(--warn)">Не назначен</span>')+'</td>'+
            '<td><button class="btn-line" data-u="'+esc(d.unit)+'" style="min-height:28px;font-size:13px;padding:0 10px">'+icBare('pencil',14)+' Назначить</button></td>'+
          '</tr>';
        }).join('')+
      '</tbody></table></div></div>';
  }

  $('adminContent').innerHTML = h;

  // ── Умное центрирование: фокус на активной карточке ──────────────────────
  // Приоритет: самая глубокая раскрытая карточка → раскрытое направление → середина дерева.
  // getBoundingClientRect вызывается синхронно — браузер форсирует layout,
  // поэтому пользователь никогда не видит промежуточное состояние.
  function centerOrgTree(){
    var vpEl = $('orgViewport');
    var tFlow = vpEl ? vpEl.querySelector('.org-tree-flow') : null;
    if(!vpEl || !tFlow) return;

    var vpRect = vpEl.getBoundingClientRect();
    var vpW = vpEl.clientWidth;

    // Ищем самую глубокую раскрытую / активную карточку (L5 > L4 > L3 > L2)
    var focusCard =
      tFlow.querySelector('.org-level-5-section .is-active-card')   ||
      tFlow.querySelector('.org-level-4-section .is-expanded-unit') ||
      tFlow.querySelector('.org-level-4-section .is-active-card')   ||
      tFlow.querySelector('.org-level-3-section .is-expanded-unit') ||
      tFlow.querySelector('.org-level-3-section .is-active-card')   ||
      tFlow.querySelector('.org-dirs-level-row .is-expanded-dir')   ||
      tFlow.querySelector('.org-dirs-level-row .is-active-card');


    if(focusCard){
      // Центр карточки относительно левого края orgViewport (scrollLeft=0 в момент вызова)
      var cardRect = focusCard.getBoundingClientRect();
      var cardCenter = cardRect.left + cardRect.width / 2 - vpRect.left;
      // Ставим scrollLeft так, чтобы центр карточки попал в центр вьюпорта
      vpEl.scrollLeft = Math.max(0, Math.round(cardCenter - vpW / 2));
    } else {
      // Ничего не раскрыто — центрируем всё дерево
      vpEl.scrollLeft = Math.max(0, Math.round((tFlow.scrollWidth - vpW) / 2));
    }
  }



  // Поиск подразделений
  var searchInp = $('divSearch');
  if(searchInp){
    searchInp.oninput = function(){
      var pos = this.selectionStart;
      renderAdminDivisions();
      var again = $('divSearch');
      if(again){ again.focus(); try{ again.setSelectionRange(pos, pos); }catch(e){} }
    };
  }

  // Поиск сотрудников
  var staffInp = $('staffSearch');
  if(staffInp){
    staffInp.oninput = function(){
      var pos = this.selectionStart;
      renderAdminDivisions();
      var again = $('staffSearch');
      if(again){ again.focus(); try{ again.setSelectionRange(pos, pos); }catch(e){} }
    };
  }

  var btnTree = $('btnOrgTree');
  if(btnTree) btnTree.onclick = function(){ S.adminDivsView = 'tree'; saveNavState(); renderAdminDivisions(); };
  var btnTable = $('btnOrgTable');
  if(btnTable) btnTable.onclick = function(){ S.adminDivsView = 'table'; saveNavState(); renderAdminDivisions(); };
  var btnUndo = $('btnOrgUndo');
  if(btnUndo) btnUndo.onclick = popUndo;
  var btnAdjG = $('btnAdjGroups');
  if(btnAdjG) btnAdjG.onclick = openAdjacentGroupsModal;
  var btnAddDiv = $('btnAddDivision');
  if(btnAddDiv) btnAddDiv.onclick = openAddDivisionModal;

  // Конструктор: смена направления через выпадающий список
  var selChangeDir = $('selChangeDir');
  if(selChangeDir && S.selectedOrgNode && S.selectedOrgNode.unit){
    selChangeDir.onchange = function(){
      var newDir = this.value;
      if(newDir && newDir !== S.selectedOrgNode.dir){
        confirmMoveDivision(S.selectedOrgNode.unit, newDir, S.selectedOrgNode.dir);
      }
    };
  }

  var selDemoteDir = $('selDemoteDir');
  if(selDemoteDir && S.selectedOrgNode && S.selectedOrgNode.dir){
    selDemoteDir.onchange = function(){
      var parentDir = this.value;
      if(parentDir && parentDir !== S.selectedOrgNode.dir){
        confirmDemoteDirToUnit(S.selectedOrgNode.dir, parentDir);
      }
    };
  }

  // Масштабирование зума (Pointer-Centered Zoom)
  var treeEl = $('adminContent').querySelector('.org-tree-flow');
  var vp = $('orgViewport');
  if(vp){
    // Вертикальный скролл: сохраняем позицию при перерендере
    if(prevScrollTop !== null){
      vp.scrollTop = prevScrollTop;
    }
    // Горизонталь: центрируем синхронно ДО первого пейнта.
    // Доступ к scrollWidth форсирует синхронный layout — браузер никогда
    // не покажет пользователю нецентрированное состояние.
    centerOrgTree();
  }

  var lastMouseX = null, lastMouseY = null;
  var zoomRafId = null;

  function setZoomAt(newVal, clientX, clientY){
    var oldZoom = S.orgZoom || 0.85;
    var targetZoom = Math.max(0.3, Math.min(2.0, Math.round(newVal * 100) / 100));
    if(Math.abs(targetZoom - oldZoom) < 0.005 || !vp || !treeEl) return;

    var treeRect = treeEl.getBoundingClientRect();
    var vpRect = vp.getBoundingClientRect();

    var mx = (clientX != null) ? clientX : (lastMouseX != null ? lastMouseX : (vpRect.left + vpRect.width / 2));
    var my = (clientY != null) ? clientY : (lastMouseY != null ? lastMouseY : (vpRect.top + vpRect.height / 2));

    var pointInTreeX = (mx - treeRect.left) / oldZoom;
    var pointInTreeY = (my - treeRect.top) / oldZoom;
    var shiftX = pointInTreeX * (targetZoom - oldZoom);
    var shiftY = pointInTreeY * (targetZoom - oldZoom);

    S.orgZoom = targetZoom;
    saveNavState();

    if(zoomRafId) cancelAnimationFrame(zoomRafId);
    zoomRafId = requestAnimationFrame(function(){
      treeEl.style.transform = 'scale(' + S.orgZoom + ')';
      vp.scrollLeft += shiftX;
      vp.scrollTop += shiftY;
      S.orgScroll = { left: vp.scrollLeft, top: vp.scrollTop };
      saveNavState();
      var bReset = $('btnZoomReset');
      if(bReset) bReset.textContent = Math.round(S.orgZoom * 100) + '%';
    });
  }

  if(vp){
    var isPanning = false;
    var startPanX = 0, startPanY = 0;
    var startScrollLeft = 0, startScrollTop = 0;

    vp.addEventListener('scroll', function(){
      S.orgScroll = { left: vp.scrollLeft, top: vp.scrollTop };
      saveNavState();
    }, { passive: true });

    vp.addEventListener('mousedown', function(e){
      if(e.target.closest('.org-card-box') || e.target.closest('.org-root-card') || e.target.closest('.org-tree-header-bar') || e.target.closest('.org-bottom-zoom-pill') || e.target.closest('button') || e.target.closest('input')) return;
      isPanning = true;
      startPanX = e.clientX;
      startPanY = e.clientY;
      startScrollLeft = vp.scrollLeft;
      startScrollTop = vp.scrollTop;
      vp.classList.add('is-dragging-canvas');
    });

    window.addEventListener('mousemove', function(e){
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      if(!isPanning) return;
      var dx = e.clientX - startPanX;
      var dy = e.clientY - startPanY;
      vp.scrollLeft = startScrollLeft - dx;
      vp.scrollTop = startScrollTop - dy;
      S.orgScroll = { left: vp.scrollLeft, top: vp.scrollTop };
    });

    window.addEventListener('mouseup', function(){
      if(isPanning){
        isPanning = false;
        vp.classList.remove('is-dragging-canvas');
        S.orgScroll = { left: vp.scrollLeft, top: vp.scrollTop };
        saveNavState();
      }
    });

    vp.addEventListener('wheel', function(e){
      if(e.ctrlKey || e.metaKey){
        e.preventDefault();
        var factor = e.deltaY < 0 ? 1.12 : 0.88;
        setZoomAt((S.orgZoom || 0.85) * factor, e.clientX, e.clientY);
      }
    }, { passive: false });
  }

  var btnZoomIn = $('btnZoomIn');
  if(btnZoomIn) btnZoomIn.onclick = function(){ setZoomAt((S.orgZoom || 0.85) + 0.15); };
  var btnZoomOut = $('btnZoomOut');
  if(btnZoomOut) btnZoomOut.onclick = function(){ setZoomAt((S.orgZoom || 0.85) - 0.15); };
  var btnZoomReset = $('btnZoomReset');
  if(btnZoomReset) btnZoomReset.onclick = function(){ setZoomAt(1.0); };

  var btnFindMe = $('btnFindMe');
  if(btnFindMe && vp){
    btnFindMe.onclick = function(){
      var activeCard = vp.querySelector('.is-active-card');
      if(activeCard){
        activeCard.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      } else {
        vp.scrollTo({ left: vp.scrollWidth / 4, behavior: 'smooth' });
      }
    };
  }

  // Клики по карточкам и выбор подразделения (с фиксацией положения на экране)
  $('adminContent').onclick = function(e){
    var card = e.target.closest('.org-card-box, .org-control-card, .org-board-card, .org-root-card, .org-top-holding-card');
    if(card){
      var isExpandAllBtn = !!e.target.closest('.org-expand-all-btn');
      var isExpandTag = !!e.target.closest('.org-expand-tag');

      var uName = card.dataset.u;
      var dirName = card.dataset.dir;
      var fio = card.dataset.fio;
      var type = card.dataset.orgType || (uName ? 'unit' : (dirName ? 'dir' : 'root'));
      var cardKey = (type === 'unit' ? uName : (type === 'dir' ? dirName : (fio || 'root')));

      var isGovCard = card.classList.contains('org-root-card') || card.classList.contains('org-board-card') || card.classList.contains('org-control-card') || card.classList.contains('org-top-holding-card') || isBoardName(uName) || isBoardName(dirName) || isExecName(uName) || isExecName(dirName) || isAuditName(uName) || isAuditName(dirName);

      var now = Date.now();
      var isDbl = (_lastCardClickKey === cardKey && (now - _lastCardClickTime) < 380);
      _lastCardClickTime = now;
      _lastCardClickKey = cardKey;

      // 1. ДВОЙНОЙ КЛИК: мгновенно открываем модалку ответственных, отменяя одиночный клик
      if(isDbl && !isExpandAllBtn && !isExpandTag){
        if(_orgClickTimer){
          clearTimeout(_orgClickTimer);
          _orgClickTimer = null;
        }
        _lastCardClickTime = 0;
        _lastCardClickKey = null;
        if(type === 'unit' && uName){
          openStaffModal(uName);
          return;
        } else if(type === 'dir' && dirName){
          openDirStaffModal(dirName);
          return;
        }
      }

      // 2. ОДИНОЧНЫЙ КЛИК: кнопки раскрытия срабатывают мгновенно (0мс), клик по телу карточки откладываем на 240мс для dblclick
      if(_orgClickTimer) clearTimeout(_orgClickTimer);
      var delay = (isExpandTag || isExpandAllBtn) ? 0 : 240;

      _orgClickTimer = setTimeout(function(){
        _orgClickTimer = null;

        var oldVp = $('orgViewport');
        var vpRect = oldVp ? oldVp.getBoundingClientRect() : null;
        var cardRect = card.getBoundingClientRect();
        var cardRelX = vpRect ? (cardRect.left - vpRect.left) : null;
        var cardRelY = vpRect ? (cardRect.top - vpRect.top) : null;

        if(isGovCard){
          // ── ОРГАНЫ КОРПОРАТИВНОГО УПРАВЛЕНИЯ (Холдинг, СД, Правление, Аудит) ──
          var targetName = uName || dirName || (card.classList.contains('org-top-holding-card') ? 'Farovon Holding' : 'Правление компании');
          var targetRole = card.classList.contains('org-top-holding-card') ? 'Холдинг' :
                           (isBoardName(targetName) ? 'Совет директоров' :
                           (isAuditName(targetName) ? 'Служба аудита' : 'Правление компании'));
          var found = (S.adminDivs || []).find(function(x){ return isGovNode(x) && (x.unit === targetName || x.dir === targetName); });
          var targetHead = found ? (found.head || found.resp || '') : '';
          if(!targetHead){
            if(isBoardName(targetName) || isExecName(targetName)) targetHead = 'Бобочонов Баходур';
            else if(isAuditName(targetName)) targetHead = 'Рабиев Илхомджон';
          }

          S.selectedOrgNode = {
            type: 'governance',
            unit: targetName,
            dir: dirName || targetName,
            resp: found ? found.resp : '',
            head: targetHead,
            hrbp: found ? found.hrbp : '',
            roleName: targetRole
          };
          S.orgDrawerCollapsed = false;
          // Внимание: НЕ мутируем S.expandedDir / S.expandedUnit — не сбиваем ветки!
        } else if(type === 'unit' && uName){
          var found = (S.adminDivs || []).find(function(x){ return x.unit === uName; });
          var isChildOfExpandedUnit = found && found.parent_unit && found.parent_unit === S.expandedUnit;
          var isChildOfExpandedSubUnit = found && found.parent_unit && found.parent_unit === S.expandedSubUnit;

          if(isChildOfExpandedUnit){
            // Кликнули по подотделу 4-го уровня
            S.expandedSubUnit = (S.expandedSubUnit === uName) ? '' : uName;
          } else if(isChildOfExpandedSubUnit){
            // Кликнули по подотделу 5-го уровня (конечный узел)
          } else {
            // Кликнули по отделу 3-го уровня
            S.expandedUnit = (S.expandedUnit === uName) ? '' : uName;
            S.expandedSubUnit = '';
          }

          S.selectedOrgNode = {
            type: 'unit',
            unit: uName,
            dir: dirName || (found ? found.dir : ''),
            resp: found ? found.resp : '',
            head: found ? found.head : '',
            hrbp: found ? found.hrbp : ''
          };
          S.orgDrawerCollapsed = false;
        } else if(type === 'staff'){
          S.selectedOrgNode = {
            type: 'staff',
            fio: fio,
            unit: uName
          };
          S.orgDrawerCollapsed = false;
        } else {
          // type === 'dir' (Линейные операционные департаменты)
          var found = (S.adminDivs || []).find(function(x){ return x.unit === dirName || x.dir === dirName; });
          var dList = dirGroups[dirName] || [];
          var subordinateUnits = dList.filter(function(x){ return !x.parent_unit && x.unit !== dirName && !isGovNode(x); });

          if(isExpandAllBtn){
            // ── ЛЕВАЯ КНОПКА: РАСКРЫТЬ ВСЮ ВЕТКУ ЦЕЛИКОМ ──
            var isAlreadyFull = (S.expandedDir === dirName && (subordinateUnits.length === 0 || !!S.expandedUnit));
            if(isAlreadyFull){
              // Сворачиваем всю ветку целиком
              S.expandedDir = '';
              S.expandedUnit = '';
              S.expandedSubUnit = '';
            } else {
              // Раскрываем направление + до самого глубокого подотдела (L3 -> L4 -> L5)
              S.expandedDir = dirName;
              var targetUnit = '';
              var targetSubUnit = '';

              for(var uIdx = 0; uIdx < subordinateUnits.length; uIdx++){
                var uCand = subordinateUnits[uIdx];
                var l4 = (S.adminDivs || []).filter(function(x){ return x.parent_unit === uCand.unit && !isGovNode(x); });
                if(l4.length > 0){
                  targetUnit = uCand.unit;
                  for(var suIdx = 0; suIdx < l4.length; suIdx++){
                    var suCand = l4[suIdx];
                    var l5 = (S.adminDivs || []).filter(function(x){ return x.parent_unit === suCand.unit && !isGovNode(x); });
                    if(l5.length > 0){
                      targetSubUnit = suCand.unit;
                      break;
                    }
                  }
                  if(!targetSubUnit && l4.length > 0){
                    targetSubUnit = l4[0].unit;
                  }
                  break;
                }
              }
              if(!targetUnit && subordinateUnits.length > 0){
                targetUnit = subordinateUnits[0].unit;
              }
              S.expandedUnit = targetUnit;
              S.expandedSubUnit = targetSubUnit;
            }
          } else if(isExpandTag){
            // ── ПРАВАЯ КНОПКА: РАСКРЫТЬ НА 1 УРОВЕНЬ (ПО ОДНОЙ ВЕТКЕ) ──
            if(S.expandedDir === dirName){
              S.expandedDir = '';
              S.expandedUnit = '';
              S.expandedSubUnit = '';
            } else {
              S.expandedDir = dirName;
              S.expandedUnit = '';
              S.expandedSubUnit = '';
            }
          } else {
            // Клик по карточке направления
            if(S.expandedDir === dirName){
              // Уже раскрыто — не сбрасываем
            } else {
              S.expandedDir = dirName;
              S.expandedUnit = '';
              S.expandedSubUnit = '';
            }
          }

          S.selectedOrgNode = {
            type: 'dir',
            dir: dirName,
            unit: dirName,
            resp: found ? found.resp : '',
            head: found ? found.head : '',
            hrbp: found ? found.hrbp : ''
          };
          S.orgDrawerCollapsed = false;
        }
        saveNavState();
        renderAdminDivisions();

        // Фиксация положения: карточка остаётся ровно на тех же координатах экрана
        var newVp = $('orgViewport');
        if(newVp && vpRect && cardRelX !== null){
          var newCard = null;
          if(card.classList.contains('org-control-card')){
            newCard = newVp.querySelector('.org-control-card');
          } else if(card.classList.contains('org-board-card')){
            newCard = newVp.querySelector('.org-board-card');
          } else if(card.classList.contains('org-top-holding-card')){
            newCard = newVp.querySelector('.org-top-holding-card');
          } else if(card.classList.contains('org-root-card')){
            newCard = newVp.querySelector('.org-root-card:not(.org-control-card)');
          } else if(type === 'unit' && uName){
            newCard = newVp.querySelector('.org-card-box[data-u="' + uName.replace(/"/g, '\\"') + '"]');
          } else if(type === 'dir' && dirName){
            newCard = newVp.querySelector('.org-card-box[data-dir="' + dirName.replace(/"/g, '\\"') + '"]');
          } else if(fio){
            newCard = newVp.querySelector('[data-fio="' + fio.replace(/"/g, '\\"') + '"]');
          }

          if(newCard){
            var newRect = newCard.getBoundingClientRect();
            var newVpRect = newVp.getBoundingClientRect();
            var newRelX = newRect.left - newVpRect.left;
            var newRelY = newRect.top - newVpRect.top;
            var deltaX = newRelX - cardRelX;
            var deltaY = newRelY - cardRelY;
            if(Math.abs(deltaX) > 0.2 || Math.abs(deltaY) > 0.2){
              newVp.scrollLeft += deltaX;
              newVp.scrollTop += deltaY;
            }
            S.orgScroll = { left: newVp.scrollLeft, top: newVp.scrollTop };
            saveNavState();
          }
        }
      }, delay);
      return;
    }

    var treeBtn = e.target.closest('#btnOrgTree');
    if(treeBtn){
      S.adminDivsView = 'tree';
      saveNavState();
      renderAdminDivisions();
      return;
    }

    var tableBtn = e.target.closest('#btnOrgTable');
    if(tableBtn){
      S.adminDivsView = 'table';
      saveNavState();
      renderAdminDivisions();
      return;
    }

    var undoBtn = e.target.closest('#btnOrgUndo');
    if(undoBtn){
      popUndo();
      return;
    }

    var promoteBtn = e.target.closest('[data-act="promote-unit"]');
    if(promoteBtn){
      var pUnit = promoteBtn.dataset.u || (S.selectedOrgNode && S.selectedOrgNode.unit);
      if(pUnit) confirmPromoteToDir(pUnit);
      return;
    }

    var toggleDrawerBtn = e.target.closest('#btnToggleDrawer');
    if(toggleDrawerBtn){
      S.orgDrawerCollapsed = !S.orgDrawerCollapsed;
      saveNavState();
      renderAdminDivisions();
      return;
    }

    var toggleStaffScopeBtn = e.target.closest('#btnToggleStaffScope');
    if(toggleStaffScopeBtn){
      S.orgStaffShowAll = !S.orgStaffShowAll;
      saveNavState();
      renderAdminDivisions();
      return;
    }

    var editSelectedBtn = e.target.closest('[data-act="edit-selected-node"]');
    if(editSelectedBtn && S.selectedOrgNode){
      if(S.selectedOrgNode.unit){
        openDivisionModal(S.selectedOrgNode.unit);
      } else if(S.selectedOrgNode.dir){
        batchAssignDirection(S.selectedOrgNode.dir, 'hrbp');
      }
      return;
    }

    var groupAssignBtn = e.target.closest('[data-group-assign]');
    if(groupAssignBtn){
      e.stopPropagation();
      openGroupAssignModal(groupAssignBtn.getAttribute('data-group-assign'));
      return;
    }

    var editBtn = e.target.closest('button[data-u]:not([data-act])');
    if(editBtn){
      openDivisionModal(editBtn.dataset.u);
      return;
    }

    var groupCard = e.target.closest('.org-card-box[data-group-key]');
    if(groupCard && !e.target.closest('button')){
      var gk = groupCard.dataset.groupKey;
      var gDir = groupCard.dataset.dir;
      var gDivs = (S.adminDivs || []).filter(function(x){ return String(x.group_key || '').trim() === gk; });
      S.selectedOrgNode = {
        type: 'group',
        groupKey: gk,
        unit: gk,
        dir: gDir,
        members: gDivs,
        resp: uniqSortedList(gDivs.map(function(m){ return m.resp || ''; }).filter(Boolean)).join(', '),
        head: uniqSortedList(gDivs.map(function(m){ return m.head || ''; }).filter(Boolean)).join(', '),
        hrbp: uniqSortedList(gDivs.map(function(m){ return m.hrbp || ''; }).filter(Boolean)).join(', ')
      };
      S.orgDrawerCollapsed = false;
      renderAdminDivisions();
      return;
    }
  };

  $('adminContent').ondblclick = function(e){
    var groupCard = e.target.closest('.org-card-box[data-group-key]');
    if(groupCard){
      openGroupAssignModal(groupCard.dataset.groupKey);
      return;
    }
    var card = e.target.closest('.org-card-box[data-u]');
    if(card){
      var u = card.dataset.u;
      if(u) openStaffModal(u);
    }
  };

  // ─── Drag-and-Drop: Конструктор уровней и назначение сотрудников ───
  var dragPayload = null; // { type: 'unit'|'dir'|'staff', val: string, oldDir: string }

  $('adminContent').querySelectorAll('.org-card-box[draggable="true"]').forEach(function(el){
    el.addEventListener('dragstart', function(e){
      var isDir = (this.dataset.orgType === 'dir');
      var key = isDir ? this.dataset.dir : this.dataset.u;
      dragPayload = {
        type: isDir ? 'dir' : 'unit',
        val: key,
        oldDir: this.dataset.dir || ''
      };
      e.dataTransfer.setData('text/plain', key);
      e.dataTransfer.effectAllowed = 'move';
      this.classList.add('is-dragging');
    });
    el.addEventListener('dragend', function(){
      this.classList.remove('is-dragging');
      dragPayload = null;
    });
  });

  $('adminContent').querySelectorAll('.org-staff-row[draggable="true"]').forEach(function(el){
    el.addEventListener('dragstart', function(e){
      dragPayload = {
        type: 'staff',
        val: this.dataset.dragStaff
      };
      e.dataTransfer.setData('text/plain', this.dataset.dragStaff);
      e.dataTransfer.effectAllowed = 'copy';
      this.classList.add('is-dragging');
    });
    el.addEventListener('dragend', function(){
      this.classList.remove('is-dragging');
      dragPayload = null;
    });
  });

  // Drop на корень компании (Уровень 1) -> Сделать самостоятельным направлением
  var rootCard = $('adminContent').querySelector('.org-root-card');
  if(rootCard){
    rootCard.addEventListener('dragover', function(e){
      if(dragPayload && (dragPayload.type === 'unit' || dragPayload.type === 'dir')){
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        this.classList.add('drop-target-hover');
      }
    });
    rootCard.addEventListener('dragleave', function(){
      this.classList.remove('drop-target-hover');
    });
    rootCard.addEventListener('drop', function(e){
      e.preventDefault();
      this.classList.remove('drop-target-hover');
      if(dragPayload && dragPayload.val){
        var item = dragPayload.val;
        dragPayload = null;
        confirmPromoteToDir(item);
      }
    });
  }

  // Drop на слоты руководителей в правой панели состава (Drawer)
  $('adminContent').querySelectorAll('.org-leader-drop-zone').forEach(function(targetEl){
    targetEl.addEventListener('dragover', function(e){
      if(!dragPayload || dragPayload.type !== 'staff') return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      this.classList.add('drop-target-hover');
    });
    targetEl.addEventListener('dragleave', function(){
      this.classList.remove('drop-target-hover');
    });
    targetEl.addEventListener('drop', function(e){
      e.preventDefault();
      this.classList.remove('drop-target-hover');
      if(!dragPayload || dragPayload.type !== 'staff') return;

      var staffFio = dragPayload.val;
      var roleType = this.dataset.dropRole || 'head';
      dragPayload = null;

      var sel = S.selectedOrgNode;
      if(!sel) return;

      if(sel.type === 'dir' || isGovNode(sel)){
        promptAssignStaffToDir(staffFio, sel.dir || sel.unit);
      } else {
        promptAssignStaffToUnit(staffFio, sel.unit);
      }
    });
  });

  // Drop на карточки оргструктуры
  $('adminContent').querySelectorAll('.org-card-box').forEach(function(targetEl){
    targetEl.addEventListener('dragover', function(e){
      if(!dragPayload) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = (dragPayload.type === 'staff') ? 'copy' : 'move';
      this.classList.add('drop-target-hover');
    });
    targetEl.addEventListener('dragleave', function(){
      this.classList.remove('drop-target-hover');
    });
    targetEl.addEventListener('drop', function(e){
      e.preventDefault();
      this.classList.remove('drop-target-hover');
      if(!dragPayload) return;

      var targetDir = this.dataset.dir;
      var targetUnit = this.dataset.u;
      var targetType = this.dataset.orgType || 'unit';
      var p = dragPayload;
      dragPayload = null;

      // 1. Назначение сотрудника
      if(p.type === 'staff'){
        if(targetUnit){
          promptAssignStaffToUnit(p.val, targetUnit);
        } else if(targetDir){
          promptAssignStaffToDir(p.val, targetDir);
        }
        return;
      }

      // 2. Перемещение подразделения (Drag-and-Drop)
      if(p.type === 'unit'){
        // Сценарий A: сброшен на карточку НАПРАВЛЕНИЯ (Уровень 2)
        // → переносить отдел напрямую в это направление (сбрасывая parent_unit в null)
        if(targetType === 'dir' && targetDir){
          var curDivObj = (S.adminDivs || []).find(function(x){ return x.unit === p.val; });
          var hasParent = curDivObj && !!curDivObj.parent_unit;
          if(targetDir !== p.oldDir || hasParent){
            confirmMoveDivision(p.val, targetDir, p.oldDir, null);
            return;
          }
          return;
        }
        // Сценарий B: сброшен на карточку другого ОТДЕЛА (Уровень 3 → 4)
        // → отдел становится подотделом, наследует dir целевого отдела
        if(targetType === 'unit' && targetUnit && targetUnit !== p.val){
          var targetDivObj = (S.adminDivs || []).find(function(x){ return x.unit === targetUnit; });
          var parentDir = targetDivObj ? (targetDivObj.dir || targetUnit) : targetUnit;
          if(parentDir){
            confirmMoveDivision(p.val, parentDir, p.oldDir, targetUnit);
          }
          return;
        }
        return;
      }

      // 3. Перемещение направления (Уровень 2)
      if(p.type === 'dir'){
        if(targetType === 'dir' && targetDir && targetDir !== p.val){
          confirmDemoteDirToUnit(p.val, targetDir);
        }
        return;
      }
    });
  });
  try { restoreViewScroll('admin:divisions:' + (S.adminDivsView || 'tree')); } catch(e){}
}

/**
 * Модальное окно ответственных сотрудников подразделения (открывается по двойному клику)
 */
function openStaffModal(unitName){
  var d = (S.adminDivs || []).find(function(x){ return x.unit === unitName; });
  if(!d) return;

  var uStaff = (S.adminUsers || []).filter(function(u){
    var uList = (u.units || []).map(function(s){ return s.toLowerCase(); });
    return uList.indexOf(unitName.toLowerCase()) >= 0;
  });

  var respList = (d.resp || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  var respRowsHtml = respList.length ? respList.map(function(r){
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--card-hover);border-radius:8px">'+
      '<div class="org-avatar-circle org-avatar-circle--resp org-avatar-circle--sm">'+getInitials(r)+'</div>'+
      '<div style="flex:1">'+
        '<div style="font-size:13.5px;font-weight:600;color:var(--text)">'+esc(r)+'</div>'+
        '<div style="font-size:12px;color:var(--muted)">Ответственный за обзор рынка</div>'+
      '</div>'+
    '</div>';
  }).join('') : (
    '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--card-hover);border-radius:8px">'+
      '<div class="org-avatar-circle org-avatar-circle--resp org-avatar-circle--sm">О</div>'+
      '<div style="flex:1">'+
        '<div style="font-size:13.5px;font-weight:600;color:var(--warn)">Не назначен</div>'+
        '<div style="font-size:12px;color:var(--muted)">Ответственный за обзор рынка</div>'+
      '</div>'+
    '</div>'
  );

  var el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = '<div class="sheet-in dlg" style="max-width:480px">'+
    '<div class="sheet-hd">'+
      '<div><b>'+esc(d.unit)+'</b><div style="font-size:13px;color:var(--muted);font-weight:400">'+esc(d.dir || 'Без направления')+'</div></div>'+
      '<button class="btn-ghost" data-x="1">Закрыть</button>'+
    '</div>'+
    (d.parent_unit ?
      '<div style="display:flex;align-items:center;justify-content:space-between;background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.2);padding:6px 10px;border-radius:6px;margin:8px 0">'+
        '<span style="font-size:12.5px;color:var(--text)">Подотдел внутри: <b>«'+esc(d.parent_unit)+'»</b></span>'+
        '<button type="button" id="btnDetachInModal" class="btn-line" style="font-size:12px;min-height:24px;padding:0 8px;border-color:var(--accent);color:var(--accent)">Открепить на Уровень 3</button>'+
      '</div>' : '')+
    '<div style="margin:12px 0 6px 0;font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em">Ответственные лица</div>'+
    '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">'+
      '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--card-hover);border-radius:8px">'+
        '<div class="org-avatar-circle org-avatar-circle--head org-avatar-circle--sm">'+getInitials(d.head || 'Р')+'</div>'+
        '<div style="flex:1">'+
          '<div style="font-size:13.5px;font-weight:600;color:var(--text)">'+(d.head ? esc(d.head) : '<span style="color:var(--warn)">Не назначен</span>')+'</div>'+
          '<div style="font-size:12px;color:var(--muted)">Руководитель отдела</div>'+
        '</div>'+
      '</div>'+
      respRowsHtml +
      '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--card-hover);border-radius:8px">'+
        '<div class="org-avatar-circle org-avatar-circle--hrbp org-avatar-circle--sm">'+getInitials(d.hrbp || 'H')+'</div>'+
        '<div style="flex:1">'+
          '<div style="font-size:13.5px;font-weight:600;color:var(--text)">'+(d.hrbp ? esc(d.hrbp) : '<span style="color:var(--warn)">Не назначен</span>')+'</div>'+
          '<div style="font-size:12px;color:var(--muted)">HR BP направления</div>'+
        '</div>'+
      '</div>'+
    '</div>'+
    (uStaff.length ?
      '<div style="margin:12px 0 6px 0;font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em">Сотрудники отдела ('+uStaff.length+')</div>'+
      '<div style="max-height:160px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;margin-bottom:14px">'+
        uStaff.map(function(u){
          return '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--line);border-radius:6px">'+
            '<div class="org-avatar-circle org-avatar-circle--member org-avatar-circle--xs">'+getInitials(u.fio)+'</div>'+
            '<div style="flex:1;overflow:hidden">'+
              '<div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(u.fio)+'</div>'+
              '<div style="font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(u.role || 'Сотрудник')+'</div>'+
            '</div>'+
          '</div>';
        }).join('')+
      '</div>'
    : '')+
    '<div class="dlg-a">'+
      '<button type="button" class="btn-line" data-x="1">Закрыть</button>'+
      '<button type="button" id="btnStaffModalEdit" class="btn-primary">'+ic('pencil', 13)+'Изменить назначения</button>'+
    '</div>'+
  '</div>';

  document.body.appendChild(el);

  if(el.querySelector('#btnDetachInModal')){
    el.querySelector('#btnDetachInModal').onclick = function(){
      el.remove();
      confirmMoveDivision(unitName, d.dir, d.dir, null);
    };
  }

  el.querySelector('#btnStaffModalEdit').onclick = function(){
    el.remove();
    openDivisionModal(unitName);
  };

  el.addEventListener('click', function(e){
    if(e.target === el || e.target.dataset.x) el.remove();
  });
}

/**
 * Модальное окно ответственных направления (открывается по двойному клику)
 */
function openDirStaffModal(dirName){
  var dList = (S.adminDivs || []).filter(function(x){ return x.dir === dirName; });
  var dirApparatus = dList.find(function(x){ return x.unit === dirName; });
  var dirHead = (dirApparatus && dirApparatus.head) ? dirApparatus.head : '';
  var dirHrbp = (dirApparatus && dirApparatus.hrbp) ? dirApparatus.hrbp : '';
  var dirResp = (dirApparatus && dirApparatus.resp) ? dirApparatus.resp : '';
  if(!dirHead){
    dList.forEach(function(x){ if(!dirHead && x.head) dirHead = x.head; });
  }
  if(!dirHrbp){
    dList.forEach(function(x){ if(!dirHrbp && x.hrbp) dirHrbp = x.hrbp; });
  }

  var dirStaff = (S.adminUsers || []).filter(function(u){
    return u.unit && (u.unit.toLowerCase() === dirName.toLowerCase() || (u.dir && u.dir.toLowerCase() === dirName.toLowerCase() && u.role === 'dir_head'));
  });

  var el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = '<div class="sheet-in dlg" style="max-width:500px">'+
    '<div class="sheet-hd">'+
      '<div><b>'+esc(dirName)+'</b><div style="font-size:13px;color:var(--muted);font-weight:400">Направление • '+dList.length+' подразделений</div></div>'+
      '<button class="btn-ghost" data-x="1">Закрыть</button>'+
    '</div>'+
    '<div style="margin:12px 0 6px 0;font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em">Руководство направления</div>'+
    '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">'+
      '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--card-hover);border-radius:8px">'+
        '<div class="org-avatar-circle org-avatar-circle--head org-avatar-circle--sm">'+getInitials(dirHead || 'Р')+'</div>'+
        '<div style="flex:1">'+
          '<div style="font-size:13.5px;font-weight:600;color:var(--text)">'+(dirHead ? esc(dirHead) : '<span style="color:var(--warn)">Не назначен</span>')+'</div>'+
          '<div style="font-size:12px;color:var(--muted)">Руководитель направления</div>'+
        '</div>'+
      '</div>'+
      (dirResp ?
        '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--card-hover);border-radius:8px">'+
          '<div class="org-avatar-circle org-avatar-circle--resp org-avatar-circle--sm">'+getInitials(dirResp)+'</div>'+
          '<div style="flex:1">'+
            '<div style="font-size:13.5px;font-weight:600;color:var(--text)">'+esc(dirResp)+'</div>'+
            '<div style="font-size:12px;color:var(--muted)">Ответственный за обзор рынка аппарата</div>'+
          '</div>'+
        '</div>' : '')+
      '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--card-hover);border-radius:8px">'+
        '<div class="org-avatar-circle org-avatar-circle--hrbp org-avatar-circle--sm">'+getInitials(dirHrbp || 'H')+'</div>'+
        '<div style="flex:1">'+
          '<div style="font-size:13.5px;font-weight:600;color:var(--text)">'+(dirHrbp ? esc(dirHrbp) : '<span style="color:var(--warn)">Не назначен</span>')+'</div>'+
          '<div style="font-size:12px;color:var(--muted)">HR BP направления</div>'+
        '</div>'+
      '</div>'+
    '</div>'+
    (dirStaff.length ?
      '<div style="margin:12px 0 6px 0;font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em">Сотрудники аппарата ('+dirStaff.length+')</div>'+
      '<div style="max-height:150px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;margin-bottom:14px">'+
        dirStaff.map(function(u){
          return '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--line);border-radius:6px">'+
            '<div class="org-avatar-circle org-avatar-circle--member org-avatar-circle--xs">'+getInitials(u.fio)+'</div>'+
            '<div style="flex:1;overflow:hidden">'+
              '<div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(u.fio)+'</div>'+
              '<div style="font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(u.role || 'Сотрудник')+'</div>'+
            '</div>'+
          '</div>';
        }).join('')+
      '</div>'
    : '')+
    '<div class="dlg-a" style="gap:8px;flex-wrap:wrap">'+
      '<button type="button" class="btn-line" data-x="1">Закрыть</button>'+
      (dirApparatus ? '<button type="button" id="btnDirStaffEditApparatus" class="btn-line" style="border-color:var(--accent);color:var(--accent)">'+ic('pencil', 13)+'Назначения аппарата</button>' : '')+
      '<button type="button" id="btnDirStaffModalAssign" class="btn-primary">'+ic('users', 13)+'Назначить HR BP на все отделы</button>'+
    '</div>'+
  '</div>';

  document.body.appendChild(el);

  if(el.querySelector('#btnDirStaffEditApparatus')){
    el.querySelector('#btnDirStaffEditApparatus').onclick = function(){
      el.remove();
      openDivisionModal(dirName);
    };
  }

  el.querySelector('#btnDirStaffModalAssign').onclick = function(){
    el.remove();
    var allFio = uniqSortedList((S.adminUsers || []).map(function(u){ return u.fio; }));
    openPicker({
      title: 'Выберите HR BP для направления «' + dirName + '»',
      list: allFio,
      value: dirHrbp,
      onPick: function(chosenFio){
        promptAssignStaffToDir(chosenFio, dirName);
      }
    });
  };

  el.addEventListener('click', function(e){
    if(e.target === el || e.target.dataset.x) el.remove();
  });
}

function confirmMoveDivision(unit, targetDir, oldDir, parentUnit){
  var isSubunit = !!parentUnit;
  var curDiv = (S.adminDivs || []).find(function(x){ return x.unit === unit; });
  var hadParent = curDiv && !!curDiv.parent_unit;

  var title = isSubunit ? 'Прикрепить подотдел' : (hadParent ? 'Открепить подотдел' : 'Перенести подразделение');
  var msg;
  if(isSubunit){
    msg = 'Сделать подразделение <b>«' + esc(unit) + '»</b> подотделом внутри <b>«' + esc(parentUnit) + '»</b> (направление: «' + esc(targetDir) + '»)?';
  } else if(hadParent){
    msg = 'Открепить <b>«' + esc(unit) + '»</b> и сделать самостоятельным отделом направления <b>«' + esc(targetDir) + '»</b>?';
  } else {
    msg = 'Перенести подразделение <b>«' + esc(unit) + '»</b> из «' + esc(oldDir || 'Без направления') + '» в направление <b>«' + esc(targetDir) + '»</b>?';
  }

  ask({
    title: title,
    html: msg,
    ok: isSubunit ? 'Прикрепить' : (hadParent ? 'Открепить' : 'Перенести')
  }).then(function(yes){
    if(!yes) return;
    // Сохраняем состояние ДО изменения
    var curDiv5668 = (S.adminDivs || []).find(function(x){ return x.unit === unit; });
    pushUndo({ action: 'move_unit', unit: unit, oldDir: oldDir || (curDiv5668 && curDiv5668.dir) || '', oldParentUnit: curDiv5668 && curDiv5668.parent_unit, label: 'перенос «' + unit + '»' });
    call('apiAdminMoveDivision', S.token, {
      unit: unit,
      targetDir: targetDir,
      parentUnit: parentUnit || null
    }).then(function(res){
      if(res && res.ok){
        var d = (S.adminDivs || []).find(function(x){ return x.unit === unit; });
        if(d){
          d.dir = targetDir;
          d.parent_unit = parentUnit || null;
        }
        if(parentUnit){
          var pDiv2 = (S.adminDivs || []).find(function(x){ return x.unit === parentUnit; });
          if(pDiv2 && pDiv2.parent_unit){
            // parentUnit сам является подотделом 4-го уровня -> открываем L3 и L4
            S.expandedDir = targetDir;
            S.expandedUnit = pDiv2.parent_unit;
            S.expandedSubUnit = parentUnit;
          } else {
            // parentUnit является отделом 3-го уровня
            S.expandedDir = targetDir;
            S.expandedUnit = parentUnit;
            S.expandedSubUnit = '';
          }
        } else {
          S.expandedDir = targetDir;
          S.expandedUnit = '';
          S.expandedSubUnit = '';
        }
        S.selectedOrgNode = { type: 'unit', unit: unit, dir: targetDir };
        saveNavState();
        toast(res.message || 'Подразделение перенесено', 'ok');
        renderAdminDivisions();
      } else {
        toast((res && res.error) || 'Ошибка перемещения', 'no');
      }
    }).catch(function(){
      toast('Нет связи с сервером', 'no');
    });
  });
}

function confirmPromoteToDir(unit){
  ask({
    title: 'Повысить до направления',
    html: 'Сделать подразделение <b>«' + esc(unit) + '»</b> самостоятельным направлением (Уровень 2)?',
    ok: 'Повысить'
  }).then(function(yes){
    if(!yes) return;
    call('apiAdminMoveDivision', S.token, {
      unit: unit,
      targetDir: unit,
      parentUnit: null
    }).then(function(res){
      if(res && res.ok){
        var d = (S.adminDivs || []).find(function(x){ return x.unit === unit; });
        if(d){
          d.dir = unit;
          d.parent_unit = null;
        }
        S.expandedDir = unit;
        S.expandedUnit = '';
        saveNavState();
        toast('Подразделение повышено до направления', 'ok');
        renderAdminDivisions();
      } else {
        toast((res && res.error) || 'Ошибка повышения', 'no');
      }
    }).catch(function(){
      toast('Нет связи с сервером', 'no');
    });
  });
}

function confirmDemoteDirToUnit(dir, targetDir){
  ask({
    title: 'Переместить направление в состав другого',
    html: 'Переместить все отделы направления <b>«' + esc(dir) + '»</b> в направление <b>«' + esc(targetDir) + '»</b>?',
    ok: 'Переместить'
  }).then(function(yes){
    if(!yes) return;
    var affected = (S.adminDivs || []).filter(function(x){ return x.dir === dir; });
    if(!affected.length){
      toast('Нет отделов в направлении', 'no');
      return;
    }
    var tasks = affected.map(function(d){
      return call('apiAdminMoveDivision', S.token, {
        unit: d.unit,
        targetDir: targetDir,
        parentUnit: null
      });
    });
    Promise.all(tasks).then(function(){
      affected.forEach(function(d){ d.dir = targetDir; d.parent_unit = null; });
      S.expandedDir = targetDir;
      S.expandedUnit = '';
      saveNavState();
      toast('Направление объединено с «' + targetDir + '»', 'ok');
      renderAdminDivisions();
    }).catch(function(){
      toast('Ошибка переноса направления', 'no');
    });
  });
}

function promptAssignStaffToDir(fio, targetDir){
  ask({
    title: 'Назначение на направление',
    html: 'Назначить сотрудника <b>«' + esc(fio) + '»</b> HR BP направления <b>«' + esc(targetDir) + '»</b>?',
    ok: 'Назначить как HR BP'
  }).then(function(yes){
    if(!yes) return;
    call('apiAdminBatchAssignDivision', S.token, {
      dir: targetDir,
      roleType: 'hrbp',
      personName: fio
    }).then(function(res){
      if(res && res.ok){
        (S.adminDivs || []).forEach(function(d){
          if(d.dir === targetDir) d.hrbp = fio;
        });
        toast('Сотрудник ' + fio + ' назначен HR BP на направление «' + targetDir + '»', 'ok');
        renderAdminDivisions();
      } else {
        toast((res && res.error) || 'Ошибка назначения', 'no');
      }
    }).catch(function(){
      toast('Нет связи с сервером', 'no');
    });
  });
}

function promptAssignStaffToUnit(fio, targetUnit){
  var divObj = (S.adminDivs || []).find(function(x){ return x.unit === targetUnit; });
  if(!divObj){
    toast('Отдел не найден', 'no');
    return;
  }
  ask({
    title: 'Назначение на отдел',
    html: 'Назначить сотрудника <b>«' + esc(fio) + '»</b> ответственным за отдел <b>«' + esc(targetUnit) + '»</b>?',
    ok: 'Назначить'
  }).then(function(yes){
    if(!yes) return;
    var payload = {
      unit: divObj.unit,
      dir: divObj.dir,
      head: divObj.head || fio,
      resp: fio,
      hrbp: divObj.hrbp || '',
      note: divObj.note || '',
      group: divObj.group_key || ''
    };
    call('apiAdminSaveDivision', S.token, payload).then(function(res){
      if(res && res.ok){
        divObj.resp = fio;
        if(!divObj.head) divObj.head = fio;
        toast('Сотрудник ' + fio + ' назначен на отдел «' + targetUnit + '»', 'ok');
        renderAdminDivisions();
      } else {
        toast((res && res.error) || 'Ошибка сохранения', 'no');
      }
    }).catch(function(){
      toast('Нет связи с сервером', 'no');
    });
  });
}

/**
 * Управление смежными группами: список существующих (с «Разъединить») +
 * ручная сборка новой группы из произвольных подразделений.
 * Автоподсказки по конкретному подразделению живут в его карточке
 * (openDivisionModal, блок #dmGrpSug).
 */
// Создание нового подразделения. Раньше через приложение завести отдел было
// нельзя — saveDivision только обновляет существующие строки. Минимум —
// название; направление и ответственные необязательны и дозаполняются в
// обычной панели справа. См. adminController.createDivision.
function openAddDivisionModal(){
  var dirs = [];
  (S.adminDivs || []).forEach(function(x){
    var d = String(x.dir || '').trim();
    if(d && dirs.indexOf(d) < 0) dirs.push(d);
  });
  dirs.sort(function(a, b){ return a.localeCompare(b, 'ru'); });

  var people = (S.adminUsers || [])
    .filter(function(u){ return u && u.active && u.fio; })
    .map(function(u){ return u.fio; })
    .sort(function(a, b){ return a.localeCompare(b, 'ru'); });
  var personOpts = function(){
    return '<option value="">— не назначен —</option>' +
      people.map(function(f){ return '<option value="'+esc(f)+'">'+esc(f)+'</option>'; }).join('');
  };

  var preDir = (S.selectedOrgNode && S.selectedOrgNode.dir) || '';

  var el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = '<div class="sheet-in" style="max-width:520px">'+
    '<div class="sheet-hd"><b>Новое подразделение</b><button class="btn-ghost" data-x="1">Закрыть</button></div>'+
    '<div id="adErr" class="err hidden" style="margin-bottom:8px"></div>'+

    '<label class="lbl">Название подразделения *</label>'+
    '<input id="adName" placeholder="напр. Отдел логистики Анхор" style="width:100%">'+

    '<label class="lbl" style="margin-top:10px">Направление</label>'+
    '<select id="adDir" style="width:100%">'+
      '<option value="">— без направления —</option>'+
      dirs.map(function(d){ return '<option value="'+esc(d)+'"'+(d === preDir ? ' selected' : '')+'>'+esc(d)+'</option>'; }).join('')+
      '<option value="__new__">➕ Новое направление…</option>'+
    '</select>'+
    '<input id="adDirNew" placeholder="Название нового направления" style="width:100%;margin-top:6px" hidden>'+

    '<div class="field-grid" style="margin-top:10px">'+
      '<div><label class="lbl">Руководитель отдела</label><select id="adHead" style="width:100%">'+personOpts()+'</select></div>'+
      '<div><label class="lbl">Ответственный за обзор</label><select id="adResp" style="width:100%">'+personOpts()+'</select></div>'+
    '</div>'+
    '<label class="lbl" style="margin-top:10px">HR BP</label>'+
    '<select id="adHrbp" style="width:100%">'+personOpts()+'</select>'+

    '<p class="step-hint" style="margin:10px 0 0">Регион, смежную группу и подчинение подотделу можно задать после создания — в панели справа.</p>'+
    '<div style="height:14px"></div>'+
    '<button id="adCreate" class="btn-primary">Создать подразделение</button>'+
    '<div style="height:8px"></div>'+
  '</div>';
  document.body.appendChild(el);
  el.addEventListener('click', function(e){ if(e.target === el || e.target.dataset.x) el.remove(); });

  var dirSel = el.querySelector('#adDir');
  var dirNew = el.querySelector('#adDirNew');
  dirSel.onchange = function(){
    dirNew.hidden = dirSel.value !== '__new__';
    if(!dirNew.hidden) dirNew.focus();
  };
  el.querySelector('#adName').focus();

  var showErr = function(msg){
    var box = el.querySelector('#adErr');
    box.textContent = msg; box.classList.remove('hidden');
  };

  el.querySelector('#adCreate').onclick = function(){
    var name = (el.querySelector('#adName').value || '').trim();
    if(!name){ showErr('Укажите название подразделения'); return; }
    var dir = dirSel.value === '__new__'
      ? (dirNew.value || '').trim()
      : dirSel.value;
    if(dirSel.value === '__new__' && !dir){ showErr('Укажите название нового направления'); return; }

    var body = {
      unit: name,
      dir: dir,
      head: el.querySelector('#adHead').value || '',
      resp: el.querySelector('#adResp').value || '',
      hrbp: el.querySelector('#adHrbp').value || ''
    };
    var btn = this; btn.disabled = true; btn.textContent = 'Создаём…';
    call('apiAdminCreateDivision', S.token, body).then(function(res){
      if(res && res.ok){
        toast('Подразделение «'+name+'» создано', 'ok');
        el.remove();
        // приземлиться на новый отдел, чтобы сразу дозаполнить
        S.selectedOrgNode = { type: 'unit', unit: name, dir: dir };
        if(dir) S.expandedDir = dir;
        loadAdminDivisions();
      } else {
        btn.disabled = false; btn.textContent = 'Создать подразделение';
        showErr((res && (res.error || res.message)) || 'Не удалось создать');
      }
    }).catch(function(){
      btn.disabled = false; btn.textContent = 'Создать подразделение';
      showErr('Нет связи с сервером');
    });
  };
}

function bindMultiPickFioField(root, id, title, listFn, store, key, emptyLabel){
  var btn = root.querySelector('#'+id);
  if(!btn) return;
  btn.onclick = function(){
    var currentSelected = (store[key] || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
    openMultiPicker({
      title: title,
      list: listFn(),
      value: currentSelected,
      emptyLabel: emptyLabel,
      onPick: function(arr){
        store[key] = arr.join(', ');
        var sp = btn.querySelector('span');
        if(sp){
          sp.textContent = store[key] || emptyLabel || 'Выбрать из пользователей';
          sp.className = store[key] ? '' : 'ph';
        }
      }
    });
  };
}

function openGroupAssignModal(groupKey){
  if(!groupKey) return;
  var members = (S.adminDivs || []).filter(function(x){
    return String(x.group_key || '').trim() === String(groupKey).trim();
  });
  if(!members.length){
    toast('В группе нет площадок', 'no');
    return;
  }

  var curResps = uniqSortedList(members.map(function(x){ return x.resp || ''; }).filter(Boolean));
  var curRespVal = curResps.join(', ');

  var el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = '<div class="sheet-in" style="max-width:540px">'+
    '<div class="sheet-hd"><b>Назначить ответственного · «'+esc(groupKey)+'»</b><button class="btn-ghost" data-x="1">Закрыть</button></div>'+
    '<p class="step-hint" style="margin:4px 0 14px">Ответственный будет назначен сразу на все '+members.length+' площадок этой смежной группы и получит доступ к заполнению рынка по ним.</p>'+
    '<div style="margin-bottom:14px;padding:10px 12px;border-radius:8px;background:var(--card-hover);font-size:12.5px">'+
      '<div style="font-weight:600;margin-bottom:6px;color:var(--text-dim)">Площадки группы ('+members.length+'):</div>'+
      '<div style="display:flex;flex-wrap:wrap;gap:4px;max-height:120px;overflow-y:auto">'+
        members.map(function(m){ return '<span class="badge">'+esc(m.unit)+(m.region ? ' · '+esc(m.region) : '')+'</span>'; }).join('')+
      '</div>'+
    '</div>'+
    '<label class="lbl">Ответственные за обзор рынка</label>'+
    pickField('grpRespField', curRespVal, 'Выбрать из пользователей')+
    '<div style="height:18px"></div>'+
    '<button id="grpSaveResp" class="btn-primary">Сохранить для всех '+members.length+' площадок</button>'+
    '<div style="height:8px"></div>'+
  '</div>';
  document.body.appendChild(el);
  el.addEventListener('click', function(e){ if(e.target === el || e.target.dataset.x) el.remove(); });

  var picked = { resp: curRespVal };
  var allFios = uniqSortedList((S.adminUsers || []).filter(function(u){ return u.active !== 0; }).map(function(u){ return u.fio; }));

  bindMultiPickFioField(el, 'grpRespField', 'Ответственные за обзор', function(){ return allFios; }, picked, 'resp', 'Выбрать из пользователей');

  el.querySelector('#grpSaveResp').onclick = function(){
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Сохраняем…';
    var newResp = picked.resp;

    var promises = members.map(function(d){
      return call('apiAdminSaveDivision', S.token, {
        unit: d.unit,
        dir: d.dir,
        head: d.head,
        resp: newResp,
        hrbp: d.hrbp,
        note: d.note,
        group: d.group_key,
        region: d.region,
        org_role: d.org_role
      });
    });

    Promise.all(promises).then(function(results){
      var failed = results.filter(function(r){ return !r || !r.ok; });
      if(failed.length > 0){
        toast('Часть площадок не удалось обновить ('+failed.length+')', 'no');
      } else {
        toast('Ответственный назначен на все '+members.length+' площадок', 'ok');
      }
      el.remove();
      loadAdminDivisions();
      if(S.token){
        call('apiAdminGetUsers', S.token).then(function(uRes){
          if(uRes && uRes.ok) S.adminUsers = uRes.users || [];
        });
      }
    }).catch(function(){
      btn.disabled = false;
      btn.textContent = 'Сохранить для всех площадок';
      toast('Ошибка сети при сохранении', 'no');
    });
  };
}

function openAdjacentGroupsModal(){
  var divs = (S.adminDivs || []).slice();
  var groups = {};
  divs.forEach(function(x){
    var k = String(x.group_key || '').trim();
    if(k) (groups[k] = groups[k] || []).push(x);
  });
  var groupKeys = Object.keys(groups).sort(function(a, b){ return a.localeCompare(b, 'ru'); });

  var el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = '<div class="sheet-in" style="max-width:640px">'+
    '<div class="sheet-hd"><b>Смежные группы площадок</b><button class="btn-ghost" data-x="1">Закрыть</button></div>'+
    '<p class="step-hint" style="margin:4px 0 14px">Площадки одной группы заполняют рынок один раз — данные сохраняются сразу во все площадки группы (различаются регионом или производственной площадкой).</p>'+

    '<div class="lbl" style="margin-bottom:6px">Существующие группы ('+groupKeys.length+')</div>'+
    (groupKeys.length
      ? '<div class="ag-list">'+groupKeys.map(function(k){
          var mems = groups[k];
          var curResps = uniqSortedList(mems.map(function(x){ return x.resp || ''; }).filter(Boolean));
          var respStr = curResps.length ? curResps.join(', ') : 'Не назначен';
          return '<div class="ag-grp">'+
            '<div class="ag-grp-h">'+
              '<div>'+
                '<b>«'+esc(k)+'»</b>'+
                '<span style="margin-left:8px">'+mems.length+' площадок</span>'+
                '<div style="font-size:12px;color:var(--text-dim);margin-top:2px">'+
                  icBare('user', 12)+' <b>Ответственный:</b> '+esc(respStr)+
                '</div>'+
              '</div>'+
              '<div style="display:flex;gap:6px;align-items:center">'+
                '<button type="button" class="btn-line ag-assign" data-key="'+esc(k)+'">'+icBare('user', 12)+' Назначить</button>'+
                '<button type="button" class="btn-line ag-clear" data-key="'+esc(k)+'">Разъединить</button>'+
              '</div>'+
            '</div>'+
            '<div class="ag-grp-u">'+mems.map(function(x){ return '<span>'+esc(x.unit)+(x.region ? ' · '+esc(x.region) : '')+'</span>'; }).join('')+'</div>'+
          '</div>';
        }).join('')+'</div>'
      : '<div class="ag-empty">Пока ни одной группы</div>')+

    '<div class="lbl" style="margin:18px 0 6px">Собрать группу вручную</div>'+
    '<input id="agName" placeholder="Название группы (напр. «Склад ГП»)" style="width:100%">'+
    '<input id="agSearch" placeholder="Поиск подразделения…" style="width:100%;margin-top:8px">'+
    '<div class="ag-pick" id="agPick"></div>'+
    '<div style="height:10px"></div>'+
    '<button id="agCreate" class="btn-primary">Создать группу</button>'+
    '<div style="height:8px"></div>'+
  '</div>';
  document.body.appendChild(el);
  el.addEventListener('click', function(e){ if(e.target === el || e.target.dataset.x) el.remove(); });

  var renderPick = function(){
    var q = ($('agSearch').value || '').toLowerCase().trim();
    var rows = divs.filter(function(x){
      if(!x.unit) return false;
      if(!q) return true;
      return x.unit.toLowerCase().indexOf(q) >= 0 || String(x.dir || '').toLowerCase().indexOf(q) >= 0;
    }).slice(0, 200);
    $('agPick').innerHTML = rows.map(function(x){
      var g = String(x.group_key || '').trim();
      return '<label class="ag-pick-u">'+
        '<input type="checkbox" value="'+esc(x.unit)+'">'+
        '<span>'+esc(x.unit)+'</span>'+
        (g ? '<em class="ag-in">в «'+esc(g)+'»</em>' : (x.dir ? '<em class="dim">'+esc(x.dir)+'</em>' : ''))+
      '</label>';
    }).join('') || '<div class="ag-empty">Ничего не найдено</div>';
  };
  $('agSearch').oninput = renderPick;
  renderPick();

  [].slice.call(el.querySelectorAll('.ag-assign')).forEach(function(b){
    b.onclick = function(){
      var k = b.getAttribute('data-key');
      openGroupAssignModal(k);
    };
  });

  [].slice.call(el.querySelectorAll('.ag-clear')).forEach(function(b){
    b.onclick = function(){
      var k = b.getAttribute('data-key');
      b.disabled = true; b.textContent = 'Разъединяем…';
      call('apiAdminClearAdjacentGroup', S.token, k).then(function(res){
        if(res && res.ok){ toast('Группа «'+k+'» разъединена ('+res.cleared+')', 'ok'); el.remove(); loadAdminDivisions(); }
        else { b.disabled = false; b.textContent = 'Разъединить'; toast((res && res.error) || 'Не удалось', 'no'); }
      }).catch(function(){ b.disabled = false; b.textContent = 'Разъединить'; toast('Нет связи с сервером', 'no'); });
    };
  });

  $('agCreate').onclick = function(){
    var name = ($('agName').value || '').trim();
    var picked = [].slice.call($('agPick').querySelectorAll('input:checked')).map(function(c){ return { unit: c.value }; });
    if(!name){ toast('Укажите название группы', 'no'); return; }
    if(picked.length < 2){ toast('Отметьте минимум 2 подразделения', 'no'); return; }
    var btn = this; btn.disabled = true; btn.textContent = 'Создаём…';
    call('apiAdminApplyAdjacentGroup', S.token, { key: name, units: picked, force: true }).then(function(res){
      if(res && res.ok){ toast('Группа «'+res.key+'» создана ('+res.applied+' площадок)', 'ok'); el.remove(); loadAdminDivisions(); }
      else { btn.disabled = false; btn.textContent = 'Создать группу'; toast((res && res.error) || 'Не удалось', 'no'); }
    }).catch(function(){ btn.disabled = false; btn.textContent = 'Создать группу'; toast('Нет связи с сервером', 'no'); });
  };
}

/**
 * opts.restricted — режим dir_head: направление и HR BP только на просмотр,
 * меняются лишь руководитель отдела и ответственный за обзор (см. saveDivision
 * на сервере — та же граница проверяется и там, это не только фронт).
 * opts.onSaved — что перерисовать после сохранения (по умолчанию — таблица админки).
 */
function openDivisionModal(unit, opts){
  opts = opts || {};
  if(unit){
    try { markActiveItem('divrow_' + unit, 'admin:divisions:' + (S.adminDivsView || 'table')); } catch(e){}
  }
  var restricted = !!opts.restricted;
  var onSaved = opts.onSaved || loadAdminDivisions;

  var d = (S.adminDivs || []).find(function(x){ return x.unit === unit; });
  if(!d) return;

  // Автоопределённая смежная группа для этого подразделения (сервер прислал
  // предложения в groupSuggestions). Показываем подсказку с кнопкой «Объединить»
  // только если ручной group_key ещё не задан.
  var groupSug = (!restricted && !String(d.group_key || '').trim())
    ? (S.adminGroupSuggestions || []).find(function(s){
        return (s.units || []).some(function(u){ return u.unit === d.unit; });
      })
    : null;

  var lockedField = function(v){
    return '<div class="pick" style="opacity:.6;pointer-events:none">'+
      '<span'+(v?'':' class="ph"')+'>'+esc(v || '—')+'</span></div>';
  };

  var el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = '<div class="sheet-in">'+
    '<div class="sheet-hd"><b>'+esc(d.unit)+'</b>'+
      '<button class="btn-ghost" data-x="1">Закрыть</button></div>'+
    '<label class="lbl" style="margin-top:4px">Направление</label>'+
    (restricted ? lockedField(d.dir) : pickField('dmDir', d.dir, 'Выбрать направление'))+
    '<label class="lbl">Руководитель отдела</label>'+
    pickField('dmHead', d.head, 'Выбрать из пользователей')+
    '<label class="lbl">Ответственный за обзор</label>'+
    pickField('dmResp', d.resp, 'Выбрать из пользователей')+
    '<label class="lbl">HR BP</label>'+
    (restricted ? lockedField(d.hrbp) : pickField('dmHrbp', d.hrbp, 'Выбрать из пользователей'))+
    (restricted ? '' :
      '<label class="lbl">Регион <span style="font-weight:400;color:var(--muted)">'+
        '(город / регион подразделения — разрез на дашборде)</span></label>'+
      '<input id="dmRegion" list="dmRegionList" value="'+esc(d.region || '')+'" '+
        'placeholder="например: Душанбе — оставьте пустым, если не нужно">'+
      '<datalist id="dmRegionList">'+
        uniqSortedList(
          (((S.data && S.data.regions) || [])
            .concat((S.adminDivs || []).map(function(x){ return x.region; })))
            .filter(Boolean)
        ).map(function(x){ return '<option value="'+esc(x)+'">'; }).join('')+
      '</datalist>')+
    (restricted ? '' :
      '<label class="lbl">Смежная группа <span style="font-weight:400;color:var(--muted)">'+
        '(площадки с одинаковой структурой должностей — разные регионом или производственной площадкой)</span></label>'+
      (groupSug ?
        '<div class="dm-grpsug" id="dmGrpSug">'+
          '<div class="dm-grpsug-body">'+
            '<div class="dm-grpsug-t">'+ic('link', 14)+'Похоже на смежную группу <b>«'+esc(groupSug.key)+'»</b>. Отметьте площадки:</div>'+
            '<div class="dm-grpsug-units">'+groupSug.units.map(function(u){
              var cur = u.unit === d.unit;
              return '<label class="dm-grpsug-u'+(cur ? ' is-cur' : '')+'">'+
                '<input type="checkbox" value="'+esc(u.unit)+'" data-region="'+esc(u.region || '')+'" checked'+(cur ? ' disabled' : '')+'>'+
                '<span>'+esc(u.unit)+(u.region ? ' · '+esc(u.region) : '')+'</span>'+
              '</label>';
            }).join('')+'</div>'+
            '<button type="button" class="btn-line" id="dmGrpSugApply">Объединить отмеченные</button>'+
          '</div>'+
        '</div>'
      : '')+
      // Без datalist: раньше сюда падал список ВСЕХ ключей групп холдинга, и на
      // карточке транспортного отдела браузер автодополнял «Хозяйственная
      // служба» — выглядело как ошибочная подсказка. Реальные предложения
      // приходят выше (#dmGrpSug), диалог «Смежные группы» — для ручной сборки.
      '<input id="dmGroup" value="'+esc(d.group_key || '')+'" '+
        'placeholder="например: служба_охраны — оставьте пустым, если площадка одна">')+
    (restricted ? '' :
      '<label class="lbl">Роль в структуре холдинга</label>'+
      '<select id="dmOrgRole" style="width:100%">'+
        '<option value="line"'+((d.org_role||'line')==='line'?' selected':'')+'>Линейное операционное направление</option>'+
        '<option value="control"'+((d.org_role)==='control'?' selected':'')+'>Орган независимого контроля / Служба аудита</option>'+
        '<option value="governance"'+((d.org_role)==='governance'?' selected':'')+'>Орган корпоративного управления (Совет директоров / Правление)</option>'+
      '</select>')+
    '<label class="lbl">Примечание</label>'+
    '<input id="dmNote" value="'+esc(d.note)+'">'+
    '<div style="height:16px"></div>'+
    '<button id="dmSave" class="btn-primary">Сохранить</button>'+
  '</div>';

  document.body.appendChild(el);

  // Кнопка «Объединить отмеченные» в подсказке автоопределённой смежной группы:
  // берём только отмеченные чекбоксы (текущее подразделение всегда включено),
  // проставляем им общий group_key разом (сервер добьёт пустой region).
  if(groupSug){
    var sugBtn = el.querySelector('#dmGrpSugApply');
    if(sugBtn) sugBtn.onclick = function(){
      var chosen = [].slice.call(el.querySelectorAll('#dmGrpSug input[type="checkbox"]'))
        .filter(function(c){ return c.checked; })
        .map(function(c){ return { unit: c.value, region: c.getAttribute('data-region') || '' }; });
      if(chosen.length < 2){ toast('Отметьте минимум 2 площадки', 'no'); return; }
      sugBtn.disabled = true; sugBtn.textContent = 'Объединяем…';
      call('apiAdminApplyAdjacentGroup', S.token, { key: groupSug.key, units: chosen }).then(function(res){
        if(res && res.ok){
          var unitNames = {};
          chosen.forEach(function(u){ unitNames[u.unit] = u.region || ''; });
          (S.adminDivs || []).forEach(function(x){
            if(unitNames.hasOwnProperty(x.unit) && !String(x.group_key || '').trim()){
              x.group_key = res.key;
              if(!String(x.region || '').trim() && unitNames[x.unit]) x.region = unitNames[x.unit];
            }
          });
          S.adminGroupSuggestions = (S.adminGroupSuggestions || []).filter(function(s){ return s.key !== groupSug.key || s.dir !== groupSug.dir; });
          d.group_key = res.key;
          var gi = el.querySelector('#dmGroup'); if(gi) gi.value = res.key;
          var gr = el.querySelector('#dmRegion'); if(gr && !gr.value.trim() && unitNames[d.unit]) gr.value = unitNames[d.unit];
          var sugBox = el.querySelector('#dmGrpSug'); if(sugBox) sugBox.remove();
          toast('Объединено в смежную группу «' + res.key + '» (' + res.applied + ' площадок)', 'ok');
        } else {
          sugBtn.disabled = false; sugBtn.textContent = 'Объединить отмеченные';
          toast((res && res.error) || 'Не удалось объединить', 'no');
        }
      }).catch(function(){
        sugBtn.disabled = false; sugBtn.textContent = 'Объединить отмеченные';
        toast('Нет связи с сервером', 'no');
      });
    };
  }

  // Три поля из четырёх — это ФИО живых людей и название направления, то есть
  // значения, которые уже есть в системе. Свободный ввод здесь означал, что
  // «Каримов Дилшодчон Зафарчонович» и «Каримов Д.З.» становились разными
  // людьми, а подразделение с опечаткой в направлении выпадало из отчётов.
  var picked = { dir: d.dir || '', head: d.head || '', resp: d.resp || '', hrbp: d.hrbp || '' };

  if(!restricted){
    bindPickField(el, 'dmDir', 'Направление', function(){
      return uniqSortedList((S.data.allUnits || []).map(function(x){ return x.dir; }));
    }, picked, 'dir');
  }

  var allFio = function(){
    return uniqSortedList((S.adminUsers || []).map(function(u){ return u.fio; }));
  };

  /**
   * В выпадающем списке показываем ТОЛЬКО сотрудников этого департамента или подразделения.
   * Контекст формируется строго по подразделению d.unit и департаменту d.dir:
   * 1. Сотрудники, у которых в units прикреплен этот отдел (d.unit) или это направление (d.dir).
   * 2. Лица, уже упомянутые в руководстве/ответственных (head, resp, hrbp) этого отдела или направления.
   */
  var deptFio = function(){
    var thisDir = (d.dir || '').toLowerCase().trim();
    var thisUnit = (d.unit || '').toLowerCase().trim();

    var targetUnits = {};
    if(thisUnit) targetUnits[thisUnit] = true;
    if(thisDir){
      targetUnits[thisDir] = true;
      (S.adminDivs || []).forEach(function(x){
        if((x.dir || '').toLowerCase().trim() === thisDir){
          targetUnits[(x.unit || '').toLowerCase().trim()] = true;
        }
      });
    }

    var names = {};
    (S.adminUsers || []).forEach(function(u){
      if(u.active === false) return;
      var inDept = (u.units || []).some(function(un){
        return targetUnits[String(un || '').toLowerCase().trim()];
      });
      if(inDept && u.fio) names[u.fio.trim()] = true;
    });

    (S.adminDivs || []).forEach(function(x){
      if((x.dir || '').toLowerCase().trim() === thisDir || (x.unit || '').toLowerCase().trim() === thisUnit){
        [x.head, x.resp, x.hrbp].forEach(function(field){
          String(field || '').split(',').forEach(function(n){
            n = n.trim();
            if(n) names[n] = true;
          });
        });
      }
    });

    return uniqSortedList(Object.keys(names));
  };

  var fioList = deptFio;
  var fioEmptyLabel = 'В этом департаменте / подразделении пока нет привязанных сотрудников';

  function bindMultiPickFioField(root, id, title, listFn, store, key, emptyLabel){
    var btn = root.querySelector('#'+id);
    if(!btn) return;
    btn.onclick = function(){
      var currentSelected = (store[key] || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
      openMultiPicker({
        title: title,
        list: listFn(),
        value: currentSelected,
        emptyLabel: emptyLabel,
        onPick: function(arr){
          store[key] = arr.join(', ');
          var sp = btn.querySelector('span');
          if(sp){
            sp.textContent = store[key] || emptyLabel || 'Выбрать из пользователей';
            sp.className = store[key] ? '' : 'ph';
          }
        }
      });
    };
  }

  bindPickField(el, 'dmHead', 'Руководитель отдела', fioList, picked, 'head', fioEmptyLabel);
  bindMultiPickFioField(el, 'dmResp', 'Ответственные за обзор', fioList, picked, 'resp', fioEmptyLabel);
  if(!restricted){
    bindPickField(el, 'dmHrbp', 'HR BP', allFio, picked, 'hrbp');
  }

  var isDirty = function(){
    var note = el.querySelector('#dmNote').value.trim();
    var group = restricted ? (d.group_key || '') : el.querySelector('#dmGroup').value.trim();
    var region = restricted ? (d.region || '') : el.querySelector('#dmRegion').value.trim();
    var roleEl = el.querySelector('#dmOrgRole');
    var orgRoleVal = roleEl ? roleEl.value : (d.org_role || 'line');
    return picked.dir !== (d.dir || '') || picked.head !== (d.head || '') ||
      picked.resp !== (d.resp || '') || picked.hrbp !== (d.hrbp || '') ||
      note !== (d.note || '') || group !== (d.group_key || '') ||
      region !== (d.region || '') || orgRoleVal !== (d.org_role || 'line');
  };
  guardClose(el, isDirty);

  el.querySelector('#dmSave').onclick = function(){
    var roleEl = el.querySelector('#dmOrgRole');
    var orgRoleVal = roleEl ? roleEl.value : (d.org_role || 'line');
    var payload = {
      unit: d.unit,
      dir: picked.dir,
      head: picked.head,
      resp: picked.resp,
      hrbp: picked.hrbp,
      note: el.querySelector('#dmNote').value.trim(),
      group: restricted ? d.group_key || '' : el.querySelector('#dmGroup').value.trim(),
      region: restricted ? d.region || '' : el.querySelector('#dmRegion').value.trim(),
      org_role: orgRoleVal,
      is_survey_target: orgRoleVal === 'governance' ? 0 : 1
    };
    var btn = this;
    btn.disabled = true; btn.textContent = 'Сохраняем…';
    call('apiAdminSaveDivision', S.token, payload).then(function(res){
      btn.disabled = false; btn.textContent = 'Сохранить';
      if(res && res.ok){
        pushUndo({
          action: 'assign_resp',
          unit: d.unit,
          oldResp: d.resp || '',
          newResp: payload.resp || ''
        });

        // Мгновенная синхронизация локальных данных в памяти
        d.dir = payload.dir;
        d.head = payload.head;
        d.resp = payload.resp;
        d.hrbp = payload.hrbp;
        d.note = payload.note;
        d.group_key = payload.group;
        d.region = payload.region;
        d.org_role = payload.org_role;
        d.is_survey_target = payload.is_survey_target;

        if(S.selectedOrgNode && (S.selectedOrgNode.unit === d.unit || S.selectedOrgNode.dir === d.dir)){
          S.selectedOrgNode.head = payload.head;
          S.selectedOrgNode.resp = payload.resp;
          S.selectedOrgNode.hrbp = payload.hrbp;
          S.selectedOrgNode.dir = payload.dir;
        }

        // Обновляем список пользователей для синхронизации галочек в разделе "Пользователи"
        if(S.token){
          call('apiAdminGetUsers', S.token).then(function(uRes){
            if(uRes && uRes.ok && uRes.users) S.adminUsers = uRes.users;
          }).catch(function(){});
        }

        el.remove();
        toast('Подразделение обновлено', 'ok');
        onSaved();
      } else {
        toast((res && res.error) || 'Ошибка', 'err');
      }
    }).catch(function(){
      btn.disabled = false; btn.textContent = 'Сохранить';
      toast('Нет связи с сервером', 'err');
    });
  };
}

// ═══════════════════════════════════════════════════════════
// dir_head: НАЗНАЧЕНИЕ ОТВЕТСТВЕННЫХ ПО СВОЕМУ НАПРАВЛЕНИЮ
// ═══════════════════════════════════════════════════════════
/**
 * Экран для роли dir_head — тот же список/модалка, что в админской
 * «Оргструктуре» (openDivisionModal переиспользуется в restricted-режиме),
 * но сервер отдаёт и принимает только отделы направления, закреплённого
 * за этим руководителем администратором (см. getDivisions/saveDivision).
 */
function openDeptAssign(){
  if(window.WorkspaceTabs && WorkspaceTabs.openTab && !WorkspaceTabs.isInsideTabRun){
    WorkspaceTabs.openTab({
      key: 'dept_assign',
      title: 'Назначить ответственных',
      icon: 'clipboard',
      state: { appView: 'dept_assign', unit: null },
      run: function(){ openDeptAssign(); }
    });
    return;
  }
  S.appView = 'dept_assign';
  S.unit = null;
  saveNavState();
  renderTopNav();
  S.backTo = null;
  // Пункт верхнего уровня, не подэкран — «Назад» без S.backTo уводила
  // в «Мои подразделения».
  setTop('Назначить ответственных', userLabel(), false);
  $('bar').classList.add('hidden');
  $('body').onclick = null;
  $('body').innerHTML = skTable();
  Promise.all([
    call('apiAdminGetDivisions', S.token),
    call('apiAdminGetUsers', S.token)
  ]).then(function(res){
    var rDiv = res[0], rUsr = res[1];
    if(!rDiv || !rDiv.ok){
      $('body').innerHTML = '<div class="err">'+esc((rDiv&&rDiv.error)||'Ошибка загрузки')+'</div>';
      return;
    }
    S.adminDivs = rDiv.divisions || [];
    if(rUsr && rUsr.ok) S.adminUsers = rUsr.users || [];
    drawDeptAssign();
  }).catch(function(){
    $('body').innerHTML = '<div class="err">Нет связи с сервером</div>';
  });
}

// Сотрудники ТОЛЬКО этого направления (dir_head видит в S.adminDivs лишь свои
// отделы — см. adminController.getDivisions). Раньше сюда попадал ВЕСЬ
// справочник пользователей: deptUnits считался, но фильтр по нему не
// применялся. Логика та же, что у deptFio в openDivisionModal.
function getDeptEmployees(){
  var deptUnits = {};
  (S.adminDivs || []).forEach(function(x){ deptUnits[x.unit] = true; });
  var names = {};
  // 1. У кого в профиле есть хоть один отдел этого направления.
  (S.adminUsers || []).forEach(function(u){
    if(u.active === false || !u.fio) return;
    if((u.units || []).some(function(un){ return deptUnits[un]; })) names[u.fio] = true;
  });
  // 2. Кто уже руководитель / ответственный / HR BP отдела направления.
  (S.adminDivs || []).forEach(function(x){
    [x.head, x.resp, x.hrbp].forEach(function(field){
      String(field || '').split(',').forEach(function(n){
        n = n.trim();
        if(n) names[n] = true;
      });
    });
  });
  var list = uniqSortedList(Object.keys(names));
  // Совсем новое направление — никто не привязан: не запираем в тупик,
  // показываем весь активный справочник.
  if(!list.length){
    return uniqSortedList((S.adminUsers || [])
      .filter(function(u){ return u.active !== false && u.fio; })
      .map(function(u){ return u.fio; }));
  }
  return list;
}

function drawDeptAssign(){
  var divs = S.adminDivs || [];
  var search = ($('deptSearch') ? $('deptSearch').value : '').toLowerCase();
  var employees = getDeptEmployees();

  var filtered = divs.filter(function(d){
    return !search || d.unit.toLowerCase().indexOf(search) >= 0 ||
      (d.resp||'').toLowerCase().indexOf(search) >= 0 || (d.head||'').toLowerCase().indexOf(search) >= 0;
  });

  var myDir = (S.data.user.units || [])[0] || (divs[0] && divs[0].dir) || '';
  var h = '<p class="step-hint">Отделы направления «'+esc(myDir)+'». Назначьте ответственного за заполнение обзора рынка — можно выбрать сотрудника с живым поиском прямо в строке или назначить одного на все отделы сразу.</p>';
  
  h += '<div class="toolbar" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px">'+
    '<div style="display:flex;align-items:center;gap:10px;flex:1;min-width:260px">'+
      '<div class="search-wrap" style="flex:1">'+icBare('search')+
        '<input id="deptSearch" placeholder="Поиск по отделу, ответственным…" value="'+esc(search)+'"></div>'+
      tblCount(filtered.length, divs.length, ['отдел', 'отдела', 'отделов'])+
    '</div>'+
    '<button id="btnBulkAssign" class="btn-primary toolbar-act" style="min-height:32px;font-size:13.5px;padding:0 14px;white-space:nowrap">'+
      ic('users', 14)+'Назначить на все отделы'+
    '</button>'+
  '</div>';

  h += '<div class="tblwrap tblwrap--page rtbl"><table class="co-tbl co-tbl--pin">'+
    '<thead><tr><th>Отдел</th><th>Текущий ответственный</th><th style="min-width:280px">Быстрое назначение с поиском</th><th style="width:50px;text-align:center">Инфо</th></tr></thead><tbody>'+
    (filtered.length ? filtered.map(function(d){
      var curAssignee = (d.resp || d.head || '').trim();
      var isAssigned = !!curAssignee;

      return '<tr>'+
        '<td><b>'+esc(d.unit)+'</b></td>'+
        '<td>'+(isAssigned ? '<span style="font-weight:600">'+esc(curAssignee)+'</span>' : '<span style="color:var(--warn)">Не назначен</span>')+'</td>'+
        '<td>'+
          '<button type="button" class="pick dept-pick-btn" data-unit="'+esc(d.unit)+'" style="width:100%;min-height:32px;text-align:left;display:flex;align-items:center;justify-content:space-between;padding:0 10px;border:1px solid '+(isAssigned?'var(--line)':'var(--warn)')+'">'+
            '<span class="'+(isAssigned?'':'ph')+'">'+(isAssigned ? esc(curAssignee) : ic('search', 13)+'Выбрать сотрудника…')+'</span>'+
            '<i style="color:var(--muted);flex:none;display:inline-flex">'+icBare('chevron', 14)+'</i>'+
          '</button>'+
        '</td>'+
        '<td style="text-align:center">'+
          '<button class="btn-ghost" data-u="'+esc(d.unit)+'" title="Детальные настройки (руководитель, ответственный, заметка)" style="border:1px solid var(--line);min-height:32px;padding:0 8px;font-size:13px">'+ic('pencil', 13)+'</button>'+
        '</td>'+
      '</tr>';
    }).join('') : '<tr><td colspan="4"><div class="empty">Ничего не найдено</div></td></tr>')+
  '</tbody></table></div>';

  // Карточный вариант для узких экранов (turn-24f): строка → карточка отдела,
  // незакрытый отдел выделен жёлтым, как и в таблице.
  h += '<div class="rcards">' + (filtered.length ? filtered.map(function(d){
    var curAssignee = (d.resp || d.head || '').trim();
    var isAssigned = !!curAssignee;
    var nm = esc(d.unit);
    return '<div class="rcard'+(isAssigned?'':' is-warn')+'">'+
      '<div class="rcard-hd">'+
        '<b class="rcard-title" title="'+nm+'">'+nm+'</b>'+
        '<button class="btn-ghost" data-u="'+nm+'" title="Детальные настройки" style="border:1px solid var(--line);min-height:28px;padding:0 8px;font-size:13px;flex:none">'+ic('pencil', 13)+'</button>'+
      '</div>'+
      '<div class="rcard-sub">'+(isAssigned
        ? '<span style="font-weight:600">'+esc(curAssignee)+'</span>'
        : '<span style="color:var(--warn);font-weight:600">Не назначен</span>')+'</div>'+
      '<button type="button" class="pick dept-pick-btn" data-unit="'+nm+'" style="width:100%;min-height:34px;margin-top:8px;text-align:left;display:flex;align-items:center;justify-content:space-between;padding:0 10px;border:1px solid '+(isAssigned?'var(--line)':'var(--warn)')+'">'+
        '<span class="'+(isAssigned?'':'ph')+'">'+(isAssigned ? esc(curAssignee) : ic('search', 13)+'Выбрать сотрудника…')+'</span>'+
        '<i style="color:var(--muted);flex:none;display:inline-flex">'+icBare('chevron', 14)+'</i>'+
      '</button>'+
    '</div>';
  }).join('') : '<div class="empty">Ничего не найдено</div>') + '</div>';

  $('body').innerHTML = h;

  $('deptSearch').oninput = function(){
    var pos = this.selectionStart;
    drawDeptAssign();
    var again = $('deptSearch');
    if(again){ again.focus(); try{ again.setSelectionRange(pos, pos); }catch(e){} }
  };

  $('body').querySelectorAll('.dept-pick-btn').forEach(function(btn){
    btn.onclick = function(e){
      e.stopPropagation();
      var that = this;
      var unitName = this.dataset.unit;
      var divObj = (S.adminDivs || []).filter(function(x){ return x.unit === unitName; })[0];
      if(!divObj) return;
      var curVal = (divObj.resp || divObj.head || '').trim();

      openInlinePicker({
        anchor: that,
        list: employees,
        value: curVal,
        onPick: function(chosenFio){
          var payload = {
            unit: unitName,
            dir: divObj.dir || myDir,
            head: chosenFio,
            resp: chosenFio,
            hrbp: divObj.hrbp || '',
            note: divObj.note || '',
            group: divObj.group_key || ''
          };
          that.disabled = true;
          call('apiAdminSaveDivision', S.token, payload).then(function(res){
            that.disabled = false;
            if(res && res.ok){
              divObj.head = chosenFio;
              divObj.resp = chosenFio;
              toast(chosenFio ? 'Назначен: ' + chosenFio + ' на «' + unitName + '»' : 'Назначение снято с «' + unitName + '»', 'ok');
              drawDeptAssign();
            } else {
              toast((res && res.error) || 'Ошибка сохранения', 'no');
            }
          }).catch(function(){
            that.disabled = false;
            toast('Нет связи с сервером', 'no');
          });
        }
      });
    };
  });

  $('body').querySelectorAll('button[data-u]').forEach(function(btn){
    btn.onclick = function(){
      openDivisionModal(this.dataset.u, { restricted: true, onSaved: openDeptAssign });
    };
  });

  if($('btnBulkAssign')){
    $('btnBulkAssign').onclick = function(){
      openBulkDeptAssignModal(myDir, employees);
    };
  }
}

function openBulkDeptAssignModal(myDir, employees){
  var divs = S.adminDivs || [];
  if(!divs.length){
    toast('Нет доступных отделов для назначения', 'no');
    return;
  }

  var chosenFio = '';

  var el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = '<div class="sheet-in dlg" style="max-width:440px">'+
    '<div class="sheet-hd"><b>Массовое назначение ответственного</b>'+
      '<button class="btn-ghost" data-x="1">Закрыть</button></div>'+
    '<p class="dlg-x" style="font-size:14px;color:var(--muted);margin-bottom:12px">'+
      'Сотрудник будет назначен ответственным на все <b>'+divs.length+' '+declOfNum(divs.length, ['отдел', 'отдела', 'отделов'])+'</b> направления «'+esc(myDir)+'».'+
    '</p>'+
    '<label class="lbl">Сотрудник *</label>'+
    '<button type="button" class="pick" id="bulkPickBtn" style="width:100%;min-height:36px;text-align:left;display:flex;align-items:center;justify-content:space-between;padding:0 12px;margin-bottom:12px">'+
      '<span class="ph">'+ic('search', 13)+'Нажмите для поиска сотрудника…</span>'+
      '<i style="color:var(--muted);flex:none;display:inline-flex">'+icBare('chevron', 14)+'</i>'+
    '</button>'+
    '<div style="margin-bottom:14px">'+
      '<label class="checkline"><input type="checkbox" id="bulkSetResp" checked> Назначить как ответственного за заполнение</label>'+
      '<div style="height:6px"></div>'+
      '<label class="checkline"><input type="checkbox" id="bulkSetHead" checked> Назначить как руководителя отделов</label>'+
    '</div>'+
    '<div class="dlg-a">'+
      '<button type="button" data-x="1" class="btn-line">Отмена</button>'+
      '<button type="button" id="bulkAssignGo" class="btn-primary">'+ic('check', 14)+'Применить ко всем ('+divs.length+')</button>'+
    '</div>'+
  '</div>';

  document.body.appendChild(el);

  el.querySelector('#bulkPickBtn').onclick = function(){
    openPicker({
      title: 'Выберите сотрудника для всех отделов',
      list: employees,
      value: chosenFio,
      onPick: function(fio){
        chosenFio = fio;
        var sp = el.querySelector('#bulkPickBtn span');
        if(sp){
          sp.textContent = fio;
          sp.className = '';
        }
      }
    });
  };

  el.querySelector('#bulkAssignGo').onclick = function(){
    if(!chosenFio){
      toast('Выберите сотрудника с помощью поиска', 'no');
      return;
    }
    var setResp = el.querySelector('#bulkSetResp').checked;
    var setHead = el.querySelector('#bulkSetHead').checked;

    if(!setResp && !setHead){
      toast('Отметьте хотя бы одну роль для назначения', 'no');
      return;
    }

    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Назначаем…';

    var tasks = divs.map(function(d){
      var payload = {
        unit: d.unit,
        dir: d.dir || myDir,
        head: setHead ? chosenFio : (d.head || ''),
        resp: setResp ? chosenFio : (d.resp || ''),
        hrbp: d.hrbp || '',
        note: d.note || '',
        group: d.group_key || ''
      };
      return call('apiAdminSaveDivision', S.token, payload).then(function(r){
        if(r && r.ok){
          if(setHead) d.head = chosenFio;
          if(setResp) d.resp = chosenFio;
        }
        return r;
      });
    });

    Promise.all(tasks).then(function(results){
      el.remove();
      toast('Назначен: ' + chosenFio + ' на все ' + divs.length + ' отделов', 'ok');
      drawDeptAssign();
    }).catch(function(){
      btn.disabled = false;
      btn.textContent = 'Применить';
      toast('Ошибка массового назначения', 'no');
    });
  };

  el.addEventListener('click', function(e){
    if(e.target === el || e.target.dataset.x) el.remove();
  });
}

// ─── Вкладка: Период сбора ───
function renderAdminPeriod(){
  var p = S.data.period || {};
  var closed = p.state === 'закрыт';
  var canEdit = hasCap('period:edit');

  var h = '<div class="card period-card">'+
    '<div class="period-card-kicker">Текущий период сбора</div>'+
    '<div class="period-card-name">'+esc(p.name || 'Обзор рынка')+'</div>'+
    '<div class="period-card-meta">'+
      'Статус: <b class="'+(closed?'is-no':'is-ok')+'">'+esc(p.state || 'открыт')+'</b>'+
      (p.from ? ' · с '+esc(p.from) : '') + (p.to ? ' · по '+esc(p.to) : '') +
      (p.by ? '<br>Изменил: <b>'+esc(p.by)+'</b>'+(p.at?' ('+esc(fmtDateTime(p.at))+')':'') : '') +
    '</div>'+
    (canEdit
      ? (closed
          ? '<button id="btnAdminPeriodReopen" class="btn-line period-card-act is-open">Открыть закрытый обратно</button>'+
            '<button id="btnAdminPeriodOpen" class="btn-line period-card-act">Открыть новый период</button>'
          : '<button id="btnAdminPeriodClose" class="btn-line btn-danger period-card-act">Закрыть период сбора</button>')
      : '')+
  '</div>'+
  (canEdit ? '<div class="card period-grants-card" style="margin-top:14px">'+
    '<div class="period-card-kicker">Доступ к редактированию архива</div>'+
    '<div id="periodGrantsForm" style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0"></div>'+
    '<div id="periodGrantsList">Загрузка…</div>'+
  '</div>' : '')+
  (canEdit ? '<div class="card period-grants-card" style="margin-top:14px">'+
    '<div class="period-card-kicker">Все периоды сбора</div>'+
    '<div class="note" style="margin:2px 0 8px">Если период закрыли или открыли новый по ошибке — верните нужный кнопкой «Сделать активным». Данные периода привязаны к нему и вернутся вместе с ним.</div>'+
    '<div id="periodsManageList">Загрузка…</div>'+
  '</div>' : '');

  $('adminContent').innerHTML = h;

  if(canEdit) loadPeriodGrantsPanel();

  if($('btnAdminPeriodOpen')){
    $('btnAdminPeriodOpen').onclick = function(){
      askText({
        title: 'Открыть новый период сбора',
        html: 'Все сотрудники получат доступ к редактированию и внесению данных.',
        value: 'Обзор рынка — ' + new Date().toLocaleDateString('ru-RU', {month:'long', year:'numeric'}),
        ok: 'Открыть период'
      }).then(function(name){
        if(!name) return;
        call('apiSetPeriod', S.token, { action:'new', name:name }).then(function(res){
          if(res && res.ok){
            S.data.period = res.period;
            toast('Новый период открыт');
            renderAdminPeriod();
          } else {
            toast((res&&res.error)||'Ошибка');
          }
        });
      });
    };
  }

  if($('btnAdminPeriodReopen')){
    $('btnAdminPeriodReopen').onclick = function(){
      ask({
        title: 'Открыть текущий период обратно?',
        html: 'Период «'+esc(p.name || 'Обзор рынка')+'» снова станет открытым — сотрудники смогут вносить данные за этот год. Новый период не создаётся.',
        ok: 'Открыть обратно'
      }).then(function(yes){
        if(!yes) return;
        call('apiSetPeriod', S.token, { action:'reopen' }).then(function(res){
          if(res && res.ok){
            S.data.period = res.period;
            toast('Период снова открыт');
            renderAdminPeriod();
          } else {
            toast((res&&res.error)||'Ошибка');
          }
        });
      });
    };
  }

  if($('btnAdminPeriodClose')){
    $('btnAdminPeriodClose').onclick = function(){
      ask({
        title: 'Закрыть период сбора данных?',
        html: 'Руководители и сотрудники больше не смогут изменять данные (только просмотр).\nЕсли закрыли по ошибке — «Открыть закрытый обратно» вернёт всё как было.',
        ok: 'Закрыть период',
        danger: true
      }).then(function(yes){
        if(!yes) return;
        call('apiSetPeriod', S.token, { action:'close' }).then(function(res){
          if(res && res.ok){
            S.data.period = res.period;
            toast('Период закрыт');
            renderAdminPeriod();
          } else {
            toast((res&&res.error)||'Ошибка');
          }
        });
      });
    };
  }
}

function periodGrantTimeLeft(expiresAt){
  // expires_at из БД — наивная строка "YYYY-MM-DD HH:MM:SS" (UTC без метки).
  // new Date() на неё прочитал бы её как ЛОКАЛЬНОЕ время браузера — тот же
  // сдвиг, что чинит fmtDateTime() в app-core.js; здесь та же нормализация.
  var raw = String(expiresAt || '');
  var iso = /[Zz]|[+\-]\d{2}:?\d{2}$/.test(raw) ? raw : raw.replace(' ', 'T') + 'Z';
  var ms = new Date(iso).getTime() - Date.now();
  if(ms <= 0) return 'истёк';
  var h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return (h>0 ? h+'ч ' : '') + m+'м';
}

function loadPeriodGrantsPanel(){
  Promise.all([
    call('apiPeriodGrantsPanel', S.token),
    call('apiPeriodGrantUsers', S.token)
  ]).then(function(res){
    var panel = res[0], usersRes = res[1];
    if(!panel || !panel.ok){
      $('periodGrantsList').innerHTML = '<div class="err">'+esc((panel&&panel.error)||'Ошибка загрузки')+'</div>';
      return;
    }
    var periods = panel.periods || [];
    // На активный период грант не нужен (он и так редактируется) — в форме
    // выдачи показываем только архивные.
    var grantablePeriods = periods.filter(function(p){ return !p.isActive; });
    var users = (usersRes && usersRes.ok ? usersRes.users : []).filter(function(u){ return u.active; });

    if(!grantablePeriods.length){
      $('periodGrantsForm').innerHTML = '<div class="note">Архивных годов пока нет — доступ не на что выдавать.</div>';
    } else {
      $('periodGrantsForm').innerHTML =
        niceSelect({ id:'grantUserSel', width:220, value: users[0] ? users[0].login : '', items: users.map(function(u){ return { v:u.login, label:u.fio+' ('+u.login+')' }; }) })+
        niceSelect({ id:'grantPeriodSel', width:280, value: grantablePeriods[0] ? String(grantablePeriods[0].id) : '', items: grantablePeriods.map(function(p){ return { v:String(p.id), label: p.name + (p.updatedAt ? ' — ' + fmtDateTime(p.updatedAt) : '') }; }) })+
        '<button id="btnGrantPeriod" class="btn-line">Выдать на 24 часа</button>';
      wireNiceSelect('grantUserSel', function(){});
      wireNiceSelect('grantPeriodSel', function(){});
      $('btnGrantPeriod').onclick = function(){
        var userLogin = $('grantUserSel').dataset.value;
        var periodId = $('grantPeriodSel').dataset.value;
        if(!userLogin || !periodId){ toast('Выберите сотрудника и год', 'no'); return; }
        call('apiPeriodGrantCreate', S.token, userLogin, Number(periodId)).then(function(r){
          if(r && r.ok){ toast('Доступ выдан на 24 часа'); loadPeriodGrantsPanel(); }
          else toast((r&&r.error)||'Ошибка', 'no');
        });
      };
    }

    renderPeriodGrantsList(panel.grants || []);
    renderPeriodsManageList(periods);
  });
}

function renderPeriodsManageList(periods){
  var el = $('periodsManageList');
  if(!el) return;
  if(!periods.length){
    el.innerHTML = '<div class="note">Периодов пока нет.</div>';
    return;
  }
  el.innerHTML = '<table class="co-tbl"><thead><tr>'+
    '<th>Период</th><th>Статус</th><th>Анкет</th><th></th>'+
    '</tr></thead><tbody>'+
    periods.map(function(p){
      var n = p.surveysCount || 0;
      var active = !!p.isActive;
      var closed = p.state === 'закрыт';
      var meta = [];
      if(p.updatedAt) meta.push(esc(fmtDateTime(p.updatedAt)));
      if(p.updatedBy) meta.push('изменил ' + esc(p.updatedBy));
      var statusCell = active
        ? '<span class="pill p-ok">Активен'+(closed?' · закрыт':'')+'</span>'
        : (closed ? '<span class="pill p-no">закрыт</span>' : '<span class="pill p-mid">открыт</span>');
      var actCell = active
        ? '<span style="color:var(--muted);font-size:13px">текущий</span>'
        : '<button class="btn-ghost" data-activate-period="'+p.id+'">Сделать активным</button>'+
          (n === 0
            ? ' <button class="btn-ghost btn-danger" data-del-period="'+p.id+'">Удалить</button>'
            : ' <button class="btn-ghost" disabled title="В периоде есть анкеты — удалить нельзя">Удалить</button>');
      return '<tr'+(active?' style="background:var(--ok-soft)"':'')+'>'+
        '<td><b>'+esc(p.name)+'</b>'+(meta.length ? '<br><small style="color:var(--muted)">'+meta.join(' · ')+'</small>' : '')+'</td>'+
        '<td>'+statusCell+'</td>'+
        '<td>'+n+'</td>'+
        '<td style="white-space:nowrap">'+actCell+'</td>'+
      '</tr>';
    }).join('')+
    '</tbody></table>';

  el.querySelectorAll('button[data-activate-period]').forEach(function(btn){
    btn.onclick = function(){
      var periodId = Number(btn.dataset.activatePeriod);
      var row = btn.closest('tr');
      var pName = row ? row.querySelector('b').textContent : 'этот период';
      ask({
        title: 'Сделать активным этот период?',
        html: 'Текущим станет период «'+esc(pName)+'» и он будет открыт — сотрудники снова смогут вносить данные за этот год. Прежний активный период станет архивным (его данные сохранятся).',
        ok: 'Сделать активным'
      }).then(function(yes){
        if(!yes) return;
        call('apiSetPeriod', S.token, { action:'activate', id:periodId }).then(function(r){
          if(r && r.ok){
            S.data.period = r.period;
            toast('Период возвращён');
            renderAdminPeriod();
          } else {
            toast((r&&r.error)||'Ошибка', 'no');
          }
        });
      });
    };
  });

  el.querySelectorAll('button[data-del-period]').forEach(function(btn){
    btn.onclick = function(){
      var periodId = Number(btn.dataset.delPeriod);
      ask({
        title: 'Удалить этот период?',
        html: 'Период пустой (0 анкет) — действие необратимо.',
        ok: 'Удалить',
        danger: true
      }).then(function(yes){
        if(!yes) return;
        call('apiPeriodDelete', S.token, periodId).then(function(r){
          if(r && r.ok){ toast('Период удалён'); loadPeriodGrantsPanel(); }
          else toast((r&&r.error)||'Ошибка', 'no');
        });
      });
    };
  });
}

function renderPeriodGrantsList(grants){
  if(!grants.length){
    $('periodGrantsList').innerHTML = '<div class="note">Сейчас нет активных выданных доступов.</div>';
    return;
  }
  $('periodGrantsList').innerHTML = '<table class="co-tbl"><thead><tr>'+
    '<th>Сотрудник</th><th>Год</th><th>Истекает</th><th></th>'+
    '</tr></thead><tbody>'+
    grants.map(function(g){
      return '<tr>'+
        '<td>'+esc(g.userFio)+'</td>'+
        '<td>'+esc(g.periodName)+'</td>'+
        '<td>'+periodGrantTimeLeft(g.expiresAt)+'</td>'+
        '<td><button class="btn-ghost btn-danger" data-revoke-user="'+esc(g.userLogin)+'" data-revoke-period="'+g.periodId+'">Отозвать</button></td>'+
      '</tr>';
    }).join('')+
    '</tbody></table>';

  $('periodGrantsList').querySelectorAll('button[data-revoke-user]').forEach(function(btn){
    btn.onclick = function(){
      call('apiPeriodGrantRevoke', S.token, btn.dataset.revokeUser, Number(btn.dataset.revokePeriod)).then(function(r){
        if(r && r.ok){ toast('Доступ отозван'); loadPeriodGrantsPanel(); }
        else toast((r&&r.error)||'Ошибка', 'no');
      });
    };
  });
}

// ═══════════════════════════════════════════════════════════
// ВКЛАДКА: СПРАВОЧНИКИ
// ═══════════════════════════════════════════════════════════
/**
 * Единое место, где ведутся справочники системы. До этого добавить значение
 * можно было только «на лету» из анкеты, а удалить — никак: реестр компаний
 * рос сам собой и вычистить из него опечатку было нечем.
 *
 * Удаление здесь — не то же самое, что «убрать из выпадающего списка»: за
 * названием компании стоят строки участников рынка и анкеты. Поэтому сервер
 * сначала возвращает, сколько данных заденет операция, и только после
 * подтверждения удаляет.
 */
var DICT_KINDS = [
  { id:'companies', label:'Компании',  one:'компанию',  ttl:'Компания' },
  { id:'positions', label:'Должности', one:'должность', ttl:'Должность' },
  { id:'segments',  label:'Сегменты',  one:'сегмент',   ttl:'Сегмент' },
  { id:'regions',   label:'Регионы',   one:'регион',    ttl:'Регион' }
];

function renderAdminDict(){
  if(!S.dictKind) S.dictKind = 'companies';
  if(S.dictQ == null) S.dictQ = '';

  var h = '<div class="sub-tabs sub-tabs--inner">'+ DICT_KINDS.map(function(k){
    return '<button class="sub-tab'+(S.dictKind === k.id ? ' on' : '')+'" data-dk="'+k.id+'">'+
      esc(k.label)+'</button>';
  }).join('') +'</div>'+
  '<div id="dictBox" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden">' + skTable(6) + '</div>';

  $('adminContent').innerHTML = h;
  $('adminContent').querySelectorAll('button[data-dk]').forEach(function(b){
    b.onclick = function(){ S.dictKind = this.dataset.dk; S.dictQ = ''; renderAdminDict(); };
  });

  loadDict();
}

function loadDict(){
  var kind = S.dictKind;
  call('apiDictList', S.token, kind).then(function(r){
    if(!r || !r.ok){
      $('dictBox').innerHTML = '<div class="err">'+esc((r&&r.error)||'Не удалось загрузить справочник')+'</div>';
      return;
    }
    S.dictItems = r.items || [];
    S.dictDirs = r.dirs || [];
    drawDict();
  }).catch(function(){
    $('dictBox').innerHTML = '<div class="err">Нет связи с сервером</div>';
  });
}

function drawDict(){
  var kind = S.dictKind;
  var meta = DICT_KINDS.filter(function(k){ return k.id === kind; })[0];
  var q = norm(S.dictQ);
  var items = (S.dictItems || []).filter(function(it){
    if(!q) return true;
    return norm(it.name).indexOf(q) >= 0 ||
           norm((it.dirs || []).join(' ')).indexOf(q) >= 0 ||
           norm(it.segment || '').indexOf(q) >= 0 ||
           norm(it.region || '').indexOf(q) >= 0;
  });

  var h = '<div class="toolbar">'+
    '<div class="search-wrap">'+icBare('search')+
      '<input id="dictQ" placeholder="Поиск по справочнику…" value="'+esc(S.dictQ)+'" '+
      'autocomplete="off" spellcheck="false"></div>'+
    tblCount(items.length, S.dictItems.length, ['запись', 'записи', 'записей'])+
    '<button class="btn-primary toolbar-act" id="dictAdd">+ Добавить '+esc(meta.one)+'</button>'+
  '</div>';

  if(!items.length){
    h += S.dictQ
      ? '<div class="empty">Ничего не найдено</div>'
      : '<div class="empty empty--lg">'+
          '<span class="empty-ic">'+icBare('units', 40)+'</span>'+
          '<b>Справочник «'+esc(meta.label)+'» пока пуст</b>'+
          '<span>Добавьте первую запись кнопкой «+ Добавить '+esc(meta.one)+'» выше</span>'+
        '</div>';
    $('dictBox').innerHTML = h;
    bindDictBar();
    return;
  }

  // ID из исходных таблиц (К136, П53, код отдела 529). По ним данные сверяют
  // со штатным расписанием и бухгалтерией, поэтому они видны в списке.
  var cols = kind === 'companies'
    ? ['ID', 'Название', 'Сегмент', 'Регион', 'Направления', 'Использований', '']
    : kind === 'positions'
      ? ['ID', 'Название', 'Направления', 'Оклад Фаровона', 'Использований', '']
      : ['ID', 'Название', 'Использований', ''];

  var dash = '<span style="color:var(--muted)">—</span>';

  h += '<div class="tblwrap tblwrap--page"><table class="co-tbl co-tbl--pin"><thead><tr>'+
    cols.map(function(c){
      return '<th'+(c === 'Использований' ? ' class="num"' : '')+'>'+esc(c)+'</th>';
    }).join('') +'</tr></thead><tbody>'+
    items.map(function(it){
      var acts = '<td class="u-acts">'+
        '<button class="row-menu-trigger" data-dict-act="'+esc(it.name)+'" title="Действия" aria-label="Действия со справочной записью">'+icBare('more',16)+'</button>'+
      '</td>';
      var used = '<td class="num">'+(it.used
        ? '<b>'+it.used+'</b>'
        : '<span style="color:var(--muted)">0</span>')+'</td>';
      var dirs = '<td>'+((it.dirs && it.dirs.length)
        ? it.dirs.map(function(d){ return '<span class="badge b-user">'+esc(d)+'</span>'; }).join(' ')
        : dash)+'</td>';

      var id = '<td class="dict-id">'+(it.code ? esc(it.code) : dash)+'</td>';

      if(kind === 'companies'){
        return '<tr>'+ id +'<td><b>'+esc(it.name)+'</b></td>'+
          '<td>'+(it.segment ? esc(it.segment) : dash)+'</td>'+
          '<td>'+(it.region ? esc(it.region) : dash)+'</td>'+
          dirs + used + acts +'</tr>';
      }
      if(kind === 'positions'){
        var payCell = '<td>'+((it.payFrom || it.payTo)
          ? '<span style="white-space:nowrap">'+(it.payFrom ? it.payFrom.toLocaleString('ru-RU') : '—')+' – '+(it.payTo ? it.payTo.toLocaleString('ru-RU') : '—')+'</span>'
          : dash)+'</td>';
        return '<tr>'+ id +'<td><b>'+esc(it.name)+'</b></td>'+ dirs + payCell + used + acts +'</tr>';
      }
      return '<tr>'+ id +'<td><b>'+esc(it.name)+'</b></td>'+ used + acts +'</tr>';
    }).join('') +
    '</tbody></table></div>';

  $('dictBox').innerHTML = h;
  bindDictBar();

  $('dictBox').querySelectorAll('button[data-dict-act]').forEach(function(b){
    b.onclick = function(e){ openDictActions(e, this.dataset.dictAct); };
  });
  try { restoreViewScroll('admin:dict'); } catch(e){}
}

function bindDictBar(){
  var inp = $('dictQ');
  if(inp){
    inp.oninput = function(){
      S.dictQ = this.value;
      var pos = this.selectionStart;
      drawDict();
      var again = $('dictQ');
      if(again){ again.focus(); try{ again.setSelectionRange(pos, pos); }catch(e){} }
    };
  }
  var add = $('dictAdd');
  if(add) add.onclick = function(){ openDictItem(null); };
}

/** Карточка значения справочника. name === null — создание. */
function openDictItem(name){
  var kind = S.dictKind;
  var meta = DICT_KINDS.filter(function(k){ return k.id === kind; })[0];
  var it = name
    ? (S.dictItems || []).filter(function(x){ return x.name === name; })[0]
    : null;
  var cur = {
    name: it ? it.name : '',
    segment: it ? (it.segment || '') : '',
    region: it ? (it.region || '') : '',
    dirs: it ? (it.dirs || []).slice() : [],
    payFrom: it ? (it.payFrom || 0) : 0,
    payTo: it ? (it.payTo || 0) : 0
  };

  var el = document.createElement('div');
  el.className = 'sheet';

  var body = '<label class="lbl">Название</label>'+
    '<input id="dcName" value="'+esc(cur.name)+'" placeholder="'+esc(meta.ttl)+'" '+
    'autocomplete="off" spellcheck="false">';

  if(kind === 'companies'){
    // Сегмент и регион — выбор из справочника, а не свободный ввод: именно
    // ручной ввод в своё время развёл варианты написания одной компании.
    body += '<label class="lbl">Сегмент</label>'+
      '<button type="button" class="pick" id="dcSeg"><span'+(cur.segment?'':' class="ph"')+'>'+
        esc(cur.segment || 'Выбрать сегмент')+'</span>'+icBare('chevron',16)+'</button>'+
      '<label class="lbl">Регион</label>'+
      '<button type="button" class="pick" id="dcReg"><span'+(cur.region?'':' class="ph"')+'>'+
        esc(cur.region || 'Выбрать регион')+'</span>'+icBare('chevron',16)+'</button>';
  }

  if(kind === 'companies' || kind === 'positions'){
    body += '<label class="lbl">Направления</label>'+
      '<button type="button" class="pick" id="dcDirsBtn"><span id="dcDirsTxt"></span>'+
        icBare('chevron', 16)+'</button>'+
      '<div id="dcDirs" class="chips chips--ro"></div>'+
      '<p style="font-size:13.5px;color:var(--muted);margin:8px 2px 0">'+(kind === 'companies'
        ? 'Компания попадёт в карту тех направлений, что отмечены.'
        : 'Должность попадёт в штатку подразделений этих направлений.')+'</p>';
  }

  if(kind === 'positions'){
    body += '<label class="lbl" style="margin-top:12px">Оклад Фаровона по этой должности, сомони/мес</label>'+
      '<div class="field-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px">'+
        '<div><input id="dcPayFrom" type="number" inputmode="numeric" min="0" placeholder="от" value="'+(cur.payFrom || '')+'"></div>'+
        '<div><input id="dcPayTo" type="number" inputmode="numeric" min="0" placeholder="до" value="'+(cur.payTo || '')+'"></div>'+
      '</div>'+
      '<p style="font-size:13.5px;color:var(--muted);margin:6px 2px 0">Используется на дашборде вилок для колонок «Мы» и «Гэп к рынку». Пусто — сравнения не будет.</p>';
  }

  el.innerHTML = '<div class="sheet-in">'+
    '<div class="sheet-hd"><b>'+(it ? esc(meta.ttl)+': '+esc(cur.name) : 'Новая запись')+'</b>'+
      '<button class="btn-ghost" data-x="1">Закрыть</button></div>'+
    body +
    '<div style="height:16px"></div>'+
    '<button id="dcSave" class="btn-primary">Сохранить</button>'+
    '<div style="height:10px"></div></div>';

  document.body.appendChild(el);

  // Направлений больше тридцати, поэтому выбор — окно с поиском, а под кнопкой
  // только отметки: простыня из всех вариантов занимала экран целиком и не
  // давала понять, сколько выбрано.
  function drawDirs(){
    var txt = el.querySelector('#dcDirsTxt');
    var box = el.querySelector('#dcDirs');
    if(!txt || !box) return;
    txt.textContent = cur.dirs.length
      ? 'Выбрано: ' + cur.dirs.length
      : 'Выбрать направления';
    txt.className = cur.dirs.length ? '' : 'ph';
    box.innerHTML = cur.dirs.map(function(d){
      return '<button type="button" class="on" data-dir="'+esc(d)+'">'+esc(d)+
        '<i aria-hidden="true">×</i></button>';
    }).join('');
    box.querySelectorAll('button[data-dir]').forEach(function(b){
      b.onclick = function(){
        var i = cur.dirs.indexOf(this.dataset.dir);
        if(i >= 0) cur.dirs.splice(i, 1);
        drawDirs();
      };
    });
  }
  drawDirs();

  el.querySelector('#dcDirsBtn') && (el.querySelector('#dcDirsBtn').onclick = function(){
    openMultiPicker({
      title: 'Направления',
      list: S.dictDirs || [],
      value: cur.dirs,
      onPick: function(v){ cur.dirs = v; drawDirs(); }
    });
  });

  function bindRef(id, field, block, title){
    var btn = el.querySelector('#'+id);
    if(!btn) return;
    btn.onclick = function(){
      openPicker({
        title: title,
        list: (block === 'segments' ? S.data.segments : S.data.regions) || [],
        value: cur[field],
        block: block,
        onPick: function(v){
          cur[field] = v;
          var sp = btn.querySelector('span');
          sp.textContent = v; sp.className = '';
        }
      });
    };
  }
  bindRef('dcSeg', 'segment', 'segments', 'Сегмент');
  bindRef('dcReg', 'region', 'regions', 'Регион');

  var pf = function(id){ var e = el.querySelector(id); return e ? (parseInt(e.value, 10) || 0) : 0; };

  var isDirty = function(){
    return el.querySelector('#dcName').value.trim() !== cur.name ||
      cur.segment !== (it ? (it.segment || '') : '') ||
      cur.region !== (it ? (it.region || '') : '') ||
      cur.dirs.slice().sort().join(',') !== (it ? (it.dirs || []).slice().sort().join(',') : '') ||
      pf('#dcPayFrom') !== (it ? (it.payFrom || 0) : 0) ||
      pf('#dcPayTo') !== (it ? (it.payTo || 0) : 0);
  };
  guardClose(el, isDirty);

  el.querySelector('#dcSave').onclick = function(){
    var nm = el.querySelector('#dcName').value.trim();
    if(!nm){ toast('Укажите название', 'no'); return; }
    var btn = this;
    btn.disabled = true; btn.textContent = 'Сохраняем…';
    call('apiDictSave', S.token, kind, {
      prev: it ? it.name : '',
      name: nm,
      segment: cur.segment,
      region: cur.region,
      dirs: cur.dirs,
      payFrom: pf('#dcPayFrom'),
      payTo: pf('#dcPayTo')
    }).then(function(r){
      btn.disabled = false; btn.textContent = 'Сохранить';
      if(r && r.ok){
        el.remove();
        toast(it ? 'Изменено' : 'Добавлено в справочник', 'ok');
        loadDict();
        quietRefresh();
      } else {
        toast((r && r.error) || 'Не удалось сохранить', 'no');
      }
    }).catch(function(){
      btn.disabled = false; btn.textContent = 'Сохранить';
      toast('Нет связи с сервером', 'no');
    });
  };
}

function removeDictItem(name){
  var kind = S.dictKind;
  var meta = DICT_KINDS.filter(function(k){ return k.id === kind; })[0];

  // Первый запрос — «сухой»: сервер только считает, сколько данных заденет.
  call('apiDictDelete', S.token, kind, { name: name }).then(function(r){
    if(r && r.ok){
      toast('Удалено', 'ok');
      loadDict();
      quietRefresh();
      return;
    }
    if(!r || !r.needsConfirm){
      toast((r && r.error) || 'Не удалось удалить', 'no');
      return;
    }
    ask({
      title: 'Удалить ' + meta.one + ' «' + name + '»?',
      html: 'Значение используется в данных: <b>' + esc(r.parts.join(', ')) + '</b>.<br>' +
            'Эти строки будут удалены вместе с ним и не восстановятся.',
      ok: 'Удалить всё равно',
      danger: true
    }).then(function(yes){
      if(!yes) return;
      call('apiDictDelete', S.token, kind, { name: name, confirm: true }).then(function(r2){
        if(r2 && r2.ok){
          toast('Удалено, затронуто: ' + r2.parts.join(', '), 'ok');
          loadDict();
          quietRefresh();
        } else {
          toast((r2 && r2.error) || 'Не удалось удалить', 'no');
        }
      });
    });
  }).catch(function(){ toast('Нет связи с сервером', 'no'); });
}

// ─── Вкладка: Сервисные утилиты ───
function renderAdminTools(){
  function toolCard(o){
    return '<div class="tool-card'+(o.accent ? ' is-accent' : '')+'">'+
      '<div class="tool-card-body">'+
        '<div class="tool-card-t">'+ic(o.icon, 16)+esc(o.title)+'</div>'+
        '<div class="tool-card-d">'+o.desc+'</div>'+
      '</div>'+
      '<div class="tool-card-acts">'+ o.actions.map(function(a){
        return '<button class="'+(a.cls || 'btn-primary')+'" onclick="'+a.onclick+'">'+ic(a.icon, 14)+esc(a.label)+'</button>';
      }).join('') +'</div>'+
    '</div>';
  }

  var h = '<div class="dash-tab-scroll">'+
    '<div class="sec-title">Состояние данных</div>'+
    '<div id="dataStatus"><div class="sp"><i></i> Считаем…</div></div>'+

    '<div class="sec-title tool-sec-t">Загрузка данных</div>'+
    '<div class="tool-grid fx-stagger">'+
      toolCard({ icon:'download', accent:true, title:'Загрузить опрос зарплат из файла',
        desc:'CSV-выгрузка листа «Ответы». Сначала проверка: разбор колонок, привязка ID_Бизнес к подразделению, сверка каждой ячейки. Затем отчёт — и только потом заливка (от имени админа, транзакцией). Ничего не пишется, пока вы не подтвердите.',
        actions:[{ label:'Выбрать файл…', icon:'download', onclick:'importSurveyFile()' }] })+
      '<input type="file" id="importSurveyInput" accept=".csv,text/csv" style="display:none">'+
    '</div>'+

    '<div class="sec-title tool-sec-t">Сервисные утилиты обслуживания</div>'+
    '<div class="tool-grid">'+
      toolCard({ icon:'unlock', accent:true, title:'Снятие блокировок записей (каскадно)',
        desc:'Снимает авторские блокировки («Администратор C&amp;B» и др.) со строк рынка и анкет. Каскадно открывает возможность редактирования ответственным по всем подразделениям.',
        actions:[
          { label:'Выборочно по ролям / авторам…', icon:'users', onclick:'openLocksModal()' },
          { label:'Снять со всех (1 клик)', icon:'unlock', cls:'btn-danger', onclick:"adminUnlockQuick('all')" }
        ] })+
      toolCard({ icon:'broom', title:'Нормализация справочника компаний',
        desc:'Убирает скрытые пробелы в названиях, подтягивает сегмент и регион из справочника в строки, где они пустые, и дописывает недостающие компании.',
        actions:[{ label:'Запустить нормализацию', icon:'wrench', onclick:"runMaintenanceTool('clean_segments', 'Нормализация справочника')" }] })+
      toolCard({ icon:'link', title:'Проверка привязки к оргструктуре',
        desc:'Обновляет направление, ответственного и HR BP по оргструктуре и выявляет подразделения с несовпадающими названиями.',
        actions:[{ label:'Проверить привязки', icon:'search', onclick:"runMaintenanceTool('fix_links', 'Проверка привязки')" }] })+
      toolCard({ icon:'units', title:'Загрузить штатное расписание',
        desc:'Заводит должности по каждому подразделению из штатного расписания (1340 пар по 285 отделам) и проставляет коды. Безопасно для повторного запуска.',
        actions:[{ label:'Загрузить штатку', icon:'download', onclick:"runMaintenanceTool('import_staffing', 'Загрузка штатного расписания')" }] })+
      toolCard({ icon:'book', title:'Сверить компании с рынком',
        desc:'Проставляет компаниям направления и ID по фактическому использованию в данных, добавляет недостающие без перезаписи ручных полей.',
        actions:[{ label:'Сверить компании', icon:'refresh', onclick:"runMaintenanceTool('import_company_dirs', 'Сверка компаний')" }] })+
      toolCard({ icon:'link', title:'Раздать компании по направлениям',
        desc:'Выдаёт базовый набор компаний тем отделам направления, где ещё нет ни одной строки. Не затрагивает отделы с ручным заполнением.',
        actions:[
          { label:'Раздать', icon:'check', onclick:"runBulkTool('distribute_companies', 'Раздать компании по направлениям')" },
          { label:'Отменить', icon:'block', cls:'btn-danger', onclick:"runBulkTool('undo_distribute', 'Отменить раздачу')" }
        ] })+
    '</div>'+
  '</div>';

  $('adminContent').innerHTML = h;
  loadDataStatus();
}

// ─── Вкладка: Журнал действий (Audit Log) ───
function renderAdminAudit(){
  var h = '<div id="auditLogBox" style="flex:1;min-height:0;display:flex;flex-direction:column">' + skTable() + '</div>';
  $('adminContent').innerHTML = h;

  call('apiAdminGetAuditLog', S.token, 200).then(function(r){
    if(!r || !r.ok){
      $('auditLogBox').innerHTML = '<div class="err">'+esc((r&&r.error)||'Не удалось загрузить журнал')+'</div>';
      return;
    }
    var logs = r.logs || [];
    if(!logs.length){
      $('auditLogBox').innerHTML = '<div class="empty">Журнал пуст</div>';
      return;
    }

    var actions = [];
    logs.forEach(function(l){
      var a = String(l.action || '').trim();
      if(a && actions.indexOf(a) < 0) actions.push(a);
    });
    actions.sort();

    var LOG_PER_PAGE = 50;

    function drawLogs(filterSearch, filterAct, pg){
      pg = pg || 1;
      var q = (filterSearch || '').toLowerCase();
      var filtered = logs.filter(function(l){
        var matchQ = !q || (l.login && l.login.toLowerCase().indexOf(q) >= 0) || (l.detail && l.detail.toLowerCase().indexOf(q) >= 0);
        var matchA = !filterAct || (l.action === filterAct);
        return matchQ && matchA;
      });

      var totalPages = Math.max(1, Math.ceil(filtered.length / LOG_PER_PAGE));
      if(pg > totalPages) pg = totalPages;
      if(pg < 1) pg = 1;
      var pageRows = filtered.slice((pg - 1) * LOG_PER_PAGE, pg * LOG_PER_PAGE);

      var logH = '<div class="toolbar audit-toolbar">'+
        '<div class="search-wrap">'+icBare('search')+
          '<input id="auditSearch" placeholder="Поиск по логину или деталям…" value="'+esc(filterSearch||'')+'"></div>'+
        '<select id="auditAction" class="toolbar-select">'+
          '<option value="">Все действия ('+logs.length+')</option>'+
          actions.map(function(act){
            return '<option value="'+esc(act)+'"'+(filterAct===act?' selected':'')+'>'+esc(act)+'</option>';
          }).join('')+
        '</select>'+
        tblCount(filtered.length, logs.length, ['запись', 'записи', 'записей'])+
        '<button id="btnAuditReload" class="btn-line toolbar-act">'+ic('refresh',14)+'Обновить</button>'+
      '</div>';

      logH += '<div class="tblwrap tblwrap--page audit-tblwrap"><table class="co-tbl co-tbl--pin">'+
        '<thead><tr><th>Время</th><th>Логин</th><th>Действие</th><th>Детали</th></tr></thead><tbody>'+
        pageRows.map(function(l){
          var act = String(l.action || '').trim() || '—';
          return '<tr>'+
            '<td class="log-time">'+esc(fmtDateTime(l.dt))+'</td>'+
            '<td><b>'+esc(l.login)+'</b></td>'+
            '<td><span class="log-act'+(act === '—' ? ' log-act--none' : '')+'">'+esc(act)+'</span></td>'+
            '<td class="log-detail">'+esc(l.detail)+'</td>'+
          '</tr>';
        }).join('')+
        '</tbody></table></div>';

      if(filtered.length > LOG_PER_PAGE){
        var from = (pg - 1) * LOG_PER_PAGE + 1;
        var to = Math.min(pg * LOG_PER_PAGE, filtered.length);
        var nums = '';
        for(var n = 1; n <= totalPages; n++){
          nums += '<button data-pg="'+n+'"'+(n === pg ? ' class="on"' : '')+'>'+n+'</button>';
        }
        logH += '<div class="pager">'+
          '<span class="pager-info">Показано '+from+'–'+to+' из '+filtered.length+'</span>'+
          '<div class="pager-btns">'+
            '<button data-pg="'+(pg - 1)+'"'+(pg <= 1 ? ' disabled' : '')+'>‹</button>'+
            nums+
            '<button data-pg="'+(pg + 1)+'"'+(pg >= totalPages ? ' disabled' : '')+'>›</button>'+
          '</div>'+
        '</div>';
      }

      $('auditLogBox').innerHTML = logH;

      var sIn = $('auditSearch');
      var aSel = $('auditAction');
      var rBtn = $('btnAuditReload');

      if(sIn){
        sIn.oninput = function(){
          drawLogs(sIn.value, aSel ? aSel.value : '');
        };
      }
      if(aSel){
        aSel.onchange = function(){
          drawLogs(sIn ? sIn.value : '', aSel.value);
        };
      }
      if(rBtn){
        rBtn.onclick = function(){
          renderAdminAudit();
        };
      }
      $('auditLogBox').querySelectorAll('.pager-btns button[data-pg]').forEach(function(b){
        b.onclick = function(){
          if(this.disabled) return;
          drawLogs(sIn ? sIn.value : '', aSel ? aSel.value : '', parseInt(this.dataset.pg, 10));
        };
      });
    }

    drawLogs('', '');
  }).catch(function(){
    $('auditLogBox').innerHTML = '<div class="err">Нет связи с сервером</div>';
  });
}

/**
 * Цифры по загруженным данным. Понять, отработала загрузка штатного расписания
 * или нет, раньше можно было только открыв подразделение — а это ещё и зависело
 * от роли смотрящего.
 */
function loadDataStatus(){
  call('apiAdminDataStatus', S.token).then(function(r){
    if(!r || !r.ok || !$('dataStatus')){
      if($('dataStatus')) $('dataStatus').innerHTML =
        '<div class="err">'+esc((r && r.error) || 'Не удалось получить состояние')+'</div>';
      return;
    }
    var s = r.status;
    var n = function(v){ return v == null ? '—' : v; };
    var loaded = s.staffPairs > 0;

    $('dataStatus').innerHTML =
      // Базовый .note — янтарный, это стиль предупреждения. Успешное состояние
      // им же выглядело тревогой: текст говорил «загружено», а плашка кричала.
      '<div class="note '+(loaded ? 'note--ok' : 'note--warn')+'">'+
        (loaded
          ? icBare('check', 15) + ' Штатное расписание загружено: ' + n(s.staffPairs) +
            ' пар по ' + n(s.staffUnits) + ' подразделениям.'
          : '<b>Штатное расписание ещё не загружено.</b> Нажмите «Загрузить штатку» ниже — '+
            'без этого на шаге 2 у подразделений не будет списка должностей.')+
      '</div>'+
      '<div class="kpi-grid">'+
        stCard('Штатка', n(s.staffPairs), 'пар «должность × отдел» по '+n(s.staffUnits)+' отделам') +
        stCard('Должности', n(s.positions), 'в справочнике') +
        stCard('Подразделения', n(s.divisions), n(s.divisionsWithCode)+' с кодом') +
        stCard('Компании', n(s.companies), n(s.companiesWithDirs)+' с направлением, '+n(s.companiesWithCode)+' с ID') +
        stCard('Участники рынка', n(s.competitors), 'строк по '+n(s.competitorUnits)+' подразделениям') +
        stCard('Анкеты', n(s.surveys), 'записей по должностям') +
      '</div>';
  }).catch(function(){
    if($('dataStatus')) $('dataStatus').innerHTML = '<div class="err">Нет связи с сервером</div>';
  });
}

function stCard(title, value, sub){
  return '<div class="card st-card">'+
    '<div class="st-k">'+esc(title)+'</div>'+
    '<div class="st-v">'+esc(String(value))+'</div>'+
    '<div class="st-s">'+esc(sub)+'</div></div>';
}

/**
 * Массовые задачи (раздача компаний и её откат) сначала запрашиваются без
 * confirm: сервер ничего не меняет, а возвращает объём — сколько строк
 * появится или исчезнет. Цифру видно до того, как что-то произошло.
 */
function runBulkTool(type, title){
  toast('Считаем объём…');
  call('apiAdminRunMaintenance', S.token, type).then(function(r){
    if(r && r.ok){ ask({ title:'Готово', html: esc(r.message), ok:'Понятно' }); renderAdminTools(); return; }
    if(!r || !r.needsConfirm){ toast((r && r.error) || 'Не удалось выполнить', 'no'); return; }
    if(!r.total){ ask({ title: title, html: esc(r.message), ok:'Понятно' }); return; }

    ask({
      title: title,
      html: esc(r.message),
      ok: 'Выполнить',
      danger: type === 'undo_distribute'
    }).then(function(yes){
      if(!yes) return;
      toast('Выполняется: ' + title + '…');
      call('apiAdminRunMaintenanceConfirm', S.token, type).then(function(res){
        if(res && res.ok){
          ask({ title:'Готово', html: esc(res.message), ok:'Понятно' });
          renderAdminTools();
          quietRefresh();
        } else {
          toast((res && res.error) || 'Ошибка выполнения', 'no');
        }
      }).catch(function(){ toast('Нет связи с сервером', 'no'); });
    });
  }).catch(function(){ toast('Нет связи с сервером', 'no'); });
}

function runMaintenanceTool(type, title){
  ask({
    title: 'Запустить процедуру: ' + title + '?',
    html: 'Операция изменит данные в базе и будет записана в журнал действий.',
    ok: 'Запустить'
  }).then(function(yes){
    if(!yes) return;
    toast('Выполняется: ' + title + '…');
    call('apiAdminRunMaintenance', S.token, type).then(function(res){
      if(res && res.ok){
        ask({ title:'Готово', html: esc(res.message), ok:'Понятно' });
        renderAdminTools();
      } else {
        toast((res && res.error) || 'Ошибка выполнения', 'no');
      }
    }).catch(function(){
      toast('Нет связи', 'no');
    });
  });
}

// ─── Импорт файла опроса зарплат ───
function importSurveyFile(){
  var inp = $('importSurveyInput');
  if(!inp) return;
  inp.value = '';
  inp.onchange = function(){
    var file = inp.files && inp.files[0];
    if(!file) return;
    if(file.size > 9 * 1024 * 1024){ toast('Файл больше 9 МБ — слишком большой', 'no'); return; }
    var reader = new FileReader();
    reader.onload = function(){
      var csv = String(reader.result || '');
      toast('Проверяю файл «' + file.name + '»…');
      call('apiAdminImportSurvey', S.token, csv, true, null).then(function(res){
        if(res && res.ok && res.report){
          showImportReport(file.name, csv, res);
        } else {
          ask({ title:'Файл не принят', html: esc((res && res.error) || 'Не удалось разобрать файл'), ok:'Понятно' });
        }
      }).catch(function(){ toast('Нет связи с сервером', 'no'); });
    };
    reader.onerror = function(){ toast('Не удалось прочитать файл', 'no'); };
    reader.readAsText(file, 'utf-8');
  };
  inp.click();
}

function showImportReport(fileName, csv, res){
  var r = res.report || {};
  var issues = res.cellIssues || [];
  var dups = res.duplicates || [];
  var clean = (r.cellIssues === 0);

  function kpi(label, val, hint){
    return '<div style="border:1px solid var(--line);border-radius:10px;padding:10px 12px;min-width:0">'+
      '<div style="font-size:20px;font-weight:700;line-height:1.1">'+val+'</div>'+
      '<div style="font-size:12.5px;color:var(--muted);margin-top:2px">'+esc(label)+'</div>'+
      (hint ? '<div style="font-size:12px;color:var(--accent);margin-top:2px">'+esc(hint)+'</div>' : '')+
    '</div>';
  }

  var el = document.createElement('div');
  el.className = 'sheet';
  var h = '<div class="sheet-in um-modal" style="max-width:720px">'+
    '<div class="sheet-hd"><b>'+ic('download',16)+'Проверка файла: '+esc(fileName)+'</b>'+
      '<button class="btn-ghost" data-x="1">Закрыть</button></div>'+
    '<div style="padding:6px 0 2px">'+
      '<div style="display:'+(clean ? 'none':'block')+';margin-bottom:10px" class="err">'+
        'Найдены проблемные ячейки: '+r.cellIssues+'. Строки всё равно можно загрузить — плохие ячейки будут пустыми, их адреса ниже.</div>'+
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:12px">'+
        kpi('строк в файле', r.rowsInFile, r.rowsSkipped ? ('отбраковано '+r.rowsSkipped) : '')+
        kpi('к загрузке', r.rowsPrepared, '')+
        kpi('компаний', r.companies, r.companiesNew ? ('новых '+r.companiesNew) : '')+
        kpi('должностей', r.positions, r.positionsNew ? ('новых '+r.positionsNew) : '')+
        kpi('подразделений', r.units, r.unitsUnassigned ? ('не распределено '+r.unitsUnassigned) : '')+
        kpi('наша должность', r.posOurMatched, r.posOurSentinel ? ('без пары '+r.posOurSentinel) : '')+
        kpi('менеджеров', r.managers, r.managersUnknown ? ('не из базы '+r.managersUnknown) : '')+
        kpi('часовая ставка?', r.suspiciousHourly, 'зарплата < 100')+
        kpi('дубли в базе', r.duplicatesInDb, r.duplicatesInFile ? ('в файле '+r.duplicatesInFile) : '')+
      '</div>';

  // распределение по подразделениям
  if(r.unitsList && r.unitsList.length){
    h += '<details style="margin-bottom:10px"><summary style="cursor:pointer;font-size:13.5px;color:var(--muted)">Подразделения ('+r.unitsList.length+')'+(r.unitsNew && r.unitsNew.length ? ' — будет создано новых: '+r.unitsNew.length : '')+'</summary>'+
      '<div style="font-size:13px;padding:6px 0 0;line-height:1.6">'+r.unitsList.map(function(u){
        var isNew = (r.unitsNew || []).indexOf(u) >= 0;
        return '<span class="badge '+(isNew?'b-user':'b-cb')+'" style="margin:0 4px 4px 0;display:inline-block">'+esc(u)+(isNew?' • новое':'')+'</span>';
      }).join('')+'</div></details>';
  }

  // пропущенные ячейки
  if(issues.length){
    h += '<div style="font-weight:600;font-size:13.5px;margin:8px 0 4px">Пропущенные ячейки ('+r.cellIssues+(issues.length < r.cellIssues ? ', показаны первые '+issues.length : '')+')</div>'+
      '<div class="tblwrap" style="max-height:180px;margin-bottom:10px"><table class="co-tbl"><thead><tr>'+
      '<th>Строка</th><th>Колонка</th><th>Значение</th><th>Причина</th></tr></thead><tbody>'+
      issues.map(function(c){
        return '<tr><td class="num">'+c.row+'</td><td>'+esc(c.column)+'</td><td>'+esc(c.value || '∅')+'</td><td>'+esc(c.message)+'</td></tr>';
      }).join('')+'</tbody></table></div>';
  }

  // строки без компании
  if(r.skippedRows && r.skippedRows.length){
    h += '<div style="font-size:13px;color:var(--muted);margin-bottom:10px">Отбраковано строк: '+
      r.skippedRows.map(function(s){ return 'стр.'+s.row+' ('+esc(s.reason)+')'; }).join(', ')+'</div>';
  }

  // дубли в базе + выбор действия
  var dupAction = 'skip';
  if(dups.length){
    h += '<div style="font-weight:600;font-size:13.5px;margin:8px 0 4px">Уже есть в системе ('+r.duplicatesInDb+(dups.length < r.duplicatesInDb ? ', показаны первые '+dups.length : '')+')</div>'+
      '<div class="tblwrap" style="max-height:150px;margin-bottom:8px"><table class="co-tbl"><thead><tr>'+
      '<th>Строка</th><th>Подразделение</th><th>Компания</th><th>Должность</th><th class="num">Зарплата</th></tr></thead><tbody>'+
      dups.map(function(d){
        return '<tr><td class="num">'+d.row+'</td><td>'+esc(d.unit)+'</td><td>'+esc(d.company)+'</td><td>'+esc(d.pos_their)+'</td><td class="num">'+d.pay_from+'</td></tr>';
      }).join('')+'</tbody></table></div>'+
      '<div style="display:flex;gap:14px;font-size:13.5px;margin-bottom:12px">'+
        '<label class="checkline" style="cursor:pointer"><input type="radio" name="impDup" value="skip" checked> Пропустить дубли</label>'+
        '<label class="checkline" style="cursor:pointer"><input type="radio" name="impDup" value="update"> Обновить существующие</label>'+
      '</div>';
  }

  h += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">'+
      '<button class="btn-line" data-x="1" style="min-height:34px;padding:0 14px">Отмена</button>'+
      '<button class="btn-primary" id="impGo" style="min-height:34px;padding:0 16px">'+ic('check',14)+'Загрузить '+r.rowsPrepared+' анкет</button>'+
    '</div>'+
  '</div></div>';
  el.innerHTML = h;
  document.body.appendChild(el);

  function close(){ if(el.parentNode) el.remove(); }
  el.addEventListener('click', function(e){
    if(e.target === el || e.target.closest('[data-x]')) close();
  });

  $('impGo').onclick = function(){
    var picked = el.querySelector('input[name="impDup"]:checked');
    var act = picked ? picked.value : 'skip';
    var btn = $('impGo');
    btn.disabled = true; btn.textContent = 'Загружаю…';
    call('apiAdminImportSurvey', S.token, csv, false, act).then(function(out){
      close();
      if(out && out.ok){
        ask({ title:'Загрузка завершена', html: esc(out.message || 'Готово'), ok:'Понятно' });
        renderAdminTools();
      } else {
        ask({ title:'Ошибка загрузки', html: esc((out && out.error) || 'Не удалось загрузить'), ok:'Понятно' });
      }
    }).catch(function(){
      close();
      toast('Нет связи с сервером', 'no');
    });
  };
}

function openLocksModal(){
  var el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = '<div class="sheet-in um-modal" style="max-width:640px">'+
    '<div class="sheet-hd"><b>'+ic('unlock', 16)+'Управление блокировками записей</b>'+
      '<button class="btn-ghost" data-x="1">Закрыть</button></div>'+
    '<div id="locksBody" style="padding:10px 0 4px"><div class="sp"><i></i> Загрузка списка блокировок…</div></div>'+
  '</div>';
  document.body.appendChild(el);
  guardClose(el, function(){ return false; });

  function load(){
    call('apiAdminGetLocks', S.token).then(function(r){
      if(!r || !r.ok){
        $('locksBody').innerHTML = '<div class="err">'+esc((r&&r.error)||'Ошибка загрузки')+'</div>';
        return;
      }
      var locks = r.locks || [];
      if(!locks.length){
        $('locksBody').innerHTML = '<div class="empty" style="padding:24px 16px;text-align:center">'+
          '<b style="color:var(--ok);font-size:15px">Все записи разблокированы!</b><br>'+
          '<span style="color:var(--muted);font-size:14px;margin-top:6px;display:inline-block">В системе нет удерживаемых записей. Ответственные сотрудники могут свободно вносить изменения.</span></div>';
        return;
      }
      var totalComps = 0, totalSurvs = 0;
      locks.forEach(function(l){ totalComps += (l.comps||0); totalSurvs += (l.survs||0); });

      var h = '<div style="margin-bottom:12px;font-size:14px;color:var(--muted);line-height:1.4">'+
        'Всего удерживается: <b>'+totalComps+'</b> компаний, <b>'+totalSurvs+'</b> анкет должностей. '+
        'Выберите, с кого снять блокировки:</div>';

      h += '<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">'+
        '<button class="btn-primary" id="btnUnlockAdmins" style="flex:1;min-height:32px;font-size:13.5px">'+ic('shield',13)+'Снять со всех Администраторов</button>'+
        '<button class="btn-danger" id="btnUnlockAllModal" style="flex:1;min-height:32px;font-size:13.5px">'+ic('unlock',13)+'Снять вообще со всех ('+locks.length+')</button>'+
      '</div>';

      h += '<div class="tblwrap" style="max-height:320px;margin-bottom:0"><table class="co-tbl">'+
        '<thead><tr><th>Автор блокировки</th><th>Роль</th><th class="num">Компаний</th><th class="num">Должностей</th><th>Действие</th></tr></thead><tbody>';

      locks.forEach(function(l){
        var roleBadge = l.role === 'admin' ? 'b-admin' : l.role === 'cb' ? 'b-cb' : 'b-user';
        h += '<tr>'+
          '<td><b>'+esc(l.owner)+'</b></td>'+
          '<td><span class="badge '+roleBadge+'">'+esc(l.role)+'</span></td>'+
          '<td class="num">'+(l.comps||0)+'</td>'+
          '<td class="num">'+(l.survs||0)+'</td>'+
          '<td><button class="btn-line" style="min-height:26px;padding:0 8px;font-size:12.5px;white-space:nowrap" data-unlock-owner="'+esc(l.owner)+'">'+ic('unlock',11)+'Снять блок</button></td>'+
        '</tr>';
      });

      h += '</tbody></table></div>';
      $('locksBody').innerHTML = h;

      $('btnUnlockAdmins').onclick = function(){
        adminUnlockTarget(null, 'admin', 'всех администраторов', el, load);
      };
      $('btnUnlockAllModal').onclick = function(){
        adminUnlockTarget('all', null, 'всех авторов', el, load);
      };
      $('locksBody').querySelectorAll('button[data-unlock-owner]').forEach(function(btn){
        btn.onclick = function(){
          var owner = this.dataset.unlockOwner;
          adminUnlockTarget(owner, null, 'пользователя «' + owner + '»', el, load);
        };
      });
    }).catch(function(){
      $('locksBody').innerHTML = '<div class="err">Нет связи с сервером</div>';
    });
  }
  load();
}

function adminUnlockTarget(owner, role, label, modalEl, reloadFn){
  ask({
    title: 'Снять блокировки?',
    html: 'Вы собираетесь снять все блокировки для <b>' + esc(label) + '</b>.<br><br>Ответственные сотрудники смогут сразу вносить и сохранять изменения.',
    ok: 'Снять блокировки',
    danger: false
  }).then(function(yes){
    if(!yes) return;
    toast('Снимаем блокировки…');
    call('apiAdminUnlock', S.token, owner, role).then(function(res){
      if(res && res.ok){
        toast(res.message, 'ok');
        if(reloadFn) reloadFn();
        quietRefresh();
      } else {
        toast((res && res.error) || 'Ошибка', 'no');
      }
    }).catch(function(){ toast('Нет связи с сервером', 'no'); });
  });
}

function adminUnlockQuick(type){
  ask({
    title: 'Снять ВСЕ блокировки записей?',
    html: 'Будут каскадно сняты авторские блокировки («Администратор C&B» и др.) со всех компаний и должностей во всех подразделениях.<br><br>Ответственные сотрудники сразу получат полный доступ к редактированию.',
    ok: 'Снять все блокировки',
    danger: true
  }).then(function(yes){
    if(!yes) return;
    toast('Снимаем все блокировки…');
    call('apiAdminUnlock', S.token, 'all', null).then(function(res){
      if(res && res.ok){
        ask({ title: 'Блокировки сняты', html: esc(res.message), ok: 'Отлично' });
        quietRefresh();
      } else {
        toast((res && res.error) || 'Ошибка', 'no');
      }
    }).catch(function(){ toast('Нет связи с сервером', 'no'); });
  });
}

// ─── Вкладка: Роли и доступы (admin-only) ───
/**
 * Конструктор ролей и доступов — матрица «право × роль» поверх фиксированных
 * ролей (admin/cb/hrbp/dir_head/head/user). Роли сами не создаются и не
 * переименовываются — это осознанное сужение масштаба: каскадная логика
 * dir_head/head в других экранах завязана на точные названия ролей, и делать
 * их произвольными означало бы переписывать эту логику. Настраивается только
 * доступ к разделам админки (просмотр/редактирование/добавление).
 * 'admin' — защищённая роль, здесь не редактируется, сервер и так даёт ей
 * все права всегда (requireCapability пропускает её без обращения к таблице).
 */
var ROLE_LABELS_RU = { admin:'Администратор', cb:'C&B Аналитик', hrbp:'HR BP', dir_head:'Рук. направления', head:'Рук. отдела', user:'Сотрудник' };

/** Опции для выпадающего списка роли в карточке пользователя — из S.rolesList
 *  (подгружается вместе со списком пользователей), с фолбэком на встроенные. */
function roleOptionsHtml(current){
  var list = (S.rolesList && S.rolesList.length) ? S.rolesList : [
    { key:'user', label:'Сотрудник' }, { key:'head', label:'Руководитель отдела' },
    { key:'dir_head', label:'Руководитель направления' }, { key:'hrbp', label:'HR BP' },
    { key:'cb', label:'C&B Аналитик' }, { key:'admin', label:'Администратор' }
  ];
  return list.map(function(r){
    return '<option value="'+esc(r.key)+'"'+(current===r.key?' selected':'')+'>'+esc(r.key)+' — '+esc(r.label)+'</option>';
  }).join('');
}

function loadAdminRoles(){
  call('apiAdminGetRoleCapabilities', S.token).then(function(r){
    if(!r || !r.ok){
      $('adminContent').innerHTML = '<div class="err">'+esc((r&&r.error)||'Ошибка загрузки прав доступа')+'</div>';
      return;
    }
    S.rolesList = (r.roles || []).map(function(x){ return { key:x.key, label:x.label }; });
    S.rc = {
      catalog: r.capabilities,
      roles: r.roles,
      matrix: r.matrix,
      orig: JSON.parse(JSON.stringify(r.matrix)),
      labels: {},
      sel: (S.rc && S.rc.sel) || (r.roles[0] && r.roles[0].key)
    };
    renderAdminRoles();
  }).catch(function(){
    $('adminContent').innerHTML = '<div class="err">Нет связи с сервером</div>';
  });
}

function renderAdminRoles(){
  var d = S.rc; if(!d) return;
  var caps = d.catalog;
  var groups = [], byRes = {};
  caps.forEach(function(c){
    if(!byRes[c.resource]){ byRes[c.resource] = { label:c.resourceLabel, items:[] }; groups.push(byRes[c.resource]); }
    byRes[c.resource].items.push(c);
  });

  if(!d.roles.some(function(r){ return r.key === d.sel; })) d.sel = d.roles[0] && d.roles[0].key;
  var sel = d.roles.filter(function(r){ return r.key === d.sel; })[0] || d.roles[0];

  var listHtml = d.roles.map(function(r){
    var n = (d.matrix[r.key] || []).length;
    var badge = r.is_admin ? 'полный доступ' : (r.is_protected ? 'встроенная' : 'своя');
    var lbl = (d.labels[r.key] != null) ? d.labels[r.key] : r.label;
    return '<button class="r2-item'+(r.key===d.sel?' on':'')+'" data-rk="'+esc(r.key)+'">'+
      '<span class="r2-name">'+esc(lbl)+'</span>'+
      '<span class="r2-sub">'+esc(badge)+' \u00b7 '+(r.is_admin ? 'все права' : (n+' '+declOfNum(n,["право","права","прав"])))+' \u00b7 '+r.users+' чел.</span>'+
    '</button>';
  }).join('');

  $('adminContent').innerHTML =
    '<div class="roles2">'+
      '<div class="roles2-bar">'+
        '<p class="step-hint roles2-hint">Слева \u2014 роли, справа \u2014 что роль видит и делает в админке. У \u00abАдминистратора\u00bb доступ всегда полный. Особые полномочия структурных ролей заданы в коде \u2014 здесь показаны для справки.</p>'+
        '<button id="roleAdd" class="btn-line roles2-bar-btn">'+ic('users',14)+' Добавить роль</button>'+
        '<button id="roleSaveAll" class="btn-primary roles2-bar-btn">'+ic('check',14)+' Сохранить</button>'+
      '</div>'+
      '<div class="roles2-body">'+
        '<div class="roles2-list">'+listHtml+'</div>'+
        '<div class="roles2-detail" id="roleDetail">'+roleDetailHtml(sel, groups)+'</div>'+
      '</div>'+
    '</div>';

  wireAdminRoles(groups);
}

function roleDetailHtml(r, groups){
  if(!r) return '';
  var d = S.rc;
  var granted = d.matrix[r.key] || [];
  var curLabel = (d.labels[r.key] != null) ? d.labels[r.key] : r.label;

  var head = '<div class="r2-head">';
  if(r.key === 'admin'){
    head += '<div class="r2-title">'+esc(curLabel)+'</div>';
  } else {
    head += '<input id="r2Label" class="r2-title-in" value="'+esc(curLabel)+'" maxlength="40" data-rk="'+esc(r.key)+'">';
  }
  head += '<span class="r2-key">'+esc(r.key)+'</span>';
  if(!r.is_protected){
    var canDel = r.users === 0;
    head += '<button id="roleDel" class="btn-line btn-danger roles2-del" '+(canDel?'':'disabled title="Роль назначена пользователям \u2014 сначала смените им роль"')+'>'+ic('trash',13)+' Удалить</button>';
  }
  head += '</div>';

  var note = r.structural
    ? '<div class="r2-note">'+ic('warn',14)+'<span><b>Особые полномочия (заданы в коде):</b> '+esc(r.note)+'</span></div>'
    : (r.is_protected ? '' : '<div class="r2-note r2-note--plain">'+ic('help',14)+'<span>Своя роль: доступ только по галочкам ниже; область данных \u2014 как у \u00abСотрудника\u00bb (только назначенные подразделения).</span></div>');

  var body;
  if(r.key === 'admin'){
    body = '<div class="r2-allon">'+ic('check',16)+' Полный доступ ко всем разделам \u2014 не настраивается.</div>';
  } else {
    body = groups.map(function(g){
      return '<div class="r2-group">'+
        '<div class="r2-group-t">'+esc(g.label)+'</div>'+
        g.items.map(function(c){
          var on = granted.indexOf(c.id) >= 0;
          return '<label class="r2-cap">'+
            '<input type="checkbox" data-cap="'+esc(c.id)+'"'+(on?' checked':'')+'>'+
            '<span>'+esc(c.label)+'</span>'+
          '</label>';
        }).join('')+
      '</div>';
    }).join('');
  }
  return head + note + '<div class="r2-caps">'+body+'</div>';
}

function wireAdminRoles(groups){
  var d = S.rc;

  $('adminContent').querySelectorAll('.r2-item').forEach(function(btn){
    btn.onclick = function(){ d.sel = this.dataset.rk; renderAdminRoles(); };
  });

  var lbl = $('r2Label');
  if(lbl){ lbl.oninput = function(){ d.labels[this.dataset.rk] = this.value; }; }

  $('roleDetail').querySelectorAll('input[type=checkbox][data-cap]').forEach(function(box){
    box.onchange = function(){
      var arr = d.matrix[d.sel] = d.matrix[d.sel] || [];
      var i = arr.indexOf(this.dataset.cap);
      if(this.checked){ if(i<0) arr.push(this.dataset.cap); }
      else if(i>=0) arr.splice(i,1);
      var sub = $('adminContent').querySelector('.r2-item.on .r2-sub');
      var role = d.roles.filter(function(x){ return x.key === d.sel; })[0];
      if(sub && role){
        var badge = role.is_admin ? 'полный доступ' : (role.is_protected ? 'встроенная' : 'своя');
        sub.textContent = badge + ' \u00b7 ' + (arr.length + ' ' + declOfNum(arr.length,["право","права","прав"])) + ' \u00b7 ' + role.users + ' чел.';
      }
    };
  });

  $('roleAdd').onclick = function(){
    askText({ title:'Новая роль', html:'Название роли (например \u00abНаблюдатель\u00bb). Права назначите после создания.', placeholder:'Название', ok:'Создать' }).then(function(name){
      if(!name) return;
      call('apiAdminCreateRole', S.token, name).then(function(res){
        if(!res || !res.ok){ toast((res&&res.error)||'Не удалось создать роль','no'); return; }
        toast('Роль создана','ok');
        if(S.rc) S.rc.sel = res.key;
        loadAdminRoles();
      });
    });
  };

  var del = $('roleDel');
  if(del && !del.disabled){
    del.onclick = function(){
      ask({ title:'Удалить роль?', html:'Роль и её права будут удалены. Действие необратимо.', ok:'Удалить', danger:true }).then(function(yes){
        if(!yes) return;
        call('apiAdminDeleteRole', S.token, d.sel).then(function(res){
          if(!res || !res.ok){ toast((res&&res.error)||'Не удалось удалить','no'); return; }
          toast('Роль удалена','ok');
          if(S.rc) S.rc.sel = null;
          loadAdminRoles();
        });
      });
    };
  }

  $('roleSaveAll').onclick = function(){
    var btn = this; btn.disabled = true; btn.textContent = 'Сохраняем\u2026';
    var jobs = [];
    d.roles.forEach(function(r){
      if(r.key === 'admin') return;
      var now = (d.matrix[r.key] || []).slice().sort().join(',');
      var was = (d.orig[r.key] || []).slice().sort().join(',');
      if(now !== was) jobs.push(call('apiAdminSaveRoleCapabilities', S.token, { role:r.key, capabilities:d.matrix[r.key] || [] }));
    });
    Object.keys(d.labels).forEach(function(k){
      var r = d.roles.filter(function(x){ return x.key === k; })[0];
      var v = String(d.labels[k] || '').trim();
      if(r && v && v !== r.label) jobs.push(call('apiAdminRenameRole', S.token, k, v));
    });
    if(!jobs.length){ btn.disabled = false; btn.textContent = 'Сохранить'; toast('Изменений нет','ok'); return; }
    Promise.all(jobs).then(function(results){
      btn.disabled = false; btn.textContent = 'Сохранить';
      if(results.some(function(x){ return !x || !x.ok; })) toast('Часть изменений не сохранена','no');
      else toast('Сохранено','ok');
      loadAdminRoles();
    }).catch(function(){
      btn.disabled = false; btn.textContent = 'Сохранить';
      toast('Нет связи с сервером','no');
    });
  };
}

// ═══════════════════════════════════════════════════════════
// ОТЧЁТ ПО ПОДРАЗДЕЛЕНИЯМ — прогресс заполнения + управление периодом.
// Это НЕ аналитический дашборд (openDashboard): здесь таблица «кто что
// заполнил», без зарплатных вилок и перцентилей. Данные — apiDashboard.
// ═══════════════════════════════════════════════════════════
function openProgress(){
  if(window.WorkspaceTabs && WorkspaceTabs.openTab && !WorkspaceTabs.isInsideTabRun){
    WorkspaceTabs.openTab({
      key: 'progress',
      title: 'Сводка по подразделениям',
      icon: 'clipboard',
      state: { appView: 'progress', unit: null },
      run: function(){ openProgress(); }
    });
    return;
  }
  S.appView = 'progress';
  S.unit = null;
  saveNavState();
  renderTopNav();
  S.backTo = null;
  // Пункт верхнего уровня (рельса / «Главная»), не подэкран — стрелки «Назад»
  // здесь быть не должно: без S.backTo она уводила в «Мои подразделения».
  setTop('Сводка по подразделениям', '', false);
  $('bar').classList.add('hidden');
  $('body').onclick = null;
  $('body').innerHTML = '<div class="sp"><i></i> Считаем…</div>';
  call('apiDashboard', S.token).then(function(r){
    if(!r || !r.ok){ $('body').innerHTML = '<div class="err">'+esc((r&&r.error)||'Ошибка')+'</div>'; return; }
    if(r.period) S.data.period = r.period;
    var p = S.data.period || {};
    var closed = p.state === 'закрыт';

    var done = r.rows.filter(function(x){ return x.total && x.done === x.total; }).length;
    var svTotal = r.rows.reduce(function(s,x){ return s + (x.surveys||0); }, 0);
    // Уникальные компании (с сервера); построчные суммы x.total/x.done/x.ask
    // задваивают одну компанию по десяткам отделов.
    var mcTotal = (r.marketCompanies != null)
      ? r.marketCompanies
      : r.rows.reduce(function(s,x){ return s + (x.total||0); }, 0);
    var mcDone = (r.marketCompaniesDone != null)
      ? r.marketCompaniesDone
      : r.rows.reduce(function(s,x){ return s + (x.done||0); }, 0);
    var askTotal = (r.marketAskCompanies != null)
      ? r.marketAskCompanies
      : r.rows.reduce(function(s,x){ return s + (x.ask||0); }, 0);

    // Период, итоги и действие — одной строкой. Раньше это были карточка на
    // 520px в колонку, отдельная строка-заголовок с итогами и отдельная
    // строка поиска: на экране 1440×860 таблица начиналась только на 390-й
    // точке и уходила на 113px за нижний край, а справа от карточки
    // простаивало 624px ширины.
    var h = '<div class="page-head">'+
      '<div class="page-head-main">'+
        '<div class="page-head-k">Период заполнения</div>'+
        '<div class="page-head-v">'+esc(p.name || 'без названия')+
          ' <b style="font-size:14px;font-weight:700;color:'+(closed?'var(--no)':'var(--ok)')+'">'+esc(p.state || 'открыт')+'</b></div>'+
        '<div class="page-head-s">'+
          (p.from ? 'с '+esc(p.from)+' ' : '') + (p.to ? 'по '+esc(p.to) : '') +
          (p.by ? (p.from||p.to ? ' · ' : '')+'изменил: '+esc(p.by)+
                  (p.at ? ' · '+esc(fmtDateTime(p.at)) : '') : '') +
        '</div>'+
      '</div>'+
      '<div class="page-head-stats">'+
        '<div class="phs"><b>'+done+'</b><span>из '+r.rows.length+' заполнено</span></div>'+
        '<div class="phs"><b>'+mcDone+'</b><span>из '+mcTotal+' '+declOfNum(mcTotal, ['компания проверена','компании проверено','компаний проверено'])+'</span></div>'+
        '<div class="phs"><b>'+svTotal+'</b><span>записей по должностям</span></div>'+
        (askTotal ? '<div class="phs"><b>'+askTotal+'</b><span>'+declOfNum(askTotal, ['компания','компании','компаний'])+' на уточнении</span></div>' : '')+
      '</div>'+
      (closed
        ? '<button id="btnPeriodReopen" class="btn-line page-head-act" style="color:var(--ok);border-color:var(--ok)">Открыть закрытый обратно</button>'+
          '<button id="btnPeriod" class="btn-line page-head-act">Открыть новый период</button>'
        : '<button id="btnPeriod" class="btn-line btn-danger page-head-act">Закрыть период</button>')+
      '</div>';

    // Группировка готовности по направлениям
    var byDir = {};
    r.rows.forEach(function(x){
      var dir = x.dir || '(без направления)';
      if(!byDir[dir]) byDir[dir] = { dir: dir, total: 0, done: 0, units: 0 };
      byDir[dir].total += x.total;
      byDir[dir].done += x.done;
      byDir[dir].units += 1;
    });
    var dirBars = Object.keys(byDir).map(function(k){
      var d = byDir[k];
      d.pct = d.total ? Math.round(d.done / d.total * 100) : 0;
      return d;
    }).sort(function(a, b){ return a.pct - b.pct; });

    S.dashSumTab = S.dashSumTab || 'units';

    // Вкладки разделов
    var sumTabs = [
      { id: 'units', icon: 'units', label: 'По подразделениям (' + r.rows.length + ')' },
      { id: 'dirs', icon: 'target', label: 'По направлениям (' + dirBars.length + ')' }
    ];

    h += '<div class="toolbar" style="margin-bottom:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">'+
      '<div style="display:flex;gap:4px;flex:none">'+
        sumTabs.map(function(t){
          var on = S.dashSumTab === t.id ? ' on' : '';
          return '<button class="sub-tab'+on+'" data-sumtab="'+t.id+'">'+ic(t.icon, 14)+esc(t.label)+'</button>';
        }).join('')+
      '</div>'+
      '<div id="dashSumSearchBox" class="search-wrap search-wrap--r" style="flex:1;min-width:200px;margin:0;'+(S.dashSumTab==='dirs'?'display:none;':'')+'">'+
        icBare('search', 14)+
        '<input id="dashSumSearch" placeholder="Поиск по подразделению, ответственному, HR BP…" style="min-height:30px;padding:4px 32px 4px 10px;font-size:13.5px">'+
      '</div>'+
      '<div id="dashSumCount" style="font-size:13px;color:var(--muted);'+(S.dashSumTab==='dirs'?'display:none;':'')+'"></div>'+
    '</div>';

    h += '<div id="dashSumTabBody"></div>';
    $('body').innerHTML = h;

    var sInput = $('dashSumSearch');
    if(sInput){
      sInput.oninput = function(){ drawTable(); };
    }

    $('body').querySelectorAll('button[data-sumtab]').forEach(function(btn){
      btn.onclick = function(){
        S.dashSumTab = this.dataset.sumtab;
        $('body').querySelectorAll('button[data-sumtab]').forEach(function(b){ b.classList.remove('on'); });
        this.classList.add('on');
        var isUnits = S.dashSumTab === 'units';
        if($('dashSumSearchBox')) $('dashSumSearchBox').style.display = isUnits ? '' : 'none';
        if($('dashSumCount')) $('dashSumCount').style.display = isUnits ? '' : 'none';
        renderSumTab();
      };
    });

    function renderSumTab(){
      var box = $('dashSumTabBody');
      if(!box) return;

      if(S.dashSumTab === 'dirs'){
        var dh = '<div class="tblwrap tblwrap--page"><table class="co-tbl co-tbl--pin">'+
          '<thead><tr><th>Направление</th><th class="num">Готовность</th><th class="num">Подразделений</th><th class="num">Заполнено связей</th></tr></thead><tbody>';
        dh += dirBars.map(function(d){
          var isDone = d.pct >= 100;
          var cls = isDone ? 'p-ok' : (d.pct > 0 ? 'p-mid' : 'p-no');
          return '<tr class="dash-row" data-d="'+esc(d.dir)+'" style="cursor:pointer">'+
            '<td><b>'+esc(d.dir)+'</b>'+
              '<div class="prog-bar-bg" style="margin-top:6px">'+
                '<div class="prog-bar-fill" style="width:'+d.pct+'%;background:'+(isDone?'var(--ok)':'var(--accent)')+'"></div>'+
              '</div>'+
            '</td>'+
            '<td class="num"><span class="pill '+cls+'">'+d.pct+'%</span></td>'+
            '<td class="num">'+d.units+'</td>'+
            '<td class="num">'+d.done+' / '+d.total+'</td>'+
          '</tr>';
        }).join('');
        dh += '</tbody></table></div>';
        box.innerHTML = dh;

        box.querySelectorAll('tr[data-d]').forEach(function(tr){
          tr.onclick = function(){
            var dName = this.dataset.d;
            S.dashSumTab = 'units';
            $('body').querySelectorAll('button[data-sumtab]').forEach(function(b){
              b.classList.toggle('on', b.dataset.sumtab === 'units');
            });
            if($('dashSumSearchBox')) $('dashSumSearchBox').style.display = '';
            if($('dashSumCount')) $('dashSumCount').style.display = '';
            renderSumTab();
            var sin = $('dashSumSearch');
            if(sin){ sin.value = dName === '(без направления)' ? '' : dName; drawTable(); }
          };
        });
      } else {
        box.innerHTML = '<div id="dashSumTblBox"></div>';
        drawTable();
      }
    }

    function drawTable(){
      var q = ($('dashSumSearch') ? $('dashSumSearch').value : '').trim().toLowerCase();
      var rows = !q ? r.rows : r.rows.filter(function(x){
        return (x.unit||'').toLowerCase().indexOf(q) >= 0 ||
               (x.resp||'').toLowerCase().indexOf(q) >= 0 ||
               (x.hrbp||'').toLowerCase().indexOf(q) >= 0 ||
               (x.dir||'').toLowerCase().indexOf(q) >= 0;
      });
      if($('dashSumCount')){
        $('dashSumCount').innerHTML = tblCount(rows.length, r.rows.length,
          ['подразделение', 'подразделения', 'подразделений']);
      }
      var t = '<div class="tblwrap tblwrap--page"><table class="co-tbl co-tbl--pin">'+
        '<thead><tr><th>Подразделение</th><th>Ответственный</th><th class="num">Компании</th>'+
        '<th class="num">Уточнить</th><th class="num">Должности</th><th class="num">Данные</th><th class="num">Обновлено</th></tr></thead><tbody>';
      t += rows.length ? rows.map(function(x){
        var pct = x.total ? Math.round(x.done/x.total*100) : 0;
        var cls = pct>=100 ? 'p-ok' : (pct>0 ? 'p-mid' : 'p-no');
        var scls = x.surveys>0 ? 'p-ok' : 'p-no';
        // Должности: закрыто рынком из штатки подразделения. Нет штатки — «—».
        var pt = x.posTotal||0, pf = x.posFilled||0;
        var pcls = pt===0 ? 'p-no' : (pf>=pt ? 'p-ok' : (pf>0 ? 'p-mid' : 'p-no'));
        var posCell = pt===0 ? '—' : '<span class="pill '+pcls+'">'+pf+'/'+pt+'</span>';
        return '<tr class="dash-row" data-u="'+esc(x.unit)+'" style="cursor:pointer">'+
          '<td><b>'+esc(x.unit)+'</b></td><td>'+esc(x.resp)+'</td>'+
          '<td class="num"><span class="pill '+cls+'">'+x.done+'/'+x.total+'</span></td>'+
          '<td class="num">'+((x.ask||0) ? '<span class="pill p-ask">'+x.ask+'</span>' : '—')+'</td>'+
          '<td class="num">'+posCell+'</td>'+
          '<td class="num"><span class="pill '+scls+'">'+(x.surveys||0)+'</span></td>'+
          '<td class="num" style="font-size:13px;color:var(--muted)">'+esc(fmtDateTime(x.at)||'—')+'</td></tr>';
      }).join('') : '<tr><td colspan="7"><div class="empty">Ничего не найдено</div></td></tr>';
      t += '</tbody></table></div>';
      if($('dashSumTblBox')) $('dashSumTblBox').innerHTML = t;

      if($('dashSumTblBox')){
        $('dashSumTblBox').onclick = function(e){
          var tr = e.target.closest('tr[data-u]');
          if(!tr) return;
          openUnit(tr.dataset.u, openProgress);
        };
      }
    }

    renderSumTab();

    $('btnPeriod').onclick = function(){
      var btn = this;
      if(closed){
        askText({
          title: 'Открыть новый период',
          html: 'Начнётся новый год сбора с чистого листа. Данные закрытого периода останутся в архиве.',
          value: 'Обзор рынка — ' +
            new Date().toLocaleDateString('ru-RU', {month:'long', year:'numeric'}),
          placeholder: 'Название периода',
          ok: 'Открыть период'
        }).then(function(name){
          if(name === null) return;
          btn.disabled = true; btn.textContent = 'Открываем…';
          call('apiSetPeriod', S.token, { action:'new', name:name })
            .then(afterPeriod).catch(periodFail);
        });
      } else {
        ask({
          title: 'Закрыть период заполнения?',
          html: 'Руководители перейдут в режим просмотра — вносить и удалять данные ' +
                'они больше не смогут.\nВы как HR BP сможете править и после закрытия. ' +
                'Если закрыли по ошибке — «Открыть закрытый обратно» вернёт всё как было.',
          ok: 'Закрыть период',
          danger: true
        }).then(function(yes){
          if(!yes) return;
          btn.disabled = true; btn.textContent = 'Закрываем…';
          call('apiSetPeriod', S.token, { action:'close' }).then(afterPeriod).catch(periodFail);
        });
      }
    };
    if($('btnPeriodReopen')){
      $('btnPeriodReopen').onclick = function(){
        var btn = this;
        ask({
          title: 'Открыть текущий период обратно?',
          html: 'Период снова станет открытым — руководители смогут вносить данные за этот год. Новый период не создаётся.',
          ok: 'Открыть обратно'
        }).then(function(yes){
          if(!yes) return;
          btn.disabled = true; btn.textContent = 'Открываем…';
          call('apiSetPeriod', S.token, { action:'reopen' }).then(afterPeriod).catch(periodFail);
        });
      };
    }
    function afterPeriod(res){
      if(!res || !res.ok){ toast((res&&res.error)||'Не удалось изменить период'); openProgress(); return; }
      S.data.period = res.period;
      var isElevated = (S.data.user.role === 'admin' || S.data.user.role === 'cb');
      S.ro = !!(res.period.state === 'закрыт' && S.data.user.role !== 'hrbp' && !isElevated);
      toast('Период ' + res.period.state);
      openProgress();
    }
    function periodFail(){ toast('Нет связи'); openProgress(); }
  });
}

// ═══════════════════════════════════════════════════════════
// МУЛЬТИИСТОЧНИКОВЫЙ БЕНЧМАРКИНГ (ФАЗА 1)
// ═══════════════════════════════════════════════════════════
var BM_STATE = {
  tab: 'compare',
  selectedPosId: null,
  selectedSourceKey: 'b1',
  sources: [],
  datasets: [],
  mappings: [],
  comparison: null,
  loading: false
};

function renderSourceBadge(sourceKey, isLicensed, customTitle){
  var label = customTitle;
  if(!label){
    var src = (BM_STATE.sources || []).find(function(s){ return s.key === sourceKey; });
    if(src) label = src.title;
    else if(sourceKey === 'internal') label = 'Внутренний сбор';
    else if(sourceKey === 'b1') label = 'B1 (EY)';
    else if(sourceKey === 'antal') label = 'Antal';
    else if(sourceKey === 'korn_ferry') label = 'Korn Ferry';
    else if(sourceKey === 'pwc') label = 'PwC';
    else if(sourceKey === 'mercer') label = 'Mercer';
    else if(sourceKey === 'hh_ru') label = 'HeadHunter';
    else if(sourceKey === 'job_farovon') label = 'Job Farovon';
    else if(sourceKey === 'stat_tj') label = 'Агентство по статистике';
    else if(sourceKey === 'partner_survey') label = 'Партнёрский опрос';
    else label = sourceKey;
  }

  var licBadge = isLicensed ? '<span class="top-period-pill is-closed" style="margin-left:6px;font-size:12px;padding:1px 6px">Лицензия</span>' : '';
  return '<span class="top-period-pill" style="margin-right:0"><span class="top-period-dot"></span> <b>' + esc(label) + '</b></span>' + licBadge;
}

function openBenchmarks(){
  if(window.WorkspaceTabs && WorkspaceTabs.openTab && !WorkspaceTabs.isInsideTabRun){
    WorkspaceTabs.openTab({
      key: 'benchmarks',
      title: 'Бенчмаркинг',
      icon: 'chart',
      state: { appView: 'benchmarks', unit: null },
      run: function(){ openBenchmarks(); }
    });
    return;
  }
  S.appView = 'benchmarks';
  S.unit = null;
  saveNavState();
  renderTopNav();
  setTop('Мультиисточниковый бенчмаркинг', userLabel(), false, 'chart');
  $('bar').classList.add('hidden');
  $('body').onclick = null;

  var body = $('body');
  body.innerHTML = '<div class="sub-tabs sub-tabs--sticky dash-tabbar bm-tabbar">' +
      '<div class="dash-tab-strip">' +
        '<button class="sub-tab ' + (BM_STATE.tab === 'compare' ? 'on' : '') + '" onclick="switchBmTab(\'compare\')">' + ic('chart', 14) + 'Сравнение по должности</button>' +
        '<button class="sub-tab ' + (BM_STATE.tab === 'mapping' ? 'on' : '') + '" onclick="switchBmTab(\'mapping\')">' + ic('link', 14) + 'Сопоставление должностей</button>' +
        '<button class="sub-tab ' + (BM_STATE.tab === 'datasets' ? 'on' : '') + '" onclick="switchBmTab(\'datasets\')">' + ic('archive', 14) + 'Источники и датасеты</button>' +
      '</div>' +
      '<button id="btnBmExpMatrix" class="btn-line dash-filter-export">' +
        ic('download', 14) + 'Экспорт в CSV' +
      '</button>' +
    '</div>' +
    '<div id="bmContent" class="bm-content">Загрузка данных…</div>';

  $('btnBmExpMatrix').onclick = exportBmMatrixCsv;

  loadBmInitialData();
}

function switchBmTab(tab){
  BM_STATE.tab = tab;
  openBenchmarks();
}

function loadBmInitialData(){
  Promise.all([
    call('apiBenchmarkSources', S.token).catch(function(){ return { sources:[] }; }),
    call('apiDictList', S.token, 'positions').catch(function(){ return { items:[] }; })
  ]).then(function(res){
    BM_STATE.sources = (res[0] && res[0].sources) || [];
    if(res[1] && res[1].items) S.data.dictPositions = res[1].items;

    if(!BM_STATE.selectedPosId && S.data.dictPositions && S.data.dictPositions.length){
      BM_STATE.selectedPosId = S.data.dictPositions[0].id;
    }

    if(BM_STATE.tab === 'compare') renderBmCompare();
    else if(BM_STATE.tab === 'mapping') renderBmMapping();
    else if(BM_STATE.tab === 'datasets') renderBmDatasets();
  });
}

function renderSalaryRangeBar(stats, ourFrom, ourTo, ourMid){
  stats = stats || {};
  var p10 = Number(stats.min || stats.p10 || 0);
  var p25 = Number(stats.p25 || 0);
  var p50 = Number(stats.p50 || 0);
  var p75 = Number(stats.p75 || 0);
  var p90 = Number(stats.max || stats.p90 || 0);
  ourFrom = Number(ourFrom || 0);
  ourTo = Number(ourTo || 0);
  ourMid = Number(ourMid || 0);

  if(!p50 && !ourMid) return '';

  var allVals = [p10, p25, p50, p75, p90, ourFrom, ourTo, ourMid].filter(function(v){ return v > 0; });
  if(!allVals.length) return '';

  var minVal = Math.min.apply(null, allVals) * 0.85;
  var maxVal = Math.max.apply(null, allVals) * 1.15;
  var span = maxVal - minVal;
  if(span <= 0) span = 1;

  function toPct(v){
    var pct = ((v - minVal) / span) * 100;
    return Math.max(0, Math.min(100, pct));
  }

  var p25Pct = p25 ? toPct(p25) : 0;
  var p75Pct = p75 ? toPct(p75) : 100;
  var p50Pct = p50 ? toPct(p50) : 50;

  var ourFromPct = ourFrom ? toPct(ourFrom) : (ourMid ? toPct(ourMid) : 0);
  var ourToPct = ourTo ? toPct(ourTo) : (ourMid ? toPct(ourMid) : 0);
  var ourMidPct = ourMid ? toPct(ourMid) : 0;

  // Статус попадания в рынок
  var statusBadge = '';
  if(ourMid > 0 && p25 > 0 && p75 > 0){
    if(ourMid >= p25 && ourMid <= p75){
      statusBadge = '<span class="top-period-pill"><span class="top-period-dot"></span> В коридоре рынка (P25–P75)</span>';
    } else if(ourMid < p25){
      var d = Math.round(((p25 - ourMid) / p25) * 100);
      statusBadge = '<span class="top-period-pill is-closed"><span class="top-period-dot"></span> Ниже рынка (−' + d + '% от P25)</span>';
    } else {
      var d = Math.round(((ourMid - p75) / p75) * 100);
      statusBadge = '<span class="top-period-pill" style="color:var(--warn);border-color:var(--warn-border)"><span class="top-period-dot" style="background:var(--warn)"></span> Выше рынка (+' + d + '% от P75)</span>';
    }
  }

  return '<div style="margin:14px 0 4px;padding:12px 14px;background:var(--color-paper-mist);border-radius:var(--radius-buttons);border:1px solid var(--color-ash)">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:6px">' +
      '<span style="font-size:12px;font-weight:600;color:var(--color-fog);text-transform:uppercase;letter-spacing:0.04em">Коридор рынка vs Оклад Фаровон</span>' +
      statusBadge +
    '</div>' +
    '<div style="position:relative;height:38px;margin:22px 24px 18px">' +
      '<div style="position:absolute;left:0;right:0;top:15px;height:6px;background:var(--color-ash);border-radius:3px"></div>' +
      (p25 && p75 ?
        '<div style="position:absolute;left:' + p25Pct + '%;width:' + Math.max(3, p75Pct - p25Pct) + '%;top:13px;height:10px;background:var(--accent-soft);border:1px solid var(--accent-border);border-radius:4px" title="Рыночный коридор P25–P75: ' + p25.toLocaleString('ru-RU') + ' – ' + p75.toLocaleString('ru-RU') + '">' +
        '</div>'
      : '') +
      (p50 ?
        '<div style="position:absolute;left:' + p50Pct + '%;top:5px;width:2px;height:26px;background:var(--accent);transform:translateX(-50%);z-index:2;border-radius:1px">' +
          '<div style="position:absolute;top:-20px;left:50%;transform:translateX(-50%);font-size:11.5px;font-weight:600;color:var(--color-midnight-ink);white-space:nowrap;background:var(--color-canvas-white);padding:1px 6px;border-radius:4px;border:1px solid var(--color-ash);box-shadow:var(--shadow-xs);font-feature-settings:\'tnum\' 1">P50: ' + p50.toLocaleString('ru-RU') + '</div>' +
        '</div>'
      : '') +
      (ourMid ?
        (ourFrom && ourTo && ourFrom !== ourTo ?
          '<div style="position:absolute;left:' + ourFromPct + '%;width:' + Math.max(4, ourToPct - ourFromPct) + '%;top:27px;height:5px;background:var(--ok);border-radius:2px;z-index:3" title="Вилка Фаровон: ' + ourFrom.toLocaleString('ru-RU') + ' – ' + ourTo.toLocaleString('ru-RU') + '">' +
          '</div>'
        : '') +
        '<div style="position:absolute;left:' + ourMidPct + '%;top:18px;width:14px;height:14px;background:var(--ok);border:2px solid #fff;box-shadow:var(--shadow-sm);border-radius:50%;transform:translateX(-50%);z-index:4">' +
          '<div style="position:absolute;bottom:-20px;left:50%;transform:translateX(-50%);font-size:11.5px;font-weight:600;color:var(--ok);white-space:nowrap;background:var(--color-canvas-white);padding:1px 6px;border-radius:4px;border:1px solid var(--ok-border);box-shadow:var(--shadow-xs);font-feature-settings:\'tnum\' 1">Фаровон: ' + ourMid.toLocaleString('ru-RU') + '</div>' +
        '</div>'
      : '') +
    '</div>' +
    '<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--color-fog);margin-top:16px;border-top:1px dashed var(--color-ash);padding-top:6px;font-feature-settings:\'tnum\' 1">' +
      '<span>От: ' + Math.round(minVal / 0.85).toLocaleString('ru-RU') + '</span>' +
      (p25 ? '<span>P25: <b>' + p25.toLocaleString('ru-RU') + '</b></span>' : '') +
      (p75 ? '<span>P75: <b>' + p75.toLocaleString('ru-RU') + '</b></span>' : '') +
      '<span>До: ' + Math.round(maxVal / 1.15).toLocaleString('ru-RU') + ' сом.</span>' +
    '</div>' +
  '</div>';
}

function exportBmMatrixCsv(){
  toast('Формирование сводной матрицы бенчмаркинга…');
  fetch('/api/benchmarks/export', {
    headers: { 'Authorization': 'Bearer ' + S.token }
  }).then(function(res){
    if(!res.ok) throw new Error('Ошибка сервера: ' + res.status);
    return res.blob();
  }).then(function(blob){
    var url = window.URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'farovon_market_benchmarking_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('Матрица бенчмаркинга успешно выгружена!');
  }).catch(function(err){
    toast('Ошибка экспорта: ' + err.message, 'err');
  });
}

function renderBmCompare(){
  var c = $('bmContent');
  if(!c) return;

  var positions = S.data.dictPositions || [];
  var selId = BM_STATE.selectedPosId;

  var buildItemsHtml = function(filterText){
    var ft = String(filterText || '').toLowerCase().trim();
    var filtered = positions.filter(function(p){
      return !ft || p.name.toLowerCase().indexOf(ft) !== -1;
    });

    if(!filtered.length){
      return '<div style="padding:20px;text-align:center;font-size:13.5px;color:var(--color-fog)">Должностей не найдено</div>';
    }

    return filtered.map(function(p){
      var isSel = (selId && (p.id == selId || String(p.id) === String(selId))) || (!selId && p.name === BM_STATE.selectedPosName);
      var activeClass = isSel ? ' on' : '';
      return '<button class="rail-item' + activeClass + '" data-posid="' + (p.id || '') + '" data-posname="' + esc(p.name) + '" style="text-align:left;padding:7px 10px;font-size:14px">' +
        '<span>' + esc(p.name) + '</span>' +
      '</button>';
    }).join('');
  };

  c.innerHTML = '<div class="bm-compare-grid">' +
    '<div class="card bm-compare-list" style="padding:14px;display:flex;flex-direction:column;max-height:calc(100vh - 170px)">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
        '<span style="font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--color-fog)">Должности</span>' +
        '<span style="font-size:12px;color:var(--color-fog)">' + positions.length + ' поз.</span>' +
      '</div>' +
      '<div style="position:relative;margin-bottom:8px">' +
        '<input type="text" id="bmPosSearch" placeholder="Поиск должности…" style="font-size:13.5px;padding:6px 10px 6px 30px;width:100%;height:32px">' +
        '<span style="position:absolute;left:8px;top:7px;color:var(--color-fog);pointer-events:none">' + icBare('search', 14) + '</span>' +
      '</div>' +
      '<div id="bmPosList" class="co-list-scroll" style="flex:1;min-height:260px;max-height:calc(100vh - 350px);overflow-y:auto;display:flex;flex-direction:column;gap:1px">' +
        buildItemsHtml() +
      '</div>' +
      '<div id="bmPosMeta" style="margin-top:10px;font-size:13px;color:var(--color-charcoal);line-height:1.45;background:var(--color-paper-mist);border:1px solid var(--color-ash);padding:8px 10px;border-radius:var(--radius-buttons);font-feature-settings:\'tnum\' 1">Загрузка данных…</div>' +
    '</div>' +
    '<div id="bmCompareDetail" style="min-width:0">Загрузка сравнения…</div>' +
  '</div>';

  $('bmPosSearch').oninput = function(){
    $('bmPosList').innerHTML = buildItemsHtml(this.value);
  };

  $('bmPosList').onclick = function(e){
    var btn = e.target.closest('button[data-posid]');
    if(!btn) return;
    BM_STATE.selectedPosId = btn.dataset.posid;
    BM_STATE.selectedPosName = btn.dataset.posname;
    $('bmPosList').querySelectorAll('.rail-item').forEach(function(b){ b.classList.remove('on'); });
    btn.classList.add('on');
    loadBmCompareDetail();
    // На узком экране список и деталь стоят друг под другом — подскроллим к
    // сравнению, иначе после выбора кажется, что «ничего не произошло».
    if(window.innerWidth <= 900){
      var det = $('bmCompareDetail');
      if(det) setTimeout(function(){ det.scrollIntoView({ behavior:'smooth', block:'start' }); }, 80);
    }
  };

  loadBmCompareDetail();
}

function loadBmCompareDetail(){
  var d = $('bmCompareDetail');
  var m = $('bmPosMeta');
  if(!d) return;

  var posId = BM_STATE.selectedPosId || '';
  var posName = BM_STATE.selectedPosName || '';

  if(!posId && !posName) return;

  d.innerHTML = '<div style="padding:40px;text-align:center;color:var(--color-fog)" class="sp"><i></i> Загрузка сравнения…</div>';

  call('apiBenchmarkCompare', S.token, posId, posName).then(function(res){
    if(!res || !res.ok || !res.result){
      d.innerHTML = '<div class="err">' + ((res && res.error) || 'Ошибка загрузки данных сравнения') + '</div>';
      return;
    }
    var r = res.result;
    var pos = r.position || {};
    var ourPayFrom = pos.ourPayFrom || 0;
    var ourPayTo = pos.ourPayTo || 0;
    var ourMid = pos.ourMid || 0;
    var comp = r.summary || {};

    var shownName = esc((pos.name || posName || '').trim() || 'должность не выбрана');
    if(m){
      m.innerHTML = '<div style="font-weight:700;color:var(--color-midnight-ink);margin-bottom:3px">' + shownName + '</div>' +
        '<b>Оклад Фаровон:</b> ' + (ourPayFrom ? ourPayFrom.toLocaleString('ru-RU') : '—') +
        ' – ' + (ourPayTo ? ourPayTo.toLocaleString('ru-RU') : '—') + ' сомони<br>' +
        '<b>Медиана Фаровон:</b> ' + (ourMid ? ourMid.toLocaleString('ru-RU') + ' сом.' : '<span style="color:var(--color-fog)">не задана</span>');
    }

    var compBadge = '';
    if(comp.compositeGapPercent != null){
      var isPositive = comp.compositeGapPercent >= 0;
      var sign = isPositive ? '+' : '';
      var pillClass = isPositive ? 'top-period-pill' : 'top-period-pill is-closed';
      compBadge = '<span class="' + pillClass + '" style="font-size:14px;padding:5px 12px;font-weight:600;font-feature-settings:\'tnum\' 1">' +
        '<span class="top-period-dot"></span> ' + sign + comp.compositeGapPercent + '% к рынку (' + (comp.compositeGapAmount > 0 ? '+' : '') + (comp.compositeGapAmount ? comp.compositeGapAmount.toLocaleString('ru-RU') : '0') + ' сом.)</span>';
    }

    var sourcesHtml = '';

    // Внутренний сбор
    var intr = r.internal || {};
    var intrStats = intr.stats || {};
    var intrRangeBar = renderSalaryRangeBar(intrStats, ourPayFrom, ourPayTo, ourMid);

    sourcesHtml += '<div class="card" style="padding:16px 20px;margin-bottom:12px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          renderSourceBadge('internal') +
          '<div>' +
            '<b style="font-size:15px;color:var(--color-midnight-ink)">' + esc(intr.sourceTitle) + '</b>' +
            '<span style="font-size:13px;color:var(--color-fog);margin-left:6px">Внутренние анкеты (' + (intr.observationsCount || 0) + ' набл.)</span>' +
          '</div>' +
        '</div>' +
        (intrStats.p50 ? '<b style="font-size:16px;color:var(--accent);font-feature-settings:\'tnum\' 1">' + intrStats.p50.toLocaleString('ru-RU') + ' сом. <span style="font-size:12.5px;color:var(--color-fog);font-weight:normal">(P50)</span></b>' : '<span style="color:var(--color-fog);font-size:13px">нет данных</span>') +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(5, minmax(0, 1fr));gap:6px;font-size:13px;background:var(--color-paper-mist);border:1px solid var(--color-ash);padding:8px 12px;border-radius:var(--radius-buttons);text-align:center;font-feature-settings:\'tnum\' 1">' +
        '<div><span style="color:var(--color-fog)">P10:</span><br><b style="white-space:nowrap">' + (intrStats.min ? intrStats.min.toLocaleString('ru-RU') : '—') + '</b></div>' +
        '<div><span style="color:var(--color-fog)">P25:</span><br><b style="white-space:nowrap">' + (intrStats.p25 ? intrStats.p25.toLocaleString('ru-RU') : '—') + '</b></div>' +
        '<div><span style="color:var(--color-fog)">P50:</span><br><b style="color:var(--accent);white-space:nowrap">' + (intrStats.p50 ? intrStats.p50.toLocaleString('ru-RU') : '—') + '</b></div>' +
        '<div><span style="color:var(--color-fog)">P75:</span><br><b style="white-space:nowrap">' + (intrStats.p75 ? intrStats.p75.toLocaleString('ru-RU') : '—') + '</b></div>' +
        '<div><span style="color:var(--color-fog)">P90:</span><br><b style="white-space:nowrap">' + (intrStats.max ? intrStats.max.toLocaleString('ru-RU') : '—') + '</b></div>' +
      '</div>' +
      intrRangeBar +
    '</div>';

    // Совокупный доход (оклад + переменная часть, приведённая к месяцу).
    // Считается по всем записям с окладом: где премию посчитать нельзя —
    // берётся только оклад (запись не выпадает).
    var totStats = intr.totalStats || {};
    var totSample = intr.totalSampleCount || 0;
    var totBon = intr.totalBonusCount || 0;
    var totCov = totSample ? totBon / totSample : 0;
    // Карточку показываем, только если есть хотя бы одна распознанная премия —
    // иначе «Совокупный доход» = «Внутренний сбор», дублирование.
    if(totStats.p50 && totBon > 0){
      var totP10 = totStats.p10 || totStats.min || 0;
      var totP90 = totStats.p90 || totStats.max || 0;
      // «+N%» к окладу — только когда премия посчитана у большинства (≥50%);
      // ниже порога один-два бонуса рядом с медианой дают ложный «прирост».
      var totUplift = (totCov >= 0.5 && intrStats.p50 && totStats.p50 > intrStats.p50)
        ? Math.round(((totStats.p50 - intrStats.p50) / intrStats.p50) * 100) : 0;
      sourcesHtml += '<div class="card" style="padding:16px 20px;margin-bottom:12px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<div style="width:30px;height:30px;border-radius:var(--radius-buttons);background:var(--accent-soft);color:var(--ok);display:flex;align-items:center;justify-content:center;flex:none">' + ic('wallet', 15) + '</div>' +
            '<div>' +
              '<b style="font-size:15px;color:var(--color-midnight-ink)">Совокупный доход</b>' +
              '<span style="font-size:13px;color:var(--color-fog);margin-left:6px">оклад + переменная часть / мес.</span>' +
            '</div>' +
          '</div>' +
          '<b style="font-size:16px;color:var(--ok);font-feature-settings:\'tnum\' 1">' + totStats.p50.toLocaleString('ru-RU') + ' сом. <span style="font-size:12.5px;color:var(--color-fog);font-weight:normal">(P50)</span></b>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(5, minmax(0, 1fr));gap:6px;font-size:13px;background:var(--color-paper-mist);border:1px solid var(--color-ash);padding:8px 12px;border-radius:var(--radius-buttons);text-align:center;font-feature-settings:\'tnum\' 1">' +
          '<div><span style="color:var(--color-fog)">P10:</span><br><b style="white-space:nowrap">' + (totP10 ? totP10.toLocaleString('ru-RU') : '—') + '</b></div>' +
          '<div><span style="color:var(--color-fog)">P25:</span><br><b style="white-space:nowrap">' + (totStats.p25 ? totStats.p25.toLocaleString('ru-RU') : '—') + '</b></div>' +
          '<div><span style="color:var(--color-fog)">P50:</span><br><b style="color:var(--ok);white-space:nowrap">' + totStats.p50.toLocaleString('ru-RU') + '</b></div>' +
          '<div><span style="color:var(--color-fog)">P75:</span><br><b style="white-space:nowrap">' + (totStats.p75 ? totStats.p75.toLocaleString('ru-RU') : '—') + '</b></div>' +
          '<div><span style="color:var(--color-fog)">P90:</span><br><b style="white-space:nowrap">' + (totP90 ? totP90.toLocaleString('ru-RU') : '—') + '</b></div>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--color-fog);margin-top:8px;line-height:1.5">' +
          'По ' + totSample + ' ' + declOfNum(totSample, ['записи','записям','записям']) + ' с окладом. ' +
          'Премия с суммой учтена у <b>' + totBon + '</b> из ' + totSample + '; у остальных — только оклад' +
          (totUplift > 0 ? '. Медиана выше оклада на <b>+' + totUplift + '%</b>' : '') +
        '</div>' +
      '</div>';
    }

    // Внешние источники
    (r.external || []).forEach(function(ext){
      var extStats = ext.stats || {};
      var gapHtml = '';
      if(ext.gapPercent != null){
        var isPos = ext.gapPercent >= 0;
        var col = isPos ? 'var(--ok)' : 'var(--no)';
        gapHtml = '<span style="font-size:13.5px;font-weight:600;color:' + col + ';font-feature-settings:\'tnum\' 1">' + (isPos ? '+' : '') + ext.gapPercent + '% (' + (ext.gapAmount > 0 ? '+' : '') + ext.gapAmount.toLocaleString('ru-RU') + ' сом.)</span>';
      }

      var extRangeBar = ext.hasData ? renderSalaryRangeBar(extStats, ourPayFrom, ourPayTo, ourMid) : '';

      sourcesHtml += '<div class="card" style="padding:16px 20px;margin-bottom:12px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            renderSourceBadge(ext.sourceKey, ext.isLicensed, ext.sourceTitle) +
            '<div>' +
              '<b style="font-size:15px;color:var(--color-midnight-ink)">' + esc(ext.sourceTitle) + '</b>' +
              '<span style="font-size:13px;color:var(--color-fog);margin-left:6px">' + (ext.sourcePosition ? '«' + esc(ext.sourcePosition) + '»' : 'Не сопоставлено') + (ext.dataAsOf ? ' · ' + esc(ext.dataAsOf) : '') + '</span>' +
            '</div>' +
          '</div>' +
          '<div style="text-align:right">' +
            (extStats.p50 ? '<b style="font-size:16px;color:var(--accent);font-feature-settings:\'tnum\' 1">' + extStats.p50.toLocaleString('ru-RU') + ' сом. <span style="font-size:12.5px;color:var(--color-fog);font-weight:normal">(P50)</span></b>' : '<span style="color:var(--color-fog);font-size:13px">нет данных</span>') +
            (gapHtml ? '<br>' + gapHtml : '') +
          '</div>' +
        '</div>' +
        (ext.hasData ?
          '<div style="display:grid;grid-template-columns:repeat(5, minmax(0, 1fr));gap:6px;font-size:13px;background:var(--color-paper-mist);border:1px solid var(--color-ash);padding:8px 12px;border-radius:var(--radius-buttons);text-align:center;font-feature-settings:\'tnum\' 1">' +
            '<div><span style="color:var(--color-fog)">P10:</span><br><b style="white-space:nowrap">' + (extStats.min ? extStats.min.toLocaleString('ru-RU') : '—') + '</b></div>' +
            '<div><span style="color:var(--color-fog)">P25:</span><br><b style="white-space:nowrap">' + (extStats.p25 ? extStats.p25.toLocaleString('ru-RU') : '—') + '</b></div>' +
            '<div><span style="color:var(--color-fog)">P50:</span><br><b style="color:var(--accent);white-space:nowrap">' + (extStats.p50 ? extStats.p50.toLocaleString('ru-RU') : '—') + '</b></div>' +
            '<div><span style="color:var(--color-fog)">P75:</span><br><b style="white-space:nowrap">' + (extStats.p75 ? extStats.p75.toLocaleString('ru-RU') : '—') + '</b></div>' +
            '<div><span style="color:var(--color-fog)">P90:</span><br><b style="white-space:nowrap">' + (extStats.max ? extStats.max.toLocaleString('ru-RU') : '—') + '</b></div>' +
          '</div>' +
          extRangeBar
        :
          '<div style="padding:12px;text-align:center;font-size:13.5px;color:var(--color-fog);background:var(--color-paper-mist);border-radius:var(--radius-buttons);border:1px solid var(--color-ash)">' +
            'Нет сопоставленных данных для этой должности. ' +
            '<button class="btn-ghost" style="padding:2px 8px;font-size:13.5px;color:var(--accent);font-weight:600" onclick="switchBmTab(\'mapping\')">Настроить сопоставление →</button>' +
          '</div>'
        ) +
      '</div>';
    });

    // Сводный Range Bar по композитной медиане рынка
    var compStats = { p50: comp.compositeMedian };
    var compositeRangeBar = renderSalaryRangeBar(compStats, ourPayFrom, ourPayTo, ourMid);

    d.innerHTML = '<div class="bm-detail-head">' +
        '<span class="bm-detail-head-lbl">Сравнение по должности</span>' +
        '<b>' + shownName + '</b>' +
      '</div>' +
      '<div class="card" style="padding:16px 20px;margin-bottom:12px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">' +
          '<div style="display:flex;align-items:center;gap:12px">' +
            '<div style="width:36px;height:36px;border-radius:var(--radius-buttons);background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center;flex:none">' +
              '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">' + ICONS.chart + '</svg>' +
            '</div>' +
            '<div>' +
              '<div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--color-fog)">Сводная рыночная медиана (' + comp.sourcesCount + ' ' + declOfNum(comp.sourcesCount, ['источник', 'источника', 'источников']) + ')</div>' +
              '<div style="font-size:22px;font-weight:700;color:var(--color-midnight-ink);letter-spacing:-0.02em;margin-top:1px;font-feature-settings:\'tnum\' 1">' +
                (comp.compositeMedian ? comp.compositeMedian.toLocaleString('ru-RU') + ' сомони' : '—') +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div>' + compBadge + '</div>' +
        '</div>' +
        compositeRangeBar +
      '</div>' +
      sourcesHtml;
  }).catch(function(err){
    d.innerHTML = '<div class="err">Ошибка: ' + (err.message || err) + '</div>';
  });
}

function renderBmMapping(){
  var c = $('bmContent');
  if(!c) return;

  var srcOpts = (BM_STATE.sources || []).filter(function(s){ return s.key !== 'internal'; }).map(function(s){
    return '<option value="' + s.key + '" ' + (s.key === BM_STATE.selectedSourceKey ? 'selected' : '') + '>' + esc(s.title) + '</option>';
  }).join('');

  c.innerHTML = '<div class="toolbar" style="margin-bottom:12px;justify-content:space-between;gap:8px;flex-wrap:wrap">' +
    '<div style="display:flex;align-items:center;gap:8px">' +
      '<label class="lbl" style="margin:0">Источник данных:</label>' +
      '<select id="bmMapSrcSelect" style="height:32px;padding:0 8px;font-size:13.5px;width:auto">' + srcOpts + '</select>' +
    '</div>' +
    '<div style="display:flex;gap:8px">' +
      '<button class="btn-primary" id="btnBmSuggest" style="min-height:32px;padding:0 12px;font-size:13.5px;width:auto">' +
        ic('bolt', 14) + 'Автоподбор похожих должностей' +
      '</button>' +
    '</div>' +
  '</div>' +
  '<div id="bmMapTable">Загрузка сопоставлений…</div>';

  $('bmMapSrcSelect').onchange = function(){
    BM_STATE.selectedSourceKey = this.value;
    loadBmMappingsList();
  };

  $('btnBmSuggest').onclick = openBmSuggestModal;

  loadBmMappingsList();
}

function loadBmMappingsList(){
  var tbl = $('bmMapTable');
  if(!tbl) return;

  tbl.innerHTML = '<div style="padding:30px;text-align:center;color:var(--color-fog)" class="sp"><i></i> Загрузка сопоставлений…</div>';

  call('apiBenchmarkMappings', S.token, BM_STATE.selectedSourceKey).then(function(res){
    var mappings = (res && res.mappings) || [];
    if(mappings.length === 0){
      tbl.innerHTML = '<div class="card" style="padding:30px;text-align:center;color:var(--color-fog)">' +
        'Сопоставлений для этого источника пока нет. Нажмите <b>«Автоподбор похожих должностей»</b> или загрузите новый датасет.' +
      '</div>';
      return;
    }

    var rows = mappings.map(function(m){
      var confLabel = m.confidence === 'exact' ? '<span class="top-period-pill"><span class="top-period-dot"></span> Точное</span>' : (m.confidence === 'close' ? '<span class="top-period-pill" style="color:var(--warn);border-color:var(--warn-border)"><span class="top-period-dot" style="background:var(--warn)"></span> Близкое</span>' : '<span class="top-period-pill is-closed"><span class="top-period-dot"></span> Примерное</span>');
      return '<tr>' +
        '<td style="padding:8px 12px;border-bottom:1px solid var(--color-ash);font-weight:550">' + esc(m.dict_position_name) + '</td>' +
        '<td style="padding:8px 12px;border-bottom:1px solid var(--color-ash)">' + esc(m.source_label) + (m.source_code ? ' <span style="font-size:12px;color:var(--color-fog)">(' + esc(m.source_code) + ')</span>' : '') + '</td>' +
        '<td style="padding:8px 12px;border-bottom:1px solid var(--color-ash)">' + confLabel + '</td>' +
        '<td style="padding:8px 12px;border-bottom:1px solid var(--color-ash);text-align:right">' +
          '<button class="btn-ghost" style="color:var(--no);padding:2px 6px;font-size:13px" onclick="deleteBmMapping(' + m.id + ')">' + ic('trash', 12) + 'Удалить</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    tbl.innerHTML = '<div class="card" style="padding:0;overflow:hidden">' +
      '<table style="width:100%;border-collapse:collapse;text-align:left;font-size:14px">' +
        '<thead>' +
          '<tr style="background:var(--color-paper-mist);border-bottom:1px solid var(--color-ash);font-size:12.5px;color:var(--color-fog);text-transform:uppercase;letter-spacing:0.04em">' +
            '<th style="padding:8px 12px">Должность Фаровон</th>' +
            '<th style="padding:8px 12px">Должность источника</th>' +
            '<th style="padding:8px 12px">Точность</th>' +
            '<th style="padding:8px 12px;text-align:right">Действие</th>' +
          '</tr>' +
        '</thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';
  });
}

function deleteBmMapping(id){
  ask({ title:'Удалить сопоставление?', html:'Связь между должностями будет удалена.', ok:'Удалить', danger:true }).then(function(yes){
    if(!yes) return;
    call('apiBenchmarkDeleteMapping', S.token, id).then(function(res){
      if(res && res.ok){
        toast('Сопоставление удалено');
        loadBmMappingsList();
      } else {
        toast((res && res.error) || 'Ошибка удаления');
      }
    });
  });
}

function openBmSuggestModal(){
  var srcKey = BM_STATE.selectedSourceKey;
  call('apiBenchmarkSuggestMappings', S.token, srcKey).then(function(res){
    var list = (res && res.suggestions) || [];
    if(list.length === 0){
      alertModal('Нет предложений', 'Все должности источника уже сопоставлены либо подходящих совпадений не найдено.');
      return;
    }

    var el = document.createElement('div');
    el.className = 'sheet';

    var itemsHtml = list.map(function(item, idx){
      return '<div class="bmap-row">' +
        '<div class="bmap-row-info">' +
          '<b>' + esc(item.sourcePosition.label) + '</b> <span class="bmap-src">(Источник)</span><br>' +
          '<span class="bmap-target">' + ic('chevron', 11) + esc(item.suggestedDictPosition.name) + '</span>' +
        '</div>' +
        '<div class="bmap-row-act">' +
          '<span class="bmap-sim">' + item.similarity + '%</span>' +
          '<button class="btn-line bmap-link-btn" data-bmapply="' + idx + '">Связать</button>' +
        '</div>' +
      '</div>';
    }).join('');

    el.innerHTML = '<div class="sheet-in bmap-modal">' +
      '<div class="sheet-hd"><b>Предложения по сопоставлению должностей</b><button class="btn-ghost" data-x="1">Закрыть</button></div>' +
      '<div class="bmap-list">' + itemsHtml + '</div>' +
    '</div>';

    document.body.appendChild(el);
    el.onclick = function(e){
      if(e.target.dataset.x || e.target === el){ el.remove(); return; }
      var btn = e.target.closest('button[data-bmapply]');
      if(btn){
        var item = list[parseInt(btn.dataset.bmapply)];
        btn.disabled = true; btn.textContent = 'Сохраняем…';
        call('apiBenchmarkSaveMapping', S.token, {
          dictPositionId: item.suggestedDictPosition.id,
          sourcePositionId: item.sourcePosition.id,
          confidence: item.confidence,
          note: 'Автоподбор (' + item.similarity + '%)'
        }).then(function(res){
          if(res && res.ok){
            toast('Связано: ' + item.sourcePosition.label + ' ↔ ' + item.suggestedDictPosition.name);
            btn.parentElement.innerHTML = '<span class="bmap-done">' + ic('check', 12) + 'Связано</span>';
            loadBmMappingsList();
          } else {
            toast((res && res.error) || 'Ошибка');
            btn.disabled = false; btn.textContent = 'Связать';
          }
        });
      }
    };
  });
}

function renderBmDatasets(){
  var c = $('bmContent');
  if(!c) return;

  c.innerHTML = '<div class="toolbar" style="margin-bottom:12px;justify-content:space-between;gap:8px;flex-wrap:wrap">' +
    '<div><span style="font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--color-fog)">Загруженные датасеты и внешние источники</span></div>' +
    '<div style="display:flex;gap:8px">' +
      '<button class="btn-line" id="btnBmAddSource" style="min-height:32px;padding:0 12px;font-size:13.5px;width:auto">' + ic('plus', 14) + 'Новый источник</button>' +
      '<button class="btn-primary" id="btnBmUpload" style="min-height:32px;padding:0 12px;font-size:13.5px;width:auto">' + ic('archive', 14) + 'Загрузить датасет</button>' +
    '</div>' +
  '</div>' +
  '<div id="bmDatasetsList">Загрузка датасетов…</div>';

  $('btnBmUpload').onclick = openBmImportModal;
  $('btnBmAddSource').onclick = openBmAddSourceModal;

  call('apiBenchmarkDatasets', S.token).then(function(res){
    var list = (res && res.datasets) || [];
    var el = $('bmDatasetsList');
    if(!el) return;

    if(list.length === 0){
      el.innerHTML = '<div class="card" style="padding:30px;text-align:center;color:var(--color-fog)">' +
        'Пока нет загруженных датасетов. Нажмите <b>«Загрузить датасет»</b>, чтобы загрузить данные B1, Antal, Korn Ferry, PwC, Mercer или локальных джоб-бордов.' +
      '</div>';
      return;
    }

    var cards = list.map(function(d){
      return '<div class="card" style="padding:14px 18px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between">' +
        '<div style="display:flex;align-items:center;gap:12px">' +
          renderSourceBadge(d.source_key, d.is_licensed) +
          '<div>' +
            '<b style="font-size:15.5px;color:var(--color-midnight-ink)">' + esc(d.title) + '</b><br>' +
            '<span style="font-size:13px;color:var(--color-fog)">Источник: ' + esc(d.source_title) + ' · Отчёт: ' + esc(d.report_date || '—') + ' · Строк: ' + d.row_count + ' · Загрузил: ' + esc(d.uploaded_by || '—') + '</span>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<span class="top-period-pill"><span class="top-period-dot"></span> Активен</span>' +
          '<button class="btn-ghost" data-bmdeletedataset="' + d.id + '" style="color:var(--no);font-size:13px;padding:4px 8px">' + ic('trash', 12) + 'Удалить</button>' +
        '</div>' +
      '</div>';
    }).join('');

    el.innerHTML = cards;

    el.onclick = function(e){
      var btn = e.target.closest('button[data-bmdeletedataset]');
      if(btn){
        var dsId = btn.dataset.bmdeletedataset;
        ask({ title:'Удалить датасет?', html:'Все строки и расчеты данного датасета будут удалены.', ok:'Удалить', danger:true }).then(function(yes){
          if(!yes) return;
          call('apiBenchmarkDeleteDataset', S.token, dsId).then(function(resp){
            if(resp && resp.ok){
              toast('Датасет успешно удален');
              renderBmDatasets();
            } else {
              toast((resp && resp.error) || 'Ошибка удаления');
            }
          });
        });
      }
    };
  });
}

function openBmAddSourceModal(){
  var el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = '<div class="sheet-in" style="max-width:560px">' +
    '<div class="sheet-hd"><b>Добавить новый источник данных рынка</b><button class="btn-ghost" data-x="1">Закрыть</button></div>' +
    '<div id="bmsErr" class="err hidden" style="margin-top:8px"></div>' +
    '<div style="display:grid;grid-template-columns:1fr;gap:10px;margin-top:12px">' +
      '<div>' +
        '<label class="lbl">Название источника</label>' +
        '<input id="bmsTitle" placeholder="Например: KPMG Salary Benchmark 2026">' +
      '</div>' +
      '<div>' +
        '<label class="lbl">Уникальный код источника (латиницей)</label>' +
        '<input id="bmsKey" placeholder="Например: kpmg">' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<div>' +
          '<label class="lbl">Тип источника</label>' +
          '<select id="bmsKind">' +
            '<option value="consultancy">Консалтинговое агентство</option>' +
            '<option value="jobsite">Джоб-борд / Вакансии</option>' +
            '<option value="official">Официальная статистика</option>' +
            '<option value="direct">Прямой опрос / Партнеры</option>' +
          '</select>' +
        '</div>' +
        '<div>' +
          '<label class="lbl">Валюта по умолчанию</label>' +
          '<select id="bmsCurr">' +
            '<option value="сомони">TJS (сомони)</option>' +
            '<option value="USD">USD ($)</option>' +
            '<option value="RUB">RUB (₽)</option>' +
            '<option value="EUR">EUR (€)</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin:6px 0">' +
        '<input type="checkbox" id="bmsLic" style="width:auto;height:auto;cursor:pointer">' +
        '<label for="bmsLic" style="margin:0;cursor:pointer;font-size:14px">Лицензионный платный обзор (требует бейдж лицензии)</label>' +
      '</div>' +
      '<div>' +
        '<label class="lbl">Примечание / Методология</label>' +
        '<textarea id="bmsNotes" placeholder="Описание выборки, охват отраслей или контакты провайдера…" style="height:60px"></textarea>' +
      '</div>' +
    '</div>' +
    '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">' +
      '<button class="btn-ghost" data-x="1">Отмена</button>' +
      '<button class="btn-primary" id="btnBmsSave">Сохранить источник</button>' +
    '</div>' +
  '</div>';

  document.body.appendChild(el);

  el.onclick = function(e){
    if(e.target.dataset.x || e.target === el){ el.remove(); return; }
  };

  el.querySelector('#bmsTitle').oninput = function(){
    var keyIn = el.querySelector('#bmsKey');
    if(!keyIn.value || keyIn.dataset.autofilled){
      keyIn.value = this.value.toLowerCase().trim().replace(/[^a-z0-9]/g, '_').slice(0, 25);
      keyIn.dataset.autofilled = '1';
    }
  };

  el.querySelector('#btnBmsSave').onclick = function(){
    var title = el.querySelector('#bmsTitle').value.trim();
    var key = el.querySelector('#bmsKey').value.trim();
    var kind = el.querySelector('#bmsKind').value;
    var defaultCurrency = el.querySelector('#bmsCurr').value;
    var isLicensed = el.querySelector('#bmsLic').checked;
    var notes = el.querySelector('#bmsNotes').value.trim();
    var errEl = el.querySelector('#bmsErr');

    if(!title || !key){
      errEl.textContent = 'Заполните название и код источника';
      errEl.classList.remove('hidden');
      return;
    }

    var btn = this;
    btn.disabled = true; btn.textContent = 'Сохранение…';

    call('apiBenchmarkCreateSource', S.token, {
      title: title,
      key: key,
      kind: kind,
      defaultCurrency: defaultCurrency,
      isLicensed: isLicensed,
      notes: notes
    }).then(function(res){
      if(res && res.ok){
        toast('Источник «' + title + '» успешно добавлен!');
        el.remove();
        loadBmInitialData();
      } else {
        errEl.textContent = (res && res.error) || 'Ошибка сохранения';
        errEl.classList.remove('hidden');
        btn.disabled = false; btn.textContent = 'Сохранить источник';
      }
    }).catch(function(err){
      errEl.textContent = err.message || 'Ошибка сети';
      errEl.classList.remove('hidden');
      btn.disabled = false; btn.textContent = 'Сохранить источник';
    });
  };
}

function openBmImportModal(){
  var el = document.createElement('div');
  el.className = 'sheet';

  var srcOptions = (BM_STATE.sources || []).filter(function(s){ return s.key !== 'internal'; }).map(function(s){
    return '<option value="' + s.key + '">' + esc(s.title) + '</option>';
  }).join('');

  el.innerHTML = '<div class="sheet-in bmi-modal">' +
    '<div class="sheet-hd"><b>Загрузка датасета обзора заработных плат</b><button class="btn-ghost" data-x="1">Закрыть</button></div>' +
    '<div id="bmImpErr" class="err hidden"></div>' +
    '<div class="bmi-grid">' +
      '<div>' +
        '<label class="lbl">Источник</label>' +
        '<select id="bmiSource">' + srcOptions + '</select>' +
      '</div>' +
      '<div>' +
        '<label class="lbl">Название датасета</label>' +
        '<input id="bmiTitle" placeholder="B1 Salary Survey 2026">' +
      '</div>' +
      '<div>' +
        '<label class="lbl">Режим данных</label>' +
        '<select id="bmiMode">' +
          '<option value="percentiles">Готовые перцентили (P25/P50/P75)</option>' +
          '<option value="raw_vacancies">Сырые вакансии/точки данных</option>' +
        '</select>' +
      '</div>' +
      '<div>' +
        '<label class="lbl">Дата актуальности данных</label>' +
        '<input type="date" id="bmiDataAsOf" value="' + new Date().toISOString().slice(0, 10) + '">' +
      '</div>' +
    '</div>' +
    '<label class="lbl bmi-lbl">Вставьте данные (таблица CSV / TSV из Excel или PDF):</label>' +
    '<textarea id="bmiText" class="bmi-text" rows="6" placeholder="Должность,P25,P50,P75\nГлавный бухгалтер,8000,12000,16000"></textarea>' +
    '<div id="bmiPreview" class="bmi-preview-slot"></div>' +
    '<div class="bmi-acts">' +
      '<button class="btn-ghost" data-x="1">Отмена</button>' +
      '<button class="btn-line" id="btnBmiDryRun">' + ic('search', 14) + 'Проверить без записи</button>' +
      '<button class="btn-primary" id="btnBmiCommit" disabled>Импортировать в базу</button>' +
    '</div>' +
  '</div>';

  document.body.appendChild(el);

  var dryRunReport = null;

  el.onclick = function(e){
    if(e.target.dataset.x || e.target === el){ el.remove(); return; }
  };

  $('btnBmiDryRun').onclick = function(){
    var text = $('bmiText').value.trim();
    if(!text){ toast('Вставьте текст таблицы'); return; }

    var mode = $('bmiMode').value;
    var colMap = mode === 'percentiles' ?
      { posLabel:0, p25:1, p50:2, p75:3, sampleN:4 } :
      { posLabel:0, value:1, region:2, company:3 };

    $('btnBmiDryRun').disabled = true; $('btnBmiDryRun').textContent = 'Проверка…';
    $('bmImpErr').classList.add('hidden');

    call('apiBenchmarkDryRun', S.token, {
      sourceKey: $('bmiSource').value,
      text: text,
      mode: mode,
      columnMap: colMap,
      title: $('bmiTitle').value.trim(),
      dataAsOf: $('bmiDataAsOf').value
    }).then(function(res){
      $('btnBmiDryRun').disabled = false; $('btnBmiDryRun').innerHTML = ic('search', 14) + 'Проверить без записи';
      if(!res || !res.ok){
        $('bmImpErr').textContent = (res && res.error) || 'Ошибка проверки';
        $('bmImpErr').classList.remove('hidden');
        return;
      }

      dryRunReport = res.report;
      $('btnBmiCommit').disabled = false;

      var prevHtml = '<div class="bmi-result">' +
        '<b>Результат проверки:</b> Найдено ' + dryRunReport.validRows + ' валидных строк. Новых должностей для источника: ' + dryRunReport.newPositionsCount + '<br>' +
        (dryRunReport.errors.length ? '<span class="bmi-result-err">Ошибок: ' + dryRunReport.errors.length + '</span>' : '<span class="bmi-result-ok">Ошибок нет</span>') +
      '</div>';
      $('bmiPreview').innerHTML = prevHtml;
    }).catch(function(err){
      $('btnBmiDryRun').disabled = false; $('btnBmiDryRun').innerHTML = ic('search', 14) + 'Проверить без записи';
      $('bmImpErr').textContent = err.message || 'Ошибка связи';
      $('bmImpErr').classList.remove('hidden');
    });
  };

  $('btnBmiCommit').onclick = function(){
    var text = $('bmiText').value.trim();
    var mode = $('bmiMode').value;
    var colMap = mode === 'percentiles' ?
      { posLabel:0, p25:1, p50:2, p75:3, sampleN:4 } :
      { posLabel:0, value:1, region:2, company:3 };

    $('btnBmiCommit').disabled = true; $('btnBmiCommit').textContent = 'Импортируем…';

    call('apiBenchmarkCommit', S.token, {
      sourceKey: $('bmiSource').value,
      text: text,
      mode: mode,
      columnMap: colMap,
      title: $('bmiTitle').value.trim(),
      dataAsOf: $('bmiDataAsOf').value
    }).then(function(res){
      if(res && res.ok){
        toast('Датасет успешно сохранен!');
        el.remove();
        renderBmDatasets();
      } else {
        $('bmImpErr').textContent = (res && res.error) || 'Ошибка сохранения';
        $('bmImpErr').classList.remove('hidden');
        $('btnBmiCommit').disabled = false; $('btnBmiCommit').textContent = 'Импортировать в базу';
      }
    }).catch(function(err){
      $('bmImpErr').textContent = err.message || 'Ошибка связи';
      $('bmImpErr').classList.remove('hidden');
      $('btnBmiCommit').disabled = false; $('btnBmiCommit').textContent = 'Импортировать в базу';
    });
  };
}
