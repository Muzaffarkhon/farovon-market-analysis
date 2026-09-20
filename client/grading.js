'use strict';

/**
 * Экраны оценки: грейдирование должностей и риски незаменимости персонала.
 *
 * Вынесено отдельным файлом, а не дописано в app.js (12 000 строк) — раздел
 * самостоятельный и связан с остальным приложением только через navModel(),
 * switchView() и renderCurrentView() в app.js.
 *
 * Формулировки вопросов и веса факторов приходят с сервера
 * (/api/grading/factors) — веса нужны, чтобы показывать балл и уровень сразу
 * при клике, теми же правилами, по которым потом посчитает сервер. Тексты
 * запрашиваются под направление выбранного подразделения: у мукомольного
 * цеха они могут отличаться от общих (админка → «Анкеты оценки»).
 */

var GR = {
  tab: 'assess',          // assess | stats
  riskTab: 'list',        // list | heat
  factors: null,          // ответ /api/grading/factors под текущее направление
  factorsDir: null,       // для какого направления загружены тексты
  unit: '',               // подразделение — только для анкеты риска (GR.riskForm.unit)
  blocks: [],             // индустриальные блоки (экран «Оценка должностей»)
  block: '',              // выбранный блок
  rows: [],               // уникальные должности выбранного блока
  form: null,             // открытая анкета оценки должности
  riskForm: null,         // открытая анкета риска
  risks: [],
  heat: [],
  riskUnitEmployees: {}   // unit -> [{fio, position}], кэш для анкеты незаменимости
};

// ─── Доступ ───

function canSeeGrading(){
  var u = (S.data && S.data.user) || {};
  return u.role === 'admin' || hasCap('grading:view') || hasCap('grading:edit');
}
function canEditGrading(){
  var u = (S.data && S.data.user) || {};
  return u.role === 'admin' || hasCap('grading:edit');
}
// Сброс оценки удаляет и итог, и все слепые заявки комиссии по должности —
// это не то же самое, что переоценить (кнопка «Изменить»), поэтому доступно
// только тем, кто управляет блоками, а не всем, у кого просто grading:edit.
function canManageGradingBlocks(){
  var u = (S.data && S.data.user) || {};
  // Сброс оценки — необратимая для комиссии операция (удаляет чужие слепые
  // заявки), поэтому только системный админ, а не любой с grading:blocks.
  return u.role === 'admin';
}
function canSeeKeyRisks(){
  var u = (S.data && S.data.user) || {};
  return u.role === 'admin' || hasCap('keyrisk:view') || hasCap('keyrisk:edit');
}
function canEditKeyRisks(){
  var u = (S.data && S.data.user) || {};
  return u.role === 'admin' || hasCap('keyrisk:edit');
}

// ─── Общие мелочи ───

/** Подразделения, доступные пользователю (те же, что и в анкетах рынка). */
function grUnits(){
  return (S.data && S.data.units) || [];
}

function grDirOf(unit){
  var found = grUnits().filter(function(u){ return u.unit === unit; })[0];
  if(found) return found.dir || '';
  var all = (S.data && S.data.allUnits) || [];
  var any = all.filter(function(u){ return u.unit === unit; })[0];
  return (any && any.dir) || '';
}

function grBlockLabel(key){
  var b = (GR.blocks || []).filter(function(x){ return x.key === key; })[0];
  return b ? b.label : '';
}

/** Балл = сумма «оценка × вес». Повторяет gradingService.calcWeightedScore. */
function grScore(answers){
  var weights = (GR.factors && GR.factors.weights) || [];
  var sum = 0;
  weights.forEach(function(w, i){ sum += (Number(answers[i]) || 0) * w; });
  return Math.round(sum * 100) / 100;
}

/** Уровень по баллу. Пороги приходят с сервера — второй копии правил нет. */
function grGrade(score){
  var thresholds = (GR.factors && GR.factors.grades) || [];
  for(var i = 0; i < thresholds.length; i++){
    if(score >= thresholds[i].from) return thresholds[i].grade;
  }
  return (GR.factors && GR.factors.maxGrade) || 1;
}

/**
 * Название группы по номеру уровня. full=true — с расшифровкой профиля
 * («Группа III — Ведущие специалисты…»), иначе только короткое «Группа III»
 * (для узких ячеек таблицы). Если сервер названия не прислал — просто «Уровень N».
 */
function grGradeName(grade, full){
  var thresholds = (GR.factors && GR.factors.grades) || [];
  var hit = thresholds.filter(function(t){ return t.grade === grade; })[0];
  if(!hit || !hit.name) return 'Уровень ' + grade;
  return full && hit.label ? hit.name + ' — ' + hit.label : hit.name;
}

function grAnswered(answers, need){
  var n = 0;
  for(var i = 0; i < need; i++){ if(answers[i]) n++; }
  return n;
}

// ═══════════════════════════════════════════════════════════
// ЭКРАН: Грейдирование должностей
// ═══════════════════════════════════════════════════════════

function openGrading(initialTab){
  if(!canSeeGrading()){
    toast('У вас нет доступа к грейдированию должностей', 'warn');
    if(S.appView === 'grading') switchView('home');
    return;
  }
  if(initialTab) GR.tab = initialTab;
  var curTab = GR.tab || 'assess';
  var titles = {
    assess: { title: 'Оценка должностей', icon: 'grades' },
    stats: { title: 'Сводка по грейдам', icon: 'chart' }
  };
  var tInfo = titles[curTab] || titles.assess;
  var tabKey = 'grading:' + curTab;

  if(window.WorkspaceTabs && WorkspaceTabs.openTab && !WorkspaceTabs.isInsideTabRun){
    WorkspaceTabs.openTab({
      key: tabKey, title: tInfo.title, icon: tInfo.icon,
      state: { appView: 'grading', grTab: curTab, unit: null },
      run: function(){ openGrading(curTab); }
    });
    return;
  }
  if(window.WorkspaceTabs && WorkspaceTabs.updateActiveTitle){
    WorkspaceTabs.updateActiveTitle(tInfo.title, tInfo.icon, tabKey);
  }

  S.appView = 'grading';
  S.unit = null;
  saveNavState();
  renderTopNav();
  setTop(tInfo.title, userLabel(), false, tInfo.icon);
  $('bar').classList.add('hidden');
  $('body').onclick = null;

  $('body').innerHTML =
    '<div class="sub-tabs sub-tabs--sticky dash-tabbar"><div class="dash-tab-strip">'+
      '<button class="sub-tab '+(curTab === 'assess' ? 'on' : '')+'" onclick="openGrading(\'assess\')">'+ic('grades', 14)+'Оценка должностей</button>'+
      '<button class="sub-tab '+(curTab === 'stats' ? 'on' : '')+'" onclick="openGrading(\'stats\')">'+ic('chart', 14)+'Сводка по грейдам</button>'+
    '</div></div>'+
    '<div id="grContent" class="gr-content">Загрузка…</div>';

  if(curTab === 'stats') loadGradingStats();
  else renderGradeAssess();
}

// Последнее выбранное подразделение переживает перезагрузку страницы: иначе
// после F5 подставлялось первое по списку («Обзор рынка — не распределено»),
// и работа начиналась с чужого подразделения.
var LS_GR_UNIT = 'фаровон_оценка_подразделение';

/**
 * Какое подразделение показывать при открытии экрана:
 * прошлый выбор → единственное доступное → ничего (просим выбрать).
 * Автоподстановка первого из сотен подразделений админу только мешает.
 */
function grInitialUnit(units){
  if(GR.unit && units.some(function(u){ return u.unit === GR.unit; })) return GR.unit;

  var saved = store.get(LS_GR_UNIT);
  if(saved && units.some(function(u){ return u.unit === saved; })) return saved;

  return units.length === 1 ? units[0].unit : '';
}

// Последний выбранный блок переживает перезагрузку страницы — тот же приём,
// что и LS_GR_UNIT у подразделений (см. ниже, экран анкеты риска).
var LS_GR_BLOCK = 'фаровон_оценка_блок';

