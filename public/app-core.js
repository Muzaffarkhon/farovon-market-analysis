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
  dashFilters:{ dir:'', hrbp:'', region:'', search:'' },
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

function saveNavState(){
  try {
    var nav = {
      appView: S.appView,
      unit: S.unit,
      tab: S.tab,
      dashTab: S.dashTab,
      dashSumTab: S.dashSumTab,
      adminTab: S.adminTab,
      adminDivsView: S.adminDivsView,
      expandedDir: S.expandedDir,
      expandedUnit: S.expandedUnit,
      expandedSubUnit: S.expandedSubUnit || '',
      selectedOrgNode: S.selectedOrgNode,
      orgZoom: S.orgZoom,
      orgDrawerCollapsed: !!S.orgDrawerCollapsed,
      orgScroll: S.orgScroll || null,
      railCollapsed: !!S.railCollapsed
    };
    store.set(LS_NAV, JSON.stringify(nav));
  } catch(e){}
}

function restoreNavState(){
  try {
    var raw = store.get(LS_NAV);
    if(!raw) return false;
    var nav = JSON.parse(raw);
    if(nav && typeof nav === 'object'){
      // Совместимость: старое имя раздела «Отчёт по подразделениям».
      if(nav.appView === 'dash_hrbp') nav.appView = 'progress';
      if(nav.appView) S.appView = nav.appView;
      if(nav.unit) S.unit = nav.unit;
      if(nav.tab) S.tab = nav.tab;
      if(nav.dashTab) S.dashTab = nav.dashTab;
      if(nav.dashSumTab) S.dashSumTab = nav.dashSumTab;
      if(nav.adminTab) S.adminTab = nav.adminTab;
      if(nav.adminDivsView) S.adminDivsView = nav.adminDivsView;
      if(nav.expandedDir) S.expandedDir = nav.expandedDir;
      if(nav.expandedUnit) S.expandedUnit = nav.expandedUnit;
      if(nav.expandedSubUnit !== undefined) S.expandedSubUnit = nav.expandedSubUnit;
      if(nav.selectedOrgNode) S.selectedOrgNode = nav.selectedOrgNode;
      if(nav.orgZoom) S.orgZoom = nav.orgZoom;
      if(nav.orgDrawerCollapsed !== undefined) S.orgDrawerCollapsed = nav.orgDrawerCollapsed;
      if(nav.orgScroll) S.orgScroll = nav.orgScroll;
      if(nav.railCollapsed !== undefined) S.railCollapsed = nav.railCollapsed;
      return true;
    }
  } catch(e){}
  return false;
}

function $(id){ return document.getElementById(id); }
// Экранирование для вставки в HTML. Помимо & < > " гасим и одинарную кавычку
// (&#39;) — на случай атрибутов в одинарных кавычках и inline-обработчиков,
// чтобы esc() был безопасен в любом HTML-контексте, а не только в "...".
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function uid(){ return 'tmp' + Math.random().toString(36).slice(2,10); }

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
  unlock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2" stroke="currentColor" stroke-width="1.9"/><path d="M7.5 10.5V7a4.5 4.5 0 018.8-.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'
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

