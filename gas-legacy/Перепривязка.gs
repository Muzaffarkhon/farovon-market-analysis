/**
 * ═════════════════════════════════════════════════════════════════
 * ПЕРЕПРИВЯЗКА ID ПО НАЗВАНИЯМ
 * ═════════════════════════════════════════════════════════════════
 * Зачем это нужно.
 *
 * В листах «Конкуренты», «Подразделения» и «Участники опроса» рядом стоят
 * две колонки: ID_* и название. Название приходит из исходных файлов и всегда
 * верно; ID живёт только внутри таблицы. Как только «Справочник» пересобирается
 * (а он пересобирается по алфавиту, сквозной нумерацией), все прежние номера
 * перестают что-либо значить — но в листах-потребителях они остаются лежать
 * старыми значениями. Формулы VLOOKUP тянут имя ПО номеру, поэтому дальше
 * по цепочке подтягивается не тот человек, не то подразделение, не та компания.
 *
 * Проверка выгрузок от 21.08.2026 показала: битых ID-ячеек около 4 600,
 * в отдельных колонках 100 % строк. При этом ни одного названия, которого нет
 * в «Справочнике», — значит перепривязка по имени чинит всё до последней строки.
 *
 * Источник истины здесь — НАЗВАНИЕ. ID всегда переписывается под него.
 */

/**
 * Карты «нормализованное имя → ID» по блокам «Справочника».
 * _idПо_ на каждый вызов линейно просматривает весь блок; здесь обращений
 * тысячи, поэтому карты строятся один раз на прогон.
 */
function _картыИмён_() {
  const ref = _справочник_();
  const out = {};
  Object.keys(REF_BLOCKS).forEach(function (key) {
    const norm = (key === 'units') ? _normUnit_ : _normName_;
    const map = {};
    const list = ref[key] || [];
    for (let i = 0; i < list.length; i++) {
      const k = norm(list[i].name);
      if (k && map[k] === undefined) map[k] = list[i].id;   // первый выигрывает, как в _idПо_
    }
    out[key] = map;
  });
  return out;
}

/**
 * Какие пары «ID ↔ название» есть на каждом листе. Ключи — из *_SPEC.
 *
 * Намеренно функция, а не top-level const: список ссылается на SH и на _compMap_
 * из Code.gs, а порядок вычисления констант между файлами проекта не определён.
 * Константа могла бы инициализироваться раньше Code.gs и упасть на undefined.
 */
function _RELINK_JOBS_() { return [
  { sheet: SH.COMP,   mapFn: _compMap_, pairs: [
      { id: 'idComp', name: 'company', block: 'companies' },
      { id: 'idUnit', name: 'unit',    block: 'units'     },
      { id: 'idResp', name: 'resp',    block: 'people'    },
      { id: 'idHrbp', name: 'hrbp',    block: 'people'    },
      { id: 'idDir',  name: 'dir',     block: 'dirs'      }
  ]},
  { sheet: SH.DIV,    mapFn: _divMap_, pairs: [
      { id: 'idUnit', name: 'unit',    block: 'units'     },
      { id: 'idHead', name: 'head',    block: 'people'    },
      { id: 'idResp', name: 'resp',    block: 'people'    },
      { id: 'idHrbp', name: 'hrbp',    block: 'people'    },
      { id: 'idDir',  name: 'dir',     block: 'dirs'      }
  ]},
  { sheet: SH.PEOPLE, mapFn: _peopleMap_, pairs: [
      { id: 'id',     name: 'fio',     block: 'people'    },
      { id: 'idUnit', name: 'unit',    block: 'units'     },
      { id: 'idHrbp', name: 'hrbp',    block: 'people'    },
      { id: 'idDir',  name: 'dir',     block: 'dirs'      }
  ]}
]; }
// «Обзор рынка» в списке нет намеренно: там только названия (V.UNIT, V.COMPANY),
// ID-колонок не заведено, перепривязывать нечего.

/**
 * Проходит по всем парам и приводит ID к названию.
 * dryRun === true — только считает, ничего не пишет.
 * Возвращает массив строк отчёта и итоговые счётчики.
 */
