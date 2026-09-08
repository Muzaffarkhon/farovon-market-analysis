// ═══════════════════════════════════════════════════════════
// УНИВЕРСАЛЬНЫЕ ТАБЛИЦЫ: сортировка по клику + изменение ширины столбца
// ═══════════════════════════════════════════════════════════
// Работает через делегирование событий на document — не завязан на то, как
// именно и когда конкретная таблица отрисована (все таблицы в приложении
// строятся строками HTML в app.js через innerHTML, а не как постоянные
// DOM-компоненты), и поэтому не требует правок в каждой функции рендера
// отдельно: подключается один раз, применяется сразу ко всем таблицам с
// классом .co-tbl, включая те, что появятся в будущем.
//
// Не трогает заголовки, у которых УЖЕ есть своя сортировка
// (data-sort/data-rsort — «Зарплатные вилки» и «По регионам»), чтобы не
// повесить два конкурирующих обработчика клика на один и тот же <th>.
//
// Сортировка и ширина столбца не сохраняются между перерисовками таблицы
// (например, при обновлении фильтра) — это осознанное упрощение: большинство
// таблиц в приложении перестраивают innerHTML целиком при любом изменении
// данных, а «запоминать» состояние для каждой из них потребовало бы точно
// того же per-table кода, которого эта задача старается избежать.
(function(){
  var RESIZE_ZONE = 9; // px от правого края <th>, где курсор становится resize
                       // (должно совпадать с шириной .co-tbl thead th::before в style.css)

  function getCellText(row, idx){
    var cell = row.children[idx];
    return cell ? cell.textContent.trim() : '';
  }

  // Число (в т.ч. «1 234,5» / «12.3%») сравнивается как число, иначе — как
  // текст. Это покрывает подавляющее большинство колонок в приложении без
  // необходимости знать тип данных заранее.
  function sortValue(text){
    var cleaned = text.replace(/[\s ]/g, '').replace(',', '.').replace('%', '');
    if(cleaned !== '' && !isNaN(cleaned)) return parseFloat(cleaned);
    return text.toLowerCase();
  }

  function sortTable(table, colIdx, dir){
    var tbody = table.tBodies[0];
    if(!tbody) return;
    var rows = Array.prototype.slice.call(tbody.children).filter(function(r){ return r.tagName === 'TR'; });
    if(rows.length < 2) return;
    rows.sort(function(a, b){
      var va = sortValue(getCellText(a, colIdx));
      var vb = sortValue(getCellText(b, colIdx));
      if(typeof va === 'number' && typeof vb === 'number'){
        return dir === 'asc' ? va - vb : vb - va;
      }
      va = String(va); vb = String(vb);
      return dir === 'asc' ? va.localeCompare(vb, 'ru') : vb.localeCompare(va, 'ru');
    });
    rows.forEach(function(r){ tbody.appendChild(r); });
  }

  document.addEventListener('click', function(e){
    var th = e.target.closest('table.co-tbl thead th');
    if(!th || th.hasAttribute('data-sort') || th.hasAttribute('data-rsort')) return;
    if(th.dataset.justResized === '1') return; // клик сразу после протягивания ширины — не сортируем

    var table = th.closest('table');
    var headRow = th.parentNode;
    var colIdx = Array.prototype.indexOf.call(headRow.children, th);
    var nextDir = th.dataset.sortDir === 'asc' ? 'desc' : 'asc';

    Array.prototype.forEach.call(headRow.children, function(sib){ delete sib.dataset.sortDir; });
    th.dataset.sortDir = nextDir;

    sortTable(table, colIdx, nextDir);
  });

  // ── Изменение ширины столбца: тянем за правую границу заголовка ──
  var resizing = null;

  document.addEventListener('mousemove', function(e){
    if(resizing){
      var dx = e.clientX - resizing.startX;
      var w = Math.max(40, resizing.startWidth + dx);
      resizing.th.style.width = w + 'px';
      resizing.th.style.minWidth = w + 'px';
      resizing.th.style.maxWidth = w + 'px';
      e.preventDefault();
      return;
    }
    var th = e.target.closest('table.co-tbl thead th');
    if(!th){
      if(document.body.style.cursor === 'col-resize') document.body.style.cursor = '';
      return;
    }
    var rect = th.getBoundingClientRect();
    var nearEdge = rect.right - e.clientX <= RESIZE_ZONE && e.clientX <= rect.right;
    document.body.style.cursor = nearEdge ? 'col-resize' : '';
  });

  document.addEventListener('mousedown', function(e){
    var th = e.target.closest('table.co-tbl thead th');
    if(!th) return;
    var rect = th.getBoundingClientRect();
    if(rect.right - e.clientX <= RESIZE_ZONE && e.clientX <= rect.right){
      resizing = { th: th, startX: e.clientX, startWidth: rect.width };
      th.dataset.justResized = '1';
      th.classList.add('is-resizing'); // держит видимый разделитель, пока тянем
      e.preventDefault();
    }
  });

  document.addEventListener('mouseup', function(){
    if(!resizing) return;
    var th = resizing.th;
    resizing = null;
    document.body.style.cursor = '';
    th.classList.remove('is-resizing');
    // Небольшая задержка — иначе click, который браузер шлёт сразу после
    // mouseup, попадёт в обработчик сортировки выше и случайно пересортирует.
    setTimeout(function(){ delete th.dataset.justResized; }, 50);
  });

  // ═══════════════════════════════════════════════════════════
  // ПРАВАЯ КНОПКА МЫШИ ПО СТРОКЕ ТАБЛИЦЫ → контекстное меню
  // ═══════════════════════════════════════════════════════════
  // Если у строки есть свой «⋮» (пользователи, справочники) — просто открываем
  // его же меню. Иначе собираем меню из кнопок действий строки + «Копировать
  // строку» + сортировка по столбцу под курсором. Тем же делегированием на
  // document, что и сортировка выше — работает для любых таблиц .co-tbl.
  var ctxMenu = null;

  function closeCtxMenu(){
    if(ctxMenu){ ctxMenu.remove(); ctxMenu = null; }
    document.removeEventListener('keydown', ctxEsc, true);
    document.removeEventListener('scroll', closeCtxMenu, true);
  }
  function ctxEsc(e){ if(e.key === 'Escape') closeCtxMenu(); }

  function showCtxMenu(x, y, items){
    closeCtxMenu();
    if(!items.length) return;
    var m = document.createElement('div');
    m.className = 'row-menu-pop tbl-ctx-menu';
    m.setAttribute('role', 'menu');
    items.forEach(function(it){
      if(it.divider){
        var d = document.createElement('div');
        d.className = 'row-menu-divider';
        m.appendChild(d);
        return;
      }
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'row-menu-item' + (it.danger ? ' danger' : '');
      b.setAttribute('role', 'menuitem');
      b.textContent = it.label;
      b.onclick = function(ev){ ev.stopPropagation(); closeCtxMenu(); try { it.run(); } catch(e){} };
      m.appendChild(b);
    });
    document.body.appendChild(m);
    var mw = m.offsetWidth, mh = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(x, window.innerWidth - mw - 8)) + 'px';
    m.style.top = Math.max(8, Math.min(y, window.innerHeight - mh - 8)) + 'px';
    ctxMenu = m;
    setTimeout(function(){
      document.addEventListener('click', closeCtxMenu, { once: true });
      document.addEventListener('keydown', ctxEsc, true);
      document.addEventListener('scroll', closeCtxMenu, true);
    }, 0);
  }

  function rowLabel(btn){
    var t = (btn.textContent || '').replace(/\s+/g, ' ').trim();
    return t || btn.getAttribute('title') || btn.getAttribute('aria-label') || 'Действие';
  }

  document.addEventListener('contextmenu', function(e){
    var tr = e.target.closest('table.co-tbl tbody tr');
    if(!tr) return;
    // Не перехватываем правый клик по полю ввода/ссылке — там нужен родной контекст.
    if(e.target.closest('input, textarea, select, a[href]')) return;

    var table = tr.closest('table');

    // 1) У строки есть собственный «⋮» — открываем ровно его меню.
    var trigger = tr.querySelector('.row-menu-trigger');
    if(trigger){
      e.preventDefault();
      closeCtxMenu();
      trigger.click();
      return;
    }

    // 2) Собираем меню из кнопок действий строки.
    var items = [];
    var actionBtns = [].slice.call(tr.querySelectorAll('button, a[role="button"]')).filter(function(b){
      return b.offsetParent !== null && !b.disabled;
    });
    actionBtns.forEach(function(b){
      items.push({ label: rowLabel(b), run: function(){ b.click(); }, danger: /danger|del|archive|удал|блок|архив/i.test(b.className + ' ' + rowLabel(b)) });
    });

    // 3) Общие пункты: копировать строку + сортировка по столбцу под курсором.
    var cell = e.target.closest('td');
    var colIdx = cell ? Array.prototype.indexOf.call(tr.children, cell) : -1;
    if(items.length) items.push({ divider: true });
    items.push({
      label: 'Копировать строку',
      run: function(){
        var txt = Array.prototype.map.call(tr.children, function(td){
          return (td.textContent || '').replace(/\s+/g, ' ').trim();
        }).join('\t');
        if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt);
      }
    });
    if(colIdx >= 0 && table.tHead){
      var th = table.tHead.rows[0] && table.tHead.rows[0].children[colIdx];
      if(th && !th.hasAttribute('data-sort') && !th.hasAttribute('data-rsort')){
        items.push({ label: 'Сортировать по столбцу ↑', run: function(){ sortTable(table, colIdx, 'asc'); } });
        items.push({ label: 'Сортировать по столбцу ↓', run: function(){ sortTable(table, colIdx, 'desc'); } });
      }
    }

    if(!items.length) return;
    e.preventDefault();
    showCtxMenu(e.clientX, e.clientY, items);
  });
})();
