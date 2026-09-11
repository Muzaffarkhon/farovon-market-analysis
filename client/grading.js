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
  unit: '',
  rows: [],               // штатные должности выбранного подразделения
  form: null,             // открытая анкета оценки должности
  riskForm: null,         // открытая анкета риска
  risks: [],
  heat: []
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

function grGroup(key){
  var list = (GR.factors && GR.factors.groups) || [];
  return list.filter(function(g){ return g.key === key; })[0] || null;
}

/** Балл = сумма «оценка × вес». Повторяет gradingService.calcWeightedScore. */
function grScore(groupKey, answers){
  var g = grGroup(groupKey);
  if(!g) return 0;
  var sum = 0;
  g.weights.forEach(function(w, i){ sum += (Number(answers[i]) || 0) * w; });
  return Math.round(sum * 100) / 100;
}

/** Уровень по баллу. Пороги приходят с сервера — второй копии правил нет. */
function grGrade(groupKey, score){
  var g = grGroup(groupKey);
  var thresholds = (GR.factors && GR.factors.grades) || [];
  for(var i = 0; i < thresholds.length; i++){
    if(score >= thresholds[i].from) return thresholds[i].grade;
  }
  return (g && g.maxGrade) || 6;
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

/** Экран «Оценка должностей»: выбор подразделения → список должностей. */
function renderGradeAssess(){
  var units = grUnits();
  if(!units.length){
    $('grContent').innerHTML = '<div class="empty">Вам не назначено ни одного подразделения</div>';
    return;
  }
  GR.unit = grInitialUnit(units);

  var h = '<div class="toolbar">'+
    grUnitPickerHtml('grUnit', GR.unit)+
    (GR.unit ? '<span class="muted gr-dir">Направление: '+esc(grDirOf(GR.unit) || '—')+'</span>' : '')+
  '</div>'+
  '<div id="grList">'+(GR.unit ? skTable() : '')+'</div>'+
  '<div id="grForm"></div>';

  $('grContent').innerHTML = h;
  grBindUnitPicker('grUnit', function(unit){
    GR.unit = unit;
    store.set(LS_GR_UNIT, unit);
    GR.form = null;
    renderGradeAssess();
  });

  if(!GR.unit){
    $('grList').innerHTML = '<div class="empty">Выберите подразделение — покажем его штатные должности и грейды</div>';
    return;
  }
  loadGradePositions();
}

// ─── Выбор подразделения с поиском ───
// У admin и C&B в списке все 326 подразделений — обычный выпадающий список
// там бесполезен. Это не то же самое, что кнопка «Фильтр» над таблицей:
// фильтр отбирает строки уже загруженной таблицы, а здесь выбирается,
// данные какого подразделения вообще запрашивать у сервера.

var GR_PICK_LIMIT = 60;

function grUnitPickerHtml(id, current){
  return '<div class="gr-unitpick" id="'+id+'Box">'+
    '<div class="search-wrap gr-unitpick-in">'+icBare('search')+
      '<input id="'+id+'Input" value="'+esc(current || '')+'" '+
        'placeholder="Подразделение — начните вводить" autocomplete="off"></div>'+
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
  }

  input.onfocus = function(){ input.select(); draw(); };
  input.oninput = draw;
  input.onkeydown = function(e){
    if(e.key === 'Escape'){ hide(); input.blur(); }
  };
  input.onblur = function(){ setTimeout(hide, 150); };

  list.onmousedown = function(e){
    var btn = e.target.closest('.gr-unitrow');
    if(!btn) return;
    e.preventDefault();
    chosen = btn.getAttribute('data-u');
    input.value = chosen;
    list.hidden = true;
    onPick(chosen);
  };
}

function loadGradePositions(){
  var dir = grDirOf(GR.unit);
  var needFactors = !GR.factors || GR.factorsDir !== dir;

  Promise.all([
    call('apiGradingPositions', S.token, GR.unit),
    needFactors ? call('apiGradingFactors', S.token, dir) : Promise.resolve(GR.factors)
  ]).then(function(res){
    var pos = res[0];
    var factors = res[1];
    if(!pos || !pos.ok){
      $('grList').innerHTML = '<div class="err">'+esc((pos && pos.error) || 'Не удалось загрузить должности')+'</div>';
      return;
    }
    if(factors && factors.ok){
      GR.factors = factors;
      GR.factorsDir = dir;
    }
    GR.rows = pos.rows || [];
    drawGradePositions();
    if(GR.form) drawGradeForm();
  }).catch(function(){
    $('grList').innerHTML = '<div class="err">Нет связи с сервером</div>';
  });
}

