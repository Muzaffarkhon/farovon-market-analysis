// ═══════════════════════════════════════════════════════════
// app-core.js — рантайм: состояние, хранилище, тема, анимации,
// ⌘K, API-клиент (API_ROUTES/call/fetchJson), диалоги, show(),
// подгонка таблиц, экран входа. Грузится ПЕРВЫМ (см. index.html).
// Прикладные экраны и их запуск — в app.js.
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// TELEGRAM MINI APP: подключение SDK было — инициализации не было
// ═══════════════════════════════════════════════════════════
// telegram-web-app.js подключён в <head>, но Telegram.WebApp.ready()/expand()
// нигде не вызывались. Без expand() Telegram держит мини-приложение в
// уменьшённом окне по умолчанию (шрифт/элементы кажутся крупными относительно
// доступного места), а без отключения вертикальных свайпов жест скролла
// внутри приложения перехватывается самим Telegram (сворачивает окно вместо
// прокрутки контента) — совпадает с «скролл не работает». В обычном браузере
// эффекта нет, поэтому баг был не виден при тестировании вне бота.
(function(){
  var tg = window.Telegram && window.Telegram.WebApp;
  if(!tg) return;
  // telegram-web-app.js подключён в <head> — заглушка window.Telegram.WebApp
  // существует В ЛЮБОМ браузере, не только внутри Telegram. Раньше по факту её
  // наличия ставился класс .tg (→ .compact), и веб-версия постоянно работала в
  // «телеграм-компакт» режиме. Признак реального клиента Telegram: непустой
  // initData, либо известная платформа (вне Telegram platform === 'unknown').
  var inTelegram = !!(tg.initData && tg.initData.length) ||
                   (tg.platform && tg.platform !== 'unknown');
  if(!inTelegram) return;
  tg.ready();
  if(tg.expand) tg.expand();
  if(tg.disableVerticalSwipes) tg.disableVerticalSwipes();
  // Внутри Telegram окно уже обычного мобильного браузера и рядом стоит шапка
  // клиента — интерфейс кажется крупным. Метка включает компактный режим ниже
  // независимо от ширины (десктопный Telegram шире 560px, но тесноты это не
  // отменяет). На узком экране компактный режим и так включит медиазапрос.
  document.documentElement.classList.add('tg');
})();

// #22 — реальный Telegram Mini App (страница во фрейме web.telegram.org).
// Там сессионная кука ненадёжна, поэтому токен там храним в localStorage и
// шлём заголовком. В обычном браузере (одно происхождение) сессию держит
// httpOnly-кука, и в localStorage токен не кладём.
var IN_TG = document.documentElement.classList.contains('tg');

/**
 * Компактный режим: узкий экран или окно Telegram. Класс на <html>, чтобы
 * одни и те же правила не пришлось дублировать в медиазапросе и в селекторе
 * для Telegram.
 */
(function(){
  function apply(){
    var narrow = window.innerWidth <= 560;
    document.documentElement.classList.toggle('compact',
      narrow || document.documentElement.classList.contains('tg'));
  }
  apply();
  window.addEventListener('resize', apply);
})();

// ─── Экранная клавиатура не должна перекрывать поля ────────────────────
// 1) --vvh = высота видимой области (visualViewport) в px. CSS кладёт по ней
//    max-height у sheet-ов, чтобы открытый лист не уходил под клавиатуру.
// 2) При фокусе на поле внутри листа/контента подкручиваем его в центр —
//    после того как клавиатура выехала (даём ~280 мс на анимацию).
// viewport-meta interactive-widget=resizes-content (index.html) заставляет
// саму раскладку сжиматься — этого хватает фиксированной нижней панели
// «Сохранить»; здесь добираем случаи, когда поле всё же осталось внизу.
(function(){
  var vv = window.visualViewport;
  var root = document.documentElement;
  var raf = 0;
  function syncVVH(){
    raf = 0;
    var h = vv ? vv.height : window.innerHeight;
    root.style.setProperty('--vvh', h + 'px');
  }
  function schedule(){ if(!raf) raf = requestAnimationFrame(syncVVH); }
  syncVVH();
  if(vv){
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
  } else {
    window.addEventListener('resize', schedule);
  }

  var FIELD = 'input, textarea, select, [contenteditable="true"]';
  document.addEventListener('focusin', function(e){
    var f = e.target;
    if(!f || !f.matches || !f.matches(FIELD)) return;
    if(f.type === 'checkbox' || f.type === 'radio' || f.type === 'hidden') return;
    if(!f.closest('.sheet-in, #body, .wrap')) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Ждём, пока клавиатура выедет и visualViewport ужмётся; действуем только
    // если она реально отъела заметную высоту (иначе каждый тап по полю
    // дёргал бы экран). Порог — 140 px разницы между окном и видимой областью.
    setTimeout(function(){
      var hidden = window.innerHeight - (vv ? vv.height : window.innerHeight);
      if(hidden < 140) return;
      var r = f.getBoundingClientRect();
      if(r.bottom <= (vv ? vv.height : window.innerHeight) - 12 && r.top >= 8) return; // и так видно
      try { f.scrollIntoView({ block:'center', behavior: reduce ? 'auto' : 'smooth' }); } catch(err){}
    }, 300);
  });
})();

// ═══════════════════════════════════════════════════════════
// СОСТОЯНИЕ
// ═══════════════════════════════════════════════════════════
var S = {
  token:null, data:null, unit:null, tab:'comp',
  appView:'units', // 'units' | 'dashboard' | 'admin'
  dashTab:'overview', // 'overview' | 'salaries' | 'registry' | 'progress' | 'benefits'
  adminTab:'users', // 'users' | 'divisions' | 'period' | 'tools'
  dashFilters:{ dir:'', hrbp:'', region:'', search:'', period:'' },
  dashData:null, adminUsers:null, adminDivs:null,
  rows:[], added:[],                 // конкуренты
  surveys:[], removed:[],            // данные по должностям
  note:'', dirty:false, saving:false, ro:false
};
var LS_TOKEN = 'фаровон_токен', LS_DRAFT = 'фаровон_черновик_', LS_OB = 'фаровон_подсказка', LS_NAV = 'фаровон_навигация';

/** Хранилище с запасным вариантом: в некоторых браузерах localStorage запрещён. */
var mem = {};
var store = {
  get: function(k){ try{ return localStorage.getItem(k); }catch(e){ return k in mem ? mem[k] : null; } },
  set: function(k,v){ try{ localStorage.setItem(k,v); }catch(e){ mem[k] = v; } },
  del: function(k){ try{ localStorage.removeItem(k); }catch(e){ delete mem[k]; } }
};

// ═══════════════════════════════════════════════════════════
// ТЕМА ОФОРМЛЕНИЯ (Фаза 1 редизайна)
// ═══════════════════════════════════════════════════════════
// Три состояния: 'system' (по ОС) → 'light' → 'dark' → 'system'.
// 'system' = атрибут data-theme снят, работает @media prefers-color-scheme.
// Ключ ASCII (в отличие от LS_TOKEN и др.) — новый стандарт для ключей.
var LS_THEME = 'farovon_theme';
var THEME_ORDER = ['system', 'light', 'dark'];
var THEME_LABEL = { system: 'как в системе', light: 'светлая', dark: 'тёмная' };
var THEME_ICON = {
  system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
};

function currentTheme(){
  var t = store.get(LS_THEME);
  return THEME_ORDER.indexOf(t) > -1 ? t : 'system';
}