function grInitialBlock(blocks){
  if(GR.block && blocks.some(function(b){ return b.key === GR.block; })) return GR.block;
  var saved = store.get(LS_GR_BLOCK);
  if(saved && blocks.some(function(b){ return b.key === saved; })) return saved;
  return blocks.length ? blocks[0].key : '';
}

/**
 * Экран «Оценка должностей»: выбор индустриального блока → список уникальных
 * должностей блока. Раньше выбирали подразделение и оценивали его штатные
 * позиции заново в каждом из 326 — теперь должность оценивается один раз на
 * блок и оценка сразу действует во всех подразделениях этого блока.
 */
function renderGradeAssess(){
  $('grContent').innerHTML =
    '<div class="gr-groups" id="grBlockBar">Загрузка блоков…</div>'+
    '<div id="grList"></div>'+
    '<div id="grForm"></div>';
  loadGradeBlocks();
}

function loadGradeBlocks(){
  call('apiGradingBlocks', S.token).then(guardAsyncToTab(function(r){
    if(!r || !r.ok){
      $('grBlockBar').innerHTML = '<div class="err">'+esc((r && r.error) || 'Не удалось загрузить блоки')+'</div>';
      return;
    }
    GR.blocks = r.rows || [];
    GR.block = grInitialBlock(GR.blocks);
    drawGradeBlocks();
    if(GR.block) loadGradePositions();
    else $('grList').innerHTML = '<div class="empty">Индустриальные блоки ещё не настроены</div>';
  })).catch(guardAsyncToTab(function(){
    $('grBlockBar').innerHTML = '<div class="err">Нет связи с сервером</div>';
  }));
}

function drawGradeBlocks(){
  var bar = $('grBlockBar');
  if(!bar) return;
  bar.innerHTML = (GR.blocks || []).map(function(b){
    return '<button class="gr-group'+(b.key === GR.block ? ' on' : '')+'" data-b="'+esc(b.key)+'">'+
      '<span class="gr-gname">'+esc(b.label)+'</span><small>'+(b.evaluated_count || 0)+' из '+(b.position_count || 0)+' оценено</small>'+
      '<i class="gr-gbar"><b style="width:'+(b.position_count ? Math.round((b.evaluated_count || 0) / b.position_count * 100) : 0)+'%"></b></i></button>';
  }).join('');
  [].forEach.call(bar.querySelectorAll('[data-b]'), function(btn){
    btn.onclick = function(){
      var key = btn.getAttribute('data-b');
      if(key === GR.block) return;
      GR.block = key;
      store.set(LS_GR_BLOCK, key);
      GR.form = null;
      $('grForm').innerHTML = '';
      $('grList').innerHTML = skTable();
      drawGradeBlocks();
      loadGradePositions();
    };
  });
}

// ─── Выбор подразделения с поиском ───
// У admin и C&B в списке все 326 подразделений — обычный выпадающий список
// там бесполезен. Это не то же самое, что кнопка «Фильтр» над таблицей:
// фильтр отбирает строки уже загруженной таблицы, а здесь выбирается,
// данные какого подразделения вообще запрашивать у сервера.

var GR_PICK_LIMIT = 60;

var GR_PICK_PLACEHOLDER = 'Подразделение — начните вводить';

function grUnitPickerHtml(id, current){
  return '<div class="gr-unitpick" id="'+id+'Box">'+
    '<div class="search-wrap gr-unitpick-in">'+icBare('search')+
      '<input id="'+id+'Input" value="'+esc(current || '')+'" '+
        'placeholder="'+esc(GR_PICK_PLACEHOLDER)+'" autocomplete="off">'+
      '<span class="gr-unitpick-caret">'+icBare('chevron', 14)+'</span></div>'+
    '<div class="gr-unitlist" id="'+id+'List" hidden></div>'+
  '</div>';
}

function grBindUnitPicker(id, onPick){
  var input = $(id + 'Input');
  var list = $(id + 'List');
  if(!input || !list) return;

  var units = grUnits();
  var chosen = input.value;

  function matches(u, q){
    return u.unit.toLowerCase().indexOf(q) >= 0 || String(u.dir || '').toLowerCase().indexOf(q) >= 0;
  }

  function draw(){
    var q = (input.value || '').toLowerCase().trim();
    // Пока ничего не введено, показываем начало списка — иначе при первом
    // клике пусто и непонятно, что тут вообще есть.
    var found = q ? units.filter(function(u){ return matches(u, q); }) : units.slice();

    // Русские окончания: «мука» не находит «Цех упаковки муки». Если по
    // точному вхождению пусто, отрезаем до двух последних букв запроса —
    // этого хватает на падежи и не требует словаря словоформ.
    for(var cut = 1; !found.length && cut <= 2 && q.length - cut >= 3; cut++){
      var stem = q.slice(0, q.length - cut);
      found = units.filter(function(u){ return matches(u, stem); });
    }
    var shown = found.slice(0, GR_PICK_LIMIT);

    list.innerHTML = shown.map(function(u){
      // У верхнеуровневых подразделений название совпадает с направлением
      // («Правление» / «Правление») — вторую строку в таком случае не рисуем.
      var dir = String(u.dir || '');
      var sub = (dir && dir !== u.unit) ? '<small>'+esc(dir)+'</small>' : '';
      return '<button class="gr-unitrow'+(u.unit === chosen ? ' on' : '')+'" data-u="'+esc(u.unit)+'">'+
        '<span>'+esc(u.unit)+'</span>'+sub+'</button>';
    }).join('') || '<div class="gr-unitempty">Ничего не найдено</div>';

    if(found.length > shown.length){
      list.innerHTML += '<div class="gr-unitempty">…и ещё '+(found.length - shown.length)+' — уточните запрос</div>';
    }
    list.hidden = false;
  }

  function hide(){
    list.hidden = true;
    // Ушли, ничего не выбрав — возвращаем прежнее подразделение, чтобы в поле
    // не осталась оборванная строка поиска.
    input.value = chosen;
    input.placeholder = GR_PICK_PLACEHOLDER;
  }

  /**
   * Клик по полю ведёт себя как обычный выпадающий список: открывается весь
   * перечень, поле очищается под поиск, а выбранное подразделение уходит в
   * подсказку. Раньше в поле оставалось название, список фильтровался по нему
   * и показывал единственную строку — чтобы выбрать другое, приходилось
   * сначала стирать текст.
   */
  function open(){
    input.placeholder = chosen || GR_PICK_PLACEHOLDER;
    input.value = '';
    draw();
  }

  input.onfocus = open;
  input.onmousedown = function(){
    // Повторный клик по уже открытому списку закрывает его, как у select.
    if(document.activeElement === input && !list.hidden){
      setTimeout(function(){ hide(); input.blur(); }, 0);
    }
  };
  input.oninput = draw;
  input.onkeydown = function(e){
    if(e.key === 'Escape'){ hide(); input.blur(); return; }
    // Enter выбирает первое совпадение — не нужно тянуться к мыши.
    if(e.key === 'Enter'){
      var first = list.querySelector('.gr-unitrow');
      if(first){ e.preventDefault(); pick(first.getAttribute('data-u')); input.blur(); }
    }
  };
  input.onblur = function(){ setTimeout(hide, 150); };

  function pick(unit){
    chosen = unit;
    input.value = unit;
    input.placeholder = GR_PICK_PLACEHOLDER;
    list.hidden = true;
    onPick(unit);
  }

  list.onmousedown = function(e){
    var btn = e.target.closest('.gr-unitrow');
    if(!btn) return;
    e.preventDefault();
    pick(btn.getAttribute('data-u'));
  };
}

