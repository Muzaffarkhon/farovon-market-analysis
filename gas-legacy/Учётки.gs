/**
 * ═════════════════════════════════════════════════════════════════
 * СЛИЯНИЕ ДВОЙНЫХ УЧЁТОК
 * ═════════════════════════════════════════════════════════════════
 * Дедупликация 20.08.2026 привела ФИО в «Участниках опроса» к полным формам,
 * но в «Пользователи» обе формы остались отдельными учётками: короткая
 * («Дилшод Ахмедов») и полная («Ахмедов Дилшод Гафурович») — разные логины,
 * разные роли, разные списки подразделений. На выгрузке от 21.08.2026 таких
 * пар 53, это 107 строк из 186.
 *
 * Практический вред: человеку выдали один логин из двух наугад. Пятеро
 * руководителей сидели под гостевой учёткой и видели урезанный список.
 *
 * ПРАВИЛО (решение заказчика): остаётся строка с полным ФИО — с отчеством.
 * Чтобы никто не потерял прав, на неё переносятся:
 *   • максимальная роль группы (hrbp > head > guest);
 *   • объединённый список подразделений.
 * Проигравшие строки НЕ удаляются, а гасятся: «Активен» = «нет».
 * Так решение обратимо и история входов не теряется.
 *
 * Если отчества нет ни у кого (обе формы короткие — 8 групп), правило
 * не решает, и победитель выбирается по роли.
 */

/** Отчество: русские и таджикские формы. */
function _этоОтчество_(w) {
  return /(ович|евич|овна|евна|ична|зода)$/.test(w);
}

/** Слова ФИО без отчеств — фамилия и имя. */
function _ядроФИО_(s) {
  const all = _normName_(s).split(' ').filter(function (w) { return w.length >= 2; });
  const core = all.filter(function (w) { return !_этоОтчество_(w); });
  return core.length >= 2 ? core : all;
}

/** Сколько значащих слов в ФИО. */
function _словФИО_(s) {
  return _normName_(s).split(' ').filter(function (w) { return w.length >= 2; }).length;
}

/**
 * Есть ли в ФИО НАСТОЯЩЕЕ отчество.
 * Считать слова нельзя: «Шохамид (Бобочон) Махмадов» — тоже три слова, но
 * третье это прозвище в скобках, а отчество как раз у второй формы —
 * «Махмадов Шохамид Шарифович». По числу слов правило выбирало не ту строку.
 */
function _фиоСОтчеством_(s) {
  return _normName_(s).split(' ').some(function (w) {
    return w.length >= 2 && _этоОтчество_(w);
  });
}

/**
 * Два слова считаем одним и тем же, если одно — начало другого и общая
 * часть не короче 4 букв. Так «Зебо» сходится с «Зебочон», а «Камол»
 * с «Камолчон», но «Шавкат» и «Шахзод» остаются разными людьми.
 */
function _словоСовпало_(a, b) {
  if (a === b) return true;
  const m = Math.min(a.length, b.length);
  if (m < 4) return false;
  return a.substring(0, m) === b.substring(0, m);
}

/** Сколько слов ядра совпало между двумя ФИО. */
function _совпадениеФИО_(ta, tb) {
  const used = {};
  let c = 0;
  for (let i = 0; i < ta.length; i++) {
    for (let j = 0; j < tb.length; j++) {
      if (used[j]) continue;
      if (_словоСовпало_(ta[i], tb[j])) { used[j] = true; c++; break; }
    }
  }
  return c;
}

function _рангРоли_(role) {
  const r = _normName_(role);
  if (r === 'hrbp') return 3;
  if (r === 'head') return 2;
  if (r === 'guest') return 1;
  return 0;
}

function _списокПодр_(s) {
  return _str_(s).split(';').map(function (x) { return x.trim(); }).filter(String);
}

/**
 * Собирает группы дублей и решает по каждой, что оставить.
 * Ничего не пишет — только считает.
 */