function applyTheme(t){
  if(t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  ['btnTheme', 'btnThemeLogin'].forEach(function(id){
    var b = document.getElementById(id);
    if(!b) return;
    b.innerHTML = THEME_ICON[t];
    b.title = 'Тема: ' + THEME_LABEL[t] + ' — нажмите, чтобы сменить';
    b.setAttribute('aria-label', 'Тема оформления: ' + THEME_LABEL[t]);
  });
}

function cycleTheme(){
  var next = THEME_ORDER[(THEME_ORDER.indexOf(currentTheme()) + 1) % THEME_ORDER.length];
  if(next === 'system') store.del(LS_THEME);
  else store.set(LS_THEME, next);
  applyTheme(next);
}

(function initTheme(){
  applyTheme(currentTheme());
  ['btnTheme', 'btnThemeLogin'].forEach(function(id){
    var b = document.getElementById(id);
    if(b) b.addEventListener('click', cycleTheme);
  });
  // Когда тема = 'system', реагируем на смену темы ОС на лету.
  if(window.matchMedia){
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onOS = function(){ if(currentTheme() === 'system') applyTheme('system'); };
    if(mq.addEventListener) mq.addEventListener('change', onOS);
    else if(mq.addListener) mq.addListener(onOS);
  }
})();

// ═══════════════════════════════════════════════════════════
// АНИМАЦИИ (Фаза 3)
// ═══════════════════════════════════════════════════════════
// Один слой на всё приложение: экран #body перерисовывается целиком при
// каждой навигации — по этому событию проигрываем мягкое появление,
// «разгоняем» полосы прогресса от нуля и запускаем счётчики чисел
// (элементы с data-countup). Всё уважает prefers-reduced-motion.
(function fxLayer(){
  var body = document.getElementById('body');
  if(!body || !window.MutationObserver) return;
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if(window.matchMedia){
    var mqm = window.matchMedia('(prefers-reduced-motion: reduce)');
    var upd = function(){ reduce = mqm.matches; };
    if(mqm.addEventListener) mqm.addEventListener('change', upd);
    else if(mqm.addListener) mqm.addListener(upd);
  }

  var easeOut = function(t){ return 1 - Math.pow(1 - t, 3); };

  function fmtNum(n){ return Number(n || 0).toLocaleString('ru-RU'); }

  function countUp(el){
    var target = parseFloat(el.getAttribute('data-countup'));
    var suffix = el.getAttribute('data-countup-suffix') || '';
    if(!isFinite(target)){ return; }
    var final = fmtNum(target) + suffix;
    // Фон-вкладка / reduced-motion / нечего разгонять — сразу финальное.
    if(reduce || target <= 0 || (document.hidden)){ el.textContent = final; return; }
    var dur = 600, t0 = null, myTok = (el._cuTok = (el._cuTok || 0) + 1);
    el.textContent = '0' + suffix;
    function step(ts){
      if(el._cuTok !== myTok) return; // перерисовали — эта анимация неактуальна
      if(t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      el.textContent = fmtNum(Math.round(target * easeOut(p))) + suffix;
      if(p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
    // Страховка: если rAF не тикает (скрытая вкладка) — гарантируем финал.
    setTimeout(function(){ if(el._cuTok === myTok) el.textContent = final; }, dur + 120);
  }

  function growBars(){
    if(reduce) return;
    body.querySelectorAll('.fill-progress > i, .u-bar-track > i, .prog-bar-fill').forEach(function(bar){
      var w = bar.style.width;
      if(!w || w === '0%' || w === '0px') return;
      bar.style.width = '0%';
      var restore = function(){ bar.style.width = w; };
      requestAnimationFrame(function(){ requestAnimationFrame(restore); });
      setTimeout(restore, 80); // страховка на случай скрытой вкладки
    });
  }

  function run(){
    if(!reduce){
      body.classList.remove('fx-view');
      void body.offsetWidth; // сброс анимации, чтобы проиграть заново
      body.classList.add('fx-view');
      // Ступенчатое появление детей — только при полной перерисовке экрана,
      // не при фильтрации/смене вкладок внутри (там #body не меняется).
      body.querySelectorAll('.fx-stagger').forEach(function(g){
        g.classList.remove('fx-stagger-run');
        void g.offsetWidth;
        g.classList.add('fx-stagger-run');
      });
    }
    growBars();
    body.querySelectorAll('[data-countup]').forEach(countUp);
  }

  var pending;
  new MutationObserver(function(muts){
    for(var i = 0; i < muts.length; i++){
      if(muts[i].addedNodes && muts[i].addedNodes.length){
        clearTimeout(pending);
        pending = setTimeout(run, 0);
        return;
      }
    }
  }).observe(body, { childList: true });
})();

// ═══════════════════════════════════════════════════════════
// ПОИСК И ПЕРЕХОДЫ — Ctrl/⌘ + K (Фаза 4)
// ═══════════════════════════════════════════════════════════
// Одно окно, чтобы из любой точки прыгнуть в раздел, в своё подразделение
// или выполнить действие — без блужданий по меню.
(function cmdkModule(){
  var el = null, items = [], filtered = [], sel = 0;

  function nrm(s){ return String(s || '').toLowerCase().replace(/ё/g, 'е').trim(); }

  function score(hay, q){
    hay = nrm(hay);
    if(!q) return 1;
    var i = hay.indexOf(q);
    if(i < 0){
      var words = q.split(/\s+/).filter(Boolean);
      return words.length > 1 && words.every(function(w){ return hay.indexOf(w) >= 0; }) ? 0.4 : 0;
    }
    if(i === 0) return 3;
    if(/\s/.test(hay.charAt(i - 1))) return 2;
    return 1;
  }

  function buildItems(){
    var list = [];
    if(!(window.S && S.data)) return list;
    var m = navModel();
    m.primary.forEach(function(it){
      list.push({ group:'Разделы', label:it.label, icon:it.icon, run:function(){ navGo(it); } });
    });
    (m.admin || []).forEach(function(it){
      list.push({ group:'Администрирование', label:it.label, icon:it.icon, run:function(){ navGo(it); } });
    });
    (S.data.units || []).forEach(function(u){
      list.push({ group:'Мои подразделения', label:u.unit, sub:u.dir, icon:'units',
        run:(function(name){ return function(){ openUnit(name); }; })(u.unit) });
    });
    list.push({ group:'Действия', label:'Переключить тему оформления', icon:'dashboard', run:cycleTheme });
    list.push({ group:'Действия', label:'Обновить данные', icon:'refresh', run:doRefresh });
    list.push({ group:'Действия', label:'Как заполнять', icon:'help', run:openHelp });
    list.push({ group:'Действия', label:'Пройти обучение по интерфейсу', icon:'target', run:function(){ startTour(); } });
    list.push({ group:'Действия', label:'Профиль', icon:'profile', run:openProfile });
    list.push({ group:'Действия', label:'Выйти из системы', icon:'logout', danger:true, run:doLogout });
    return list;
  }

  function render(q){
    var nq = nrm(q);
    filtered = items.map(function(it){
      var s = Math.max(score(it.label, nq), it.sub ? score(it.sub, nq) * 0.8 : 0, score(it.group, nq) * 0.5);
      return { it:it, s:s };
    }).filter(function(x){ return x.s > 0; })
      .sort(function(a, b){ return b.s - a.s; })
      .map(function(x){ return x.it; }).slice(0, 40);

    if(sel >= filtered.length) sel = Math.max(0, filtered.length - 1);
    var listEl = el.querySelector('.cmdk-list');
    if(!filtered.length){
      listEl.innerHTML = '<div class="cmdk-empty">Ничего не найдено</div>';
      return;
    }
    var lastGroup = null, h = '';
    filtered.forEach(function(it, i){
      if(it.group !== lastGroup){ h += '<div class="cmdk-group">' + esc(it.group) + '</div>'; lastGroup = it.group; }
      h += '<button class="cmdk-item' + (i === sel ? ' on' : '') + (it.danger ? ' is-danger' : '') + '" data-i="' + i + '">'+
        '<span class="cmdk-item-ic">' + ic(it.icon || 'chevron', 15) + '</span>'+
        '<span class="cmdk-item-t">' + esc(it.label) + (it.sub ? ' <span class="cmdk-item-sub">' + esc(it.sub) + '</span>' : '') + '</span>'+
      '</button>';
    });
    listEl.innerHTML = h;
    var on = listEl.querySelector('.cmdk-item.on');
    if(on) on.scrollIntoView({ block:'nearest' });
  }

  function close(){
    if(!el) return;
    el.remove(); el = null;
  }

  function exec(i){
    var it = filtered[i];
    if(!it) return;
    close();
    setTimeout(it.run, 0);
  }

  function onKey(e){
    if(!el) return;
    if(e.key === 'Escape'){ e.preventDefault(); close(); return; }
    var inp = el.querySelector('.cmdk-input');
    if(e.key === 'ArrowDown'){ e.preventDefault(); sel = Math.min(filtered.length - 1, sel + 1); render(inp.value); }
    else if(e.key === 'ArrowUp'){ e.preventDefault(); sel = Math.max(0, sel - 1); render(inp.value); }
    else if(e.key === 'Enter'){ e.preventDefault(); exec(sel); }
  }

  function open(){
    if(el || !(window.S && S.data)) return;
    items = buildItems(); sel = 0;
    el = document.createElement('div');
    el.className = 'cmdk-scrim';
    el.innerHTML = '<div class="cmdk-box" role="dialog" aria-label="Поиск по системе">'+
      '<div class="cmdk-hd">'+
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2.2"/><path d="M21 21l-4.3-4.3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'+
        '<input class="cmdk-input" type="text" placeholder="Куда перейти или что сделать…" autocomplete="off" spellcheck="false">'+
        '<kbd class="cmdk-esc">esc</kbd>'+
      '</div>'+
      '<div class="cmdk-list"></div>'+
    '</div>';
    document.body.appendChild(el);
    var input = el.querySelector('.cmdk-input');
    input.addEventListener('input', function(){ sel = 0; render(this.value); });
    el.addEventListener('click', function(e){
      if(e.target === el){ close(); return; }
      var b = e.target.closest('.cmdk-item');
      if(b) exec(+b.dataset.i);
    });
    el.querySelector('.cmdk-list').addEventListener('mousemove', function(e){
      var b = e.target.closest('.cmdk-item');
      if(b && +b.dataset.i !== sel){ sel = +b.dataset.i; render(input.value); }
    });
    el.addEventListener('keydown', onKey);
    render('');
    input.focus();
  }

  document.addEventListener('keydown', function(e){
    if((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')){
      e.preventDefault();
      if(el) close(); else open();
    }
  });
  var trigger = document.getElementById('btnCmdk');
  if(trigger) trigger.addEventListener('click', open);
})();

/**
 * Скользящая сессия. Токен живёт 7 дней; /auth/resume при каждом успешном
 * ответе возвращает новый. Раньше свежий токен клали только в S.token и не
 * сохраняли — при ежедневном использовании через 7 дней всё равно бы выкинуло.
 * Теперь сохраняем всегда, плюс тихо продлеваем раз в 3 часа и при возврате
 * на вкладку.
 */
function persistToken(r){
  if(r && r.ok && r.token && typeof S !== 'undefined'){
    S.token = r.token;
    // В браузере сессию держит httpOnly-кука — в localStorage не дублируем.
    if(IN_TG) store.set(LS_TOKEN, r.token);
  }
}

var _lastKeepAlive = Date.now();
function keepSessionFresh(){
  if(typeof S === 'undefined' || !S.token) return;
  _lastKeepAlive = Date.now();
  call('apiResume', S.token).then(function(r){
    if(r && r.ok) persistToken(r);
    // молча: истёкшую сессию поймает обычный запрос и покажет «Сессия истекла»
  }).catch(function(){});
}
setInterval(keepSessionFresh, 3 * 60 * 60 * 1000);
document.addEventListener('visibilitychange', function(){
  if(document.visibilityState === 'visible' && S.token && Date.now() - _lastKeepAlive > 60 * 60 * 1000){
    keepSessionFresh();
  }
});

// Снимок текущего экрана: и в localStorage (пережить перезагрузку), и в
// history.state (кнопки браузера/телефона «назад/вперёд»).
function navSnapshot(){
  return {
    appView: S.appView,
    unit: S.unit,
    tab: S.tab,
    dashTab: S.dashTab,
    dashSumTab: S.dashSumTab,
    adminTab: S.adminTab,
    dictKind: S.dictKind,
    adminDivsView: S.adminDivsView,
    adminUsersSearch: S.adminUsersSearch || '',
    adminUsersRole: S.adminUsersRole || '',
    adminUsersDept: S.adminUsersDept || '',
    expandedDir: S.expandedDir,
    expandedUnit: S.expandedUnit,
    expandedSubUnit: S.expandedSubUnit || '',
    selectedOrgNode: S.selectedOrgNode,
    orgZoom: S.orgZoom,
    orgDrawerCollapsed: !!S.orgDrawerCollapsed,
    orgScroll: S.orgScroll || null,
    railCollapsed: !!S.railCollapsed
  };
}

// Раскладка снимка обратно в S.* (без рендера). Используют restoreNavState
// (из localStorage) и обработчик popstate (из history.state).
function applyNavObject(nav){
  if(!nav || typeof nav !== 'object') return false;
  if(nav.appView === 'dash_hrbp') nav.appView = 'progress'; // легаси-имя
  if(nav.appView) S.appView = nav.appView;
  S.unit = nav.unit || null;
  if(nav.tab) S.tab = nav.tab;
  if(nav.dashTab) S.dashTab = nav.dashTab;
  if(nav.dashSumTab) S.dashSumTab = nav.dashSumTab;
  if(nav.adminTab) S.adminTab = nav.adminTab;
  if(nav.dictKind) S.dictKind = nav.dictKind;
  if(nav.adminDivsView) S.adminDivsView = nav.adminDivsView;
  if(nav.adminUsersSearch !== undefined) S.adminUsersSearch = nav.adminUsersSearch;
  if(nav.adminUsersRole !== undefined) S.adminUsersRole = nav.adminUsersRole;
  if(nav.adminUsersDept !== undefined) S.adminUsersDept = nav.adminUsersDept;
  if(nav.expandedDir !== undefined) S.expandedDir = nav.expandedDir;
  if(nav.expandedUnit !== undefined) S.expandedUnit = nav.expandedUnit;
  if(nav.expandedSubUnit !== undefined) S.expandedSubUnit = nav.expandedSubUnit;
  if(nav.selectedOrgNode) S.selectedOrgNode = nav.selectedOrgNode;
  if(nav.orgZoom) S.orgZoom = nav.orgZoom;
  if(nav.orgDrawerCollapsed !== undefined) S.orgDrawerCollapsed = nav.orgDrawerCollapsed;
  if(nav.orgScroll) S.orgScroll = nav.orgScroll;
  if(nav.railCollapsed !== undefined) S.railCollapsed = nav.railCollapsed;
  return true;
}

function saveNavState(){
  try { store.set(LS_NAV, JSON.stringify(navSnapshot())); } catch(e){}
  try { saveViewScroll(); } catch(e){}
  pushNavHistory(false);
}

function restoreNavState(){
  try {
    var raw = store.get(LS_NAV);
    if(!raw) return false;
    return applyNavObject(JSON.parse(raw));
  } catch(e){}
  return false;
}

// ═══════════════════════════════════════════════════════════
// БЕСШОВНОЕ СОХРАНЕНИЕ И ВОССТАНОВЛЕНИЕ ПРОКРУТКИ И ФОКУСА
// ═══════════════════════════════════════════════════════════
var SS_SCROLLS = 'farovon_view_scrolls';

function getAppViewKey(){
  var v = S.appView || 'home';
  if(v === 'admin'){
    var sub = S.adminTab || 'users';
    if(sub === 'divisions') return 'admin:divisions:' + (S.adminDivsView || 'tree');
    if(sub === 'dict') return 'dict:' + (S.dictKind || 'companies');
    return 'admin:' + sub;
  }
  if(v === 'unit') return 'unit:' + (S.unit || '') + ':' + (S.tab || 'step1');
  if(v === 'dashboard') return 'dashboard:' + (S.dashTab || 'summary') + ':' + (S.dashSumTab || 'units');
  if(v === 'benchmarks') return 'benchmarks:' + (S.bmTab || 'summary');
  return v;
}

function getAllViewScrolls(){
  if(S.viewScrolls) return S.viewScrolls;
  try {
    var raw = sessionStorage.getItem(SS_SCROLLS);
    if(raw){ S.viewScrolls = JSON.parse(raw) || {}; return S.viewScrolls; }
  } catch(e){}
  S.viewScrolls = {};
  return S.viewScrolls;
}

function saveViewScroll(key){
  key = key || getAppViewKey();
  var b = $('body');
  if(!b) return;
  var tbl = b.querySelector('.tblwrap') || b.querySelector('.tbl-wrap') || b.querySelector('.co-list-scroll');
  var all = getAllViewScrolls();
  var prev = all[key] || {};
  var isOrg = key.indexOf('admin:divisions') >= 0;
  all[key] = {
    bodyTop: isOrg ? 0 : b.scrollTop,
    bodyLeft: isOrg ? 0 : b.scrollLeft,
    tblTop: tbl ? tbl.scrollTop : 0,
    tblLeft: tbl ? tbl.scrollLeft : 0,
    activeId: (S.lastActiveIdByView && S.lastActiveIdByView[key]) || prev.activeId || null,
    ts: Date.now()
  };
  try {
    sessionStorage.setItem(SS_SCROLLS, JSON.stringify(all));
  } catch(e){}
}

function markActiveItem(id, key){
  if(!id) return;
  key = key || getAppViewKey();
  if(!S.lastActiveIdByView) S.lastActiveIdByView = {};
  S.lastActiveIdByView[key] = id;
  saveViewScroll(key);
}

function restoreViewScroll(key, opts){
  key = key || getAppViewKey();
  opts = opts || {};
  var all = getAllViewScrolls();
  var data = all[key];
  if(!data) return;

  var b = $('body');
  if(!b) return;

  b._restoringScroll = true;
  var isOrg = key.indexOf('admin:divisions') >= 0;

  var doApply = function(){
    if(!b) return;
    if(isOrg){
      b.scrollTop = 0;
    } else {
      if(data.bodyTop != null) b.scrollTop = data.bodyTop;
    }
    if(data.bodyLeft != null) b.scrollLeft = isOrg ? 0 : data.bodyLeft;

    var tbl = b.querySelector('.tblwrap') || b.querySelector('.tbl-wrap') || b.querySelector('.co-list-scroll');
    if(tbl){
      if(data.tblTop != null) tbl.scrollTop = data.tblTop;
      if(data.tblLeft != null) tbl.scrollLeft = data.tblLeft;
    }

    var actId = opts.activeId || data.activeId;
    if(actId){
      var clean = actId.replace(/^(urow_|divrow_|unit_)/, '');
      var row = document.getElementById(actId) ||
                document.querySelector('[data-login="'+clean+'"]') ||
                document.querySelector('[data-unit="'+clean+'"]') ||
                document.querySelector('[data-u="'+clean+'"]');
      if(row){
        document.querySelectorAll('.is-row-focused').forEach(function(el){ el.classList.remove('is-row-focused'); });
        row.classList.add('is-row-focused');
        try {
          if(tbl && tbl.contains(row)){
            var rTop = row.offsetTop;
            var tScroll = tbl.scrollTop;
            var tHeight = tbl.clientHeight;
            if(rTop < tScroll || rTop > tScroll + tHeight - 40){
              tbl.scrollTop = Math.max(0, rTop - 40);
            }
          } else {
            var rect = row.getBoundingClientRect();
            var bRect = b.getBoundingClientRect();
            if(rect.top < bRect.top + 20 || rect.bottom > bRect.bottom - 20){
              row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
          }
        } catch(e){}
      }
    }
  };

  doApply();
  requestAnimationFrame(doApply);
  setTimeout(doApply, 40);
  setTimeout(function(){
    doApply();
    if(b) b._restoringScroll = false;
  }, 160);
}

function hookBodyScroll(){
  var b = $('body');
  if(!b || b._scrollHooked) return;
  b._scrollHooked = true;
  var timer = null;
  b.addEventListener('scroll', function(){
    if(b._restoringScroll) return;
    if(timer) clearTimeout(timer);
    timer = setTimeout(function(){
      saveViewScroll();
    }, 80);
  }, { passive: true });
}

window.addEventListener('beforeunload', function(){
  try { saveViewScroll(); } catch(e){}
});

document.addEventListener('click', function(e){
  var row = e.target.closest('tr[data-login], .u-card[data-login], tr[data-unit], .unit[data-u], .org-card-box[data-unit]');
  if(row){
    var id = row.id || (row.dataset.login ? 'urow_' + row.dataset.login : (row.dataset.unit ? 'divrow_' + row.dataset.unit : (row.dataset.u ? 'unit_' + row.dataset.u : null)));
    if(id) markActiveItem(id);
  }
}, true);

hookBodyScroll();

// ─── Кнопки браузера/телефона «назад/вперёд» ──────────────────────────────
// Каждая смена экрана кладёт снимок в history. «Назад/вперёд» ловит popstate,
// проверяет несохранённый черновик (askDirty) и восстанавливает экран.
// Черновик самого заполнения лежит в LS_DRAFT (markDirty) — правки не теряются
// даже если человек уйдёт: при повторном открытии подразделения предложат их.
function _navKey(s){
  return !s ? '' : [s.appView, s.unit, s.tab, s.dashTab, s.dashSumTab, s.adminTab, s.dictKind].join('|');
}
function pushNavHistory(replace){
  if(!S.data || !window.history || !window.history.pushState) return;
  var snap = navSnapshot();
  if(!replace && _navKey(history.state) === _navKey(snap)) return; // тот же экран — не плодим записи
  try {
    var url = location.pathname + location.search;
    if(replace) history.replaceState(snap, '', url);
    else history.pushState(snap, '', url);
  } catch(e){}
}
window.addEventListener('popstate', function(e){
  var target = e.state;
  if(!S.data || !target) return;
  var apply = function(){
    S.dirty = false;
    applyNavObject(target);
    if(typeof renderCurrentView === 'function') renderCurrentView();
  };
  if(S.dirty){
    var stay = navSnapshot(); // history уже сдвинулся — на «нет» вернём сюда
    askDirty('Перейти по истории браузера').then(function(yes){
      if(yes) apply();
      else { try { history.pushState(stay, '', location.pathname + location.search); } catch(e2){} }
    });
  } else {
    apply();
  }
});

function $(id){
  if(!id) return null;
  if(id === 'body' && window.WorkspaceTabs && window.WorkspaceTabs.getActivePane){
    var p = window.WorkspaceTabs.getActivePane();
    if(p) return p;
  }
  if(window.WorkspaceTabs && window.WorkspaceTabs.getActivePane){
    var p = window.WorkspaceTabs.getActivePane();
    if(p){
      try {
        var el = p.querySelector('#' + (window.CSS && CSS.escape ? CSS.escape(id) : id));
        if(el) return el;
      } catch(e){}
    }
  }
  return document.getElementById(id);
}

/**
 * Защита от гонки вкладок: $(id) внутри отложенного (.then/.catch) кода
 * всегда резолвится по ТЕКУЩЕЙ активной вкладке (см. $() выше) — если между
 * запуском асинхронной загрузки и приходом ответа человек успел переключиться
 * на другую вкладку, результат прошлой загрузки дорисовывается в чужую панель:
 * заголовок вкладки остаётся один, а содержимое — от другого раздела.
 *
 * guardAsyncToTab(fn) запоминает, какая вкладка активна ПРЯМО СЕЙЧАС, и
 * оборачивает fn так, что она выполнится только если к моменту вызова эта же
 * вкладка всё ещё активна; иначе — no-op, а вкладка помечается needsRefresh,
 * чтобы при возврате на неё данные подтянулись заново, а не остались старыми.
 * Использовать на всех call(...).then(callback) / .catch(callback), которые
 * пишут в DOM (через $) или в общий S.*, а не только на своё локальное состояние.
 */
function guardAsyncToTab(fn){
  var tabId = (window.WorkspaceTabs && WorkspaceTabs.activeId) || null;
  return function(){
    var stillActive = !tabId || !window.WorkspaceTabs || WorkspaceTabs.activeId === tabId;
    if(!stillActive){
      var t = window.WorkspaceTabs && WorkspaceTabs.getTab ? WorkspaceTabs.getTab(tabId) : null;
      if(t) t.needsRefresh = true;
      return;
    }
    return fn.apply(this, arguments);
  };
}

// Экранирование для вставки в HTML. Помимо & < > " гасим и одинарную кавычку
// (&#39;) — на случай атрибутов в одинарных кавычках и inline-обработчиков,
// чтобы esc() был безопасен в любом HTML-контексте, а не только в "...".
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function uid(){ return 'tmp' + Math.random().toString(36).slice(2,10); }

var APP_VERSION = window.APP_VERSION || 'v2.5.171';
window.APP_VERSION = APP_VERSION;

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

function getInitials(name){
  if(!name) return '—';
  var p = String(name).trim().split(/\s+/).filter(Boolean);
  if(!p.length) return '—';
  if(p.length >= 2) return (p[0].charAt(0) + p[1].charAt(0)).toUpperCase();
  return (p[0].charAt(0) || '—').toUpperCase();
}

/**
 * Разбор суммы оклада. Люди вводят по-разному: "10000", "10 000", "10,000",
 * "10.000" — пробел, запятая и точка здесь ВСЕГДА разделители тысяч (дробных
 * окладов в вилках не бывает). Раньше запятая/точка трактовались как
 * десятичный разделитель: "10,000" превращалось в 10, вилка от=5000 до=10
 * считалась перевёрнутой и «Сохранить» молча отклонялся.
 */
function parseMoney(v){
  var s = String(v == null ? '' : v).replace(/[\s .,]/g, '');
  var n = Number(s);
  return isNaN(n) ? 0 : n;
}

/**
 * Единый набор SVG-иконок (Apple HIG / Linear стиль — тонкая линия, currentColor).
 * Эмодзи в интерфейсе не используются нигде — только эти иконки, чтобы стиль
 * не расходился между экранами и не превращался в «стикеры».
 */
var ICONS = {
  home: '<path d="M3 10.5L12 3l9 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 9.5V20a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V9.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  dashboard: '<path d="M4 19V10M12 19V5M20 19V13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  chart: '<path d="M18 20V10M12 20V4M6 20v-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  eye: '<path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.8"/>',
  'eye-off': '<path d="M10.6 5.2A9.6 9.6 0 0112 5c6.5 0 10.5 7 10.5 7a18 18 0 01-2.5 3.3M6.2 6.7A17.8 17.8 0 001.5 12S5.5 19 12 19a9.3 9.3 0 004.2-.95M9.9 9.9a3.2 3.2 0 004.2 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 3l18 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  admin: '<path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" stroke-width="1.8"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" stroke-width="1.6"/>',
  clipboard: '<path d="M9 11l3 3L22 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  units: '<rect x="3" y="3" width="7" height="9" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="14" y="3" width="7" height="5" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="14" y="12" width="7" height="9" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="3" y="16" width="7" height="5" rx="1.5" stroke="currentColor" stroke-width="2"/>',
  users: '<circle cx="9" cy="8" r="3.2" stroke="currentColor" stroke-width="1.9"/><path d="M3.5 19c.7-3.3 3-5 5.5-5s4.8 1.7 5.5 5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="17" cy="8.5" r="2.6" stroke="currentColor" stroke-width="1.9"/><path d="M15.3 19c.5-2.6 1.9-4.3 4.7-4.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1.2" stroke="currentColor" stroke-width="1.9"/><path d="M4 8v10a2 2 0 002 2h12a2 2 0 002-2V8" stroke="currentColor" stroke-width="1.9"/><path d="M10 12h4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  clock: '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.9"/><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  wrench: '<path d="M14.7 6.3a3.5 3.5 0 01-4.9 4.9L4 17l3 3 5.8-5.8a3.5 3.5 0 014.9-4.9l-3 3-2-2 3-3z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  search: '<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2.2"/><path d="M21 21l-4.3-4.3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  refresh: '<path d="M4 12a8 8 0 0113.66-5.66M20 12a8 8 0 01-13.66 5.66" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M17 3v4h-4M7 21v-4h4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  help: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.9"/><path d="M9.5 9.2a2.5 2.5 0 114.2 1.9c-.9.7-1.7 1.2-1.7 2.4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="17" r="1" fill="currentColor"/>',
  key: '<circle cx="8" cy="15" r="3.2" stroke="currentColor" stroke-width="1.9"/><path d="M10.3 12.7L19 4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M16 7l2.5 2.5M13.3 9.7l2 2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  check: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M8.5 12.3l2.2 2.2 4.8-4.8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  link: '<path d="M9.5 14.5l5-5M8.2 12.2l-1.4 1.4a3 3 0 004.2 4.2l2-2M15.8 11.8l1.4-1.4a3 3 0 00-4.2-4.2l-2 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  logout: '<path d="M15 3H6a2 2 0 00-2 2v14a2 2 0 002 2h9" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 12h11m0 0l-3.5-3.5M21 12l-3.5 3.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 016.5 3H12v18H6.5A2.5 2.5 0 014 18.5v-13z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M20 5.5A2.5 2.5 0 0017.5 3H12v18h5.5a2.5 2.5 0 002.5-2.5v-13z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  warn: '<path d="M12 3.5l9.5 16.5H2.5L12 3.5z" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M12 10v4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1" fill="currentColor"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M3 10h18" stroke="currentColor" stroke-width="2"/><circle cx="16.5" cy="14.5" r="1.1" fill="currentColor"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 9.5h17M3.5 14.5h17M9 9.5v10M15 9.5v10" stroke="currentColor" stroke-width="1.6"/>',
  target: '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4.5" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  medal: '<circle cx="12" cy="9" r="5.5" stroke="currentColor" stroke-width="2"/><path d="M9 13.5L7.5 21l4.5-2.5 4.5 2.5-1.5-7.5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  download: '<path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 19h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  megaphone: '<path d="M3 10v4a1 1 0 001 1h2l7 4V5l-7 4H4a1 1 0 00-1 1z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M17 9a4 4 0 010 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M19.5 6.5a8 8 0 010 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  pencil: '<path d="M4 20l1-4.5L16.5 4l3 3L8 18.5 4 20z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 6.5l3 3" stroke="currentColor" stroke-width="1.8"/>',
  more: '<circle cx="5" cy="12" r="1.45" fill="currentColor"/><circle cx="12" cy="12" r="1.45" fill="currentColor"/><circle cx="19" cy="12" r="1.45" fill="currentColor"/>',
  block: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M9.5 9.5l5 5m0-5l-5 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  undo: '<path d="M4 12a8 8 0 108-8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M4 5v5h5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  broom: '<path d="M14 3l-9 9-2 5 5-2 9-9-3-3z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M6 16l-1.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  bolt: '<path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  profile: '<circle cx="12" cy="8" r="3.4" stroke="currentColor" stroke-width="1.9"/><path d="M4.5 20c1-4 4-6.2 7.5-6.2s6.5 2.2 7.5 6.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  info: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 11v5.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="7.8" r="1.1" fill="currentColor"/>',
  chevron: '<path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  trash: '<path d="M4 7h16M10 4h4M9 7v12M15 7v12M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  shield: '<path d="M12 3l7 3v6c0 4.2-2.9 7.9-7 9-4.1-1.1-7-4.8-7-9V6l7-3z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.2 12.2l2 2 3.6-3.8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2" stroke="currentColor" stroke-width="1.9"/><path d="M7.5 10.5V7a4.5 4.5 0 019 0v3.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  unlock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2" stroke="currentColor" stroke-width="1.9"/><path d="M7.5 10.5V7a4.5 4.5 0 018.8-.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  // Воронка для кнопки «Фильтр» (client/smartFilter.js). Её вызов ic('filter')
  // висел вхолостую: имени в наборе не было, и вместо иконки рисовался пустой
  // svg — до этого по той же причине не работал icBare('tune').
  filter: '<path d="M3.5 5h17l-6.6 7.8v5.4l-3.8 2.3v-7.7L3.5 5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  // Грейдирование — ступени уровней. Намеренно не столбики (это dashboard и
  // chart) и не планшет (clipboard у отчёта и журнала): в боковом меню
  // разделы должны различаться с одного взгляда.
  grades: '<path d="M3.5 20.5h5.5V15H3.5v5.5zM9 20.5h6V9.5H9v11zM15 20.5h5.5V4H15v16.5z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  // Риски незаменимости — человек с восклицательным знаком: оценивается
  // конкретный носитель знаний, а не абстрактная опасность (щит занят
  // «Ролями и доступами», треугольник — предупреждениями).
  risk: '<circle cx="9.5" cy="8" r="3.3" stroke="currentColor" stroke-width="1.9"/><path d="M3.5 19.5c.6-3.3 3-5.2 6-5.2 1 0 2 .2 2.8.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M18 10.5v5" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/><circle cx="18" cy="19" r="1.05" fill="currentColor"/>',
  // Чат поддержки — облако с хвостиком, отличимо от «Журнала действий»
  // (планшет) и «Роли и доступы» (щит).
  chat: '<path d="M4 5.5A2.5 2.5 0 016.5 3h11A2.5 2.5 0 0120 5.5v8A2.5 2.5 0 0117.5 16H10l-4.5 4v-4H6.5A2.5 2.5 0 014 13.5v-8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  // Объединение дублей компаний — две ветки сходятся в одну (git-merge).
  merge: '<circle cx="6" cy="6" r="2.3" stroke="currentColor" stroke-width="1.9"/><circle cx="6" cy="18" r="2.3" stroke="currentColor" stroke-width="1.9"/><circle cx="18" cy="18" r="2.3" stroke="currentColor" stroke-width="1.9"/><path d="M6 8.3V13a3 3 0 003 3h6.7" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M18 12V8.3" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'
};
/** Иконка для инлайн-текста (кнопка/пункт меню): с отступом справа и выравниванием по базовой линии. */
function ic(name, size){
  size = size || 14;
  return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" style="vertical-align:-2.5px;margin-right:5px;flex:none">'+(ICONS[name]||'')+'</svg>';
}
/** Голая иконка без отступов — для абсолютного позиционирования (.search-wrap и т.п.). */
function icBare(name, size){
  size = size || 14;
  return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none">'+(ICONS[name]||'')+'</svg>';
}

// ═══════════════════════════════════════════════════════════
// МНОГОВКЛАДОЧНАЯ РАБОЧАЯ ОБЛАСТЬ (В стиле АИСТ / aist.taxsee.com)
// ═══════════════════════════════════════════════════════════
var WorkspaceTabs = {
  tabs: [],          // [{ id, key, title, icon, run, state, paneEl, scroll, pinned, needsRefresh }]
  activeId: null,
  history: [],
  isInsideTabRun: false,
  draggedId: null,
  syncChannel: (typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('farovon_ws_sync') : null),

  getTab: function(id){
    for(var i = 0; i < this.tabs.length; i++){
      if(this.tabs[i].id === id) return this.tabs[i];
    }
    return null;
  },

  getTabByKey: function(key){
    for(var i = 0; i < this.tabs.length; i++){
      if(this.tabs[i].key === key) return this.tabs[i];
    }
    return null;
  },

  getActivePane: function(){
    if(!this.activeId) return null;
    var t = this.getTab(this.activeId);
    return t ? t.paneEl : null;
  },

  ensureHomeTab: function(){
    var home = this.getTabByKey('home');
    if(!home){
      var bodyContainer = document.getElementById('body');
      if(!bodyContainer) return null;
      bodyContainer.classList.add('has-workspace-tabs');

      var id = 'tab_home';
      var pane = document.getElementById('pane_' + id);
      if(!pane){
        pane = document.createElement('div');
        pane.className = 'workspace-pane hidden';
        pane.id = 'pane_' + id;
        pane.dataset.tabId = id;
        bodyContainer.appendChild(pane);
      }

      var self = this;
      var runner = function(){
        if(typeof self.resolveTabRunner === 'function'){
          var customRunner = self.resolveTabRunner({ key: 'home', state: { appView: 'home', unit: null } });
          if(customRunner) return customRunner();
        }
        if(typeof renderHome === 'function') renderHome();
      };

      home = {
        id: id,
        key: 'home',
        title: 'Главная',
        icon: 'home',
        run: runner,
        state: { appView: 'home', unit: null },
        paneEl: pane,
        scroll: 0,
        pinned: true,
        needsRefresh: false
      };
      this.tabs.unshift(home);
      this.renderBar();
    } else {
      home.title = 'Главная';
      home.icon = 'home';
      home.pinned = true;
      var hIdx = this.tabs.indexOf(home);
      if(hIdx > 0){
        this.tabs.splice(hIdx, 1);
        this.tabs.unshift(home);
      }
      for(var i = 1; i < this.tabs.length; i++){
        this.tabs[i].pinned = false;
      }
      this.renderBar();
    }
    return home;
  },

  init: function(){
    var bar = document.getElementById('workspaceTabs');
    if(!bar) return;
    var self = this;

    // Клик левой кнопкой мыши
    bar.onclick = function(e){
      self.closeContextMenu();
      var closeBtn = e.target.closest('[data-ws-close]');
      if(closeBtn){
        e.stopPropagation();
        self.closeTab(closeBtn.dataset.wsClose);
        return;
      }
      var newBtn = e.target.closest('#btnWsNewTab');
      if(newBtn){
        e.stopPropagation();
        self.duplicateTab(self.activeId);
        return;
      }
      var tabEl = e.target.closest('[data-ws-id]');
      if(tabEl){
        self.activateTab(tabEl.dataset.wsId);
      }
    };

    // Клик средней кнопкой (колёсиком) — закрытие
    bar.onauxclick = function(e){
      self.closeContextMenu();
      if(e.button === 1){
        var tabEl = e.target.closest('[data-ws-id]');
        if(tabEl){
          e.preventDefault();
          e.stopPropagation();
          self.closeTab(tabEl.dataset.wsId);
        }
      }
    };

    // Правый клик — контекстное меню
    bar.oncontextmenu = function(e){
      var tabEl = e.target.closest('[data-ws-id]');
      if(tabEl){
        e.preventDefault();
        e.stopPropagation();
        self.openContextMenu(tabEl.dataset.wsId, e.clientX, e.clientY);
      }
    };

    // Закрытие контекстного меню при клике в любом месте или Escape
    document.addEventListener('click', function(e){
      if(!e.target.closest('.ws-tab-context-menu')){
        self.closeContextMenu();
      }
    });

    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape') self.closeContextMenu();
    });

    // Drag & Drop перетаскивание вкладок
    bar.ondragstart = function(e){
      var tabEl = e.target.closest('[data-ws-id]');
      if(!tabEl) return;
      var tab = self.getTab(tabEl.dataset.wsId);
      if(!tab || tab.pinned){
        e.preventDefault();
        return;
      }
      self.draggedId = tab.id;
      tabEl.classList.add('is-dragging');
      if(e.dataTransfer){
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', tab.id);
      }
    };

    bar.ondragover = function(e){
      if(!self.draggedId) return;
      var targetTabEl = e.target.closest('[data-ws-id]');
      if(!targetTabEl) return;
      var targetTab = self.getTab(targetTabEl.dataset.wsId);
      if(!targetTab || targetTab.id === self.draggedId) return;
      e.preventDefault();
      if(e.dataTransfer) e.dataTransfer.dropEffect = 'move';

      var rect = targetTabEl.getBoundingClientRect();
      var isAfter = (e.clientX - rect.left) > (rect.width / 2);

      // Закреплённые вкладки всегда остаются первыми
      if(targetTab.pinned && !isAfter) return;

      var allTabs = bar.querySelectorAll('.ws-tab');
      for(var i = 0; i < allTabs.length; i++){
        allTabs[i].classList.remove('drop-before', 'drop-after');
      }
      if(isAfter){
        targetTabEl.classList.add('drop-after');
      } else {
        targetTabEl.classList.add('drop-before');
      }
    };

    bar.ondragleave = function(e){
      var tabEl = e.target.closest('[data-ws-id]');
      if(tabEl){
        tabEl.classList.remove('drop-before', 'drop-after');
      }
    };

    bar.ondrop = function(e){
      if(!self.draggedId) return;
      e.preventDefault();
      var targetTabEl = e.target.closest('[data-ws-id]');
      if(!targetTabEl){ self.cleanupDrag(); return; }
      var targetId = targetTabEl.dataset.wsId;
      var draggedId = self.draggedId;
      if(targetId === draggedId){ self.cleanupDrag(); return; }

      var rect = targetTabEl.getBoundingClientRect();
      var isAfter = (e.clientX - rect.left) > (rect.width / 2);

      var fromIdx = -1, toIdx = -1;
      for(var i = 0; i < self.tabs.length; i++){
        if(self.tabs[i].id === draggedId) fromIdx = i;
        if(self.tabs[i].id === targetId) toIdx = i;
      }

      if(fromIdx > -1 && toIdx > -1){
        var draggedItem = self.tabs.splice(fromIdx, 1)[0];
        var newToIdx = -1;
        for(var j = 0; j < self.tabs.length; j++){
          if(self.tabs[j].id === targetId){ newToIdx = j; break; }
        }
        var insertAt = isAfter ? newToIdx + 1 : newToIdx;
        var minIdx = 0;
        while(minIdx < self.tabs.length && self.tabs[minIdx].pinned) minIdx++;
        if(insertAt < minIdx) insertAt = minIdx;

        self.tabs.splice(insertAt, 0, draggedItem);
        self.renderBar();
        self.saveSessionTabs();
      }
      self.cleanupDrag();
    };

    bar.ondragend = function(){
      self.cleanupDrag();
    };

    // Слушатель канала синхронизации между окнами/вкладками
    if(this.syncChannel){
      this.syncChannel.onmessage = function(ev){
        if(ev && ev.data && ev.data.type === 'datachange'){
          self.handleDataChange(ev.data.meta);
        }
      };
    }
  },

  cleanupDrag: function(){
    this.draggedId = null;
    var bar = document.getElementById('workspaceTabs');
    if(bar){
      var allTabs = bar.querySelectorAll('.ws-tab');
      for(var i = 0; i < allTabs.length; i++){
        allTabs[i].classList.remove('is-dragging', 'drop-before', 'drop-after');
      }
    }
  },

  openTab: function(opts){
    if(!opts || !opts.key) return null;
    this.ensureHomeTab();
    if(opts.key === 'home'){
      var homeTab = this.getTabByKey('home');
      if(homeTab){
        homeTab.title = 'Главная';
        homeTab.icon = 'home';
        homeTab.pinned = true;
        if(opts.run) homeTab.run = opts.run;
        if(opts.state){
          for(var k in opts.state){ homeTab.state[k] = opts.state[k]; }
        }
        this.activateTab(homeTab.id);
        return homeTab;
      }
    }
    if(!opts.forceNew){
      var existing = this.getTabByKey(opts.key);
      if(existing){
        if(opts.title) existing.title = opts.title;
        if(opts.icon) existing.icon = opts.icon;
        existing.pinned = (opts.key === 'home');
        if(opts.state){
          for(var k in opts.state){ existing.state[k] = opts.state[k]; }
        }
        this.activateTab(existing.id);
        return existing;
      }
    }

    var bodyContainer = document.getElementById('body');
    if(!bodyContainer) return null;
    bodyContainer.classList.add('has-workspace-tabs');

    var id = 'tab_' + Math.random().toString(36).slice(2, 9);
    var pane = document.createElement('div');
    pane.className = 'workspace-pane';
    pane.id = 'pane_' + id;
    pane.dataset.tabId = id;
    bodyContainer.appendChild(pane);

    var tab = {
      id: id,
      key: opts.key,
      title: opts.title || 'Вкладка',
      icon: opts.icon || 'units',
      run: opts.run,
      state: opts.state || {},
      paneEl: pane,
      scroll: 0,
      pinned: (opts.key === 'home'),
      needsRefresh: false
    };

    if(tab.pinned){
      var pinIdx = 0;
      while(pinIdx < this.tabs.length && this.tabs[pinIdx].pinned) pinIdx++;
      this.tabs.splice(pinIdx, 0, tab);
    } else {
      this.tabs.push(tab);
    }

    this.activateTab(id, true);
    return tab;
  },

  duplicateTab: function(id){
    var src = this.getTab(id);
    if(!src) return;

    var baseTitle = src.title.replace(/\s*\(\d+\)$/, '');
    var count = 1;
    this.tabs.forEach(function(t){
      if(t.title.indexOf(baseTitle) === 0) count++;
    });
    var newTitle = baseTitle + ' (' + count + ')';
    var newKey = src.key + '#dup_' + Math.random().toString(36).slice(2, 7);

    var bodyContainer = document.getElementById('body');
    if(!bodyContainer) return;

    var newId = 'tab_' + Math.random().toString(36).slice(2, 9);
    var pane = document.createElement('div');
    pane.className = 'workspace-pane';
    pane.id = 'pane_' + newId;
    pane.dataset.tabId = newId;
    bodyContainer.appendChild(pane);

    var dupTab = {
      id: newId,
      key: newKey,
      title: newTitle,
      icon: src.icon,
      run: src.run,
      state: Object.assign({}, src.state || {}, { dirty: false }),
      paneEl: pane,
      scroll: 0,
      pinned: false,
      needsRefresh: false
    };

    var srcIdx = this.tabs.indexOf(src);
    if(srcIdx >= 0) this.tabs.splice(srcIdx + 1, 0, dupTab);
    else this.tabs.push(dupTab);

    this.activateTab(newId, true);
    if(typeof toast === 'function') toast('Вкладка дублирована: ' + newTitle, 'ok');
  },

  activateTab: function(id, isNew){
    var target = this.getTab(id);
    if(!target) return;

    if(this.activeId && this.activeId !== id){
      var cur = this.getTab(this.activeId);
      if(cur){
        if(cur.paneEl){
          cur.scroll = cur.paneEl.scrollTop || 0;
          cur.paneEl.classList.add('hidden');
        }
        cur.state = cur.state || {};
        cur.state.appView = S.appView;
        cur.state.unit = S.unit;
        cur.state.adminTab = S.adminTab;
        cur.state.dictKind = S.dictKind;
        cur.state.dashTab = S.dashTab;
        cur.state.bmTab = (typeof BM_STATE !== 'undefined' ? BM_STATE.tab : null);
        cur.state.dirty = S.dirty;

        var bEl = document.getElementById('bar');
        cur.hasBar = bEl && !bEl.classList.contains('hidden');
      }
    }

    // При любом переключении вкладок гарантированно скрываем общую нижнюю плавающую панель
    var globalBar = document.getElementById('bar');
    if(globalBar) globalBar.classList.add('hidden');
    document.body.classList.remove('has-bar');

    this.activeId = id;
    this.history = this.history.filter(function(hid){ return hid !== id; });
    this.history.push(id);

    if(target.state){
      if(target.state.appView !== undefined) S.appView = target.state.appView;
      if(target.state.unit !== undefined) S.unit = target.state.unit;
      if(target.state.adminTab !== undefined) S.adminTab = target.state.adminTab;
      if(target.state.dictKind !== undefined) S.dictKind = target.state.dictKind;
      if(target.state.dashTab !== undefined) S.dashTab = target.state.dashTab;
      if(target.state.bmTab !== undefined && typeof BM_STATE !== 'undefined') BM_STATE.tab = target.state.bmTab;
      if(target.state.dirty !== undefined) S.dirty = target.state.dirty;
    }

    if(target.paneEl){
      target.paneEl.classList.remove('hidden');
    }

    var isPaneEmpty = !target.paneEl || !target.paneEl.childNodes.length || !target.paneEl.textContent.trim();
    var shouldRun = isNew || isPaneEmpty || (target.needsRefresh && !target.state.dirty);

    if(shouldRun){
      target.needsRefresh = false;
      if(typeof target.run === 'function'){
        this.isInsideTabRun = true;
        try {
          target.run();
        } finally {
          this.isInsideTabRun = false;
        }
      }
    } else {
      // Восстанавливаем заголовок вкладки в верхней шапке системы
      if(typeof setTop === 'function'){
        var isUnit = (target.state && target.state.appView === 'unit');
        var topT = target.topTitle !== undefined ? target.topTitle : (isUnit ? (target.state.unit || target.title) : target.title);
        var topS = target.topSub !== undefined ? target.topSub : (isUnit ? '' : (typeof userLabel === 'function' ? userLabel() : ''));
        var topB = target.topBack !== undefined ? target.topBack : isUnit;
        var topI = target.topIcon !== undefined ? target.topIcon : (isUnit ? 'units' : target.icon);
        setTop(topT, topS, topB, topI);
      }

      // Восстанавливаем нижнюю панель анкеты, только если это анкета подразделения и панель была активна
      if(globalBar && target.state && target.state.appView === 'unit' && target.hasBar){
        globalBar.classList.remove('hidden');
        document.body.classList.add('has-bar');
      }
    }

    if(target.paneEl){
      target.paneEl.scrollTop = target.scroll || 0;
    }

    this.renderBar();

    if(typeof renderNav === 'function') renderNav();
    if(typeof updateTopPeriodBadge === 'function') updateTopPeriodBadge();
    this.saveSessionTabs();
  },

  closeTab: function(id, force){
    var tab = this.getTab(id);
    if(!tab) return;
    if(tab.key === 'home' && !force) return;
    if(tab.pinned && !force) return;
    var self = this;
    var isDirty = (this.activeId === id && S.dirty) || (tab.state && tab.state.dirty);

    function doClose(){
      if(tab.paneEl && tab.paneEl.parentNode){
        tab.paneEl.parentNode.removeChild(tab.paneEl);
      }
      self.tabs = self.tabs.filter(function(t){ return t.id !== id; });
      self.history = self.history.filter(function(hid){ return hid !== id; });

      // «Главная» всегда остаётся закреплённой в списке вкладок
      var homeTab = self.getTabByKey('home') || self.ensureHomeTab();

      if(self.activeId === id){
        if(self.history.length){
          var prevId = self.history[self.history.length - 1];
          self.activateTab(prevId);
        } else if(homeTab){
          self.activateTab(homeTab.id);
        } else if(self.tabs.length){
          self.activateTab(self.tabs[self.tabs.length - 1].id);
        }
      } else {
        self.renderBar();
        self.saveSessionTabs();
      }
    }

    if(isDirty && !force && typeof askDirty === 'function'){
      askDirty('Закрыть вкладку «' + tab.title + '»').then(function(yes){
        if(yes){
          if(self.activeId === id) S.dirty = false;
          doClose();
        }
      });
    } else {
      doClose();
    }
  },

  closeOtherTabs: function(id){
    var self = this;
    var toClose = this.tabs.filter(function(t){ return t.id !== id && !t.pinned; });
    toClose.forEach(function(t){ self.closeTab(t.id); });
  },

  closeTabsToRight: function(id){
    var self = this;
    var idx = -1;
    for(var i = 0; i < this.tabs.length; i++){
      if(this.tabs[i].id === id){ idx = i; break; }
    }
    if(idx < 0) return;
    var toClose = this.tabs.slice(idx + 1).filter(function(t){ return !t.pinned; });
    toClose.forEach(function(t){ self.closeTab(t.id); });
  },

  refreshTab: function(id){
    var tab = this.getTab(id);
    if(!tab || typeof tab.run !== 'function') return;
    var self = this;
    if(tab.state && tab.state.dirty && typeof askDirty === 'function'){
      askDirty('Обновить вкладку и сбросить черновик?').then(function(yes){
        if(yes){
          if(self.activeId === id) S.dirty = false;
          tab.state.dirty = false;
          tab.needsRefresh = false;
          self.activateTab(id);
          self.isInsideTabRun = true;
          try { tab.run(); } finally { self.isInsideTabRun = false; }
          if(typeof toast === 'function') toast('Вкладка обновлена', 'ok');
        }
      });
    } else {
      tab.needsRefresh = false;
      this.activateTab(id);
      this.isInsideTabRun = true;
      try { tab.run(); } finally { this.isInsideTabRun = false; }
      if(typeof toast === 'function') toast('Вкладка обновлена', 'ok');
    }
  },

  notifyDataChange: function(meta){
    meta = meta || {};
    this.handleDataChange(meta);
    if(this.syncChannel){
      try { this.syncChannel.postMessage({ type: 'datachange', meta: meta }); } catch(e){}
    }
  },

  handleDataChange: function(meta){
    var self = this;
    // Раньше здесь для каждой фоновой (не активной) вкладки временно
    // выставлялся self.activeId = t.id и синхронно вызывался t.run(), чтобы
    // «молча» освежить её данные. Это оказалось небезопасно: run() у вкладок
    // (openProgress, openAdminPanel и т.п.) не ограничивается своим paneEl —
    // он пишет в глобальные S.appView/S.unit, зовёт saveNavState()/renderTopNav(),
    // и главное — setTop() правит $('ttl') напрямую, а $('ttl')/$('bar') не
    // резолвятся по активной вкладке (в отличие от $('body')), это единственные
    // на страницу элементы. Поэтому фоновый рендер на мгновение перебивал
    // заголовок/нижнюю панель у вкладки, которую пользователь реально видит —
    // даже притом что activeId потом корректно восстанавливался в finally.
    // Теперь просто помечаем вкладку «нужно обновить» и ничего не рендерим:
    // activateTab() и так уже перерисует её свежими данными в момент, когда
    // пользователь на неё реально переключится (см. shouldRun там же).
    this.tabs.forEach(function(t){
      if(t.id === self.activeId) return;
      t.needsRefresh = true;
    });
  },

  openContextMenu: function(id, x, y){
    this.closeContextMenu();
    var tab = this.getTab(id);
    if(!tab) return;
    var self = this;

    var menu = document.createElement('div');
    menu.className = 'ws-tab-context-menu';
    menu.id = 'wsContextMenu';

    var items = [
      {
        icon: 'units',
        label: 'Дублировать вкладку',
        run: function(){ self.duplicateTab(id); }
      },
      {
        icon: 'refresh',
        label: 'Обновить данные',
        run: function(){ self.refreshTab(id); }
      }
    ];

    if(!tab.pinned){
      items.push({ sep: true });
      items.push({
        icon: 'close',
        label: 'Закрыть вкладку',
        danger: true,
        run: function(){ self.closeTab(id); }
      });
    }

    var unpinnedOtherCount = self.tabs.filter(function(t){ return t.id !== id && !t.pinned; }).length;
    if(unpinnedOtherCount > 0){
      if(!items.some(function(it){ return it.sep; })) items.push({ sep: true });
      items.push({
        label: 'Закрыть другие вкладки',
        run: function(){ self.closeOtherTabs(id); }
      });
      items.push({
        label: 'Закрыть вкладки справа',
        run: function(){ self.closeTabsToRight(id); }
      });
    }

    menu.innerHTML = items.map(function(it, idx){
      if(it.sep) return '<div class="ws-ctx-sep"></div>';
      var icHtml = it.icon && typeof icBare === 'function' ? '<span style="opacity:0.75;display:inline-flex">'+icBare(it.icon, 13)+'</span>' : '';
      return '<button type="button" class="ws-ctx-item ' + (it.danger ? 'danger' : '') + '" data-ctx-idx="' + idx + '">' +
        icHtml + '<span>' + esc(it.label) + '</span>' +
      '</button>';
    }).join('');

    menu.onclick = function(e){
      var btn = e.target.closest('[data-ctx-idx]');
      if(!btn) return;
      var item = items[parseInt(btn.dataset.ctxIdx, 10)];
      if(item && typeof item.run === 'function'){
        self.closeContextMenu();
        item.run();
      }
    };

    document.body.appendChild(menu);

    var mRect = menu.getBoundingClientRect();
    var posX = x;
    var posY = y;
    if(posX + mRect.width > window.innerWidth) posX = window.innerWidth - mRect.width - 8;
    if(posY + mRect.height > window.innerHeight) posY = window.innerHeight - mRect.height - 8;
    menu.style.left = Math.max(8, posX) + 'px';
    menu.style.top = Math.max(8, posY) + 'px';
  },

  closeContextMenu: function(){
    var m = document.getElementById('wsContextMenu');
    if(m && m.parentNode) m.parentNode.removeChild(m);
  },

  updateActiveTitle: function(title, icon, newKey){
    var cur = this.getTab(this.activeId);
    if(!cur) return;
    // Закреплённая вкладка «Главная» неприкосновенна: её нельзя переименовать или подменить ключ
    if(cur.key === 'home' || cur.id === 'tab_home' || cur.pinned) return;
    if(title) cur.title = title;
    if(icon) cur.icon = icon;
    if(newKey) cur.key = newKey;
    this.renderBar();
    this.saveSessionTabs();
  },

  renderBar: function(){
    var bar = document.getElementById('workspaceTabs');
    if(!bar) return;
    if(!this.tabs.length){
      bar.classList.add('hidden');
      document.documentElement.style.setProperty('--tabs-bar-h', '0px');
      return;
    }
    bar.classList.remove('hidden');
    document.documentElement.style.setProperty('--tabs-bar-h', '36px');

    var self = this;
    var html = this.tabs.map(function(t){
      var isActive = (t.id === self.activeId);
      var isDirty = (isActive && S.dirty) || (t.state && t.state.dirty);
      var isDraggable = !t.pinned;
      return '<div class="ws-tab ' + (isActive ? 'active ' : '') + (t.pinned ? 'pinned ' : '') + '" ' +
        'data-ws-id="' + esc(t.id) + '" ' +
        (isDraggable ? 'draggable="true" ' : '') +
        'title="' + esc(t.title) + (t.pinned ? ' (Закреплена)' : '') + '">' +
        '<span class="ws-tab-icon">' + (typeof icBare === 'function' ? icBare(t.icon, 13) : '') + '</span>' +
        '<span class="ws-tab-title">' + esc(t.title) + '</span>' +
        (isDirty ? '<span class="ws-tab-dirty" title="Несохранённые изменения"></span>' : '') +
        (!t.pinned ? '<button type="button" class="ws-tab-close" data-ws-close="' + esc(t.id) + '" title="Закрыть вкладку">' +
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>' +
        '</button>' : '') +
      '</div>';
    }).join('') +
    '<button type="button" id="btnWsNewTab" class="ws-tab-new" title="Дублировать текущую вкладку / Новая">+</button>';

    bar.innerHTML = html;

    var activeEl = bar.querySelector('.ws-tab.active');
    if(activeEl && typeof activeEl.scrollIntoView === 'function'){
      try { activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }); } catch(e){}
    }
  },

  saveSessionTabs: function(){
    try {
      if(!this.tabs || !this.tabs.length) return;
      var activeTab = this.getTab(this.activeId);
      var data = {
        activeKey: activeTab ? activeTab.key : 'home',
        tabs: this.tabs.map(function(t){
          var isHome = (t.key === 'home' || t.id === 'tab_home');
          return {
            key: isHome ? 'home' : t.key,
            title: isHome ? 'Главная' : t.title,
            icon: isHome ? 'home' : t.icon,
            pinned: isHome,
            state: t.state || {}
          };
        })
      };
      sessionStorage.setItem('farovon_ws_tabs', JSON.stringify(data));
    } catch(e){}
  },

  restoreSessionTabs: function(){
    try {
      var raw = sessionStorage.getItem('farovon_ws_tabs');
      if(!raw) return false;
      var data = JSON.parse(raw);
      if(!data || !Array.isArray(data.tabs) || !data.tabs.length) return false;

      var self = this;
      var cleanTabs = [];
      var seenKeys = {};
      var hasRealHome = false;

      data.tabs.forEach(function(tData){
        if(!tData || !tData.key) return;
        if(tData.key === 'home'){
          hasRealHome = true;
          cleanTabs.push({
            key: 'home',
            title: 'Главная',
            icon: 'home',
            pinned: true,
            state: { appView: 'home', unit: null }
          });
          seenKeys['home'] = true;
        } else {
          if(!seenKeys[tData.key]){
            seenKeys[tData.key] = true;
            cleanTabs.push({
              key: tData.key,
              title: tData.title,
              icon: tData.icon,
              pinned: false,
              state: tData.state || {}
            });
          }
        }
      });

      if(!hasRealHome){
        cleanTabs.unshift({
          key: 'home',
          title: 'Главная',
          icon: 'home',
          pinned: true,
          state: { appView: 'home', unit: null }
        });
      }

      cleanTabs.forEach(function(tData){
        var isHome = (tData.key === 'home');
        var runner = null;
        if(typeof self.resolveTabRunner === 'function'){
          runner = self.resolveTabRunner(tData);
        }
        self.openTab({
          key: tData.key,
          title: isHome ? 'Главная' : tData.title,
          icon: isHome ? 'home' : tData.icon,
          pinned: isHome,
          state: tData.state,
          run: runner
        });
      });

      var targetTab = (data.activeKey && self.getTabByKey(data.activeKey)) || self.getTabByKey('home');
      if(targetTab){
        self.activateTab(targetTab.id);
      }
      return true;
    } catch(e){
      return false;
    }
  }
};
window.WorkspaceTabs = WorkspaceTabs;

window.addEventListener('keydown', function(e){
  if((e.ctrlKey || e.metaKey) && (e.key === 'w' || e.key === 'W' || e.keyCode === 87)){
    var tag = document.activeElement ? document.activeElement.tagName : '';
    if(tag !== 'INPUT' && tag !== 'TEXTAREA'){
      if(window.WorkspaceTabs && WorkspaceTabs.activeId){
        var cur = WorkspaceTabs.getTab(WorkspaceTabs.activeId);
        if(cur && !cur.pinned && WorkspaceTabs.tabs.length > 1){
          e.preventDefault();
          WorkspaceTabs.closeTab(WorkspaceTabs.activeId);
        }
      }
    }
  }
});
/** Дата входа приходит с сервера сырым ISO-таймстампом — приводим к «ДД.ММ.ГГГГ ЧЧ:ММ». */
/**
 * Дата и время в часовом поясе Душанбе (UTC+5).
 *
 * База пишет CURRENT_TIMESTAMP, а это всегда UTC и в формате «2026-08-24
 * 19:10:51» — без «T» и без зоны. Прежняя проверка требовала ISO с «T»,
 * поэтому такие значения возвращались как есть: пользователь видел сырую
 * строку, да ещё и на пять часов раньше своего времени.
 *
 * Часовой пояс задан жёстко, а не берётся из браузера: обзор ведут из
 * Таджикистана, и запись, сделанная коллегой, должна называться одним и тем же
 * временем у всех, кто на неё смотрит.
 */
var TZ = 'Asia/Dushanbe';
function fmtDateTime(s){
  if(!s) return s;

  // Серийная дата Excel: 22 строки приехали из таблицы числом вида
  // 46254.529018368055 — это дни от 1899-12-30. В интерфейсе такое значение
  // показывалось как есть, прямо в колонке «Обновлено».
  if(typeof s === 'number' || /^\d{5}(\.\d+)?$/.test(String(s).trim())){
    var n = parseFloat(s);
    if(n > 20000 && n < 80000){
      var d0 = new Date(Math.round((n - 25569) * 86400 * 1000));
      if(!isNaN(d0.getTime())) return fmtDate_(d0);
    }
  }

  var iso;
  if(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)){
    // Наивную строку из базы помечаем как UTC явно — иначе браузер прочитает
    // её как местное время и сдвига не будет вовсе.
    iso = /[Zz]|[+\-]\d{2}:?\d{2}$/.test(s) ? s : s.replace(' ', 'T') + 'Z';
  } else {
    return s;
  }
  var d = new Date(iso);
  if(isNaN(d.getTime())) return s;
  return fmtDate_(d);
}

/** Приведение готового Date к виду «25.08.2026 00:15» по времени Душанбе. */
function fmtDate_(d){
  try {
    return d.toLocaleString('ru-RU', {
      timeZone: TZ, day:'2-digit', month:'2-digit', year:'numeric',
      hour:'2-digit', minute:'2-digit'
    }).replace(', ', ' ');
  } catch(e){
    return d.toLocaleDateString('ru-RU') + ' ' +
           d.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
  }
}

/** Приведение даты к виду «25.08.2026» по времени Душанбе. Принимает Date или строку/число. */
function fmtDateOnly(s){
  if(!s) return '';
  if(typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.trim())){
    var parts = s.trim().split('-');
    return parts[2] + '.' + parts[1] + '.' + parts[0];
  }
  var d = (s instanceof Date) ? s : new Date(s);
  if(isNaN(d.getTime())) return String(s);
  try {
    return d.toLocaleDateString('ru-RU', {
      timeZone: TZ, day:'2-digit', month:'2-digit', year:'numeric'
    });
  } catch(e){
    return d.toLocaleDateString('ru-RU');
  }
}