function loadGradePositions(){
  // Формулировки вопросов подставляются под индустриальный блок (админка
  // «Анкеты оценки» → «block:<key>»), а не под направление оргструктуры —
  // должность оценивается один раз на весь блок, а не по-разному в каждом
  // подразделении.
  var wantDir = GR.block ? ('block:' + GR.block) : '';
  var needFactors = !GR.factors || GR.factorsDir !== wantDir;

  Promise.all([
    call('apiGradingPositions', S.token, GR.block),
    needFactors ? call('apiGradingFactors', S.token, wantDir) : Promise.resolve(GR.factors)
  ]).then(guardAsyncToTab(function(res){
    var pos = res[0];
    var factors = res[1];
    if(!pos || !pos.ok){
      $('grList').innerHTML = '<div class="err">'+esc((pos && pos.error) || 'Не удалось загрузить должности')+'</div>';
      return;
    }
    if(factors && factors.ok){
      GR.factors = factors;
      GR.factorsDir = wantDir;
    }
    GR.rows = pos.rows || [];
    GR.committeeSize = pos.committeeSize || 0;
    GR.isCommitteeMember = !!pos.isCommitteeMember;
    drawGradePositions();
    if(GR.form) drawGradeForm();
  })).catch(guardAsyncToTab(function(){
    $('grList').innerHTML = '<div class="err">Нет связи с сервером</div>';
  }));
}

function drawGradePositions(){
  // Пока открыта анкета, список должностей и панель блоков только мешают —
  // прячем их целиком, а не просто ужимаем: анкета получает весь экран,
  // «Закрыть» в её шапке возвращает список.
  var blockBar = $('grBlockBar');
  if(blockBar) blockBar.classList.toggle('hidden', !!GR.form);
  $('grList').classList.toggle('hidden', !!GR.form);
  if(GR.form) return;

  if(!GR.rows.length){
    $('grList').innerHTML = '<div class="empty">В этом блоке пока нет ни одной должности</div>';
    return;
  }

  var done = GR.rows.filter(function(r){ return r.grade_level; }).length;
  var hasCommittee = GR.committeeSize > 0;
  var canReset = canManageGradingBlocks();
  var h = '<div class="gr-progress">Оценено <b>'+done+'</b> из '+GR.rows.length+' должностей'+
    (hasCommittee ? ' <span class="muted">· комиссия '+GR.committeeSize+' чел.'+(GR.isCommitteeMember ? '' : ', вы не в её составе')+'</span>' : '')+
    '</div>'+
    '<div class="gr-progbar'+(done === GR.rows.length ? ' ok' : '')+'"><i style="width:'+Math.round(done / GR.rows.length * 100)+'%"></i></div>'+
    // Список растёт по содержимому — под ним не должно оставаться пустого
    // экрана. Пока анкета открыта, этот блок вообще скрыт (см. выше), так
    // что ужимать под неё больше не нужно.
    '<div class="tblwrap gr-tblwrap"><table class="co-tbl gr-tbl">'+
    '<thead><tr><th>Должность</th><th>Подразделений</th><th>Штат</th>'+
      (hasCommittee ? '<th>Комиссия</th>' : '')+
      '<th class="gr-num">Балл</th><th>Уровень</th><th></th></tr></thead><tbody>'+
    GR.rows.map(function(r, i){
      var mySubmitted = !!r.my_submission;
      var hasAnything = !!r.grade_level || mySubmitted || (r.submitted_count || 0) > 0;
      var btnLabel = r.grade_level ? 'Изменить' : (mySubmitted ? 'Изменить свой ответ' : 'Оценить');
      var unitsCell = (r.unit_count || 0)
        ? '<button type="button" class="list-cell gr-units-cell" data-i="'+i+'" data-ctx-label="'+esc('Подразделения: ' + (r.unit_count || 0))+'">'+(r.unit_count || 0)+'</button>'
        : '0';
      // «Комиссия» — если хоть одна заявка есть, у admin/C&B (canReset) кликабельно:
      // открывает карточку сравнения, кто что выбрал (см. openCommitteeBreakdown).
      // Остальным членам комиссии чужие голоса до утверждения не показываем —
      // отсюда и «слепая» заявка теряет смысл, если любой мог бы их сверить.
      var committeePlain = (r.grade_level ? 'завершено' : (r.submitted_count || 0)+' из '+GR.committeeSize);
      var committeeText = '<span class="gr-cstat '+(r.grade_level ? 'is-done' : ((r.submitted_count || 0) > 0 ? 'is-part' : 'is-none'))+'">'+committeePlain+'</span>' + (mySubmitted ? ' '+icBare('check', 12) : '');
      var committeeCell = (canReset && (r.submitted_count || 0) > 0)
        ? '<button type="button" class="list-cell gr-committee-cell" data-i="'+i+'" data-ctx-label="'+esc('Комиссия: ' + committeePlain)+'">'+committeeText+'</button>'
        : committeeText;
      return '<tr>'+
        '<td><b>'+esc(r.job_title)+'</b></td>'+
        '<td>'+unitsCell+'</td>'+
        '<td>'+(r.staff_count || 0)+'</td>'+
        (hasCommittee ? '<td>'+committeeCell+'</td>' : '')+
        '<td class="gr-num">'+(r.weighted_score != null ? esc(String(r.weighted_score)) : '—')+'</td>'+
        '<td>'+(r.grade_level ? '<span class="badge b-active">'+esc(grGradeName(r.grade_level))+'</span>' : '<span class="badge">нет оценки</span>')+'</td>'+
        '<td class="gr-row-acts">'+
          '<button class="btn-line gr-open" data-i="'+i+'">'+btnLabel+'</button>'+
          (canReset && hasAnything ? '<button class="btn-line btn-danger gr-reset" data-i="'+i+'" title="Удалить оценку и все заявки комиссии по этой должности">Сбросить</button>' : '')+
        '</td>'+
      '</tr>';
    }).join('')+
    '</tbody></table></div>';

  $('grList').innerHTML = h;
  [].forEach.call(document.querySelectorAll('#grList .gr-open'), function(btn){
    btn.onclick = function(){ openGradeForm(parseInt(btn.getAttribute('data-i'), 10)); };
  });
  [].forEach.call(document.querySelectorAll('#grList .gr-reset'), function(btn){
    btn.onclick = function(){ resetGradeEvaluation(parseInt(btn.getAttribute('data-i'), 10)); };
  });
  [].forEach.call(document.querySelectorAll('#grList .gr-units-cell'), function(btn){
    btn.onclick = function(e){
      var row = GR.rows[parseInt(btn.getAttribute('data-i'), 10)];
      if(row) showListPopover(e, row.job_title, (row.units || []).map(function(u){
        return { label: u.unit, hint: (u.staffCount || 0) + ' чел.' };
      }));
    };
  });
  [].forEach.call(document.querySelectorAll('#grList .gr-committee-cell'), function(btn){
    btn.onclick = function(){
      var row = GR.rows[parseInt(btn.getAttribute('data-i'), 10)];
      if(row) openCommitteeBreakdown(row);
    };
  });
}

/**
 * Карточка сравнения по должности с оценкой комиссии: факторы в строках,
 * члены комиссии — отдельными столбцами, в каждой ячейке — балл и текст
 * выбранного варианта. Пока не утверждено — можно «Сбросить» прямо отсюда
 * (та же операция, что кнопка в строке таблицы); после утверждения карточка
 * только для просмотра, сброс всё равно доступен (снаружи и внутри — как
 * попросили), а точечно поменять чей-то голос уже нельзя ни отсюда, ни из
 * формы (см. серверную проверку в evaluateAsCommittee).
 */