function _планСлияния_() {
  const sh = _sheet_(SH.USERS, true);
  if (!sh) return { groups: [], error: 'Листа «' + SH.USERS + '» нет' };
  const lr = sh.getLastRow();
  if (lr < 2) return { groups: [] };

  const lc = Math.max(sh.getLastColumn(), U.LASTIN + 1);
  const data = sh.getRange(1, 1, lr, lc).getValues();

  const items = [];
  for (let i = 1; i < data.length; i++) {
    const fio = _str_(data[i][U.FIO]);
    if (!fio) continue;
    items.push({
      row:   i + 1,
      login: _str_(data[i][U.LOGIN]),
      fio:   fio,
      role:  _str_(data[i][U.ROLE]),
      units: _списокПодр_(data[i][U.UNITS]),
      active: _normName_(data[i][U.ACTIVE]) !== 'нет',
      seen:  _str_(data[i][U.LASTIN]),
      core:  _ядроФИО_(fio),
      words: _словФИО_(fio),
      patr:  _фиоСОтчеством_(fio)
    });
  }

  // группируем: совпали и фамилия, и имя
  const taken = {};
  const groups = [];
  for (let i = 0; i < items.length; i++) {
    if (taken[i]) continue;
    const g = [items[i]];
    for (let j = i + 1; j < items.length; j++) {
      if (taken[j]) continue;
      if (items[i].core.length < 2 || items[j].core.length < 2) continue;
      if (_совпадениеФИО_(items[i].core, items[j].core) >= 2) { g.push(items[j]); taken[j] = true; }
    }
    taken[i] = true;
    if (g.length > 1) groups.push(g);
  }

  // по каждой группе — кого оставляем и что переносим
  const out = [];
  groups.forEach(function (g) {
    const sorted = g.slice().sort(function (a, b) {
      const pa = a.patr ? 1 : 0, pb = b.patr ? 1 : 0;
      if (pb !== pa) return pb - pa;                                   // с отчеством вперёд
      if (b.words !== a.words) return b.words - a.words;               // затем более полная форма
      const rr = _рангРоли_(b.role) - _рангРоли_(a.role);
      if (rr) return rr;
      const sa = a.seen ? 1 : 0, sb = b.seen ? 1 : 0;
      if (sb !== sa) return sb - sa;
      return b.units.length - a.units.length;
    });
    const keep = sorted[0];
    const drop = sorted.slice(1);

    let bestRole = keep.role;
    g.forEach(function (x) { if (_рангРоли_(x.role) > _рангРоли_(bestRole)) bestRole = x.role; });

    const seenU = {};
    const union = [];
    g.forEach(function (x) {
      x.units.forEach(function (u) {
        const k = _normUnit_(u);
        if (k && !seenU[k]) { seenU[k] = true; union.push(u); }
      });
    });
    const addUnits = union.filter(function (u) {
      const k = _normUnit_(u);
      return !keep.units.some(function (v) { return _normUnit_(v) === k; });
    });

    out.push({
      keep: keep,
      drop: drop,
      newRole: bestRole,
      roleChanged: _normName_(bestRole) !== _normName_(keep.role),
      union: union,
      addUnits: addUnits,
      noPatronymic: !keep.patr,
      sameLogin: drop.some(function (d) { return _normName_(d.login) === _normName_(keep.login); })
    });
  });

  // Группы, где отчества нет ни у кого, автоматика не трогает: правило
  // «остаётся строка с отчеством» их не решает, и заказчик проверяет их лично.
  const skipped = out.filter(function (g) { return g.noPatronymic; });
  const work    = out.filter(function (g) { return !g.noPatronymic; });

  return { groups: work, skipped: skipped };
}