/** Клиент для работы с REST API сервера */
var API_ROUTES = {
  apiLogin: function(args){ return fetchJson('/api/auth/login', { method:'POST', body:{ login:args[0], password:args[1] } }); },
  apiLogout: function(){ return fetchJson('/api/auth/logout', { method:'POST' }); },
  apiResume: function(args){ return fetchJson('/api/auth/resume', { method:'GET', token:args[0] }); },
  apiRefresh: function(args){ return fetchJson('/api/auth/resume', { method:'GET', token:args[0] }); },
  apiChangePassword: function(args){ return fetchJson('/api/auth/change-password', { method:'POST', token:args[0], body:{ oldPassword:args[1], newPassword:args[2] } }); },
  apiChangeName: function(args){ return fetchJson('/api/auth/change-name', { method:'POST', token:args[0], body:{ fio:args[1] } }); },
  apiSetUnits: function(args){ return fetchJson('/api/auth/set-units', { method:'POST', token:args[0], body:{ units:args[1] } }); },
  apiMarkOnboarded: function(args){ return fetchJson('/api/auth/onboarded', { method:'POST', token:args[0] }); },
  apiTelegramLink: function(args){ return fetchJson('/api/telegram/link', { method:'POST', token:args[0] }); },
  // Публичный, без токена — нужен экрану входа до авторизации.
  apiTelegramBotInfo: function(){ return fetchJson('/api/telegram/bot-info', { method:'GET' }); },
  apiTelegramUnlink: function(args){ return fetchJson('/api/telegram/unlink', { method:'POST', token:args[0] }); },
  apiSave: function(args){ return fetchJson('/api/survey/save', { method:'POST', token:args[0], body:args[1] }); },
  apiSaveSurvey: function(args){ return fetchJson('/api/survey/save-details', { method:'POST', token:args[0], body:args[1] }); },
  apiSurveysForPeriod: function(args){ return fetchJson('/api/survey/for-period', { method:'POST', token:args[0], body:{ unit:args[1], periodId:args[2] } }); },
  // Position-first Шаг 1: чек-лист компаний по одной должности.
  apiPositionSelections: function(args){ return fetchJson('/api/survey/position-selections', { method:'POST', token:args[0], body:{ unit:args[1], periodId:args[2] } }); },
  apiSavePositionSelection: function(args){ return fetchJson('/api/survey/position-selection/save', { method:'POST', token:args[0], body:args[1] }); },
  apiPeriodGrantsPanel: function(args){ return fetchJson('/api/admin/period-grants', { method:'GET', token:args[0] }); },
  apiPeriodGrantUsers: function(args){ return fetchJson('/api/admin/period-grants/users', { method:'GET', token:args[0] }); },
  apiPeriodGrantCreate: function(args){ return fetchJson('/api/admin/period-grants', { method:'POST', token:args[0], body:{ userLogin:args[1], periodId:args[2] } }); },
  apiPeriodGrantRevoke: function(args){ return fetchJson('/api/admin/period-grants/revoke', { method:'POST', token:args[0], body:{ userLogin:args[1], periodId:args[2] } }); },
  apiPeriodDelete: function(args){ return fetchJson('/api/admin/periods/delete', { method:'POST', token:args[0], body:{ periodId:args[1] } }); },
  apiAddDictionary: function(args){ return fetchJson('/api/survey/dictionary/add', { method:'POST', token:args[0], body:{ block:args[1], name:args[2], segment:args[3], region:args[4] } }); },
  // Обе кнопки «+ Добавить» в пикере вызывали методы, которых в этой таблице
  // не было: call() отклонял промис ещё до сети, и пользователь видел «Нет
  // связи с сервером». Поэтому добавить своё значение было нельзя нигде —
  // ни должность, ни сегмент.
  apiAddPosition: function(args){ return fetchJson('/api/survey/dictionary/add', { method:'POST', token:args[0], body:{ block:'positions', unit:args[1], name:args[2] } }); },
  apiAddRefValue: function(args){ return fetchJson('/api/survey/dictionary/add', { method:'POST', token:args[0], body:{ block:args[1], name:args[2] } }); },
  apiDictList: function(args){ return fetchJson('/api/admin/dictionary/' + args[1], { method:'GET', token:args[0] }); },
  apiDictSave: function(args){ return fetchJson('/api/admin/dictionary/' + args[1], { method:'POST', token:args[0], body:args[2] }); },
  apiDictDelete: function(args){ return fetchJson('/api/admin/dictionary/' + args[1] + '/delete', { method:'POST', token:args[0], body:args[2] }); },
  apiCBDashboardExtended: function(args){ return fetchJson('/api/dashboard/extended', { method:'POST', token:args[0], body:args[1] }); },
  apiAuditExport: function(args){ return fetchJson('/api/audit/export', { method:'POST', token:args[0], body:args[1] }); },
  apiDashboard: function(args){ return fetchJson('/api/dashboard/hrbp', { method:'POST', token:args[0] }); },
  apiAdminGetUsers: function(args){ return fetchJson('/api/admin/users', { method:'GET', token:args[0] }); },
  apiAdminSaveUser: function(args){ return fetchJson('/api/admin/users', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminToggleUser: function(args){ return fetchJson('/api/admin/users/' + encodeURIComponent(args[1]) + '/toggle', { method:'POST', token:args[0], body:{ active:args[2] } }); },
  apiAdminResetPassword: function(args){ return fetchJson('/api/admin/users/' + encodeURIComponent(args[1]) + '/reset-password', { method:'POST', token:args[0] }); },
  apiAdminGetArchive: function(args){ return fetchJson('/api/admin/users-archive', { method:'GET', token:args[0] }); },
  apiAdminArchiveUser: function(args){ return fetchJson('/api/admin/users/' + encodeURIComponent(args[1]) + '/archive', { method:'POST', token:args[0] }); },
  apiAdminRestoreUser: function(args){ return fetchJson('/api/admin/users/' + encodeURIComponent(args[1]) + '/restore', { method:'POST', token:args[0] }); },
  apiAdminGetDivisions: function(args){ return fetchJson('/api/admin/divisions', { method:'GET', token:args[0] }); },
  apiAdminSaveDivision: function(args){ return fetchJson('/api/admin/divisions', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminCreateDivision: function(args){ return fetchJson('/api/admin/divisions/create', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminBatchAssignDivision: function(args){ return fetchJson('/api/admin/divisions/batch-assign', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminApplyAdjacentGroup: function(args){ return fetchJson('/api/admin/divisions/adjacent-group', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminClearAdjacentGroup: function(args){ return fetchJson('/api/admin/divisions/adjacent-group/clear', { method:'POST', token:args[0], body:{ key:args[1] } }); },
  apiAdminHideDivision: function(args){ return fetchJson('/api/admin/divisions/hide', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminDeleteDivision: function(args){ return fetchJson('/api/admin/divisions/delete', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminMoveDivision: function(args){ return fetchJson('/api/admin/divisions/move', { method:'POST', token:args[0], body:args[1] }); },
  // Анкеты оценки: чтение формулировок (раздел оценки) и их правка (админка).
  apiGradingBlocks: function(args){ return fetchJson('/api/grading/blocks', { method:'GET', token:args[0] }); },
  apiAdminGradingBlocks: function(args){ return fetchJson('/api/admin/grading-blocks', { method:'GET', token:args[0] }); },
  apiAdminGradingBlockPositions: function(args){
    var qs = '?block=' + encodeURIComponent(args[1] || '') + (args[2] ? '&q=' + encodeURIComponent(args[2]) : '');
    return fetchJson('/api/admin/grading-blocks/positions' + qs, { method:'GET', token:args[0] });
  },
  apiAdminGradingBlockReassign: function(args){ return fetchJson('/api/admin/grading-blocks/reassign', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminGradingCommittee: function(args){ return fetchJson('/api/admin/grading-committee?block=' + encodeURIComponent(args[1] || ''), { method:'GET', token:args[0] }); },
  apiAdminGradingCommitteeAdd: function(args){ return fetchJson('/api/admin/grading-committee/add', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminGradingCommitteeRemove: function(args){ return fetchJson('/api/admin/grading-committee/remove', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminGradingCommitteePending: function(args){ return fetchJson('/api/admin/grading-committee/pending?block=' + encodeURIComponent(args[1] || ''), { method:'GET', token:args[0] }); },
  apiAdminGradingCommitteeFinalize: function(args){ return fetchJson('/api/admin/grading-committee/finalize', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminGradingResetEvaluation: function(args){ return fetchJson('/api/admin/grading-blocks/reset-evaluation', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminGradingCommitteeBreakdown: function(args){ return fetchJson('/api/admin/grading-blocks/committee-breakdown?block=' + encodeURIComponent(args[1]) + '&job_title=' + encodeURIComponent(args[2]), { method:'GET', token:args[0] }); },
  apiAdminBroadcastRecipients: function(args){ return fetchJson('/api/admin/broadcasts/recipients', { method:'GET', token:args[0] }); },
  apiAdminBroadcasts: function(args){ return fetchJson('/api/admin/broadcasts', { method:'GET', token:args[0] }); },
  apiAdminBroadcast: function(args){ return fetchJson('/api/admin/broadcasts/' + encodeURIComponent(args[1]), { method:'GET', token:args[0] }); },
  apiAdminBroadcastSend: function(args){ return fetchJson('/api/admin/broadcasts/send', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminSupportThreads: function(args){
    var f = args[1] || {};
    var qs = Object.keys(f).filter(function(k){ return f[k]; }).map(function(k){ return encodeURIComponent(k)+'='+encodeURIComponent(f[k]); }).join('&');
    return fetchJson('/api/admin/support/threads' + (qs ? '?'+qs : ''), { method:'GET', token:args[0] });
  },
  apiAdminSupportThread: function(args){ return fetchJson('/api/admin/support/threads/' + encodeURIComponent(args[1]), { method:'GET', token:args[0] }); },
  apiAdminSupportReply: function(args){ return fetchJson('/api/admin/support/reply', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminSupportClose: function(args){ return fetchJson('/api/admin/support/close', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminSupportArchive: function(args){ return fetchJson('/api/admin/support/archive', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminSupportUnarchive: function(args){ return fetchJson('/api/admin/support/unarchive', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminSupportDelete: function(args){ return fetchJson('/api/admin/support/delete', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminSupportUnreadCount: function(args){ return fetchJson('/api/admin/support/unread-count', { method:'GET', token:args[0] }); },
  apiAdminSupportLinkEmployee: function(args){ return fetchJson('/api/admin/support/link-employee', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminSupportQuickReplies: function(args){ return fetchJson('/api/admin/support/quick-replies?audience='+encodeURIComponent(args[1] || 'admin'), { method:'GET', token:args[0] }); },
  apiAdminSupportSaveQuickReply: function(args){ return fetchJson('/api/admin/support/quick-replies', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminSupportDeleteQuickReply: function(args){ return fetchJson('/api/admin/support/quick-replies/delete', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminSupportSaveFaq: function(args){ return fetchJson('/api/admin/support/faq', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminSupportDeleteFaq: function(args){ return fetchJson('/api/admin/support/faq/delete', { method:'POST', token:args[0], body:args[1] }); },
  // «Поддержка» глазами сотрудника — своя переписка, не админский инбокс.
  apiMySupportThreads: function(args){ return fetchJson('/api/support/my/threads', { method:'GET', token:args[0] }); },
  apiMySupportThread: function(args){ return fetchJson('/api/support/my/threads/' + encodeURIComponent(args[1]), { method:'GET', token:args[0] }); },
  apiMySupportStart: function(args){ return fetchJson('/api/support/my/start', { method:'POST', token:args[0], body:args[1] }); },
  apiMySupportReply: function(args){ return fetchJson('/api/support/my/reply', { method:'POST', token:args[0], body:args[1] }); },
  apiMySupportUnreadCount: function(args){ return fetchJson('/api/support/my/unread-count', { method:'GET', token:args[0] }); },
  apiSupportFaq: function(args){ return fetchJson('/api/support/faq', { method:'GET', token:args[0] }); },
  apiGradingPositions: function(args){ return fetchJson('/api/grading/positions' + (args[1] ? '?block=' + encodeURIComponent(args[1]) : ''), { method:'GET', token:args[0] }); },
  apiGradingEvaluate: function(args){ return fetchJson('/api/grading/evaluate', { method:'POST', token:args[0], body:args[1] }); },
  apiGradingStats: function(args){ return fetchJson('/api/grading/stats', { method:'GET', token:args[0] }); },
  apiKeyRiskList: function(args){ return fetchJson('/api/key-personnel/list' + (args[1] ? '?unit=' + encodeURIComponent(args[1]) : ''), { method:'GET', token:args[0] }); },
  apiKeyRiskUnitEmployees: function(args){ return fetchJson('/api/key-personnel/unit-employees?unit=' + encodeURIComponent(args[1] || ''), { method:'GET', token:args[0] }); },
  apiKeyRiskEvaluate: function(args){ return fetchJson('/api/key-personnel/evaluate', { method:'POST', token:args[0], body:args[1] }); },
  apiKeyRiskDelete: function(args){ return fetchJson('/api/key-personnel/delete', { method:'POST', token:args[0], body:{ id:args[1] } }); },
  apiKeyRiskHeatmap: function(args){ return fetchJson('/api/key-personnel/heatmap', { method:'GET', token:args[0] }); },
  apiGradingFactors: function(args){ return fetchJson('/api/grading/factors' + (args[1] ? '?dir=' + encodeURIComponent(args[1]) : ''), { method:'GET', token:args[0] }); },
  apiGradingFactorSave: function(args){ return fetchJson('/api/admin/grading-factors', { method:'POST', token:args[0], body:args[1] }); },
  apiGradingFactorReset: function(args){ return fetchJson('/api/admin/grading-factors/reset', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminGetRoleCapabilities: function(args){ return fetchJson('/api/admin/role-capabilities', { method:'GET', token:args[0] }); },
  apiAdminSaveRoleCapabilities: function(args){ return fetchJson('/api/admin/role-capabilities', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminCreateRole: function(args){ return fetchJson('/api/admin/roles', { method:'POST', token:args[0], body:{ label:args[1] } }); },
  apiAdminRenameRole: function(args){ return fetchJson('/api/admin/roles/' + encodeURIComponent(args[1]) + '/rename', { method:'POST', token:args[0], body:{ label:args[2] } }); },
  apiAdminDeleteRole: function(args){ return fetchJson('/api/admin/roles/' + encodeURIComponent(args[1]) + '/delete', { method:'POST', token:args[0] }); },
  apiAdminGetUserCapabilities: function(args){ return fetchJson('/api/admin/user-capabilities', { method:'GET', token:args[0] }); },
  apiAdminSetUserCapabilities: function(args){ return fetchJson('/api/admin/user-capabilities', { method:'POST', token:args[0], body:{ userLogin:args[1], capabilities:args[2], denied:args[3] || [] } }); },
  apiSetPeriod: function(args){ return fetchJson('/api/admin/period', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminRunMaintenance: function(args){ return fetchJson('/api/admin/maintenance', { method:'POST', token:args[0], body:{ taskType:args[1] } }); },
  // Тот же эндпоинт с confirm: без него массовые задачи только считают объём.
  apiAdminRunMaintenanceConfirm: function(args){ return fetchJson('/api/admin/maintenance', { method:'POST', token:args[0], body:{ taskType:args[1], confirm:true } }); },
  apiAdminGetLocks: function(args){ return fetchJson('/api/admin/maintenance', { method:'POST', token:args[0], body:{ taskType:'get_locks' } }); },
  apiAdminCompanyUsage: function(args){ return fetchJson('/api/admin/maintenance', { method:'POST', token:args[0], body:{ taskType:'company_usage' } }); },
  // args: [token, keepName, mergeNamesArray]
  apiAdminMergeCompanies: function(args){ return fetchJson('/api/admin/maintenance', { method:'POST', token:args[0], body:{ taskType:'merge_companies', keep:args[1], merge:args[2] } }); },
  apiAdminPositionUsage: function(args){ return fetchJson('/api/admin/maintenance', { method:'POST', token:args[0], body:{ taskType:'position_usage' } }); },
  // args: [token, keepName, mergeNamesArray]
  apiAdminMergePositions: function(args){ return fetchJson('/api/admin/maintenance', { method:'POST', token:args[0], body:{ taskType:'merge_positions', keep:args[1], merge:args[2] } }); },
  // args: [token, 'companies'|'positions']
  apiAdminFindSimilarNames: function(args){ return fetchJson('/api/admin/maintenance', { method:'POST', token:args[0], body:{ taskType:'find_similar_names', kind:args[1] } }); },
  // Импорт файла опроса зарплат. args: [token, csvText, dryRun, dupAction]
  apiAdminImportSurvey: function(args){ return fetchJson('/api/admin/import-survey', { method:'POST', token:args[0], body:{ csv:args[1], dryRun:args[2], dupAction:args[3] } }); },
  // Импорт справочника сотрудников (выгрузка 1С). args: [token, csvText, dryRun]
  apiAdminImportStaffDirectory: function(args){ return fetchJson('/api/admin/import-staff-directory', { method:'POST', token:args[0], body:{ csv:args[1], dryRun:args[2] } }); },
  apiAdminStaffDirectoryList: function(args){ return fetchJson('/api/admin/staff-directory', { method:'GET', token:args[0] }); },
  // args: [token, {id, unit, fio, position}] — id пустой/undefined = создание новой записи
  apiAdminStaffDirectorySave: function(args){ return fetchJson('/api/admin/staff-directory', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminStaffDirectoryDelete: function(args){ return fetchJson('/api/admin/staff-directory/delete', { method:'POST', token:args[0], body:{ id:args[1] } }); },
  apiAdminUnlock: function(args){ return fetchJson('/api/admin/maintenance', { method:'POST', token:args[0], body:{ taskType:'unlock', targetOwner:args[1], targetRole:args[2] } }); },
  apiAdminDataStatus: function(args){ return fetchJson('/api/admin/data-status', { method:'GET', token:args[0] }); },
  apiAdminGetAuditLog: function(args){ return fetchJson('/api/admin/audit-log?limit=' + (args[1]||100), { method:'GET', token:args[0] }); },
  apiSendMassReminder: function(args){ return fetchJson('/api/admin/maintenance', { method:'POST', token:args[0], body:{ taskType:'mass_reminder' } }); },
  apiBenchmarkSources: function(args){ return fetchJson('/api/benchmarks/sources', { method:'GET', token:args[0] }); },
  apiBenchmarkSetPositionWeights: function(args){ return fetchJson('/api/benchmarks/position-weights', { method:'POST', token:args[0], body:{ positionId:args[1], weights:args[2] } }); },
  apiBenchmarkSetWeights: function(args){ return fetchJson('/api/benchmarks/sources/weights', { method:'POST', token:args[0], body:{ weights:args[1] } }); },
  apiBenchmarkFx: function(args){ return fetchJson('/api/benchmarks/fx?currency=' + encodeURIComponent(args[1] || 'TJS'), { method:'GET', token:args[0] }); },
  apiBenchmarkXlsxSheets: function(args){ return fetchJson('/api/benchmarks/import/xlsx-sheets', { method:'POST', token:args[0], body:{ fileBase64:args[1] } }); },
  apiBenchmarkXlsxGrid: function(args){ return fetchJson('/api/benchmarks/import/xlsx-grid', { method:'POST', token:args[0], body:{ fileBase64:args[1], sheet:args[2] } }); },
  apiBenchmarkUpdateSource: function(args){ return fetchJson('/api/benchmarks/source-update', { method:'POST', token:args[0], body:args[1] }); },
  apiBenchmarkCreateSource: function(args){ return fetchJson('/api/benchmarks/sources', { method:'POST', token:args[0], body:args[1] }); },
  apiBenchmarkDatasets: function(args){ return fetchJson('/api/benchmarks/datasets' + (args[1] ? '?sourceKey='+encodeURIComponent(args[1]) : ''), { method:'GET', token:args[0] }); },
  apiBenchmarkPositions: function(args){ return fetchJson('/api/benchmarks/positions/' + encodeURIComponent(args[1]), { method:'GET', token:args[0] }); },
  apiBenchmarkMappings: function(args){ return fetchJson('/api/benchmarks/mappings' + (args[1] ? '?sourceKey='+encodeURIComponent(args[1]) : ''), { method:'GET', token:args[0] }); },
  apiBenchmarkSuggestMappings: function(args){ return fetchJson('/api/benchmarks/suggest-mappings/' + encodeURIComponent(args[1]), { method:'GET', token:args[0] }); },
  apiBenchmarkSaveMapping: function(args){ return fetchJson('/api/benchmarks/mappings', { method:'POST', token:args[0], body:args[1] }); },
  apiBenchmarkDeleteMapping: function(args){ return fetchJson('/api/benchmarks/mappings/' + encodeURIComponent(args[1]) + '/delete', { method:'POST', token:args[0] }); },
  apiBenchmarkDryRun: function(args){ return fetchJson('/api/benchmarks/import/dry-run', { method:'POST', token:args[0], body:args[1] }); },
  apiBenchmarkCommit: function(args){ return fetchJson('/api/benchmarks/import/commit', { method:'POST', token:args[0], body:args[1] }); },
  apiBenchmarkCompare: function(args){ return fetchJson('/api/benchmarks/compare?' + (args[1] ? 'positionId='+encodeURIComponent(args[1])+'&' : '') + (args[2] ? 'positionName='+encodeURIComponent(args[2]) : ''), { method:'GET', token:args[0] }); },
  apiBenchmarkDeleteDataset: function(args){ return fetchJson('/api/benchmarks/datasets/' + encodeURIComponent(args[1]) + '/delete', { method:'POST', token:args[0] }); },
  apiBenchmarkSummaryWidgets: function(args){ return fetchJson('/api/benchmarks/summary-widgets', { method:'GET', token:args[0] }); }
};

var ERROR_MAP_RU = {
  'ACCESS_DENIED': 'Недостаточно прав доступа',
  'AUTH_REQUIRED': 'Требуется авторизация',
  'UNAUTHORIZED': 'Сессия истекла — войдите снова',
  'SESSION_EXPIRED': 'Сессия истекла — войдите снова',
  'TOKEN_EXPIRED': 'Сессия истекла — войдите снова',
  'USER_NOT_FOUND': 'Пользователь не найден',
  'USER_BLOCKED': 'Учетная запись заблокирована',
  'AUTH_INVALID': 'Сессия истекла или недействительна',
  'FORBIDDEN': 'Действие запрещено',
  'NOT_FOUND': 'Запись не найдена',
  'INVALID_CREDENTIALS': 'Неверный логин или пароль',
  'ACCOUNT_DEACTIVATED': 'Учётная запись отключена',
  'UNIT_LOCKED': 'Подразделение редактируется другим пользователем',
  'PERIOD_CLOSED': 'Период сбора данных закрыт',
  'NO_ACTIVE_PERIOD': 'Нет активного периода опроса',
  'SERVER_ERROR': 'Внутренняя ошибка сервера',
  'NETWORK_ERROR': 'Нет связи с сервером',
  'TIMEOUT': 'Превышено время ожидания ответа',
  'VALIDATION_FAILED': 'Проверьте правильность заполнения полей',
  'DUPLICATE_ENTRY': 'Такая запись уже существует'
};

function humanError(e){
  if(!e) return 'Произошла ошибка';
  if(typeof e === 'object'){
    e = e.message || e.error || e.msg || 'Ошибка';
  }
  var s = String(e).trim();
  if(ERROR_MAP_RU[s]) return ERROR_MAP_RU[s];
  var upper = s.toUpperCase();
  if(ERROR_MAP_RU[upper]) return ERROR_MAP_RU[upper];
  return s;
}

// ── Индикатор «идёт действие» ──────────────────────────────────────────────
// Раньше нажатие кнопки не давало никакой обратной связи, пока не придёт
// ответ сервера (0.2-1.5с) — человек не понимал, сработал ли клик, и часто
// жал повторно. Вместо того чтобы вручную городить disabled/спиннер в каждом
// из сотен обработчиков кнопок, вешаем один индикатор на сетевой уровень:
// каждый POST/PUT (то есть любое действие, которое что-то меняет — GET-чтения
// уже покрыты скелетон-заглушками, см. «СКЕЛЕТОНЫ ЗАГРУЗКИ» ниже) на время
// запроса показывает крутилку по центру экрана, зафиксированную относительно
// окна (не относительно прокрутки страницы). Небольшая задержка перед показом
// не даёт крутилке мелькать на мгновенных ответах.
var busyCount = 0, busyShowTimer = null, busyEl = null;
function busyStart(){
  busyCount++;
  if(busyCount === 1 && !busyShowTimer){
    busyShowTimer = setTimeout(function(){
      busyShowTimer = null;
      if(busyCount <= 0) return;
      if(!busyEl){
        busyEl = document.createElement('div');
        busyEl.className = 'global-busy';
        busyEl.innerHTML = '<span class="global-busy-spin"></span>';
        document.body.appendChild(busyEl);
      }
      busyEl.classList.add('on');
    }, 180);
  }
}
function busyEnd(){
  busyCount = Math.max(0, busyCount - 1);
  if(busyCount === 0){
    if(busyShowTimer){ clearTimeout(busyShowTimer); busyShowTimer = null; }
    if(busyEl) busyEl.classList.remove('on');
  }
}

// Двойная отправка токена (CSRF) — см. src/middleware/csrf.js. Кука
// farovon_csrf не httpOnly специально: её должен прочитать этот код и
// вернуть тем же значением в заголовке. Проверяется только для запросов
// по куке сессии — если есть Authorization (Mini App), сервер её не
// требует, но послать не вредно.
function readCsrfCookie(){
  var m = /(?:^|;\s*)farovon_csrf=([^;]+)/.exec(document.cookie || '');
  return m ? decodeURIComponent(m[1]) : null;
}

function fetchJson(url, opts){
  opts = opts || {};
  var headers = { 'Content-Type': 'application/json' };
  if(opts.token) headers['Authorization'] = 'Bearer ' + opts.token;
  var conf = {
    method: opts.method || 'GET',
    headers: headers,
    // #22 — 'include': в браузере (одно происхождение) приложит httpOnly-куку
    // сессии; в Telegram Mini App (фрейм web.telegram.org, другое
    // происхождение) попытается приложить её же — сервер отвечает
    // Access-Control-Allow-Credentials. Если браузер режет стороннюю куку —
    // работает запасной путь: opts.token в заголовке Authorization.
    credentials: 'include'
  };
  var isMutating = (conf.method === 'POST' || conf.method === 'PUT');
  if(isMutating){
    var csrfToken = readCsrfCookie();
    if(csrfToken) headers['X-CSRF-Token'] = csrfToken;
  }
  if(opts.body && isMutating) {
    conf.body = JSON.stringify(opts.body);
  }
  if(isMutating) busyStart();
  return fetch(url, conf).then(function(res){
    return res.json().then(function(data){
      if(!res.ok && data){
        if(data.message) data.error = humanError(data.message);
        else if(data.error) data.error = humanError(data.error);
      }
      return data;
    }).catch(function(){
      return { ok: false, error: 'Ошибка ответа сервера' };
    });
  }).finally(function(){
    if(isMutating) busyEnd();
  });
}

var MUTATING_API_ACTIONS = [
  'apiSave', 'apiSaveSurvey', 'apiSavePositionSelection', 'apiDictSave', 'apiDictDelete',
  'apiAdminSaveUser', 'apiAdminToggleUser', 'apiAdminResetPassword',
  'apiAdminArchiveUser', 'apiAdminRestoreUser', 'apiAdminSaveDivision',
  'apiAdminCreateDivision', 'apiAdminBatchAssignDivision',
  'apiAdminApplyAdjacentGroup', 'apiAdminClearAdjacentGroup',
  'apiAdminMoveDivision', 'apiAdminSaveRoleCapabilities',
  'apiGradingFactorSave', 'apiGradingFactorReset', 'apiGradingEvaluate', 'apiKeyRiskEvaluate', 'apiKeyRiskDelete',
  'apiAdminSupportArchive', 'apiAdminSupportUnarchive', 'apiAdminSupportDelete',
  'apiAdminGradingBlockReassign', 'apiAdminGradingCommitteeAdd', 'apiAdminGradingCommitteeRemove',
  'apiAdminGradingCommitteeFinalize',
  'apiAdminCreateRole', 'apiAdminRenameRole', 'apiAdminDeleteRole',
  'apiAdminSetUserCapabilities',
  'apiSetPeriod', 'apiPeriodGrantCreate', 'apiPeriodGrantRevoke'
];

function call(fn){
  var args = [].slice.call(arguments, 1);
  if(!API_ROUTES[fn]) return Promise.reject(new Error('Неизвестный метод: ' + fn));
  var resPromise = API_ROUTES[fn](args);
  if(MUTATING_API_ACTIONS.indexOf(fn) >= 0){
    return resPromise.then(function(res){
      if(res && res.ok !== false){
        if(window.WorkspaceTabs && WorkspaceTabs.notifyDataChange){
          WorkspaceTabs.notifyDataChange({ action: fn, args: args });
        }
      }
      return res;
    });
  }
  return resPromise;
}

var toastSeq = 0;
/**
 * Неблокирующая очередь уведомлений. В отличие от старого одиночного toast,
 * быстрые последовательные действия больше не затирают предыдущий результат.
 * opts.action оставлен для безопасных локальных действий (например «Повторить»).
 */
function toast(msg, kind, opts){
  if(msg){
    msg = humanError(msg);
    if(typeof msg === 'string'){
      msg = msg.replace(/\b([A-Z_]{3,})\b/g, function(match){
        return ERROR_MAP_RU[match] || match;
      });
    }
  }
  opts = opts || {};
  var host = document.querySelector('.toast-stack');
  if(!host){
    host = document.createElement('div');
    host.className = 'toast-stack';
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('aria-relevant', 'additions');
    document.body.appendChild(host);
  }
  var isError = kind === 'no' || kind === 'err' || kind === 'error';
  while(host.children.length >= 3){ host.removeChild(host.firstElementChild); }
  var isWarn = kind === 'warn';
  var t = document.createElement('div');
  t.className = 'toast' + (kind === 'ok' ? ' t-ok' : isError ? ' t-no' : isWarn ? ' t-warn' : '');
  t.id = 'toast_' + (++toastSeq);
  t.setAttribute('role', (isError || isWarn) ? 'alert' : 'status');
  var mark = kind === 'ok' ? 'check' : (kind === 'no' || kind === 'err' || kind === 'error') ? 'close' : isWarn ? 'warn' : 'info';
  t.innerHTML = '<span class="toast-ic">'+icBare(mark, 16)+'</span>'+
    '<span class="toast-msg">'+esc(msg)+'</span>'+
    (opts.action ? '<button class="toast-action" type="button">'+esc(opts.action.label)+'</button>' : '')+
    '<button class="toast-close" type="button" aria-label="Закрыть уведомление">'+icBare('close',14)+'</button>';
  host.appendChild(t);
  var close = function(){
    if(!t.parentNode) return;
    t.classList.add('is-leaving');
    setTimeout(function(){ if(t.parentNode) t.remove(); }, 140);
  };
  t.querySelector('.toast-close').onclick = close;
  if(opts.action){
    t.querySelector('.toast-action').onclick = function(){ close(); opts.action.run(); };
  }
  var duration = opts.duration == null ? (isError ? 5000 : kind === 'ok' ? 3400 : 4000) : opts.duration;
  if(duration > 0){ setTimeout(close, duration); }
}

/**
 * Единая горячая клавиша Esc для всех модалок.
 * Раньше Esc был только внутри ask()/askText() — карточки конкурента, анкеты,
 * пикера, помощи, профиля закрывались лишь мышкой по «Закрыть».
 * Слушатель один на документ: закрывает самую верхнюю открытую панель, чтобы
 * из пикера поверх анкеты Esc возвращал в анкету, а не схлопывал обе.
 * Собственные обработчики ask/askText вызываются раньше (они на capture) и
 * снимают своё окно сами — здесь ловим только то, что до сюда дошло.
 */
document.addEventListener('keydown', function(e){
  if(e.key !== 'Escape') return;
  var panes = document.querySelectorAll('.sheet, .menu-scrim');
  if(panes.length > 0){
    var top = panes[panes.length - 1];
    // sheet--dialog (ask/askText) управляет своим закрытием сам через собственный capture-listener
    if(top.classList.contains('sheet--dialog')) return;
    e.preventDefault();
    var x = top.querySelector('[data-x]');
    if(x) x.click(); else top.remove();
    return;
  }
  // Если модалок нет, но фокус в поле поиска — сбрасываем фокус
  var activeInp = document.activeElement;
  if(activeInp && (activeInp.tagName === 'INPUT' || activeInp.tagName === 'TEXTAREA')){
    activeInp.blur();
  }
}, false);

/**
 * Шаг назад внутри экрана: аппаратная кнопка «назад» на телефоне, жест
 * «смахнуть от края» и кнопка «назад» браузера закрывают верхнюю открытую
 * карточку (лист, диалог, меню), а не уводят из приложения. Раньше любая
 * такая карточка закрывалась только крестиком или клавишей Escape — на
 * телефоне ни того, ни другого под рукой нет.
 *
 * Механика: пока хоть что-то открыто, под это в историю положена одна
 * запись-заглушка. Нажали «назад» — браузер её снимает, мы в ответ закрываем
 * верхний слой; если под ним есть ещё один, заглушка кладётся снова. Закрыли
 * крестиком — снимаем заглушку сами, чтобы история не копилась и следующее
 * «назад» не срабатывало вхолостую.
 */
var OVERLAY_SEL = '.sheet, .menu-scrim';
var ovArmed = false;   // лежит ли наша запись в истории
var ovSkipPop = 0;     // popstate от нашего же history.go(-1) — пропустить

function overlayNodes(){ return document.querySelectorAll(OVERLAY_SEL); }

function syncOverlayHistory(){
  var open = overlayNodes().length > 0;
  if(open && !ovArmed){
    ovArmed = true;
    try { history.pushState({ fvOverlay: true }, ''); } catch(e){ ovArmed = false; }
  } else if(!open && ovArmed){
    ovArmed = false;
    ovSkipPop++;
    try { history.go(-1); } catch(e){ ovSkipPop--; }
  }
}

/** Закрывает карточку её же кнопкой — иначе промис ask()/askText() так и
 *  останется висеть, и код, который ждёт ответа, не продолжится. */
function closeOverlayNode(node){
  var btn = node.querySelector('[data-x]') || node.querySelector('[data-v="0"]');
  if(btn) btn.click(); else node.remove();
}

if(window.MutationObserver){
  new MutationObserver(function(){ syncOverlayHistory(); })
    .observe(document.body, { childList: true });
}

window.addEventListener('popstate', function(){
  if(ovSkipPop > 0){ ovSkipPop--; return; }
  var nodes = overlayNodes();
  if(!nodes.length) return;      // ничего не открыто — обычное поведение браузера
  ovArmed = false;               // запись уже снята самим браузером
  closeOverlayNode(nodes[nodes.length - 1]);
  // Остались другие слои — наблюдатель положит заглушку обратно.
});

/** Иконка в .search-wrap стоит справа и кликабельна — просто фокусирует поле рядом. */
document.addEventListener('click', function(e){
  var icon = e.target.closest('.search-wrap svg');
  if(!icon) return;
  var input = icon.parentElement.querySelector('input');
  if(input) input.focus();
});

/**
 * Внутреннее окно подтверждения вместо confirm().
 * Браузерное показывает домен googleusercontent.com и читается как
 * предупреждение чужого сайта — половина людей на нём останавливается.
 * Возвращает промис: true — согласились, false — отменили.
 *
 * opts = { title, html, ok, cancel, danger }
 */
function ask(opts){
  return new Promise(function(resolve){
    var el = document.createElement('div');
    el.className = 'sheet sheet--dialog';
    el.innerHTML = '<div class="sheet-in dlg">'+
      '<b class="dlg-t">'+esc(opts.title || 'Подтвердите')+'</b>'+
      '<p class="dlg-x">'+(opts.html || '')+'</p>'+
      '<div class="dlg-a">'+
        '<button type="button" data-v="0">'+esc(opts.cancel || 'Отмена')+'</button>'+
        '<button type="button" data-v="1" class="dlg-go '+
          (opts.danger ? 'btn-danger' : 'btn-primary')+'">'+
          esc(opts.ok || 'Продолжить')+'</button>'+
      '</div></div>';
    document.body.appendChild(el);

    var done = function(v){
      if(!el.parentNode) return;
      document.removeEventListener('keydown', onKey, true);
      el.remove();
      resolve(v);
    };
    var onKey = function(e){
      if(e.key === 'Escape'){ e.preventDefault(); done(false); }
      else if(e.key === 'Enter'){ e.preventDefault(); done(true); }
    };
    document.addEventListener('keydown', onKey, true);
    el.addEventListener('click', function(e){
      if(e.target === el){ done(false); return; }
      var b = e.target.closest('button[data-v]');
      if(b) done(b.dataset.v === '1');
    });
    // на телефоне фокус не ставим: он вызывает подсветку и подпрыгивание экрана
    if(window.innerWidth >= 640){
      setTimeout(function(){ try{ el.querySelector('.dlg-go').focus(); }catch(e){} }, 40);
    }
  });
}

/**
 * То же вместо prompt(). Возвращает строку либо null, если отменили.
 * opts = { title, html, value, placeholder, ok }
 */
function askText(opts){
  return new Promise(function(resolve){
    var el = document.createElement('div');
    el.className = 'sheet sheet--dialog';
    el.innerHTML = '<div class="sheet-in dlg">'+
      '<b class="dlg-t">'+esc(opts.title || '')+'</b>'+
      (opts.html ? '<p class="dlg-x">'+opts.html+'</p>' : '<div style="height:12px"></div>')+
      '<input class="dlg-in" id="dlgIn" value="'+esc(opts.value || '')+'" '+
        'placeholder="'+esc(opts.placeholder || '')+'">'+
      '<div class="dlg-a">'+
        '<button type="button" data-v="0">Отмена</button>'+
        '<button type="button" data-v="1" class="btn-primary">'+esc(opts.ok || 'Готово')+'</button>'+
      '</div></div>';
    document.body.appendChild(el);

    var inp = el.querySelector('#dlgIn');
    var done = function(v){
      if(!el.parentNode) return;
      document.removeEventListener('keydown', onKey, true);
      el.remove();
      resolve(v);
    };
    var onKey = function(e){
      if(e.key === 'Escape'){ e.preventDefault(); done(null); }
      else if(e.key === 'Enter'){ e.preventDefault(); done(inp.value.trim()); }
    };
    document.addEventListener('keydown', onKey, true);
    el.addEventListener('click', function(e){
      if(e.target === el){ done(null); return; }
      var b = e.target.closest('button[data-v]');
      if(b) done(b.dataset.v === '1' ? inp.value.trim() : null);
    });
    setTimeout(function(){ try{ inp.focus(); inp.select(); }catch(e){} }, 60);
  });
}

/**
 * Диалог открытия/правки периода сбора: название + даты (+ статус, если
 * showState). Тот же паттерн модалки, что у ask()/askText() выше.
 * opts = { title, html, value (название), from, to, placeholder, state,
 *          showState, ok }
 * Возвращает { name, from, to, state } либо null, если отменили.
 */
function askPeriodDates(opts){
  return new Promise(function(resolve){
    var el = document.createElement('div');
    el.className = 'sheet sheet--dialog';
    el.innerHTML = '<div class="sheet-in dlg">'+
      '<b class="dlg-t">'+esc(opts.title || '')+'</b>'+
      (opts.html ? '<p class="dlg-x">'+opts.html+'</p>' : '<div style="height:12px"></div>')+
      '<label class="lbl">Название периода</label>'+
      '<input class="dlg-in" id="dlgPName" value="'+esc(opts.value || '')+'" '+
        'placeholder="'+esc(opts.placeholder || 'Название периода')+'" maxlength="200">'+
      '<div style="display:flex;gap:8px;margin-top:8px">'+
        '<div style="flex:1"><label class="lbl">Дата начала</label>'+
          '<input type="date" class="dlg-in" id="dlgPFrom" value="'+esc(opts.from || '')+'"></div>'+
        '<div style="flex:1"><label class="lbl">Дата окончания</label>'+
          '<input type="date" class="dlg-in" id="dlgPTo" value="'+esc(opts.to || '')+'"></div>'+
      '</div>'+
      (opts.showState
        ? '<label class="lbl">Статус</label>'+
          '<select class="dlg-in" id="dlgPState">'+
            '<option value="открыт"'+(opts.state !== 'закрыт' ? ' selected' : '')+'>Открыт</option>'+
            '<option value="закрыт"'+(opts.state === 'закрыт' ? ' selected' : '')+'>Закрыт</option>'+
          '</select>'
        : '')+
      '<div class="dlg-a">'+
        '<button type="button" data-v="0">Отмена</button>'+
        '<button type="button" data-v="1" class="btn-primary">'+esc(opts.ok || 'Готово')+'</button>'+
      '</div></div>';
    document.body.appendChild(el);

    var nameInp = el.querySelector('#dlgPName');
    var fromInp = el.querySelector('#dlgPFrom');
    var toInp = el.querySelector('#dlgPTo');
    var stateSel = el.querySelector('#dlgPState');

    var collect = function(){
      return {
        name: nameInp.value.trim(),
        from: fromInp.value || '',
        to: toInp.value || '',
        state: stateSel ? stateSel.value : undefined
      };
    };

    var done = function(v){
      if(!el.parentNode) return;
      document.removeEventListener('keydown', onKey, true);
      el.remove();
      resolve(v);
    };
    var onKey = function(e){
      if(e.key === 'Escape'){ e.preventDefault(); done(null); }
      else if(e.key === 'Enter' && e.target.tagName !== 'SELECT'){ e.preventDefault(); done(collect()); }
    };
    document.addEventListener('keydown', onKey, true);
    el.addEventListener('click', function(e){
      if(e.target === el){ done(null); return; }
      var b = e.target.closest('button[data-v]');
      if(b) done(b.dataset.v === '1' ? collect() : null);
    });
    setTimeout(function(){ try{ nameInp.focus(); nameInp.select(); }catch(e){} }, 60);
  });
}

/** Короткая обёртка: «есть несохранённые правки — продолжить?». */
function askDirty(action){
  return ask({
    title: 'Есть несохранённые правки',
    html: 'Изменения по этому подразделению ещё не отправлены в таблицу. ' +
          'Если продолжить, они пропадут.',
    ok: action,
    cancel: 'Остаться',
    danger: true
  });
}

/** Тот же вопрос, что askDirty, но для карточек/модалок общего вида (не анкеты подразделения). */
function confirmDiscard(){
  return ask({
    title: 'Есть несохранённые изменения',
    html: 'Введённые данные не сохранены. Закрыть без сохранения?',
    ok: 'Закрыть без сохранения',
    cancel: 'Остаться',
    danger: true
  });
}

/**
 * Общая защита закрытия карточки (сheet) с несохранёнными данными: закрытие
 * по фону/«Закрыть»/Esc спрашивает подтверждение, если isDirty() вернёт true.
 * Esc уже устроен так, что кликает по [data-x] (см. глобальный keydown выше),
 * поэтому один обработчик здесь закрывает и клик, и Esc, и клик по фону.
 */
function guardClose(el, isDirty){
  el.addEventListener('click', function(e){
    if(e.target !== el && !e.target.dataset.x) return;
    if(!isDirty()){ el.remove(); return; }
    confirmDiscard().then(function(yes){ if(yes) el.remove(); });
  });
}

function show(scr){
  $('scrLogin').classList.toggle('hidden', scr!=='login');
  $('scrLoad').classList.toggle('hidden', scr!=='load');
  $('app').classList.toggle('hidden', scr!=='app');
}

/**
 * Набор кнопок-переключателей.
 * multi=true — можно выбрать несколько; req=true — снять выбор нельзя (обязательное поле).
 * subMap — необязательная подпись мелким шрифтом под чипом (например, часы
 * графика: «5/2 · 40 часов» → «08:00–17:00»), ключ — то же значение из list.
 */
function chips(act, list, value, multi, req, subMap){
  var sel = multi ? (value||[]) : [value];
  return '<div class="chips" data-chips="'+act+'"'+(multi?' data-multi="1"':'')+
         (req?' data-req="1"':'')+'>' +
    list.map(function(v){
      var on = sel.indexOf(v) >= 0;
      var sub = subMap && subMap[v];
      var cls = (on ? 'on' : '') + (sub ? ' chip--sub' : '');
      return '<button type="button" data-act="'+act+'" data-v="'+esc(v)+'"'+(cls?' class="'+cls.trim()+'"':'')+'>'+
        esc(v)+(sub ? '<span class="chip-sub">'+esc(sub)+'</span>' : '')+
      '</button>';
    }).join('') + '</div>';
}

/**
 * Мультивыбор льгот, разложенный по разделам: [{category, items:[...]}].
 * Каждый чип несёт data-act="benefits" — тот же обработчик и та же логика
 * снятия/добавления, что у обычного chips(); контейнер помечен
 * data-chips="benefits", чтобы кнопка «Стандартный набор» находила чипы.
 * Сохраняемое значение — плоский список выбранных строк.
 */
function benefitChips(groups, value){
  var sel = value || [];
  return '<div class="chips bx-benefits" data-chips="benefits" data-multi="1">' +
    groups.map(function(g){
      return (g.category ? '<div class="bx-ben-cat">'+esc(g.category)+'</div>' : '') +
        (g.items || []).map(function(v){
          var on = sel.indexOf(v) >= 0;
          return '<button type="button" data-act="benefits" data-v="'+esc(v)+'"'+(on?' class="on"':'')+'>'+esc(v)+'</button>';
        }).join('');
    }).join('') + '</div>';
}

/**
 * Льготы: выпадающий список с галочками. Самые частые (pinned — STD_BENEFITS
 * без ДМС) закреплены сверху, ниже — весь справочник по разделам, в конце —
 * «Другое» со свободным вводом. Введённое там значение сохраняется прямо в
 * записи анкеты (item.benefits) как новая льгота — в общий справочник не
 * попадает, но в таблице/«Параметрах» отображается, т.к. рендерится из записи.
 * Контейнер несёт data-bd; сохраняемое значение — плоский список выбранных строк.
 */
function benefitDropdown(value, groups, pinned){
  var sel = value || [];
  pinned = pinned || [];
  var pinnedSet = {}; pinned.forEach(function(b){ pinnedSet[b] = 1; });
  var dictSet = {};
  (groups || []).forEach(function(g){ (g.items || []).forEach(function(it){ dictSet[it] = 1; }); });

  function optRow(v){
    var on = sel.indexOf(v) >= 0;
    return '<label class="bx-bd-opt'+(on ? ' on' : '')+'">'+
      '<input type="checkbox" data-act="bd-opt" data-v="'+esc(v)+'"'+(on ? ' checked' : '')+'>'+
      '<span>'+esc(v)+'</span></label>';
  }

  var sumTxt = sel.length
    ? sel.length + ' ' + declOfNum(sel.length, ['льгота', 'льготы', 'льгот']) + ' выбрано'
    : 'Выберите льготы';

  var html = '<div class="bx-bd" data-bd="1">'+
    '<button type="button" class="bx-bd-trigger" data-act="bd-toggle">'+
      '<span class="bx-bd-sum'+(sel.length ? '' : ' ph')+'">'+esc(sumTxt)+'</span>'+
      icBare('chevron', 13)+
    '</button>'+
    '<div class="bx-bd-panel hidden">';

  if(pinned.length){
    html += '<div class="bx-bd-grp">Часто выбирают</div>' + pinned.map(optRow).join('');
  }
  (groups || []).forEach(function(g){
    var items = (g.items || []).filter(function(it){ return !pinnedSet[it]; });
    if(!items.length) return;
    html += '<div class="bx-bd-grp">'+esc(g.category || 'Прочее')+'</div>' + items.map(optRow).join('');
  });
  var custom = sel.filter(function(v){ return !pinnedSet[v] && !dictSet[v]; });
  if(custom.length){
    html += '<div class="bx-bd-grp">Добавленные</div>' + custom.map(optRow).join('');
  }

  html += '<div class="bx-bd-other">'+
      '<input type="text" class="bx-bd-other-inp" placeholder="Другое — своя льгота" maxlength="80">'+
      '<button type="button" class="btn-line" data-act="bd-other-add">'+icBare('plus', 12)+' Добавить</button>'+
    '</div>'+
  '</div></div>';
  return html;
}

/**
 * Экран выбора значения из справочника: поиск + строгий список.
 * Свободного ввода нет — иначе одна и та же должность попадает в таблицу
 * в пяти написаниях. Если нужного значения нет, его добавляют кнопкой внизу,
 * и оно сразу появляется у всех остальных.
 *
 * opts = { title, block, list, value, placeholder, onPick,
 *          wide: [полный список], wideLabel, addUnit }
 * wide — второй список «по всему холдингу». Нужен должностям: у руководителя
 * показывается штатка его подразделения, но иногда должность лежит шире.
 */
/**
 * Подгоняет высоту длинных таблиц под остаток экрана.
 *
 * В CSS это не выражается: у каждого экрана своя шапка (у сводки — период и
 * итоги, у админки — два ряда вкладок и панель, у дашборда — ещё и фильтры),
 * поэтому любое фиксированное `calc(100vh - N)` на одних экранах оставляет
 * пустоту, а на других выталкивает низ таблицы за край. Считаем от реального
 * положения элемента.
 *
 * Вызывается сам — через наблюдатель за перерисовками, чтобы не зависеть от
 * того, вспомнили ли о нём в каждой из десяти render-функций.
 */
function fitTables(){
  // Высота таблиц теперь на 100% управляется аппаратным CSS Flexbox (.tblwrap--page { flex: 1 1 auto; min-height: 0; })
}

// ─── Поколоночный фильтр таблиц ─────────────────────────────────────────────
// Под шапкой каждой таблицы .co-tbl добавляется строка с полем на столбец.
// Текст — подстрока; числовые столбцы (.num) понимают >N <N >=N <=N =N и N-M.
// Значения переживают пересортировку/перерисовку: ключ — состав заголовков.
var _tblFiltState = {};

function _tfNorm(s){ return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase(); }

function _tfMatch(cellText, q, isNum){
  q = String(q || '').trim();
  if(!q) return true;
  if(isNum){
    var n = parseFloat(String(cellText).replace(/[^\d.,\-]/g, '').replace(/\s| /g, '').replace(',', '.'));
    var m = q.match(/^(>=|<=|>|<|=)\s*(-?[\d.]+)$/);
    if(m){
      if(isNaN(n)) return false;
      var v = parseFloat(m[2]);
      return m[1] === '>' ? n > v : m[1] === '<' ? n < v :
             m[1] === '>=' ? n >= v : m[1] === '<=' ? n <= v : n === v;
    }
    m = q.match(/^(-?[\d.]+)\s*[-–—]\s*(-?[\d.]+)$/);
    if(m){
      if(isNaN(n)) return false;
      var a = parseFloat(m[1]), b = parseFloat(m[2]);
      return n >= Math.min(a, b) && n <= Math.max(a, b);
    }
  }
  return _tfNorm(cellText).indexOf(_tfNorm(q)) >= 0;
}

function _tfSig(headRow){
  return [].map.call(headRow.cells, function(th){
    return _tfNorm(th.textContent).replace(/[▲▼△▽↑↓]/g, '').trim();
  }).join('¦');
}

function enhanceTableFilters(root){
  var tables = (root || document).querySelectorAll('table.co-tbl:not(.no-filt)');
  [].forEach.call(tables, function(table){
    if(table.dataset.tfDone) return;
    var thead = table.tHead, tbody = table.tBodies[0];
    if(!thead || !tbody || !thead.rows.length) return;
    var hrow = thead.rows[thead.rows.length - 1];
    if(hrow.cells.length < 2) { table.dataset.tfDone = '1'; return; }

    var isRealRow = function(r){ return !(r.cells.length === 1 && (r.cells[0].colSpan || 1) > 1); };
    var dataRows = [].filter.call(tbody.rows, isRealRow);
    if(dataRows.length < 2){ return; } // ещё догрузится / пусто — вернёмся позже

    table.dataset.tfDone = '1';
    var cols = hrow.cells.length;
    var sig = _tfSig(hrow);
    var saved = _tblFiltState[sig] || [];

    var fr = document.createElement('tr');
    fr.className = 'tbl-filt';
    for(var i = 0; i < cols; i++){
      var th = hrow.cells[i];
      var label = _tfNorm(th.textContent);
      // числовой столбец: помечен .num ИЛИ все непустые ячейки — числа
      var colTexts = dataRows.map(function(r){ return (r.cells[i] ? r.cells[i].textContent : '').trim(); });
      var nonEmpty = colTexts.filter(Boolean);
      var isNum = th.classList.contains('num') || (nonEmpty.length > 0 && nonEmpty.every(function(t){
        return /^[−-]?\d+([\s .,]\d+)*\s*%?$/.test(t) || /^[−-]?\d*[.,]?\d+\s*(c|сом\.?|₽|\$|%)?$/i.test(t);
      }));
      var noText = dataRows.every(function(r){
        var c = r.cells[i];
        return c && !c.textContent.trim() && c.querySelector('button,a,svg,input,label');
      });
      var skip = !label || /^(действ|инфо|коридор рынка|коридор)/i.test(label) || noText;
      var td = document.createElement('td');
      if(!skip){
        var inp = document.createElement('input');
        inp.className = 'tf-in';
        inp.type = 'text';
        inp.dataset.col = i;
        if(isNum) inp.dataset.num = '1';
        inp.placeholder = isNum ? '> 0   10-50' : 'фильтр';
        inp.setAttribute('aria-label', 'Фильтр: ' + th.textContent.trim());
        if(saved[i]) inp.value = saved[i];
        td.appendChild(inp);
      }
      fr.appendChild(td);
    }
    thead.appendChild(fr);

    var apply = function(){
      var tblwrap = table.closest('.tblwrap') || table.parentElement;
      var savedWrapLeft = tblwrap ? tblwrap.scrollLeft : 0;
      var savedWrapTop = tblwrap ? tblwrap.scrollTop : 0;
      var bodyScroll = document.getElementById('body');
      var savedBodyTop = bodyScroll ? bodyScroll.scrollTop : (window.scrollY || 0);

      var qs = [].map.call(fr.querySelectorAll('.tf-in'), function(inp){
        return { col: +inp.dataset.col, q: inp.value, num: inp.dataset.num === '1' };
      });
      var st = _tblFiltState[sig] = [];
      qs.forEach(function(x){ st[x.col] = x.q; });
      var rows = [].filter.call(tbody.rows, isRealRow);
      var visible = 0;
      rows.forEach(function(r){
        var ok = qs.every(function(x){
          if(!x.q.trim()) return true;
          var cell = r.cells[x.col];
          return cell ? _tfMatch(cell.textContent, x.q, x.num) : true;
        });
        r.hidden = !ok;
        if(ok) visible++;
      });
      var ph = tbody.querySelector('tr.tbl-filt-empty');
      if(!visible && rows.length){
        if(!ph){
          ph = document.createElement('tr');
          ph.className = 'tbl-filt-empty';
          var c = document.createElement('td');
          c.colSpan = cols; c.textContent = 'Нет строк по фильтру';
          ph.appendChild(c); tbody.appendChild(ph);
        }
        ph.hidden = false;
      } else if(ph){ ph.hidden = true; }

      // Восстанавливаем позицию прокрутки, исключая скачки интерфейса при вводе
      if(tblwrap){
        tblwrap.scrollLeft = savedWrapLeft;
        tblwrap.scrollTop = savedWrapTop;
      }
      if(bodyScroll){
        bodyScroll.scrollTop = savedBodyTop;
      }
    };

    fr.addEventListener('input', apply);
    fr.addEventListener('focusin', function(e){
      var inp = e.target;
      if(inp && inp.classList.contains('tf-in')){
        var tblwrap = table.closest('.tblwrap');
        if(tblwrap){
          var curLeft = tblwrap.scrollLeft;
          var curTop = tblwrap.scrollTop;
          requestAnimationFrame(function(){
            if(tblwrap.scrollLeft !== curLeft) tblwrap.scrollLeft = curLeft;
            if(tblwrap.scrollTop !== curTop) tblwrap.scrollTop = curTop;
          });
        }
      }
    });
    if(saved.some(function(v){ return v && v.trim(); })) apply();
  });
}

var fitPending = false;
function scheduleFit(){
  if(fitPending) return;
  fitPending = true;
  requestAnimationFrame(function(){ fitPending = false; fitTables(); });
}

if(window.MutationObserver){
  new MutationObserver(function(){
    scheduleFit();
    // Прямо в колбэке (а не в debounced-rAF): rAF гонка теряла таблицы,
    // подгруженные async. enhanceTableFilters дёшев для уже размеченных.
    try { enhanceTableFilters(document); } catch(e){}
  }).observe(document.documentElement, { childList: true, subtree: true });
}
window.addEventListener('resize', scheduleFit);
if(document.readyState !== 'loading') { try { enhanceTableFilters(document); } catch(e){} }
else document.addEventListener('DOMContentLoaded', function(){ try { enhanceTableFilters(document); } catch(e){} });

/** Уникальный отсортированный список из «грязного» набора строк. */
function uniqSortedList(arr){
  var seen = {}, out = [];
  (arr || []).forEach(function(v){
    var s = String(v == null ? '' : v).trim();
    if(!s || seen[s]) return;
    seen[s] = 1; out.push(s);
  });
  return out.sort(function(a, b){ return a.localeCompare(b, 'ru'); });
}

/** Разметка поля-кнопки, открывающего пикер (вместо свободного <input>). */
function pickField(id, value, placeholder){
  return '<button type="button" class="pick" id="'+id+'">'+
    '<span'+(value ? '' : ' class="ph"')+'>'+esc(value || placeholder)+'</span>'+
    icBare('chevron', 16)+'</button>';
}

/**
 * Привязка такого поля к пикеру. Значение кладётся в store[key], а не читается
 * из DOM при сохранении: у кнопки нет .value, и попытка прочитать её как input
 * молча отправила бы на сервер пустую строку.
 */
function bindPickField(root, id, title, listFn, store, key, emptyLabel){
  var btn = root.querySelector('#'+id);
  if(!btn) return;
  btn.onclick = function(){
    openPicker({
      title: title,
      list: listFn(),
      value: store[key],
      emptyLabel: emptyLabel,
      onPick: function(v){
        store[key] = v;
        var sp = btn.querySelector('span');
        sp.textContent = v;
        sp.className = '';
      }
    });
  };
}

/**
 * Выбор нескольких значений: поиск + отметки + «Выбрать все / Снять».
 *
 * Раньше направления выводились простыней из 30 с лишним «чипов» — их нельзя
 * было ни отфильтровать, ни понять, сколько отмечено, а список занимал экран
 * целиком. Здесь та же логика, что в openPicker, только выбор не закрывает
 * окно, а копится, и применяется кнопкой.
 *
 * opts = { title, list, value: [], onPick(массив) }
 */
function openMultiPicker(opts){
  var chosen = {};
  (opts.value || []).forEach(function(v){ chosen[v] = true; });

  var el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = '<div class="sheet-in">'+
    '<div class="sheet-hd"><b>'+esc(opts.title)+'</b>'+
      '<button class="btn-ghost" data-x="1">Закрыть</button></div>'+
    '<div class="pk-search"><div class="search-wrap">'+icBare('search')+'<input id="mpQ" placeholder="Поиск…" autocomplete="off" '+
      'autocapitalize="off" autocorrect="off" spellcheck="false"></div></div>'+
    '<div class="mp-bar">'+
      '<div class="mp-bar-left">'+
        '<span id="mpCnt"></span>'+
        '<label class="mp-only-lbl">'+
          '<input type="checkbox" id="mpOnlyChecked"> Показать отмеченных'+
        '</label>'+
      '</div>'+
      '<button type="button" class="btn-ghost" id="mpAll">Выбрать все</button>'+
      '<button type="button" class="btn-ghost" id="mpNone">Снять все</button></div>'+
    '<div id="mpBody"></div>'+
    '<div style="height:12px"></div>'+
    '<button class="btn-primary" id="mpOk">Готово</button>'+
    '<div style="height:10px"></div></div>';
  document.body.appendChild(el);

  var q = el.querySelector('#mpQ');
  var body = el.querySelector('#mpBody');
  var onlyCheckedBox = el.querySelector('#mpOnlyChecked');

  function visible(){
    var s = norm(q.value);
    var onlyChecked = onlyCheckedBox && onlyCheckedBox.checked;
    return (opts.list || []).filter(function(v){
      if(onlyChecked && !chosen[v]) return false;
      return !s || norm(v).indexOf(s) >= 0;
    });
  }

  function draw(){
    var list = visible();
    var n = Object.keys(chosen).filter(function(k){ return chosen[k]; }).length;
    el.querySelector('#mpCnt').textContent = 'Отмечено: ' + n;
    var emptyText = (onlyCheckedBox && onlyCheckedBox.checked && !n) ? 'Нет отмеченных записей' : (opts.emptyLabel || 'Совпадений нет');
    body.innerHTML = list.length
      ? '<div class="pk-list">'+ list.map(function(v){
          return '<button type="button" class="mp-row'+(chosen[v] ? ' on' : '')+'" '+
            'data-v="'+esc(v)+'"><i></i><span>'+esc(v)+'</span></button>';
        }).join('') +'</div>'
      : '<div class="pk-empty">'+esc(emptyText)+'</div>';
  }
  draw();
  q.oninput = draw;
  if(onlyCheckedBox) onlyCheckedBox.onchange = draw;

  el.addEventListener('click', function(e){
    if(e.target === el || e.target.dataset.x){ el.remove(); return; }
    if(e.target.closest('#mpAll')){ visible().forEach(function(v){ chosen[v] = true; }); draw(); return; }
    if(e.target.closest('#mpNone')){ visible().forEach(function(v){ chosen[v] = false; }); draw(); return; }
    if(e.target.closest('#mpOk')){
      el.remove();
      opts.onPick(Object.keys(chosen).filter(function(k){ return chosen[k]; }).sort());
      return;
    }
    var row = e.target.closest('.mp-row');
    if(row){
      var v = row.dataset.v;
      chosen[v] = !chosen[v];
      row.classList.toggle('on', !!chosen[v]);
      var n = Object.keys(chosen).filter(function(k){ return chosen[k]; }).length;
      el.querySelector('#mpCnt').textContent = 'Отмечено: ' + n;
    }
  });

  setTimeout(function(){ try{ q.focus(); }catch(e){} }, 60);
}

function openInlinePicker(opts){
  var prev = document.querySelector('.inline-picker-popover');
  if(prev) prev.remove();

  var anchor = opts.anchor;
  if(!anchor) return;
  var rect = anchor.getBoundingClientRect();

  var pop = document.createElement('div');
  pop.className = 'inline-picker-popover';

  var top = rect.bottom + window.scrollY + 4;
  var left = rect.left + window.scrollX;
  var width = Math.max(rect.width, 280);

  if(left + width > window.innerWidth - 16){
    left = Math.max(8, window.innerWidth - width - 16);
  }

  pop.style.top = top + 'px';
  pop.style.left = left + 'px';
  pop.style.width = width + 'px';

  pop.innerHTML = '<div class="ipp-search">'+
    icBare('search', 13)+
    '<input id="ippQ" placeholder="Поиск сотрудника…" autocomplete="off" spellcheck="false">'+
  '</div>'+
  '<div id="ippBody" class="ipp-list"></div>';

  document.body.appendChild(pop);

  var q = pop.querySelector('#ippQ');
  var body = pop.querySelector('#ippBody');

  function draw(){
    var s = (q.value || '').trim().toLowerCase();
    var list = (opts.list || []).filter(function(v){
      return !s || String(v).toLowerCase().indexOf(s) >= 0;
    });

    if(list.length){
      body.innerHTML = list.slice(0, 150).map(function(v){
        var isSel = v === opts.value;
        return '<button type="button" class="ipp-item'+(isSel?' on':'')+'" data-v="'+esc(v)+'">'+
          ic('users', 13)+'<span>'+esc(v)+'</span>'+(isSel?ic('check', 13):'')+
        '</button>';
      }).join('');
    } else {
      body.innerHTML = '<div class="ipp-empty">Сотрудник не найден</div>';
    }
  }

  draw();
  q.oninput = draw;

  function cleanup(){
    pop.remove();
    document.removeEventListener('click', outsideClick);
    document.removeEventListener('keydown', keyClose);
  }

  function outsideClick(e){
    if(!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)){
      cleanup();
    }
  }

  function keyClose(e){
    if(e.key === 'Escape'){
      cleanup();
    }
  }

  pop.onclick = function(e){
    var item = e.target.closest('.ipp-item');
    if(item && item.dataset.v !== undefined){
      var val = item.dataset.v;
      cleanup();
      opts.onPick(val);
    }
  };

  setTimeout(function(){
    try{ q.focus(); }catch(err){}
    document.addEventListener('click', outsideClick);
    document.addEventListener('keydown', keyClose);
  }, 40);
}

function openPicker(opts){
  var el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = '<div class="sheet-in">'+
    '<div class="sheet-hd"><b>'+esc(opts.title)+'</b>'+
      '<button class="btn-ghost" data-x="1">Закрыть</button></div>'+
    '<div class="pk-search"><div class="search-wrap">'+icBare('search')+
      '<input id="pkQ" placeholder="Поиск…" autocomplete="off" autocapitalize="off" '+
        'autocorrect="off" spellcheck="false"></div></div>'+
    '<div id="pkBody"></div>'+
    '<div style="height:10px"></div></div>';
  document.body.appendChild(el);

  var q = el.querySelector('#pkQ');
  var body = el.querySelector('#pkBody');
  var wideOn = false;                      // показан ли полный список холдинга

  function getList(x){
    if(typeof x === 'function') x = x();
    return Array.isArray(x) ? x : [];
  }

  function current(){
    var raw = wideOn ? (opts.wide || opts.list) : (opts.list || opts.wide);
    return getList(raw);
  }

  function draw(){
    var s = q.value.trim().toLowerCase();
    var src = current();
    var list = src.filter(function(v){
      return !s || String(v).toLowerCase().indexOf(s) >= 0;
    });
    var exact = src.some(function(v){ return String(v).toLowerCase() === s; });

    var h = '';
    if(list.length){
      h += '<div class="pk-list">'+ list.slice(0,300).map(function(v){
        return '<button type="button" data-v="'+esc(v)+'"'+
          (v===opts.value?' class="on"':'')+'>'+esc(v)+'</button>';
      }).join('') +'</div>';
      if(list.length > 300) h += '<div class="pk-empty">Показаны первые 300 — уточните поиск</div>';
    } else {
      h += '<div class="pk-empty">'+
        (s ? 'Совпадений нет'
           : (wideOn ? 'Справочник пока пуст'
                     : (opts.emptyLabel || (opts.addUnit ? 'Для вашего подразделения должности ещё не заведены' : 'Список пуст')))) +'</div>';
    }

    // Переключатель на полный список холдинга
    var wideList = getList(opts.wide);
    if(wideList && wideList.length){
      h += '<div class="pk-add"><button type="button" class="btn-line" id="pkWide">'+
        (wideOn ? '← Только должности моего подразделения'
                : (opts.wideLabel || 'Показать все должности холдинга')+
                  ' ('+wideList.length+')')+'</button></div>';
    }

    // Нет точного совпадения — предлагаем добавить своё значение
    if((opts.block || opts.addUnit) && s.length >= 2 && !exact){
      h += '<div class="pk-add"><button type="button" class="btn-line" id="pkAdd" '+
        'style="color:var(--accent);border-color:var(--accent)">'+
        '+ Добавить: <b>'+esc(q.value.trim())+'</b></button>'+
        '<p style="font-size:13.5px;color:var(--muted);margin:8px 2px 0">'+
        (opts.addUnit
          ? 'Должность добавится в штатку подразделения «'+esc(opts.addUnit)+'».'
          : 'Значение попадёт в «Справочник» и станет доступно всем.')+'</p></div>';
    }
    body.innerHTML = h;
  }
  draw();
  q.oninput = draw;

  function done(v){ el.remove(); opts.onPick(v); }

  el.addEventListener('click', function(e){
    if(e.target === el || e.target.dataset.x || e.target.closest('[data-x]')){ el.remove(); return; }

    if(e.target.closest('#pkWide')){
      wideOn = !wideOn;
      draw();
      return;
    }

    var add = e.target.closest('#pkAdd');
    if(add){
      var name = q.value.trim();
      add.disabled = true; add.textContent = 'Добавляем…';

      var req = opts.addUnit
        ? call('apiAddPosition', S.token, opts.addUnit, name)
        : call('apiAddRefValue', S.token, opts.block, name);

      req.then(function(r){
        if(!r || !r.ok){
          add.disabled = false;
          toast((r && r.error) || 'Не удалось добавить');
          draw();
          return;
        }
        // Обновляем списки у себя, чтобы не перезагружать всю форму
        if(opts.addUnit){
          S.data.positions = r.list;
          S.data.positionsAll = r.all;
          // штатка текущего подразделения тоже пополняется — иначе новая должность
          // не появится в чек-листе шага 2 до перезагрузки формы
          if(S.data.positionsByUnit && S.unit){
            var pu = S.data.positionsByUnit[S.unit] || (S.data.positionsByUnit[S.unit] = []);
            if(pu.indexOf(r.name) === -1) pu.push(r.name);
          }
          opts.list = r.list;
          opts.wide = r.all;
        } else {
          if(opts.block === 'segments') S.data.segments = r.list;
          if(opts.block === 'regions') S.data.regions = r.list;
          // Должность, добавленная в поле «в компании», попадает в общий
          // справочник холдинга — обновляем его здесь же, иначе она не
          // появится в следующей строке до перезагрузки страницы.
          if(opts.block === 'positions') S.data.positionsAll = r.list;
          opts.list = r.list;
        }
        toast('Добавлено в справочник');
        done(r.name);
      }).catch(function(){
        add.disabled = false;
        toast('Нет связи с сервером');
        draw();
      });
      return;
    }

    var b = e.target.closest('.pk-list button[data-v]');
    if(b) done(b.dataset.v);
  });

  // На телефоне клавиатура закрывает половину экрана — фокус даём не сразу,
  // чтобы человек сначала увидел список целиком
  if(getList(opts.list).length > 12){
    setTimeout(function(){ try{ q.focus(); }catch(e){} }, 120);
  }
}

function toggleRailCollapse(){
  // Меню теперь верхнее и не сворачивается — оставлено для совместимости.
}

function applyRailCollapse(){
  var rail = $('rail');
  if(!rail) return;
  rail.classList.remove('is-collapsed');
  var rb = $('railBrand');
  if(rb){ rb.title = ''; rb.style.cursor = 'default'; }
}

/**
 * Боковая навигационная панель (десктоп, от 1024px).
 * На мобильном экрана этот блок просто не отображается CSS-ом — вызывать
 * его лишний раз безвредно. Пункты те же, что в topNav/меню ⋮, чтобы
 * не разъезжались правила видимости по роли в трёх разных местах.
 */
// ═══════════════════════════════════════════════════════════
// ЕДИНЫЙ КОМПОНЕНТ НАВИГАЦИИ
// ═══════════════════════════════════════════════════════════
// Три поверхности (рельса на десктопе, нижняя полоса вкладок на телефоне,
// меню «⋮») строятся ОДНОЙ функцией renderNav() из navModel(): один рендер
// кнопки (navRenderBtn), один обработчик кликов (navHandleClick), одна
// проверка черновика (navGo). renderRail/renderTopNav оставлены псевдонимами
// — их зовут из ~11 мест по коду.

var NAV_ROLE_NAMES = {
  admin:'Администратор', cb:'C&B Аналитик', hrbp:'HR BP',
  dir_head:'Руководитель направления', head:'Руководитель отдела', user:'Сотрудник'
};

function navRenderBtn(it, cls){
  var on = it.active && it.active() ? ' on' : '';
  var danger = it.danger ? ' btn-danger' : '';
  var lbl = esc((cls === 'nav-btn' && it.tabLabel) || (cls === 'rail-item' && it.key === 'report' ? 'Отчёт' : it.label));
  var icon = cls === 'rail-item'
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none">'+ICONS[it.icon]+'</svg>'
    : ic(it.icon);

  var subs = it.subsections || it.submenu;
  var hasSub = subs && subs.length >= 2;

  // Плашка «New» у пункта меню — временная, пока раздел не обжился (снять
  // флаг badgeNew в navModel(), когда обкатают и привыкнут).
  var badgeNew = it.badgeNew ? '<span class="nav-badge-new">New</span>' : '';
  // Счётчик непрочитанного (сейчас только «Чат поддержки») — тот же вид
  // плашки, что и «New», просто с числом вместо текста.
  var badgeCount = it.badgeCount ? '<span class="nav-badge-count">'+(it.badgeCount > 99 ? '99+' : it.badgeCount)+'</span>' : '';

  if(cls === 'rail-item'){
    var caret = hasSub
      ? '<span class="rail-sub-caret" data-rail-caret="'+it.key+'" aria-label="Подразделы: ' + esc(it.label) + '">'+
          '<svg class="rail-caret-svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>'+
        '</span>'
      : '';
    var btnTitle = (window.S && S.railCollapsed) ? (' title="' + esc(it.label) + '"') : '';
    return '<button class="'+cls+danger+on+(hasSub ? ' has-sub' : '')+'" data-nav="'+it.key+'"'+btnTitle+'>'+
      icon+'<span>'+lbl+'</span>'+badgeNew+badgeCount+caret+'</button>';
  }

  // На нижней полосе телефона кнопка-категория (есть submenu) помечается
  // «шевроном» сразу после подписи и открывает выпадашку разделов вместо
  // прямого перехода.
  var caretPhone = (cls === 'nav-btn' && hasSub)
    ? '<svg class="nav-btn-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>'
    : '';
  // Пункт меню («Пользователи», «Справочники») тоже может вести не на экран,
  // а на свой список подразделов — без стрелки вправо это неотличимо от
  // обычного перехода, и человек не знает, что там есть что-то ещё.
  var caretMenu = (cls === 'menu-item' && hasSub)
    ? '<svg class="menu-item-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>'
    : '';
  return '<button class="'+cls+danger+on+'" data-nav="'+it.key+'"'+
    (hasSub ? ' data-has-sub="1"' : '')+' title="'+esc(it.label)+'">'+
    icon+'<span>'+lbl+caretPhone+'</span>'+badgeNew+badgeCount+caretMenu+'</button>';
}

var activeRailDropdown = null;

// Список для выпадашки «Администрирование»: разделы без своих подразделов —
// как есть, разделы с подразделами (Пользователи, Справочники) разворачиваются
// в их подразделы с подписью «Раздел · Подраздел», чтобы ничего не терялось.
function adminDropdownSubs(m){
  var out = [];
  (m.admin || []).forEach(function(it){
    var kids = it.subsections || it.submenu;
    if(kids && kids.length >= 2){
      kids.forEach(function(k){
        out.push({ key:k.key, icon:k.icon || it.icon, active:k.active, run:k.run,
          label: it.label + ' · ' + k.label });
      });
    } else {
      out.push(it);
    }
  });
  return out;
}

function closeRailDropdown(){
  if(activeRailDropdown){
    if(activeRailDropdown.el && activeRailDropdown.el.parentNode){
      activeRailDropdown.el.parentNode.removeChild(activeRailDropdown.el);
    }
    if(activeRailDropdown.caret){
      activeRailDropdown.caret.classList.remove('is-open');
    }
    if(activeRailDropdown.btn){
      activeRailDropdown.btn.classList.remove('dropdown-open');
    }
    activeRailDropdown = null;
  }
}

function toggleRailDropdown(navKey, btn){
  if(activeRailDropdown && activeRailDropdown.key === navKey){
    closeRailDropdown();
    return;
  }
  closeRailDropdown();

  if(!btn) return;
  var m = navModel();
  var all = m.primary.concat(m.admin, m.utility);
  var it = all.filter(function(x){ return x.key === navKey; })[0];
  if(navKey === 'admin' && !it){
    it = { key:'admin', label:'Администрирование', submenu: adminDropdownSubs(m) };
  }
  if(!it) return;

  var subs = it.subsections || it.submenu;
  if(!subs || !subs.length) return;

  btn.classList.add('dropdown-open');
  var caret = btn.querySelector('.rail-sub-caret');
  if(caret) caret.classList.add('is-open');

  var el = document.createElement('div');
  el.className = 'rail-dropdown-menu';
  el.setAttribute('role', 'menu');

  var html = '<div class="rail-dropdown-header">' +
    '<span class="rail-dropdown-title">' + esc(it.label) + '</span>' +
    '<span class="rail-dropdown-cnt">' + subs.length + ' подразд.</span>' +
  '</div>' +
  '<div class="rail-dropdown-list">';

  subs.forEach(function(sub, idx){
    var isActive = false;
    if(typeof sub.active === 'function'){
      isActive = sub.active();
    } else if(navKey === 'benchmarks' && window.BM_STATE && ('benchmarks:' + BM_STATE.tab) === sub.key){
      isActive = true;
    } else if(navKey === 'dashboard' && window.S && ('dashboard:' + (S.dashTab || 'overview')) === sub.key){
      isActive = true;
    } else if(navKey === 'users' && window.S && S.appView === 'admin' && sub.key === ('admin:' + (S.adminTab || 'users'))){
      isActive = true;
    } else if(navKey === 'dict' && window.S && S.appView === 'admin' && S.adminTab === 'dict' && sub.key === ('dict:' + (S.dictKind || 'companies'))){
      isActive = true;
    }
    var iconSvg = ICONS[sub.icon]
      ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none">' + ICONS[sub.icon] + '</svg>'
      : ic(sub.icon, 15);
    html += '<button class="rail-dropdown-item' + (isActive ? ' on' : '') + '" data-idx="' + idx + '">' +
      iconSvg + '<span>' + esc(sub.label) + '</span>' +
    '</button>';
  });
  html += '</div>';

  el.innerHTML = html;
  document.body.appendChild(el);

  // Позиционирование поверх левого меню в стиле АИСТ
  var rect = btn.getBoundingClientRect();
  // Меню сверху: список раскрывается под кнопкой.
  var left = rect.left;
  var top = rect.bottom + 4;

  var h = el.offsetHeight || (subs.length * 36 + 46);
  if(top + h > window.innerHeight - 12){
    top = Math.max(12, window.innerHeight - h - 12);
  }

  if(left + 290 > window.innerWidth){
    left = Math.max(8, window.innerWidth - 298);
  }

  el.style.left = left + 'px';
  el.style.top = top + 'px';

  el.onclick = function(ev){
    var itemBtn = ev.target.closest('.rail-dropdown-item');
    if(!itemBtn) return;
    var idx = parseInt(itemBtn.dataset.idx, 10);
    var targetSub = subs[idx];
    closeRailDropdown();
    if(targetSub && typeof targetSub.run === 'function'){
      targetSub.run();
    }
  };

  activeRailDropdown = { key: navKey, el: el, caret: caret, btn: btn };
}

if(!window._railDropdownBound){
  window._railDropdownBound = true;
  document.addEventListener('pointerdown', function(ev){
    if(activeRailDropdown){
      if(ev.target.closest('.rail-dropdown-menu') || ev.target.closest('.rail-sub-caret')){
        return;
      }
      closeRailDropdown();
    }
  });
  window.addEventListener('keydown', function(ev){
    if(ev.key === 'Escape' && activeRailDropdown){
      closeRailDropdown();
    }
  });
}

// Разрешает data-nav в элемент модели и выполняет его (служебные действия —
// напрямую, смену раздела — через navGo с проверкой черновика).
function navHandleClick(e){
  var caret = e.target.closest('.rail-sub-caret');
  if(caret){
    e.stopPropagation();
    e.preventDefault();
    var btn = caret.closest('.rail-item');
    var navKey = caret.dataset.railCaret || (btn && btn.dataset.nav);
    toggleRailDropdown(navKey, btn);
    return;
  }

  closeRailDropdown();

  var b = e.target.closest('button[data-nav]');
  if(!b) return;
  var m = navModel();
  var all = m.primary.concat(
    m.admin,
    m.adminEntry ? [m.adminEntry] : [],
    m.moreEntry ? [m.moreEntry] : [],
    m.utility
  );
  var extraSubs = [];
  all.forEach(function(item){
    if(item && item.subsections) extraSubs = extraSubs.concat(item.subsections);
    if(item && item.submenu && item.submenu !== item.subsections) extraSubs = extraSubs.concat(item.submenu);
  });
  if(extraSubs.length) all = all.concat(extraSubs);
  var it = all.filter(function(x){ return x.key === b.dataset.nav; })[0];
  if(!it) return;
  // Кнопка-категория на нижней полосе: тап → выпадашка разделов.
  if(b.dataset.hasSub && it.submenu && it.submenu.length >= 2){
    openNavSubmenu(it);
    return;
  }
  if(it.key === 'admin' && b.classList.contains('rail-item')){
    toggleRailDropdown('admin', b);
    return;
  }
  if(it.key === 'refresh' || it.key === 'help' || it.key === 'profile' || it.key === 'out') it.run();
  else navGo(it);
}

function renderNav(){
  if(!S.data) return;
  var m = navModel();

  // 1. Рельса (десктоп, от 1024px)
  var rail = $('rail');
  if(rail){
    applyRailCollapse();
    if($('railBrand')) $('railBrand').onclick = toggleRailCollapse;

    var rh = m.primary.map(function(it){ return navRenderBtn(it, 'rail-item'); }).join('');
    if(m.admin.length){
      // Верхнее меню одной строкой: всё администрирование — один пункт
      // с выпадающим списком (разделы и их подразделы, см. adminDropdownSubs).
      rh += navRenderBtn({
        key:'admin', label:'Администрирование', icon:'admin',
        active:function(){ return S.appView === 'admin'; },
        submenu: adminDropdownSubs(m)
      }, 'rail-item');
    }
    $('railNav').innerHTML = rh;
    $('railNav').onclick = navHandleClick;

    var railHoverTimer = null;
    $('railNav').onmouseover = function(e){
      var caret = e.target.closest('.rail-sub-caret');
      if(caret){
        var btn = caret.closest('.rail-item');
        var navKey = caret.dataset.railCaret || (btn && btn.dataset.nav);
        if(!activeRailDropdown || activeRailDropdown.key !== navKey){
          clearTimeout(railHoverTimer);
          railHoverTimer = setTimeout(function(){
            toggleRailDropdown(navKey, btn);
          }, 180);
        }
      }
    };
    $('railNav').onmouseout = function(e){
      var caret = e.target.closest('.rail-sub-caret');
      if(caret){
        clearTimeout(railHoverTimer);
      }
    };

    var fio = userLabel();
    $('railAv').textContent = fio.trim().slice(0, 1).toUpperCase() || '?';
    $('railFio').textContent = shortFio(fio); $('railFio').title = fio;
    var rn = NAV_ROLE_NAMES[S.data.user.role] || S.data.user.role;
    $('railRole').textContent = rn; $('railRole').title = rn + ' · ' + APP_VERSION;
  }

  // 2. Нижняя полоса вкладок (телефон). Нужна, только когда переключать есть
  // что (иначе одна кнопка на текущий же экран) и мы не внутри подразделения.
  var topNav = $('topNav');
  if(topNav){
    var tabs = m.primary.filter(function(it){ return it.inTabs; });
    if(m.adminEntry) tabs.push(m.adminEntry);
    if(m.moreEntry) tabs.push(m.moreEntry);
    if(tabs.length < 2 || S.unit !== null){
      topNav.classList.add('hidden');
      document.body.classList.remove('has-topnav');
    } else {
      topNav.classList.remove('hidden');
      document.body.classList.add('has-topnav');
      topNav.innerHTML = tabs.map(function(it){ return navRenderBtn(it, 'nav-btn'); }).join('');
      topNav.onclick = navHandleClick;
    }
  }
}

// Псевдонимы — вызываются из setTop/switchView/админки и т.д.
function renderRail(){ renderNav(); }

// ═══════════════════════════════════════════════════════════
// СТАРТ
// ═══════════════════════════════════════════════════════════
/**
 * Экран входа. Ссылку на форму и доступ человек получает в боте, поэтому
 * здесь только логин и пароль — без кнопки «получить доступ». Кнопка
 * «Открыть бота» и ссылка «Написать администратору» ведут в один и тот же
 * бот: разбор сообщений от незнакомых людей на «написать администратору»
 * уже реализован внутри самого бота (см. supportChatService на сервере),
 * второй веб-формы под это заводить не нужно.
 */
(function loginScreen(){
  var FALLBACK_HTML = '<p style="text-align:center;color:var(--muted);font-size:14px;margin-top:16px">'+
    'Логин и пароль присылает бот. Не приходил — обратитесь к своему HR BP.</p>';
  $('loginHelp').innerHTML = FALLBACK_HTML;

  call('apiTelegramBotInfo').then(function(r){
    if(!r || !r.ok || !r.username) return; // бот не подключён — остаётся текстовый вариант
    var link = 'https://t.me/' + r.username;
    $('loginHelp').innerHTML =
      '<a href="'+esc(link)+'" target="_blank" class="btn-line" data-tg-link="1" '+
        'style="display:flex;align-items:center;justify-content:center;gap:6px;text-decoration:none;margin-top:16px">'+
        ic('chat', 15)+'Открыть бота @'+esc(r.username)+'</a>'+
      '<a href="'+esc(link)+'" target="_blank" data-tg-link="1" style="display:flex;align-items:center;justify-content:center;gap:5px;'+
        'color:var(--muted);font-size:13.5px;text-decoration:none;margin-top:12px">'+
        ic('help', 14)+'Не получается войти? Написать администратору</a>';
    // Внутри Telegram Mini App обычный <a href="https://t.me/..." target="_blank">
    // не открывается — WebView блокирует переход на другого бота. Нужен
    // Telegram.WebApp.openTelegramLink(), см. пометку IN_TG выше в файле.
    var tg = window.Telegram && window.Telegram.WebApp;
    if(IN_TG && tg && tg.openTelegramLink){
      var els = $('loginHelp').querySelectorAll('[data-tg-link]');
      for(var i = 0; i < els.length; i++){
        els[i].addEventListener('click', function(e){
          e.preventDefault();
          tg.openTelegramLink(link);
        });
      }
    }
  }).catch(function(){ /* остаётся текстовый вариант */ });

  if(window.WorkspaceTabs) WorkspaceTabs.init();
})();