function openCommitteeBreakdown(row){
  var el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = '<div class="sheet-in um-modal" style="max-width:720px">'+
    '<div class="sheet-hd"><b>'+ic('users',16)+'Комиссия: '+esc(row.job_title)+'</b>'+
      '<button class="btn-ghost" data-x="1">Закрыть</button></div>'+
    '<div id="cbBody" style="padding:6px 0 2px"><div class="sp"><i></i> Загрузка…</div></div>'+
  '</div>';
  document.body.appendChild(el);

  function close(){ if(el.parentNode) el.remove(); }
  el.addEventListener('click', function(e){
    if(e.target === el || e.target.closest('[data-x]')) close();
  });

  call('apiAdminGradingCommitteeBreakdown', S.token, GR.block, row.job_title).then(function(r){
    var body = el.querySelector('#cbBody');
    if(!body) return;
    if(!r || !r.ok){
      body.innerHTML = '<div class="err">'+esc((r && r.error) || 'Не удалось загрузить')+'</div>';
      return;
    }
    var factors = (GR.factors && GR.factors.criteria) || [];
    var subs = r.submissions || [];

    var html = r.finalized
      ? '<div class="gr-result gr-result--ready" style="margin-bottom:12px">'+
          '<div><span class="muted">Итоговый балл</span><b>'+esc(String(r.final.weighted_score))+'</b></div>'+
          '<div><span class="muted">Уровень</span><b>'+esc(grGradeName(r.final.grade_level, true))+'</b></div>'+
          '<div class="gr-result-note">Утверждено — менять отдельные голоса больше нельзя, только «Сбросить».</div>'+
        '</div>'
      : '<div class="muted" style="margin-bottom:10px">Сдали '+subs.length+' из '+r.committeeSize+'. Итог подведётся автоматически, когда ответят все.</div>';

    if(!subs.length){
      html += '<div class="empty">Заявок пока нет</div>';
    } else {
      var weights = (GR.factors && GR.factors.weights) || [];
      html += '<div class="tblwrap"><table class="co-tbl" data-no-smart-filter="true"><thead><tr><th>Фактор</th>'+
        subs.map(function(s){ return '<th>'+esc(s.evaluator_fio)+'</th>'; }).join('')+
        '</tr></thead><tbody>'+
        factors.map(function(fac, fi){
          var key = 'factor_' + (fi + 1);
          var w = weights[fi];
          var wLabel = (w != null) ? ' <span class="muted" style="font-weight:400">(вес '+Math.round(w * 100)+'%)</span>' : '';
          return '<tr><td><b>'+esc(fac.code || ('Ф'+(fi+1)))+wLabel+'</b><div class="muted" style="font-size:11.5px">'+esc(fac.title)+'</div></td>'+
            subs.map(function(s){
              var val = s[key];
              if(val == null) return '<td class="muted">—</td>';
              var opt = (fac.options || [])[Math.round(val) - 1] || '';
              return '<td><span class="gr-score gr-score--sm">'+val+'</span> '+esc(opt)+'</td>';
            }).join('')+
          '</tr>';
        }).join('')+
        '<tr class="gr-committee-total"><td><b>Итоговый балл</b></td>'+
        subs.map(function(s){
          return '<td><b>'+(s.weighted_score != null ? esc(String(s.weighted_score)) : '—')+'</b></td>';
        }).join('')+
        '</tr>'+
        '</tbody></table></div>';
    }

    if(canManageGradingBlocks()){
      html += '<div style="display:flex;justify-content:flex-end;margin-top:12px">'+
        '<button class="btn-line btn-danger" id="cbReset">Сбросить</button>'+
      '</div>';
    }

    body.innerHTML = html;
    var resetBtn = body.querySelector('#cbReset');
    if(resetBtn) resetBtn.onclick = function(){
      close();
      var idx = GR.rows.indexOf(row);
      resetGradeEvaluation(idx >= 0 ? idx : GR.rows.length);
    };
  }).catch(function(){
    var body = el.querySelector('#cbBody');
    if(body) body.innerHTML = '<div class="err">Нет связи с сервером</div>';
  });
}

/** Полностью стирает оценку должности (и все заявки комиссии по ней) — не
 *  переоценка, а возврат в «не оценено». См. canManageGradingBlocks(). */
function resetGradeEvaluation(rowIndex){
  var row = GR.rows[rowIndex];
  if(!row) return;
  ask({
    title: 'Сбросить оценку?',
    html: 'Должность «'+esc(row.job_title)+'» вернётся в состояние «не оценено». '+
      'Итоговый грейд и все слепые заявки комиссии по ней будут удалены безвозвратно.',
    ok: 'Сбросить', cancel: 'Отмена', danger: true
  }).then(function(yes){
    if(!yes) return;
    call('apiAdminGradingResetEvaluation', S.token, { block: GR.block, job_title: row.job_title }).then(function(r){
      if(!r || !r.ok){
        toast((r && r.error) || 'Не удалось сбросить оценку', 'error');
        return;
      }
      toast(r.message || 'Оценка сброшена', 'success');
      loadGradePositions();
    }).catch(function(){ toast('Нет связи с сервером', 'error'); });
  });
}