function _текстПлана_(plan) {
  let roleUp = 0, unitsMoved = 0, withUnits = 0, dropCount = 0, sameLogin = 0;
  plan.groups.forEach(function (g) {
    if (g.roleChanged) roleUp++;
    if (g.addUnits.length) { withUnits++; unitsMoved += g.addUnits.length; }
    if (g.sameLogin) sameLogin++;
    dropCount += g.drop.length;
  });
  const skipped = (plan.skipped || []).length;
  return 'Групп к слиянию: ' + plan.groups.length + '\n' +
         'Будет погашено строк: ' + dropCount + '\n' +
         'Поднимется роль: ' + roleUp + '\n' +
         'Перенесётся подразделений: ' + unitsMoved + ' (в ' + withUnits + ' группах)\n' +
         (sameLogin ? 'Одинаковый логин в группе: ' + sameLogin + '\n' : '') +
         (skipped ? 'ПРОПУЩЕНО (отчества нет ни у кого, проверяются вручную): ' + skipped + '\n' : '');
}

/** Пропущенные группы — списком, чтобы было что проверять глазами. */
function _текстПропущенных_(plan) {
  const s = plan.skipped || [];
  if (!s.length) return '';
  return '\n\nНЕ ТРОНУТЫ — решайте вручную:\n' + s.map(function (g) {
    return '  • ' + [g.keep].concat(g.drop).map(function (a) {
      return a.login + ' [' + a.role + '] «' + a.fio + '»';
    }).join('  ↔  ');
  }).join('\n');
}

/**
 * ─────────────────────────────────────────────────────────────
 * ПРИВЕДЕНИЕ ФИО К ОДНОЙ ФОРМЕ
 * ─────────────────────────────────────────────────────────────
 * Слить учётки мало: панель HR BP отбирает подразделения строгим
 * сравнением строк —
 *     if (_cell_(divs[i], dm, 'hrbp') !== u.fio) continue;
 * — без всякой нормализации. Если в «Пользователи» осталась полная форма,
 * а в «Подразделениях» записана короткая, человек увидит пустую панель.
 * На выгрузке 21.08.2026 так ломались двое HR BP: «Аличон Собиров» (33
 * подразделения) и «Иброхимчон Боев» (45).
 *
 * Поэтому короткие формы заменяются на ту же каноническую строку, что
 * осталась в «Пользователи». После этого во всей таблице одна форма имени.
 *
 * ВАЖНО: менять ФИО можно только вместе с последующей перепривязкой ID —
 * в «Справочнике» под старым именем заведён свой Ч-номер. Правильный
 * порядок: слить учётки → привести ФИО → «Полная очистка и пересборка».
 */
function _картаПереименований_(plan) {
  const map = {};
  plan.groups.forEach(function (g) {
    g.drop.forEach(function (d) {
      const k = _normName_(d.fio);
      if (k && k !== _normName_(g.keep.fio) && !map[k]) map[k] = g.keep.fio;
    });
  });
  return map;
}

/** Листы и колонки, где лежат ФИО людей. «Обзор рынка» не трогаем: там «Кто заполнил» — история. */
function _ФИО_ЦЕЛИ_() { return [
  { sheet: SH.DIV,    mapFn: _divMap_,    keys: ['head', 'resp', 'hrbp'] },
  { sheet: SH.PEOPLE, mapFn: _peopleMap_, keys: ['fio', 'hrbp'] },
  { sheet: SH.COMP,   mapFn: _compMap_,   keys: ['resp', 'hrbp'] }
]; }

function _привестиФИО_(map, dryRun) {
  const lines = [];
  let total = 0;

  _ФИО_ЦЕЛИ_().forEach(function (job) {
    const sh = _sheet_(job.sheet, true);
    if (!sh) return;
    const lr = sh.getLastRow();
    if (lr < 2) return;

    const lc = Math.max(sh.getLastColumn(), 1);
    const rows = sh.getRange(1, 1, lr, lc).getValues();
    const m = job.mapFn(rows);
    let n = 0;

    job.keys.forEach(function (key) {
      const col = m[key];
      if (col === undefined || col < 0) return;
      _writeCol_(sh, col, 2, lr - 1, function (i, cur) {
        const want = map[_normName_(cur)];
        if (!want || want === _str_(cur)) return undefined;
        n++;
        return dryRun ? undefined : want;
      });
    });

    total += n;
    lines.push('• «' + job.sheet + '»: ' + n);
  });

  return { lines: lines, total: total };
}

