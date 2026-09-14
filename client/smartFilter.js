// ═══════════════════════════════════════════════════════════
// УНИВЕРСАЛЬНЫЙ СМАРТ-ФИЛЬТР ТАБЛИЦ (В СТИЛЕ БИТРИКС24)
// ═══════════════════════════════════════════════════════════
// Предоставляет двухколоночное всплывающее окно фильтрации:
//  - Слева: пресеты («Все», «Без руководителя», «В компании» и пользовательские).
//  - Справа: настраиваемые поля с операторами (содержит, начинается, интервал дат и т.д.).
//  - В шапке таблицы: чипы активных фильтров и кнопка «Фильтр» со счётчиком.
// Работает для любых таблиц с классом .co-tbl.
(function(){
  var activeModal = null;
  var tableStates = new WeakMap();

  var ROLE_LABELS = {
    'admin': 'Администраторы (admin)',
    'cb': 'C&B Аналитики (cb)',
    'hrbp': 'HR BP (hrbp)',
    'dir_head': 'Руководители направлений',
    'head': 'Руководители отделов',
    'user': 'Сотрудники (user)'
  };

  function getHeaderRow(thead){
    if(!thead || !thead.rows.length) return null;
    for(var i = 0; i < thead.rows.length; i++){
      var r = thead.rows[i];
      if(!r.classList.contains('tbl-filt')) return r;
    }
    return thead.rows[0];
  }

  function getSig(table){
    var thead = table.tHead;
    if(!thead || !thead.rows.length) return 'tbl';
    var hrow = getHeaderRow(thead);
    return hrow ? _tfSig(hrow) : 'tbl';
  }

  function parseDateValue(str){
    if(!str) return null;
    str = String(str).trim();
    // DD.MM.YYYY [HH:mm[:ss]]
    var m = str.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:[,\s]+(\d{2}):(\d{2}))?/);
    if(m){
      var d = parseInt(m[1], 10), mo = parseInt(m[2], 10) - 1, y = parseInt(m[3], 10);
      var h = m[4] ? parseInt(m[4], 10) : 0, min = m[5] ? parseInt(m[5], 10) : 0;
      return new Date(y, mo, d, h, min);
    }
    // YYYY-MM-DD
    var m2 = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(m2){
      return new Date(parseInt(m2[1], 10), parseInt(m2[2], 10) - 1, parseInt(m2[3], 10));
    }
    var ts = Date.parse(str);
    return isNaN(ts) ? null : new Date(ts);
  }

  function getColumns(table){
    var thead = table.tHead;
    if(!thead || !thead.rows.length) return [];
    var hrow = getHeaderRow(thead);
    if(!hrow) return [];
    var cols = [];
    var tbody = table.tBodies[0];
    var rows = tbody ? [].filter.call(tbody.rows, function(r){
      return !r.classList.contains('tbl-filt') && !r.classList.contains('tbl-filt-empty');
    }) : [];

    for(var i = 0; i < hrow.cells.length; i++){
      var th = hrow.cells[i];
      var raw = th.textContent.replace(/[▲▼△▽↑↓]/g, '').trim();
      var norm = _tfNorm(raw);
      var isAction = !raw || /^(действ|инфо|коридор|меню|\.\.\.|⋮)/i.test(norm);
      var isNum = th.classList.contains('num');
      var vals = {};
      rows.slice(0, 80).forEach(function(r){
        var c = r.cells[i];
        if(c){
          var t = c.textContent.replace(/\s+/g, ' ').trim();
          if(t && t !== '—' && t.length < 40) vals[t] = true;
        }
      });
      var uVals = Object.keys(vals).sort();
      var isSelect = !isNum && uVals.length >= 2 && uVals.length <= 14;

      var isDate = !isAction && !isNum && (
        /дата|время|период|вход|срок|dt/i.test(norm) ||
        (uVals.length > 0 && uVals.every(function(v){ return /^\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2}/.test(v); }))
      );

      cols.push({
        index: i,
        name: raw || ('Колонка ' + (i + 1)),
        norm: norm,
        isAction: isAction,
        isNum: isNum,
        isDate: isDate,
        isSelect: isSelect,
        options: uVals
      });
    }

    // Для таблицы пользователей (.u-tbl) добавляем поля «Направление» и «Подразделение»
    if(table.classList.contains('u-tbl')){
      var dirSet = {};
      var unitSet = {};
      if(window.S && window.S.adminDivs){
        window.S.adminDivs.forEach(function(d){
          if(d.dir) dirSet[d.dir] = true;
          if(d.unit) unitSet[d.unit] = true;
        });
      }
      rows.forEach(function(r){
        var ds = (r.dataset.dirs || '').split(',');
        ds.forEach(function(d){ d = d.trim(); if(d) dirSet[d] = true; });
        var us = (r.dataset.units || '').split(',');
        us.forEach(function(u){ u = u.trim(); if(u) unitSet[u] = true; });
      });
      var dirList = Object.keys(dirSet).sort(function(a, b){ return a.localeCompare(b, 'ru'); });
      if(dirList.length > 0){
        cols.push({
          index: 'custom_dir',
          name: 'Направление',
          norm: 'направление',
          isAction: false,
          isNum: false,
          isDate: false,
          isSelect: true,
          options: dirList,
          isCustomField: true
        });
      }
      var unitList = Object.keys(unitSet).sort(function(a, b){ return a.localeCompare(b, 'ru'); });
      if(unitList.length > 0){
        cols.push({
          index: 'custom_unit',
          name: 'Подразделение',
          norm: 'подразделение',
          isAction: false,
          isNum: false,
          isDate: false,
          isSelect: true,
          options: unitList,
          isCustomField: true
        });
      }
    }

    return cols;
  }

  function getDefaultPresets(cols, rows){
    var presets = [{ id: 'all', name: 'Все записи', criteria: {} }];
    cols.forEach(function(c){
      if(c.isAction) return;
      if(/руковод|ответств/i.test(c.norm)){
        presets.push({ id: 'no_head', name: 'Без руководителя', criteria: { [c.index]: { op: 'contains', val: 'Не назначен' } } });
      }
      if(/hr\s*bp|hrbp/i.test(c.norm)){
        presets.push({ id: 'no_hrbp', name: 'Без HR BP', criteria: { [c.index]: { op: 'contains', val: 'Не назначен' } } });
      }
      if(/статус/i.test(c.norm) || (c.isSelect && c.options.indexOf('Активен') >= 0)){
        presets.push({ id: 'active', name: 'В компании (активные)', criteria: { [c.index]: { op: 'equals', val: 'Активен' } } });
        presets.push({ id: 'blocked', name: 'Заблокированные', criteria: { [c.index]: { op: 'equals', val: 'Заблокирован' } } });
      }
      if(/использован/i.test(c.norm)){
        presets.push({ id: 'used', name: 'С привязками (>0)', criteria: { [c.index]: { op: 'gt', val: '0' } } });
      }
      if(/^подразделен/i.test(c.norm) && c.index !== 'custom_unit'){
        presets.push({ id: 'no_units', name: 'Без подразделений (0)', criteria: { [c.index]: { op: 'equals', val: '0' } } });
      }
    });
    var hasGroups = rows.some(function(r){ return r.classList.contains('tr--group') || /смежн/i.test(r.textContent); });
    if(hasGroups){
      presets.push({ id: 'groups', name: 'Смежные группы', isGroupOnly: true, criteria: {} });
    }
    return presets;
  }

  function getStoredPresets(sig){
    try {
      var raw = localStorage.getItem('sf_presets_' + sig);
      return raw ? JSON.parse(raw) : [];
    } catch(e){ return []; }
  }

  function setStoredPresets(sig, list){
    try { localStorage.setItem('sf_presets_' + sig, JSON.stringify(list)); } catch(e){}
  }

  function isCriterionActive(crit){
    if(!crit) return false;
    if(typeof crit === 'string') return !!crit.trim();
    var op = crit.op || 'contains';
    if(op === 'today' || op === 'last7' || op === 'last30' || op === 'month') return true;
    if(op === 'any') return false;
    if(op === 'range' || op === 'date_interval'){
      return (crit.from !== undefined && crit.from !== '') || (crit.to !== undefined && crit.to !== '');
    }
    return crit.val !== undefined && String(crit.val).trim() !== '';
  }

  function matchDateCriterion(cellText, crit){
    var dt = parseDateValue(cellText);
    if(!dt) return false;
    var op = crit.op || 'any';
    if(op === 'any') return true;

    var now = new Date();
    var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var todayEnd = todayStart + 86400000;
    var cellTs = dt.getTime();

    if(op === 'today'){
      return cellTs >= todayStart && cellTs < todayEnd;
    }
    if(op === 'last7'){
      var t7 = todayStart - 7 * 86400000;
      return cellTs >= t7 && cellTs < todayEnd;
    }
    if(op === 'last30'){
      var t30 = todayStart - 30 * 86400000;
      return cellTs >= t30 && cellTs < todayEnd;
    }
    if(op === 'month'){
      return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth();
    }
    if(op === 'date_interval' || op === 'range'){
      var from = crit.from ? parseDateValue(crit.from) : null;
      var to = crit.to ? parseDateValue(crit.to) : null;
      if(from && cellTs < from.getTime()) return false;
      if(to){
        var toEnd = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime() + 86400000;
        if(cellTs >= toEnd) return false;
      }
      return true;
    }
    if(op === 'exact'){
      if(!crit.val) return true;
      var exactDt = parseDateValue(crit.val);
      if(!exactDt) return true;
      var exStart = new Date(exactDt.getFullYear(), exactDt.getMonth(), exactDt.getDate()).getTime();
      return cellTs >= exStart && cellTs < exStart + 86400000;
    }
    return true;
  }

  function matchNumCriterion(cellText, crit){
    var n = parseFloat(String(cellText).replace(/[^\d.,\-]/g, '').replace(/\s| /g, '').replace(',', '.'));
    if(isNaN(n)) return false;
    var op = crit.op || 'equals';

    if(op === 'range'){
      var a = crit.from !== undefined && crit.from !== '' ? parseFloat(crit.from) : NaN;
      var b = crit.to !== undefined && crit.to !== '' ? parseFloat(crit.to) : NaN;
      if(!isNaN(a) && n < a) return false;
      if(!isNaN(b) && n > b) return false;
      return true;
    }
    var v = crit.val !== undefined && crit.val !== '' ? parseFloat(crit.val) : NaN;
    if(isNaN(v)) return true;
    if(op === 'gt') return n > v;
    if(op === 'lt') return n < v;
    if(op === 'gte') return n >= v;
    if(op === 'lte') return n <= v;
    if(op === 'equals') return n === v;
    return true;
  }

  function matchTextCriterion(cellText, crit){
    var s = _tfNorm(cellText);
    var v = _tfNorm(crit.val || '');
    if(!v) return true;
    var op = crit.op || 'contains';

    if(op === 'contains') return s.indexOf(v) >= 0;
    if(op === 'starts_with') return s.indexOf(v) === 0;
    if(op === 'ends_with') return s.length >= v.length && s.slice(-v.length) === v;
    if(op === 'equals') return s === v;
    if(op === 'not_contains') return s.indexOf(v) < 0;
    return true;
  }

  function matchRowCriterion(row, colMeta, crit){
    if(!crit || !isCriterionActive(crit)) return true;

    // Специальное поле «Направление»
    if(colMeta && colMeta.index === 'custom_dir'){
      var dirVal = (typeof crit === 'string' ? crit : (crit.val || '')).trim().toLowerCase();
      if(!dirVal) return true;
      var rDirs = (row.dataset.dirs || '').split(',').map(function(x){ return x.trim().toLowerCase(); });
      return rDirs.some(function(d){ return d.indexOf(dirVal) >= 0; });
    }

    // Специальное поле «Подразделение»
    if(colMeta && colMeta.index === 'custom_unit'){
      var unitVal = (typeof crit === 'string' ? crit : (crit.val || '')).trim().toLowerCase();
      if(!unitVal) return true;
      var rUnits = (row.dataset.units || '').split(',').map(function(x){ return x.trim().toLowerCase(); });
      return rUnits.some(function(u){ return u.indexOf(unitVal) >= 0; });
    }

    var cell = row.cells[+colMeta.index];
    if(!cell) return true;
    var cellText = cell.textContent;

    if(typeof crit === 'string'){
      return _tfMatch(cellText, crit, colMeta.isNum);
    }

    if(colMeta.isDate) return matchDateCriterion(cellText, crit);
    if(colMeta.isNum) return matchNumCriterion(cellText, crit);
    if(colMeta.isSelect){
      var sv = (crit.val || '').trim();
      if(!sv) return true;
      return _tfNorm(cellText) === _tfNorm(sv);
    }
    return matchTextCriterion(cellText, crit);
  }

  function formatCriterionChip(colMeta, crit){
    var colName = colMeta ? colMeta.name : 'Поле';
    if(typeof crit === 'string') return { name: colName, val: crit };
    var op = crit.op || 'contains';
    if(op === 'today') return { name: colName, val: 'сегодня' };
    if(op === 'last7') return { name: colName, val: 'за 7 дней' };
    if(op === 'last30') return { name: colName, val: 'за 30 дней' };
    if(op === 'month') return { name: colName, val: 'текущий месяц' };
    if(op === 'range' || op === 'date_interval'){
      var f = crit.from || '...', t = crit.to || '...';
      return { name: colName, val: f + ' — ' + t };
    }
    var v = crit.val || '';
    if(colMeta && colMeta.name === 'Роль' && ROLE_LABELS[v]) v = ROLE_LABELS[v];
    var opNames = {
      'starts_with': 'начинается с «' + v + '»',
      'ends_with': 'заканчивается на «' + v + '»',
      'not_contains': 'не содержит «' + v + '»',
      'equals': '= ' + v,
      'gt': '> ' + v,
      'lt': '< ' + v,
      'gte': '>= ' + v,
      'lte': '<= ' + v,
      'exact': 'дата ' + v,
      'contains': v
    };
    return { name: colName, val: opNames[op] || v };
  }

  function applyFilter(table, state){
    var tbody = table.tBodies[0];
    if(!tbody) return;
    var rows = [].filter.call(tbody.rows, function(r){
      return !r.classList.contains('tbl-filt') && !r.classList.contains('tbl-filt-empty');
    });
    var visibleCount = 0;
    var criteria = state.criteria || {};
    var qGlobal = (state.qGlobal || '').trim().toLowerCase();
    var cols = state.cols || getColumns(table);

    var lastMainRowVisible = true;
    rows.forEach(function(r){
      if(r.classList.contains('sal-detail')){
        r.hidden = !lastMainRowVisible;
        return;
      }
      if(state.isGroupOnly && !(r.classList.contains('tr--group') || /смежн/i.test(r.textContent))){
        r.hidden = true; lastMainRowVisible = false; return;
      }
      var matchAll = Object.keys(criteria).every(function(colIdx){
        var crit = criteria[colIdx];
        var col = cols.filter(function(c){ return String(c.index) === String(colIdx); })[0];
        return matchRowCriterion(r, col || { index: colIdx }, crit);
      });
      if(matchAll && qGlobal){
        matchAll = [].some.call(r.cells, function(c){
          return _tfNorm(c.textContent).indexOf(qGlobal) >= 0;
        }) || (r.dataset.dirs && r.dataset.dirs.toLowerCase().indexOf(qGlobal) >= 0)
           || (r.dataset.units && r.dataset.units.toLowerCase().indexOf(qGlobal) >= 0);
      }
      r.hidden = !matchAll;
      if(r.dataset && r.dataset.login){
        var card = document.getElementById('ucard_' + r.dataset.login);
        if(card) card.hidden = !matchAll;
      }
      lastMainRowVisible = matchAll;
      if(matchAll) visibleCount++;
    });

    renderEmptyRow(tbody, visibleCount, cols.length, function(){ resetFilter(table); });
    renderActiveBar(table, state);
    updateTriggerBtn(state.triggerBtn, state);
  }

  function renderEmptyRow(tbody, visibleCount, colSpan, onReset){
    var ph = tbody.querySelector('tr.tbl-filt-empty');
    if(!visibleCount){
      if(!ph){
        ph = document.createElement('tr');
        ph.className = 'tbl-filt-empty';
        ph.innerHTML = '<td colspan="'+colSpan+'">Ничего не найдено по фильтру. '+
          '<button type="button" class="btn-line" style="margin-left:8px;padding:2px 10px;font-size:12px">Сбросить</button></td>';
        ph.querySelector('button').onclick = onReset;
        tbody.appendChild(ph);
      }
      ph.hidden = false;
    } else if(ph){ ph.hidden = true; }
  }

  function resetFilter(table){
    var state = tableStates.get(table);
    if(!state) return;
    state.criteria = {};
    state.qGlobal = '';
    state.presetId = 'all';
    state.presetName = '';
    state.isGroupOnly = false;
    applyFilter(table, state);
  }

  function updateTriggerBtn(btn, state){
    if(!btn) return;
    var activeCount = Object.keys(state.criteria || {}).filter(function(k){
      return isCriterionActive(state.criteria[k]);
    }).length + (state.qGlobal ? 1 : 0) + (state.isGroupOnly ? 1 : 0);

    var badge = btn.querySelector('.sf-badge');
    if(activeCount > 0){
      btn.classList.add('has-filters');
      if(badge){ badge.textContent = activeCount; badge.style.display = 'inline-flex'; }
    } else {
      btn.classList.remove('has-filters');
      if(badge){ badge.style.display = 'none'; }
    }
  }

  function renderActiveBar(table, state){
    if(!state.activeBar) return;
    var bar = state.activeBar;
    var h = '';
    var cols = state.cols || [];
    var count = 0;

    if(state.presetName && state.presetId !== 'all'){
      count++;
      h += '<span class="sf-chip"><span class="sf-chip-lbl">Пресет:</span> <span class="sf-chip-val">'+
        esc(state.presetName)+'</span><button type="button" class="sf-chip-del" data-type="preset">✕</button></span>';
    }
    if(state.qGlobal){
      count++;
      h += '<span class="sf-chip"><span class="sf-chip-lbl">Поиск:</span> <span class="sf-chip-val">«'+
        esc(state.qGlobal)+'»</span><button type="button" class="sf-chip-del" data-type="q">✕</button></span>';
    }
    Object.keys(state.criteria || {}).forEach(function(colIdx){
      var crit = state.criteria[colIdx];
      if(!isCriterionActive(crit)) return;
      count++;
      var col = cols.filter(function(c){ return String(c.index) === String(colIdx); })[0];
      var f = formatCriterionChip(col, crit);
      h += '<span class="sf-chip"><span class="sf-chip-lbl">'+esc(f.name)+':</span> <span class="sf-chip-val">'+
        esc(f.val)+'</span><button type="button" class="sf-chip-del" data-col="'+colIdx+'">✕</button></span>';
    });

    if(count > 0){
      h += '<button type="button" class="sf-reset-all">Сбросить всё</button>';
      bar.innerHTML = h;
      bar.style.display = 'flex';
      bar.onclick = function(e){
        var del = e.target.closest('.sf-chip-del');
        if(del){
          if(del.dataset.type === 'preset'){ state.presetId = 'all'; state.presetName = ''; state.isGroupOnly = false; }
          else if(del.dataset.type === 'q'){ state.qGlobal = ''; }
          else if(del.dataset.col !== undefined){ delete state.criteria[del.dataset.col]; }
          applyFilter(table, state);
          return;
        }
        if(e.target.closest('.sf-reset-all')) resetFilter(table);
      };
    } else {
      bar.innerHTML = '';
      bar.style.display = 'none';
    }
  }

  function renderFieldControlHtml(c, crit){
    var curVal = crit.val !== undefined ? crit.val : '';
    var op = crit.op;

    if(c.isSelect){
      var isRole = c.name === 'Роль';
      var opts = '<option value="">Все варианты</option>' + c.options.map(function(o){
        var lbl = (isRole && ROLE_LABELS[o]) ? ROLE_LABELS[o] : o;
        return '<option value="'+esc(o)+'"'+(curVal===o?' selected':'')+'>'+esc(lbl)+'</option>';
      }).join('');
      return '<select class="sf-field-select sf-val" data-col="'+c.index+'">'+opts+'</select>';
    }

    if(c.isDate){
      if(op === 'date_interval'){
        return '<div class="sf-range-row">'+
          '<input type="date" class="sf-range-input sf-from" title="От даты" data-col="'+c.index+'" value="'+esc(crit.from||'')+'">'+
          '<span class="sf-range-sep">—</span>'+
          '<input type="date" class="sf-range-input sf-to" title="До даты" data-col="'+c.index+'" value="'+esc(crit.to||'')+'">'+
        '</div>';
      }
      if(op === 'exact'){
        return '<input type="date" class="sf-field-input sf-val" data-col="'+c.index+'" value="'+esc(curVal)+'">';
      }
      if(op === 'today' || op === 'last7' || op === 'last30' || op === 'month'){
        var hints = {
          today: 'Фильтр за сегодняшний день',
          last7: 'Фильтр за последние 7 дней',
          last30: 'Фильтр за последние 30 дней',
          month: 'Фильтр за текущий календарный месяц'
        };
        return '<div style="font-size:12px;color:var(--subtle);padding:6px 2px">'+hints[op]+'</div>';
      }
      return '<div style="font-size:12px;color:var(--subtle);padding:6px 2px;opacity:.7">Без ограничения по дате</div>';
    }

    if(c.isNum){
      if(op === 'range'){
        return '<div class="sf-range-row">'+
          '<input type="number" step="any" class="sf-range-input sf-from" placeholder="От" data-col="'+c.index+'" value="'+esc(crit.from||'')+'">'+
          '<span class="sf-range-sep">—</span>'+
          '<input type="number" step="any" class="sf-range-input sf-to" placeholder="До" data-col="'+c.index+'" value="'+esc(crit.to||'')+'">'+
        '</div>';
      }
      return '<input type="number" step="any" class="sf-field-input sf-val" placeholder="Число..." data-col="'+c.index+'" value="'+esc(curVal)+'">';
    }

    // Текстовое поле
    return '<input type="text" class="sf-field-input sf-val" placeholder="Поиск…" data-col="'+c.index+'" value="'+esc(curVal)+'">';
  }

  function renderOperatorSelectHtml(c, op){
    if(c.isSelect) return '';

    var opts = '';
    if(c.isDate){
      opts = '<option value="any"'+(op==='any'?' selected':'')+'>Любая дата</option>'+
        '<option value="today"'+(op==='today'?' selected':'')+'>Сегодня</option>'+
        '<option value="last7"'+(op==='last7'?' selected':'')+'>За 7 дней</option>'+
        '<option value="last30"'+(op==='last30'?' selected':'')+'>За 30 дней</option>'+
        '<option value="month"'+(op==='month'?' selected':'')+'>Текущий месяц</option>'+
        '<option value="date_interval"'+(op==='date_interval'?' selected':'')+'>Интервал (от..до)</option>'+
        '<option value="exact"'+(op==='exact'?' selected':'')+'>Точная дата</option>';
    } else if(c.isNum){
      opts = '<option value="equals"'+(op==='equals'?' selected':'')+'>= равно</option>'+
        '<option value="gt"'+(op==='gt'?' selected':'')+'>&gt; больше</option>'+
        '<option value="lt"'+(op==='lt'?' selected':'')+'>&lt; меньше</option>'+
        '<option value="gte"'+(op==='gte'?' selected':'')+'>&gt;= больше или равно</option>'+
        '<option value="lte"'+(op==='lte'?' selected':'')+'>&lt;= меньше или равно</option>'+
        '<option value="range"'+(op==='range'?' selected':'')+'>Диапазон (от..до)</option>';
    } else {
      opts = '<option value="contains"'+(op==='contains'?' selected':'')+'>содержит</option>'+
        '<option value="starts_with"'+(op==='starts_with'?' selected':'')+'>начинается с</option>'+
        '<option value="ends_with"'+(op==='ends_with'?' selected':'')+'>заканчивается на</option>'+
        '<option value="equals"'+(op==='equals'?' selected':'')+'>точно равно</option>'+
        '<option value="not_contains"'+(op==='not_contains'?' selected':'')+'>не содержит</option>';
    }

    return '<select class="sf-op-select" data-col="'+c.index+'">'+opts+'</select>';
  }

  function buildModalHtml(state, defPresets, savedPresets){
    var tagHtml = (state.presetName && state.presetId !== 'all')
      ? '<span class="sf-header-tag">'+esc(state.presetName)+' <span class="sf-header-tag-del">✕</span></span>' : '';

    var presHtml = '<div class="sf-presets-title">Пресеты</div><div class="sf-presets-list">';
    defPresets.concat(savedPresets).forEach(function(p){
      var isAct = state.presetId === p.id;
      presHtml += '<div class="sf-preset-item'+(isAct?' is-active':'')+'" data-pid="'+esc(p.id)+'">'+
        '<span>'+esc(p.name)+'</span>'+
        (isAct ? '<span class="sf-preset-pin">'+icBare('pin', 12)+'</span>' : '')+
        (p.custom ? '<button type="button" class="sf-preset-del" data-del-pid="'+esc(p.id)+'">✕</button>' : '')+
      '</div>';
    });
    presHtml += '</div>';

    var fieldsHtml = '<div class="sf-fields-list">';
    state.cols.forEach(function(c){
      if(c.isAction || (state.hiddenCols && state.hiddenCols[c.index])) return;

      var rawCrit = (state.criteria && state.criteria[c.index]);
      var defOp = c.isNum ? 'equals' : (c.isDate ? 'any' : 'contains');
      var crit = typeof rawCrit === 'string'
        ? { op: defOp, val: rawCrit }
        : (rawCrit || { op: defOp, val: '' });

      var opSelectHtml = renderOperatorSelectHtml(c, crit.op || defOp);
      var controlHtml = renderFieldControlHtml(c, crit);

      fieldsHtml += '<div class="sf-field-row" data-col="'+c.index+'">'+
        '<span class="sf-field-drag">'+icBare('drag', 14)+'</span>'+
        '<div class="sf-field-main">'+
          '<div class="sf-field-header">'+
            '<label class="sf-field-label">'+esc(c.name)+'</label>'+
            opSelectHtml+
          '</div>'+
          '<div class="sf-control-wrap">'+controlHtml+'</div>'+
        '</div>'+
        '<button type="button" class="sf-field-del" data-hide-col="'+c.index+'" title="Скрыть поле">✕</button>'+
      '</div>';
    });
    fieldsHtml += '</div>';

    return '<div class="smart-filter-popover">'+
      '<div class="sf-header">'+
        '<div class="sf-header-search">'+tagHtml+
          '<input type="text" class="sf-header-input" placeholder="Поиск по всей таблице…" value="'+esc(state.qGlobal||'')+'">'+
          '<div class="sf-header-icons">'+
            '<button type="button" class="sf-header-btn-ic sf-clear-q" title="Очистить">✕</button>'+
            icBare('search', 15)+
          '</div>'+
        '</div>'+
        '<button type="button" class="sf-header-close" title="Закрыть">✕</button>'+
      '</div>'+
      '<div class="sf-body">'+
        '<div class="sf-sidebar">'+presHtml+
          '<div class="sf-sidebar-footer">'+
            '<button type="button" class="sf-btn-save-preset">'+icBare('plus', 12)+' Сохранить фильтр</button>'+
            '<button type="button" class="sf-btn-gear" title="Настройки пресетов">'+icBare('gear', 14)+'</button>'+
          '</div>'+
        '</div>'+
        '<div class="sf-fields-area">'+fieldsHtml+
          '<div class="sf-fields-links">'+
            '<button type="button" class="sf-link-add">+ Добавить поле</button>'+
            '<button type="button" class="sf-link-reset-fields">Вернуть поля по умолчанию</button>'+
          '</div>'+
        '</div>'+
      '</div>'+
      '<div class="sf-footer">'+
        '<button type="button" class="sf-btn-find">'+icBare('search', 15)+' Найти</button>'+
        '<button type="button" class="sf-btn-reset">Сбросить</button>'+
      '</div>'+
    '</div>';
  }

  function readFormCriteria(popover){
    var crit = {};
    [].forEach.call(popover.querySelectorAll('.sf-field-row[data-col]'), function(row){
      var colKey = row.dataset.col;
      var opSelect = row.querySelector('.sf-op-select');
      var op = opSelect ? opSelect.value : 'contains';
      var valInput = row.querySelector('.sf-val');
      var fromInput = row.querySelector('.sf-from');
      var toInput = row.querySelector('.sf-to');

      var cObj = {
        op: op,
        val: valInput ? valInput.value.trim() : '',
        from: fromInput ? fromInput.value.trim() : '',
        to: toInput ? toInput.value.trim() : ''
      };

      if(isCriterionActive(cObj)){
        crit[colKey] = cObj;
      }
    });
    return crit;
  }

  function openAddFieldModal(table, state){
    var hiddenList = state.cols.filter(function(c){
      return !c.isAction && state.hiddenCols && state.hiddenCols[c.index];
    });

    var bdrop = document.createElement('div');
    bdrop.className = 'sf-modal-backdrop';

    var innerHtml = '';
    if(!hiddenList.length){
      innerHtml = '<div class="sf-dialog-card">'+
        '<div class="sf-dialog-header">'+
          '<h3 class="sf-dialog-title">Все поля уже в фильтре</h3>'+
          '<button type="button" class="sf-dialog-close">✕</button>'+
        '</div>'+
        '<div class="sf-dialog-body">'+
          '<p style="margin:0;color:var(--subtle);font-size:13.5px">Все доступные столбцы таблицы уже отображаются на форме фильтрации.</p>'+
        '</div>'+
        '<div class="sf-dialog-footer">'+
          '<button type="button" class="btn-primary sf-dialog-btn-close">Понятно</button>'+
        '</div>'+
      '</div>';
    } else {
      var itemsHtml = hiddenList.map(function(c){
        return '<div class="sf-field-choice-item" data-add-col="'+c.index+'">'+
          icBare('plus', 13)+' <span>'+esc(c.name)+'</span>'+
        '</div>';
      }).join('');

      innerHtml = '<div class="sf-dialog-card">'+
        '<div class="sf-dialog-header">'+
          '<h3 class="sf-dialog-title">Добавить поле в фильтр</h3>'+
          '<button type="button" class="sf-dialog-close">✕</button>'+
        '</div>'+
        '<div class="sf-dialog-body">'+
          '<p style="margin:0 0 10px;font-size:13px;color:var(--subtle)">Выберите поле из списка для добавления в смарт-фильтр:</p>'+
          '<div class="sf-field-choice-list">'+itemsHtml+'</div>'+
        '</div>'+
        '<div class="sf-dialog-footer">'+
          '<button type="button" class="btn-line sf-dialog-btn-close">Отмена</button>'+
        '</div>'+
      '</div>';
    }

    bdrop.innerHTML = innerHtml;
    document.body.appendChild(bdrop);

    function closeDlg(){
      if(bdrop.parentNode) bdrop.parentNode.removeChild(bdrop);
      document.removeEventListener('keydown', onKeyDown);
    }
    function onKeyDown(e){
      if(e.key === 'Escape') closeDlg();
    }
    document.addEventListener('keydown', onKeyDown);

    bdrop.onclick = function(e){ if(e.target === bdrop) closeDlg(); };
    [].forEach.call(bdrop.querySelectorAll('.sf-dialog-close, .sf-dialog-btn-close'), function(b){
      b.onclick = closeDlg;
    });

    [].forEach.call(bdrop.querySelectorAll('.sf-field-choice-item'), function(it){
      it.onclick = function(){
        var colKey = it.dataset.addCol;
        if(state.hiddenCols){
          delete state.hiddenCols[colKey];
        }
        closeDlg();
        openFilterModal(table);
      };
    });
  }

  function openSavePresetModal(table, state, sig){
    var popover = activeModal ? activeModal.overlay.querySelector('.smart-filter-popover') : null;
    var curCrit = popover ? readFormCriteria(popover) : (state.criteria || {});

    var activeKeys = Object.keys(curCrit);
    var critPreview = activeKeys.map(function(k){
      var col = state.cols.filter(function(c){ return String(c.index) === String(k); })[0];
      var f = formatCriterionChip(col, curCrit[k]);
      return '<b>' + esc(f.name) + ':</b> ' + esc(f.val);
    }).join('; ');

    var bdrop = document.createElement('div');
    bdrop.className = 'sf-modal-backdrop';
    bdrop.innerHTML = '<div class="sf-dialog-card">'+
      '<div class="sf-dialog-header">'+
        '<h3 class="sf-dialog-title">Сохранить фильтр</h3>'+
        '<button type="button" class="sf-dialog-close">✕</button>'+
      '</div>'+
      '<div class="sf-dialog-body">'+
        '<label class="lbl" style="margin-top:0">Название фильтра *</label>'+
        '<input type="text" class="sf-dialog-input" id="sfPresetNameInput" placeholder="Например: Мои подразделения, Активные с телефоном…">'+
        (critPreview ? '<div style="margin-top:10px;font-size:12px;color:var(--subtle);line-height:1.4">Параметры: ' + critPreview + '</div>' : '')+
      '</div>'+
      '<div class="sf-dialog-footer">'+
        '<button type="button" class="btn-line sf-dialog-btn-close">Отмена</button>'+
        '<button type="button" class="btn-primary sf-dialog-btn-save">Сохранить</button>'+
      '</div>'+
    '</div>';

    document.body.appendChild(bdrop);
    var nameInp = bdrop.querySelector('#sfPresetNameInput');
    if(nameInp) setTimeout(function(){ nameInp.focus(); }, 40);

    function closeDlg(){
      if(bdrop.parentNode) bdrop.parentNode.removeChild(bdrop);
      document.removeEventListener('keydown', onKeyDown);
    }
    function onKeyDown(e){
      if(e.key === 'Escape') closeDlg();
    }
    document.addEventListener('keydown', onKeyDown);

    bdrop.onclick = function(e){ if(e.target === bdrop) closeDlg(); };
    [].forEach.call(bdrop.querySelectorAll('.sf-dialog-close, .sf-dialog-btn-close'), function(b){
      b.onclick = closeDlg;
    });

    function doSave(){
      var name = (nameInp.value || '').trim();
      if(!name){
        nameInp.focus();
        nameInp.style.borderColor = '#ef4444';
        return;
      }
      var list = getStoredPresets(sig);
      var newP = { id: 'custom_' + Date.now(), name: name, criteria: curCrit, custom: true };
      list.push(newP);
      setStoredPresets(sig, list);
      state.presetId = newP.id;
      state.presetName = newP.name;
      state.criteria = curCrit;
      closeDlg();
      openFilterModal(table);
    }

    bdrop.querySelector('.sf-dialog-btn-save').onclick = doSave;
    nameInp.onkeydown = function(e){ if(e.key === 'Enter'){ e.preventDefault(); doSave(); } };
  }

  function openFilterModal(table){
    closeFilterModal();
    var state = tableStates.get(table);
    if(!state) return;
    var freshCols = getColumns(table);
    if(freshCols && freshCols.length >= 2){
      state.cols = freshCols;
    }
    var sig = getSig(table);
    var defPresets = getDefaultPresets(state.cols, [].slice.call((table.tBodies[0]||{}).rows || []));
    var savedPresets = getStoredPresets(sig);
    var allPresets = defPresets.concat(savedPresets);

    var overlay = document.createElement('div');
    overlay.className = 'smart-filter-overlay';
    overlay.innerHTML = buildModalHtml(state, defPresets, savedPresets);
    document.body.appendChild(overlay);
    activeModal = { overlay: overlay, table: table, state: state };

    bindModalEvents(overlay, table, state, sig, allPresets);
  }

  function bindModalEvents(overlay, table, state, sig, allPresets){
    var popover = overlay.querySelector('.smart-filter-popover');
    overlay.onclick = function(e){ if(e.target === overlay) closeFilterModal(); };
    overlay.querySelector('.sf-header-close').onclick = closeFilterModal;

    var headerTagDel = overlay.querySelector('.sf-header-tag-del');
    if(headerTagDel){
      headerTagDel.onclick = function(){
        state.presetId = 'all'; state.presetName = ''; state.isGroupOnly = false;
        openFilterModal(table);
      };
    }

    var qInput = overlay.querySelector('.sf-header-input');
    overlay.querySelector('.sf-clear-q').onclick = function(){ qInput.value = ''; qInput.focus(); };

    // Пресеты
    [].forEach.call(overlay.querySelectorAll('.sf-preset-item'), function(it){
      it.onclick = function(e){
        if(e.target.closest('.sf-preset-del')) return;
        var pid = it.dataset.pid;
        var pr = allPresets.filter(function(x){ return x.id === pid; })[0];
        if(pr){
          state.presetId = pr.id; state.presetName = pr.id === 'all' ? '' : pr.name;
          state.isGroupOnly = !!pr.isGroupOnly;
          state.criteria = Object.assign({}, pr.criteria || {});
          openFilterModal(table);
        }
      };
    });

    // Удаление кастомного пресета
    [].forEach.call(overlay.querySelectorAll('.sf-preset-del'), function(btn){
      btn.onclick = function(e){
        e.stopPropagation();
        var pid = btn.dataset.delPid;
        var list = getStoredPresets(sig).filter(function(x){ return x.id !== pid; });
        setStoredPresets(sig, list);
        openFilterModal(table);
      };
    });

    // Сохранить пресет через центрированную модалку
    overlay.querySelector('.sf-btn-save-preset').onclick = function(){
      openSavePresetModal(table, state, sig);
    };

    // Смена оператора условия: локальное бесшовное обновление поля без перезагрузки модалки
    [].forEach.call(overlay.querySelectorAll('.sf-op-select'), function(sel){
      sel.onchange = function(){
        var colKey = sel.dataset.col;
        var row = sel.closest('.sf-field-row');
        if(!row) return;
        var col = state.cols.filter(function(c){ return String(c.index) === String(colKey); })[0];
        if(!col) return;

        var valInput = row.querySelector('.sf-val');
        var fromInput = row.querySelector('.sf-from');
        var toInput = row.querySelector('.sf-to');
        var crit = {
          op: sel.value,
          val: valInput ? valInput.value : '',
          from: fromInput ? fromInput.value : '',
          to: toInput ? toInput.value : ''
        };

        state.criteria = state.criteria || {};
        state.criteria[colKey] = crit;

        var wrap = row.querySelector('.sf-control-wrap');
        if(wrap){
          wrap.innerHTML = renderFieldControlHtml(col, crit);
          var newInp = wrap.querySelector('input');
          if(newInp && (col.isNum || col.isDate)){
            try { newInp.focus(); } catch(e){}
          }
        }
      };
    });

    // Скрыть поле (крестик у поля): плавное скрытие без пересоздания окна
    [].forEach.call(overlay.querySelectorAll('.sf-field-del'), function(btn){
      btn.onclick = function(){
        var hideCol = btn.dataset.hideCol;
        state.hiddenCols = state.hiddenCols || {};
        state.hiddenCols[hideCol] = true;
        if(state.criteria) delete state.criteria[hideCol];
        var row = btn.closest('.sf-field-row');
        if(row){
          row.style.opacity = '0';
          row.style.transform = 'scale(0.97)';
          row.style.transition = 'all 0.15s ease';
          setTimeout(function(){
            if(row && row.parentNode) row.parentNode.removeChild(row);
          }, 150);
        }
      };
    });

    // Вернуть поля по умолчанию
    overlay.querySelector('.sf-link-reset-fields').onclick = function(){
      state.hiddenCols = {}; openFilterModal(table);
    };

    // Добавить скрытое поле через красивую системную модалку
    overlay.querySelector('.sf-link-add').onclick = function(){
      openAddFieldModal(table, state);
    };

    // Найти
    function doFind(){
      state.criteria = readFormCriteria(popover);
      state.qGlobal = qInput.value.trim();
      applyFilter(table, state);
      closeFilterModal();
    }
    overlay.querySelector('.sf-btn-find').onclick = doFind;

    popover.addEventListener('keydown', function(e){
      if(e.key === 'Enter' && e.target && (e.target.tagName === 'INPUT' || e.target.classList.contains('sf-field-select'))){
        e.preventDefault();
        doFind();
      }
    });

    // Сбросить
    overlay.querySelector('.sf-btn-reset').onclick = function(){
      resetFilter(table);
      closeFilterModal();
    };
  }

  function closeFilterModal(){
    if(activeModal){
      if(activeModal.overlay && activeModal.overlay.parentNode){
        activeModal.overlay.parentNode.removeChild(activeModal.overlay);
      }
      activeModal = null;
    }
  }

  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && activeModal) closeFilterModal();
  });

  var _sfTableCounter = 0;

  function attachTrigger(table, state){
    var thead = table.tHead;
    if(!thead || !thead.rows.length) return;

    if(!table.dataset.sfId){
      table.dataset.sfId = 'sf_' + (++_sfTableCounter);
    }
    var sfId = table.dataset.sfId;

    var tblwrap = table.closest('.tblwrap') || table.parentElement;
    if(!tblwrap) return;

    // 1. Полоса чипов активных фильтров
    if(!state.activeBar || !state.activeBar.parentNode){
      var ab = document.querySelector('.sf-active-bar[data-for-sf="'+sfId+'"]');
      if(!ab){
        ab = document.createElement('div');
        ab.className = 'sf-active-bar';
        ab.dataset.forSf = sfId;
        ab.style.display = 'none';
        if(tblwrap && tblwrap.parentNode){
          tblwrap.parentNode.insertBefore(ab, tblwrap);
        }
      }
      state.activeBar = ab;
    }

    // 2. Ищем существующую кнопку или панель для встраивания
    var existingBtn = document.querySelector('.sf-trigger-btn[data-for-sf="'+sfId+'"]');
    if(existingBtn){
      state.triggerBtn = existingBtn;
      return;
    }

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sf-trigger-btn';
    btn.dataset.forSf = sfId;
    btn.title = 'Смарт-фильтр таблицы';
    btn.innerHTML = (typeof ic === 'function' ? ic('filter', 13) : (typeof icBare === 'function' ? icBare('filter', 13) : '')) + '<span>Фильтр</span><span class="sf-badge" style="display:none">0</span>';
    btn.onclick = function(){ openFilterModal(table); };
    state.triggerBtn = btn;

    // Ищем подходящую панель:
    // a) Непосредственно перед tblwrap
    var toolbar = null;
    var prev = tblwrap.previousElementSibling;
    while(prev && prev.classList && prev.classList.contains('sf-active-bar')){
      prev = prev.previousElementSibling;
    }

    // data-no-smart-filter здесь — не таблица, а произвольный блок (например
    // #krForm — открытая анкета с собственным полем поиска подразделения):
    // без этой проверки его search-wrap принимали за тулбар таблицы и
    // подсовывали кнопку «Фильтр» внутрь чужой формы (см. handoff).
    if(prev && prev.classList && !prev.hasAttribute('data-no-smart-filter') && (
      prev.classList.contains('toolbar') ||
      prev.classList.contains('org-tree-toolbar') ||
      prev.classList.contains('audit-toolbar') ||
      prev.classList.contains('dash-sec-head') ||
      prev.classList.contains('dash-filters') ||
      prev.classList.contains('dash-tab-bar') ||
      prev.querySelector('.search-wrap, .dash-sec-search, .org-tree-search-wrap')
    )){
      toolbar = prev;
    }

    // b) В контейнере выше таблицы
    if(!toolbar){
      var container = table.closest('.org-tree-wrapper, .audit-tblwrap, #dictBox, .dash-tab-scroll, #adminContent, .app-main') || tblwrap.parentElement;
      if(container){
        var tbs = container.querySelectorAll('.org-tree-toolbar, .toolbar, .audit-toolbar, .dash-sec-head, .dash-filters');
        for(var i = 0; i < tbs.length; i++){
          var tEl = tbs[i];
          if(tEl.compareDocumentPosition(tblwrap) & Node.DOCUMENT_POSITION_FOLLOWING){
            toolbar = tEl;
            break;
          }
        }
      }
    }

    if(toolbar){
      var existingInToolbar = toolbar.querySelector('.sf-trigger-btn');
      if(existingInToolbar){
        state.triggerBtn = existingInToolbar;
        existingInToolbar.onclick = function(){ openFilterModal(table); };
        return;
      }
      var searchWrap = toolbar.querySelector('.search-wrap, .dash-sec-search, .org-tree-search-wrap');
      if(searchWrap && searchWrap.nextSibling){
        searchWrap.parentNode.insertBefore(btn, searchWrap.nextSibling);
      } else if(searchWrap){
        searchWrap.parentNode.appendChild(btn);
      } else {
        if(toolbar.firstChild){
          toolbar.insertBefore(btn, toolbar.firstChild);
        } else {
          toolbar.appendChild(btn);
        }
      }
    } else {
      // Если тулбара нет совсем — создаём аккуратную полосу для таблицы
      var autoTb = document.createElement('div');
      autoTb.className = 'toolbar sf-auto-toolbar';
      autoTb.style.marginBottom = '8px';
      autoTb.dataset.forSf = sfId;
      autoTb.appendChild(btn);
      if(tblwrap && tblwrap.parentNode){
        tblwrap.parentNode.insertBefore(autoTb, state.activeBar || tblwrap);
      }
    }
  }

  function attach(table){
    if(!table || !table.classList.contains('co-tbl')) return;
    // Никогда не вешаем фильтр на сервисные таблицы и вложенные подтаблицы.
    // Отдельная проверка на «есть предок <table>» — общий случай (детализация
    // внутри зарплатных вилок и любые другие будущие вложенные таблицы),
    // не только перечисленные классы.
    if(table.hasAttribute('data-no-smart-filter') || table.closest('[data-no-smart-filter], tr, td, .sal-detail, .sub-tab-body, .rcards')) return;
    if(table.parentElement && table.parentElement.closest('table')) return;
    var cols = getColumns(table);
    if(cols.length < 2) return;

    var state = tableStates.get(table);
    if(!state){
      state = { criteria: {}, qGlobal: '', presetId: 'all', presetName: '', hiddenCols: {}, cols: cols };
      tableStates.set(table, state);
    } else {
      state.cols = cols;
    }

    attachTrigger(table, state);
  }

  window.SmartTableFilter = {
    attach: attach,
    open: openFilterModal,
    close: closeFilterModal,
    reset: resetFilter
  };
})();

  function attachAll(){
    if(!window.SmartTableFilter || !window.SmartTableFilter.attach) return;
    // Очистка старых кнопок фильтра, чьи таблицы были удалены из DOM
    document.querySelectorAll('.sf-trigger-btn').forEach(function(b){
      var forId = b.dataset.forSf;
      if(!forId || !document.querySelector('table[data-sf-id="' + forId + '"]')){
        b.remove();
      }
    });
    document.querySelectorAll('.sf-active-bar').forEach(function(ab){
      var forId = ab.dataset.forSf;
      if(!forId || !document.querySelector('table[data-sf-id="' + forId + '"]')){
        ab.remove();
      }
    });
    var tables = document.querySelectorAll('table.co-tbl');
    for(var i = 0; i < tables.length; i++){
      window.SmartTableFilter.attach(tables[i]);
    }
  }

  if(document.readyState !== 'loading'){
    attachAll();
  } else {
    document.addEventListener('DOMContentLoaded', attachAll);
  }

  if(typeof MutationObserver !== 'undefined'){
    var _moTimer = null;
    var observer = new MutationObserver(function(){
      clearTimeout(_moTimer);
      _moTimer = setTimeout(attachAll, 30);
    });
    if(document.body){
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', function(){
        observer.observe(document.body, { childList: true, subtree: true });
      });
    }
  }