function drawGradePositions(){
  if(!GR.rows.length){
    $('grList').innerHTML = '<div class="empty">В штатном расписании этого подразделения нет должностей</div>';
    return;
  }

  var done = GR.rows.filter(function(r){ return r.grade_level; }).length;
  var h = '<div class="gr-progress">Оценено <b>'+done+'</b> из '+GR.rows.length+' должностей</div>'+
    '<div class="tblwrap gr-tblwrap"><table class="co-tbl gr-tbl">'+
    '<thead><tr><th>Должность</th><th>Штат</th><th>Группа</th><th>Балл</th><th>Уровень</th><th></th></tr></thead><tbody>'+
    GR.rows.map(function(r, i){
      var g = r.group_type ? grGroup(r.group_type) : null;
      var open = GR.form && GR.form.jobTitle === r.job_title;
      return '<tr'+(open ? ' class="gr-row-open"' : '')+'>'+
        '<td><b>'+esc(r.job_title)+'</b></td>'+
        '<td>'+(r.staff_count || 0)+'</td>'+
        '<td>'+esc(g ? g.label : '—')+'</td>'+
        '<td>'+(r.weighted_score != null ? esc(String(r.weighted_score)) : '—')+'</td>'+
        '<td>'+(r.grade_level ? '<span class="badge b-active">Уровень '+r.grade_level+'</span>' : '<span class="badge">нет оценки</span>')+'</td>'+
        '<td><button class="btn-line gr-open" data-i="'+i+'">'+(r.grade_level ? 'Изменить' : 'Оценить')+'</button></td>'+
      '</tr>';
    }).join('')+
    '</tbody></table></div>';

  $('grList').innerHTML = h;
  [].forEach.call(document.querySelectorAll('#grList .gr-open'), function(btn){
    btn.onclick = function(){ openGradeForm(parseInt(btn.getAttribute('data-i'), 10)); };
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

  GR.form = {
    jobTitle: row.job_title,
    group: row.group_type || 'production',
    answers: [row.factor_1, row.factor_2, row.factor_3, row.factor_4].map(function(v){ return v || 0; }),
    notes: row.notes || ''
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

  var group = grGroup(f.group) || (GR.factors.groups || [])[0];
  if(!group) return;
  var factors = group.factors || [];
  var score = grScore(group.key, f.answers);
  var grade = grGrade(group.key, score);
  var answered = grAnswered(f.answers, factors.length);
  var ready = answered === factors.length;

  // Шапка липкая: в анкете производственной группы четыре блока вопросов,
  // и на середине прокрутки уже не видно, какую должность оцениваешь.
  // Там же держим текущий балл — иначе за ним пришлось бы листать вниз.
  var h = '<div class="card gr-form">'+
    '<div class="gr-form-hd">'+
      '<b>'+esc(f.jobTitle)+'</b>'+
      '<span class="muted">'+esc(GR.unit)+'</span>'+
      '<span class="gr-hd-score">'+(ready
        ? 'Балл <b>'+score.toFixed(2)+'</b> · Уровень <b>'+grade+'</b>'
        : 'Отвечено '+answered+' из '+factors.length)+'</span>'+
      '<button class="btn-line gr-close">Закрыть</button>'+
    '</div>'+
    '<label class="lbl">Функциональная группа</label>'+
    '<div class="gr-groups">'+
      (GR.factors.groups || []).map(function(g){
        return '<button class="gr-group'+(g.key === group.key ? ' on' : '')+'" data-g="'+esc(g.key)+'">'+
          esc(g.label)+'<small>'+g.factors.length+' фактора</small></button>';
      }).join('')+
    '</div>';

  factors.forEach(function(fac, i){
    var w = group.weights[i];
    h += '<div class="gr-factor">'+
      '<div class="gr-factor-hd"><b>'+esc(fac.code || ('Фактор ' + (i + 1)))+'. '+esc(fac.title)+'</b>'+
        '<span class="badge">вес '+Math.round(w * 100)+'%</span></div>'+
      (fac.help ? '<div class="muted gr-help">'+esc(fac.help)+'</div>' : '')+
      '<div class="gr-opts">'+
        (fac.options || []).map(function(o, oi){
          var val = oi + 1;
          return '<button class="gr-opt'+(Number(f.answers[i]) === val ? ' on' : '')+'" data-f="'+i+'" data-v="'+val+'">'+
            '<span class="gr-score">'+val+'</span><span>'+esc(o)+'</span></button>';
        }).join('')+
      '</div>'+
    '</div>';
  });

  h += '<label class="lbl">Обоснование комиссии (необязательно)</label>'+
    '<textarea id="grNotes" rows="2" maxlength="2000">'+esc(f.notes || '')+'</textarea>'+
    '<div class="gr-result'+(ready ? ' gr-result--ready' : '')+'">'+
      '<div><span class="muted">Взвешенный балл</span><b>'+(ready ? score.toFixed(2) : '—')+'</b></div>'+
      '<div><span class="muted">Уровень</span><b>'+(ready ? grade : '—')+'</b></div>'+
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
  [].forEach.call(box.querySelectorAll('.gr-group'), function(btn){
    btn.onclick = function(){
      var key = btn.getAttribute('data-g');
      if(key === GR.form.group) return;
      // У групп разное число факторов, поэтому ответы сбрасываем: молча
      // перенести «фактор 3» из одной анкеты в другую значило бы посчитать
      // балл по ответам на другие вопросы.
      GR.form.group = key;
      GR.form.answers = [0, 0, 0, 0];
      drawGradeForm();
    };
  });
  [].forEach.call(box.querySelectorAll('.gr-opt'), function(btn){
    btn.onclick = function(){
      GR.form.notes = $('grNotes') ? $('grNotes').value : GR.form.notes;
      GR.form.answers[parseInt(btn.getAttribute('data-f'), 10)] = parseInt(btn.getAttribute('data-v'), 10);
      drawGradeForm();
    };
  });
  var saveBtn = box.querySelector('.gr-save');
  if(saveBtn) saveBtn.onclick = saveGradeForm;
}

function saveGradeForm(){
  var f = GR.form;
  if(!f) return;
  var group = grGroup(f.group);
  if(!group) return;

  var body = {
    unit: GR.unit,
    job_title: f.jobTitle,
    group_type: group.key,
    factors: f.answers.slice(0, group.weights.length),
    notes: $('grNotes') ? $('grNotes').value : ''
  };

  call('apiGradingEvaluate', S.token, body).then(function(r){
    if(!r || !r.ok){
      toast((r && r.error) || 'Не удалось сохранить оценку', 'error');
      return;
    }
    toast('Уровень ' + r.gradeLevel + ' (балл ' + r.weightedScore + ')', 'success');
    GR.form = null;
    $('grForm').innerHTML = '';
    loadGradePositions();
  }).catch(function(){ toast('Нет связи с сервером', 'error'); });
}

/** Сводка: сколько должностей на каждом уровне. */
function loadGradingStats(){
  call('apiGradingStats', S.token).then(function(r){
    if(!r || !r.ok){
      $('grContent').innerHTML = '<div class="err">'+esc((r && r.error) || 'Не удалось загрузить сводку')+'</div>';
      return;
    }
    if(!r.total){
      $('grContent').innerHTML = '<div class="empty">Оценённых должностей пока нет</div>';
      return;
    }

    // Уровни по горизонтали, группы по вертикали — так видно перекос
    // (например, все АУП на 2-м уровне).
    var levels = [1, 2, 3, 4, 5, 6];
    var byGroup = {};
    (r.rows || []).forEach(function(x){
      if(!byGroup[x.group_type]) byGroup[x.group_type] = {};
      byGroup[x.group_type][x.grade_level] = Number(x.n || 0);
    });

    var h = '<div class="gr-progress">Всего оценено должностей: <b>'+r.total+'</b></div>'+
      '<div class="tblwrap gr-tblwrap"><table class="co-tbl gr-tbl">'+
      '<thead><tr><th>Группа</th>'+levels.map(function(l){ return '<th>Уровень '+l+'</th>'; }).join('')+'<th>Итого</th></tr></thead><tbody>'+
      Object.keys(byGroup).map(function(key){
        var g = grGroup(key);
        var row = byGroup[key];
        var total = levels.reduce(function(s, l){ return s + (row[l] || 0); }, 0);
        return '<tr><td><b>'+esc(g ? g.label : key)+'</b></td>'+
          levels.map(function(l){
            var n = row[l] || 0;
            return '<td'+(n ? ' class="gr-cell-on"' : '')+'>'+(n || '—')+'</td>';
          }).join('')+
          '<td><b>'+total+'</b></td></tr>';
      }).join('')+
      '</tbody></table></div>';

    $('grContent').innerHTML = h;
  }).catch(function(){
    $('grContent').innerHTML = '<div class="err">Нет связи с сервером</div>';
  });
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
  ]).then(function(res){
    var r = res[0];
    if(res[1] && res[1].ok){ GR.factors = res[1]; GR.factorsDir = dir; }
    if(!r || !r.ok){
      $('krContent').innerHTML = '<div class="err">'+esc((r && r.error) || 'Не удалось загрузить список')+'</div>';
      return;
    }
    GR.risks = r.rows || [];
    GR.riskLevels = r.levels || [];
    drawRiskList();
  }).catch(function(){
    $('krContent').innerHTML = '<div class="err">Нет связи с сервером</div>';
  });
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
  '<div id="krForm"></div>';

  if(!GR.risks.length){
    h += '<div class="empty">Оценённых сотрудников пока нет</div>';
  } else {
    h += '<div class="tblwrap gr-tblwrap"><table class="co-tbl gr-tbl">'+
      '<thead><tr><th>Сотрудник</th><th>Должность</th><th>Подразделение</th><th>Баллы</th><th>Статус</th><th>Что делаем</th></tr></thead><tbody>'+
      GR.risks.map(function(r){
        return '<tr>'+
          '<td><b>'+esc(r.employee_fio)+'</b></td>'+
          '<td>'+esc(r.job_title)+'</td>'+
          '<td>'+esc(r.unit)+'</td>'+
          '<td><b>'+r.total_risk_score+'</b> из 20</td>'+
          '<td>'+riskStatusBadge(r.risk_status, riskLevelOf(r.risk_status).label)+'</td>'+
          '<td class="kr-plan">'+esc(r.action_plan || '')+'</td>'+
        '</tr>';
      }).join('')+
      '</tbody></table></div>';
  }

  $('krContent').innerHTML = h;
  if($('krNew')) $('krNew').onclick = openRiskForm;
}

function openRiskForm(){
  var units = grUnits();
  if(!units.length){
    toast('Вам не назначено ни одного подразделения', 'warn');
    return;
  }
  GR.riskForm = {
    // То же правило, что и на экране оценки: подставляем прошлый выбор, а не
    // первое подразделение из списка.
    unit: grInitialUnit(units),
    fio: '',
    jobTitle: '',
    answers: [0, 0, 0, 0],
    plan: ''
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

  var positions = (S.data && S.data.positionsByUnit && S.data.positionsByUnit[f.unit]) || [];

  var h = '<div class="card gr-form">'+
    '<div class="gr-form-hd"><b>Анкета незаменимости</b><button class="btn-line kr-close">Закрыть</button></div>'+
    '<label class="lbl">Подразделение</label>'+
    grUnitPickerHtml('krUnit', f.unit)+
    '<label class="lbl">ФИО сотрудника</label>'+
    '<input id="krFio" value="'+esc(f.fio)+'" maxlength="300" placeholder="Например: Каримов Дилшод">'+
    '<label class="lbl">Должность</label>'+
    (positions.length
      ? '<select id="krJob"><option value="">— выберите —</option>'+
          positions.map(function(p){
            var name = typeof p === 'string' ? p : (p.position || p.name || '');
            return '<option value="'+esc(name)+'"'+(name === f.jobTitle ? ' selected' : '')+'>'+esc(name)+'</option>';
          }).join('')+
        '</select>'
      : '<input id="krJob" value="'+esc(f.jobTitle)+'" maxlength="300">');

  questions.forEach(function(q, i){
    h += '<div class="gr-factor">'+
      '<div class="gr-factor-hd"><b>'+esc(q.code || ('Вопрос ' + (i + 1)))+'. '+esc(q.title)+'</b></div>'+
      '<div class="gr-opts">'+
        (q.options || []).map(function(o, oi){
          var val = oi + 1;
          return '<button class="gr-opt'+(Number(f.answers[i]) === val ? ' on' : '')+'" data-f="'+i+'" data-v="'+val+'">'+
            '<span class="gr-score">'+val+'</span><span>'+esc(o)+'</span></button>';
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

  // Подразделение хранится в f.unit: поле поиска по ходу набора показывает
  // запрос, а не выбранное значение, поэтому отсюда его не читаем.
  function pull(){
    f.fio = $('krFio').value;
    f.jobTitle = $('krJob').value;
    f.plan = $('krPlan').value;
  }

  box.querySelector('.kr-close').onclick = function(){ GR.riskForm = null; box.innerHTML = ''; };
  grBindUnitPicker('krUnit', function(unit){
    pull();
    f.unit = unit;
    store.set(LS_GR_UNIT, unit);
    // Должности подставляются из штатки выбранного подразделения — прежняя
    // могла к нему не относиться.
    f.jobTitle = '';
    drawRiskForm();
  });
  [].forEach.call(box.querySelectorAll('.gr-opt'), function(btn){
    btn.onclick = function(){
      pull();
      f.answers[parseInt(btn.getAttribute('data-f'), 10)] = parseInt(btn.getAttribute('data-v'), 10);
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

  call('apiKeyRiskEvaluate', S.token, body).then(function(r){
    if(!r || !r.ok){
      toast((r && r.error) || 'Не удалось сохранить оценку', 'error');
      return;
    }
    toast(r.statusLabel + ' — ' + r.totalScore + ' баллов', 'success');
    GR.riskForm = null;
    loadRiskList();
  }).catch(function(){ toast('Нет связи с сервером', 'error'); });
}

/** Тепловая карта: сколько людей в каком статусе риска по направлениям. */
function loadRiskHeatmap(){
  call('apiKeyRiskHeatmap', S.token).then(function(r){
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
  }).catch(function(){
    $('krContent').innerHTML = '<div class="err">Нет связи с сервером</div>';
  });
}
