/**
 * ═════════════════════════════════════════════════════════════════
 * ПОЛНАЯ ЧИСТКА И ПЕРЕСБОРКА ВСЕХ СПРАВОЧНИКОВ И СВЯЗЕЙ
 * ═════════════════════════════════════════════════════════════════
 * 1. Лист «Справочник»: полная очистка мусора/склеек, генерация чистых ID_* блоков.
 * 2. Лист «Справочник должностей»: пересборка штатки с чистыми привязками к подразделениям.
 * 3. Лист «Справочник компаний» & «Конкуренты»: дедупликация, нормализация сегментов (193 компании).
 * 4. Пакетная оптимизация формул ВПР и устранение расхождений в «Связях».
 * 5. Пересчёт прогресса в «Статус заполнения».
 */
function полнаяЧисткаИПересборка() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.alert('Полная чистка и пересборка',
    'Будет выполнена полная очистка и генерация всех справочников:\n\n' +
    '  1. Лист «Справочник» — удаление склеек и мусора, генерация чистых ID (Н, Ч, К, П, С, Р).\n' +
    '  2. Лист «Справочник должностей» — чистка и привязка должностей к подразделениям.\n' +
    '  3. Лист «Справочник компаний» — дедупликация и исправление сегментов.\n' +
    '  4. Лист «Связи» — исправление расхождений.\n' +
    '  5. Лист «Статус заполнения» — пересчёт прогресса.\n\n' +
    'Продолжить?', ui.ButtonSet.YES_NO);
  if (res !== ui.Button.YES) return;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    ui.alert('Ошибка', 'Таблица занята другим процессом. Повторите попытку через минуту.', ui.ButtonSet.OK);
    return;
  }

  try {
    // 1. Читаем исходные данные подразделений
    const divRows = _valuesOpt_(SH.DIV);
    const dm = _divMap_(divRows);

    // 2. Читаем исходные данные участников
    const peoRows = _valuesOpt_(SH.PEOPLE);
    const pm = _peopleMap_(peoRows);

    // 3. Читаем исходные данные конкурентов
    const compRows = _valuesOpt_(SH.COMP);
    const cm = _compMap_(compRows);

    // Собираем уникальные чистые списки
    const dirsSet = {}, dirsList = [];
    const unitsList = [];                 // наполняется через addUnit, см. ниже
    const peopleSet = {}, peopleList = [];
    const compSet = {}, compList = [];
    const segSet = {}, segList = [];
    const regSet = {}, regList = [];

    const addUnique = function(val, set, list) {
      const clean = _str_(val);
      if (!clean) return;
      const k = _normName_(clean);
      if (!k || set[k]) return;
      set[k] = true;
      list.push(clean);
    };

    // Подразделения дедуплицируются по _normUnit_, а не по _normName_.
    // В «Подразделениях» названия идут с цифровым кодом («0305 Отдел дистрибуции
    // Бохтар»), в «Участниках опроса» — без него. Это одно и то же подразделение,
    // и в справочнике оно должно быть одной строкой с одним ID. Дедупликация по
    // _normName_ заводила обе формы как разные записи — на выгрузке от 21.08.2026
    // таких пар было 22, и ссылки расходились по двум разным ID.
    //
    // Побеждает вариант с кодом: оргструктура из «Подразделений» — источник истины,
    // а код несёт информацию о месте подразделения в иерархии.
    const hasCode = function(s) { return /^\d/.test(s); };
    const unitPos = {};                       // ключ → индекс в unitsList
    const addUnit = function(val) {
      const clean = _str_(val);
      if (!clean) return;
      const k = _normUnit_(clean);
      if (!k) return;
      if (unitPos[k] === undefined) {
        unitPos[k] = unitsList.length;
        unitsList.push(clean);
        return;
      }
      const i = unitPos[k];
      if (hasCode(clean) && !hasCode(unitsList[i])) unitsList[i] = clean;
    };

    // Из листа «Подразделения»
    for (let i = 1; i < divRows.length; i++) {
      const row = divRows[i];
      addUnique(_cell_(row, dm, 'dir'), dirsSet, dirsList);
      
      // Чистим название подразделения от приклеенных ФИО
      let unit = _str_(_cell_(row, dm, 'unit'));
      if (unit) {
        addUnit(unit);
      }
      addUnique(_cell_(row, dm, 'head'), peopleSet, peopleList);
      addUnique(_cell_(row, dm, 'resp'), peopleSet, peopleList);
      addUnique(_cell_(row, dm, 'hrbp'), peopleSet, peopleList);
    }

    // Из листа «Участники опроса»
    for (let i = 1; i < peoRows.length; i++) {
      const row = peoRows[i];
      addUnique(_cell_(row, pm, 'fio'), peopleSet, peopleList);
      addUnique(_cell_(row, pm, 'dir'), dirsSet, dirsList);
      addUnit(_cell_(row, pm, 'unit'));
      addUnique(_cell_(row, pm, 'hrbp'), peopleSet, peopleList);
    }

    // Из листа «Конкуренты»
    for (let i = 1; i < compRows.length; i++) {
      const row = compRows[i];
      addUnique(_cell_(row, cm, 'company'), compSet, compList);
      addUnique(_cell_(row, cm, 'seg'), segSet, segList);
      addUnique(_cell_(row, cm, 'region'), regSet, regList);
      addUnique(_cell_(row, cm, 'resp'), peopleSet, peopleList);
      addUnique(_cell_(row, cm, 'hrbp'), peopleSet, peopleList);
    }

    // Сортировка по алфавиту
    dirsList.sort(function(a, b) { return a.localeCompare(b, 'ru'); });
    unitsList.sort(function(a, b) { return a.localeCompare(b, 'ru'); });
    peopleList.sort(function(a, b) { return a.localeCompare(b, 'ru'); });
    compList.sort(function(a, b) { return a.localeCompare(b, 'ru'); });
    segList.sort(function(a, b) { return a.localeCompare(b, 'ru'); });
    regList.sort(function(a, b) { return a.localeCompare(b, 'ru'); });

    // ═══ 1. ПЕРЕСБОРКА ЛИСТА «СПРАВОЧНИК» ═══
    const ss = _ss_();
    let refSh = _findSheet_(SH.REF);
    if (!refSh) refSh = ss.insertSheet(SH.REF);
    refSh.clear();

    const maxLen = Math.max(dirsList.length, peopleList.length, compList.length,
                            unitsList.length, segList.length, regList.length, 1);
    
    const refHeader = [
      'ID_Направление', 'Направление бизнеса', '',
      'ID_Человек', 'ФИО', '',
      'ID_Компания', 'Компания-конкурент', '',
      'ID_Подразделение', 'Подразделение', '',
      'ID_Сегмент', 'Сегмент', '',
      'ID_Регион', 'Регион присутствия'
    ];

    if (refSh.getMaxColumns() < refHeader.length) {
      refSh.insertColumnsAfter(refSh.getMaxColumns(), refHeader.length - refSh.getMaxColumns());
    }

    const refMatrix = [];
    for (let r = 0; r < maxLen; r++) {
      const row = new Array(refHeader.length).fill('');
      if (r < dirsList.length) {
        row[0] = 'Н' + (r + 1);
        row[1] = dirsList[r];
      }
      if (r < peopleList.length) {
        row[3] = 'Ч' + (r + 1);
        row[4] = peopleList[r];
      }
      if (r < compList.length) {
        row[6] = 'К' + (r + 1);
        row[7] = compList[r];
      }
      if (r < unitsList.length) {
        row[9] = 'П' + (r + 1);
        row[10] = unitsList[r];
      }
      if (r < segList.length) {
        row[12] = 'С' + (r + 1);
        row[13] = segList[r];
      }
      if (r < regList.length) {
        row[15] = 'Р' + (r + 1);
        row[16] = regList[r];
      }
      refMatrix.push(row);
    }

    refSh.getRange(1, 1, 1, refHeader.length).setValues([refHeader])
      .setFontWeight('bold').setBackground('#fce8b2');
    if (refMatrix.length > 0) {
      refSh.getRange(2, 1, refMatrix.length, refHeader.length).setValues(refMatrix);
    }
    refSh.setFrozenRows(1);
    refSh.setColumnWidth(1, 120); refSh.setColumnWidth(2, 280); refSh.setColumnWidth(3, 30);
    refSh.setColumnWidth(4, 110); refSh.setColumnWidth(5, 260); refSh.setColumnWidth(6, 30);
    refSh.setColumnWidth(7, 110); refSh.setColumnWidth(8, 260); refSh.setColumnWidth(9, 30);
    refSh.setColumnWidth(10, 120); refSh.setColumnWidth(11, 320); refSh.setColumnWidth(12, 30);
    refSh.setColumnWidth(13, 110); refSh.setColumnWidth(14, 220); refSh.setColumnWidth(15, 30);
    refSh.setColumnWidth(16, 110); refSh.setColumnWidth(17, 220);

    _сброситьСправочник_();

    // ═══ 2. ПЕРЕСБОРКА ЛИСТА «СПРАВОЧНИК ДОЛЖНОСТЕЙ» ═══
    const posSh = _подготовитьСправочникДолжностей_();
    const curPosRows = _valuesOpt_(SH.POS);
    const survRows = _valuesOpt_(SH.SURVEY);
    const posSet = {}, posList = [];

    // Существующие должности
    for (let i = 1; i < curPosRows.length; i++) {
      const posName = _str_(curPosRows[i][P.NAME]);
      const unitName = _str_(curPosRows[i][P.UNIT]);
      if (!posName) continue;
      const key = _normName_(posName) + '::' + _normName_(unitName);
      if (posSet[key]) continue;
      posSet[key] = true;
      posList.push({ name: posName, unit: unitName });
    }

    // Из «Обзора рынка»
    for (let i = 1; i < survRows.length; i++) {
      const unit = _str_(survRows[i][V.UNIT]);
      const our = _str_(survRows[i][V.POS_OUR]);
      if (our) {
        const key = _normName_(our) + '::' + _normName_(unit);
        if (!posSet[key]) {
          posSet[key] = true;
          posList.push({ name: our, unit: unit });
        }
      }
    }

    posSh.clear();
    posSh.getRange(1, 1, 1, POS_COLS).setValues([POS_HEADERS])
      .setFontWeight('bold').setBackground('#fce8b2');

    const posMatrix = [];
    const posIdMap = {};
    let posCounter = 0;

    for (let i = 0; i < posList.length; i++) {
      const item = posList[i];
      const normPos = _normName_(item.name);
      if (!posIdMap[normPos]) {
        posCounter++;
        posIdMap[normPos] = 'Д' + posCounter;
      }
      const pId = posIdMap[normPos];
      const uId = item.unit ? (_idПо_('units', item.unit) || '') : '';
      posMatrix.push([i + 1, pId, item.name, uId, item.unit]);
    }

    if (posMatrix.length > 0) {
      posSh.getRange(2, 1, posMatrix.length, POS_COLS).setValues(posMatrix);
    }
    posSh.setFrozenRows(1);
    _сброситьДолжности_();

    // ═══ 3. ПЕРЕПРИВЯЗКА ID ПОД НОВУЮ НУМЕРАЦИЮ ═══
    // Обязательно сразу после пересборки «Справочника»: номера только что
    // выданы заново, и в листах-потребителях лежат ID от прежней нумерации.
    // Без этого шага всё, что идёт ниже, работает по мёртвым ссылкам.
    const relink = _перепривязатьID_(false);

    // ═══ 4. ИСПРАВЛЕНИЕ СЕГМЕНТОВ И ДЕДУПЛИКАЦИЯ ═══
    исправитьСегментыКомпаний();

    // ═══ 5. ПРОВЕРКА И ПОЧИНКА РАСХОЖДЕНИЙ ═══
    починитьРасхождения_();

    // Дедупликация могла слить компании и сдвинуть номера — привязываем ещё раз.
    _перепривязатьID_(false);

    // ═══ 6. ПЕРЕСЧЁТ СТАТУСОВ ═══
    пересчитатьСтатусы_(true);

    _log_('меню', 'полная пересборка',
      'Направлений: ' + dirsList.length +
      ', Людей: ' + peopleList.length +
      ', Компаний: ' + compList.length +
      ', Подразделений: ' + unitsList.length +
      ', Должностей: ' + posMatrix.length);

    ui.alert('Пересборка успешно завершена',
      '✅ Лист «Справочник» полностью очищен и пересобран:\n' +
      '   • Направлений: ' + dirsList.length + '\n' +
      '   • ФИО сотрудников/руководителей: ' + peopleList.length + '\n' +
      '   • Компаний-конкурентов: ' + compList.length + '\n' +
      '   • Подразделений (чистых): ' + unitsList.length + '\n' +
      '   • Сегментов: ' + segList.length + '\n' +
      '   • Регионов: ' + regList.length + '\n\n' +
      '✅ Лист «Справочник должностей» пересобран (' + posMatrix.length + ' записей).\n' +
      '✅ ID перепривязаны по названиям: исправлено ' + relink.fixed +
      ', заполнено пустых ' + relink.filled +
      (relink.miss ? ', НЕ НАЙДЕНО ' + relink.miss : '') + '.\n' +
      '✅ Сегменты компаний нормализованы.\n' +
      '✅ Статусы заполнения и связи актуализированы.',
      ui.ButtonSet.OK);

  } catch (err) {
    ui.alert('Ошибка при пересборке', err.message, ui.ButtonSet.OK);
    _log_('ошибка', 'полная пересборка', err.message);
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}