/** Пункт меню: показать план, ничего не меняя. */
function проверитьСлияниеУчёток() {
  const ui = SpreadsheetApp.getUi();
  const plan = _планСлияния_();
  if (plan.error) { ui.alert('Ошибка', plan.error, ui.ButtonSet.OK); return; }
  if (!plan.groups.length) { ui.alert('Дублей нет', 'Каждое ФИО в «' + SH.USERS + '» встречается один раз.', ui.ButtonSet.OK); return; }

  const lines = plan.groups.slice(0, 12).map(function (g) {
    return '• «' + g.keep.fio + '» → ' + g.keep.login +
           (g.roleChanged ? '  [роль ' + g.keep.role + '→' + g.newRole + ']' : '') +
           (g.addUnits.length ? '  [+подр. ' + g.addUnits.length + ']' : '') +
           '\n     гасим: ' + g.drop.map(function (d) { return d.login; }).join(', ');
  });

  const ren = _привестиФИО_(_картаПереименований_(plan), true);

  ui.alert('План слияния учёток (ничего не изменено)',
    _текстПлана_(plan) +
    'Приведение ФИО в других листах: ' + ren.total + ' ячеек\n' +
    ren.lines.join('\n') + '\n' +
    '\nПравило: остаётся строка с отчеством; роль и подразделения переносятся.\n\n' +
    'Первые ' + lines.length + ' групп:\n' + lines.join('\n') +
    (plan.groups.length > 12 ? '\n… и ещё ' + (plan.groups.length - 12) : '') +
    _текстПропущенных_(plan),
    ui.ButtonSet.OK);
}