/** Клиент для работы с REST API сервера */
var API_ROUTES = {
  apiLogin: function(args){ return fetchJson('/api/auth/login', { method:'POST', body:{ login:args[0], password:args[1] } }); },
  apiLogout: function(){ return fetchJson('/api/auth/logout', { method:'POST' }); },
  apiResume: function(args){ return fetchJson('/api/auth/resume', { method:'GET', token:args[0] }); },
  apiRefresh: function(args){ return fetchJson('/api/auth/resume', { method:'GET', token:args[0] }); },
  apiChangePassword: function(args){ return fetchJson('/api/auth/change-password', { method:'POST', token:args[0], body:{ oldPassword:args[1], newPassword:args[2] } }); },
  apiSetUnits: function(args){ return fetchJson('/api/auth/set-units', { method:'POST', token:args[0], body:{ units:args[1] } }); },
  apiMarkOnboarded: function(args){ return fetchJson('/api/auth/onboarded', { method:'POST', token:args[0] }); },
  apiTelegramLink: function(args){ return fetchJson('/api/telegram/link', { method:'POST', token:args[0] }); },
  apiTelegramUnlink: function(args){ return fetchJson('/api/telegram/unlink', { method:'POST', token:args[0] }); },
  apiSave: function(args){ return fetchJson('/api/survey/save', { method:'POST', token:args[0], body:args[1] }); },
  apiSaveSurvey: function(args){ return fetchJson('/api/survey/save-details', { method:'POST', token:args[0], body:args[1] }); },
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
  apiAdminBatchAssignDivision: function(args){ return fetchJson('/api/admin/divisions/batch-assign', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminApplyAdjacentGroup: function(args){ return fetchJson('/api/admin/divisions/adjacent-group', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminClearAdjacentGroup: function(args){ return fetchJson('/api/admin/divisions/adjacent-group/clear', { method:'POST', token:args[0], body:{ key:args[1] } }); },
  apiAdminMoveDivision: function(args){ return fetchJson('/api/admin/divisions/move', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminGetRoleCapabilities: function(args){ return fetchJson('/api/admin/role-capabilities', { method:'GET', token:args[0] }); },
  apiAdminSaveRoleCapabilities: function(args){ return fetchJson('/api/admin/role-capabilities', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminCreateRole: function(args){ return fetchJson('/api/admin/roles', { method:'POST', token:args[0], body:{ label:args[1] } }); },
  apiAdminRenameRole: function(args){ return fetchJson('/api/admin/roles/' + encodeURIComponent(args[1]) + '/rename', { method:'POST', token:args[0], body:{ label:args[2] } }); },
  apiAdminDeleteRole: function(args){ return fetchJson('/api/admin/roles/' + encodeURIComponent(args[1]) + '/delete', { method:'POST', token:args[0] }); },
  apiSetPeriod: function(args){ return fetchJson('/api/admin/period', { method:'POST', token:args[0], body:args[1] }); },
  apiAdminRunMaintenance: function(args){ return fetchJson('/api/admin/maintenance', { method:'POST', token:args[0], body:{ taskType:args[1] } }); },
  // Тот же эндпоинт с confirm: без него массовые задачи только считают объём.
  apiAdminRunMaintenanceConfirm: function(args){ return fetchJson('/api/admin/maintenance', { method:'POST', token:args[0], body:{ taskType:args[1], confirm:true } }); },
  apiAdminGetLocks: function(args){ return fetchJson('/api/admin/maintenance', { method:'POST', token:args[0], body:{ taskType:'get_locks' } }); },
  // Импорт файла опроса зарплат. args: [token, csvText, dryRun, dupAction]
  apiAdminImportSurvey: function(args){ return fetchJson('/api/admin/import-survey', { method:'POST', token:args[0], body:{ csv:args[1], dryRun:args[2], dupAction:args[3] } }); },
  apiAdminUnlock: function(args){ return fetchJson('/api/admin/maintenance', { method:'POST', token:args[0], body:{ taskType:'unlock', targetOwner:args[1], targetRole:args[2] } }); },
  apiAdminDataStatus: function(args){ return fetchJson('/api/admin/data-status', { method:'GET', token:args[0] }); },
  apiAdminGetAuditLog: function(args){ return fetchJson('/api/admin/audit-log?limit=' + (args[1]||100), { method:'GET', token:args[0] }); },
  apiSendMassReminder: function(args){ return fetchJson('/api/admin/maintenance', { method:'POST', token:args[0], body:{ taskType:'mass_reminder' } }); },
  apiBenchmarkSources: function(args){ return fetchJson('/api/benchmarks/sources', { method:'GET', token:args[0] }); },
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
  if(opts.body && (conf.method === 'POST' || conf.method === 'PUT')) {
    conf.body = JSON.stringify(opts.body);
  }
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
  });
}

function call(fn){
  var args = [].slice.call(arguments, 1);
  if(API_ROUTES[fn]) return API_ROUTES[fn](args);
  return Promise.reject(new Error('Неизвестный метод: ' + fn));
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
 */
function chips(act, list, value, multi, req){
  var sel = multi ? (value||[]) : [value];
  return '<div class="chips" data-chips="'+act+'"'+(multi?' data-multi="1"':'')+
         (req?' data-req="1"':'')+'>' +
    list.map(function(v){
      var on = sel.indexOf(v) >= 0;
      return '<button type="button" data-act="'+act+'" data-v="'+esc(v)+'"'+(on?' class="on"':'')+'>'+esc(v)+'</button>';
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
    };

    fr.addEventListener('input', apply);
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
    '<div class="mp-bar"><span id="mpCnt"></span>'+
      '<button type="button" class="btn-ghost" id="mpAll">Выбрать все</button>'+
      '<button type="button" class="btn-ghost" id="mpNone">Снять все</button></div>'+
    '<div id="mpBody"></div>'+
    '<div style="height:12px"></div>'+
    '<button class="btn-primary" id="mpOk">Готово</button>'+
    '<div style="height:10px"></div></div>';
  document.body.appendChild(el);

  var q = el.querySelector('#mpQ');
  var body = el.querySelector('#mpBody');

  function visible(){
    var s = norm(q.value);
    return (opts.list || []).filter(function(v){ return !s || norm(v).indexOf(s) >= 0; });
  }

  function draw(){
    var list = visible();
    var n = Object.keys(chosen).filter(function(k){ return chosen[k]; }).length;
    el.querySelector('#mpCnt').textContent = 'Отмечено: ' + n;
    body.innerHTML = list.length
      ? '<div class="pk-list">'+ list.map(function(v){
          return '<button type="button" class="mp-row'+(chosen[v] ? ' on' : '')+'" '+
            'data-v="'+esc(v)+'"><i></i><span>'+esc(v)+'</span></button>';
        }).join('') +'</div>'
      : '<div class="pk-empty">Совпадений нет</div>';
  }
  draw();
  q.oninput = draw;

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
  S.railCollapsed = !S.railCollapsed;
  saveNavState();
  applyRailCollapse();
}

function applyRailCollapse(){
  var rail = $('rail');
  if(!rail) return;
  rail.classList.toggle('is-collapsed', !!S.railCollapsed);
  var rb = $('railBrand');
  if(rb){
    rb.title = S.railCollapsed ? 'Развернуть меню' : 'Свернуть меню';
  }
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
  var lbl = esc((cls === 'nav-btn' && it.tabLabel) || it.label);
  var icon = cls === 'rail-item'
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none">'+ICONS[it.icon]+'</svg>'
    : ic(it.icon);
  return '<button class="'+cls+danger+on+'" data-nav="'+it.key+'" title="'+esc(it.label)+'">'+
    icon+'<span>'+lbl+'</span></button>';
}

// Разрешает data-nav в элемент модели и выполняет его (служебные действия —
// напрямую, смену раздела — через navGo с проверкой черновика).
function navHandleClick(e){
  var b = e.target.closest('button[data-nav]');
  if(!b) return;
  var m = navModel();
  var all = m.primary.concat(m.admin, m.adminEntry ? [m.adminEntry] : [], m.utility);
  var it = all.filter(function(x){ return x.key === b.dataset.nav; })[0];
  if(!it) return;
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
      rh += '<div class="rail-sec-label">Администрирование</div>';
      rh += m.admin.map(function(it){ return navRenderBtn(it, 'rail-item'); }).join('');
    }
    $('railNav').innerHTML = rh;
    $('railNav').onclick = navHandleClick;

    var fio = userLabel();
    $('railAv').textContent = fio.trim().slice(0, 1).toUpperCase() || '?';
    $('railFio').textContent = shortFio(fio); $('railFio').title = fio;
    var rn = NAV_ROLE_NAMES[S.data.user.role] || S.data.user.role;
    $('railRole').textContent = rn; $('railRole').title = rn;
  }

  // 2. Нижняя полоса вкладок (телефон). Нужна, только когда переключать есть
  // что (иначе одна кнопка на текущий же экран) и мы не внутри подразделения.
  var topNav = $('topNav');
  if(topNav){
    var tabs = m.primary.filter(function(it){ return it.inTabs; });
    if(m.adminEntry) tabs.push(m.adminEntry);
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
 * Экран входа. Ссылку на форму и доступ человек получает в боте,
 * поэтому здесь только логин и пароль — без кнопки «получить доступ».
 */
(function loginScreen(){
  $('loginHelp').innerHTML =
    '<p style="text-align:center;color:var(--muted);font-size:14px;margin-top:16px">'+
    'Логин и пароль присылает бот. Не приходил — обратитесь к своему HR BP.</p>';
})();