function _перепривязатьID_(dryRun) {
  const maps = _картыИмён_();
  const lines = [];
  let totFixed = 0, totFilled = 0, totMiss = 0;

  _RELINK_JOBS_().forEach(function (job) {
    const sh = _sheet_(job.sheet, true);
    if (!sh) { lines.push('• «' + job.sheet + '» — листа нет, пропущен'); return; }
    const lr = sh.getLastRow();
    if (lr < 2) { lines.push('• «' + job.sheet + '» — пусто'); return; }

    const lc = Math.max(sh.getLastColumn(), 1);
    const rows = sh.getRange(1, 1, lr, lc).getValues();
    const m = job.mapFn(rows);
    const parts = [];

    job.pairs.forEach(function (p) {
      const idCol = m[p.id], nameCol = m[p.name];
      if (idCol === undefined || idCol < 0)   return;   // колонки ID нет — не наше дело
      if (nameCol === undefined || nameCol < 0) return; // не по чему привязывать

      const norm = (p.block === 'units') ? _normUnit_ : _normName_;
      const map = maps[p.block] || {};
      let fixed = 0, filled = 0, miss = 0;

      _writeCol_(sh, idCol, 2, lr - 1, function (i, cur) {
        const name = _str_(rows[i + 1][nameCol]);
        if (!name) return undefined;                    // нет названия — нечего искать
        const want = map[norm(name)];
        if (!want) { miss++; return undefined; }        // имени нет в справочнике — не трогаем
        const now = _str_(cur);
        if (now === want) return undefined;             // уже верный
        if (now) fixed++; else filled++;
        return dryRun ? undefined : want;               // в режиме проверки только считаем
      });

      if (fixed || filled || miss) {
        parts.push('    ' + p.id + ': исправлено ' + fixed +
                   (filled ? ', заполнено пустых ' + filled : '') +
                   (miss ? ', НЕ НАЙДЕНО в справочнике ' + miss : ''));
      }
      totFixed += fixed; totFilled += filled; totMiss += miss;
    });

    lines.push('• «' + job.sheet + '» (' + (lr - 1) + ' строк)' +
               (parts.length ? '\n' + parts.join('\n') : ' — всё уже верно'));
  });

  return { lines: lines, fixed: totFixed, filled: totFilled, miss: totMiss };
}

/** Пункт меню: показать, что будет исправлено, ничего не меняя. */
function проверитьПривязкуID() {
  const ui = SpreadsheetApp.getUi();
  const r = _перепривязатьID_(true);
  ui.alert('Проверка привязки ID (ничего не изменено)',
    r.lines.join('\n') + '\n\n' +
    'Всего под замену: ' + r.fixed + '\n' +
    'Пустых ID будет заполнено: ' + r.filled + '\n' +
    'Названий не найдено в «Справочнике»: ' + r.miss +
    (r.miss ? '\n\nЭти строки останутся как есть — их надо разобрать вручную.' : ''),
    ui.ButtonSet.OK);
}

/** Пункт меню: собственно перепривязка. */
function перепривязатьID() {
  const ui = SpreadsheetApp.getUi();
  const pre = _перепривязатьID_(true);

  const ok = ui.alert('Перепривязать ID по названиям',
    pre.lines.join('\n') + '\n\n' +
    'Будет исправлено ID: ' + pre.fixed + '\n' +
    'Заполнено пустых: ' + pre.filled + '\n' +
    'Не найдено в «Справочнике»: ' + pre.miss + '\n\n' +
    'Названия не меняются — переписываются только колонки ID_*.\n' +
    'Убедитесь, что есть копия таблицы. Продолжить?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    ui.alert('Ошибка', 'Таблица занята другим процессом. Повторите через минуту.', ui.ButtonSet.OK);
    return;
  }
  try {
    const r = _перепривязатьID_(false);
    SpreadsheetApp.flush();
    _log_('меню', 'перепривязка ID',
      'исправлено: ' + r.fixed + ', заполнено: ' + r.filled + ', не найдено: ' + r.miss);
    ui.alert('Готово',
      r.lines.join('\n') + '\n\n' +
      'Исправлено ID: ' + r.fixed + '\n' +
      'Заполнено пустых: ' + r.filled + '\n' +
      'Не найдено в «Справочнике»: ' + r.miss,
      ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('Ошибка при перепривязке', err.message, ui.ButtonSet.OK);
    _log_('ошибка', 'перепривязка ID', err.message);
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}