/** Пункт меню: выполнить слияние. */
function слитьУчётки() {
  const ui = SpreadsheetApp.getUi();
  const plan = _планСлияния_();
  if (plan.error) { ui.alert('Ошибка', plan.error, ui.ButtonSet.OK); return; }
  if (!plan.groups.length) { ui.alert('Дублей нет', 'Сливать нечего.', ui.ButtonSet.OK); return; }

  const renMap = _картаПереименований_(plan);
  const pre = _привестиФИО_(renMap, true);

  const ok = ui.alert('Слить двойные учётки',
    _текстПлана_(plan) +
    'Приведение ФИО в других листах: ' + pre.total + ' ячеек\n' +
    pre.lines.join('\n') + '\n\n' +
    'Остаётся строка с отчеством. На неё переносятся максимальная роль\n' +
    'и объединённый список подразделений — прав никто не теряет.\n' +
    'Вторая строка НЕ удаляется, а гасится: «Активен» = «нет».\n' +
    'Короткие формы имени в других листах заменяются на полную.\n\n' +
    'ПОСЛЕ ЭТОГО обязательно запустите «Полная очистка и пересборка\n' +
    'всех справочников» — иначе ID останутся от прежних написаний.\n' +
    _текстПропущенных_(plan) + '\n\n' +
    'Убедитесь, что есть копия таблицы. Продолжить?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    ui.alert('Ошибка', 'Таблица занята другим процессом. Повторите через минуту.', ui.ButtonSet.OK);
    return;
  }

  try {
    const sh = _sheet_(SH.USERS);
    let roleUp = 0, unitsMoved = 0, off = 0;

    plan.groups.forEach(function (g) {
      if (g.roleChanged) {
        sh.getRange(g.keep.row, U.ROLE + 1).setValue(g.newRole);
        roleUp++;
      }
      if (g.addUnits.length) {
        sh.getRange(g.keep.row, U.UNITS + 1).setValue(g.union.join('; '));
        unitsMoved += g.addUnits.length;
      }
      g.drop.forEach(function (d) {
        sh.getRange(d.row, U.ACTIVE + 1).setValue('нет');
        off++;
      });
    });

    const ren = _привестиФИО_(renMap, false);

    SpreadsheetApp.flush();
    _log_('меню', 'слияние учёток',
      'групп: ' + plan.groups.length + ', погашено: ' + off +
      ', ролей поднято: ' + roleUp + ', подразделений перенесено: ' + unitsMoved +
      ', ФИО приведено: ' + ren.total);

    ui.alert('Готово',
      'Групп обработано: ' + plan.groups.length + '\n' +
      'Погашено строк («Активен» = «нет»): ' + off + '\n' +
      'Поднято ролей: ' + roleUp + '\n' +
      'Перенесено подразделений: ' + unitsMoved + '\n' +
      'Приведено ФИО в других листах: ' + ren.total + '\n' +
      ren.lines.join('\n') + '\n\n' +
      'ТЕПЕРЬ ЗАПУСТИТЕ «Полная очистка и пересборка всех справочников»:\n' +
      'имена изменились, и ID под них надо перевыдать.\n\n' +
      'Строки учёток не удалены — всё возвращается сменой\n' +
      '«Активен» обратно на «да».',
      ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('Ошибка при слиянии', err.message, ui.ButtonSet.OK);
    _log_('ошибка', 'слияние учёток', err.message);
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * ─────────────────────────────────────────────────────────────
 * ПОДСВЕТКА ПАР, КОТОРЫЕ РЕШАЮТСЯ ВРУЧНУЮ
 * ─────────────────────────────────────────────────────────────
 * Группы, где отчества нет ни у кого, автоматика не трогает — правило
 * «остаётся строка с отчеством» их не решает. Красим обе строки жёлтым,
 * чтобы их было видно в списке, и пишем в примечание, с кем пара.
 *
 * Повторный запуск сначала снимает прежнюю заливку, поэтому функцию можно
 * гонять сколько угодно: после разбора очередной пары цвет уйдёт сам.
 */
function подсветитьСпорныеУчётки() {
  const ui = SpreadsheetApp.getUi();
  const plan = _планСлияния_();
  const sh = _sheet_(SH.USERS, true);
  if (!sh) { ui.alert('Ошибка', 'Нет листа «' + SH.USERS + '».', ui.ButtonSet.OK); return; }

  const lr = sh.getLastRow();
  if (lr < 2) { ui.alert('Пусто', 'В «' + SH.USERS + '» нет строк.', ui.ButtonSet.OK); return; }
  const lc = Math.max(sh.getLastColumn(), U.LASTIN + 1);

  // снимаем прежнюю подсветку со всего листа, кроме шапки
  const all = sh.getRange(2, 1, lr - 1, lc);
  all.setBackground(null);
  all.clearNote();

  const skipped = plan.skipped || [];
  if (!skipped.length) {
    SpreadsheetApp.flush();
    ui.alert('Спорных пар нет', 'Все дубли разобраны — подсвечивать нечего.', ui.ButtonSet.OK);
    return;
  }

  let painted = 0;
  skipped.forEach(function (g) {
    const members = [g.keep].concat(g.drop);
    members.forEach(function (a) {
      const others = members.filter(function (x) { return x.row !== a.row; })
                            .map(function (x) { return x.login + ' [' + x.role + '] «' + x.fio + '»'; });
      sh.getRange(a.row, 1, 1, lc)
        .setBackground('#ffe599')
        .setNote('Отчества нет ни у одной формы — правило не решает, нужен ваш выбор.\n' +
                 'Пара: ' + others.join('; '));
      painted++;
    });
  });

  SpreadsheetApp.flush();
  _log_('меню', 'подсветка спорных учёток', 'групп: ' + skipped.length + ', строк: ' + painted);

  ui.alert('Подсвечено',
    'Пар к разбору: ' + skipped.length + '\nСтрок закрашено жёлтым: ' + painted + '\n\n' +
    skipped.map(function (g) {
      return '• ' + [g.keep].concat(g.drop).map(function (a) {
        return a.login + ' «' + a.fio + '»';
      }).join('  ↔  ');
    }).join('\n') +
    '\n\nВ примечании к строке написано, с кем пара.\n' +
    'После разбора запустите ещё раз — заливка снимется.',
    ui.ButtonSet.OK);
}

/**
 * ─────────────────────────────────────────────────────────────
 * УДАЛЕНИЕ ПОГАШЕННЫХ УЧЁТОК
 * ─────────────────────────────────────────────────────────────
 * Слияние гасит дубли через «Активен» = «нет», не удаляя строк. Это удобно
 * ровно до того момента, пока в «Пароли (выдать)» лежит листок с паролем от
 * выключенной учётки: человеку выдают бумажку, он не может войти и не понимает
 * почему. Так было с mahsud.a — учётка погашена, а строка с паролем осталась.
 *
 * Эта функция убирает выключенные учётки совсем — и из «Пользователи», и из
 * раздаточного листа.
 *
 * УДАЛЕНИЕ НЕОБРАТИМО: назад сменой «Активен» уже не вернуть, и «Последний
 * вход» по этим логинам теряется. Запускать только осознанно и с копией.
 */
function удалитьНеактивныхПользователей() {
  const ui = SpreadsheetApp.getUi();
  const ush = _sheet_(SH.USERS, true);
  if (!ush) { ui.alert('Ошибка', 'Нет листа «' + SH.USERS + '».', ui.ButtonSet.OK); return; }

  const lr = ush.getLastRow();
  if (lr < 2) { ui.alert('Пусто', 'В «' + SH.USERS + '» нет строк.', ui.ButtonSet.OK); return; }

  const lc = Math.max(ush.getLastColumn(), U.LASTIN + 1);
  const data = ush.getRange(1, 1, lr, lc).getValues();

  const dead = [];
  for (let i = 1; i < data.length; i++) {
    const login = _str_(data[i][U.LOGIN]);
    if (!login) continue;
    if (_normName_(data[i][U.ACTIVE]) !== 'нет') continue;
    dead.push({
      row:   i + 1,
      login: login,
      fio:   _str_(data[i][U.FIO]),
      role:  _str_(data[i][U.ROLE]),
      seen:  _str_(data[i][U.LASTIN])
    });
  }

  if (!dead.length) { ui.alert('Нечего удалять', 'Выключенных учёток нет.', ui.ButtonSet.OK); return; }

  // Логин, который останется занят живой строкой: у таких дублей строку
  // в «Пароли (выдать)» трогать нельзя — она нужна выжившей учётке.
  const aliveLogins = {};
  for (let i = 1; i < data.length; i++) {
    const l = _normName_(data[i][U.LOGIN]);
    if (l && _normName_(data[i][U.ACTIVE]) !== 'нет') aliveLogins[l] = true;
  }
  const shared = dead.filter(function (d) { return aliveLogins[_normName_(d.login)]; });

  const withSeen = dead.filter(function (d) { return d.seen; });
  const sample = dead.slice(0, 15).map(function (d) {
    return '  ' + d.login + '  «' + d.fio + '»' + (d.seen ? '  (входил ' + d.seen + ')' : '');
  }).join('\n');

  const ok = ui.alert('Удалить выключенные учётки',
    'Строк в «' + SH.USERS + '» к удалению: ' + dead.length + '\n' +
    (withSeen.length ? 'Из них с историей входа: ' + withSeen.length + ' — она пропадёт.\n' : '') +
    (shared.length ? 'Логин занят и живой строкой (' + shared.length + '): ' +
       shared.map(function (d) { return d.login; }).join(', ') +
       ' — их строки в «' + SH.PWD + '» сохраним.\n' : '') +
    '\n' + sample + (dead.length > 15 ? '\n  … и ещё ' + (dead.length - 15) : '') +
    '\n\nВместе с ними уйдут их строки из «' + SH.PWD + '».\n' +
    'ОТМЕНИТЬ БУДЕТ НЕЛЬЗЯ. Продолжить?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    ui.alert('Ошибка', 'Таблица занята другим процессом. Повторите через минуту.', ui.ButtonSet.OK);
    return;
  }

  try {
    // Логины живых учёток. Из-за дублей один и тот же логин может стоять
    // и на выключенной строке, и на активной — так было у goibov.db: две
    // строки, один логин, одна погашена. Если чистить «Пароли (выдать)»
    // просто по логинам удаляемых строк, живая учётка останется без листка.
    const alive = {};
    for (let i = 1; i < data.length; i++) {
      const l = _normName_(data[i][U.LOGIN]);
      if (l && _normName_(data[i][U.ACTIVE]) !== 'нет') alive[l] = true;
    }

    const kill = {};
    dead.forEach(function (d) {
      const l = _normName_(d.login);
      if (!alive[l]) kill[l] = true;      // строку паролей трогаем, только если логин больше никем не занят
    });

    // сначала раздаточный лист, пока номера строк «Пользователи» ещё верны
    let pwdGone = 0;
    const psh = _sheet_(SH.PWD, true);
    if (psh && psh.getLastRow() > 1) {
      const pv = psh.getRange(2, 1, psh.getLastRow() - 1, PWD_COLS).getValues();
      const rows = [];
      for (let i = 0; i < pv.length; i++) {
        if (kill[_normName_(pv[i][PW.LOGIN])]) rows.push(i + 2);
      }
      rows.sort(function (a, b) { return b - a; })       // снизу вверх
          .forEach(function (r) { psh.deleteRow(r); pwdGone++; });
    }

    dead.map(function (d) { return d.row; })
        .sort(function (a, b) { return b - a; })
        .forEach(function (r) { ush.deleteRow(r); });

    SpreadsheetApp.flush();
    _log_('меню', 'удаление выключенных учёток',
      'учёток: ' + dead.length + ', строк паролей: ' + pwdGone);

    ui.alert('Готово',
      'Удалено учёток: ' + dead.length + '\n' +
      'Удалено строк в «' + SH.PWD + '»: ' + pwdGone,
      ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('Ошибка при удалении', err.message, ui.ButtonSet.OK);
    _log_('ошибка', 'удаление выключенных учёток', err.message);
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * ─────────────────────────────────────────────────────────────
 * СВЕРКА РАЗДАТОЧНОГО ЛИСТА С «ПОЛЬЗОВАТЕЛЯМИ»
 * ─────────────────────────────────────────────────────────────
 * ФИО и роль в «Пароли (выдать)» — копия, сделанная в момент выдачи. После
 * слияния учёток и подъёма ролей копия устарела: у Арипова в «Пользователи»
 * «Арипов Махсуд Махмудович», а на листке «Максуд Арипов» — третье написание.
 * Источник истины — «Пользователи», раздаточный лист подтягивается под него.
 */
function освежитьЛистПаролей() {
  const ui = SpreadsheetApp.getUi();
  const psh = _sheet_(SH.PWD, true);
  if (!psh || psh.getLastRow() < 2) { ui.alert('Пусто', 'Лист «' + SH.PWD + '» пуст.', ui.ButtonSet.OK); return; }

  const users = _valuesOpt_(SH.USERS);
  const byLogin = {};
  for (let i = 1; i < users.length; i++) {
    const l = _normName_(users[i][U.LOGIN]);
    if (l) byLogin[l] = { fio: _str_(users[i][U.FIO]), role: _str_(users[i][U.ROLE]) };
  }

  const lr = psh.getLastRow();
  const rows = psh.getRange(2, 1, lr - 1, PWD_COLS).getValues();
  let fioFixed = 0, roleFixed = 0;

  _writeCol_(psh, PW.FIO, 2, lr - 1, function (i, cur) {
    const u = byLogin[_normName_(rows[i][PW.LOGIN])];
    if (!u || !u.fio || u.fio === _str_(cur)) return undefined;
    fioFixed++;
    return u.fio;
  });

  _writeCol_(psh, PW.ROLE, 2, lr - 1, function (i, cur) {
    const u = byLogin[_normName_(rows[i][PW.LOGIN])];
    if (!u) return undefined;
    const ru = u.role === 'hrbp' ? 'HR BP' : (u.role === 'head' ? 'Руководитель' : 'Участник');
    if (ru === _str_(cur)) return undefined;
    roleFixed++;
    return ru;
  });

  SpreadsheetApp.flush();
  _log_('меню', 'освежить лист паролей', 'ФИО: ' + fioFixed + ', ролей: ' + roleFixed);
  ui.alert('Готово',
    'Приведено ФИО: ' + fioFixed + '\nОбновлено ролей: ' + roleFixed +
    '\n\nПароли и телефоны не тронуты.', ui.ButtonSet.OK);
}

/**
 * ─────────────────────────────────────────────────────────────
 * ЧИСТКА «ПАРОЛИ (ВЫДАТЬ)»
 * ─────────────────────────────────────────────────────────────
 * Строки с логинами, которых больше нет в «Пользователи». На 21.08.2026
 * таких 44 — остатки записей, удалённых при дедупликации. Проверено
 * поимённо: у всех есть живая учётка под другим логином, доступа никто
 * не теряет. Лист раздаточный, вход по нему не проверяется.
 */
function удалитьОсиротевшиеПароли() {
  const ui = SpreadsheetApp.getUi();
  const ush = _sheet_(SH.USERS, true);
  const psh = _sheet_(SH.PWD, true);
  if (!ush || !psh) { ui.alert('Ошибка', 'Нет листа «' + SH.USERS + '» или «' + SH.PWD + '».', ui.ButtonSet.OK); return; }

  const users = _valuesOpt_(SH.USERS);
  const logins = {};
  for (let i = 1; i < users.length; i++) {
    const l = _normName_(users[i][U.LOGIN]);
    if (l) logins[l] = true;
  }

  const pwd = _valuesOpt_(SH.PWD);
  const rows = [];
  for (let i = 1; i < pwd.length; i++) {
    const l = _normName_(pwd[i][PW.LOGIN]);
    if (l && !logins[l]) rows.push({ row: i + 1, login: _str_(pwd[i][PW.LOGIN]), fio: _str_(pwd[i][PW.FIO]) });
  }

  if (!rows.length) { ui.alert('Сирот нет', 'Все логины на листе «' + SH.PWD + '» есть в «' + SH.USERS + '».', ui.ButtonSet.OK); return; }

  const sample = rows.slice(0, 15).map(function (r) {
    return '  стр. ' + r.row + '  ' + r.login + (r.fio ? '  «' + r.fio + '»' : '  (ФИО пустое)');
  }).join('\n');

  const ok = ui.alert('Удалить осиротевшие строки паролей',
    'Строк к удалению: ' + rows.length + '\n\n' + sample +
    (rows.length > 15 ? '\n  … и ещё ' + (rows.length - 15) : '') +
    '\n\nЭто раздаточный лист, доступа эти строки не дают.\nУдалить безвозвратно?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  // снизу вверх, иначе номера поедут после первого же удаления
  rows.sort(function (a, b) { return b.row - a.row; })
      .forEach(function (r) { psh.deleteRow(r.row); });

  SpreadsheetApp.flush();
  _log_('меню', 'чистка паролей', 'удалено строк: ' + rows.length);
  ui.alert('Готово', 'Удалено строк: ' + rows.length, ui.ButtonSet.OK);
}