/** Открыть анкету по должности (или переоткрыть с уже сохранёнными ответами). */
function openGradeForm(rowIndex){
  var row = GR.rows[rowIndex];
  if(!row) return;
  if(!canEditGrading()){
    toast('У вас нет права оценивать должности', 'warn');
    return;
  }
  if(GR.committeeSize > 0 && !GR.isCommitteeMember){
    toast('Вы не входите в комиссию этого блока — оценивают только назначенные эксперты', 'warn');
    return;
  }

  // Пока итог не подведён, показываем СВОЙ прошлый слепой ответ (если уже
  // отвечали) — не чужие и не итоговое среднее. После завершения (grade_level
  // проставлен) строка row уже содержит официальный итог, его и показываем.
  var mine = !row.grade_level ? row.my_submission : null;
  var source = mine || row;
  GR.form = {
    jobTitle: row.job_title,
    answers: [source.factor_1, source.factor_2, source.factor_3, source.factor_4, source.factor_5, source.factor_6, source.factor_7]
      .map(function(v){ return v || 0; }),
    notes: source.notes || '',
    editingFactor: null
  };
  drawGradePositions();
  drawGradeForm();
  var el = $('grForm');
  if(el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function drawGradeForm(){
  var f = GR.form;
  var box = $('grForm');
  if(!f || !box) return;
  if(!GR.factors){
    box.innerHTML = '<div class="err">Не загружены формулировки анкеты</div>';
    return;
  }

  var factors = GR.factors.criteria || [];
  var weights = GR.factors.weights || [];
  var score = grScore(f.answers);
  var grade = grGrade(score);
  var answered = grAnswered(f.answers, factors.length);
  var ready = factors.length > 0 && answered === factors.length;

  // Шапка липкая: в анкете 7 блоков вопросов, и на середине прокрутки уже не
  // видно, какую должность оцениваешь. Там же держим текущий балл — иначе за
  // ним пришлось бы листать вниз.
  var h = '<div class="card gr-form">'+
    '<div class="gr-form-hd">'+
      '<b>'+esc(f.jobTitle)+'</b>'+
      '<span class="muted">'+esc(grBlockLabel(GR.block))+'</span>'+
      '<span class="gr-hd-score">'+(ready
        ? 'Балл <b>'+score.toFixed(2)+'</b> · <b>'+esc(grGradeName(grade))+'</b>'
        : 'Отвечено '+answered+' из '+factors.length)+'</span>'+
      '<button class="btn-line gr-close">Закрыть</button>'+
    '</div>'+
    (hasCap('grading:factors') || (S.data && S.data.user && S.data.user.role === 'admin')
      ? '<div class="gr-groups-hd"><button class="btn-line gr-open-factors">Настройки анкеты</button></div>'
      : '');

  // Раньше все факторы разворачивались сразу — вопросы по 5 вариантов полным
  // текстом каждый превращали анкету в стену текста, в которой легко
  // потеряться (жалоба: «слишком много текста и информации, сложно
  // сориентироваться»). Теперь открыт только ОДИН фактор за раз: первый
  // неотвеченный, либо тот, что явно открыли на редактирование кликом
  // «Изменить». Остальные, уже отвеченные, сворачиваются в одну строку
  // с кратким итогом выбора — их текст никуда не делся, просто не отвлекает,
  // пока не понадобится изменить ответ.
  var firstUnanswered = -1;
  for(var fi = 0; fi < factors.length; fi++){
    if(!Number(f.answers[fi])){ firstUnanswered = fi; break; }
  }
  var openFactor = (f.editingFactor != null) ? f.editingFactor : firstUnanswered;

  factors.forEach(function(fac, i){
    var w = weights[i];
    var val = Number(f.answers[i]) || 0;
    // openFactor === -1 значит «неотвеченных нет и явно ничего не открывали» —
    // весь список должен свернуться в сводку, а не наоборот развернуться
    // целиком (была именно такая инверсия: -1 читалось как «открыть всё»).
    var isOpen = openFactor !== -1 && openFactor === i;
    var title = '<b>'+esc(fac.code || ('Фактор ' + (i + 1)))+'. '+esc(fac.title)+'</b>';

    if(!isOpen){
      // Свёрнутая строка — либо уже отвечен (короткий итог выбора), либо
      // ещё ждёт своей очереди (открывается по клику, не обязательно по порядку).
      // Текст (вопрос+ответ) и кнопка «Изменить» — две grid-колонки (1fr +
      // auto), а не flex-шринк на одном уровне: у grid ширина auto-колонки
      // считается ДО раздачи остатка на 1fr, поэтому кнопка гарантированно
      // получает своё место и не может быть выдавлена/обрезана контейнером
      // (в отличие от flex, где без точного min-width на каждом элементе
      // сумма «внутренних» ширин могла превысить контейнер и увести кнопку
      // за пределы видимой области).
      var chosen = val ? ((fac.options || [])[val - 1] || '') : '';
      h += '<div class="gr-factor gr-factor--done" data-f="'+i+'">'+
        // --grade: заголовки K1–K6 короткие ("Условия труда и нагрузка") — в
        // отличие от анкеты риска, где заголовки — целые вопросы-предложения
        // и на одну строку их в принципе не уместить. Здесь можно дать плашке
        // колонку пошире и не переносить текст на 2 строки.
        '<div class="gr-factor-summary gr-factor-summary--grade">'+
          '<div class="gr-factor-hd">'+title+
            '<span class="badge">вес '+Math.round(w * 100)+'%</span>'+
          '</div>'+
          (val
            ? '<div class="gr-factor-chosen"><span class="gr-score gr-score--sm">'+val+'</span><span>'+esc(chosen)+'</span></div>'
            : '<div class="gr-factor-chosen muted">Ещё не отвечено</div>')+
        '</div>'+
        '<button type="button" class="btn-line gr-factor-edit" data-f="'+i+'">'+(val ? 'Изменить' : 'Ответить')+'</button>'+
      '</div>';
      return;
    }

    h += '<div class="gr-factor gr-factor--open">'+
      '<div class="gr-factor-hd">'+title+
        '<span class="badge">вес '+Math.round(w * 100)+'%</span></div>'+
      (fac.help ? '<div class="gr-help">'+esc(fac.help)+'</div>' : '')+
      '<div class="gr-opts">'+
        (fac.options || []).map(function(o, oi){
          var ov = oi + 1;
          var example = (fac.examples || [])[oi];
          return '<button class="gr-opt'+(val === ov ? ' on' : '')+'" data-f="'+i+'" data-v="'+ov+'">'+
            '<span class="gr-score">'+ov+'</span>'+
            '<span class="gr-opt-body">'+
              '<span class="gr-opt-text">'+esc(o)+'</span>'+
              (example ? '<span class="gr-opt-example">Например: '+esc(example)+'</span>' : '')+
            '</span></button>';
        }).join('')+
      '</div>'+
    '</div>';
  });

  h += '<label class="lbl">Обоснование комиссии (необязательно)</label>'+
    '<textarea id="grNotes" rows="2" maxlength="2000">'+esc(f.notes || '')+'</textarea>'+
    '<div class="gr-result'+(ready ? ' gr-result--ready' : '')+'">'+
      '<div><span class="muted">Взвешенный балл</span><b>'+(ready ? score.toFixed(2) : '—')+'</b></div>'+
      '<div><span class="muted">Уровень</span><b>'+(ready ? esc(grGradeName(grade, true)) : '—')+'</b></div>'+
      '<div class="gr-result-note">'+(ready
        ? 'Проверьте и сохраните'
        : 'Отвечено '+answered+' из '+factors.length+' — балл появится после всех ответов')+'</div>'+
    '</div>'+
    '<div class="gr-acts">'+
      '<button class="btn gr-save"'+(ready ? '' : ' disabled')+'>Сохранить оценку</button>'+
    '</div>'+
  '</div>';

  box.innerHTML = h;

  box.querySelector('.gr-close').onclick = function(){ GR.form = null; box.innerHTML = ''; drawGradePositions(); };
  var factorsBtn = box.querySelector('.gr-open-factors');
  if(factorsBtn){
    factorsBtn.onclick = function(){
      S.gradingScope = 'position';
      S.gradingDir = '';
      openAdminPanel('gradingFactors');
    };
  }
  [].forEach.call(box.querySelectorAll('.gr-opt'), function(btn){
    btn.onclick = function(){
      GR.form.notes = $('grNotes') ? $('grNotes').value : GR.form.notes;
      GR.form.answers[parseInt(btn.getAttribute('data-f'), 10)] = parseInt(btn.getAttribute('data-v'), 10);
      // Ответ выбран — сворачиваем этот фактор и переходим к следующему
      // неотвеченному сами, а не оставляем всё развёрнутым.
      GR.form.editingFactor = null;
      drawGradeForm();
    };
  });
  [].forEach.call(box.querySelectorAll('.gr-factor-edit'), function(btn){
    btn.onclick = function(){
      GR.form.editingFactor = parseInt(btn.getAttribute('data-f'), 10);
      drawGradeForm();
    };
  });
  var saveBtn = box.querySelector('.gr-save');
  if(saveBtn) saveBtn.onclick = saveGradeForm;
}

function saveGradeForm(){
  var f = GR.form;
  if(!f) return;

  var body = {
    block: GR.block,
    job_title: f.jobTitle,
    factors: f.answers,
    notes: $('grNotes') ? $('grNotes').value : ''
  };

  call('apiGradingEvaluate', S.token, body).then(guardAsyncToTab(function(r){
    if(!r || !r.ok){
      toast((r && r.error) || 'Не удалось сохранить оценку', 'error');
      return;
    }
    toast(r.pending
      ? (r.message || 'Ваша оценка принята')
      : grGradeName(r.gradeLevel) + ' (балл ' + r.weightedScore + ')', 'success');
    GR.form = null;
    $('grForm').innerHTML = '';
    loadGradePositions();
  })).catch(function(){ toast('Нет связи с сервером', 'error'); });
}

/** Сводка: сколько должностей на каждом уровне. */
function loadGradingStats(){
  call('apiGradingStats', S.token).then(guardAsyncToTab(function(r){
    if(!r || !r.ok){
      $('grContent').innerHTML = '<div class="err">'+esc((r && r.error) || 'Не удалось загрузить сводку')+'</div>';
      return;
    }
    if(!r.total){
      $('grContent').innerHTML = '<div class="empty">Оценённых должностей пока нет</div>';
      return;
    }

    // Уровни по горизонтали, группы по вертикали — так видно перекос
    // (например, весь блок «Торговля» осел на 4-м уровне).
    var levels = [1, 2, 3, 4, 5];
    var byBlock = {};
    (r.rows || []).forEach(function(x){
      if(!byBlock[x.block_key]) byBlock[x.block_key] = {};
      byBlock[x.block_key][x.grade_level] = Number(x.n || 0);
    });

    var h = '<div class="gr-progress">Всего оценено должностей: <b>'+r.total+'</b></div>'+
      '<div class="tblwrap gr-tblwrap"><table class="co-tbl gr-tbl">'+
      '<thead><tr><th>Блок</th>'+levels.map(function(l){ return '<th>'+esc(grGradeName(l))+'</th>'; }).join('')+'<th>Итого</th></tr></thead><tbody>'+
      Object.keys(byBlock).map(function(key){
        var row = byBlock[key];
        var total = levels.reduce(function(s, l){ return s + (row[l] || 0); }, 0);
        return '<tr><td><b>'+esc(grBlockLabel(key) || key)+'</b></td>'+
          levels.map(function(l){
            var n = row[l] || 0;
            return '<td'+(n ? ' class="gr-cell-on"' : '')+'>'+(n || '—')+'</td>';
          }).join('')+
          '<td><b>'+total+'</b></td></tr>';
      }).join('')+
      '</tbody></table></div>';

    $('grContent').innerHTML = h;
  })).catch(guardAsyncToTab(function(){
    $('grContent').innerHTML = '<div class="err">Нет связи с сервером</div>';
  }));
}

// ═══════════════════════════════════════════════════════════
// ЭКРАН: Риски незаменимости ключевого персонала
// ═══════════════════════════════════════════════════════════

function openKeyRisks(initialTab){
  if(!canSeeKeyRisks()){
    toast('У вас нет доступа к рискам ключевого персонала', 'warn');
    if(S.appView === 'keyrisk') switchView('home');
    return;
  }
  if(initialTab) GR.riskTab = initialTab;
  var curTab = GR.riskTab || 'list';
  var titles = {
    list: { title: 'Ключевые сотрудники', icon: 'risk' },
    heat: { title: 'Тепловая карта рисков', icon: 'target' }
  };
  var tInfo = titles[curTab] || titles.list;
  var tabKey = 'keyrisk:' + curTab;

  if(window.WorkspaceTabs && WorkspaceTabs.openTab && !WorkspaceTabs.isInsideTabRun){
    WorkspaceTabs.openTab({
      key: tabKey, title: tInfo.title, icon: tInfo.icon,
      state: { appView: 'keyrisk', krTab: curTab, unit: null },
      run: function(){ openKeyRisks(curTab); }
    });
    return;
  }
  if(window.WorkspaceTabs && WorkspaceTabs.updateActiveTitle){
    WorkspaceTabs.updateActiveTitle(tInfo.title, tInfo.icon, tabKey);
  }

  S.appView = 'keyrisk';
  S.unit = null;
  saveNavState();
  renderTopNav();
  setTop(tInfo.title, userLabel(), false, tInfo.icon);
  $('bar').classList.add('hidden');
  $('body').onclick = null;

  $('body').innerHTML =
    '<div class="sub-tabs sub-tabs--sticky dash-tabbar"><div class="dash-tab-strip">'+
      '<button class="sub-tab '+(curTab === 'list' ? 'on' : '')+'" onclick="openKeyRisks(\'list\')">'+ic('risk', 14)+'Ключевые сотрудники</button>'+
      '<button class="sub-tab '+(curTab === 'heat' ? 'on' : '')+'" onclick="openKeyRisks(\'heat\')">'+ic('target', 14)+'Тепловая карта</button>'+
    '</div></div>'+
    '<div id="krContent" class="gr-content">Загрузка…</div>';

  if(curTab === 'heat') loadRiskHeatmap();
  else loadRiskList();
}

function loadRiskList(){
  var dir = grDirOf(GR.unit || (grUnits()[0] || {}).unit || '');
  Promise.all([
    call('apiKeyRiskList', S.token),
    (!GR.factors || GR.factorsDir !== dir) ? call('apiGradingFactors', S.token, dir) : Promise.resolve(GR.factors)
  ]).then(guardAsyncToTab(function(res){
    var r = res[0];
    if(res[1] && res[1].ok){ GR.factors = res[1]; GR.factorsDir = dir; }
    if(!r || !r.ok){
      $('krContent').innerHTML = '<div class="err">'+esc((r && r.error) || 'Не удалось загрузить список')+'</div>';
      return;
    }
    GR.risks = r.rows || [];
    GR.riskLevels = r.levels || [];
    drawRiskList();
  })).catch(guardAsyncToTab(function(){
    $('krContent').innerHTML = '<div class="err">Нет связи с сервером</div>';
  }));
}

function riskStatusBadge(status, label){
  var cls = status === 'critical' ? 'kr-critical' : (status === 'attention' ? 'kr-attention' : 'kr-standard');
  return '<span class="badge '+cls+'">'+esc(label || status)+'</span>';
}

function riskLevelOf(status){
  return (GR.riskLevels || []).filter(function(l){ return l.status === status; })[0] || { label: status };
}

function drawRiskList(){
  var h = '<div class="toolbar">'+
    (canEditKeyRisks() ? '<button id="krNew" class="btn">+ Оценить сотрудника</button>' : '')+
    '<span class="muted" style="margin-left:10px">Анкету заполняет руководитель по своим людям. '+
      'Данные видят только своё подразделение, C&amp;B и администратор.</span>'+
  '</div>'+
  '<div id="krForm" data-no-smart-filter="true"></div>';

  var canEdit = canEditKeyRisks();
  if(!GR.risks.length){
    h += '<div class="empty">Оценённых сотрудников пока нет</div>';
  } else {
    h += '<div class="tblwrap gr-tblwrap"><table class="co-tbl gr-tbl">'+
      '<thead><tr><th>Сотрудник</th><th>Должность</th><th>Подразделение</th><th>Баллы</th><th>Статус</th><th>Что делаем</th><th>Оценил</th></tr></thead><tbody>'+
      GR.risks.map(function(r, i){
        // Клик по строке — карточка просмотра (см. openRiskViewCard): что
        // именно выбрали по каждому вопросу. «Изменить» внутри неё уже
        // открывает форму (openRiskForm(existing)) с этими же ответами.
        return '<tr'+(canEdit ? ' class="gr-risk-row" data-i="'+i+'" title="Посмотреть ответы"' : '')+'>'+
          '<td><b>'+esc(r.employee_fio)+'</b></td>'+
          '<td>'+esc(r.job_title)+'</td>'+
          '<td>'+esc(r.unit)+'</td>'+
          '<td><b>'+r.total_risk_score+'</b> из 20</td>'+
          '<td>'+riskStatusBadge(r.risk_status, riskLevelOf(r.risk_status).label)+'</td>'+
          '<td class="kr-plan">'+esc(r.action_plan || '')+'</td>'+
          '<td class="muted">'+esc(r.evaluator_fio || '—')+'</td>'+
        '</tr>';
      }).join('')+
      '</tbody></table></div>';
  }

  $('krContent').innerHTML = h;
  if($('krNew')) $('krNew').onclick = function(){ openRiskForm(); };
  if(canEdit){
    [].forEach.call(document.querySelectorAll('#krContent .gr-risk-row'), function(tr){
      tr.onclick = function(){ openRiskViewCard(GR.risks[parseInt(this.dataset.i, 10)]); };
    });
  }
}

/** Карточка просмотра одной анкеты риска — 4 вопроса с выбранным вариантом,
 *  без редактирования. «Изменить» внутри открывает форму (openRiskForm). */
function openRiskViewCard(r){
  if(!r) return;
  var questions = (GR.factors && GR.factors.riskFactors) || [];
  var answers = [r.bus_factor, r.replacement_time, r.knowledge_monopoly, r.financial_risk];
  var level = riskLevelOf(r.risk_status);

  var el = document.createElement('div');
  el.className = 'sheet';
  var h = '<div class="sheet-in um-modal" style="max-width:640px">'+
    '<div class="sheet-hd"><b>'+ic('risk',16)+esc(r.employee_fio)+'</b>'+
      '<button class="btn-ghost" data-x="1">Закрыть</button></div>'+
    '<div style="padding:6px 0 2px">'+
      '<div class="muted" style="margin-bottom:10px">'+esc(r.job_title)+' · '+esc(r.unit)+'</div>'+
      questions.map(function(q, i){
        var val = Number(answers[i]) || 0;
        var chosen = val ? ((q.options || [])[val - 1] || '') : '—';
        // --card: у большой анкеты колонка под вопрос — 520px (там простор
        // всей страницы), в этой узкой модалке столько места нет.
        return '<div class="gr-factor gr-factor--done">'+
          '<div class="gr-factor-summary gr-factor-summary--card">'+
            '<div class="gr-factor-hd"><b>'+esc(q.code || ('Вопрос '+(i+1)))+'. '+esc(q.title)+'</b></div>'+
            '<div class="gr-factor-chosen">'+(val ? '<span class="gr-score gr-score--sm">'+val+'</span>' : '')+'<span>'+esc(chosen)+'</span></div>'+
          '</div>'+
        '</div>';
      }).join('')+
      '<div class="gr-result kr-result kr-'+r.risk_status+'" style="margin-top:12px">'+
        '<div><span class="muted">Индекс риска</span><b>'+r.total_risk_score+' из 20</b></div>'+
        '<div><span class="muted">Статус</span><b>'+esc(level.label)+'</b></div>'+
        (r.action_plan ? '<div class="gr-result-note">'+esc(r.action_plan)+'</div>' : '')+
      '</div>'+
      '<div class="muted" style="font-size:12.5px;margin-top:8px">Оценил: '+esc(r.evaluator_fio || '—')+'</div>'+
    '</div>'+
    '<div style="display:flex;justify-content:space-between;margin-top:14px">'+
      // Удаление стирает запись совсем (не «сбросить и переоценить») —
      // поэтому только системный админ, как и сброс оценки должности.
      (S.data && S.data.user && S.data.user.role === 'admin'
        ? '<button class="btn-line btn-danger" id="rvDelete">'+ic('trash',14)+'Удалить</button>'
        : '<span></span>')+
      '<button class="btn-primary" id="rvEdit">'+ic('pencil',14)+'Изменить</button>'+
    '</div>'+
  '</div>';
  el.innerHTML = h;
  document.body.appendChild(el);

  function close(){ if(el.parentNode) el.remove(); }
  el.addEventListener('click', function(e){
    if(e.target === el || e.target.closest('[data-x]')) close();
  });
  el.querySelector('#rvEdit').onclick = function(){
    close();
    openRiskForm(r);
  };
  var delBtn = el.querySelector('#rvDelete');
  if(delBtn){
    delBtn.onclick = function(){
      ask({
        title: 'Удалить оценку риска?',
        html: 'Карточка «'+esc(r.employee_fio)+'» пропадёт из списка ключевых сотрудников безвозвратно. Само подразделение и штатное расписание не затрагиваются.',
        ok: 'Удалить', cancel: 'Отмена', danger: true
      }).then(function(yes){
        if(!yes) return;
        call('apiKeyRiskDelete', S.token, r.id).then(function(res){
          if(!res || !res.ok){
            toast((res && res.error) || 'Не удалось удалить', 'error');
            return;
          }
          toast(res.message || 'Оценка удалена', 'success');
          close();
          loadRiskList();
        }).catch(function(){ toast('Нет связи с сервером', 'error'); });
      });
    };
  }
}

function loadRiskUnitEmployees(unit){
  if(!unit || GR.riskUnitEmployees[unit]) return;
  call('apiKeyRiskUnitEmployees', S.token, unit).then(function(r){
    GR.riskUnitEmployees[unit] = (r && r.ok) ? (r.rows || []) : [];
    if(GR.riskForm && GR.riskForm.unit === unit) drawRiskForm();
  }).catch(function(){
    GR.riskUnitEmployees[unit] = [];
    if(GR.riskForm && GR.riskForm.unit === unit) drawRiskForm();
  });
}

/**
 * existing — строка из GR.risks (клик по уже оценённому сотруднику в списке):
 * открывает ту же анкету, но с подставленными прошлыми ответами — иначе
 * заново оценить/посмотреть, что выбрали в прошлый раз, было решительно
 * негде (список показывал только итоговый балл, не разбивку по вопросам).
 * Повторная отправка формы с тем же unit+fio+job_title перезаписывает запись
 * (см. evaluateRiskCard на сервере — ON CONFLICT DO UPDATE), так что это
 * одновременно и «посмотреть», и «изменить».
 */
function openRiskForm(existing){
  var units = grUnits();
  if(!units.length){
    toast('Вам не назначено ни одного подразделения', 'warn');
    return;
  }
  if(existing){
    GR.riskForm = {
      unit: existing.unit,
      fio: existing.employee_fio,
      jobTitle: existing.job_title,
      answers: [existing.bus_factor, existing.replacement_time, existing.knowledge_monopoly, existing.financial_risk],
      plan: existing.action_plan || '',
      editingFactor: null
    };
    loadRiskUnitEmployees(existing.unit);
    drawRiskForm();
    return;
  }
  GR.riskForm = {
    // То же правило, что и на экране оценки: подставляем прошлый выбор, а не
    // первое подразделение из списка.
    unit: grInitialUnit(units),
    fio: '',
    jobTitle: '',
    answers: [0, 0, 0, 0],
    plan: '',
    editingFactor: null
  };
  drawRiskForm();
}

function drawRiskForm(){
  var f = GR.riskForm;
  var box = $('krForm');
  if(!f || !box) return;

  var questions = (GR.factors && GR.factors.riskFactors) || [];
  var levels = (GR.factors && GR.factors.riskLevels) || [];
  var answered = grAnswered(f.answers, questions.length);
  var ready = questions.length > 0 && answered === questions.length;
  var total = f.answers.reduce(function(s, v){ return s + (Number(v) || 0); }, 0);
  var level = null;
  if(ready){
    for(var i = 0; i < levels.length; i++){
      if(total <= levels[i].max){ level = levels[i]; break; }
    }
    if(!level) level = levels[levels.length - 1];
  }

  // ФИО — выпадающий список сотрудников этого подразделения (справочник
  // штата + учётки системы), а не свободный текст: должность подставляется
  // сама, вручную её больше не выбирают — раньше два независимых поля могли
  // разойтись (не тот человек с не той должностью).
  var employees = GR.riskUnitEmployees[f.unit];
  var employeesLoaded = Array.isArray(employees);
  var fioOptions = employeesLoaded ? employees : [];

  var h = '<div class="card gr-form">'+
    '<div class="gr-form-hd"><b>Анкета незаменимости</b><button class="btn-line kr-close">Закрыть</button></div>'+
    '<label class="lbl">Подразделение</label>'+
    grUnitPickerHtml('krUnit', f.unit)+
    '<label class="lbl">ФИО сотрудника</label>'+
    (!f.unit
      ? '<div class="muted" style="padding:8px 0">Сначала выберите подразделение</div>'
      : !employeesLoaded
      ? '<div class="muted" style="padding:8px 0">Загрузка списка сотрудников…</div>'
      : fioOptions.length
        ? '<select id="krFio"><option value="">— выберите —</option>'+
            fioOptions.map(function(p){
              return '<option value="'+esc(p.fio)+'"'+(p.fio === f.fio ? ' selected' : '')+'>'+esc(p.fio)+
                (p.position ? '' : ' (нет должности в карточке)')+'</option>';
            }).join('')+
          '</select>'
        : '<div class="muted" style="padding:8px 0">В этом подразделении нет сотрудников ни в справочнике штата, ни среди учёток системы. Если штат загружали давно — обновите справочник в «Сервисные утилиты», либо заведите сотрудника в «Пользователи».</div>')+
    '<label class="lbl">Должность</label>'+
    '<input id="krJob" value="'+esc(f.jobTitle)+'" readonly disabled placeholder="Подставится при выборе ФИО" style="opacity:.75">';

  // Тот же формат «один вопрос за раз», что и на экране оценки должностей
  // (см. drawGradeForm) — иначе анкета из 4 вопросов по 5 вариантов каждый
  // превращается в стену текста.
  var riskFirstUnanswered = -1;
  for(var ri = 0; ri < questions.length; ri++){
    if(!Number(f.answers[ri])){ riskFirstUnanswered = ri; break; }
  }
  var riskOpenFactor = (f.editingFactor != null) ? f.editingFactor : riskFirstUnanswered;

  questions.forEach(function(q, i){
    var val = Number(f.answers[i]) || 0;
    var isOpen = riskOpenFactor !== -1 && riskOpenFactor === i;
    var title = '<b>'+esc(q.code || ('Вопрос ' + (i + 1)))+'. '+esc(q.title)+'</b>';

    if(!isOpen){
      var chosen = val ? ((q.options || [])[val - 1] || '') : '';
      h += '<div class="gr-factor gr-factor--done" data-f="'+i+'">'+
        '<div class="gr-factor-summary">'+
          '<div class="gr-factor-hd">'+title+'</div>'+
          (val
            ? '<div class="gr-factor-chosen"><span class="gr-score gr-score--sm">'+val+'</span><span>'+esc(chosen)+'</span></div>'
            : '<div class="gr-factor-chosen muted">Ещё не отвечено</div>')+
        '</div>'+
        '<button type="button" class="btn-line gr-factor-edit" data-f="'+i+'">'+(val ? 'Изменить' : 'Ответить')+'</button>'+
      '</div>';
      return;
    }

    h += '<div class="gr-factor gr-factor--open">'+
      '<div class="gr-factor-hd">'+title+'</div>'+
      '<div class="gr-opts">'+
        (q.options || []).map(function(o, oi){
          var ov = oi + 1;
          return '<button class="gr-opt'+(val === ov ? ' on' : '')+'" data-f="'+i+'" data-v="'+ov+'">'+
            '<span class="gr-score">'+ov+'</span><span>'+esc(o)+'</span></button>';
        }).join('')+
      '</div>'+
    '</div>';
  });

  h += '<div class="gr-result kr-result'+(ready ? ' kr-' + level.status : '')+'">'+
      '<div><span class="muted">Индекс риска</span><b>'+(ready ? total + ' из 20' : '—')+'</b></div>'+
      '<div><span class="muted">Статус</span><b>'+(ready ? esc(level.label) : '—')+'</b></div>'+
      '<div class="gr-result-note">'+(ready
        ? esc(level.recommendation || '')
        : 'Отвечено '+answered+' из '+questions.length)+'</div>'+
    '</div>'+
    '<label class="lbl">Что делаем (можно дополнить или переписать рекомендацию)</label>'+
    '<textarea id="krPlan" rows="2" maxlength="2000" placeholder="'+
      esc(ready ? (level.recommendation || '') : 'Заполнится рекомендацией после ответов')+'">'+esc(f.plan)+'</textarea>'+
    '<div class="gr-acts"><button class="btn kr-save"'+(ready ? '' : ' disabled')+'>Сохранить оценку</button></div>'+
  '</div>';

  box.innerHTML = h;

  if(!employeesLoaded) loadRiskUnitEmployees(f.unit);

  // Подразделение хранится в f.unit: поле поиска по ходу набора показывает
  // запрос, а не выбранное значение, поэтому отсюда его не читаем. ФИО и
  // должность больше не читаем руками — ФИО меняется только через onchange
  // выпадающего списка (который сам обновляет f.fio/f.jobTitle), должность
  // вообще не редактируется.
  function pull(){
    f.plan = $('krPlan').value;
  }

  box.querySelector('.kr-close').onclick = function(){ GR.riskForm = null; box.innerHTML = ''; };
  var fioSelect = $('krFio');
  if(fioSelect){
    fioSelect.onchange = function(){
      var picked = fioOptions.filter(function(p){ return p.fio === fioSelect.value; })[0];
      f.fio = fioSelect.value;
      f.jobTitle = picked ? (picked.position || '') : '';
      pull();
      drawRiskForm();
    };
  }
  grBindUnitPicker('krUnit', function(unit){
    pull();
    f.unit = unit;
    store.set(LS_GR_UNIT, unit);
    // Сотрудник и должность подставляются из штатки выбранного подразделения —
    // прежний выбор мог к нему не относиться.
    f.fio = '';
    f.jobTitle = '';
    drawRiskForm();
  });
  [].forEach.call(box.querySelectorAll('.gr-opt'), function(btn){
    btn.onclick = function(){
      pull();
      f.answers[parseInt(btn.getAttribute('data-f'), 10)] = parseInt(btn.getAttribute('data-v'), 10);
      // Ответ выбран — сворачиваем этот вопрос и переходим к следующему
      // неотвеченному сами, как в анкете грейдирования.
      f.editingFactor = null;
      drawRiskForm();
    };
  });
  [].forEach.call(box.querySelectorAll('.gr-factor-edit'), function(btn){
    btn.onclick = function(){
      pull();
      f.editingFactor = parseInt(btn.getAttribute('data-f'), 10);
      drawRiskForm();
    };
  });
  var saveBtn = box.querySelector('.kr-save');
  if(saveBtn) saveBtn.onclick = function(){ pull(); saveRiskForm(); };
}

function saveRiskForm(){
  var f = GR.riskForm;
  if(!f) return;
  if(!f.unit){
    toast('Выберите подразделение', 'warn');
    return;
  }
  if(!f.fio.trim() || !f.jobTitle.trim()){
    toast('Укажите ФИО сотрудника и должность', 'warn');
    return;
  }

  var body = {
    unit: f.unit,
    employee_fio: f.fio,
    job_title: f.jobTitle,
    bus_factor: f.answers[0],
    replacement_time: f.answers[1],
    knowledge_monopoly: f.answers[2],
    financial_risk: f.answers[3],
    action_plan: f.plan
  };

  call('apiKeyRiskEvaluate', S.token, body).then(guardAsyncToTab(function(r){
    if(!r || !r.ok){
      toast((r && r.error) || 'Не удалось сохранить оценку', 'error');
      return;
    }
    toast(r.statusLabel + ' — ' + r.totalScore + ' баллов', 'success');
    GR.riskForm = null;
    loadRiskList();
  })).catch(function(){ toast('Нет связи с сервером', 'error'); });
}

/** Тепловая карта: сколько людей в каком статусе риска по направлениям. */
function loadRiskHeatmap(){
  call('apiKeyRiskHeatmap', S.token).then(guardAsyncToTab(function(r){
    if(!r || !r.ok){
      $('krContent').innerHTML = '<div class="err">'+esc((r && r.error) || 'Не удалось загрузить карту')+'</div>';
      return;
    }
    var rows = r.rows || [];
    if(!rows.length){
      $('krContent').innerHTML = '<div class="empty">Оценённых сотрудников пока нет</div>';
      return;
    }

    // Сортируем по числу критических: Правлению важно сначала увидеть,
    // где «горит».
    rows.sort(function(a, b){ return (b.critical - a.critical) || (b.total - a.total); });

    var h = '<div class="tblwrap gr-tblwrap"><table class="co-tbl gr-tbl kr-heat">'+
      '<thead><tr><th>Направление</th><th>Штатные</th><th>Зона внимания</th><th>Критический риск</th><th>Всего</th></tr></thead><tbody>'+
      rows.map(function(x){
        return '<tr>'+
          '<td><b>'+esc(x.dir)+'</b></td>'+
          '<td class="kr-cell kr-standard'+(x.standard ? ' on' : '')+'">'+(x.standard || '—')+'</td>'+
          '<td class="kr-cell kr-attention'+(x.attention ? ' on' : '')+'">'+(x.attention || '—')+'</td>'+
          '<td class="kr-cell kr-critical'+(x.critical ? ' on' : '')+'">'+(x.critical || '—')+'</td>'+
          '<td><b>'+x.total+'</b></td>'+
        '</tr>';
      }).join('')+
      '</tbody></table></div>';

    $('krContent').innerHTML = h;
  })).catch(guardAsyncToTab(function(){
    $('krContent').innerHTML = '<div class="err">Нет связи с сервером</div>';
  }));
}
