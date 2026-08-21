/**
 * КОНКУРЕНТНАЯ КАРТА ФАРОВОН — веб-форма анализа рынка
 * Google Apps Script, привязанный к общей Google Таблице.
 *
 * Установка: см. ИНСТРУКЦИЯ.md
 * Точка входа для настройки: меню «Конкурентная карта» → «1. Настроить систему»
 */

// ─────────────────────────────────────────────────────────────
// КОНСТАНТЫ
// ─────────────────────────────────────────────────────────────

/** Часовой пояс холдинга. Все даты в таблице, журнале и форме — по нему. */
const TZ = 'Asia/Dushanbe';
const FMT_DT = 'dd.MM.yyyy HH:mm';
const FMT_DT_SEC = 'dd.MM.yyyy HH:mm:ss';
const FMT_D = 'dd.MM.yyyy';

const SH = {
  INSTR:  'Инструкция',
  DIV:    'Подразделения',
  COMP:   'Конкуренты',
  PEOPLE: 'Участники опроса',
  REF:    'Справочник',             // единый справочник: блоки ID_* → название
  POS:    'Справочник должностей',  // штатка: должность × подразделение
  DICT:   'Справочник компаний',
  BAN:    'Не использовать',
  USERS:  'Пользователи',
  PWD:    'Пароли (выдать)',
  LOG:    'Журнал',
  STATUS: 'Статус заполнения',
  COLS:   'Настройка колонок',      // ручная привязка полей к колонкам, если шапка врёт
  DIAG:   'Диагностика',
  NEED:   'Нужны руководители',
  SURVEY: 'Обзор рынка',            // данные по должностям, окладам, бонусам, льготам
  BENEF:  'Справочник льгот',
  PERIOD: 'Период заполнения',
  LINKS:  'Связи'                   // отчёт синхронизации: что с чем разошлось
};

// Колонки листа «Конкуренты» (0-based)
const C = {
  NUM: 0, DIR: 1, UNIT: 2, RESP: 3, HRBP: 4, COMPANY: 5, TYPE: 6,
  SEG: 7, REGION: 8, PRIO: 9, STATUS: 10, SRC: 11, NOTE: 12,
  ACTUAL: 13, BY: 14, AT: 15, ID: 16
};
const COMP_COLS = 17;

const COMP_HEADERS = ['№', 'Направление / департамент', 'Подразделение',
  'Ответственный за обзор рынка', 'HR BP', 'Компания-конкурент', 'Тип конкурента',
  'Сегмент', 'Регион присутствия', 'Приоритет', 'Статус', 'Источник данных',
  'Комментарий руководителя', 'Актуальность', 'Кто заполнил', 'Дата заполнения', 'ID'];

// Колонки листа «Подразделения» (0-based)
const D = { NUM: 0, DIR: 1, UNIT: 2, LEVEL: 3, HEAD: 4, RESP: 5, HRBP: 6, CNT: 7, NOTE: 8 };

// Колонки листа «Пользователи» (0-based)
const U = { LOGIN: 0, HASH: 1, FIO: 2, ROLE: 3, UNITS: 4, ACTIVE: 5, LASTIN: 6 };

// Колонки листа «Обзор рынка» (0-based)
const V = {
  ID: 0, UNIT: 1, COMPANY: 2, POS_OUR: 3, POS_THEIR: 4, GRADE: 5,
  PAY_FROM: 6, PAY_TO: 7, CUR: 8, PAY_PER: 9,
  BON_HAS: 10, BON_SIZE: 11, BON_TYPE: 12, BON_PER: 13,
  BENEFITS: 14, EXTRA: 15, SOURCE: 16, TRUST: 17, NOTE: 18,
  BY: 19, AT: 20, STATE: 21, PERIOD: 22
};
const SURVEY_COLS = 23;

const SURVEY_HEADERS = ['ID', 'Подразделение', 'Компания', 'Должность у нас',
  'Должность в компании-конкуренте', 'Уровень / грейд', 'Оклад от', 'Оклад до', 'Валюта',
  'Период оклада', 'Бонус есть', 'Размер бонуса', 'Тип бонуса', 'Периодичность бонуса',
  'Льготы', 'Прочие выплаты', 'Источник данных', 'Достоверность', 'Комментарий',
  'Кто заполнил', 'Дата', 'Состояние', 'Период заполнения'];

// Колонки листа «Статус заполнения» (0-based).
// ASK — компании, по которым руководитель выбрал «уточнить»: они НЕ считаются проверенными.
const ST = { UNIT: 0, RESP: 1, HRBP: 2, STATE: 3, TOTAL: 4, DONE: 5, ASK: 6, NOTE: 7, AT: 8 };
const STATUS_COLS = 9;
const STATUS_HEADERS = ['Подразделение', 'Ответственный', 'HR BP', 'Состояние',
  'Компаний', 'Проверено', 'Требует уточнения', 'Комментарий по подразделению', 'Обновлено'];

// Колонки листа «Журнал» (0-based)
const LOG_HEADERS = ['Дата и время', 'Логин', 'Действие', 'Примечание'];

const SESSION_HOURS = 12;

// Колонки листа «Пароли (выдать)» (0-based).
// Телефон стоит рядом с паролем: по нему телеграм-бот узнаёт человека.
const PW = { FIO: 0, ROLE: 1, LOGIN: 2, PWD: 3, PHONE: 4, UNITS: 5 };
const PWD_COLS = 6;
const PWD_HEADERS = ['ФИО', 'Роль', 'Логин', 'Пароль', 'Телефон', 'Подразделений'];

/** Признак того, что пароль на листе больше не действителен (человек сменил его сам). */
const PWD_CHANGED = 'изменён пользователем';

const SPRAVOCHNIK = {
  types:      ['Отраслевой', 'Рынок труда', 'Оба'],
  priorities: ['Ключевой', 'Основной', 'Региональный'],
  statuses:   ['подтверждено', 'из базы', 'уточнить'],
  currencies: ['сомони', 'USD', 'RUB'],
  payPeriods: ['в месяц', 'в год'],
  bonusTypes: ['% от оклада', 'фиксированная сумма', 'кол-во окладов'],
  bonusPeriods: ['ежемесячно', 'ежеквартально', 'раз в полгода', 'ежегодно', 'разово'],
  sources: ['вакансия на сайте', 'кандидат на интервью', 'бывший сотрудник',
            'знакомый в компании', 'открытые данные', 'экспертная оценка'],
  trust: ['высокая', 'средняя', 'низкая']
};

// Список льгот по умолчанию — попадает в «Справочник льгот» при настройке, дальше правится вручную
const BENEFITS_DEFAULT = [
  'ДМС / медицинская страховка', 'Страхование жизни', 'Питание / компенсация питания',
  'Транспорт / развозка', 'Компенсация ГСМ', 'Служебный автомобиль', 'Мобильная связь',
  'Ноутбук / техника', 'Обучение и курсы', 'Оплата сертификаций', 'Фитнес / спорт',
  'Материальная помощь', 'Оплата жилья / аренда', 'Путёвки, санаторий',
  'Дополнительный оплачиваемый отпуск', 'Гибкий график / удалённая работа',
  'Скидки на продукцию компании', 'Детский сад / школа для детей',
  'Корпоративные мероприятия', 'Подарки к праздникам'
];

/**
 * Блоки листа «Справочник»: ключ → заголовок колонки с ID.
 * Название лежит в ближайшей колонке справа, у которой заполнена шапка.
 * prefix — с чего начинается новый ID, когда значение добавляют из формы.
 */
const REF_BLOCKS = {
  dirs:      { head: 'ID_Направление',   prefix: 'Н', title: 'Направление бизнеса' },
  people:    { head: 'ID_Человек',       prefix: 'Ч', title: 'ФИО' },
  companies: { head: 'ID_Компания',      prefix: 'К', title: 'Компания-конкурент' },
  units:     { head: 'ID_Подразделение', prefix: 'П', title: 'Подразделение' },
  segments:  { head: 'ID_Сегмент',       prefix: 'С', title: 'Сегмент' },
  regions:   { head: 'ID_Регион',        prefix: 'Р', title: 'Регион присутствия' }
};

/** Блоки, куда форма может дописывать значения кнопкой «Другое». */
const REF_ADDABLE = ['segments', 'regions'];

// Лист «Справочник должностей» (0-based).
// Должности живут отдельно от блочного «Справочника»: у должности есть привязка
// к подразделению, а это отношение, а не пара «ID → название».
// Одна строка = одна должность в одном подразделении.
const P = { NUM: 0, ID: 1, NAME: 2, UNIT_ID: 3, UNIT: 4 };
const POS_COLS = 5;
const POS_HEADERS = ['№', 'ID_Должность', 'Должность', 'ID_Подр', 'Подразделение'];

/** Порядок и цвет вкладок. Цвет — по назначению листа. */
const SHEET_ORDER = [
  { name: SH.INSTR,  color: '#a142f4' },   // как пользоваться
  { name: SH.COMP,   color: '#34a853' },   // рабочие листы — заполняют руководители
  { name: SH.SURVEY, color: '#34a853' },
  { name: SH.STATUS, color: '#4285f4' },   // контроль — смотрит HR BP
  { name: SH.PERIOD, color: '#4285f4' },
  { name: SH.DIV,    color: '#9aa0a6' },   // оргструктура — меняется редко
  { name: SH.PEOPLE, color: '#9aa0a6' },
  { name: SH.REF,    color: '#f9ab00' },   // справочники — единственное место правки названий
  { name: SH.POS,    color: '#f9ab00' },
  { name: SH.DICT,   color: '#f9ab00' },
  { name: SH.BENEF,  color: '#f9ab00' },
  { name: SH.BAN,    color: '#f9ab00' },
  { name: SH.USERS,  color: '#ea4335' },   // служебные — трогает только администратор
  { name: SH.PWD,    color: '#ea4335' },
  { name: SH.LOG,    color: '#795548' },
  { name: SH.LINKS,  color: '#795548' },
  { name: SH.COLS,   color: '#795548' },
  { name: SH.DIAG,   color: '#795548' }
];

// ─────────────────────────────────────────────────────────────
// ТОЧКА ВХОДА ВЕБ-ПРИЛОЖЕНИЯ
// ─────────────────────────────────────────────────────────────

function doGet() {
  const out = HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Анализ рынка — Фаровон')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  return _значок_(out);
}

/**
 * Значок во вкладке браузера. Картинка вшита в код (константа FAVICON_B64 в конце файла).
 * Сначала пробуем data:-адрес — тогда никуда ничего загружать не нужно.
 * Если Apps Script его не примет, один раз публикуем PNG на Диске владельца таблицы.
 */
function _значок_(out) {
  // 1) если значок уже опубликован на Диске — берём готовую ссылку
  try {
    const saved = PropertiesService.getScriptProperties().getProperty('FAVICON_URL');
    if (saved) return out.setFaviconUrl(saved);
  } catch (e) { /* идём дальше */ }

  // 2) пробуем data:-адрес — тогда никуда ничего загружать не нужно
  try {
    return out.setFaviconUrl('data:image/png;base64,' + FAVICON_B64);
  } catch (e) { /* Apps Script не принял data: — публикуем файл */ }

  try {
    const url = опубликоватьЗначок_(true);
    if (url) return out.setFaviconUrl(url);
  } catch (e) { /* без значка форма работает точно так же */ }
  return out;
}

/**
 * Публикует картинку значка файлом на Диске владельца и запоминает ссылку.
 * Файл получает доступ «по ссылке» — иначе браузер не сможет его загрузить.
 * Кроме самой иконки в файл ничего не попадает.
 */
function опубликоватьЗначок_(silent) {
  const props = PropertiesService.getScriptProperties();
  const blob = Utilities.newBlob(
    Utilities.base64Decode(FAVICON_B64), 'image/png', 'Значок формы обзора рынка.png');
  const file = DriveApp.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const url = 'https://lh3.googleusercontent.com/d/' + file.getId();
  props.setProperty('FAVICON_URL', url);
  if (!silent) {
    SpreadsheetApp.getUi().alert('Значок опубликован',
      'Файл «Значок формы обзора рынка.png» создан на вашем Диске с доступом по ссылке.\n\n' +
      url + '\n\nТеперь создайте новое развёртывание (Версия: Новая) и обновите вкладку ' +
      'формы через Ctrl+Shift+R.', SpreadsheetApp.getUi().ButtonSet.OK);
  }
  return url;
}

/** Пункт меню: принудительно опубликовать значок на Диске. */
function опубликоватьЗначок() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const old = props.getProperty('FAVICON_URL');
  if (old) {
    const res = ui.alert('Значок уже опубликован',
      old + '\n\nСоздать новый файл и заменить ссылку?', ui.ButtonSet.YES_NO);
    if (res !== ui.Button.YES) return;
    props.deleteProperty('FAVICON_URL');
  }
  опубликоватьЗначок_(false);
}

/** Пункт меню: вернуться к картинке, вшитой в код. */
function сброситьЗначок() {
  PropertiesService.getScriptProperties().deleteProperty('FAVICON_URL');
  SpreadsheetApp.getUi().alert('Готово',
    'Ссылка сброшена. Форма снова попробует использовать картинку из кода.\n' +
    'Создайте новое развёртывание и обновите вкладку через Ctrl+Shift+R.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * Меню таблицы. Наверху то, чем пользуются в каждой волне;
 * редкое и разовое убрано в «Обслуживание», чтобы не искать нужное среди тридцати строк.
 *
 * Убраны совсем (функции остались в коде и запускаются из редактора Apps Script):
 *   телеграмЗадатьАдрес, телеграмПодключить, телеграмОтключить — вебхук через
 *     Apps Script не работает: на POST по /exec приходит редирект 302, Telegram его не следует;
 *   починитьЖурнал — разовая миграция под старую пятиколоночную шапку, уже применена;
 *   сброситьЗначок, опубликоватьЗначок — отладка значка формы;
 *   показатьРаскладку, настроитьКолонки, проверитьФормулы — разовая наладка,
 *     нужна раз в жизни проекта и уже пройдена;
 *   упорядочитьЛисты — косметика;
 *   удалитьСироты — опасная кнопка: сироты переносятся, а не удаляются;
 *   телеграмЗабратьСейчас — при вебхуке очередь разбирать вручную незачем.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Обзор рынка')
    // ── повседневное ──
    .addItem('Панель контроля…', 'панельКонтроля')
    .addSeparator()
    .addItem('Открыть период заполнения', 'открытьПериод')
    .addItem('Закрыть период заполнения', 'закрытьПериод')
    .addSeparator()
    .addItem('Синхронизировать всё', 'синхронизировать')
    .addItem('Обновить статусы заполнения', 'пересчитатьСтатусы')
    .addItem('Выгрузить отчёты по HR BP', 'выгрузитьОтчётыПоHRBP')
    .addSeparator()
    // ── люди ──
    .addItem('Назначить ответственных…', 'назначитьОтветственных')
    .addItem('Добавить пользователя…', 'добавитьПользователя')
    .addItem('Сменить пароль одному человеку', 'сменитьПарольОдному')
    .addItem('Проверить двойные учётки (без изменений)', 'проверитьСлияниеУчёток')
    .addItem('Слить двойные учётки', 'слитьУчётки')
    .addItem('Подсветить спорные учётки', 'подсветитьСпорныеУчётки')
    .addItem('Освежить лист паролей по «Пользователям»', 'освежитьЛистПаролей')
    .addItem('Удалить осиротевшие строки паролей', 'удалитьОсиротевшиеПароли')
    .addItem('Удалить выключенные учётки', 'удалитьНеактивныхПользователей')
    .addSeparator()
    .addSubMenu(ui.createMenu('Телеграм-бот')
      .addItem('Проверить статус бота и вебхука', 'телеграмПроверить')
      .addItem('Привязать вебхук Cloudflare…', 'телеграмПривязатьВебхук')
      .addItem('Задать токен бота…', 'телеграмЗадатьТокен')
      .addSeparator()
      .addItem('Проверить номер сотрудника…', 'телеграмПроверитьНомер')
      .addSeparator()
      .addItem('Включить резервный минутный опрос', 'телеграмВключитьОпрос')
      .addItem('Выключить бота полностью', 'телеграмВыключитьОпрос'))
    // Подменю держим короткими: длинный список Google Sheets обрезает по низу экрана,
    // прокрутки в нём нет — нижние пункты становятся недоступны.
    .addSubMenu(ui.createMenu('Оргструктура')
      .addItem('Загрузить новую оргструктуру…', 'загрузитьСтруктуру')
      .addItem('Вернуть из архива…', 'вернутьИзАрхива')
      .addSeparator()
      .addItem('Спустить ответственность на уровень ниже…', 'спуститьОтветственность')
      .addItem('Перенести строки в другое подразделение…', 'перенестиСтроки'))
    .addSubMenu(ui.createMenu('Проверка')
      .addItem('Проверить листы', 'проверитьЛисты')
      .addItem('Отчёт о состоянии…', 'отчётОСостоянии')
      .addItem('Починить расхождения в «Связях»', 'починитьРасхождения')
      .addItem('Исправить сегменты компаний', 'исправитьСегментыКомпаний')
      .addItem('Проверить привязку ID (без изменений)', 'проверитьПривязкуID')
      .addSeparator()
      .addItem('Настроить систему', 'настроитьСистему')
      .addItem('Включить автосинхронизацию', 'включитьАвтосинхронизацию')
      .addItem('Выключить автосинхронизацию', 'выключитьАвтосинхронизацию'))
    .addSubMenu(ui.createMenu('Справочники')
      .addItem('Полная очистка и пересборка всех справочников', 'полнаяЧисткаИПересборка')
      .addSeparator()
      .addItem('Проверить привязку ID (без изменений)', 'проверитьПривязкуID')
      .addItem('Перепривязать ID по названиям', 'перепривязатьID')
      .addSeparator()
      .addItem('Найти дубли в справочнике', 'найтиДублиКомпаний')
      .addItem('Объединить дубли компаний', 'объединитьДублиКомпаний'))
    .addSubMenu(ui.createMenu('Сброс и очистка')
      .addItem('Полная очистка и пересборка всех справочников', 'полнаяЧисткаИПересборка')
      .addItem('Очистить данные за период…', 'очиститьДанныеПериода')
      .addItem('Очистить удалённые записи обзора', 'очиститьУдалённые')
      .addSeparator()
      .addItem('Пересоздать пароли всем', 'пересоздатьПароли'))
    .addToUi();
}

// ─────────────────────────────────────────────────────────────
// СЛУЖЕБНОЕ
// ─────────────────────────────────────────────────────────────

function _ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

/** Приводит имя листа к сравнимому виду: регистр, ё/е, двойные пробелы, неразрывный пробел. */
function _normName_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/ /g, ' ').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/**
 * То же самое, но для названий подразделений дополнительно отбрасывает цифровой код
 * в начале («0201 Отдел оптовых продаж Худжанд» → «отдел оптовых продаж худжанд»).
 * Нужна, потому что в «Подразделениях» названия идут с кодом, а в старых записях
 * «Справочника должностей» — без него, и без этой чистки сравнение по имени не совпадает.
 */
function _normUnit_(s) {
  return _normName_(s).replace(/^\d+\s*/, '');
}

/**
 * Ищет лист сначала по точному имени, затем без учёта регистра и лишних пробелов.
 * Так «Справочник компаний » или «справочник Компаний» тоже находятся.
 */
function _findSheet_(name) {
  const ss = _ss_();
  const exact = ss.getSheetByName(name);
  if (exact) return exact;
  const want = _normName_(name);
  const all = ss.getSheets();
  for (let i = 0; i < all.length; i++) {
    if (_normName_(all[i].getName()) === want) return all[i];
  }
  return null;
}

function _sheet_(name, createIfMissing) {
  let sh = _findSheet_(name);
  if (!sh && createIfMissing) sh = _ss_().insertSheet(name);
  if (!sh) throw new Error('Не найден лист «' + name + '». Запустите «Конкурентная карта → 1. Настроить систему».');
  return sh;
}

function _values_(name) {
  const sh = _sheet_(name);
  const lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (lr < 1 || lc < 1) return [];
  return sh.getRange(1, 1, lr, lc).getValues();
}

/**
 * То же, но для необязательных листов: если листа нет — пустой массив вместо ошибки.
 * Справочники нужны для подсказок, и их отсутствие не повод не пускать людей в форму.
 */
function _valuesOpt_(name) {
  const sh = _findSheet_(name);
  if (!sh) return [];
  const lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (lr < 1 || lc < 1) return [];
  return sh.getRange(1, 1, lr, lc).getValues();
}

function _str_(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }

/**
 * Дата в часовом поясе Душанбе. withTime=true — с часами и минутами.
 * Всё, что уходит в форму и в журнал, проходит через неё: иначе браузер
 * пользователя показывает время своего пояса, а таблица — своего.
 */
function _дата_(d, withTime) {
  if (d === null || d === undefined || d === '') return '';
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return _str_(d);
  return Utilities.formatDate(dt, TZ, withTime ? FMT_DT : FMT_D);
}

// ─────────────────────────────────────────────────────────────
// ПОИСК КОЛОНОК ПО ЗАГОЛОВКАМ
// Раскладка листов в разных копиях отличается, поэтому колонки ищем
// по названию в первой строке, а не по жёсткому номеру.
// ─────────────────────────────────────────────────────────────

const DIV_SPEC = {
  num:   ['№', 'N', 'Номер'],
  dir:   ['Направление / департамент', 'Направление/департамент', 'Направление', 'Департамент', 'Дивизион'],
  unit:  ['Подразделение', 'Название подразделения', 'Отдел'],
  level: ['Уровень'],
  head:  ['Руководитель', 'Руководитель подразделения', 'ФИО руководителя'],
  resp:  ['Ответственный за обзор рынка', 'Ответственный', 'Ответственное лицо', 'Ответственный за обзор'],
  hrbp:  ['HR BP', 'HRBP', 'HR-BP', 'HR ВР', 'Эйчар'],
  cnt:   ['Компаний в карте', 'Компаний'],
  // колонки-ключи к «Справочнику»: имена в соседних колонках считаются формулами
  idDir:  ['ID_Напр', 'ID_Направление'],
  idUnit: ['ID_Подр', 'ID_Подразделение'],
  idHead: ['ID_Рук', 'ID_Руководитель'],
  idResp: ['ID_Отв', 'ID_Ответственный'],
  idHrbp: ['ID_HRBP', 'ID_HR BP']
};
const DIV_FALLBACK = { num: 0, dir: 1, unit: 2, level: 3, head: 4, resp: 5, hrbp: 6, cnt: -1,
  idDir: -1, idUnit: -1, idHead: -1, idResp: -1, idHrbp: -1 };

const COMP_SPEC = {
  num:     ['№', 'N', 'Номер'],
  dir:     ['Направление / департамент', 'Направление/департамент', 'Направление', 'Департамент'],
  unit:    ['Подразделение', 'Отдел'],
  resp:    ['Ответственный за обзор рынка', 'Ответственный', 'Ответственное лицо'],
  hrbp:    ['HR BP', 'HRBP', 'HR-BP'],
  company: ['Компания-конкурент', 'Компания-Конкурет', 'Компания конкурент', 'Компания', 'Конкурент'],
  type:    ['Тип конкурента', 'Тип'],
  seg:     ['Сегмент', 'Отрасль'],
  region:  ['Регион присутствия', 'Регион'],
  prio:    ['Приоритет'],
  status:  ['Статус'],
  src:     ['Источник данных', 'Источник'],
  note:    ['Комментарий руководителя', 'Комментарий'],
  actual:  ['Актуальность'],
  by:      ['Кто заполнил'],
  at:      ['Дата заполнения'],
  id:      ['ID', 'ИД'],
  // колонки-ключи к «Справочнику»: по ним работают формулы VLOOKUP
  idDir:   ['ID_Напр', 'ID_Направление'],
  idUnit:  ['ID_Подр', 'ID_Подразделение'],
  idResp:  ['ID_Отв'],
  idHrbp:  ['ID_HRBP', 'ID_HR BP'],
  idComp:  ['ID_Комп', 'ID_Компания']
};
const COMP_FALLBACK = {
  num: 0, dir: 1, unit: 2, resp: 3, hrbp: 4, company: 5, type: 6, seg: 7, region: 8,
  prio: 9, status: 10, src: 11, note: 12, actual: 13, by: 14, at: 15, id: 16,
  idDir: -1, idUnit: -1, idResp: -1, idHrbp: -1, idComp: -1
};

/**
 * Лист «Участники опроса». Раньше колонки читались по жёстким индексам 1 и 2,
 * а там лежат ID_Человек и ФИО — из-за этого в учётные записи попадал ID вместо имени.
 */
const PEOPLE_SPEC = {
  num:  ['№', 'N', 'Номер'],
  id:   ['ID_Человек', 'ID Человек', 'ID'],
  fio:  ['ФИО', 'Ф.И.О.', 'Ф. И. О.', 'Имя'],
  dir:  ['Направление / департамент', 'Направление/департамент', 'Направление', 'Департамент'],
  unit: ['Подразделение', 'Отдел'],
  role: ['Роль'],
  hrbp: ['HR BP', 'HRBP', 'HR-BP'],
  // колонки-ключи к «Справочнику»: по ним работают формулы VLOOKUP
  idDir:  ['ID_Напр', 'ID_Направление'],
  idUnit: ['ID_Подр', 'ID_Подразделение'],
  idHrbp: ['ID_HRBP', 'ID_HR BP']
};
const PEOPLE_FALLBACK = { num: 0, id: 1, fio: 2, dir: 4, unit: 6, role: 7, hrbp: 9,
  idDir: 3, idUnit: 5, idHrbp: 8 };

/**
 * Сопоставляет ключи со столбцами по первой строке листа.
 * keyCols — колонки, без которых сопоставление считается неудачным:
 * тогда возвращается старая жёсткая раскладка, чтобы не читать мусор.
 */
function _colmap_(header, spec, fallback, keyCols) {
  const seen = {};
  for (let c = 0; c < header.length; c++) {
    const n = _normName_(header[c]);
    if (n && seen[n] === undefined) seen[n] = c;
  }
  const idx = {};
  Object.keys(spec).forEach(function (key) {
    let found = -1;
    for (let i = 0; i < spec[key].length; i++) {
      const n = _normName_(spec[key][i]);
      if (seen[n] !== undefined) { found = seen[n]; break; }
    }
    idx[key] = found;
  });
  const ok = (keyCols || []).every(function (k) { return idx[k] >= 0; });
  if (ok) return idx;

  const f = {};
  Object.keys(spec).forEach(function (k) {
    f[k] = (fallback[k] === undefined) ? -1 : fallback[k];
  });
  return f;
}

/** Буква колонки → индекс с нуля. «A» → 0, «AB» → 27. */
function _letterToIndex_(s) {
  const t = _str_(s).toUpperCase().replace(/[^A-Z]/g, '');
  if (!t) return -1;
  let n = 0;
  for (let i = 0; i < t.length; i++) n = n * 26 + (t.charCodeAt(i) - 64);
  return n - 1;
}

/** Индекс с нуля → буква колонки. */
function _indexToLetter_(i) {
  if (i === undefined || i === null || i < 0) return '';
  let s = '', n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * Ручная привязка с листа «Настройка колонок»: Лист | Поле | Колонка.
 * Всё, что там указано, важнее автоматического поиска по заголовкам —
 * это спасение, когда шапка не совпадает с данными.
 */
function _ручнаяПривязка_(sheetName) {
  const rows = _valuesOpt_(SH.COLS);
  const out = {};
  for (let i = 1; i < rows.length; i++) {
    if (_normName_(rows[i][0]) !== _normName_(sheetName)) continue;
    const key = _str_(rows[i][1]);
    const col = _letterToIndex_(rows[i][2]);
    if (key && col >= 0) out[key] = col;
  }
  return out;
}

function _applyManual_(map, sheetName) {
  const manual = _ручнаяПривязка_(sheetName);
  Object.keys(manual).forEach(function (k) { map[k] = manual[k]; });
  return map;
}

function _divMap_(rows) {
  return _applyManual_(
    _colmap_(rows.length ? rows[0] : [], DIV_SPEC, DIV_FALLBACK, ['unit']), SH.DIV);
}
function _compMap_(rows) {
  return _applyManual_(
    _colmap_(rows.length ? rows[0] : [], COMP_SPEC, COMP_FALLBACK, ['unit', 'company']), SH.COMP);
}
function _peopleMap_(rows) {
  return _applyManual_(
    _colmap_(rows.length ? rows[0] : [], PEOPLE_SPEC, PEOPLE_FALLBACK, ['fio']), SH.PEOPLE);
}

/** Значение ячейки по ключу карты колонок; пусто, если такой колонки нет. */
function _cell_(row, map, key) {
  const i = map[key];
  if (i === undefined || i < 0 || !row || i >= row.length) return '';
  return _str_(row[i]);
}

/**
 * Записывает одну колонку, не трогая ячейки с формулами.
 * Так правки из формы больше не затирают VLOOKUP к «Справочнику»:
 * там, где стоит формула, значение остаётся формулой.
 * getValue(i, текущее) → новое значение либо undefined, если менять не надо.
 */
function _writeCol_(sh, colIdx, firstRow, count, getValue) {
  if (colIdx === undefined || colIdx < 0 || count <= 0) return 0;
  const rng = sh.getRange(firstRow, colIdx + 1, count, 1);
  const cur = rng.getValues();
  const fml = rng.getFormulas();
  const out = [];
  let touched = 0;
  for (let i = 0; i < count; i++) {
    if (fml[i][0]) { out.push([fml[i][0]]); continue; }   // формула — оставляем как есть
    const v = getValue(i, cur[i][0]);
    if (v === undefined) { out.push([cur[i][0]]); continue; }
    if (String(v) !== String(cur[i][0])) touched++;
    out.push([v]);
  }
  if (touched) rng.setValues(out);
  return touched;
}

function _secret_() {
  const p = PropertiesService.getScriptProperties();
  let s = p.getProperty('SECRET');
  if (!s) { s = Utilities.getUuid() + '-' + Utilities.getUuid(); p.setProperty('SECRET', s); }
  return s;
}

function _hash_(pwd) {
  const raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, _secret_() + '|' + pwd, Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ((b & 0xFF) + 0x100).toString(16).slice(1); }).join('');
}

function _makeToken_(login) {
  const body = login + '|' + (Date.now() + SESSION_HOURS * 3600 * 1000);
  const sig = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(body, _secret_()));
  return Utilities.base64EncodeWebSafe(body) + '.' + sig;
}

/** Проверяет токен и возвращает объект пользователя или бросает ошибку. */
function _auth_(token) {
  if (!token) throw new Error('AUTH');
  const parts = String(token).split('.');
  if (parts.length !== 2) throw new Error('AUTH');
  const body = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
  const sig = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(body, _secret_()));
  if (sig !== parts[1]) throw new Error('AUTH');
  const bits = body.split('|');
  if (Number(bits[1]) < Date.now()) throw new Error('AUTH');
  const user = _findUser_(bits[0]);
  if (!user || user.active === false) throw new Error('AUTH');
  return user;
}

function _findUser_(login) {
  const rows = _values_(SH.USERS);
  const key = String(login).toLowerCase().trim();
  for (let i = 1; i < rows.length; i++) {
    if (_str_(rows[i][U.LOGIN]).toLowerCase() === key) {
      return {
        row: i + 1,
        login: _str_(rows[i][U.LOGIN]),
        hash: _str_(rows[i][U.HASH]),
        fio: _str_(rows[i][U.FIO]),
        role: _str_(rows[i][U.ROLE]),
        units: _str_(rows[i][U.UNITS]) ? _str_(rows[i][U.UNITS]).split(';').map(function (s) { return s.trim(); }).filter(String) : [],
        active: _str_(rows[i][U.ACTIVE]).toLowerCase() !== 'нет'
      };
    }
  }
  return null;
}

/** Транслитерация кириллицы (включая таджикские буквы) в латиницу для логина. */
function _translit_(s) {
  const map = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i',
    'й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t',
    'у':'u','ф':'f','х':'h','ц':'c','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'',
    'э':'e','ю':'yu','я':'ya',
    'ӣ':'i','ҳ':'h','қ':'q','ҷ':'j','ғ':'g','ӯ':'u' // таджикские
  };
  let out = '';
  const low = String(s).toLowerCase();
  for (let i = 0; i < low.length; i++) {
    const ch = low[i];
    if (map[ch] !== undefined) out += map[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
  }
  return out;
}

function _makeLogin_(fio, taken) {
  const parts = String(fio).trim().split(/\s+/);
  let base = _translit_(parts[0] || 'user');
  const initials = parts.slice(1, 3).map(function (p) { return _translit_(p).charAt(0); }).join('');
  if (initials) base += '.' + initials;
  if (!base) base = 'user';
  let login = base, n = 1;
  while (taken[login]) { n++; login = base + n; }
  taken[login] = true;
  return login;
}

function _makePassword_() {
  const abc = 'abcdefghjkmnpqrstuvwxyz';   // без похожих l/i/o
  const dig = '23456789';                  // без 0/1
  let s = '';
  for (let i = 0; i < 4; i++) s += abc.charAt(Math.floor(Math.random() * abc.length));
  s += '-';
  for (let i = 0; i < 4; i++) s += dig.charAt(Math.floor(Math.random() * dig.length));
  return s;
}

/**
 * Строка похожа на технический идентификатор, а не на имя: «Ч96», «П12», «К7».
 * Такие значения в ФИО означают, что данные прочитаны не из той колонки.
 */
function _похожеНаId_(s) {
  return /^[A-ZА-ЯЁ]{1,3}[-_ ]?\d+$/i.test(_str_(s));
}

function _log_(login, action, detail) {
  try {
    const sh = _подготовитьЖурнал_();
    sh.appendRow([new Date(), _str_(login), _str_(action), _str_(detail)]);
    sh.getRange(sh.getLastRow(), 1).setNumberFormat(FMT_DT_SEC);
  } catch (e) { /* журнал не должен ломать основную работу */ }
}

/**
 * Журнал: одна колонка с датой, формат — Душанбе.
 * Старая версия писала четыре значения в пятиколоночную шапку,
 * из-за чего часть строк съехала влево на одну колонку.
 */
function _подготовитьЖурнал_() {
  const sh = _sheet_(SH.LOG, true);
  const lr = sh.getLastRow();
  if (lr === 0) {
    sh.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS])
      .setFontWeight('bold').setBackground('#efe1d5');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 150); sh.setColumnWidth(2, 130);
    sh.setColumnWidth(3, 130); sh.setColumnWidth(4, 420);
    return sh;
  }
  const head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  // Признак старой шапки: две колонки «Дата и время» подряд
  if (_normName_(head[0]) === _normName_(head[1] || '')) починитьЖурнал_(sh);
  return sh;
}

/** Сводит журнал к четырём колонкам и выравнивает съехавшие строки. */
function починитьЖурнал_(sh) {
  const lr = sh.getLastRow(), lc = Math.max(sh.getLastColumn(), 4);
  if (lr < 2) return 0;
  const vals = sh.getRange(2, 1, lr - 1, lc).getValues();
  const out = [];
  for (let i = 0; i < vals.length; i++) {
    const r = vals[i];
    // Старый формат: [дата, дата, логин, действие, примечание]
    const shifted = (r[0] instanceof Date) && (r[1] instanceof Date);
    out.push(shifted ? [r[0], _str_(r[2]), _str_(r[3]), _str_(r[4])]
                     : [r[0], _str_(r[1]), _str_(r[2]), _str_(r[3])]);
  }
  sh.clear();
  sh.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS])
    .setFontWeight('bold').setBackground('#efe1d5');
  sh.getRange(2, 1, out.length, 4).setValues(out);
  sh.getRange(2, 1, out.length, 1).setNumberFormat(FMT_DT_SEC);
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 150); sh.setColumnWidth(2, 130);
  sh.setColumnWidth(3, 130); sh.setColumnWidth(4, 420);
  return out.length;
}

function починитьЖурнал() {
  const ui = SpreadsheetApp.getUi();
  const sh = _sheet_(SH.LOG, true);
  const n = починитьЖурнал_(sh);
  ui.alert('Журнал', 'Приведено строк: ' + n + '.\n\n' +
    'Колонки: Дата и время | Логин | Действие | Примечание.\n' +
    'Время показывается по Душанбе.', ui.ButtonSet.OK);
}

// ─────────────────────────────────────────────────────────────
// ЛИСТ «СПРАВОЧНИК» — единый источник названий
// Блоки лежат рядом: ID_Направление | Направление, ID_Человек | ФИО и так далее.
// Форма читает названия отсюда, а не набирает их из уже введённых данных.
// ─────────────────────────────────────────────────────────────

var _refCache_ = null;

/** Сбрасывает разобранный справочник — вызывать после любой записи в лист. */
function _сброситьСправочник_() { _refCache_ = null; }

/** Где какой блок лежит: {ключ: {id: индекс, name: индекс}}. */
function _позицииБлоков_(header) {
  const pos = {};
  Object.keys(REF_BLOCKS).forEach(function (key) {
    const want = _normName_(REF_BLOCKS[key].head);
    for (let c = 0; c < header.length; c++) {
      if (_normName_(header[c]) !== want) continue;
      let n = c + 1;
      while (n < header.length && !_str_(header[n])) n++;
      pos[key] = { id: c, name: (n < header.length ? n : -1) };
      break;
    }
  });
  return pos;
}

function _справочник_() {
  if (_refCache_) return _refCache_;
  const out = {};
  Object.keys(REF_BLOCKS).forEach(function (k) { out[k] = []; });

  const rows = _valuesOpt_(SH.REF);
  if (!rows.length) { _refCache_ = out; return out; }

  const pos = _позицииБлоков_(rows[0]);
  Object.keys(pos).forEach(function (key) {
    const p = pos[key];
    if (p.name < 0) return;
    const seen = {};
    for (let i = 1; i < rows.length; i++) {
      const id = _str_(rows[i][p.id]);
      const name = _str_(rows[i][p.name]);
      if (!id && !name) continue;
      const k = _normName_(name);
      if (k && seen[k]) continue;          // в списки для формы дубли не пускаем
      if (k) seen[k] = true;
      out[key].push({ id: id, name: name, row: i + 1 });
    }
  });
  _refCache_ = out;
  return out;
}

/** Названия блока одним массивом строк — то, что уходит в выпадающие списки. */
function _именаБлока_(key) {
  return _справочник_()[key].map(function (x) { return x.name; }).filter(String);
}

/** ID по названию. Пусто, если такого значения в справочнике нет. */
function _idПо_(key, name) {
  const norm = key === 'units' ? _normUnit_ : _normName_;
  const want = norm(name);
  if (!want) return '';
  const list = _справочник_()[key] || [];
  for (let i = 0; i < list.length; i++) {
    if (norm(list[i].name) === want) return list[i].id;
  }
  return '';
}

/**
 * Дописывает значение в блок справочника и возвращает его ID.
 * Если такое название уже есть — просто возвращает существующий ID,
 * чтобы форма не плодила дубли.
 */
function _добавитьВСправочник_(key, name) {
  const clean = _str_(name);
  if (!clean) return '';
  const exists = _idПо_(key, clean);
  if (exists) return exists;

  const block = REF_BLOCKS[key];
  if (!block) return '';

  const sh = _sheet_(SH.REF, true);
  const lc = Math.max(sh.getLastColumn(), 1);
  let header = sh.getRange(1, 1, 1, lc).getValues()[0];
  let pos = _позицииБлоков_(header)[key];

  if (!pos || pos.name < 0) {                       // блока ещё нет — создаём справа
    const start = Math.max(sh.getLastColumn(), 0) + 2;   // пустая колонка-разделитель
    if (sh.getMaxColumns() < start + 1) {
      sh.insertColumnsAfter(sh.getMaxColumns(), start + 1 - sh.getMaxColumns());
    }
    sh.getRange(1, start, 1, 2).setValues([[block.head, block.title]])
      .setFontWeight('bold').setBackground('#fce8b2');
    sh.setColumnWidth(start, 110);
    sh.setColumnWidth(start + 1, 260);
    pos = { id: start - 1, name: start };
    header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  }

  // Первая свободная строка именно в этом блоке — блоки разной длины
  const lr = Math.max(sh.getLastRow(), 1);
  const col = sh.getRange(2, pos.id + 1, Math.max(lr - 1, 1), 1).getValues();
  let free = 2, maxNum = 0;
  for (let i = 0; i < col.length; i++) {
    const id = _str_(col[i][0]);
    if (id) {
      free = i + 3;
      const n = parseInt(String(id).replace(/\D/g, ''), 10);
      if (!isNaN(n) && n > maxNum) maxNum = n;
    }
  }
  const id = block.prefix + (maxNum + 1);
  sh.getRange(free, pos.id + 1, 1, 1).setValue(id);
  sh.getRange(free, pos.name + 1, 1, 1).setValue(clean);
  _сброситьСправочник_();
  return id;
}

/**
 * Дописывает в блок справочника сразу много значений и возвращает
 * карту {нормализованное имя: ID} по всему блоку — и старому, и новому.
 *
 * Поштучное _добавитьВСправочник_ на каждое имя делает по два обращения
 * к листу; на загрузке структуры из 326 строк это больше тысячи обращений
 * и гарантированный выход за шесть минут. Здесь блок читается один раз
 * и дописывается одним setValues.
 */
function _добавитьМного_(key, names) {
  const map = {};
  const block = REF_BLOCKS[key];
  if (!block) return map;

  const sh = _sheet_(SH.REF, true);
  const lc = Math.max(sh.getLastColumn(), 1);
  const pos = _позицииБлоков_(sh.getRange(1, 1, 1, lc).getValues()[0])[key];
  if (!pos || pos.name < 0) {                     // блока нет — заводим поштучно, это редкость
    (names || []).forEach(function (n) {
      const clean = _str_(n);
      if (clean) map[_normName_(clean)] = _добавитьВСправочник_(key, clean);
    });
    return map;
  }

  const lr = Math.max(sh.getLastRow(), 1);
  const width = Math.max(pos.id, pos.name) + 1;
  const cur = lr > 1 ? sh.getRange(2, 1, lr - 1, width).getValues() : [];

  let free = 2, maxNum = 0;
  for (let i = 0; i < cur.length; i++) {
    const id = _str_(cur[i][pos.id]);
    const nm = _str_(cur[i][pos.name]);
    if (id || nm) {
      free = i + 3;
      if (nm) map[_normName_(nm)] = id;
      const n = parseInt(String(id).replace(/\D/g, ''), 10);
      if (!isNaN(n) && n > maxNum) maxNum = n;
    }
  }

  const add = [];
  (names || []).forEach(function (n) {
    const clean = _str_(n);
    if (!clean) return;
    const k = _normName_(clean);
    if (k in map) return;
    maxNum++;
    const id = block.prefix + maxNum;
    map[k] = id;
    add.push({ id: id, name: clean });
  });

  if (add.length) {
    if (sh.getMaxRows() < free + add.length) {
      sh.insertRowsAfter(sh.getMaxRows(), free + add.length - sh.getMaxRows());
    }
    sh.getRange(free, pos.id + 1, add.length, 1)
      .setValues(add.map(function (a) { return [a.id]; }));
    sh.getRange(free, pos.name + 1, add.length, 1)
      .setValues(add.map(function (a) { return [a.name]; }));
    _сброситьСправочник_();
  }
  return map;
}

// ─────────────────────────────────────────────────────────────
// СПРАВОЧНИК ДОЛЖНОСТЕЙ
// Штатка холдинга: должность привязана к подразделению, поэтому лежит
// отдельным листом-отношением, а не парой колонок в «Справочнике».
// Руководителю в форме показываются должности только его подразделений.
// ─────────────────────────────────────────────────────────────

var _posCache_ = null;

function _сброситьДолжности_() { _posCache_ = null; }

/**
 * Разбирает лист в {byUnit: {нормализованное подразделение: [должности]}, all: [все]}.
 * Строки без подразделения попадают только в общий список.
 */
function _должности_() {
  if (_posCache_) return _posCache_;
  const out = { byUnit: {}, all: [], ids: {} };
  const rows = _valuesOpt_(SH.POS);
  const seenAll = {};
  for (let i = 1; i < rows.length; i++) {
    const name = _str_(rows[i][P.NAME]);
    if (!name) continue;
    const key = _normName_(name);
    if (!seenAll[key]) { seenAll[key] = true; out.all.push(name); }
    if (!out.ids[key]) out.ids[key] = _str_(rows[i][P.ID]);

    const unit = _str_(rows[i][P.UNIT]);
    if (!unit) continue;
    const uk = _normUnit_(unit);
    if (!out.byUnit[uk]) out.byUnit[uk] = [];
    if (out.byUnit[uk].indexOf(name) === -1) out.byUnit[uk].push(name);
  }
  out.all.sort(function (a, b) { return a.localeCompare(b, 'ru'); });
  Object.keys(out.byUnit).forEach(function (k) {
    out.byUnit[k].sort(function (a, b) { return a.localeCompare(b, 'ru'); });
  });
  _posCache_ = out;
  return out;
}

/**
 * Штатка по каждому подразделению отдельно: {подразделение: [должности]}.
 * Нужна для шага 2, где должности показываются готовым списком-чек-листом,
 * а не набираются руками с чистого экрана.
 */
function _штаткаПоПодразделениям_(units) {
  const d = _должности_();
  const out = {};
  (units || []).forEach(function (u) {
    out[u] = (d.byUnit[_normUnit_(u)] || []).slice();
  });
  return out;
}

/** Должности перечисленных подразделений, без повторов. */
function _должностиПодразделений_(units) {
  const d = _должности_();
  const seen = {}, out = [];
  (units || []).forEach(function (u) {
    (d.byUnit[_normUnit_(u)] || []).forEach(function (name) {
      const k = _normName_(name);
      if (seen[k]) return;
      seen[k] = true;
      out.push(name);
    });
  });
  return out.sort(function (a, b) { return a.localeCompare(b, 'ru'); });
}

function _подготовитьСправочникДолжностей_() {
  const ss = _ss_();
  let sh = _findSheet_(SH.POS);
  if (!sh) sh = ss.insertSheet(SH.POS);
  if (sh.getMaxColumns() < POS_COLS) {
    sh.insertColumnsAfter(sh.getMaxColumns(), POS_COLS - sh.getMaxColumns());
  }
  sh.getRange(1, 1, 1, POS_COLS).setValues([POS_HEADERS])
    .setFontWeight('bold').setBackground('#fce8b2');
  sh.setFrozenRows(1);
  sh.setColumnWidth(P.NUM + 1, 60);
  sh.setColumnWidth(P.ID + 1, 110);
  sh.setColumnWidth(P.NAME + 1, 320);
  sh.setColumnWidth(P.UNIT_ID + 1, 90);
  sh.setColumnWidth(P.UNIT + 1, 320);
  return sh;
}

/**
 * Дописывает должность в штатку. Если такое название уже есть,
 * переиспользуем его ID — одна должность в разных подразделениях
 * должна иметь один идентификатор.
 */
function _добавитьДолжность_(unit, name) {
  const clean = _str_(name);
  if (!clean) return '';
  const d = _должности_();
  const key = _normName_(clean);
  const uk = _normName_(unit);

  // уже есть в этом же подразделении — ничего не делаем
  if (uk && d.byUnit[uk] && d.byUnit[uk].some(function (x) { return _normName_(x) === key; })) {
    return d.ids[key] || '';
  }

  const sh = _подготовитьСправочникДолжностей_();
  let id = d.ids[key];
  if (!id) {
    let max = 0;
    Object.keys(d.ids).forEach(function (k) {
      const n = parseInt(String(d.ids[k]).replace(/\D/g, ''), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    id = 'Д' + (max + 1);
  }
  const row = Math.max(sh.getLastRow(), 1) + 1;
  sh.getRange(row, 1, 1, POS_COLS).setValues([[
    row - 1, id, clean, _idПо_('units', unit), _str_(unit)
  ]]);
  _сброситьДолжности_();
  return id;
}

/**
 * Создаёт недостающие блоки справочника и наполняет их значениями,
 * которые уже повторяются в таблице: сегменты и регионы из «Конкурентов».
 * Существующие блоки не трогаются.
 */
function _подготовитьСправочник_() {
  const comp = _valuesOpt_(SH.COMP);
  const surv = _valuesOpt_(SH.SURVEY);
  const cm = _compMap_(comp);

  const collect = function (rows, idx) {
    const seen = {}, out = [];
    for (let i = 1; i < rows.length; i++) {
      if (idx === undefined || idx < 0) break;
      const v = _str_(rows[i][idx]);
      if (!v) continue;
      const k = _normName_(v);
      if (seen[k]) continue;
      seen[k] = true;
      out.push(v);
    }
    return out.sort(function (a, b) { return a.localeCompare(b, 'ru'); });
  };

  collect(comp, cm.seg).forEach(function (v) { _добавитьВСправочник_('segments', v); });
  collect(comp, cm.region).forEach(function (v) { _добавитьВСправочник_('regions', v); });

  // Должности живут отдельным листом — здесь только создаём его, если нет
  _подготовитьСправочникДолжностей_();

  // Что уже введено в «Обзоре рынка», но чего нет в штатке, — дописываем,
  // иначе эти должности пропадут из выпадающего списка
  for (let i = 1; i < surv.length; i++) {
    const unit = _str_(surv[i][V.UNIT]);
    const our = _str_(surv[i][V.POS_OUR]);
    if (unit && our) _добавитьДолжность_(unit, our);
  }
}

// ─────────────────────────────────────────────────────────────
// АКТУАЛЬНОСТЬ: проверено / требует уточнения / не тронуто
// «уточнить» — это НЕ проверено: руководитель как раз сказал, что не уверен.
// ─────────────────────────────────────────────────────────────

function _класс_(actual) {
  const a = _str_(actual);
  if (!a || a === 'не проверено') return 'todo';
  if (a === 'уточнить') return 'ask';
  return 'done';
}

/** Считает по подразделению: всего / проверено / требует уточнения. */
function _счёт_(comp, cm, unit) {
  const c = { total: 0, done: 0, ask: 0 };
  for (let i = 1; i < comp.length; i++) {
    if (_cell_(comp[i], cm, 'unit') !== unit) continue;
    c.total++;
    const k = _класс_(_cell_(comp[i], cm, 'actual'));
    if (k === 'done') c.done++;
    else if (k === 'ask') c.ask++;
  }
  return c;
}

function _состояние_(c) {
  if (!c.total) return 'не начато';
  if (c.done === c.total) return 'заполнено';
  if (c.done + c.ask === c.total) return 'есть уточнения';
  if (c.done + c.ask > 0) return 'в работе';
  return 'не начато';
}

// ─────────────────────────────────────────────────────────────
// НАСТРОЙКА СИСТЕМЫ (запускается один раз из меню)
// ─────────────────────────────────────────────────────────────

function настроитьСистему() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.alert('Настройка системы',
    'Будут созданы служебные листы (Пользователи, Пароли, Журнал, Статус заполнения, ' +
    'Обзор рынка, Справочник льгот, Период заполнения), ' +
    'в лист «Конкуренты» добавятся 4 служебные колонки и уникальные ID строк, ' +
    'в «Справочник» — блоки должностей, сегментов и регионов.\n\n' +
    'Существующие данные не удаляются. Продолжить?', ui.ButtonSet.YES_NO);
  if (res !== ui.Button.YES) return;

  // Показываем распознанную раскладку до записи: если она неверна,
  // настройка испортит данные, и лучше остановиться здесь.
  const divRows = _valuesOpt_(SH.DIV);
  const compRows = _valuesOpt_(SH.COMP);
  const peoRows = _valuesOpt_(SH.PEOPLE);
  const dm = _divMap_(divRows), cm = _compMap_(compRows), pm = _peopleMap_(peoRows);
  const sample = function (rows, map, key) {
    const i = map[key];
    if (i === undefined || i < 0) return '— не найдена';
    return _indexToLetter_(i) + ' → «' + (rows[1] ? _str_(rows[1][i]) : '') + '»';
  };
  const check = ui.alert('Проверьте раскладку',
    'Скрипт понял колонки так (буква → пример из второй строки):\n\n' +
    'ПОДРАЗДЕЛЕНИЯ\n' +
    '  Подразделение:  ' + sample(divRows, dm, 'unit') + '\n' +
    '  Ответственный:  ' + sample(divRows, dm, 'resp') + '\n' +
    '  HR BP:  ' + sample(divRows, dm, 'hrbp') + '\n\n' +
    'КОНКУРЕНТЫ\n' +
    '  Подразделение:  ' + sample(compRows, cm, 'unit') + '\n' +
    '  Компания:  ' + sample(compRows, cm, 'company') + '\n' +
    '  HR BP:  ' + sample(compRows, cm, 'hrbp') + '\n\n' +
    'УЧАСТНИКИ ОПРОСА\n' +
    '  ФИО:  ' + sample(peoRows, pm, 'fio') + '\n' +
    '  Подразделение:  ' + sample(peoRows, pm, 'unit') + '\n\n' +
    'Всё верно — продолжаем. Если нет, нажмите «Нет»: откроется раскладка, ' +
    'и колонки можно будет задать вручную.', ui.ButtonSet.YES_NO);

  if (check !== ui.Button.YES) {
    настроитьКолонки();
    показатьРаскладку();
    return;
  }

  // Время везде считаем по Душанбе — иначе даты в листах и в форме расходятся
  try { if (_ss_().getSpreadsheetTimeZone() !== TZ) _ss_().setSpreadsheetTimeZone(TZ); } catch (e) {}

  _secret_();
  _подготовитьЛистКонкуренты_();
  _подготовитьЛистОбзора_();
  _подготовитьСправочникЛьгот_();
  _подготовитьСправочники_();
  _подготовитьСправочник_();
  _подготовитьПериод_();
  _подготовитьЖурнал_();
  const n = _создатьПользователей_(false);
  пересчитатьСтатусы();
  упорядочитьЛисты_();

  // Автосинхронизацию включаем сразу: без неё правки оргструктуры приходится
  // догонять пунктом меню, и про это забывают.
  let auto = 'включена';
  try { включитьАвтосинхронизацию_(); }
  catch (e) { auto = 'включить не удалось (' + e.message + ') — включите вручную'; }

  ui.alert('Готово',
    'Система настроена. Создано учётных записей: ' + n + '.\n\n' +
    'Логины и пароли — на листе «' + SH.PWD + '».\n' +
    'Автосинхронизация: ' + auto + '.\n\n' +
    'Дальше: Расширения → Apps Script → Начать развёртывание → Веб-приложение.',
    ui.ButtonSet.OK);
}

function _подготовитьЛистОбзора_() {
  const ss = _ss_();
  let sh = ss.getSheetByName(SH.SURVEY);
  const isNew = !sh;
  if (!sh) sh = ss.insertSheet(SH.SURVEY);
  if (sh.getMaxColumns() < SURVEY_COLS) sh.insertColumnsAfter(sh.getMaxColumns(), SURVEY_COLS - sh.getMaxColumns());
  sh.getRange(1, 1, 1, SURVEY_COLS).setValues([SURVEY_HEADERS])
    .setFontWeight('bold').setBackground('#d0e2f3');
  sh.setFrozenRows(1);
  if (isNew) {
    sh.setColumnWidth(V.POS_OUR + 1, 200);
    sh.setColumnWidth(V.POS_THEIR + 1, 200);
    sh.setColumnWidth(V.BENEFITS + 1, 260);
  }
  if (sh.getLastRow() > 1) {
    sh.getRange(2, V.AT + 1, sh.getLastRow() - 1, 1).setNumberFormat(FMT_DT);
  }
}

function _подготовитьСправочникЛьгот_() {
  const ss = _ss_();
  let sh = ss.getSheetByName(SH.BENEF);
  if (sh && sh.getLastRow() > 1) return;      // уже заполнен вручную — не трогаем
  if (!sh) sh = ss.insertSheet(SH.BENEF);
  sh.clear();
  sh.getRange(1, 1, 1, 2).setValues([['№', 'Льгота']]).setFontWeight('bold').setBackground('#d9ead3');
  const rows = BENEFITS_DEFAULT.map(function (b, i) { return [i + 1, b]; });
  sh.getRange(2, 1, rows.length, 2).setValues(rows);
  sh.setFrozenRows(1);
  sh.setColumnWidth(2, 320);
}

/** Создаёт пустые справочники, если их нет, — чтобы форма не осталась без подсказок. */
function _подготовитьСправочники_() {
  if (!_findSheet_(SH.DICT)) {
    const sh = _ss_().insertSheet(SH.DICT);
    sh.getRange(1, 1, 1, 7).setValues([['№', 'Компания', 'Сегмент', 'Регион присутствия',
      'Тип конкурента', 'Источник', 'В скольких подразделениях']])
      .setFontWeight('bold').setBackground('#d0e2f3');
    sh.setFrozenRows(1);
  }
  if (!_findSheet_(SH.BAN)) {
    const sh = _ss_().insertSheet(SH.BAN);
    sh.getRange(1, 1, 1, 1).setValues([['КОМПАНИИ, КОТОРЫЕ НЕЛЬЗЯ ВКЛЮЧАТЬ В ОБЗОР']]).setFontWeight('bold');
    sh.getRange(4, 1, 1, 3).setValues([['№', 'Компания', 'Причина']])
      .setFontWeight('bold').setBackground('#f4cccc');
  }
}

/**
 * Раскладывает листы в понятном порядке и красит вкладки по назначению.
 * Листы, которых нет, просто пропускаются; посторонние остаются в конце.
 */
function упорядочитьЛисты_() {
  const ss = _ss_();
  let target = 1;
  SHEET_ORDER.forEach(function (item) {
    const sh = _findSheet_(item.name);
    if (!sh) return;
    try { sh.setTabColor(item.color); } catch (e) {}
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(target);
    target++;
  });
  const first = _findSheet_(SH.INSTR) || _findSheet_(SH.COMP);
  if (first) ss.setActiveSheet(first);
  return target - 1;
}

function упорядочитьЛисты() {
  const n = упорядочитьЛисты_();
  SpreadsheetApp.getUi().alert('Готово',
    'Упорядочено листов: ' + n + '.\n\n' +
    'Цвета вкладок:\n' +
    '  фиолетовый — инструкция\n' +
    '  зелёный — рабочие листы (заполняют руководители)\n' +
    '  синий — контроль (смотрит HR BP)\n' +
    '  серый — оргструктура\n' +
    '  жёлтый — справочники\n' +
    '  красный — учётные записи\n' +
    '  коричневый — служебные',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * Выгружает раскладку листов на отдельный лист «Диагностика»:
 * колонка, что написано в шапке, что реально лежит в первых строках.
 * Так сразу видно, если заголовки разъехались с данными.
 */
function показатьРаскладку() {
  const sh = _sheet_(SH.DIAG, true);
  sh.clear();

  const out = [['Лист', 'Колонка', 'Заголовок', 'Значение строки 2', 'Значение строки 3',
                'Распознано как']];

  const dump = function (name, spec, fallback, keyCols) {
    const rows = _valuesOpt_(name);
    if (!rows.length) { out.push([name, '', '(лист пуст или не найден)', '', '', '']); return; }
    const map = _applyManual_(_colmap_(rows[0], spec, fallback, keyCols), name);
    const back = {};
    Object.keys(map).forEach(function (k) { if (map[k] >= 0) back[map[k]] = k; });

    const width = Math.max(rows[0].length,
                           rows[1] ? rows[1].length : 0, rows[2] ? rows[2].length : 0);
    for (let c = 0; c < width; c++) {
      out.push([
        name,
        _indexToLetter_(c),
        _str_(rows[0][c]),
        rows[1] ? _str_(rows[1][c]) : '',
        rows[2] ? _str_(rows[2][c]) : '',
        back[c] || ''
      ]);
    }
    out.push(['', '', '', '', '', '']);
  };

  dump(SH.DIV, DIV_SPEC, DIV_FALLBACK, ['unit']);
  dump(SH.COMP, COMP_SPEC, COMP_FALLBACK, ['unit', 'company']);
  dump(SH.PEOPLE, PEOPLE_SPEC, PEOPLE_FALLBACK, ['fio']);

  sh.getRange(1, 1, out.length, 6).setValues(out);
  sh.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#d0e2f3');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 150); sh.setColumnWidth(2, 80); sh.setColumnWidth(3, 240);
  sh.setColumnWidth(4, 280); sh.setColumnWidth(5, 280); sh.setColumnWidth(6, 150);

  _ss_().setActiveSheet(sh);
  SpreadsheetApp.getUi().alert('Раскладка выгружена',
    'Лист «' + SH.DIAG + '» показывает по каждой колонке: что в шапке, что в данных ' +
    'и как это понял скрипт.\n\nЕсли в столбце «Распознано как» стоит не то — ' +
    'откройте «Настройка колонок» и пропишите нужные буквы вручную.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Создаёт лист ручной привязки колонок с подсказками. */
function настроитьКолонки() {
  const ss = _ss_();
  let sh = _findSheet_(SH.COLS);
  if (!sh) {
    sh = ss.insertSheet(SH.COLS);
    sh.getRange(1, 1, 1, 4).setValues([['Лист', 'Поле', 'Колонка', 'Пояснение']])
      .setFontWeight('bold').setBackground('#fff2cc');
    const rows = [
      [SH.DIV,    'unit',    '', 'Подразделение — обязательно'],
      [SH.DIV,    'dir',     '', 'Направление / департамент'],
      [SH.DIV,    'head',    '', 'Руководитель'],
      [SH.DIV,    'resp',    '', 'Ответственный за обзор рынка'],
      [SH.DIV,    'hrbp',    '', 'HR BP'],
      [SH.COMP,   'unit',    '', 'Подразделение — обязательно'],
      [SH.COMP,   'company', '', 'Компания-конкурент — обязательно'],
      [SH.COMP,   'dir',     '', 'Направление / департамент'],
      [SH.COMP,   'resp',    '', 'Ответственный за обзор рынка'],
      [SH.COMP,   'hrbp',    '', 'HR BP'],
      [SH.COMP,   'type',    '', 'Тип конкурента'],
      [SH.COMP,   'seg',     '', 'Сегмент'],
      [SH.COMP,   'region',  '', 'Регион присутствия'],
      [SH.COMP,   'prio',    '', 'Приоритет'],
      [SH.COMP,   'status',  '', 'Статус'],
      [SH.COMP,   'src',     '', 'Источник данных'],
      [SH.COMP,   'note',    '', 'Комментарий руководителя'],
      [SH.COMP,   'actual',  '', 'Актуальность — служебная'],
      [SH.COMP,   'by',      '', 'Кто заполнил — служебная'],
      [SH.COMP,   'at',      '', 'Дата заполнения — служебная'],
      [SH.COMP,   'id',      '', 'ID — служебная, обязательна для сохранения'],
      [SH.COMP,   'idComp',  '', 'ID_Комп — ключ к «Справочнику», по нему работают формулы'],
      [SH.PEOPLE, 'fio',     '', 'ФИО — обязательно, НЕ колонка ID_Человек'],
      [SH.PEOPLE, 'unit',    '', 'Подразделение участника'],
      [SH.PEOPLE, 'role',    '', 'Роль в опросе']
    ];
    sh.getRange(2, 1, rows.length, 4).setValues(rows);
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 150); sh.setColumnWidth(2, 110);
    sh.setColumnWidth(3, 90);  sh.setColumnWidth(4, 360);
    sh.getRange(2, 3, rows.length, 1).setBackground('#fff2cc');
  }
  _ss_().setActiveSheet(sh);
  SpreadsheetApp.getUi().alert('Настройка колонок',
    'Впишите в колонку «Колонка» букву столбца — например C или J.\n\n' +
    'Заполнять нужно только те строки, где автоопределение ошиблось. ' +
    'Пустые строки не влияют ни на что.\n\n' +
    'Какая буква чему соответствует — смотрите на листе «' + SH.DIAG + '» ' +
    '(меню → Показать раскладку листов).', SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Показывает, какие листы найдены, а каких не хватает. Первое, что стоит открыть при сбое. */
function проверитьЛисты() {
  const ui = SpreadsheetApp.getUi();

  const required = [SH.DIV, SH.COMP, SH.USERS];
  const optional = [SH.PEOPLE, SH.REF, SH.POS, SH.DICT, SH.BAN, SH.BENEF,
                    SH.SURVEY, SH.PERIOD, SH.LOG, SH.STATUS];

  const line = function (name) {
    const sh = _findSheet_(name);
    if (!sh) return '   ✕  ' + name + '  — НЕТ';
    const real = sh.getName();
    const rows = Math.max(sh.getLastRow() - 1, 0);
    const note = (real === name) ? '' : '  (в файле: «' + real + '»)';
    return '   ✓  ' + name + '  — строк: ' + rows + note;
  };

  let msg = 'ОБЯЗАТЕЛЬНЫЕ\n' + required.map(line).join('\n') +
            '\n\nНЕОБЯЗАТЕЛЬНЫЕ\n' + optional.map(line).join('\n');

  const missingReq = required.filter(function (n) { return !_findSheet_(n); });
  const missingOpt = optional.filter(function (n) { return !_findSheet_(n); });

  // Какие колонки распознались — без этого не понять, почему пустые названия
  const showMap = function (title, rows, map, keys) {
    if (!rows.length) return '\n\n' + title + '\n   лист пуст';
    return '\n\n' + title + '\n   заголовки: ' +
      rows[0].map(function (h) { return _str_(h) || '·'; }).join(' | ') + '\n' +
      keys.map(function (k) {
        return '   ' + k + ' → ' + (map[k] >= 0 ? _indexToLetter_(map[k]) : '— НЕ НАЙДЕНА');
      }).join('\n');
  };

  const divRows = _valuesOpt_(SH.DIV);
  const compRows = _valuesOpt_(SH.COMP);
  const peoRows = _valuesOpt_(SH.PEOPLE);
  msg += showMap('КОЛОНКИ «' + SH.DIV + '»', divRows, _divMap_(divRows),
                 ['unit', 'dir', 'head', 'resp', 'hrbp']);
  msg += showMap('КОЛОНКИ «' + SH.COMP + '»', compRows, _compMap_(compRows),
                 ['unit', 'company', 'resp', 'hrbp', 'actual', 'id', 'idComp']);
  msg += showMap('КОЛОНКИ «' + SH.PEOPLE + '»', peoRows, _peopleMap_(peoRows),
                 ['fio', 'unit', 'role']);

  const ref = _справочник_();
  msg += '\n\nСПРАВОЧНИК\n' + Object.keys(REF_BLOCKS).map(function (k) {
    return '   ' + REF_BLOCKS[k].head + ' → ' + ref[k].length + ' знач.';
  }).join('\n');

  // Сколько подразделений реально получат свой список должностей
  const pos = _должности_();
  let withPos = 0;
  for (let i = 1; i < divRows.length; i++) {
    const u = _cell_(divRows[i], _divMap_(divRows), 'unit');
    if (u && (pos.byUnit[_normName_(u)] || []).length) withPos++;
  }
  msg += '\n\nШТАТКА («' + SH.POS + '»)\n' +
         '   должностей всего: ' + pos.all.length + '\n' +
         '   подразделений со своим списком: ' + withPos +
         ' из ' + Math.max(divRows.length - 1, 0);

  // Дубли названий подразделений: система связывает всё по названию,
  // поэтому две строки с одним именем дают две одинаковых карточки в форме.
  const dupDiv = (function () {
    const rows = _valuesOpt_(SH.DIV);
    const dm2 = _divMap_(rows);
    const seen = {}, dup = {};
    for (let i = 1; i < rows.length; i++) {
      const u = _cell_(rows[i], dm2, 'unit');
      if (!u) continue;
      const k = _normName_(u);
      if (seen[k]) { dup[u] = (dup[u] || [seen[k]]).concat([i + 1]); }
      else seen[k] = i + 1;
    }
    return dup;
  })();
  const dupNames = Object.keys(dupDiv);
  if (dupNames.length) {
    msg += '\n\n⚠ ПОВТОРЫ В «' + SH.DIV + '»\n' +
      dupNames.slice(0, 10).map(function (n) {
        return '   «' + n + '» — строки ' + dupDiv[n].join(', ');
      }).join('\n') +
      (dupNames.length > 10 ? '\n   … и ещё ' + (dupNames.length - 10) : '') +
      '\n   Форма покажет такое подразделение один раз, но в таблице лишние строки ' +
      'стоит убрать: цифры по ним считаются по названию и дублируются.';
  }

  msg += '\n\nВСЕ ЛИСТЫ В ФАЙЛЕ\n   ' +
         _ss_().getSheets().map(function (s) { return s.getName(); }).join('\n   ');

  if (missingReq.length) {
    msg += '\n\n⚠ Без листов ' + missingReq.join(', ') + ' форма работать не будет.\n' +
           'Проверьте, что скрипт привязан к общей таблице, а не к копии по HR BP.';
  } else if (missingOpt.length) {
    msg += '\n\nНе хватает необязательных: ' + missingOpt.join(', ') + '.\n' +
           'Форма работает, но без подсказок из них. Запустите «1. Настроить систему», ' +
           'чтобы создать недостающие.';
  } else {
    msg += '\n\nВсё на месте.';
  }

  ui.alert('Проверка листов', msg, ui.ButtonSet.OK);
}

function _подготовитьПериод_() {
  const ss = _ss_();
  let sh = ss.getSheetByName(SH.PERIOD);
  if (sh && sh.getLastRow() > 1) return;
  if (!sh) sh = ss.insertSheet(SH.PERIOD);
  sh.clear();
  sh.getRange(1, 1, 1, 2).setValues([['Параметр', 'Значение']])
    .setFontWeight('bold').setBackground('#fff2cc');
  sh.getRange(2, 1, 6, 2).setValues([
    ['Название периода', 'Обзор рынка — ' + Utilities.formatDate(new Date(), TZ, 'MMMM yyyy')],
    ['Состояние', 'открыт'],
    ['Дата начала', new Date()],
    ['Дата окончания', ''],
    ['Кто изменил', ''],
    ['Когда изменено', '']
  ]);
  sh.getRange(4, 2).setNumberFormat(FMT_DT);
  sh.getRange(5, 2).setNumberFormat(FMT_DT);
  sh.getRange(7, 2).setNumberFormat(FMT_DT);
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 180);
  sh.setColumnWidth(2, 320);
}

/**
 * Готовит лист «Конкуренты»: дописывает служебные колонки и проставляет ID.
 * Существующие заголовки не трогаем — раскладка у разных копий своя.
 */
function _подготовитьЛистКонкуренты_() {
  const sh = _sheet_(SH.COMP);
  sh.setFrozenRows(1);

  let width = Math.max(sh.getLastColumn(), 1);
  let header = sh.getRange(1, 1, 1, width).getValues()[0];

  // Служебные колонки ищем по названию, недостающие дописываем в конец
  const service = ['Актуальность', 'Кто заполнил', 'Дата заполнения', 'ID'];
  const has = {};
  for (let c = 0; c < header.length; c++) has[_normName_(header[c])] = c;

  const toAdd = service.filter(function (n) { return has[_normName_(n)] === undefined; });
  if (toAdd.length) {
    if (sh.getMaxColumns() < width + toAdd.length) {
      sh.insertColumnsAfter(sh.getMaxColumns(), width + toAdd.length - sh.getMaxColumns());
    }
    sh.getRange(1, width + 1, 1, toAdd.length).setValues([toAdd])
      .setFontWeight('bold').setBackground('#d0e2f3');
    width += toAdd.length;
    header = sh.getRange(1, 1, 1, width).getValues()[0];
  }

  const cm = _compMap_([header]);
  const lr = sh.getLastRow();
  if (lr < 2) return;
  const n = lr - 1;

  // ID и «Актуальность» пишем по колонкам, чтобы не трогать формулы в соседних
  const seen = {};
  _writeCol_(sh, cm.id, 2, n, function (i, cur) {
    let id = _str_(cur);
    if (!id || seen[id]) id = 'R' + Utilities.getUuid().slice(0, 8).toUpperCase();
    seen[id] = true;
    return id;
  });
  _writeCol_(sh, cm.actual, 2, n, function (i, cur) {
    return _str_(cur) ? undefined : 'не проверено';
  });
  if (cm.at >= 0) sh.getRange(2, cm.at + 1, n, 1).setNumberFormat(FMT_DT);
}

// ─────────────────────────────────────────────────────────────
// ДУБЛИ В СПРАВОЧНИКЕ КОМПАНИЙ
// «Фатир» и «Фатир (ГП)», «LEGA» и «Lega», «Сахо» и «ҶДММ "Сахо"» —
// это одна компания. Оставляем один ID и переводим на него ссылки.
// ─────────────────────────────────────────────────────────────

/** Сводит название к сравнимому виду: регистр, кавычки, форма собственности, дефисы. */
function _ключКомпании_(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[«»"'`]/g, '')
    .replace(/\bҷдмм\b|\bчдмм\b|\bҷсп\b|\bчсп\b|\bооо\b|\bзао\b|\bоао\b/g, '')
    .replace(/\(гп\)/g, '')
    .replace(/ё/g, 'е').replace(/ҷ/g, 'ч').replace(/ӯ/g, 'у').replace(/ҳ/g, 'х')
    .replace(/ғ/g, 'г').replace(/қ/g, 'к').replace(/ӣ/g, 'и')
    .replace(/[\s\-_.]/g, '')
    .trim();
}

/** Группы дублей: [{keep:{id,name}, drop:[{id,name}…]}]. Оставляем самый короткий ID. */
function _группыДублей_() {
  const list = _valuesOpt_(SH.REF);
  if (!list.length) return [];
  const pos = _позицииБлоков_(list[0]).companies;
  if (!pos || pos.name < 0) return [];

  const buckets = {};
  for (let i = 1; i < list.length; i++) {
    const id = _str_(list[i][pos.id]);
    const name = _str_(list[i][pos.name]);
    if (!id || !name) continue;
    const k = _ключКомпании_(name);
    if (!k) continue;
    if (!buckets[k]) buckets[k] = [];
    buckets[k].push({ id: id, name: name, row: i + 1 });
  }

  const out = [];
  Object.keys(buckets).forEach(function (k) {
    const g = buckets[k];
    if (g.length < 2) return;
    // Оставляем запись с наименьшим числовым ID — она старше и на неё больше ссылок
    g.sort(function (a, b) {
      const na = parseInt(a.id.replace(/\D/g, ''), 10) || 0;
      const nb = parseInt(b.id.replace(/\D/g, ''), 10) || 0;
      return na - nb;
    });
    out.push({ keep: g[0], drop: g.slice(1) });
  });
  return out;
}

function найтиДублиКомпаний() {
  const ui = SpreadsheetApp.getUi();
  const groups = _группыДублей_();
  if (!groups.length) { ui.alert('Дублей не найдено.'); return; }
  const txt = groups.map(function (g) {
    return '• оставить ' + g.keep.id + ' «' + g.keep.name + '»\n    убрать: ' +
      g.drop.map(function (d) { return d.id + ' «' + d.name + '»'; }).join(', ');
  }).join('\n');
  ui.alert('Дубли компаний (' + groups.length + ' групп)',
    txt + '\n\nЧтобы применить — меню «Объединить дубли компаний».', ui.ButtonSet.OK);
}

/**
 * Объединяет дубли: в «Конкурентах» подменяет ID_Комп на оставленный,
 * а в «Справочнике» помечает лишние строки как объединённые.
 * Строки справочника не удаляются — иначе поедут формулы соседних блоков.
 */
function объединитьДублиКомпаний() {
  const ui = SpreadsheetApp.getUi();
  const groups = _группыДублей_();
  if (!groups.length) { ui.alert('Дублей не найдено.'); return; }

  const swap = {};
  let dropCount = 0;
  groups.forEach(function (g) {
    g.drop.forEach(function (d) { swap[d.id] = g.keep; dropCount++; });
  });

  const res = ui.alert('Объединить дубли',
    'Групп: ' + groups.length + ', лишних ID: ' + dropCount + '.\n\n' +
    'В листе «' + SH.COMP + '» ссылки ID_Комп переведутся на оставленный ID.\n' +
    'В «' + SH.REF + '» лишние строки будут помечены «→ объединено с …», но не удалены.\n\n' +
    'Продолжить?', ui.ButtonSet.YES_NO);
  if (res !== ui.Button.YES) return;

  // 1) переводим ссылки в «Конкурентах»
  const sh = _sheet_(SH.COMP);
  const lr = sh.getLastRow();
  let moved = 0;
  if (lr > 1) {
    const cm = _compMap_([sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]]);
    const n = lr - 1;
    // Старые ID читаем разом: построчный getValue на сотне строк — это сотня запросов
    const oldIds = (cm.idComp >= 0)
      ? sh.getRange(2, cm.idComp + 1, n, 1).getValues().map(function (r) { return _str_(r[0]); })
      : [];
    moved = _writeCol_(sh, cm.idComp, 2, n, function (i) {
      const id = oldIds[i];
      return (id && swap[id]) ? swap[id].id : undefined;
    });
    // Если названия лежат литералами, а не формулой — обновляем и их
    _writeCol_(sh, cm.company, 2, n, function (i) {
      const id = oldIds[i];
      return (id && swap[id]) ? swap[id].name : undefined;
    });
  }

  // 2) помечаем лишние строки справочника
  const rsh = _sheet_(SH.REF);
  const rows = rsh.getRange(1, 1, rsh.getLastRow(), rsh.getLastColumn()).getValues();
  const pos = _позицииБлоков_(rows[0]).companies;
  let marked = 0;
  if (pos && pos.name >= 0) {
    groups.forEach(function (g) {
      g.drop.forEach(function (d) {
        rsh.getRange(d.row, pos.name + 1)
          .setValue(d.name + '  → объединено с ' + g.keep.id)
          .setFontColor('#9aa0a6').setFontLine('line-through');
        marked++;
      });
    });
  }

  _сброситьСправочник_();
  _log_('меню', 'объединение дублей',
    'групп: ' + groups.length + ', ссылок переведено: ' + moved + ', помечено: ' + marked);
  ui.alert('Готово',
    'Групп объединено: ' + groups.length + '\n' +
    'Ссылок переведено в «' + SH.COMP + '»: ' + moved + '\n' +
    'Помечено строк в «' + SH.REF + '»: ' + marked, ui.ButtonSet.OK);
}

// ─────────────────────────────────────────────────────────────
// ПЕРИОД ЗАПОЛНЕНИЯ
// ─────────────────────────────────────────────────────────────

/** Читает лист «Период заполнения» как объект. */
function _период_() {
  let rows;
  try { rows = _values_(SH.PERIOD); }
  catch (e) { return { name: '', state: 'открыт', from: '', to: '', by: '', at: '' }; }
  const m = {};
  for (let i = 1; i < rows.length; i++) m[_str_(rows[i][0])] = rows[i][1];
  return {
    name: _str_(m['Название периода']),
    state: (_str_(m['Состояние']) || 'открыт').toLowerCase(),
    from: _дата_(m['Дата начала'], true),
    to: _дата_(m['Дата окончания'], true),
    by: _str_(m['Кто изменил']),
    at: _дата_(m['Когда изменено'], true)
  };
}

function _записатьПериод_(patch, who) {
  const sh = _sheet_(SH.PERIOD, true);
  if (sh.getLastRow() < 2) _подготовитьПериод_();
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  const setKey = function (key, val) {
    for (let i = 0; i < rows.length; i++) {
      if (_str_(rows[i][0]) === key) { rows[i][1] = val; return; }
    }
    rows.push([key, val]);
  };
  if (patch.name !== undefined)  setKey('Название периода', patch.name);
  if (patch.state !== undefined) setKey('Состояние', patch.state);
  if (patch.from !== undefined)  setKey('Дата начала', patch.from);
  if (patch.to !== undefined)    setKey('Дата окончания', patch.to);
  setKey('Кто изменил', who || '');
  setKey('Когда изменено', new Date());
  sh.getRange(2, 1, rows.length, 2).setValues(rows);
  // Даты периода показываем с часами: «закрыт 31.08.2026» без времени спорно
  for (let i = 0; i < rows.length; i++) {
    const k = _str_(rows[i][0]);
    if (k === 'Дата начала' || k === 'Дата окончания' || k === 'Когда изменено') {
      sh.getRange(i + 2, 2).setNumberFormat(FMT_DT);
    }
  }
}

/** Можно ли сейчас писать данные. HR BP может править и после закрытия периода. */
function _можноПисать_(user) {
  const p = _период_();
  if (p.state === 'закрыт' && user.role !== 'hrbp') {
    return { ok: false, error: 'Период заполнения закрыт' +
      (p.to ? ' (до ' + p.to + ')' : '') + '. Обратитесь к своему HR BP.' };
  }
  return { ok: true, period: p };
}

function открытьПериод() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Открыть период заполнения',
    'Название периода (например: Обзор рынка — сентябрь 2026).\n' +
    'Оставьте пустым, чтобы не менять название.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const name = r.getResponseText().trim();
  const patch = { state: 'открыт', from: new Date(), to: '' };
  if (name) patch.name = name;
  _записатьПериод_(patch, Session.getActiveUser().getEmail() || 'из меню');
  _log_('меню', 'период открыт', name);
  ui.alert('Период открыт. Руководители снова могут вносить данные.');
}

function закрытьПериод() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.alert('Закрыть период заполнения',
    'Руководители перестанут вносить и удалять данные — форма перейдёт в режим просмотра.\n' +
    'HR BP смогут править дальше. Продолжить?', ui.ButtonSet.YES_NO);
  if (res !== ui.Button.YES) return;
  _записатьПериод_({ state: 'закрыт', to: new Date() },
    Session.getActiveUser().getEmail() || 'из меню');
  _log_('меню', 'период закрыт', '');
  ui.alert('Период закрыт. Форма работает в режиме просмотра.');
}

/** Физически удаляет строки обзора, помеченные как «удалена». */
function очиститьУдалённые() {
  const ui = SpreadsheetApp.getUi();
  const sh = _sheet_(SH.SURVEY);
  const lr = sh.getLastRow();
  if (lr < 2) { ui.alert('Удалённых записей нет.'); return; }
  const vals = sh.getRange(2, 1, lr - 1, SURVEY_COLS).getValues();
  const kill = [];
  for (let i = 0; i < vals.length; i++) {
    if (_str_(vals[i][V.STATE]) === 'удалена') kill.push(i + 2);
  }
  if (!kill.length) { ui.alert('Удалённых записей нет.'); return; }
  const res = ui.alert('Очистка',
    'Будет безвозвратно удалено строк: ' + kill.length + '. Продолжить?', ui.ButtonSet.YES_NO);
  if (res !== ui.Button.YES) return;
  kill.reverse().forEach(function (r) { sh.deleteRow(r); });
  _log_('меню', 'очистка обзора', 'удалено строк: ' + kill.length);
  ui.alert('Удалено строк: ' + kill.length);
}

/**
 * Смена пароля одному человеку. Остальные учётки не трогаем.
 * Ищем по логину целиком или по части ФИО.
 */
function сменитьПарольОдному() {
  const ui = SpreadsheetApp.getUi();
  const ask = ui.prompt('Смена пароля',
    'Введите логин целиком или часть ФИО:', ui.ButtonSet.OK_CANCEL);
  if (ask.getSelectedButton() !== ui.Button.OK) return;

  const q = _normName_(ask.getResponseText());
  if (!q) return;

  const ush = _sheet_(SH.USERS);
  if (ush.getLastRow() < 2) { ui.alert('Список пользователей пуст.'); return; }
  const rows = ush.getRange(2, 1, ush.getLastRow() - 1, 7).getValues();

  const hits = [];
  for (let i = 0; i < rows.length; i++) {
    const login = _normName_(rows[i][U.LOGIN]);
    const fio = _normName_(rows[i][U.FIO]);
    if (login === q || (fio && fio.indexOf(q) >= 0)) hits.push({ row: i + 2, data: rows[i] });
  }

  if (!hits.length) { ui.alert('Никого не нашли по запросу «' + ask.getResponseText() + '».'); return; }
  if (hits.length > 1) {
    ui.alert('Нашлось несколько (' + hits.length + ')',
      hits.slice(0, 15).map(function (h) {
        return '• ' + _str_(h.data[U.FIO]) + '  —  ' + _str_(h.data[U.LOGIN]);
      }).join('\n') + '\n\nПовторите запрос точнее — например, укажите логин целиком.',
      ui.ButtonSet.OK);
    return;
  }

  const hit = hits[0];
  const fio = _str_(hit.data[U.FIO]);
  const login = _str_(hit.data[U.LOGIN]);
  const ok = ui.alert('Подтвердите',
    fio + '\nЛогин: ' + login + '\n\nВыдать этому человеку новый пароль? ' +
    'Старый перестанет работать сразу.', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  const pwd = _makePassword_();
  ush.getRange(hit.row, U.HASH + 1).setValue(_hash_(pwd));
  _обновитьВыдачуПароля_(fio, login, pwd, _str_(hit.data[U.ROLE]));
  _log_('меню', 'смена пароля', login);

  ui.alert('Новый пароль выдан',
    fio + '\n\nЛогин:  ' + login + '\nПароль:  ' + pwd +
    '\n\nЭта же строка обновлена на листе «' + SH.PWD + '».', ui.ButtonSet.OK);
}

/**
 * Готовит лист выдачи паролей и при необходимости переводит его
 * со старой пятиколоночной раскладки на новую с телефоном.
 * Телефоны, уже проставленные вручную, сохраняются.
 */
function _подготовитьЛистПаролей_() {
  const psh = _sheet_(SH.PWD, true);
  if (psh.getMaxColumns() < PWD_COLS) {
    psh.insertColumnsAfter(psh.getMaxColumns(), PWD_COLS - psh.getMaxColumns());
  }
  const lr = psh.getLastRow();
  if (lr === 0) {
    psh.getRange(1, 1, 1, PWD_COLS).setValues([PWD_HEADERS])
      .setFontWeight('bold').setBackground('#fff2cc');
    psh.setFrozenRows(1);
    psh.getRange(2, PW.PHONE + 1, psh.getMaxRows() - 1, 1).setNumberFormat('@');
    return psh;
  }
  const head = psh.getRange(1, 1, 1, Math.max(psh.getLastColumn(), 1)).getValues()[0];
  if (_normName_(head[PW.PHONE] || '') === _normName_('Телефон')) return psh;

  // Старая раскладка: ФИО | Роль | Логин | Пароль | Подразделений.
  // Вставляем «Телефон» перед последней колонкой, данные не теряем.
  psh.insertColumnAfter(PW.PWD + 1);
  psh.getRange(1, 1, 1, PWD_COLS).setValues([PWD_HEADERS])
    .setFontWeight('bold').setBackground('#fff2cc');
  psh.setFrozenRows(1);
  // Телефон храним текстом, иначе «+992…» превращается в формулу, а ведущий ноль пропадает
  psh.getRange(2, PW.PHONE + 1, Math.max(psh.getMaxRows() - 1, 1), 1).setNumberFormat('@');
  return psh;
}

/** Обновляет или добавляет строку на листе выдачи паролей. */
function _обновитьВыдачуПароля_(fio, login, pwd, role) {
  const psh = _подготовитьЛистПаролей_();
  const roleRu = role === 'hrbp' ? 'HR BP' : (role === 'head' ? 'Руководитель' : 'Участник');
  const lr = psh.getLastRow();
  if (lr > 1) {
    const vals = psh.getRange(2, 1, lr - 1, PWD_COLS).getValues();
    for (let i = 0; i < vals.length; i++) {
      if (_normName_(vals[i][PW.LOGIN]) === _normName_(login)) {
        psh.getRange(i + 2, PW.PWD + 1).setValue(pwd);
        return;
      }
    }
  }
  psh.getRange(psh.getLastRow() + 1, 1, 1, PWD_COLS)
     .setValues([[fio, roleRu, login, pwd, '', '']]);
}

function пересоздатьПароли() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.alert('Пересоздать пароли',
    'Всем пользователям будут выданы НОВЫЕ пароли. Старые перестанут работать. Продолжить?',
    ui.ButtonSet.YES_NO);
  if (res !== ui.Button.YES) return;
  const n = _создатьПользователей_(true);
  ui.alert('Готово', 'Обновлено записей: ' + n + '. Смотрите лист «' + SH.PWD + '».', ui.ButtonSet.OK);
}

/**
 * Собирает список пользователей из листов «Подразделения» и «Участники опроса».
 * Роли: hrbp (HR BP), head (ответственный за обзор рынка), guest (участник без подразделения).
 *
 * Колонки листа «Участники опроса» читаются по заголовкам. Раньше здесь стояли
 * жёсткие индексы 1 и 2 — из-за них в ФИО попадал ID_Человек («Ч96»),
 * а логин получался «ch96». Заодно это плодило вторую учётку тем,
 * кто уже был в списке под своим именем.
 */
function _создатьПользователей_(resetAll) {
  const divs = _values_(SH.DIV);
  const people = _valuesOpt_(SH.PEOPLE);

  const hrbpSet = {};        // ФИО HR BP -> true
  const respUnits = {};      // ФИО ответственного -> [подразделения]
  const hrbpUnits = {};      // ФИО HR BP -> [подразделения]

  const dm = _divMap_(divs);
  for (let i = 1; i < divs.length; i++) {
    const unit = _cell_(divs[i], dm, 'unit');
    if (!unit) continue;
    const resp = _cell_(divs[i], dm, 'resp') || _cell_(divs[i], dm, 'head');
    const hrbp = _cell_(divs[i], dm, 'hrbp');
    if (resp && resp !== '—' && !_похожеНаId_(resp)) {
      if (!respUnits[resp]) respUnits[resp] = [];
      respUnits[resp].push(unit);
    }
    if (hrbp && hrbp !== '—' && !_похожеНаId_(hrbp)) {
      hrbpSet[hrbp] = true;
      if (!hrbpUnits[hrbp]) hrbpUnits[hrbp] = [];
      hrbpUnits[hrbp].push(unit);
    }
  }

  // Полный список людей: участники опроса + все ответственные + все HR BP
  const all = {};            // ФИО -> [подразделения из оргструктуры]
  const pm = _peopleMap_(people);
  const skipped = [];
  for (let i = 1; i < people.length; i++) {
    const fio = _cell_(people[i], pm, 'fio');
    if (!fio) continue;
    if (_похожеНаId_(fio)) { skipped.push(fio); continue; }   // в колонке ФИО лежит ID — не заводим учётку
    const unit = _cell_(people[i], pm, 'unit');
    if (!all[fio]) all[fio] = [];
    if (unit && all[fio].indexOf(unit) === -1) all[fio].push(unit);
  }
  Object.keys(respUnits).forEach(function (f) { if (!(f in all)) all[f] = []; });
  Object.keys(hrbpUnits).forEach(function (f) { if (!(f in all)) all[f] = []; });

  // Существующие пользователи — чтобы не терять логины и назначенные подразделения
  // Прежние учётки ищем по нормализованному ФИО, а не по строке символ-в-символ.
  // Иначе двойной пробел или «ё» вместо «е» в справочнике делают человека новым:
  // ему выдаётся новый пароль, а тот, которым он пользуется, перестаёт работать.
  const ush = _sheet_(SH.USERS, true);
  const old = {};
  if (ush.getLastRow() > 1) {
    const ov = ush.getRange(2, 1, ush.getLastRow() - 1, 7).getValues();
    ov.forEach(function (r) {
      const f = _str_(r[U.FIO]);
      if (f) old[_normName_(f)] = r;
    });
  }

  const taken = {};
  Object.keys(old).forEach(function (f) {
    if (!_похожеНаId_(f)) taken[_str_(old[f][U.LOGIN]).toLowerCase()] = true;
  });

  const users = [], plain = [];
  Object.keys(all).sort(function (a, b) { return a.localeCompare(b, 'ru'); }).forEach(function (fio) {
    const prev = old[_normName_(fio)];
    const login = prev ? _str_(prev[U.LOGIN]) : _makeLogin_(fio, taken);

    let role = 'guest';
    if (hrbpUnits[fio]) role = 'hrbp';
    else if (respUnits[fio]) role = 'head';

    // Подразделения: у HR BP — его блок, у руководителя — где он ответственный,
    // у участника — из «Участников опроса», иначе ранее выбранное вручную
    let units = [];
    if (role === 'hrbp') units = (hrbpUnits[fio] || []).concat(respUnits[fio] || []);
    else if (role === 'head') units = respUnits[fio] || [];
    else if (all[fio] && all[fio].length) units = all[fio].slice();
    else if (prev) units = _str_(prev[U.UNITS]).split(';').map(function (s) { return s.trim(); }).filter(String);
    units = units.filter(function (v, i, a) { return a.indexOf(v) === i; });

    let hash, pwd = '';
    if (!prev || resetAll) { pwd = _makePassword_(); hash = _hash_(pwd); }
    else { hash = _str_(prev[U.HASH]); }

    users.push([login, hash, fio, role, units.join('; '), 'да', prev ? prev[U.LASTIN] : '']);
    // порядок колонок задаёт PW: ФИО | Роль | Логин | Пароль | Телефон | Подразделений
    if (pwd) plain.push([fio, role === 'hrbp' ? 'HR BP' : (role === 'head' ? 'Руководитель' : 'Участник'),
                         login, pwd, '', units.length]);
  });

  // Записываем лист «Пользователи»
  ush.clear();
  ush.getRange(1, 1, 1, 7).setValues([['Логин', 'Хеш пароля', 'ФИО', 'Роль',
    'Подразделения (через ;)', 'Активен', 'Последний вход']])
    .setFontWeight('bold').setBackground('#f4cccc');
  if (users.length) {
    ush.getRange(2, 1, users.length, 7).setValues(users);
    ush.getRange(2, U.LASTIN + 1, users.length, 1).setNumberFormat(FMT_DT);
  }
  ush.setFrozenRows(1);
  ush.setColumnWidth(1, 150);
  ush.setColumnWidth(2, 60);
  ush.setColumnWidth(3, 280);
  ush.hideColumns(2);

  // Лист выдачи паролей.
  // Раньше он очищался целиком, и после повторного запуска на нём оставались
  // только что созданные учётки — пароли остальных пропадали безвозвратно
  // (в «Пользователях» лежат только хеши). Теперь старые строки сохраняются.
  const psh = _подготовитьЛистПаролей_();
  if (plain.length) {
    // Телефоны, введённые вручную, переносим по логину — иначе бот перестанет узнавать людей
    const keep = [], phone = {};
    if (psh.getLastRow() > 1) {
      const fresh = {};
      plain.forEach(function (p) { fresh[_normName_(p[PW.LOGIN])] = true; });
      psh.getRange(2, 1, psh.getLastRow() - 1, PWD_COLS).getValues().forEach(function (r) {
        const lg = _str_(r[PW.LOGIN]);
        if (!lg) return;
        if (_str_(r[PW.PHONE])) phone[_normName_(lg)] = _str_(r[PW.PHONE]);
        if (!fresh[_normName_(lg)]) keep.push(r);
      });
    }
    plain.forEach(function (p) { p[PW.PHONE] = phone[_normName_(p[PW.LOGIN])] || ''; });
    const out = keep.concat(plain).sort(function (a, b) {
      return String(a[PW.FIO]).localeCompare(String(b[PW.FIO]), 'ru');
    });
    psh.clear();
    psh.getRange(1, 1, 1, PWD_COLS).setValues([PWD_HEADERS])
       .setFontWeight('bold').setBackground('#fff2cc');
    psh.getRange(2, 1, out.length, PWD_COLS).setValues(out);
    psh.getRange(2, PW.PHONE + 1, out.length, 1).setNumberFormat('@');
    psh.setFrozenRows(1);
    psh.autoResizeColumns(1, PWD_COLS);
  }

  if (skipped.length) {
    _log_('меню', 'учётки: пропущены строки без ФИО',
      'в колонке ФИО стоял ID: ' + skipped.length + ' шт.');
  }
  return users.length;
}

// ─────────────────────────────────────────────────────────────
// API ДЛЯ ФОРМЫ
// ─────────────────────────────────────────────────────────────

/** Вход по логину и паролю. */
function apiLogin(login, password) {
  try {
    const u = _findUser_(login);
    if (!u || !u.active) return { ok: false, error: 'Неверный логин или пароль' };
    if (u.hash !== _hash_(String(password))) return { ok: false, error: 'Неверный логин или пароль' };

    try {
      const cell = _sheet_(SH.USERS).getRange(u.row, U.LASTIN + 1);
      cell.setValue(new Date()).setNumberFormat(FMT_DT);
    } catch (e) {}
    _log_(u.login, 'вход', '');

    return { ok: true, token: _makeToken_(u.login), data: _bootstrap_(u) };
  } catch (e) {
    return { ok: false, error: 'Ошибка сервера: ' + e.message };
  }
}

/** Восстановление сессии по сохранённому токену. */
function apiResume(token) {
  try {
    const u = _auth_(token);
    return { ok: true, token: token, data: _bootstrap_(u) };
  } catch (e) {
    return { ok: false, error: e.message === 'AUTH' ? 'Сессия истекла' : e.message };
  }
}

/**
 * Один вызов отдаёт всё, что нужно форме: подразделения пользователя,
 * все его строки конкурентов и справочники. Дальше форма работает локально.
 */
function _bootstrap_(u) {
  _сброситьСправочник_();
  _сброситьДолжности_();
  const divs = _values_(SH.DIV);       // без структуры подразделений работать нельзя
  const comp = _values_(SH.COMP);      // и без карты конкурентов тоже
  const dict = _valuesOpt_(SH.DICT);   // дальше — необязательные справочники
  const ban  = _valuesOpt_(SH.BAN);
  const surv = _valuesOpt_(SH.SURVEY);
  const benefRows = _valuesOpt_(SH.BENEF);
  const ref = _справочник_();
  let benef = [];
  for (let i = 1; i < benefRows.length; i++) if (_str_(benefRows[i][1])) benef.push(_str_(benefRows[i][1]));
  if (!benef.length) benef = BENEFITS_DEFAULT.slice();

  const myUnits = {};
  u.units.forEach(function (x) { myUnits[x] = true; });

  // Подразделения пользователя
  const dm = _divMap_(divs);
  const cm = _compMap_(comp);
  const units = [];
  const allUnits = [];
  // Всё в системе связано по названию подразделения, поэтому две строки
  // с одним названием — это одно и то же подразделение. Показывать его дважды
  // нельзя: человек видит две одинаковых карточки с одинаковыми цифрами.
  const seenUnit = {};
  for (let i = 1; i < divs.length; i++) {
    const unit = _cell_(divs[i], dm, 'unit');
    if (!unit) continue;
    const key = _normName_(unit);
    if (seenUnit[key]) continue;
    seenUnit[key] = true;

    const info = {
      unit: unit,
      dir: _cell_(divs[i], dm, 'dir'),
      head: _cell_(divs[i], dm, 'head'),
      resp: _cell_(divs[i], dm, 'resp'),
      hrbp: _cell_(divs[i], dm, 'hrbp')
    };
    allUnits.push(info);
    if (myUnits[unit]) {
      units.push({
        unit: info.unit, dir: info.dir, head: info.head,
        resp: info.resp, hrbp: info.hrbp, total: 0, done: 0, ask: 0
      });
    }
  }

  // Строки конкурентов только по своим подразделениям
  const rows = [];
  const byUnit = {};
  for (let i = 1; i < comp.length; i++) {
    const unit = _cell_(comp[i], cm, 'unit');
    if (!myUnits[unit]) continue;
    const actual = _cell_(comp[i], cm, 'actual') || 'не проверено';
    const r = {
      id: _cell_(comp[i], cm, 'id'),
      unit: unit,
      company: _cell_(comp[i], cm, 'company'),
      type: _cell_(comp[i], cm, 'type'),
      seg: _cell_(comp[i], cm, 'seg'),
      region: _cell_(comp[i], cm, 'region'),
      prio: _cell_(comp[i], cm, 'prio'),
      status: _cell_(comp[i], cm, 'status'),
      src: _cell_(comp[i], cm, 'src'),
      note: _cell_(comp[i], cm, 'note'),
      actual: actual
    };
    rows.push(r);
    if (!byUnit[unit]) byUnit[unit] = { total: 0, done: 0, ask: 0 };
    byUnit[unit].total++;
    const k = _класс_(actual);
    if (k === 'done') byUnit[unit].done++;
    else if (k === 'ask') byUnit[unit].ask++;
  }
  units.forEach(function (x) {
    if (byUnit[x.unit]) {
      x.total = byUnit[x.unit].total;
      x.done = byUnit[x.unit].done;
      x.ask = byUnit[x.unit].ask;
    }
  });

  // Справочник компаний: сначала лист «Справочник» (единый источник),
  // сегмент и регион добираем из «Справочника компаний», если он заполнен
  const extra = {};
  for (let i = 1; i < dict.length; i++) {
    const name = _str_(dict[i][1]);
    if (!name) continue;
    extra[_normName_(name)] = { seg: _str_(dict[i][2]), region: _str_(dict[i][3]), type: _str_(dict[i][4]) };
  }
  const companies = ref.companies
    .filter(function (c) { return c.name && c.name.indexOf('→ объединено') < 0; })
    .map(function (c) {
      const e = extra[_normName_(c.name)] || {};
      return { id: c.id, name: c.name, seg: e.seg || '', region: e.region || '', type: e.type || '' };
    });
  Object.keys(extra).forEach(function (k) {
    if (!companies.some(function (c) { return _normName_(c.name) === k; })) {
      for (let i = 1; i < dict.length; i++) {
        if (_normName_(dict[i][1]) === k) {
          companies.push({ id: '', name: _str_(dict[i][1]), seg: _str_(dict[i][2]),
                           region: _str_(dict[i][3]), type: _str_(dict[i][4]) });
          break;
        }
      }
    }
  });

  const banned = [];
  for (let i = 0; i < ban.length; i++) {
    const name = _str_(ban[i][1]);
    if (name && name !== 'Компания') banned.push({ name: name, reason: _str_(ban[i][2]) });
  }

  // Записи обзора рынка по своим подразделениям (кроме удалённых)
  const surveys = [];
  for (let i = 1; i < surv.length; i++) {
    const unit = _str_(surv[i][V.UNIT]);
    if (!myUnits[unit]) continue;
    if (_str_(surv[i][V.STATE]) === 'удалена') continue;
    surveys.push({
      id: _str_(surv[i][V.ID]),
      unit: unit,
      company: _str_(surv[i][V.COMPANY]),
      posOur: _str_(surv[i][V.POS_OUR]),
      posTheir: _str_(surv[i][V.POS_THEIR]),
      grade: _str_(surv[i][V.GRADE]),
      payFrom: _str_(surv[i][V.PAY_FROM]),
      payTo: _str_(surv[i][V.PAY_TO]),
      cur: _str_(surv[i][V.CUR]),
      payPer: _str_(surv[i][V.PAY_PER]),
      bonHas: _str_(surv[i][V.BON_HAS]),
      bonSize: _str_(surv[i][V.BON_SIZE]),
      bonType: _str_(surv[i][V.BON_TYPE]),
      bonPer: _str_(surv[i][V.BON_PER]),
      benefits: _str_(surv[i][V.BENEFITS]) ? _str_(surv[i][V.BENEFITS]).split(';').map(function (x) { return x.trim(); }).filter(String) : [],
      extra: _str_(surv[i][V.EXTRA]),
      source: _str_(surv[i][V.SOURCE]),
      trust: _str_(surv[i][V.TRUST]),
      note: _str_(surv[i][V.NOTE]),
      by: _str_(surv[i][V.BY]),
      at: _дата_(surv[i][V.AT], true)
    });
  }
  units.forEach(function (x) {
    x.surveys = surveys.filter(function (s) { return s.unit === x.unit; }).length;
  });

  return {
    user: { fio: u.fio, login: u.login, role: u.role },
    units: units,
    rows: rows,
    surveys: surveys,
    // Должности: сначала штатка своих подразделений, отдельно — весь холдинг.
    // «Должность у нас» выбирается из своих; для конкурента и для редких
    // случаев есть переключатель на полный список.
    positions: _должностиПодразделений_(u.units),
    positionsByUnit: _штаткаПоПодразделениям_(u.units),
    positionsAll: _должности_().all,
    segments: _именаБлока_('segments'),
    regions: _именаБлока_('regions'),
    benefits: benef,
    companies: companies,
    banned: banned,
    ref: SPRAVOCHNIK,
    period: _период_(),
    allUnits: allUnits,
    needsUnitPick: u.units.length === 0
  };
}

/** Участник без подразделения выбирает его при первом входе. */
function apiSetUnits(token, unitNames) {
  try {
    const u = _auth_(token);
    const clean = (unitNames || []).map(_str_).filter(String);
    if (!clean.length) return { ok: false, error: 'Выберите хотя бы одно подразделение' };
    _sheet_(SH.USERS).getRange(u.row, U.UNITS + 1).setValue(clean.join('; '));
    _log_(u.login, 'выбор подразделений', clean.join('; '));
    const fresh = _findUser_(u.login);
    return { ok: true, data: _bootstrap_(fresh) };
  } catch (e) {
    return { ok: false, error: e.message === 'AUTH' ? 'Сессия истекла' : e.message };
  }
}

/**
 * Добавляет значение в справочник прямо из формы: должность, сегмент или регион.
 * Нужна кнопке «Другое» — выбор строгий, но если нужного значения нет,
 * человек вписывает своё, и оно сразу становится доступно всем остальным.
 */
function apiAddRefValue(token, block, name) {
  try {
    const u = _auth_(token);
    const key = _str_(block);
    if (REF_ADDABLE.indexOf(key) === -1) return { ok: false, error: 'Сюда добавлять нельзя' };
    const clean = _str_(name);
    if (clean.length < 2) return { ok: false, error: 'Слишком короткое название' };
    if (clean.length > 120) return { ok: false, error: 'Слишком длинное название' };
    const id = _добавитьВСправочник_(key, clean);
    _log_(u.login, 'справочник', REF_BLOCKS[key].title + ': + «' + clean + '» (' + id + ')');
    return { ok: true, id: id, name: clean, list: _именаБлока_(key) };
  } catch (e) {
    return { ok: false, error: e.message === 'AUTH' ? 'Сессия истекла' : e.message };
  }
}

/**
 * Добавляет должность в штатку своего подразделения прямо из формы.
 * Нужна кнопке «Другое»: выбор строгий, но если должности в списке нет,
 * руководитель вписывает её, и она сразу доступна всему подразделению.
 */
function apiAddPosition(token, unit, name) {
  try {
    const u = _auth_(token);
    const un = _str_(unit);
    if (u.units.indexOf(un) === -1) return { ok: false, error: 'Нет доступа к этому подразделению' };
    const clean = _str_(name);
    if (clean.length < 2) return { ok: false, error: 'Слишком короткое название' };
    if (clean.length > 120) return { ok: false, error: 'Слишком длинное название' };

    const id = _добавитьДолжность_(un, clean);
    _log_(u.login, 'справочник должностей', un + ': + «' + clean + '» (' + id + ')');
    return {
      ok: true, id: id, name: clean,
      list: _должностиПодразделений_(u.units),
      all: _должности_().all
    };
  } catch (e) {
    return { ok: false, error: e.message === 'AUTH' ? 'Сессия истекла' : e.message };
  }
}

/** Автоматическая бесшовная авторизация для Telegram Mini App */
function apiTelegramAuth(initData) {
  try {
    if (!initData) return { ok: false, error: 'NO_INIT_DATA' };
    const params = {};
    const parts = String(initData).split('&');
    for (let i = 0; i < parts.length; i++) {
      const kv = parts[i].split('=');
      if (kv.length === 2) params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
    }
    
    let tgUser = null;
    if (params.user) {
      try { tgUser = JSON.parse(params.user); } catch (e) {}
    }
    if (!tgUser) return { ok: false, error: 'USER_NOT_FOUND' };

    const tgId = String(tgUser.id || '');
    const tgPhone = String(tgUser.phone_number || '').replace(/\D/g, '');

    const psh = _подготовитьЛистПаролей_();
    const lr = psh.getLastRow();
    let foundLogin = '';
    if (lr > 1) {
      const vals = psh.getRange(2, 1, lr - 1, PWD_COLS).getValues();
      for (let i = 0; i < vals.length; i++) {
        const ph = _телефон_(vals[i][PW.PHONE]);
        if (tgPhone && ph && ph === _телефон_(tgPhone)) {
          foundLogin = _str_(vals[i][PW.LOGIN]);
          break;
        }
      }
    }

    if (!foundLogin) foundLogin = _tgЛогинЧата_(tgId);
    if (!foundLogin) return { ok: false, error: 'NOT_LINKED', tgUser: tgUser };

    const u = _findUser_(foundLogin);
    if (!u || !u.active) return { ok: false, error: 'Пользователь заблокирован или не найден' };

    return { ok: true, token: _makeToken_(u.login), data: _bootstrap_(u) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Делегирование / назначение ответственного за подразделение (для руководителя департамента и C&B) */
function apiDelegate(token, unit, respFio) {
  const lock = LockService.getScriptLock();
  try {
    const u = _auth_(token);
    if (u.role !== 'dir_head' && u.role !== 'cb' && u.role !== 'admin' && u.role !== 'head') {
      return { ok: false, error: 'Назначать ответственного может только Руководитель департамента' };
    }
    if (!lock.tryLock(15000)) return { ok: false, error: 'Таблица занята, повторите попытку' };

    const un = _str_(unit);
    const rf = _str_(respFio);
    if (!un || !rf) return { ok: false, error: 'Укажите подразделение и ответственного' };

    const divSh = _sheet_(SH.DIV);
    const divLr = divSh.getLastRow();
    if (divLr > 1) {
      const divData = divSh.getRange(1, 1, divLr, Math.max(divSh.getLastColumn(), 8)).getValues();
      const dm = _divMap_(divData);
      for (let r = 2; r <= divLr; r++) {
        if (_cell_(divData[r - 1], dm, 'unit') === un) {
          if (dm.resp >= 0) divSh.getRange(r, dm.resp + 1).setValue(rf);
          break;
        }
      }
    }

    const compSh = _sheet_(SH.COMP);
    const compLr = compSh.getLastRow();
    if (compLr > 1) {
      const compData = compSh.getRange(1, 1, compLr, Math.max(compSh.getLastColumn(), 10)).getValues();
      const cm = _compMap_(compData);
      if (cm.resp >= 0) {
        for (let r = 2; r <= compLr; r++) {
          if (_cell_(compData[r - 1], cm, 'unit') === un) {
            compSh.getRange(r, cm.resp + 1).setValue(rf);
          }
        }
      }
    }

    const ush = _sheet_(SH.USERS);
    const uLr = ush.getLastRow();
    if (uLr > 1) {
      const uData = ush.getRange(2, 1, uLr - 1, 7).getValues();
      for (let i = 0; i < uData.length; i++) {
        if (_normName_(uData[i][U.FIO]) === _normName_(rf)) {
          const curUnits = _str_(uData[i][U.UNITS]).split(';').map(function(s){ return s.trim(); }).filter(String);
          if (curUnits.indexOf(un) === -1) {
            curUnits.push(un);
            ush.getRange(i + 2, U.UNITS + 1).setValue(curUnits.join('; '));
          }
          break;
        }
      }
    }

    _log_(u.login, 'делегирование', un + ' ➔ ' + rf);
    SpreadsheetApp.flush();
    const freshUser = _findUser_(u.login);
    return { ok: true, data: _bootstrap_(freshUser), message: 'Ответственный назначен: ' + rf };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Отправка точечного напоминания в Telegram (от HR BP) */
function apiSendReminder(token, unit, type) {
  try {
    const u = _auth_(token);
    if (u.role !== 'hrbp' && u.role !== 'cb') return { ok: false, error: 'Доступно только HR BP' };

    const un = _str_(unit);
    const meta = _unitMeta_(un);
    const targetFio = (type === 'assign') ? meta.head : meta.resp;

    if (!targetFio || targetFio === '—') {
      return { ok: false, error: 'Не указан получатель напоминания' };
    }

    const psh = _подготовитьЛистПаролей_();
    const lr = psh.getLastRow();
    let recipientLogin = '';
    if (lr > 1) {
      const vals = psh.getRange(2, 1, lr - 1, PWD_COLS).getValues();
      for (let i = 0; i < vals.length; i++) {
        if (_normName_(vals[i][PW.FIO]) === _normName_(targetFio)) {
          recipientLogin = _str_(vals[i][PW.LOGIN]);
          break;
        }
      }
    }

    let targetChatId = '';
    const props = PropertiesService.getScriptProperties().getProperties();
    Object.keys(props).forEach(function(k) {
      if (k.indexOf('tgchat_') === 0 && _normName_(props[k]) === _normName_(recipientLogin)) {
        targetChatId = k.replace('tgchat_', '');
      }
    });

    const url = _appUrl_();
    const msgText = (type === 'assign')
      ? '🔔 <b>Напоминание по обзору рынка</b>\n\nУважаемый(ая) <b>' + _tgEsc_(targetFio) + '</b>!\nПожалуйста, назначьте ответственного за заполнение данных по подразделению: <b>«' + _tgEsc_(un) + '»</b>.\n\n🔗 <a href="' + _tgEsc_(url) + '">Перейти в форму</a>'
      : '🔔 <b>Напоминание по заполнению данных</b>\n\nУважаемый(ая) <b>' + _tgEsc_(targetFio) + '</b>!\nПожалуйста, завершите заполнение данных обзора рынка по подразделению: <b>«' + _tgEsc_(un) + '»</b>.\n\n🔗 <a href="' + _tgEsc_(url) + '">Перейти в форму</a>';

    let sent = false;
    if (targetChatId) {
      try {
        _tgSend_(targetChatId, msgText);
        sent = true;
      } catch (err) {}
    }

    _log_(u.login, 'напоминание ' + type, un + ' ➔ ' + targetFio + (sent ? ' (отправлено в TG)' : ' (нет активного чата TG)'));
    return {
      ok: true,
      sent: sent,
      recipient: targetFio,
      message: sent ? ('Уведомление отправлено в Telegram (' + targetFio + ')') : ('Напоминание зафиксировано в журнале (' + targetFio + ' ещё не запустил бота)')
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Массовая рассылка напоминаний всем должникам (от HR BP) */
function apiSendMassReminder(token) {
  try {
    const u = _auth_(token);
    if (u.role !== 'hrbp' && u.role !== 'cb') return { ok: false, error: 'Доступно только HR BP' };

    const dash = apiDashboard(token);
    if (!dash || !dash.ok) return { ok: false, error: 'Не удалось сформировать список' };

    let count = 0, sentCount = 0;
    (dash.rows || []).forEach(function(row) {
      if (row.state !== 'заполнено' && row.resp) {
        count++;
        const res = apiSendReminder(token, row.unit, 'fill');
        if (res && res.sent) sentCount++;
      }
    });

    return {
      ok: true,
      totalUnfinished: count,
      sentInTg: sentCount,
      message: 'Обработано подразделений: ' + count + ', доставлено в Telegram: ' + sentCount
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Сводная аналитика C&B специалиста */
function apiCBDashboard(token) {
  try {
    const u = _auth_(token);
    const surv = _valuesOpt_(SH.SURVEY);
    const comp = _valuesOpt_(SH.COMP);
    const divs = _valuesOpt_(SH.DIV);

    let totalPositions = 0, withSalaries = 0;
    const posStats = {};
    const benefitStats = {};
    const currencyBreakdown = {};

    for (let i = 1; i < surv.length; i++) {
      if (_str_(surv[i][V.STATE]) === 'удалена') continue;
      totalPositions++;
      const pos = _str_(surv[i][V.POS_OUR]);
      const pFrom = Number(surv[i][V.PAY_FROM]) || 0;
      const pTo = Number(surv[i][V.PAY_TO]) || 0;
      const cur = _str_(surv[i][V.CUR]) || 'сомони';
      const bens = _str_(surv[i][V.BENEFITS]).split(';').map(function(s){ return s.trim(); }).filter(String);

      currencyBreakdown[cur] = (currencyBreakdown[cur] || 0) + 1;
      bens.forEach(function(b){ benefitStats[b] = (benefitStats[b] || 0) + 1; });

      if (pos && (pFrom > 0 || pTo > 0)) {
        withSalaries++;
        if (!posStats[pos]) posStats[pos] = { pos: pos, min: pFrom, max: pTo, samples: [] };
        const med = (pFrom && pTo) ? ((pFrom + pTo) / 2) : (pFrom || pTo);
        posStats[pos].samples.push(med);
        if (pFrom && (!posStats[pos].min || pFrom < posStats[pos].min)) posStats[pos].min = pFrom;
        if (pTo && pTo > posStats[pos].max) posStats[pos].max = pTo;
      }
    }

    const positionsList = Object.keys(posStats).map(function(k) {
      const s = posStats[k].samples.sort(function(a,b){ return a-b; });
      const mid = Math.floor(s.length / 2);
      const median = s.length % 2 !== 0 ? s[mid] : ((s[mid - 1] + s[mid]) / 2);
      return {
        pos: k,
        count: s.length,
        min: posStats[k].min,
        median: Math.round(median),
        max: posStats[k].max
      };
    }).sort(function(a,b){ return b.count - a.count; });

    return {
      ok: true,
      summary: {
        totalDivisions: Math.max(divs.length - 1, 0),
        totalCompetitors: Math.max(comp.length - 1, 0),
        totalSurveyRecords: totalPositions,
        recordsWithSalary: withSalaries,
        positionsSurveyedCount: positionsList.length
      },
      topPositions: positionsList.slice(0, 50),
      topBenefits: Object.keys(benefitStats).map(function(k){ return { name: k, count: benefitStats[k] }; }).sort(function(a,b){ return b.count - a.count; }),
      currencies: currencyBreakdown
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * payload = { unit, rows: [...], added: [...], note, submit }
 *
 * Пишем по колонкам, а не блоком: в «Конкурентах» текстовые поля —
 * формулы VLOOKUP к «Справочнику», и запись всего диапазона их уничтожала.
 */
function apiSave(token, payload) {
  const lock = LockService.getScriptLock();
  try {
    const u = _auth_(token);
    const gate = _можноПисать_(u);
    if (!gate.ok) return gate;
    if (!lock.tryLock(30000)) return { ok: false, error: 'Таблица занята, попробуйте ещё раз через пару секунд' };

    const unit = _str_(payload.unit);
    if (u.units.indexOf(unit) === -1) return { ok: false, error: 'Нет доступа к этому подразделению' };

    const sh = _sheet_(SH.COMP);
    const lr = sh.getLastRow();
    const width = Math.max(sh.getLastColumn(), 1);
    const cm = _compMap_([sh.getRange(1, 1, 1, width).getValues()[0]]);
    const n = Math.max(lr - 1, 0);
    const vals = n ? sh.getRange(2, 1, n, width).getValues() : [];

    // Строка листа → присланная форма. Чужие подразделения не трогаем.
    const patch = {};
    const idx = {};
    for (let i = 0; i < vals.length; i++) {
      const id = _cell_(vals[i], cm, 'id');
      if (id) idx[id] = i;
    }
    (payload.rows || []).forEach(function (r) {
      const i = idx[r.id];
      if (i === undefined) return;
      if (_cell_(vals[i], cm, 'unit') !== unit) return;   // защита от подмены
      patch[i] = r;
    });

    const now = new Date();
    const changed = Object.keys(patch).length;

    if (n && changed) {
      const val = function (key, get) {
        _writeCol_(sh, cm[key], 2, n, function (i) {
          return patch[i] ? get(patch[i]) : undefined;
        });
      };
      val('company', function (r) { return _str_(r.company); });
      val('type',    function (r) { return _str_(r.type); });
      val('seg',     function (r) { return _str_(r.seg); });
      val('region',  function (r) { return _str_(r.region); });
      val('prio',    function (r) { return _str_(r.prio); });
      val('note',    function (r) { return _str_(r.note); });
      val('actual',  function (r) { return _str_(r.actual) || 'не проверено'; });
      val('by',      function ()  { return u.fio; });
      val('at',      function ()  { return now; });
      if (cm.at >= 0) sh.getRange(2, cm.at + 1, n, 1).setNumberFormat(FMT_DT);
    }

    // Новые компании — в конец листа, с ключами к «Справочнику»
    const meta = _unitMeta_(unit);
    const addRows = [];
    const newIds = [];          // возвращаем форме, чтобы она знала ID добавленных строк
    let nextNum = n + 1;
    const put = function (row, key, value) {
      const i = cm[key];
      if (i !== undefined && i >= 0 && i < row.length) row[i] = value;
    };
    (payload.added || []).forEach(function (r) {
      if (!_str_(r.company)) { newIds.push(''); return; }
      const row = new Array(width).fill('');
      const id = 'R' + Utilities.getUuid().slice(0, 8).toUpperCase();
      // Компания обязана быть в справочнике — иначе формулы VLOOKUP не найдут название
      const compId = _добавитьВСправочник_('companies', _str_(r.company));
      if (_str_(r.seg)) _добавитьВСправочник_('segments', _str_(r.seg));
      if (_str_(r.region)) _добавитьВСправочник_('regions', _str_(r.region));

      put(row, 'num',     nextNum++);
      put(row, 'idDir',   meta.idDir);
      put(row, 'dir',     meta.dir);
      put(row, 'idUnit',  meta.idUnit);
      put(row, 'unit',    unit);
      put(row, 'idResp',  meta.idResp);
      put(row, 'resp',    meta.resp);
      put(row, 'idHrbp',  meta.idHrbp);
      put(row, 'hrbp',    meta.hrbp);
      put(row, 'idComp',  compId);
      put(row, 'company', _str_(r.company));
      put(row, 'type',    _str_(r.type));
      put(row, 'seg',     _str_(r.seg));
      put(row, 'region',  _str_(r.region));
      put(row, 'prio',    _str_(r.prio));
      put(row, 'status',  'добавлено руководителем');
      put(row, 'src',     'форма: ' + u.fio);
      put(row, 'note',    _str_(r.note));
      put(row, 'actual',  'актуально');
      put(row, 'by',      u.fio);
      put(row, 'at',      now);
      put(row, 'id',      id);
      addRows.push(row);
      newIds.push(id);
    });
    if (addRows.length) {
      const first = sh.getLastRow() + 1;
      sh.getRange(first, 1, addRows.length, width).setValues(addRows);
      if (cm.at >= 0) sh.getRange(first, cm.at + 1, addRows.length, 1).setNumberFormat(FMT_DT);
    }

    _обновитьСтатус_(unit, u.fio, _str_(payload.note), payload.submit ? 'отправлено' : 'черновик');
    _log_(u.login, payload.submit ? 'отправка' : 'черновик',
          unit + ' | изменено: ' + changed + ', добавлено: ' + addRows.length);

    return {
      ok: true, changed: changed, added: addRows.length, newIds: newIds,
      at: _дата_(now, true)
    };
  } catch (e) {
    return { ok: false, error: e.message === 'AUTH' ? 'Сессия истекла, войдите заново' : ('Ошибка: ' + e.message) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * Обзор рынка: добавление, изменение и удаление записей по должностям.
 * payload = { unit, upsert: [запись, …], remove: [id, …] }
 * Удаление мягкое — строка остаётся в таблице со состоянием «удалена»,
 * физически убирается пунктом меню «Очистить удалённые записи обзора».
 */
function apiSaveSurvey(token, payload) {
  const lock = LockService.getScriptLock();
  try {
    const u = _auth_(token);
    const gate = _можноПисать_(u);
    if (!gate.ok) return gate;
    if (!lock.tryLock(30000)) return { ok: false, error: 'Таблица занята, попробуйте ещё раз через пару секунд' };

    const unit = _str_(payload.unit);
    if (u.units.indexOf(unit) === -1) return { ok: false, error: 'Нет доступа к этому подразделению' };

    const sh = _sheet_(SH.SURVEY);
    const lr = sh.getLastRow();
    const rng = lr > 1 ? sh.getRange(2, 1, lr - 1, SURVEY_COLS) : null;
    const vals = rng ? rng.getValues() : [];

    const idx = {};
    for (let i = 0; i < vals.length; i++) {
      const id = _str_(vals[i][V.ID]);
      if (id) idx[id] = i;
    }

    const now = new Date();
    const periodName = gate.period.name;
    let updated = 0, removed = 0;
    const addRows = [], newIds = [];

    function fill(row, r) {
      row[V.UNIT]      = unit;
      row[V.COMPANY]   = _str_(r.company);
      row[V.POS_OUR]   = _str_(r.posOur);
      row[V.POS_THEIR] = _str_(r.posTheir);
      row[V.GRADE]     = _str_(r.grade);
      row[V.PAY_FROM]  = _num_(r.payFrom);
      row[V.PAY_TO]    = _num_(r.payTo);
      row[V.CUR]       = _str_(r.cur);
      row[V.PAY_PER]   = _str_(r.payPer);
      row[V.BON_HAS]   = _str_(r.bonHas);
      row[V.BON_SIZE]  = _str_(r.bonSize);
      row[V.BON_TYPE]  = _str_(r.bonType);
      row[V.BON_PER]   = _str_(r.bonPer);
      row[V.BENEFITS]  = (r.benefits || []).join('; ');
      row[V.EXTRA]     = _str_(r.extra);
      row[V.SOURCE]    = _str_(r.source);
      row[V.TRUST]     = _str_(r.trust);
      row[V.NOTE]      = _str_(r.note);
      row[V.BY]        = u.fio;
      row[V.AT]        = now;
      row[V.STATE]     = 'активна';
      row[V.PERIOD]    = periodName;
    }

    // Удаление — помечаем состоянием
    (payload.remove || []).forEach(function (id) {
      const i = idx[_str_(id)];
      if (i === undefined) return;
      if (_str_(vals[i][V.UNIT]) !== unit) return;
      vals[i][V.STATE] = 'удалена';
      vals[i][V.BY] = u.fio;
      vals[i][V.AT] = now;
      removed++;
    });

    // Добавление и правка.
    // newIds строго повторяет порядок upsert: пустая строка там, где ID не менялся,
    // иначе форма не сможет сопоставить ответ со своими записями.
    (payload.upsert || []).forEach(function (r) {
      if (!_str_(r.posOur) && !_str_(r.company)) { newIds.push(''); return; }
      // Должность, которой ещё нет в штатке подразделения, попадает туда сразу:
      // следующий заполняющий увидит её в выпадающем списке.
      // Должность конкурента в нашу штатку не пишем — у них своя.
      if (_str_(r.posOur)) _добавитьДолжность_(unit, _str_(r.posOur));

      const id = _str_(r.id);
      if (id && idx[id] !== undefined) {
        if (_str_(vals[idx[id]][V.UNIT]) !== unit) { newIds.push(''); return; }
        fill(vals[idx[id]], r);
        updated++;
        newIds.push('');
      } else {
        const row = new Array(SURVEY_COLS).fill('');
        row[V.ID] = 'S' + Utilities.getUuid().slice(0, 8).toUpperCase();
        fill(row, r);
        addRows.push(row);
        newIds.push(row[V.ID]);
      }
    });

    if (rng && vals.length) rng.setValues(vals);
    if (addRows.length) {
      sh.getRange(sh.getLastRow() + 1, 1, addRows.length, SURVEY_COLS).setValues(addRows);
    }
    if (sh.getLastRow() > 1) {
      sh.getRange(2, V.AT + 1, sh.getLastRow() - 1, 1).setNumberFormat(FMT_DT);
    }

    _log_(u.login, 'обзор рынка',
      unit + ' | добавлено: ' + addRows.length + ', изменено: ' + updated + ', удалено: ' + removed);

    return {
      ok: true, added: addRows.length, updated: updated, removed: removed, newIds: newIds,
      at: _дата_(now, true)
    };
  } catch (e) {
    return { ok: false, error: e.message === 'AUTH' ? 'Сессия истекла, войдите заново' : ('Ошибка: ' + e.message) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Число из строки: «12 500», «12500,50» → 12500 / 12500.5. Пусто — пустая ячейка. */
function _num_(v) {
  const s = _str_(v).replace(/\s| /g, '').replace(',', '.');
  if (!s) return '';
  const n = Number(s);
  return isNaN(n) ? _str_(v) : n;
}

/** Открыть или закрыть период из формы. Доступно HR BP, C&B и Администраторам. */
function apiSetPeriod(token, patch) {
  try {
    const u = _auth_(token);
    if (u.role !== 'hrbp' && u.role !== 'admin' && u.role !== 'cb') {
      return { ok: false, error: 'Управлять периодом может только HR BP, C&B или Администратор' };
    }
    const state = _str_(patch.state).toLowerCase();
    if (state !== 'открыт' && state !== 'закрыт') return { ok: false, error: 'Неверное состояние периода' };
    const p = { state: state };
    if (_str_(patch.name)) p.name = _str_(patch.name);
    if (state === 'открыт') { p.from = new Date(); p.to = ''; }
    else { p.to = new Date(); }
    _записатьПериод_(p, u.fio);
    _log_(u.login, 'период ' + state, _str_(patch.name));
    return { ok: true, period: _период_() };
  } catch (e) {
    return { ok: false, error: e.message === 'AUTH' ? 'Сессия истекла' : e.message };
  }
}

/** Пользователь меняет себе пароль сам. Нужен текущий пароль — иначе смена запрещена. */
function apiChangePassword(token, oldPwd, newPwd) {
  try {
    const u = _auth_(token);
    if (u.hash !== _hash_(String(oldPwd || ''))) {
      return { ok: false, error: 'Текущий пароль введён неверно' };
    }
    const p = String(newPwd || '');
    if (p.length < 6) return { ok: false, error: 'Новый пароль — минимум 6 символов' };
    if (p === String(oldPwd)) return { ok: false, error: 'Новый пароль совпадает со старым' };

    _sheet_(SH.USERS).getRange(u.row, U.HASH + 1).setValue(_hash_(p));

    // На листе выдачи пароль больше не актуален — помечаем, чтобы не путал
    try {
      const psh = _findSheet_(SH.PWD);
      if (psh && psh.getLastRow() > 1) {
        const vals = psh.getRange(2, 1, psh.getLastRow() - 1, PWD_COLS).getValues();
        for (let i = 0; i < vals.length; i++) {
          if (_normName_(vals[i][PW.LOGIN]) === _normName_(u.login)) {
            psh.getRange(i + 2, PW.PWD + 1)
               .setValue(PWD_CHANGED + ' ' + _дата_(new Date(), true));
            break;
          }
        }
      }
    } catch (e) { /* не критично */ }

    _log_(u.login, 'смена пароля', 'самостоятельно');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message === 'AUTH' ? 'Сессия истекла' : e.message };
  }
}

/** Перечитать данные с сервера — если таблицу правили параллельно. */
function apiRefresh(token) {
  try {
    const u = _auth_(token);
    return { ok: true, data: _bootstrap_(u) };
  } catch (e) {
    return { ok: false, error: e.message === 'AUTH' ? 'Сессия истекла' : e.message };
  }
}

function _unitMeta_(unit) {
  const divs = _values_(SH.DIV);
  const dm = _divMap_(divs);
  for (let i = 1; i < divs.length; i++) {
    if (_cell_(divs[i], dm, 'unit') !== unit) continue;
    const dir = _cell_(divs[i], dm, 'dir');
    const resp = _cell_(divs[i], dm, 'resp') || _cell_(divs[i], dm, 'head');
    const hrbp = _cell_(divs[i], dm, 'hrbp');
    return {
      dir: dir, resp: resp, hrbp: hrbp,
      idDir: _idПо_('dirs', dir),
      idUnit: _idПо_('units', unit),
      idResp: _idПо_('people', resp),
      idHrbp: _idПо_('people', hrbp)
    };
  }
  return { dir: '', resp: '', hrbp: '', idDir: '', idUnit: '', idResp: '', idHrbp: '' };
}

function _обновитьСтатус_(unit, fio, note, state) {
  const sh = _sheet_(SH.STATUS, true);
  const head = sh.getLastRow() ? sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0] : [];
  if (!sh.getLastRow() || _normName_(head[ST.ASK] || '') !== _normName_(STATUS_HEADERS[ST.ASK])) {
    пересчитатьСтатусы_(true);   // шапка устарела — пересобираем лист целиком
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, STATUS_COLS).setValues([STATUS_HEADERS])
      .setFontWeight('bold').setBackground('#d9ead3');
    sh.setFrozenRows(1);
  }
  const comp = _values_(SH.COMP);
  const cm = _compMap_(comp);
  const c = _счёт_(comp, cm, unit);
  const meta = _unitMeta_(unit);
  const rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, STATUS_COLS).getValues() : [];
  let target = -1;
  for (let i = 0; i < rows.length; i++) if (_str_(rows[i][ST.UNIT]) === unit) { target = i + 2; break; }
  const line = [unit, meta.resp, meta.hrbp, state, c.total, c.done, c.ask, note, new Date()];
  if (target > 0) sh.getRange(target, 1, 1, STATUS_COLS).setValues([line]);
  else sh.getRange(sh.getLastRow() + 1, 1, 1, STATUS_COLS).setValues([line]);
  const row = target > 0 ? target : sh.getLastRow();
  sh.getRange(row, ST.AT + 1).setNumberFormat(FMT_DT);
}

/** Сводка для HR BP, C&B и Администратора: кто заполнил, кто нет. */
function apiDashboard(token) {
  try {
    const u = _auth_(token);
    if (u.role !== 'hrbp' && u.role !== 'admin' && u.role !== 'cb' && u.role !== 'dir_head') {
      return { ok: false, error: 'Доступно только HR BP, C&B и Руководству' };
    }

    const divs = _values_(SH.DIV);
    const comp = _values_(SH.COMP);
    const st = _valuesOpt_(SH.STATUS);
    const surv = _valuesOpt_(SH.SURVEY);

    const survCount = {};
    for (let i = 1; i < surv.length; i++) {
      if (_str_(surv[i][V.STATE]) === 'удалена') continue;
      const un = _str_(surv[i][V.UNIT]);
      if (un) survCount[un] = (survCount[un] || 0) + 1;
    }

    const stMap = {};
    for (let i = 1; i < st.length; i++) {
      stMap[_str_(st[i][ST.UNIT])] = { state: _str_(st[i][ST.STATE]), at: st[i][ST.AT] };
    }

    const dm = _divMap_(divs);
    const cm = _compMap_(comp);
    const counts = {};
    for (let i = 1; i < comp.length; i++) {
      const unit = _cell_(comp[i], cm, 'unit');
      if (!unit) continue;
      if (!counts[unit]) counts[unit] = { total: 0, done: 0, ask: 0 };
      counts[unit].total++;
      const k = _класс_(_cell_(comp[i], cm, 'actual'));
      if (k === 'done') counts[unit].done++;
      else if (k === 'ask') counts[unit].ask++;
    }

    const isAllAccess = (u.role === 'admin' || u.role === 'cb');
    const out = [];
    for (let i = 1; i < divs.length; i++) {
      const unit = _cell_(divs[i], dm, 'unit');
      if (!unit) continue;

      const hrbp = _str_(_cell_(divs[i], dm, 'hrbp'));
      const dir = _str_(_cell_(divs[i], dm, 'dir'));

      // Фильтрация по правам: HR BP видит свои (или все, если не привязан), dir_head видит своё направление
      if (!isAllAccess) {
        if (u.role === 'hrbp' && hrbp && _normName_(hrbp) !== _normName_(u.fio)) continue;
        if (u.role === 'dir_head' && u.units.indexOf(unit) === -1 && dir && u.units.indexOf(dir) === -1) continue;
      }

      const c = counts[unit] || { total: 0, done: 0, ask: 0 };
      const s = stMap[unit] || {};
      out.push({
        unit: unit,
        dir: dir,
        hrbp: hrbp,
        resp: _cell_(divs[i], dm, 'resp') || _cell_(divs[i], dm, 'head'),
        total: c.total,
        done: c.done,
        ask: c.ask,
        surveys: survCount[unit] || 0,
        state: s.state || 'не начато',
        at: _дата_(s.at, true)
      });
    }
    out.sort(function (a, b) { return (a.done / (a.total || 1)) - (b.done / (b.total || 1)); });
    return { ok: true, rows: out, period: _период_() };
  } catch (e) {
    return { ok: false, error: e.message === 'AUTH' ? 'Сессия истекла' : e.message };
  }
}

// ─────────────────────────────────────────────────────────────
// ОТЧЁТЫ
// ─────────────────────────────────────────────────────────────

function пересчитатьСтатусы() { пересчитатьСтатусы_(false); }

function пересчитатьСтатусы_(silent) {
  const divs = _values_(SH.DIV);
  const comp = _values_(SH.COMP);
  const sh = _sheet_(SH.STATUS, true);

  const dm = _divMap_(divs);
  const cm = _compMap_(comp);
  const counts = {};
  const last = {};
  for (let i = 1; i < comp.length; i++) {
    const unit = _cell_(comp[i], cm, 'unit');
    if (!unit) continue;
    if (!counts[unit]) counts[unit] = { total: 0, done: 0, ask: 0 };
    counts[unit].total++;
    const k = _класс_(_cell_(comp[i], cm, 'actual'));
    if (k === 'done') counts[unit].done++;
    else if (k === 'ask') counts[unit].ask++;
    const at = cm.at >= 0 ? comp[i][cm.at] : '';
    if (at && (!last[unit] || at > last[unit])) last[unit] = at;
  }

  // Сохраняем ранее введённые комментарии по подразделению.
  // Колонку ищем по заголовку: в старой раскладке она стояла левее.
  const oldNotes = {};
  if (sh.getLastRow() > 1) {
    const head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
    let noteCol = -1;
    for (let c = 0; c < head.length; c++) {
      if (_normName_(head[c]).indexOf('комментарий') === 0) { noteCol = c; break; }
    }
    if (noteCol < 0) noteCol = 6;
    sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(sh.getLastColumn(), 1)).getValues()
      .forEach(function (r) { if (_str_(r[0])) oldNotes[_str_(r[0])] = r[noteCol]; });
  }

  const out = [];
  for (let i = 1; i < divs.length; i++) {
    const unit = _cell_(divs[i], dm, 'unit');
    if (!unit) continue;
    const c = counts[unit] || { total: 0, done: 0, ask: 0 };
    out.push([unit, _cell_(divs[i], dm, 'resp') || _cell_(divs[i], dm, 'head'),
              _cell_(divs[i], dm, 'hrbp'), _состояние_(c),
              c.total, c.done, c.ask, oldNotes[unit] || '', last[unit] || '']);
  }

  sh.clear();
  if (sh.getMaxColumns() < STATUS_COLS) {
    sh.insertColumnsAfter(sh.getMaxColumns(), STATUS_COLS - sh.getMaxColumns());
  }
  sh.getRange(1, 1, 1, STATUS_COLS).setValues([STATUS_HEADERS])
    .setFontWeight('bold').setBackground('#d9ead3');
  if (out.length) {
    sh.getRange(2, 1, out.length, STATUS_COLS).setValues(out);
    sh.getRange(2, ST.AT + 1, out.length, 1).setNumberFormat(FMT_DT);
    // «Требует уточнения» подсвечиваем — иначе колонку не замечают
    sh.getRange(2, ST.ASK + 1, out.length, 1).setBackground('#fdf3e0');
  }
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, STATUS_COLS);
  if (!silent) {
    SpreadsheetApp.getActive().toast('Статусы пересчитаны: ' + out.length + ' подразделений');
  }
}

/** Создаёт отдельную таблицу-отчёт для каждого HR BP из общей базы. */
function выгрузитьОтчётыПоHRBP() {
  const ui = SpreadsheetApp.getUi();
  const comp = _values_(SH.COMP);
  const surv = _valuesOpt_(SH.SURVEY);

  // Подразделение → HR BP, чтобы разложить записи обзора по тем же группам
  const divs = _values_(SH.DIV);
  const unitHrbp = {};
  const dm = _divMap_(divs);
  const cm = _compMap_(comp);
  for (let i = 1; i < divs.length; i++) unitHrbp[_cell_(divs[i], dm, 'unit')] = _cell_(divs[i], dm, 'hrbp');

  const groups = {}, survGroups = {};
  for (let i = 1; i < comp.length; i++) {
    const h = _cell_(comp[i], cm, 'hrbp') || unitHrbp[_cell_(comp[i], cm, 'unit')];
    if (!h || h === '—') continue;
    if (!groups[h]) groups[h] = [];
    groups[h].push(comp[i].slice());
  }
  for (let i = 1; i < surv.length; i++) {
    if (_str_(surv[i][V.STATE]) === 'удалена') continue;
    const h = unitHrbp[_str_(surv[i][V.UNIT])];
    if (!h || h === '—') continue;
    if (!survGroups[h]) survGroups[h] = [];
    survGroups[h].push(surv[i].slice(0, SURVEY_COLS));
  }

  const folder = DriveApp.getFileById(_ss_().getId()).getParents().hasNext()
    ? DriveApp.getFileById(_ss_().getId()).getParents().next() : DriveApp.getRootFolder();

  // Шапку берём из самой таблицы, а не из своих констант: раскладка может отличаться
  const compHeader = comp.length ? comp[0] : COMP_HEADERS;
  const compWidth = compHeader.length;
  Object.keys(groups).forEach(function (h) {
    groups[h] = groups[h].map(function (r) {
      const row = r.slice(0, compWidth);
      while (row.length < compWidth) row.push('');
      return row;
    });
  });

  const stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  let n = 0;
  Object.keys(groups).forEach(function (h) {
    const ss = SpreadsheetApp.create('Обзор рынка — ' + h + ' — ' + stamp);
    try { ss.setSpreadsheetTimeZone(TZ); } catch (e) {}

    const sh = ss.getSheets()[0].setName(SH.COMP);
    sh.getRange(1, 1, 1, compWidth).setValues([compHeader]).setFontWeight('bold');
    sh.getRange(2, 1, groups[h].length, compWidth).setValues(groups[h]);
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, compWidth);

    const sv = ss.insertSheet(SH.SURVEY);
    sv.getRange(1, 1, 1, SURVEY_COLS).setValues([SURVEY_HEADERS]).setFontWeight('bold');
    const list = survGroups[h] || [];
    if (list.length) {
      sv.getRange(2, 1, list.length, SURVEY_COLS).setValues(list);
      sv.getRange(2, V.AT + 1, list.length, 1).setNumberFormat(FMT_DT);
    }
    sv.setFrozenRows(1);
    sv.autoResizeColumns(1, SURVEY_COLS);

    DriveApp.getFileById(ss.getId()).moveTo(folder);
    n++;
  });
  ui.alert('Готово', 'Создано отчётов: ' + n + '. Они лежат рядом с этой таблицей на Google Диске.', ui.ButtonSet.OK);
}

// ─────────────────────────────────────────────────────────────
// ТЕЛЕГРАМ-БОТ ВЫДАЧИ ДОСТУПОВ
//
// Человек нажимает «Получить логин и пароль», Telegram просит подтвердить
// отправку номера, номер сверяется с колонкой «Телефон» листа «Пароли (выдать)».
// Совпало — бот присылает логин и пароль в формате «нажми и скопируй»
// плюс ссылку на форму.
//
// Токен НЕ хранится в коде: он лежит в свойствах скрипта и задаётся
// через меню. Файл с кодом попадает в копии таблицы и в переписку —
// вшитый токен означает потерю контроля над ботом.
// ─────────────────────────────────────────────────────────────

const TG_API = 'https://api.telegram.org/bot';

function _tgToken_() { return PropertiesService.getScriptProperties().getProperty('TG_TOKEN') || ''; }
function _tgSecret_() {
  const p = PropertiesService.getScriptProperties();
  let s = p.getProperty('TG_SECRET');
  if (!s) { s = Utilities.getUuid().replace(/-/g, ''); p.setProperty('TG_SECRET', s); }
  return s;
}

/** Адрес самого веб-приложения — уходит человеку ссылкой на вход. */
function _appUrl_() {
  const p = PropertiesService.getScriptProperties();
  const saved = p.getProperty('APP_URL');
  if (saved) return saved;
  try {
    const u = ScriptApp.getService().getUrl();
    if (u) { p.setProperty('APP_URL', u); return u; }
  } catch (e) {}
  return '';
}

function _tgCall_(method, payload) {
  const token = _tgToken_();
  if (!token) throw new Error('Токен бота не задан');
  const res = UrlFetchApp.fetch(TG_API + token + '/' + method, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const body = JSON.parse(res.getContentText() || '{}');
  if (!body.ok) throw new Error(method + ': ' + (body.description || res.getContentText()));
  return body.result;
}

function _tgSend_(chatId, text, extra) {
  const p = { chat_id: chatId, text: text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (extra) Object.keys(extra).forEach(function (k) { p[k] = extra[k]; });
  return _tgCall_('sendMessage', p);
}

/** Экранирование под parse_mode=HTML: иначе ФИО с «&» рвёт сообщение. */
function _tgEsc_(s) {
  return _str_(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Приводит номер к сравнимому виду: только цифры, последние 9 —
 * это и есть местный номер без кода страны и без ведущих нулей.
 */
function _телефон_(v) {
  const d = _str_(v).replace(/\D/g, '');
  if (d.length < 9) return '';
  return d.slice(-9);
}

/** Клавиатура запроса контакта. Telegram сам показывает подтверждение отправки. */
/** Текст кнопки повторной выдачи. Сравнивается с входящим сообщением. */
const TG_КНОПКА_ДОСТУП = '🔑 Мой логин и пароль';

/**
 * Клавиатура под полем ввода. Кнопка повторной выдачи остаётся всегда:
 * человек закрыл чат, потерял сообщение — нажал и получил снова,
 * не проходя заново через отправку номера.
 */
function _tgКлавиатура_(withContact) {
  const rows = [];
  if (withContact) rows.push([{ text: '📱 Отправить мой номер', request_contact: true }]);
  rows.push([{ text: TG_КНОПКА_ДОСТУП }]);
  return { keyboard: rows, resize_keyboard: true, is_persistent: true };
}

/** Оставлено для совместимости со старыми вызовами. */
function _tgКлавиатураКонтакт_() { return _tgКлавиатура_(true); }

/**
 * Регистрирует команды бота: Telegram показывает кнопку «Меню» рядом с полем ввода,
 * а в пустом чате — большую кнопку «Начать».
 */
function _tgКоманды_() {
  try {
    _tgCall_('setMyCommands', {
      commands: [
        { command: 'start', description: 'Начать · получить доступ' },
        { command: 'login', description: 'Показать мой логин и пароль' },
        { command: 'help',  description: 'Как это работает' }
      ]
    });
    _tgCall_('setChatMenuButton', { menu_button: { type: 'commands' } });
    return true;
  } catch (e) {
    _log_('телеграм', 'команды не заданы', String(e && e.message));
    return false;
  }
}

/** Запоминает, кому принадлежит чат: по этому бот узнаёт человека без номера. */
function _tgЗапомнитьЧат_(chat, login) {
  try { PropertiesService.getScriptProperties().setProperty('tgchat_' + chat, login); }
  catch (e) { /* свойств стало слишком много — не критично, спросим номер заново */ }
}

function _tgЛогинЧата_(chat) {
  try { return PropertiesService.getScriptProperties().getProperty('tgchat_' + chat) || ''; }
  catch (e) { return ''; }
}

const TG_ПРИВЕТ =
  '👋 Это бот доступа к форме <b>«Анализ рынка — Фаровон»</b>.\n\n' +
  'Нажмите кнопку ниже и подтвердите отправку номера телефона. ' +
  'Если номер найдётся в списке, пришлю ваш логин и пароль.\n\n' +
  'Номер нужен только для того, чтобы вас узнать. Больше ничего бот не собирает.';

/**
 * Обновление уже обрабатывалось?
 * Telegram повторяет доставку, пока не получит 200. Любая заминка со стороны
 * Apps Script — и то же самое сообщение приходит человеку по второму,
 * третьему разу. Помним номера обновлений и молча пропускаем повторы.
 */
function _tgНовое_(updateId) {
  if (updateId === undefined || updateId === null) return true;
  const cache = CacheService.getScriptCache();
  const key = 'tgu_' + updateId;
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    if (cache.get(key)) return false;
    cache.put(key, '1', 21600);      // 6 часов — предел CacheService
    return true;
  } catch (err) {
    return true;                     // не смогли проверить — лучше ответить, чем промолчать
  } finally {
    try { lock.releaseLock(); } catch (err2) {}
  }
}

/**
 * Пауза между выдачами на один чат — от частых нажатий кнопки.
 * Отметка ставится только после РЕАЛЬНОЙ отправки доступа: иначе неудачная
 * попытка (номера нет в таблице) блокировала бы следующую, уже правильную.
 */
function _tgБылоНедавно_(chatId) {
  return !!CacheService.getScriptCache().get('tgcd_' + chatId);
}
function _tgОтметитьВыдачу_(chatId) {
  CacheService.getScriptCache().put('tgcd_' + chatId, '1', 45);
}

/**
 * Точка входа вебхука. Секрет передаётся в адресе (?s=…), потому что
 * doPost не даёт доступа к заголовкам запроса и проверить
 * X-Telegram-Bot-Api-Secret-Token нечем.
 *
 * Всегда отвечаем 200, даже на мусор: любой другой ответ Telegram считает
 * сбоем и начинает повторять доставку по кругу.
 */
function doPost(e) {
  const ok = ContentService.createTextOutput('ok');
  try {
    if (!e || !e.postData || !e.postData.contents) return ok;
    const upd = JSON.parse(e.postData.contents);
    if (upd && (upd.update_id !== undefined || upd.message !== undefined)) {
      _tgОбработать_(upd);
    }
  } catch (err) {
    try { _log_('телеграм', 'ошибка вебхука', String(err && err.message)); } catch (e2) {}
  }
  return ok;
}

/** Разбор одного обновления. Общий код для вебхука и для опроса. */
function _tgОбработать_(upd) {
  if (!_tgНовое_(upd.update_id)) return;         // повтор доставки — молчим
  const msg = upd.message || upd.edited_message;
  if (!msg || !msg.chat) return;

  // Отметка о каждом входящем: по журналу сразу видно, дошло ли сообщение
  // до скрипта. Пусто — виновата доставка, есть записи — виновата логика.
  _log_('телеграм', 'входящее',
    'upd ' + upd.update_id + ' | chat ' + msg.chat.id + ' | ' +
    (msg.contact ? 'контакт ' + _str_(msg.contact.phone_number) : 'текст: ' + _str_(msg.text)));

  // Человек написал — значит, сейчас будет диалог. Держим быстрый режим,
  // чтобы следующие сообщения обрабатывались за секунду, а не через минуту.
  _tgАктивировать_(180);

  if (msg.contact) { _tgПоКонтакту_(msg); return; }

  const chat = msg.chat.id;
  const text = _str_(msg.text);

  // Повторная выдача: чат уже привязан к человеку, номер спрашивать незачем
  if (text === TG_КНОПКА_ДОСТУП || text === '/login' || /мой логин/i.test(text)) {
    _tgПовторнаяВыдача_(chat);
    return;
  }

  if (text === '/start' || text === '/help' || /логин|пароль|доступ/i.test(text)) {
    const known = _tgЛогинЧата_(chat);
    _tgSend_(chat, TG_ПРИВЕТ + (known
        ? '\n\nВы уже получали доступ. Нажмите <b>«' + TG_КНОПКА_ДОСТУП + '»</b>, чтобы прислать его снова.'
        : ''),
      { reply_markup: _tgКлавиатура_(!known) });
  } else {
    _tgSend_(chat,
      'Нажмите кнопку внизу экрана: <b>«📱 Отправить мой номер»</b> — если получаете доступ впервые, ' +
      'или <b>«' + TG_КНОПКА_ДОСТУП + '»</b> — если уже получали.\n' +
      'Если кнопок не видно, отправьте /start.',
      { reply_markup: _tgКлавиатура_(true) });
  }
}

/**
 * Отправляет логин и пароль. Общая точка для первой выдачи по номеру
 * и для повторной по кнопке — чтобы текст и правила были в одном месте.
 * hit = { row: строка листа паролей, data: значения строки }
 */
function _tgВыдатьДоступ_(chat, psh, hit) {
  const fio = _str_(hit.data[PW.FIO]);
  const login = _str_(hit.data[PW.LOGIN]);
  let pass = _str_(hit.data[PW.PWD]);

  if (!login) { _tgSend_(chat, 'У записи нет логина. Обратитесь к HR BP.'); return; }

  // Человек уже менял пароль — прежнего в открытом виде нет, выдаём новый
  if (!pass || pass.indexOf(PWD_CHANGED) === 0) {
    const user = _findUser_(login);
    if (!user) { _tgSend_(chat, 'Учётная запись не найдена. Обратитесь к HR BP.'); return; }
    pass = _makePassword_();
    _sheet_(SH.USERS).getRange(user.row, U.HASH + 1).setValue(_hash_(pass));
    psh.getRange(hit.row, PW.PWD + 1).setValue(pass);
    _log_('телеграм', 'сброс пароля', login);
  }

  const url = _appUrl_();
  let out = '✅ <b>' + _tgEsc_(fio || login) + '</b>\n\n' +
    'Логин\n<code>' + _tgEsc_(login) + '</code>\n\n' +
    'Пароль\n<code>' + _tgEsc_(pass) + '</code>\n\n' +
    '<i>Нажмите на логин или пароль — они скопируются.</i>';
  if (url) out += '\n\n🔗 <a href="' + _tgEsc_(url) + '">Открыть форму и войти</a>';
  out += '\n\nПароль можно сменить в форме: меню ⋮ → «Сменить пароль».\n' +
         'Потеряли это сообщение — нажмите «' + TG_КНОПКА_ДОСТУП + '».';

  // Клавиатуру не убираем: остаётся кнопка повторной выдачи
  _tgSend_(chat, out, { reply_markup: _tgКлавиатура_(false) });
  _tgЗапомнитьЧат_(chat, login);
  _tgОтметитьВыдачу_(chat);          // пауза — только после успешной отправки
  _log_('телеграм', 'выдан доступ', login);
}

/** Присылает доступ повторно — чату, который уже подтверждал номер. */
function _tgПовторнаяВыдача_(chat) {
  const login = _tgЛогинЧата_(chat);
  if (!login) {
    _tgSend_(chat,
      'Сначала подтвердите номер — нажмите <b>«📱 Отправить мой номер»</b>.',
      { reply_markup: _tgКлавиатура_(true) });
    return;
  }
  const lock = LockService.getScriptLock();
  try {
    lock.tryLock(20000);
    const psh = _подготовитьЛистПаролей_();
    const lr = psh.getLastRow();
    if (lr < 2) { _tgSend_(chat, 'Список доступов пуст. Обратитесь к HR BP.'); return; }
    const vals = psh.getRange(2, 1, lr - 1, PWD_COLS).getValues();
    for (let i = 0; i < vals.length; i++) {
      if (_normName_(vals[i][PW.LOGIN]) === _normName_(login)) {
        _tgВыдатьДоступ_(chat, psh, { row: i + 2, data: vals[i] });
        return;
      }
    }
    _tgSend_(chat, 'Ваша запись больше не найдена в списке. Обратитесь к HR BP.');
  } catch (err) {
    try { _tgSend_(chat, 'Ошибка на стороне таблицы. Обратитесь к HR BP.'); } catch (e2) {}
    _log_('телеграм', 'ошибка повторной выдачи', String(err && err.message));
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ── Режим опроса ──
//
// Вебхук через Apps Script ненадёжен: на POST по адресу /exec Google отвечает
// редиректом 302 на script.googleusercontent.com, а Telegram редиректы для
// вебхуков не следует и считает доставку неудачной. Отсюда растущая очередь
// и повторные сообщения. В режиме опроса скрипт сам ходит за обновлениями,
// и никакого редиректа в цепочке нет.

/**
 * Забирает и обрабатывает накопившиеся обновления. Запускается по таймеру.
 *
 * Два режима. В покое проход мгновенный (timeout: 0) и укладывается в секунду —
 * это около 25 минут в сутки при запуске раз в минуту. Как только кто-то пишет
 * боту или нажимает кнопку в форме, открывается окно быстрого ответа: соединение
 * держится открытым, и весь дальнейший диалог идёт за секунду, в пределах
 * одного запуска (потолок — 4 минуты).
 *
 * Круглосуточно держать связь нельзя: Apps Script на аккаунте @gmail.com даёт
 * 90 минут выполнения в сутки, ожидание по 45 секунд каждую минуту съело бы
 * лимит часа за два. Поэтому первое сообщение после паузы ждёт до минуты,
 * а все следующие — секунду.
 */
function телеграмОпрос() {
  if (!_tgToken_()) return 0;
  const cache = CacheService.getScriptCache();
  // Мьютекс на кэше, а не на LockService: обработка контакта берёт скриптовую
  // блокировку, и держать её здесь же нельзя.
  if (cache.get('tg_poll')) return 0;
  cache.put('tg_poll', '1', 300);

  const props = PropertiesService.getScriptProperties();
  let offset = Number(props.getProperty('TG_OFFSET') || 0);

  // Окно быстрого ответа. Открывается двумя путями: форма нажала
  // «Получить логин и пароль», либо человек сам написал боту — тогда окно
  // продлевает сам обработчик. Пока окно открыто, соединение держится
  // открытым и ответ приходит за секунду.
  // Вне окна — мгновенный проход: держать связь круглосуточно не даёт
  // суточная квота Apps Script, её хватило бы часа на два.
  const HARD_LIMIT = 4 * 60 * 1000;              // потолок одного запуска
  const started = Date.now();
  let activeUntil = Number(props.getProperty('TG_ACTIVE_UNTIL') || 0);

  let got = 0;
  try {
    while (Date.now() - started < HARD_LIMIT) {
      const active = Date.now() < activeUntil;
      const ups = _tgCall_('getUpdates', {
        offset: offset,
        timeout: active ? 25 : 0,                // секунды ожидания на стороне Telegram
        limit: 50, allowed_updates: ['message']
      });

      if (!ups || !ups.length) {
        if (!active) break;                       // очередь пуста и спешить некуда
        // Окно могли продлить, пока мы ждали, — перечитываем и решаем заново
        activeUntil = Number(props.getProperty('TG_ACTIVE_UNTIL') || 0);
        if (Date.now() >= activeUntil) break;
        continue;
      }

      for (let i = 0; i < ups.length; i++) {
        const u = ups[i];
        if (u.update_id >= offset) offset = u.update_id + 1;
        got++;
        try { _tgОбработать_(u); }
        catch (err) { _log_('телеграм', 'ошибка обработки', String(err && err.message)); }
      }
      props.setProperty('TG_OFFSET', String(offset));   // подтверждаем приём сразу

      // Обработчик открыл окно на время диалога — продолжаем этим же запуском,
      // иначе следующий ответ ждал бы очередного срабатывания таймера
      activeUntil = Number(props.getProperty('TG_ACTIVE_UNTIL') || 0);
    }
  } catch (err) {
    _log_('телеграм', 'ошибка опроса', String(err && err.message));
  } finally {
    props.setProperty('TG_OFFSET', String(offset));
    cache.remove('tg_poll');
  }
  return got;
}

/**
 * Открывает окно быстрого ответа и тут же запускает опрос разовым триггером.
 * Ждать минутного таймера нельзя: он мог сработать секунду назад.
 */
function _tgАктивировать_(seconds) {
  const props = PropertiesService.getScriptProperties();
  const sec = Math.max(30, Math.min(Number(seconds) || 150, 300));
  props.setProperty('TG_ACTIVE_UNTIL', String(Date.now() + sec * 1000));
  try {
    const busy = ScriptApp.getProjectTriggers().some(function (t) {
      return t.getHandlerFunction() === 'телеграмОпросСрочно';
    });
    if (!busy) ScriptApp.newTrigger('телеграмОпросСрочно').timeBased().after(1000).create();
  } catch (e) { /* упёрлись в лимит триггеров — ответит минутный опрос */ }
}

/** Разовый запуск опроса. Сам себя снимает: иначе разовые триггеры копятся до лимита. */
function телеграмОпросСрочно() {
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'телеграмОпросСрочно') ScriptApp.deleteTrigger(t);
    });
  } catch (e) { /* не смогли снять — следующий вызов попробует снова */ }
  телеграмОпрос();
}

/**
 * Форма зовёт это, когда человек нажимает «Получить логин и пароль».
 * Ничего не читает и не меняет в таблице — только переводит бота
 * в режим быстрого ответа на ближайшие две с половиной минуты.
 */
function apiПодготовитьБота() {
  try {
    if (!_tgToken_()) return { ok: false };
    const cache = CacheService.getScriptCache();
    if (cache.get('tg_arm')) return { ok: true, already: true };   // не чаще раза в 20 секунд
    cache.put('tg_arm', '1', 20);
    _tgАктивировать_(150);
    return { ok: true };
  } catch (e) {
    return { ok: false };
  }
}

/** Разобрать очередь прямо сейчас, не дожидаясь таймера. Для проверки. */
function телеграмЗабратьСейчас() {
  const ui = SpreadsheetApp.getUi();
  if (!_tgToken_()) { ui.alert('Токен не задан.'); return; }
  const n = телеграмОпрос();
  ui.alert('Опрос выполнен',
    'Обработано сообщений: ' + n + '\n\n' +
    (n ? 'Проверьте бота.' : 'Новых сообщений не было.'), ui.ButtonSet.OK);
}

function _тгТриггерОпроса_() {
  return ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'телеграмОпрос';
  });
}

/** Переключает бота на опрос: снимает вебхук и ставит таймер раз в минуту. */
function телеграмВключитьОпрос() {
  const ui = SpreadsheetApp.getUi();
  if (!_tgToken_()) { ui.alert('Сначала задайте токен бота.'); return; }
  _tgCall_('deleteWebhook', { drop_pending_updates: true });
  _тгТриггерОпроса_().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('телеграмОпрос').timeBased().everyMinutes(1).create();
  PropertiesService.getScriptProperties().deleteProperty('TG_OFFSET');
  _tgКоманды_();
  _log_('меню', 'телеграм', 'включён режим опроса');
  ui.alert('Режим опроса включён',
    'Вебхук снят, очередь очищена. Скрипт сам забирает сообщения раз в минуту.\n\n' +
    'Когда человек нажимает в форме «Получить логин и пароль», бот переходит ' +
    'в быстрый режим на 2,5 минуты и отвечает за секунду.\n' +
    'Если написать боту напрямую, минуя форму, ответ придёт в течение минуты — ' +
    'держать соединение открытым круглые сутки не даёт суточная квота Apps Script.\n\n' +
    'Развёртывание веб-приложения для бота больше не нужно — ' +
    'но оставьте его, по нему работает сама форма.', ui.ButtonSet.OK);
}

function телеграмВыключитьОпрос() {
  const n = _тгТриггерОпроса_().length;
  _тгТриггерОпроса_().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  _log_('меню', 'телеграм', 'режим опроса выключен');
  SpreadsheetApp.getUi().alert('Опрос выключен',
    'Снято таймеров: ' + n + '. Бот больше не отвечает.', SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Обработка присланного контакта: сверка номера и выдача доступа. */
function _tgПоКонтакту_(msg) {
  const chat = msg.chat.id;

  // Контакт можно переслать чужой. Выдаём доступ только владельцу номера.
  // user_id отсутствует, если контакт добавлен вручную и не привязан к аккаунту.
  if (!msg.contact.user_id || msg.contact.user_id !== msg.from.id) {
    _log_('телеграм', 'чужой контакт',
      'contact.user_id=' + _str_(msg.contact.user_id) + ' from.id=' + _str_(msg.from.id));
    _tgSend_(chat,
      '⚠️ Это чужой контакт. Нажмите кнопку <b>«📱 Отправить мой номер»</b> внизу экрана — ' +
      'Telegram отправит именно ваш номер.\n\n' +
      'Если кнопки не видно, отправьте /start.',
      { reply_markup: _tgКлавиатураКонтакт_() });
    return;
  }

  const phone = _телефон_(msg.contact.phone_number);
  if (!phone) { _tgSend_(chat, 'Не удалось разобрать номер. Обратитесь к HR BP.'); return; }

  if (_tgБылоНедавно_(chat)) {
    _tgSend_(chat, 'Доступ уже отправлен выше 👆 Посмотрите предыдущее сообщение.',
      { reply_markup: { remove_keyboard: true } });
    return;
  }

  const lock = LockService.getScriptLock();
  try {
    lock.tryLock(20000);
    const psh = _подготовитьЛистПаролей_();
    const lr = psh.getLastRow();
    if (lr < 2) { _tgSend_(chat, 'Список доступов пуст. Обратитесь к HR BP.'); return; }
    const vals = psh.getRange(2, 1, lr - 1, PWD_COLS).getValues();

    const hits = [];
    for (let i = 0; i < vals.length; i++) {
      if (_телефон_(vals[i][PW.PHONE]) === phone) hits.push({ row: i + 2, data: vals[i] });
    }

    if (!hits.length) {
      _tgSend_(chat,
        '🔍 Номер <code>' + _tgEsc_(msg.contact.phone_number) + '</code> в списке не найден.\n\n' +
        'Попросите HR BP добавить его на лист «' + _tgEsc_(SH.PWD) + '» — ' +
        'после этого нажмите кнопку ещё раз.',
        { reply_markup: _tgКлавиатураКонтакт_() });
      _log_('телеграм', 'номер не найден', phone);
      return;
    }
    if (hits.length > 1) {
      _tgSend_(chat, '⚠️ Этот номер указан у нескольких человек. Обратитесь к HR BP.');
      _log_('телеграм', 'номер у нескольких', phone);
      return;
    }

    _tgВыдатьДоступ_(chat, psh, hits[0]);
  } catch (err) {
    try { _tgSend_(chat, 'Ошибка на стороне таблицы. Обратитесь к HR BP.'); } catch (e2) {}
    _log_('телеграм', 'ошибка выдачи', String(err && err.message));
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ── Настройка бота из меню ──

function телеграмЗадатьТокен() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Токен бота',
    'Вставьте токен из @BotFather (вид: 1234567890:AA...).\n\n' +
    'Он сохранится в свойствах скрипта, в таблицу и в код не попадёт.',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const t = r.getResponseText().trim();
  if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(t)) {
    ui.alert('Не похоже на токен', 'Ожидается вид 1234567890:AA...\nНичего не сохранено.', ui.ButtonSet.OK);
    return;
  }
  PropertiesService.getScriptProperties().setProperty('TG_TOKEN', t);
  _log_('меню', 'телеграм', 'токен сохранён');
  ui.alert('Токен сохранён', 'Теперь: «Телеграм-бот → Подключить вебхук».', ui.ButtonSet.OK);
}

/**
 * Задать адрес веб-приложения вручную.
 * ScriptApp.getService().getUrl() отдаёт ссылку того развёртывания, которое
 * скрипт считает текущим, — а после нескольких публикаций это часто уже
 * не то, что открыто у людей. Тогда Telegram и получает 404.
 */
function телеграмЗадатьАдрес() {
  const ui = SpreadsheetApp.getUi();
  const cur = PropertiesService.getScriptProperties().getProperty('APP_URL') || '(не задан)';
  const r = ui.prompt('Адрес веб-приложения',
    'Сейчас: ' + cur + '\n\n' +
    'Скопируйте адрес из: Развернуть → Управление развёртываниями → ' +
    'ваше развёртывание → «Веб-приложение», ссылка заканчивается на /exec.\n\n' +
    'Вставьте её сюда:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const u = r.getResponseText().trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u)) {
    ui.alert('Не похоже на адрес',
      'Ожидается вид:\nhttps://script.google.com/macros/s/AKfy…/exec\n\n' +
      'Без ?s=… и без /dev на конце. Ничего не сохранено.', ui.ButtonSet.OK);
    return;
  }
  PropertiesService.getScriptProperties().setProperty('APP_URL', u);
  _log_('меню', 'телеграм', 'адрес задан вручную');
  ui.alert('Адрес сохранён', 'Теперь «Подключить вебхук».', ui.ButtonSet.OK);
}

function телеграмПодключить() {
  const ui = SpreadsheetApp.getUi();
  if (!_tgToken_()) { ui.alert('Сначала задайте токен бота.'); return; }
  const url = _appUrl_();
  if (!url) {
    ui.alert('Нет адреса приложения',
      'Сначала опубликуйте веб-приложение: Развернуть → Начать развёртывание → Веб-приложение, ' +
      'доступ «Все». Потом задайте адрес пунктом «Задать адрес приложения».', ui.ButtonSet.OK);
    return;
  }

  // Проверяем, что адрес вообще отвечает: иначе вебхук встанет на битую ссылку,
  // и ошибку будет видно только в getWebhookInfo
  let code = 0, note = '';
  try {
    const probe = UrlFetchApp.fetch(url + '?s=probe', { muteHttpExceptions: true, followRedirects: true });
    code = probe.getResponseCode();
  } catch (e) { note = e.message; }

  if (code !== 200) {
    const go = ui.alert('Адрес не отвечает',
      'Проверка ' + url + '\nвернула: ' + (code || note) + '\n\n' +
      'Обычно это значит:\n' +
      '  • развёртывание удалено или заменено новым;\n' +
      '  • у веб-приложения доступ не «Все»;\n' +
      '  • после правки кода не создана новая версия развёртывания.\n\n' +
      'Подключить вебхук всё равно?', ui.ButtonSet.YES_NO);
    if (go !== ui.Button.YES) return;
  }

  const hook = url + '?s=' + _tgSecret_();
  _tgCall_('setWebhook', {
    url: hook,
    allowed_updates: ['message'],
    drop_pending_updates: true
  });
  _log_('меню', 'телеграм', 'вебхук подключён');
  ui.alert('Бот подключён',
    'Вебхук: ' + hook + '\n\n' +
    'Проверка адреса: ' + (code === 200 ? 'отвечает' : 'НЕ отвечает (' + (code || note) + ')') +
    '\n\nОткройте бота в Telegram и отправьте /start.', ui.ButtonSet.OK);
}

function телеграмОтключить() {
  const ui = SpreadsheetApp.getUi();
  if (!_tgToken_()) { ui.alert('Токен не задан.'); return; }
  _tgCall_('deleteWebhook', { drop_pending_updates: true });
  _log_('меню', 'телеграм', 'вебхук отключён');
  ui.alert('Бот отключён. Сообщения больше не обрабатываются.');
}

/**
 * Прогоняет номер через ту же сверку, что и бот, но без Telegram.
 * Отделяет «таблица не сходится» от «сообщение не дошло»:
 * если здесь всё находится, а в боте тишина — виноват вебхук.
 */
function телеграмПроверитьНомер() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Проверка номера',
    'Введите номер так, как он приходит из Telegram, например +992 92 976 6387:',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;

  const raw = r.getResponseText();
  const key = _телефон_(raw);
  if (!key) {
    ui.alert('Номер не разобран',
      'Из «' + raw + '» не вышло девяти цифр. Бот такой номер тоже не примет.', ui.ButtonSet.OK);
    return;
  }

  const psh = _подготовитьЛистПаролей_();
  const lr = psh.getLastRow();
  const hits = [];
  if (lr > 1) {
    const vals = psh.getRange(2, 1, lr - 1, PWD_COLS).getValues();
    for (let i = 0; i < vals.length; i++) {
      if (_телефон_(vals[i][PW.PHONE]) === key) hits.push({ row: i + 2, d: vals[i] });
    }
  }

  if (!hits.length) {
    ui.alert('Совпадений нет',
      'Введено:  ' + raw + '\nСравнивается по:  ' + key + '\n\n' +
      'Ни у кого на листе «' + SH.PWD + '» такого номера нет.\n' +
      'Сравниваются последние 9 цифр, код страны и пробелы значения не имеют.',
      ui.ButtonSet.OK);
    return;
  }
  if (hits.length > 1) {
    ui.alert('Номер у нескольких',
      hits.map(function (h) { return '  строка ' + h.row + ':  ' + _str_(h.d[PW.FIO]); }).join('\n') +
      '\n\nБот в таком случае откажет. Оставьте номер у одного человека.', ui.ButtonSet.OK);
    return;
  }

  const d = hits[0].d;
  const pass = _str_(d[PW.PWD]);
  ui.alert('Совпадение найдено',
    'Строка:  ' + hits[0].row + '\n' +
    'ФИО:  ' + _str_(d[PW.FIO]) + '\n' +
    'Логин:  ' + _str_(d[PW.LOGIN]) + '\n' +
    'Пароль:  ' + (pass.indexOf(PWD_CHANGED) === 0 ? '(сменён — бот выдаст новый)' : pass) + '\n\n' +
    'Сверка по таблице работает. Если бот при этом молчит — ' +
    'сообщения до скрипта не доходят: смотрите «Проверить состояние», строку «Последняя ошибка».',
    ui.ButtonSet.OK);
}


/** Пункт меню: диалоговое окно для привязки / обновления URL Cloudflare Webhook. */
function телеграмПривязатьВебхук() {
  const ui = SpreadsheetApp.getUi();
  if (!_tgToken_()) {
    ui.alert('Ошибка', 'Сначала задайте токен бота через меню: «Телеграм-бот → Задать токен бота…»', ui.ButtonSet.OK);
    return;
  }
  const wh = _tgCall_('getWebhookInfo', {});
  const currentUrl = (wh && wh.url) ? wh.url : 'https://farovon-tg-relay.muzaffarkhonr.workers.dev';
  const resp = ui.prompt('Привязка вебхука Cloudflare',
    'Вставьте полный адрес вашего Cloudflare Worker (например, https://farovon-tg-relay.ваш-аккаунт.workers.dev):\n\n' +
    'Текущий вебхук: ' + (wh && wh.url ? wh.url : 'не установлен'),
    ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const url = _str_(resp.getResponseText()).trim();
  if (!url || url.indexOf('https://') !== 0) {
    ui.alert('Ошибка', 'Адрес должен начинаться с https:// и не быть пустым.', ui.ButtonSet.OK);
    return;
  }
  
  // Снимаем таймер опроса, чтобы не было конфликтов
  _тгТриггерОпроса_().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  
  // Устанавливаем вебхук в Telegram API
  const res = _tgCall_('setWebhook', { url: url });
  if (res && res.result) {
    _log_('телеграм', 'вебхук установлен', url);
    ui.alert('Успешно',
      'Вебхук Cloudflare успешно привязан!\n\n' +
      'Адрес: ' + url + '\n\n' +
      'Бот теперь отвечает мгновенно за доли секунды и не расходует квоты Google.',
      ui.ButtonSet.OK);
  } else {
    const err = res ? (res.description || JSON.stringify(res)) : 'неизвестная ошибка';
    ui.alert('Ошибка привязки', 'Telegram вернул ошибку:\n' + err, ui.ButtonSet.OK);
  }
}

function телеграмПроверить() {
  const ui = SpreadsheetApp.getUi();
  if (!_tgToken_()) { ui.alert('Токен не задан.'); return; }
  const me = _tgCall_('getMe', {});
  const wh = _tgCall_('getWebhookInfo', {});
  const poll = _тгТриггерОпроса_().length > 0;
  const psh = _подготовитьЛистПаролей_();
  let withPhone = 0, total = 0;
  if (psh.getLastRow() > 1) {
    psh.getRange(2, 1, psh.getLastRow() - 1, PWD_COLS).getValues().forEach(function (r) {
      if (!_str_(r[PW.LOGIN])) return;
      total++;
      if (_телефон_(r[PW.PHONE])) withPhone++;
    });
  }
  
  let modeText = '';
  if (wh && wh.url) {
    modeText = '⚡ ВЕБХУК CLOUDFLARE (Рекомендуемый, активен)\n' +
               'Адрес:  ' + wh.url + '\n' +
               'Скорость:  моментальный ответ (~0.2 сек, без траты квот Google)';
  } else if (poll) {
    modeText = '⏱ РЕЗЕРВНЫЙ ОПРОС (раз в минуту)\n' +
               'Рекомендуется переключить на Cloudflare Webhook для мгновенных ответов.';
  } else {
    modeText = '❌ БОТ ВЫКЛЮЧЕН (вебхук и опрос не настроены)';
  }

  ui.alert('Состояние Telegram-бота',
    'Бот:  @' + (me.username || 'неизвестно') + ' (' + (me.first_name || '') + ')\n\n' +
    'Режим доставки:\n' + modeText + '\n\n' +
    (wh && wh.last_error_message
      ? '⚠️ Последняя ошибка Telegram:  ' + wh.last_error_message +
        (wh.last_error_date ? '\nКогда:  ' + _дата_(new Date(wh.last_error_date * 1000), true) : '') + '\n\n'
      : 'Ошибок доставки:  нет (все сообщения доставлены)\n\n') +
    'Сообщений в очереди:  ' + (wh && wh.pending_update_count ? wh.pending_update_count : 0) + '\n' +
    'Телефонов сотрудников в базе:  ' + withPhone + ' из ' + total + '\n\n' +
    (withPhone < total
      ? 'Подсказка: заполните колонку «Телефон» на листе «Пароли (выдать)» для оставшихся сотрудников.'
      : 'Все доступы привязаны к номерам телефонов.'),
    ui.ButtonSet.OK);
}

// ─────────────────────────────────────────────────────────────
// СИНХРОНИЗАЦИЯ
//
// Автоматически пересчитывается только ПРОИЗВОДНОЕ: счётчики, статусы,
// сводный справочник компаний, список учётных записей. Строки данных
// триггер не удаляет никогда — очистка сеткой по чужому листу необратима,
// а отменить её через Ctrl+Z уже нельзя: правку сделал скрипт, а не человек.
// Найденные расхождения выписываются на лист «Связи», а удаление сирот —
// отдельный пункт меню с предпросмотром.
// ─────────────────────────────────────────────────────────────

/** Идёт ли сейчас пересчёт. Защита от того, чтобы триггер не вызвал сам себя. */
function _syncBusy_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('SYNC_BUSY') !== '1') return false;
  const at = Number(props.getProperty('SYNC_AT') || 0);
  if (Date.now() - at > 120000) {        // скрипт мог упасть, не сняв флаг
    props.deleteProperty('SYNC_BUSY');
    return false;
  }
  return true;
}

/**
 * Обработчик установленного триггера «При изменении».
 * Простой onEdit не годится: он не срабатывает на удаление и вставку строк,
 * а именно это и нужно поймать.
 */
function приИзменении(e) {
  try {
    if (_syncBusy_()) return;
    const type = e && e.changeType;
    if (['EDIT', 'INSERT_ROW', 'REMOVE_ROW', 'INSERT_GRID', 'REMOVE_GRID',
         'INSERT_COLUMN', 'REMOVE_COLUMN', 'OTHER'].indexOf(type) === -1) return;

    const sh = e.source ? e.source.getActiveSheet() : null;
    const name = sh ? _normName_(sh.getName()) : '';

    // Листы-источники. Правку служебных листов не отслеживаем —
    // иначе собственная запись скрипта запускала бы новый круг пересчёта.
    const heavy = [SH.DIV, SH.PEOPLE, SH.REF].map(_normName_);
    const light = [SH.COMP, SH.SURVEY].map(_normName_);
    const isHeavy = heavy.indexOf(name) >= 0;
    if (!isHeavy && light.indexOf(name) === -1) return;

    // Пересчитывать на каждое нажатие нельзя: человек правит подряд десять ячеек,
    // и это десять запусков по несколько секунд — упрёмся в квоты Apps Script.
    // Поэтому копим правки и пересчитываем один раз, через паузу после последней.
    if (isHeavy) PropertiesService.getScriptProperties().setProperty('SYNC_NEED_USERS', '1');
    _отложитьПересчёт_();
  } catch (err) {
    // Триггер не должен падать с письмом об ошибке при каждой правке ячейки
    try { _log_('система', 'ошибка синхронизации', String(err && err.message)); } catch (e2) {}
  }
}

/** Снимает отложенный пересчёт, если он был запланирован. */
function _снятьОтложенный_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'отложенныйПересчёт') ScriptApp.deleteTrigger(t);
  });
}

/** Планирует пересчёт через паузу, сбрасывая предыдущий отложенный запуск. */
function _отложитьПересчёт_() {
  _снятьОтложенный_();
  ScriptApp.newTrigger('отложенныйПересчёт').timeBased().after(20 * 1000).create();
}

/** Собственно отложенный запуск. Срабатывает через паузу после последней правки. */
function отложенныйПересчёт() {
  _снятьОтложенный_();
  const props = PropertiesService.getScriptProperties();
  const users = props.getProperty('SYNC_NEED_USERS') === '1';
  props.deleteProperty('SYNC_NEED_USERS');
  синхронизировать_({ users: users });
}

/**
 * Пересчитывает всё производное.
 * opts.users — пересобирать ли учётные записи (нужно только при правке
 * «Подразделений», «Участников опроса» и «Справочника»).
 */
function синхронизировать_(opts) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SYNC_BUSY', '1');
  props.setProperty('SYNC_AT', String(Date.now()));
  const res = { statuses: 0, units: 0, companies: 0, users: 0, issues: 0 };
  try {
    _сброситьСправочник_();
    пересчитатьСтатусы_(true);
    res.statuses = 1;
    res.units = _обновитьСчётчикиПодразделений_();
    res.companies = _обновитьСправочникКомпаний_();
    if (opts && opts.users) res.users = _создатьПользователей_(false);
    res.issues = _отчётСвязей_();
  } finally {
    props.deleteProperty('SYNC_BUSY');
  }
  return res;
}

/** Пункт меню: синхронизировать вручную. */
function синхронизировать() {
  const ui = SpreadsheetApp.getUi();
  const r = синхронизировать_({ users: true });
  _log_('меню', 'синхронизация',
    'подразделений: ' + r.units + ', компаний: ' + r.companies +
    ', учёток: ' + r.users + ', расхождений: ' + r.issues);
  ui.alert('Синхронизация выполнена',
    'Статусы заполнения:  пересчитаны\n' +
    'Счётчик «Компаний в карте»:  ' + r.units + ' подразделений\n' +
    '«' + SH.DICT + '»:  ' + r.companies + ' компаний\n' +
    'Учётных записей:  ' + r.users + '\n\n' +
    (r.issues
      ? 'Найдено расхождений: ' + r.issues + '. Смотрите лист «' + SH.LINKS + '».\n\n' +
        'Строки данных не удалялись. Чтобы убрать сирот — меню → «Удалить сироты».'
      : 'Расхождений не найдено — всё связано корректно.'),
    ui.ButtonSet.OK);
  if (r.issues) _ss_().setActiveSheet(_sheet_(SH.LINKS, true));
}

/** Проставляет в «Подразделениях» фактическое число компаний в карте. */
function _обновитьСчётчикиПодразделений_() {
  const sh = _sheet_(SH.DIV);
  const lr = sh.getLastRow();
  if (lr < 2) return 0;
  const divs = sh.getRange(1, 1, lr, Math.max(sh.getLastColumn(), 1)).getValues();
  const dm = _divMap_(divs);
  if (dm.cnt === undefined || dm.cnt < 0) return 0;

  const comp = _values_(SH.COMP);
  const cm = _compMap_(comp);
  const byUnit = {};
  for (let i = 1; i < comp.length; i++) {
    const u = _cell_(comp[i], cm, 'unit');
    if (u) byUnit[u] = (byUnit[u] || 0) + 1;
  }
  _writeCol_(sh, dm.cnt, 2, lr - 1, function (i) {
    const u = _cell_(divs[i + 1], dm, 'unit');
    return u ? (byUnit[u] || 0) : undefined;
  });
  return lr - 1;
}

/**
 * Пересобирает «Справочник компаний»: список берётся из «Справочника»,
 * охват и тип считаются по «Конкурентам».
 * Сегмент, регион и источник, вписанные руками, сохраняются.
 */
function _обновитьСправочникКомпаний_() {
  const sh = _sheet_(SH.DICT, true);
  const ref = _справочник_();
  const comp = _values_(SH.COMP);
  const cm = _compMap_(comp);

  // Что уже вписано руками — не затираем
  const manual = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues().forEach(function (r) {
      const n = _normName_(r[1]);
      if (n) manual[n] = { seg: _str_(r[2]), region: _str_(r[3]), type: _str_(r[4]), src: _str_(r[5]) };
    });
  }

  // Охват и характеристики по фактическим строкам карты
  const stat = {};
  for (let i = 1; i < comp.length; i++) {
    const name = _cell_(comp[i], cm, 'company');
    if (!name) continue;
    const k = _normName_(name);
    if (!stat[k]) stat[k] = { units: {}, seg: '', region: '', type: '' };
    const u = _cell_(comp[i], cm, 'unit');
    if (u) stat[k].units[u] = true;
    if (!stat[k].seg) stat[k].seg = _cell_(comp[i], cm, 'seg');
    if (!stat[k].region) stat[k].region = _cell_(comp[i], cm, 'region');
    if (!stat[k].type) stat[k].type = _cell_(comp[i], cm, 'type');
  }

  const names = ref.companies
    .filter(function (c) { return c.name && c.name.indexOf('→ объединено') < 0; })
    .map(function (c) { return c.name; });
  // Компании, которых нет в справочнике, но которые встречаются в карте
  Object.keys(stat).forEach(function (k) {
    if (!names.some(function (n) { return _normName_(n) === k; })) {
      for (let i = 1; i < comp.length; i++) {
        if (_normName_(_cell_(comp[i], cm, 'company')) === k) {
          names.push(_cell_(comp[i], cm, 'company'));
          break;
        }
      }
    }
  });

  const out = names.sort(function (a, b) { return a.localeCompare(b, 'ru'); })
    .map(function (name, i) {
      const k = _normName_(name);
      const m = manual[k] || {};
      const s = stat[k] || { units: {} };
      return [i + 1, name,
        m.seg || s.seg || '', m.region || s.region || '', m.type || s.type || '',
        m.src || '', Object.keys(s.units).length];
    });

  sh.clear();
  sh.getRange(1, 1, 1, 7).setValues([['№', 'Компания', 'Сегмент', 'Регион присутствия',
    'Тип конкурента', 'Источник', 'В скольких подразделениях']])
    .setFontWeight('bold').setBackground('#fce8b2');
  if (out.length) sh.getRange(2, 1, out.length, 7).setValues(out);
  sh.setFrozenRows(1);
  sh.setColumnWidth(2, 260);
  return out.length;
}

/** Собирает список расхождений между листами. Ничего не меняет. */
function _найтиРасхождения_() {
  const comp = _values_(SH.COMP);
  const cm = _compMap_(comp);
  const divs = _values_(SH.DIV);
  const dm = _divMap_(divs);
  const surv = _valuesOpt_(SH.SURVEY);
  const ref = _справочник_();

  const units = {};
  for (let i = 1; i < divs.length; i++) {
    const u = _cell_(divs[i], dm, 'unit');
    if (u) units[_normName_(u)] = true;
  }
  const compIds = {}, compNames = {};
  ref.companies.forEach(function (c) {
    if (c.id) compIds[c.id] = true;
    if (c.name) compNames[_normName_(c.name)] = true;
  });
  const posNames = {};
  const posRef = _должности_();
  posRef.all.forEach(function (p) { posNames[_normName_(p)] = true; });

  const out = [];
  const add = function (kind, sheet, row, value, fix) {
    out.push([kind, sheet, row, value, fix]);
  };

  for (let i = 1; i < comp.length; i++) {
    const row = i + 1;
    const unit = _cell_(comp[i], cm, 'unit');
    const name = _cell_(comp[i], cm, 'company');
    const idc = _cell_(comp[i], cm, 'idComp');
    if (!unit && !name) continue;
    if (unit && !units[_normName_(unit)]) {
      add('Подразделения нет в оргструктуре', SH.COMP, row, unit,
        'Строка-сирота: вернуть подразделение в «' + SH.DIV + '» или удалить строку');
    }
    if (idc && !compIds[idc]) {
      add('ID_Комп не найден в справочнике', SH.COMP, row, idc,
        'Формула названия даст #N/A. Вернуть ID в «' + SH.REF + '»');
    }
    if (!idc && name) {
      add('Компания без ID_Комп', SH.COMP, row, name,
        'Название не связано со справочником — переименование не разойдётся');
    }
    if (name && !compNames[_normName_(name)]) {
      add('Компании нет в справочнике', SH.COMP, row, name,
        'Добавить в блок ID_Компания листа «' + SH.REF + '»');
    }
  }

  for (let i = 1; i < surv.length; i++) {
    const row = i + 1;
    if (_str_(surv[i][V.STATE]) === 'удалена') continue;
    const unit = _str_(surv[i][V.UNIT]);
    const pos = _str_(surv[i][V.POS_OUR]);
    if (unit && !units[_normName_(unit)]) {
      add('Подразделения нет в оргструктуре', SH.SURVEY, row, unit,
        'Запись-сирота: вернуть подразделение или удалить запись');
    }
    if (pos && !posNames[_normName_(pos)]) {
      add('Должности нет в штатке', SH.SURVEY, row, pos,
        'Добавить строку в «' + SH.POS + '»');
    } else if (pos && unit &&
               (posRef.byUnit[_normName_(unit)] || [])
                 .every(function (x) { return _normName_(x) !== _normName_(pos); })) {
      add('Должность не закреплена за подразделением', SH.SURVEY, row,
        pos + ' — ' + unit,
        'В «' + SH.POS + '» нет пары должность+подразделение: в выпадающем списке её не будет');
    }
  }

  // Пароли, выданные людям, которых больше нет среди пользователей
  const users = _valuesOpt_(SH.USERS);
  const logins = {};
  for (let i = 1; i < users.length; i++) {
    const l = _str_(users[i][U.LOGIN]);
    if (l) logins[_normName_(l)] = true;
  }
  const pwd = _valuesOpt_(SH.PWD);
  for (let i = 1; i < pwd.length; i++) {
    const l = _str_(pwd[i][PW.LOGIN]);
    if (l && !logins[_normName_(l)]) {
      add('Пароль без учётной записи', SH.PWD, i + 1, l,
        'Человека больше нет в «' + SH.USERS + '» — строку можно удалить');
    }
  }

  return out;
}

/** Выписывает расхождения на лист «Связи». Возвращает их количество. */

/** Пункт меню: автоматически устраняет все известные расхождения в листе «Связи». */
function починитьРасхождения() {
  const ui = SpreadsheetApp.getUi();
  const res = починитьРасхождения_();
  ui.alert('Готово',
    'Исправлено расхождений в связях: ' + res.fixed + '\n' +
    '  • ID компаний заменено: ' + res.compIds + '\n' +
    '  • Названий подразделений исправлено: ' + res.units + '\n' +
    '  • Должностей в штатку добавлено: ' + res.positions + '\n\n' +
    'Осталось расхождений в листе «Связи»: ' + res.remaining,
    ui.ButtonSet.OK);
}

function починитьРасхождения_() {
  let fixed = 0, compIds = 0, units = 0, positions = 0;

  // 1. Исправление ID компаний в «Конкуренты» (дубли справочника)
  //
  // Карта намеренно пуста. Раньше здесь лежали четыре правила вида 'К10'→'К9',
  // записанные под нумерацию справочника, которой давно нет. После пересборки
  // «Справочника» номера выдаются заново, и эти правила стали бить мимо:
  // на выгрузке от 21.08.2026 'К39'→'К19' означало «Далерон» → «Асали»,
  // 'К104'→'К101' — «Сахо» → «Сайхун». То есть починка сама портила данные.
  //
  // Слияние дублей компаний делает исправитьСегментыКомпаний() по названиям,
  // а привязку ID к названиям — _перепривязатьID_(). Захардкоженные номера
  // сюда добавлять нельзя: они переживают пересборку и снова протухают.
  const idFixes = {};

  const shComp = _sheet_(SH.COMP, true);
  if (shComp) {
    const lastRow = shComp.getLastRow();
    const lastCol = shComp.getLastColumn();
    if (lastRow > 1) {
      const data = shComp.getRange(1, 1, lastRow, lastCol).getValues();
      const cm = _compMap_(data);
      let changed = false;

      for (let i = 1; i < data.length; i++) {
        // Проверка ID компании
        if (cm.idComp >= 0) {
          const currentId = _str_(data[i][cm.idComp]);
          if (idFixes[currentId]) {
            data[i][cm.idComp] = idFixes[currentId];
            compIds++;
            fixed++;
            changed = true;
          }
        }
        // Проверка названия подразделения (префиксы _Завод ЖБИ / РБУ)
        if (cm.unit >= 0) {
          const currentUnit = _str_(data[i][cm.unit]);
          if (currentUnit === 'Завод ЖБИ Худжанд-2') {
            data[i][cm.unit] = '_Завод ЖБИ Худжанд-2';
            units++;
            fixed++;
            changed = true;
          } else if (currentUnit === 'Завод РБУ Худжанд-2') {
            data[i][cm.unit] = '_Завод РБУ Худжанд-2';
            units++;
            fixed++;
            changed = true;
          }
        }
      }

      if (changed) {
        shComp.getRange(1, 1, lastRow, lastCol).setValues(data);
      }
    }
  }

  // 2. Добавление недостающей должности «Грузчик» в «Справочник должностей»
  const shPos = _sheet_(SH.POS, true);
  if (shPos) {
    const posData = shPos.getDataRange().getValues();
    let hasGruzchik = false;
    for (let i = 1; i < posData.length; i++) {
      const pName = _normName_(_str_(posData[i][2]));
      const pUnit = _normName_(_str_(posData[i][4]));
      if (pName === 'грузчик' && pUnit === _normName_('Отдел управления внутренними складами')) {
        hasGruzchik = true;
        break;
      }
    }
    if (!hasGruzchik) {
      const nextNum = posData.length;
      shPos.appendRow([nextNum, 'Д' + nextNum, 'Грузчик', '', 'Отдел управления внутренними складами']);
      positions++;
      fixed++;
    }
  }

  SpreadsheetApp.flush();
  _сброситьСправочник_();
  const remaining = _отчётСвязей_();
  пересчитатьСтатусы_(true);
  SpreadsheetApp.flush();

  _log_('меню', 'починить расхождения', 'исправлено: ' + fixed + ', осталось: ' + remaining);

  return { ok: true, fixed: fixed, compIds: compIds, units: units, positions: positions, remaining: remaining };
}

function _отчётСвязей_() {
  const list = _найтиРасхождения_();
  const sh = _sheet_(SH.LINKS, true);
  sh.clear();
  sh.getRange(1, 1, 1, 5).setValues([['Что не так', 'Лист', 'Строка', 'Значение', 'Что делать']])
    .setFontWeight('bold').setBackground('#efe1d5');
  if (list.length) {
    sh.getRange(2, 1, list.length, 5).setValues(list);
  } else {
    sh.getRange(2, 1, 1, 5).setValues([['Расхождений нет', '', '', '',
      'Проверено: ' + _дата_(new Date(), true)]]);
  }
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 260); sh.setColumnWidth(2, 130); sh.setColumnWidth(3, 70);
  sh.setColumnWidth(4, 240); sh.setColumnWidth(5, 420);
  return list.length;
}

/**
 * Удаляет строки, привязанные к несуществующим подразделениям.
 * Это единственное место, где скрипт удаляет данные из-за удаления в другом листе,
 * и делает он это только по явной команде и после подтверждения.
 */
function удалитьСироты() {
  const ui = SpreadsheetApp.getUi();
  const list = _найтиРасхождения_().filter(function (r) {
    return r[0] === 'Подразделения нет в оргструктуре';
  });
  if (!list.length) {
    ui.alert('Сирот нет', 'Все строки привязаны к существующим подразделениям.', ui.ButtonSet.OK);
    return;
  }
  const inComp = list.filter(function (r) { return r[1] === SH.COMP; });
  const inSurv = list.filter(function (r) { return r[1] === SH.SURVEY; });
  const units = {};
  list.forEach(function (r) { units[r[3]] = (units[r[3]] || 0) + 1; });

  const res = ui.alert('Удалить сироты',
    'Подразделения, которых больше нет в «' + SH.DIV + '»:\n' +
    Object.keys(units).map(function (u) { return '  • ' + u + ' — ' + units[u] + ' стр.'; }).join('\n') +
    '\n\nБудет удалено строк в «' + SH.COMP + '»: ' + inComp.length + '\n' +
    'Будет помечено «удалена» в «' + SH.SURVEY + '»: ' + inSurv.length + '\n\n' +
    'Строки «' + SH.COMP + '» удаляются безвозвратно. Продолжить?', ui.ButtonSet.YES_NO);
  if (res !== ui.Button.YES) return;

  const props = PropertiesService.getScriptProperties();
  props.setProperty('SYNC_BUSY', '1');
  props.setProperty('SYNC_AT', String(Date.now()));
  try {
    if (inComp.length) {
      const sh = _sheet_(SH.COMP);
      inComp.map(function (r) { return r[2]; })
            .sort(function (a, b) { return b - a; })     // снизу вверх, иначе номера поедут
            .forEach(function (row) { sh.deleteRow(row); });
    }
    if (inSurv.length) {
      const sv = _sheet_(SH.SURVEY);
      inSurv.forEach(function (r) {
        sv.getRange(r[2], V.STATE + 1).setValue('удалена');
      });
    }
  } finally {
    props.deleteProperty('SYNC_BUSY');
  }

  _log_('меню', 'удаление сирот',
    SH.COMP + ': ' + inComp.length + ', ' + SH.SURVEY + ': ' + inSurv.length);
  синхронизировать_({ users: false });
  ui.alert('Готово',
    'Удалено строк: ' + inComp.length + '\nПомечено записей: ' + inSurv.length,
    ui.ButtonSet.OK);
}

/** Ставит триггер «При изменении». Без него пересчёт только по кнопке. */
/** Включение без окна — вызывается и из меню, и при настройке системы. */
function включитьАвтосинхронизацию_() {
  выключитьАвтосинхронизацию_();
  ScriptApp.newTrigger('приИзменении')
    .forSpreadsheet(_ss_())
    .onChange()
    .create();
  PropertiesService.getScriptProperties().setProperty('AUTOSYNC', '1');
}

/** Включена ли автосинхронизация. Триггер важнее свойства: его могли удалить руками. */
function _автосинхронизацияВключена_() {
  return ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'приИзменении';
  });
}

function включитьАвтосинхронизацию() {
  const ui = SpreadsheetApp.getUi();
  включитьАвтосинхронизацию_();
  _log_('меню', 'автосинхронизация', 'включена');
  ui.alert('Автосинхронизация включена',
    'Теперь при правке «' + SH.COMP + '», «' + SH.SURVEY + '», «' + SH.DIV + '», «' +
    SH.PEOPLE + '» и «' + SH.REF + '» пересчитываются:\n\n' +
    '  • «' + SH.STATUS + '»\n' +
    '  • «Компаний в карте» в «' + SH.DIV + '»\n' +
    '  • «' + SH.DICT + '»\n' +
    '  • учётные записи (при правке оргструктуры)\n' +
    '  • лист «' + SH.LINKS + '» с расхождениями\n\n' +
    'Пересчёт идёт через 20 секунд после последней правки — чтобы правка ' +
    'десяти ячеек подряд не запускала десять пересчётов.\n\n' +
    'Строки данных триггер не удаляет. Если удалить подразделение, ' +
    'его строки станут сиротами и попадут в «' + SH.LINKS + '» — ' +
    'убрать их можно пунктом «Удалить сироты».', ui.ButtonSet.OK);
}

function выключитьАвтосинхронизацию_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const h = t.getHandlerFunction();
    if (h === 'приИзменении' || h === 'отложенныйПересчёт') ScriptApp.deleteTrigger(t);
  });
}

function выключитьАвтосинхронизацию() {
  выключитьАвтосинхронизацию_();
  PropertiesService.getScriptProperties().deleteProperty('AUTOSYNC');
  _log_('меню', 'автосинхронизация', 'выключена');
  SpreadsheetApp.getUi().alert('Автосинхронизация выключена',
    'Пересчёт теперь только вручную: меню → «Синхронизировать всё».',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

// ─────────────────────────────────────────────────────────────
// ОЧИСТКА ДАННЫХ ЗА ПЕРИОД
// ─────────────────────────────────────────────────────────────

/** Открывает окно выбора периода. */
function очиститьДанныеПериода() {
  const html = HtmlService.createHtmlOutput(_окноОчистки_())
    .setWidth(520).setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, 'Очистить данные за период');
}

/** Список периодов с количеством записей. Вызывается из окна. */
function listCleanupPeriods() {
  const surv = _valuesOpt_(SH.SURVEY);
  const map = {};
  for (let i = 1; i < surv.length; i++) {
    const p = _str_(surv[i][V.PERIOD]) || '(без периода)';
    if (!map[p]) map[p] = { name: p, total: 0, active: 0, deleted: 0 };
    map[p].total++;
    if (_str_(surv[i][V.STATE]) === 'удалена') map[p].deleted++;
    else map[p].active++;
  }
  const comp = _values_(SH.COMP);
  const cm = _compMap_(comp);
  let marked = 0;
  for (let i = 1; i < comp.length; i++) {
    if (_класс_(_cell_(comp[i], cm, 'actual')) !== 'todo') marked++;
  }
  return {
    current: _период_().name,
    periods: Object.keys(map).map(function (k) { return map[k]; })
                   .sort(function (a, b) { return b.total - a.total; }),
    compMarked: marked,
    compTotal: Math.max(comp.length - 1, 0)
  };
}

/**
 * Чистит выбранный период.
 * opts = { survey, competitors, statuses, hard }
 *   survey       — записи «Обзора рынка» этого периода
 *   competitors  — отметки в «Конкурентах» (актуальность, приоритет, комментарий)
 *   statuses     — состояния в «Статусе заполнения»
 *   hard         — удалять строки обзора совсем, а не помечать «удалена»
 */
function runPeriodCleanup(period, opts) {
  const lock = LockService.getScriptLock();
  const props = PropertiesService.getScriptProperties();
  try {
    if (!lock.tryLock(30000)) return { ok: false, error: 'Таблица занята, попробуйте ещё раз' };
    props.setProperty('SYNC_BUSY', '1');
    props.setProperty('SYNC_AT', String(Date.now()));

    const p = _str_(period);
    if (!p) return { ok: false, error: 'Период не выбран' };
    const res = { survey: 0, competitors: 0, statuses: 0 };

    // 1) Обзор рынка
    if (opts.survey) {
      const sh = _sheet_(SH.SURVEY);
      const lr = sh.getLastRow();
      if (lr > 1) {
        const vals = sh.getRange(2, 1, lr - 1, SURVEY_COLS).getValues();
        const hit = [];
        for (let i = 0; i < vals.length; i++) {
          const pv = _str_(vals[i][V.PERIOD]) || '(без периода)';
          if (pv === p) hit.push(i);
        }
        res.survey = hit.length;
        if (opts.hard) {
          hit.map(function (i) { return i + 2; })
             .sort(function (a, b) { return b - a; })
             .forEach(function (row) { sh.deleteRow(row); });
        } else {
          hit.forEach(function (i) {
            vals[i][V.STATE] = 'удалена';
            vals[i][V.AT] = new Date();
          });
          sh.getRange(2, 1, lr - 1, SURVEY_COLS).setValues(vals);
        }
      }
    }

    // 2) Конкуренты — сбрасываем то, что вносил руководитель
    if (opts.competitors) {
      const sh = _sheet_(SH.COMP);
      const lr = sh.getLastRow();
      const n = Math.max(lr - 1, 0);
      if (n) {
        const cm = _compMap_([sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]]);
        res.competitors = _writeCol_(sh, cm.actual, 2, n, function () { return 'не проверено'; });
        _writeCol_(sh, cm.prio, 2, n, function () { return ''; });
        _writeCol_(sh, cm.note, 2, n, function () { return ''; });
        _writeCol_(sh, cm.by, 2, n, function () { return ''; });
        _writeCol_(sh, cm.at, 2, n, function () { return ''; });
      }
    }

    // 3) Статус заполнения
    if (opts.statuses) {
      пересчитатьСтатусы_(true);
      res.statuses = 1;
    }

    _log_('меню', 'очистка периода',
      p + ' | обзор: ' + res.survey + (opts.hard ? ' (удалено)' : ' (помечено)') +
      ', конкуренты: ' + res.competitors + (opts.statuses ? ', статусы сброшены' : ''));

    return { ok: true, res: res };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    props.deleteProperty('SYNC_BUSY');
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Разметка окна очистки. Держим в коде, чтобы не заводить лишний файл проекта. */
function _окноОчистки_() {
  return '<!DOCTYPE html><html><head><base target="_top"><style>' +
    'body{font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;' +
      'margin:0;padding:16px;color:#16202a}' +
    'h3{margin:0 0 4px;font-size:15px}' +
    'p.h{color:#66737f;margin:0 0 14px;font-size:13px;line-height:1.4}' +
    'label.p{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid #e2e6ea;' +
      'border-radius:10px;margin-bottom:8px;cursor:pointer}' +
    'label.p:hover{border-color:#1f6feb;background:#f5f9ff}' +
    'label.p input{margin:2px 0 0}' +
    'label.p b{display:block}' +
    'label.p small{color:#66737f}' +
    '.box{border:1px solid #e2e6ea;border-radius:10px;padding:12px;margin:14px 0}' +
    '.box label{display:flex;gap:10px;align-items:flex-start;margin-bottom:10px;cursor:pointer}' +
    '.box label:last-child{margin-bottom:0}' +
    '.warn{background:#fdf3e0;color:#8a5a00;border-radius:8px;padding:10px 12px;font-size:12.5px;' +
      'line-height:1.45;margin:12px 0}' +
    '.act{display:flex;gap:10px;margin-top:6px}' +
    'button{font:inherit;flex:1;min-height:40px;border-radius:9px;border:1px solid #e2e6ea;' +
      'background:#fff;cursor:pointer}' +
    'button.go{background:#c0392b;border-color:#c0392b;color:#fff;font-weight:600}' +
    'button:disabled{opacity:.5;cursor:default}' +
    '#msg{margin-top:12px;font-size:13px}' +
    '</style></head><body>' +
    '<div id="app">Загрузка…</div>' +
    '<script>' +
    'var D=null;' +
    'google.script.run.withSuccessHandler(function(d){D=d;draw();}).listCleanupPeriods();' +
    'function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){' +
      'return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}' +
    'function draw(){' +
      'if(!D.periods.length){document.getElementById("app").innerHTML=' +
        '"<h3>Данных нет</h3><p class=h>В «Обзоре рынка» пока нет ни одной записи.</p>";return;}' +
      'var h="<h3>Выберите период</h3><p class=h>Очистка затрагивает только выбранный период. "+' +
        '"Текущий период: <b>"+esc(D.current||"не задан")+"</b></p>";' +
      'D.periods.forEach(function(p,i){' +
        'h+="<label class=p><input type=radio name=per value=\\""+esc(p.name)+"\\""+(i===0?" checked":"")+">"+' +
          '"<span><b>"+esc(p.name)+"</b><small>записей: "+p.total+' +
          '(p.deleted?" (из них помечено удалёнными: "+p.deleted+")":"")+"</small></span></label>";});' +
      'h+="<div class=box>"+' +
        '"<label><input type=checkbox id=cSv checked><span><b>Записи «Обзора рынка»</b>"+' +
          '"<br><small>оклады, бонусы, льготы за этот период</small></span></label>"+' +
        '"<label><input type=checkbox id=cHard><span><b>Удалять строки совсем</b>"+' +
          '"<br><small>иначе они останутся в таблице со статусом «удалена» — так можно откатить</small></span></label>"+' +
        '"<label><input type=checkbox id=cCo><span><b>Отметки в «Конкурентах»</b>"+' +
          '"<br><small>актуальность, приоритет, комментарий, кто и когда заполнил — сейчас отмечено "+' +
          'D.compMarked+" из "+D.compTotal+"</small></span></label>"+' +
        '"<label><input type=checkbox id=cSt checked><span><b>Пересчитать «Статус заполнения»</b>"+' +
          '"<br><small>подразделения вернутся в состояние «не начато»</small></span></label>"+' +
      '"</div>";' +
      'h+="<div class=warn><b>Отменить нельзя.</b> Ctrl+Z не сработает: правки делает скрипт, "+' +
        '"а не человек. Если не уверены — сначала Файл → Создать копию.</div>";' +
      'h+="<div class=act><button onclick=\\"google.script.host.close()\\">Отмена</button>"+' +
        '"<button class=go id=go>Очистить</button></div><div id=msg></div>";' +
      'document.getElementById("app").innerHTML=h;' +
      'document.getElementById("go").onclick=run;' +
    '}' +
    'function run(){' +
      'var r=document.querySelector("input[name=per]:checked");' +
      'if(!r){return;}' +
      'var o={survey:document.getElementById("cSv").checked,' +
             'hard:document.getElementById("cHard").checked,' +
             'competitors:document.getElementById("cCo").checked,' +
             'statuses:document.getElementById("cSt").checked};' +
      'if(!o.survey&&!o.competitors&&!o.statuses){' +
        'document.getElementById("msg").innerHTML="Отметьте, что именно очистить.";return;}' +
      'var b=document.getElementById("go");b.disabled=true;b.textContent="Чистим…";' +
      'document.getElementById("msg").textContent="";' +
      'google.script.run.withSuccessHandler(function(res){' +
        'if(!res||!res.ok){b.disabled=false;b.textContent="Очистить";' +
          'document.getElementById("msg").innerHTML="Ошибка: "+esc(res&&res.error);return;}' +
        'document.getElementById("app").innerHTML="<h3>Готово</h3><p class=h>"+' +
          '"Обзор рынка: "+res.res.survey+"<br>Конкуренты: "+res.res.competitors+"</p>"+' +
          '"<div class=act><button onclick=\\"google.script.host.close()\\">Закрыть</button></div>";' +
      '}).withFailureHandler(function(e){b.disabled=false;b.textContent="Очистить";' +
        'document.getElementById("msg").innerHTML="Ошибка: "+esc(e&&e.message);})' +
       '.runPeriodCleanup(r.value,o);' +
    '}' +
    '</scr' + 'ipt></body></html>';
}

// ─────────────────────────────────────────────────────────────
// ЗНАЧОК ВКЛАДКИ
// ─────────────────────────────────────────────────────────────
//
// ⚠️  ПРИ ВСТАВКЕ: скопируйте сюда константу FAVICON_B64 из своего текущего Code.gs
//     целиком и без изменений — от строки «const FAVICON_B64 =» до «…ErkJggg==';».
//     В этом патче она не менялась, и переписывать её вручную нельзя:
//     одна потерянная буква в base64 ломает картинку.
//
const FAVICON_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAABA1SURBVHhe7d1vjBT1Hcfxe1YLt7dHa9QIiaThgal9QBtreGJKHxWwFQTv9rgD9uDudo//94e7AywKqCBauILC2UilEfFARRRB1GJ9YNI2wYbGNCE0qdiaCm1SrtWk12fT33dmfrffmfnM7Pxmfru3uze/5J34iJy8PruzfwaoK8f5xmDnvPRQfn56S2d7eqBrZ9H6O+LVuzpam2XZ4m0MamVw64u0bkV7en3bfMr+LayOc9dj2VvSA7klMwZzx2YM5S6LjMZBd11G40BAWzqD6+8Irm9NcL2rcT2ydkfpze6yRnpTQBtXBbdhJW69bIWjhnV2a1dcSa1rG23oXt4ifoZG+7d88o+JPpRvnzGUPyOAxwldluC7QvBUMfyJ2sQQrFLdrRca1rZ2T+oYZmzNdTcO5a4L/An0BN8nBE9FwOeJIYw1dLdtrctmb7FZSn/S23JLGofyVyz4BB+C8xA8FRN/ou5WoyHfer0h19ptE5XmpB/LNgr4CzO2SvgEH4LzEDylE9/Zlfrc8rttMn3nm9tyd5uP+gS/EALnIXiqdPhmqe7lY+m8xncQ4lq/QMCPJfgsBM5D8FSJ8SfKLzcaci3xLwnmK3yCT/ALIXAegqfKiW+Xyi8fsSnVj/3IT/B5CJyH4KlJwJ8YQa6lxyYNf+iaL+CTp30eAucheGoS8a1a6HKwwKYtfujVvnj0X0vwWQich+CpSsAXiWcB8cIwM9smDj4C/8MEn4XAeQieqhB88ei36spcKfqBEX3Ik+CzEDgPwVOVhm+XyjX7vx6gz/WTT/hYCJyH4KkKxW/IZehZ4Pq0dU132OTOk96a60nw7RA4D8FTlYwv68oM2+SFYz36ky92zBA4D8FT1YBvDqB5fFrW9SyQHpSP/gQ/MARPVQ2+OQAj1dW816a3zoxB8co/wQ8OwVNVhm8OoLPpmk0vHv2bs40COLmZIygET1Uhvqw+t9T61jA91Nme4AeE4KkqxqdSHU07zQGIF3+jCb5PCJ6qcvyGTlFH0+/sAXSJV/8JvicET9UCvlmTYQ4gwQcheKqG8M0BpIfysxN8VwieqjF8cwD0hzYSfBaCp2oQ3xwA/UGOBN8OwVMa8W/bmDUW/GyXsfvNU97OnHS04JldxqzeNSXDF+8CxAAGcz0JvgjBU5rw5wysNc5fvmT893/jyn109U/G93b02uj68K0BDHTtTPAZOE8T/uKDe4wb/74JccN286svjVXPD2vFLwwAocsQOA+B8xA4D8FTNYJPT/lXv/gcoqp2Y+ymMac/pw2/+AAQOA+B8xA4D8FTNYJP1/ztr70MMaP2/AfvaMNPdTwcMAAEzkPgPATOQ/BUDeFTpz/+LYSM2qW/XNWGn1rjNwAEzkPgPATOQ/BUjeFTca/9KF34eAAInIfAeQich+CpGsSnEGDcdOF7B4DAeQich8B5CJ6qUfyyDSAivnMACJyHwHkInIfgqRrGpxBg3HThFwaAwHkInIfAeQieqnF8CgHGTRc+VUd/qRJElyFwHgLnIXhqCuBTCDBuuvCp4AEgcB4C5yF4aorg05c4CDBuuvBTq5cFDACB8xA4D8FTUwi/tAOIj+8/AATOQ+A8BE9NMfzSDUAPPh4AAuchcB6Cp6YgfjkGEAffOwAEzkPgPARPTVH8Ug8gLr5zAAich8B5CJ6awvgUAoybLnzKGgAC5yFwHoKnpjg+3cWDAOOmC58qPgAEzkPwVIJvhgDjpgufCh4AAucheKoC8W8Vv97cx/qMZc89zdpnLHvW29xHe43bN63G4DwIT1n4dPcOAoybLvxU+9KAASBwHoKnKgx/Vn+X0Tv6S2PkNxdcvWOMfBDctldfMuYMro2MX9oBAHAeAucJfP8BIHAegqcqDP++3YPG8HtvRcKXHXr/beP+J7dHwi/dAAA4D4HzbHw8AATOQ/BUheHTU/6ec6/HwpcduPCmMbOnQxm/ZANA6DIEzmP43gEgcB6CpyoMn1p8aK8WfFn2hYMucB7Gp1u3EGDcIDyFwHkufOcAEDgPwVMViE9tOP6CNnxqx+mXXejF8cs6AATOA/iUNQAEzkPwVIXi09u7A+/yaz9GDd1FK1X8sg0AgfMAvKyO/rEkiC5D8FQF41O68b0DENBF8MsyAATOA+i84AEgeKrC8QsDYJBRYvjOAQjoEPh09y4CjJsu/FT2oYABIHiqCvCtAdiIUXPhFwYgoEPi0507CDBuuvD9B4DgqSrBp493IWrYAD6lil+yASBwHgLn2fh4AAieqiJ8+gwfwoYJwFudV8aflAEgcB7D9w4AwVNVhh95ABCeOm+mil/2ASBwngvfOQAET1UhfqQBQHjKwvcOoDh+WQeAwHkAn7IGgOCpKsVXHgCEpwr4zgGEw6ebNxFg3HThU/4DqGJ8pQFAeMqJXxhAePyyDACB8wA6Dw+gyvEpiO0OwlNefEoVn27dQoBx04WfWrUEDKAG8CkIzoPwFManVPFLOgAEzkPgPIHvHUCN4NPXthBdBuEpDC9TxS/ZABA4D4HzbHznAGoIP3AAEJ7C6DxV/EkZAALnMfzCAEqIf6v4db+7e4vx8JFnjIcPB/fdnX3G7T1rYuP7DgDCUxjcnSo+3bqFAOMG4SkEznPhWwPYLAegF3/WQN7oPfmiMfLhu1YT384Vb9vrx405Q+sj48MBQHgKY6NU8cs6AATOA/iUPQC9+Pc9sdUYfv9sJHzZoV+fM+7f80gkfM8AIDyFoXHnlPHLNgAEzgPwZivNAWQdA4iLT0/5e86fjoUvo5s6ZvZ1YnQZwKd043sGEAK/LANA4DwETwl8zwDi4lOLn31KC76VfS8egqcAvEw3vmMAIfHp7l0EGDdd+KmViwsD0IFPbTxxVBs+Ie5444QyPoXhKYTsVwF/YgAK+PS9PQKMmy78iQHowqfMaz8EVUlAyadwkSo+3bihG98cgCJ+yQaAwHkInnLh+wwAgPMAOg+DqiSgGL5nAAicZ9+2pRt/RLwoVcWflAEgeArggwEAcB4Ad7RhJQBVyQL3HQAC59n43gEgZL8wvjUANfyyDwDBUz749SscAwDgPATOsz/Rw7BhKoC7U8V3DgAh++WCZ/juAYTBL+sAEDwVgM8GAMB5CJwnP86NPAAnuDsIznPhFwaAkP1i6ACfDyAsPoUA46YLvzAAhC5D4DyGH20AXnB3EF0G8CmM7JcNHoAvB6CCTyHAuOnCtwawMWAACJznwlcfAAZ3B+EpAG/VIhARNErghsCnVPHpa1sEGDdd+PUrHgwYAALnAXwKQ6MwNkoVP/wABGxI/CMiVfySDgDBUwr49W1+A0DgPABvtj7sADC0X6r4dOsWBucJWAV85wAAOM/GL9kAEDyliI8HgMB5CJ6yv8/H4DyMHJQqfvEBCFhF/MIAADiP4Zd1ABHwvQNA4DwET7GbOTC6DAMXSxU/eAACNgK+NQAAznPhl20AEfGdA0DgPARPMfzgAWDcMKni+w9AwEbENweA0GUAn0KAcdOFXxgAAucheMqF7z8ADBs2DE9hfLp1Szf+kfcDBgDgZQgwbrrwKTGAlcEDQPAUwMcDwKihu+g3AAHtg+8dgICNie87AIDOQ4Bx04VPBQ8AwVM++HT3jm58PAABHYDvHICA1YAPBwDAHbUvhYBx04Vf3/qTgAEgeCoA3zkAF6ZqNr53AAK6CH5hAAJWE75nAAicZ9+0gQDjpgvffwAIniqCXxgAg4wSw3cOQECHwKe7d3XjOwaAwHk2fukGoAcfDwDBUyHwrQHYiFFz4RcGIKBD4tOdO7rxKVX8cgwgDr53AAieColPd+9C1LABfEoV3zMAgYrywFMAXgbBeS78Ug8gLr5zAAieUsCn7+0hbJgAvNV5ZXzHAAQqygNPAfRCb2N0GcCnEGDcdOFT1gAQPKWIH3kAEJ6yXsmr4k8MQKCiPPAURJe9bQbhKQAvQ4Bx04VP1QlgPIAI+JEGAOEp+TbOPYDi+OYABCrKA09BdJmF7zsAgM5DgHHThU/hAUTEp+hv14bQKAhPFfCdAwiHTzdvHqK/KVTg6sKHAwDgjrIPGTe/+hIixkkXfv3yH4MBxMCnBk7+CmO7g/CUE3/P2VeV8amBV45qxX/yzKgyPnXxkz9AxKhd/fvftOF7BxATn8oceQaD8yA85cSnuo8dVsanW7cyz+7Vhk/ljx5Sxqf2vXUKQkbtxEcfaMN3DkADPnVXX1fwZQDCU1586jvbNijjU3dtXm1eBnTgU/ds6VbGp77dl9N6GfjBo/0YXYbAeQy/MABN+PJ7+4X7d2vBzzy3LxK+bOG+R7XgNx/cEwlf1v/SLyCmavvOnMToMgTOc+G7BqAHX/b9nVuMp+lPCUfAP3DhjPHDvdtj4cvbt+79aY+x7+xrkfAPnDttzH98KBa+7EExxs/+eQPCFuvG2L+MjiMHMLoMgfMAPmUPQC++7PaN7eYQlh16yqe9VgcLzds1YMzc1K4FX3bb2lbj3kc2G0sPPIHb723ejl7jTvH/rgNffn8/U/ye0BB2vfay1auy47417X/c+Na6VRhdhsB5AN6sRQxA4G4tBf5EE1/kuBOv7CN8wqeKH+U2LkcInIfAefLmDXcav9INDMFTAt8awPoVLQm+Twich8B5CJ6qEPz6lgfoEtA2P8EHIXAeAucheKqC8K0B5LOzdeDfs32T0fXiYWP3m6eM3eLVqlqjzt4o1iuOdp1W7PUT8ZLXcNVCXPMnOuVfx+H9xtz+bgxPIXjKhW8OoC6bvSUuPr3aR69ek0rbuUu/N27NLouMbw1AnNTatrGo+BuO63mPmxStkXfPRsafnrEHIPA/jHrNv/Tpn+EPllSe6DOCqPjTmx+4Zg4g1d3WA9FlAF529YvP4Q+WVJ5ufvUfDE8F4YumZRYNmwNI5zOzITwF0Hk/f+8s/MGSytPFP34cCd9uvjkAOuJZ4LIqPr2tm9W7xvjkr5/CHy6ptH32j+vG3L58JHzx6B+z6a0jXgjuVMWX3bZhlbFl9EX7LZ1f4u1b8lbPGXiLV+ilwLYdP2rc2dEcCd+seeExm9461mWgdVwV31mLVfIhj6PJ+pDHFz+zyJjWtGiuTV84YgDDEJwH4SkBneA74CsVf3rTojM2ufNMW9d0R0P38nEIT0F4SkAn+A74isVv9nn0yyMGsDXBByF4qsrwRSM2tc+hj4bzrdcTfBaCp6oNv2nRuHj032FL+x/xlnDexKUAwlMCOsF3wFc0vujrzQuX2MTFjxhAC4anBHSC74CvdHzxtm+vTRv+pPItexN8V9WI7/eqP8wR2GcSfLvqfORfTi9e3GhzRjsCfzjBl1URvnjkx8aXJ5XPtAvg8QS/SvCjXPOLnVRn87yGrpbrCX4F44u3etObF7TYZPpPOpttFNjDDblm8WyQ4FcSvniPP/q1zI9m21SlPfTlUSqXGU3wATgPgfMQPKWEv/BC4Me7pTzpzqa5AvxYqqt5LMF3hcB5CJ4Kg9/8wPi0zKJR8d+Fmzom+6Q7MvMbOpqGU51N1xJ8AM5D8FQw/nXRiNIneoGnru7/AGVyARWJmM4AAAAASUVORK5CYII=';

// ─────────────────────────────────────────────────────────────
// ДОБАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯ
// Одна операция вместо ручной правки четырёх листов: человек попадает
// в «Справочник», в «Участники опроса», при необходимости в «Подразделения»,
// и сразу получает учётную запись с паролем.
// ─────────────────────────────────────────────────────────────

/** Пункт меню: открыть окно добавления. */
function добавитьПользователя() {
  const html = HtmlService.createHtmlOutput(_окноДобавления_())
    .setWidth(540).setHeight(640);
  SpreadsheetApp.getUi().showModalDialog(html, 'Добавить пользователя');
}

/** Данные для выпадающих списков окна. */
function listNewUserOptions() {
  const ref = _справочник_();
  const units = (ref.units || []).map(function (x) { return x.name; })
    .filter(String).sort(function (a, b) { return a.localeCompare(b, 'ru'); });

  // В HR BP предлагаем только тех, кто уже назначен хотя бы на одно подразделение
  const divs = _valuesOpt_(SH.DIV);
  const dm = _divMap_(divs);
  const seen = {};
  for (let i = 1; i < divs.length; i++) {
    const h = _cell_(divs[i], dm, 'hrbp');
    if (h && h !== '—' && !_похожеНаId_(h)) seen[h] = true;
  }
  const hrbps = Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, 'ru'); });

  return { units: units, hrbps: hrbps };
}

/**
 * Заводит человека везде и возвращает готовые логин с паролем.
 * data = { fio, unit, role, hrbp, phone }
 */
function createUser(data) {
  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(30000)) return { ok: false, error: 'Таблица занята, попробуйте ещё раз' };

    const fio = _str_(data && data.fio);
    if (!fio) return { ok: false, error: 'Укажите ФИО' };
    if (_похожеНаId_(fio)) return { ok: false, error: 'В поле ФИО введён идентификатор, а не имя' };
    if (fio.split(/\s+/).length < 2) return { ok: false, error: 'Укажите фамилию и имя целиком' };

    const role = _str_(data.role) || 'guest';
    const unit = _str_(data.unit);
    const hrbp = _str_(data.hrbp);
    const phone = _str_(data.phone);
    const notes = [];

    if ((role === 'head' || role === 'hrbp') && !unit) {
      return { ok: false, error: 'Для роли «Руководитель» или «HR BP» нужно выбрать подразделение' };
    }

    // Уже заведён?
    const ush = _sheet_(SH.USERS, true);
    if (ush.getLastRow() > 1) {
      const ex = ush.getRange(2, 1, ush.getLastRow() - 1, 7).getValues();
      for (let i = 0; i < ex.length; i++) {
        if (_normName_(ex[i][U.FIO]) === _normName_(fio)) {
          return { ok: false, error: 'Такой человек уже есть — логин ' + _str_(ex[i][U.LOGIN]) +
            '. Пароль меняют пунктом «Сменить пароль одному человеку».' };
        }
      }
    }

    // 1. «Справочник» — блок ID_Человек
    const personId = _добавитьВСправочник_('people', fio);
    if (!personId) notes.push('Не удалось записать человека в «' + SH.REF + '» — проверьте блок ID_Человек.');

    let unitId = '';
    if (unit) {
      unitId = _idПо_('units', unit);
      if (!unitId) notes.push('Подразделения «' + unit + '» нет в «' + SH.REF + '» — связь по ID не проставлена.');
    }
    const hrbpId = hrbp ? _idПо_('people', hrbp) : '';

    // Направление берём у подразделения — иначе оно останется от прошлой строки
    const напр = unit ? _напрПоПодразделению_(unit) : { id: '', name: '' };

    // 2. «Участники опроса» — новая строка с сохранением формул
    const place = _дописатьУчастника_(personId, fio, unitId, unit, hrbpId, hrbp,
                                      role, напр.id, напр.name);

    // 3. «Подразделения» — назначение ответственным или HR BP
    if (role === 'head' || role === 'hrbp') {
      const done = _назначитьВПодразделении_(unit, role, fio, personId);
      if (!done) notes.push('Подразделение «' + unit + '» не найдено в «' + SH.DIV + '» — роль не назначена.');
    }

    // 4. Пересчёт таблицы. Без него учётка не создавалась: формула с ФИО
    //    в только что добавленной строке ещё не отработала, и человека
    //    в списке просто не было.
    SpreadsheetApp.flush();
    const видно = _убедитьсяЧтоФиоВидно_(place, fio);
    if (видно.fixed && видно.ok) {
      notes.push('В «' + SH.PEOPLE + '» ФИО пришлось вписать текстом: формула по ID_Человек ' +
                 'имя не подтянула. Проверьте строку ' + place.row + '.');
    }
    if (!видно.ok) {
      return { ok: false, error: 'Не удалось записать ФИО в «' + SH.PEOPLE + '», строка ' +
        place.row + ' (в ячейке: «' + видно.seen + '»). Учётная запись не создана.' };
    }

    // 5. Учётная запись
    _сброситьСправочник_();
    _создатьПользователей_(false);
    SpreadsheetApp.flush();

    // 6. Забираем логин и пароль
    const found = _найтиУчётку_(fio);
    if (!found) {
      return { ok: false, error: 'Строка в «' + SH.PEOPLE + '» добавлена (№' + place.row +
        '), но учётная запись не создалась. Запустите «Синхронизировать всё» и проверьте ' +
        'лист «' + SH.USERS + '».' };
    }
    if (phone) {
      if (!_записатьТелефон_(found.login, phone)) {
        notes.push('Телефон записать не удалось — впишите его вручную на листе «' + SH.PWD + '».');
      }
    }

    _log_('меню', 'добавлен пользователь', fio + ' / ' + found.login + ' / ' + role);

    return {
      ok: true, fio: fio, login: found.login, password: found.password,
      role: role, personId: personId, unit: unit, notes: notes
    };
  } catch (e) {
    return { ok: false, error: 'Ошибка: ' + e.message };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * Дописывает строку в «Участники опроса».
 * Последняя строка копируется вниз — так переносятся формулы VLOOKUP,
 * после чего перезаписываются только ячейки без формул.
 */
function _дописатьУчастника_(personId, fio, unitId, unit, hrbpId, hrbp, role, dirId, dir) {
  const sh = _sheet_(SH.PEOPLE, true);
  const width = Math.max(sh.getLastColumn(), 1);
  const lr = Math.max(sh.getLastRow(), 1);
  const pm = _peopleMap_(sh.getRange(1, 1, 1, width).getValues());

  const target = lr + 1;
  if (lr >= 2) {
    // копия предыдущей строки тянет за собой формулы с поправкой на номер строки
    sh.getRange(lr, 1, 1, width).copyTo(sh.getRange(target, 1, 1, width));
  }
  const res = { row: target, map: pm };

  const put = function (key, value) {
    const c = pm[key];
    if (c === undefined || c < 0 || c >= width) return;
    const cell = sh.getRange(target, c + 1);
    if (cell.getFormula()) return;          // формулу не трогаем — она сама подтянет название
    cell.setValue(value);
  };

  // Заполняем каждую известную колонку: copyTo принесла значения предыдущей
  // строки, и всё, что не перезаписать, останется от прошлого человека.
  put('num', lr);                            // строка 2 — это №1
  put('id', personId);
  put('fio', fio);
  put('idDir', dirId || '');
  put('dir', dir || '');
  put('idUnit', unitId);
  put('unit', unit);
  put('idHrbp', hrbpId);
  put('hrbp', hrbp);
  put('role', role === 'hrbp' ? 'HR BP'
            : role === 'head' ? 'Руководитель подразделения'
            : 'Участник опроса');
  return res;
}

/**
 * Убеждается, что в новой строке «Участников опроса» действительно видно ФИО.
 * Там обычно стоит формула VLOOKUP по ID_Человек, и пока таблица не пересчитана,
 * ячейка пустая — из-за этого учётная запись не создавалась.
 * Если после пересчёта имя так и не появилось, вписываем его текстом:
 * без имени в этой колонке человек в учётки не попадёт вообще.
 */
function _убедитьсяЧтоФиоВидно_(place, fio) {
  const sh = _sheet_(SH.PEOPLE);
  const col = place.map['fio'];
  if (col === undefined || col < 0) return { ok: false, fixed: false, seen: '' };

  SpreadsheetApp.flush();                       // ждём, пока формулы пересчитаются
  const cell = sh.getRange(place.row, col + 1);
  let seen = _str_(cell.getValue());
  if (_normName_(seen) === _normName_(fio)) return { ok: true, fixed: false, seen: seen };

  cell.setValue(fio);                           // формула не отработала — пишем текстом
  SpreadsheetApp.flush();
  seen = _str_(cell.getValue());
  return { ok: _normName_(seen) === _normName_(fio), fixed: true, seen: seen };
}

/** Направление, к которому относится подразделение. */
function _напрПоПодразделению_(unit) {
  const divs = _valuesOpt_(SH.DIV);
  const dm = _divMap_(divs);
  for (let i = 1; i < divs.length; i++) {
    if (_normName_(_cell_(divs[i], dm, 'unit')) !== _normName_(unit)) continue;
    return { id: _cell_(divs[i], dm, 'idDir'), name: _cell_(divs[i], dm, 'dir') };
  }
  return { id: '', name: '' };
}

/** Ставит человека ответственным за обзор или HR BP в листе «Подразделения». */
function _назначитьВПодразделении_(unit, role, fio, personId) {
  const sh = _sheet_(SH.DIV);
  const width = Math.max(sh.getLastColumn(), 1);
  const rows = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), width).getValues();
  const dm = _divMap_(rows);

  for (let i = 1; i < rows.length; i++) {
    if (_normName_(_cell_(rows[i], dm, 'unit')) !== _normName_(unit)) continue;

    const put = function (key, value) {
      const c = dm[key];
      if (c === undefined || c < 0 || c >= width) return;
      const cell = sh.getRange(i + 1, c + 1);
      if (cell.getFormula()) return;
      cell.setValue(value);
    };
    // ID пишем всегда: имя в соседней колонке подтягивается формулой VLOOKUP.
    // Если формулы нет, имя проставляем сами.
    if (role === "head") { put("idResp", personId); put("resp", fio); }
    else { put("idHrbp", personId); put("hrbp", fio); }
    return true;
  }
  return false;
}

/** Логин и пароль только что заведённого человека. */
function _найтиУчётку_(fio) {
  const ush = _sheet_(SH.USERS);
  if (ush.getLastRow() < 2) return null;
  const rows = ush.getRange(2, 1, ush.getLastRow() - 1, 7).getValues();
  let login = '';
  for (let i = 0; i < rows.length; i++) {
    if (_normName_(rows[i][U.FIO]) === _normName_(fio)) { login = _str_(rows[i][U.LOGIN]); break; }
  }
  if (!login) return null;

  let password = '';
  const psh = _findSheet_(SH.PWD);
  if (psh && psh.getLastRow() > 1) {
    const pv = psh.getRange(2, 1, psh.getLastRow() - 1, PWD_COLS).getValues();
    for (let i = 0; i < pv.length; i++) {
      if (_normName_(pv[i][PW.LOGIN]) === _normName_(login)) { password = _str_(pv[i][PW.PWD]); break; }
    }
  }
  return { login: login, password: password };
}

/** Пишет телефон в «Пароли (выдать)» — по нему телеграм-бот узнаёт человека. */
function _записатьТелефон_(login, phone) {
  const psh = _findSheet_(SH.PWD);
  if (!psh || psh.getLastRow() < 2) return false;
  const rows = psh.getRange(2, 1, psh.getLastRow() - 1, PWD_COLS).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (_normName_(rows[i][PW.LOGIN]) === _normName_(login)) {
      psh.getRange(i + 2, PW.PHONE + 1).setNumberFormat('@').setValue(phone);
      return true;
    }
  }
  return false;
}

/** Разметка окна добавления. Стиль тот же, что у окна очистки периода. */
function _окноДобавления_() {
  return '<!DOCTYPE html><html><head><base target="_top"><style>' +
    'body{font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;' +
      'margin:0;padding:16px;color:#16202a}' +
    'h3{margin:0 0 4px;font-size:15px}' +
    'p.h{color:#66737f;margin:0 0 14px;font-size:13px;line-height:1.4}' +
    'label.f{display:block;font-size:12.5px;color:#66737f;font-weight:600;margin:12px 0 5px}' +
    'input,select{font:inherit;width:100%;padding:9px 10px;border:1px solid #e2e6ea;' +
      'border-radius:9px;box-sizing:border-box;background:#fff;color:#16202a}' +
    'input:focus,select:focus{outline:2px solid #1f6feb;outline-offset:-1px}' +
    'small.hint{display:block;color:#66737f;font-size:12px;margin-top:4px;line-height:1.35}' +
    '.act{display:flex;gap:10px;margin-top:20px}' +
    'button{font:inherit;flex:1;min-height:40px;border-radius:9px;border:1px solid #e2e6ea;' +
      'background:#fff;cursor:pointer}' +
    'button.go{background:#1f6feb;border-color:#1f6feb;color:#fff;font-weight:600}' +
    'button:disabled{opacity:.5;cursor:default}' +
    '.err{background:#fdecea;color:#c0392b;border-radius:8px;padding:10px 12px;' +
      'font-size:13px;margin:12px 0;line-height:1.4}' +
    '.okbox{background:#e3f5ea;border:1px solid #1a7f4b;border-radius:10px;padding:14px;margin:6px 0}' +
    '.okbox b{display:block;font-size:15px;margin-bottom:10px}' +
    '.kv{display:flex;justify-content:space-between;gap:12px;padding:7px 0;' +
      'border-top:1px solid #cfe8d9;font-size:14px}' +
    '.kv span{color:#3a4a47}' +
    '.kv code{font:600 14px ui-monospace,Consolas,monospace;background:#fff;' +
      'padding:2px 8px;border-radius:5px;user-select:all}' +
    '.warn{background:#fdf3e0;color:#8a5a00;border-radius:8px;padding:10px 12px;' +
      'font-size:12.5px;line-height:1.45;margin:12px 0}' +
    '</style></head><body>' +
    '<div id="app">Загрузка…</div>' +
    '<script>' +
    'var D=null;' +
    'google.script.run.withSuccessHandler(function(d){D=d;draw();}).listNewUserOptions();' +
    'function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){' +
      'return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}' +
    'function draw(){' +
      'var h="<h3>Новый пользователь</h3><p class=h>Человек попадёт в «Справочник», ' +
        '«Участники опроса» и получит логин с паролем. Ничего править руками не нужно.</p>";' +
      'h+="<div id=err></div>";' +
      'h+="<label class=f>ФИО полностью</label>";' +
      'h+="<input id=fio placeholder=\\"Например: Каримов Дилшод Зафарович\\">";' +
      'h+="<label class=f>Роль</label><select id=role>";' +
      'h+="<option value=guest>Участник опроса — подразделение выберет сам</option>";' +
      'h+="<option value=head>Руководитель — ответственный за обзор рынка</option>";' +
      'h+="<option value=hrbp>HR BP — видит сводку и управляет периодом</option>";' +
      'h+="</select>";' +
      'h+="<label class=f>Подразделение</label><select id=unit>";' +
      'h+="<option value=\\"\\">— не назначено —</option>";' +
      'D.units.forEach(function(u){h+="<option>"+esc(u)+"</option>";});' +
      'h+="</select><small class=hint>Для ролей «Руководитель» и «HR BP» обязательно.</small>";' +
      'h+="<label class=f>Его HR BP</label><select id=hrbp>";' +
      'h+="<option value=\\"\\">— не указан —</option>";' +
      'D.hrbps.forEach(function(p){h+="<option>"+esc(p)+"</option>";});' +
      'h+="</select>";' +
      'h+="<label class=f>Телефон</label>";' +
      'h+="<input id=phone placeholder=\\"+992 XX XXX XX XX\\">";' +
      'h+="<small class=hint>Нужен, чтобы человек получил пароль через телеграм-бота.</small>";' +
      'h+="<div class=act><button onclick=google.script.host.close()>Отмена</button>"+' +
        '"<button class=go id=go onclick=go()>Добавить</button></div>";' +
      'document.getElementById("app").innerHTML=h;' +
      'document.getElementById("fio").focus();' +
    '}' +
    'function err(m){document.getElementById("err").innerHTML="<div class=err>"+esc(m)+"</div>";}' +
    'function go(){' +
      'var d={fio:document.getElementById("fio").value.trim(),' +
        'role:document.getElementById("role").value,' +
        'unit:document.getElementById("unit").value,' +
        'hrbp:document.getElementById("hrbp").value,' +
        'phone:document.getElementById("phone").value.trim()};' +
      'if(!d.fio){err("Укажите ФИО");return;}' +
      'var b=document.getElementById("go");b.disabled=true;b.textContent="Добавляем…";' +
      'google.script.run.withSuccessHandler(done).withFailureHandler(function(e){' +
        'b.disabled=false;b.textContent="Добавить";err(e.message||"Ошибка связи");}).createUser(d);' +
    '}' +
    'function done(r){' +
      'if(!r||!r.ok){var b=document.getElementById("go");' +
        'if(b){b.disabled=false;b.textContent="Добавить";}err((r&&r.error)||"Не удалось");return;}' +
      'var h="<h3>Пользователь добавлен</h3>"+' +
        '"<p class=h>Передайте ему эти данные. Пароль хранится хешем — ' +
          'посмотреть его потом можно только на листе «Пароли (выдать)».</p>"+' +
        '"<div class=okbox><b>"+esc(r.fio)+"</b>"+' +
        '"<div class=kv><span>Логин</span><code>"+esc(r.login)+"</code></div>"+' +
        '"<div class=kv><span>Пароль</span><code>"+esc(r.password||"смотрите лист «Пароли (выдать)»")+"</code></div>"+' +
        '"<div class=kv><span>Код в справочнике</span><code>"+esc(r.personId||"—")+"</code></div>"+' +
        '(r.unit?"<div class=kv><span>Подразделение</span><span>"+esc(r.unit)+"</span></div>":"")+' +
        '"</div>";' +
      'if(r.notes&&r.notes.length){h+="<div class=warn>"+r.notes.map(esc).join("<br>")+"</div>";}' +
      'h+="<div class=act><button class=go onclick=google.script.host.close()>Готово</button></div>";' +
      'document.getElementById("app").innerHTML=h;' +
    '}' +
    '<\/script></body></html>';
}

// ─────────────────────────────────────────────────────────────
// ФОРМУЛЫ ВПР: диапазоны, которые не растут вместе со справочником
// ─────────────────────────────────────────────────────────────

/**
 * Ищет в формулах ссылки на «Справочник» с ограниченной последней строкой.
 * Такой диапазон перестаёт видеть новые строки: добавили Ч118 в 121-ю строку,
 * а формула смотрит до 120-й — имя не подтягивается, человек не попадает в учётки.
 *
 * Меняем только последнюю строку диапазона, начало не трогаем: оно обычно
 * пропускает шапку, и сдвигать его нельзя.
 */
function _найтиКороткиеДиапазоны_(targetRow) {
  const ref = _findSheet_(SH.REF);
  if (!ref) return { rows: [], refName: '' };
  const refName = ref.getName();

  // «Справочник»!$A$2:$B$120 и 'Справочник'!A2:B120 — обе формы
  const esc = refName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp("('?" + esc + "'?!\\$?[A-Z]{1,3}\\$?\\d+:\\$?[A-Z]{1,3}\\$?)(\\d+)", 'g');

  const out = [];
  [SH.PEOPLE, SH.DIV, SH.COMP, SH.SURVEY].forEach(function (name) {
    const sh = _findSheet_(name);
    if (!sh || sh.getLastRow() < 1) return;
    const lr = sh.getLastRow(), lc = Math.max(sh.getLastColumn(), 1);
    const fml = sh.getRange(1, 1, lr, lc).getFormulas();
    for (let r = 0; r < fml.length; r++) {
      for (let c = 0; c < fml[r].length; c++) {
        const f = fml[r][c];
        if (!f || f.indexOf(refName) < 0) continue;
        re.lastIndex = 0;
        let need = false;
        const fixed = f.replace(re, function (all, head, last) {
          if (Number(last) >= targetRow) return all;      // уже достаточно длинный
          need = true;
          return head + targetRow;
        });
        if (need) {
          out.push({ sheet: sh.getName(), row: r + 1, col: c + 1,
                     a1: _indexToLetter_(c) + (r + 1), before: f, after: fixed });
        }
      }
    }
  });
  return { rows: out, refName: refName };
}

/** Пункт меню: показать короткие диапазоны и предложить их удлинить. */
function проверитьФормулы() {
  const ui = SpreadsheetApp.getUi();
  const ref = _findSheet_(SH.REF);
  if (!ref) { ui.alert('Лист «' + SH.REF + '» не найден.'); return; }

  // Запас на вырост: текущая длина листа плюс место под новые строки
  const targetRow = Math.max(ref.getMaxRows(), ref.getLastRow() + 500, 1000);
  const found = _найтиКороткиеДиапазоны_(targetRow);

  if (!found.rows.length) {
    ui.alert('Формулы в порядке',
      'Ссылок на «' + found.refName + '» с коротким диапазоном не нашлось.\n\n' +
      'Новые строки справочника формулы увидят.', ui.ButtonSet.OK);
    return;
  }

  const bySheet = {};
  found.rows.forEach(function (x) { bySheet[x.sheet] = (bySheet[x.sheet] || 0) + 1; });

  const sample = found.rows.slice(0, 8).map(function (x) {
    return '  ' + x.sheet + ' ' + x.a1 + '\n    было:  ' + x.before.slice(0, 90) +
           '\n    станет: ' + x.after.slice(0, 90);
  }).join('\n');

  const res = ui.alert('Короткие диапазоны в формулах',
    'Найдено ячеек: ' + found.rows.length + '\n' +
    Object.keys(bySheet).map(function (s) { return '  • ' + s + ': ' + bySheet[s]; }).join('\n') +
    '\n\nПоследняя строка диапазона будет увеличена до ' + targetRow + '. ' +
    'Начало диапазона и всё остальное в формуле не меняется.\n\n' +
    'Примеры:\n' + sample +
    (found.rows.length > 8 ? '\n  … и ещё ' + (found.rows.length - 8) : '') +
    '\n\nПрименить?', ui.ButtonSet.YES_NO);
  if (res !== ui.Button.YES) return;

  let done = 0;
  found.rows.forEach(function (x) {
    try {
      _findSheet_(x.sheet).getRange(x.row, x.col).setFormula(x.after);
      done++;
    } catch (e) { /* одна ячейка не должна ломать весь проход */ }
  });
  SpreadsheetApp.flush();
  _log_('меню', 'формулы справочника', 'удлинено диапазонов: ' + done);

  ui.alert('Готово',
    'Изменено ячеек: ' + done + ' из ' + found.rows.length + '.\n\n' +
    'Теперь формулы видят новые строки справочника. ' +
    'Если что-то посчиталось не так — Файл → История версий → Восстановить.',
    ui.ButtonSet.OK);
}

// ─────────────────────────────────────────────────────────────
// ПЕРЕНОС СТРОК МЕЖДУ ПОДРАЗДЕЛЕНИЯМИ
// Нужен, когда «зонтичное» подразделение (сам департамент) заводили общим,
// а работу надо раздать по отделам.
// ─────────────────────────────────────────────────────────────

/** Пункт меню: окно переноса. */
function перенестиСтроки() {
  const html = HtmlService.createHtmlOutput(_окноПереноса_())
    .setWidth(560).setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(html, 'Перенести строки в другое подразделение');
}

/** Что сейчас привязано к каждому подразделению. Для окна переноса. */
function listMoveSource() {
  const divs = _valuesOpt_(SH.DIV);
  const dm = _divMap_(divs);
  const comp = _valuesOpt_(SH.COMP);
  const cm = _compMap_(comp);
  const surv = _valuesOpt_(SH.SURVEY);

  const cnt = {};
  for (let i = 1; i < comp.length; i++) {
    const u = _cell_(comp[i], cm, 'unit');
    if (!u) continue;
    if (!cnt[u]) cnt[u] = { comp: 0, surv: 0 };
    cnt[u].comp++;
  }
  for (let i = 1; i < surv.length; i++) {
    if (_str_(surv[i][V.STATE]) === 'удалена') continue;
    const u = _str_(surv[i][V.UNIT]);
    if (!u) continue;
    if (!cnt[u]) cnt[u] = { comp: 0, surv: 0 };
    cnt[u].surv++;
  }

  const units = [];
  const есть = {};
  for (let i = 1; i < divs.length; i++) {
    const u = _cell_(divs[i], dm, 'unit');
    if (!u) continue;
    есть[_normName_(u)] = true;
    const c = cnt[u] || { comp: 0, surv: 0 };
    units.push({ unit: u, dir: _cell_(divs[i], dm, 'dir'),
                 resp: _cell_(divs[i], dm, 'resp'), comp: c.comp, surv: c.surv });
  }
  units.sort(function (a, b) { return a.unit.localeCompare(b.unit, 'ru'); });

  // Сироты: названия, которые остались в строках, но из оргструктуры уже ушли.
  // Без них окно бесполезно — именно их и надо переносить, а в «Подразделениях» их нет.
  const orphans = [];
  Object.keys(cnt).forEach(function (u) {
    if (есть[_normName_(u)]) return;
    orphans.push({ unit: u, dir: '', resp: '', comp: cnt[u].comp, surv: cnt[u].surv });
  });
  orphans.sort(function (a, b) { return a.unit.localeCompare(b.unit, 'ru'); });

  return { units: units, orphans: orphans };
}

/**
 * Переносит строки «Конкурентов» и записи «Обзора рынка» из одного подразделения в другое.
 * data = { from, to, comp:true|false, surv:true|false }
 */
function moveUnitRows(data) {
  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(30000)) return { ok: false, error: 'Таблица занята, попробуйте ещё раз' };

    const from = _str_(data && data.from), to = _str_(data && data.to);
    if (!from || !to) return { ok: false, error: 'Выберите оба подразделения' };
    if (_normName_(from) === _normName_(to)) return { ok: false, error: 'Это одно и то же подразделение' };

    const meta = _unitMeta_(to);
    const unitId = _idПо_('units', to);
    const respId = meta.resp ? _idПо_('people', meta.resp) : '';
    const hrbpId = meta.hrbp ? _idПо_('people', meta.hrbp) : '';
    let movedComp = 0, movedSurv = 0;

    if (data.comp) {
      const sh = _sheet_(SH.COMP);
      const lr = sh.getLastRow(), width = Math.max(sh.getLastColumn(), 1);
      if (lr > 1) {
        const cm = _compMap_([sh.getRange(1, 1, 1, width).getValues()[0]]);
        const vals = sh.getRange(2, 1, lr - 1, width).getValues();
        const put = function (row, key, v) {
          const i = cm[key];
          if (i !== undefined && i >= 0 && i < row.length) row[i] = v;
        };
        for (let i = 0; i < vals.length; i++) {
          if (_normName_(_cell_(vals[i], cm, 'unit')) !== _normName_(from)) continue;
          // Пишем ID: имена рядом обычно формулы, они подтянутся сами
          put(vals[i], 'idUnit', unitId);
          put(vals[i], 'idResp', respId);
          put(vals[i], 'idHrbp', hrbpId);
          put(vals[i], 'unit', to);
          put(vals[i], 'dir', meta.dir);
          put(vals[i], 'resp', meta.resp);
          put(vals[i], 'hrbp', meta.hrbp);
          movedComp++;
        }
        if (movedComp) {
          // формулы не трогаем — пишем по колонкам
          ['idUnit', 'idResp', 'idHrbp', 'unit', 'dir', 'resp', 'hrbp'].forEach(function (key) {
            const c = cm[key];
            if (c === undefined || c < 0) return;
            _writeCol_(sh, c, 2, vals.length, function (i) { return vals[i][c]; });
          });
        }
      }
    }

    if (data.surv) {
      const sh = _sheet_(SH.SURVEY);
      const lr = sh.getLastRow();
      if (lr > 1) {
        const vals = sh.getRange(2, 1, lr - 1, SURVEY_COLS).getValues();
        for (let i = 0; i < vals.length; i++) {
          if (_normName_(_str_(vals[i][V.UNIT])) !== _normName_(from)) continue;
          vals[i][V.UNIT] = to;
          movedSurv++;
        }
        if (movedSurv) {
          _writeCol_(sh, V.UNIT, 2, vals.length, function (i) { return vals[i][V.UNIT]; });
        }
      }
    }

    SpreadsheetApp.flush();
    пересчитатьСтатусы_(true);
    _log_('меню', 'перенос строк',
      from + ' → ' + to + ' | конкурентов: ' + movedComp + ', записей обзора: ' + movedSurv);

    return { ok: true, from: from, to: to, comp: movedComp, surv: movedSurv };
  } catch (e) {
    return { ok: false, error: 'Ошибка: ' + e.message };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Разметка окна переноса. */
function _окноПереноса_() {
  return '<!DOCTYPE html><html><head><base target="_top"><style>' +
    'body{font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;' +
      'margin:0;padding:16px;color:#16202a}' +
    'h3{margin:0 0 4px;font-size:15px}p.h{color:#66737f;margin:0 0 14px;font-size:13px;line-height:1.4}' +
    'label.f{display:block;font-size:12.5px;color:#66737f;font-weight:600;margin:12px 0 5px}' +
    'select{font:inherit;width:100%;padding:9px 10px;border:1px solid #e2e6ea;border-radius:9px;' +
      'box-sizing:border-box;background:#fff}' +
    '.box{border:1px solid #e2e6ea;border-radius:10px;padding:12px;margin:14px 0}' +
    '.box label{display:flex;gap:10px;align-items:flex-start;margin-bottom:10px;cursor:pointer}' +
    '.box label:last-child{margin-bottom:0}' +
    '.warn{background:#fdf3e0;color:#8a5a00;border-radius:8px;padding:10px 12px;font-size:12.5px;' +
      'line-height:1.45;margin:12px 0}' +
    '.err{background:#fdecea;color:#c0392b;border-radius:8px;padding:10px 12px;font-size:13px;margin:12px 0}' +
    '.ok{background:#e3f5ea;border:1px solid #1a7f4b;border-radius:10px;padding:14px;margin:6px 0}' +
    '.act{display:flex;gap:10px;margin-top:18px}' +
    'button{font:inherit;flex:1;min-height:40px;border-radius:9px;border:1px solid #e2e6ea;' +
      'background:#fff;cursor:pointer}' +
    'button.go{background:#1f6feb;border-color:#1f6feb;color:#fff;font-weight:600}' +
    'button:disabled{opacity:.5;cursor:default}' +
    '</style></head><body><div id="app">Загрузка…</div><script>' +
    'var D=null;' +
    'google.script.run.withSuccessHandler(function(d){D=d;draw();}).listMoveSource();' +
    'function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){' +
      'return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}' +
    'function opt(u){var t=u.unit+" — конкурентов "+u.comp+", записей "+u.surv;' +
      'return "<option value=\\""+esc(u.unit)+"\\">"+esc(t)+"</option>";}' +
    'function opts(){return D.units.map(opt).join("");}' +
    // «Откуда» — сначала сироты: их нет в оргструктуре, но строки на них висят
    'function optsFrom(){var o=(D.orphans||[]);var h="";' +
      'if(o.length)h+="<optgroup label=\\"Строки-сироты — подразделения нет в оргструктуре\\">"+' +
        'o.map(opt).join("")+"</optgroup>";' +
      'h+="<optgroup label=\\"Подразделения\\">"+opts()+"</optgroup>";return h;}' +
    'function draw(){' +
      'var h="<h3>Перенести строки</h3><p class=h>Строки «Конкурентов» и записи «Обзора рынка» ' +
        'сменят подразделение. Сами строки не удаляются.</p><div id=err></div>";' +
      'h+="<label class=f>Откуда</label><select id=from>"+optsFrom()+"</select>";' +
      'h+="<label class=f>Куда</label><select id=to>"+opts()+"</select>";' +
      'if((D.orphans||[]).length)h+="<div class=warn>Сирот в списке «Откуда»: "+D.orphans.length+' +
        '". Это названия, которых больше нет в «Подразделениях» — строки на них висят, ' +
        'но в форме их никто не видит.</div>";' +
      'h+="<div class=box><label><input type=checkbox id=cC checked><span><b>Строки «Конкурентов»</b>' +
        '<br><small>подразделение, направление, ответственный, HR BP</small></span></label>"+' +
        '"<label><input type=checkbox id=cS checked><span><b>Записи «Обзора рынка»</b>' +
        '<br><small>оклады, бонусы, льготы</small></span></label></div>";' +
      'h+="<div class=warn>Отменить можно только через Файл → История версий. ' +
        'Перед переносом убедитесь, что выбрали верное подразделение.</div>";' +
      'h+="<div class=act><button onclick=google.script.host.close()>Отмена</button>"+' +
        '"<button class=go id=go onclick=go()>Перенести</button></div>";' +
      'document.getElementById("app").innerHTML=h;' +
    '}' +
    'function err(m){document.getElementById("err").innerHTML="<div class=err>"+esc(m)+"</div>";}' +
    'function go(){' +
      'var d={from:document.getElementById("from").value,to:document.getElementById("to").value,' +
        'comp:document.getElementById("cC").checked,surv:document.getElementById("cS").checked};' +
      'if(d.from===d.to){err("Выбрано одно и то же подразделение");return;}' +
      'if(!d.comp&&!d.surv){err("Отметьте, что переносить");return;}' +
      'var b=document.getElementById("go");b.disabled=true;b.textContent="Переносим…";' +
      'google.script.run.withSuccessHandler(done).withFailureHandler(function(e){' +
        'b.disabled=false;b.textContent="Перенести";err(e.message||"Ошибка");}).moveUnitRows(d);' +
    '}' +
    'function done(r){' +
      'if(!r||!r.ok){var b=document.getElementById("go");if(b){b.disabled=false;b.textContent="Перенести";}' +
        'err((r&&r.error)||"Не удалось");return;}' +
      'document.getElementById("app").innerHTML="<h3>Перенесено</h3>"+' +
        '"<div class=ok><b>"+esc(r.from)+"</b> → <b>"+esc(r.to)+"</b><br><br>"+' +
        '"строк «Конкурентов»: "+r.comp+"<br>записей «Обзора рынка»: "+r.surv+"</div>"+' +
        '"<div class=act><button class=go onclick=google.script.host.close()>Готово</button></div>";' +
    '}' +
    '<\/script></body></html>';
}

// ─────────────────────────────────────────────────────────────
// ЗАГРУЗКА НОВОЙ ОРГСТРУКТУРЫ
//
// Структуру присылают выгрузкой из кадровой системы: одна колонка с именем,
// вложенность показана тире в начале строки, рядом руководитель и HR BP.
// Задача — заменить оргструктуру, ничего при этом не потеряв:
//   • у подразделения, которое просто переименовали, ID обязан остаться прежним,
//     иначе отвалятся 717 строк конкурентов и вся штатка;
//   • ответственный, которого уже назначили, остаётся назначенным;
//   • то, чего в новой структуре нет, не удаляется, а уезжает в «Архив»,
//     откуда возвращается одной кнопкой.
//
// Порядок строк: сначала подразделения без руководителя — их надо разобрать
// в первую очередь, поэтому им место сразу под шапкой.
// ─────────────────────────────────────────────────────────────

const SH_NEWDIV = 'Новая структура';
const SH_ARCH   = 'Архив';

/** Пункт меню: окно загрузки. */
function загрузитьСтруктуру() {
  const html = HtmlService.createHtmlOutput(_окноСтруктуры_())
    .setWidth(820).setHeight(640);
  SpreadsheetApp.getUi().showModalDialog(html, 'Загрузить новую оргструктуру');
}

/** Создаёт лист для вставки структуры и подсказывает формат. */
function подготовитьЛистСтруктуры() {
  const ss = _ss_();
  let sh = _findSheet_(SH_NEWDIV);
  if (!sh) {
    sh = ss.insertSheet(SH_NEWDIV);
    sh.getRange(1, 1, 1, 3).setValues([['Наименование подразделения', 'Руководитель', 'HR BP']])
      .setFontWeight('bold').setBackground('#fce8b2');
    sh.setColumnWidth(1, 420);
    sh.setColumnWidth(2, 260);
    sh.setColumnWidth(3, 260);
    sh.setFrozenRows(1);
  }
  ss.setActiveSheet(sh);
  SpreadsheetApp.getUi().alert('Лист готов',
    'Вставьте структуру на лист «' + SH_NEWDIV + '», начиная со строки 2.\n\n' +
    'Первая колонка — название с тире в начале: одно тире — уровень 1, два — уровень 2 и так далее. ' +
    'Строка без тире — самый верх.\n' +
    'Вторая колонка — руководитель, третья — HR BP.\n\n' +
    'Потом снова откройте «Загрузить новую оргструктуру».',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Разбирает лист «Новая структура» в плоский список с уровнями и направлением. */
function _разобратьНовуюСтруктуру_() {
  const rows = _valuesOpt_(SH_NEWDIV);
  if (rows.length < 2) return { ok: false, error: 'Лист «' + SH_NEWDIV + '» пуст или не найден' };

  const out = [];
  const stack = [];                       // stack[уровень] = имя подразделения
  for (let i = 1; i < rows.length; i++) {
    let raw = _str_(rows[i][0]);
    if (!raw) continue;
    let lvl = 0;
    // тире бывают разные: длинное, среднее, минус — считаем любое
    while (lvl < raw.length && (raw[lvl] === '\u2014' || raw[lvl] === '\u2013' || raw[lvl] === '-')) lvl++;
    const name = _str_(raw.slice(lvl));
    if (!name) continue;

    stack[lvl] = name;
    stack.length = lvl + 1;
    // направление — предок первого уровня; для верхушки направление = сам себе
    const dir = lvl === 0 ? name : (stack[1] || name);

    out.push({
      name: name, level: lvl, dir: dir,
      head: _str_(rows[i][1]), hrbp: _str_(rows[i][2])
    });
  }
  if (!out.length) return { ok: false, error: 'В листе «' + SH_NEWDIV + '» не нашлось ни одной строки' };
  return { ok: true, list: out };
}

/**
 * Ключ сопоставления: без цифрового префикса, подчёркиваний и кавычек.
 * «0207 Отдел логистики продаж Худжанд» и «Отдел логистики продаж Худжанд» —
 * это одно подразделение, у которого поменялось написание, а не два разных.
 */
function _ключПодр_(name) {
  let t = _normName_(name);
  if (!t) return '';
  t = t.replace(/^\d+\s+/, '');
  t = t.replace(/[_\u00ab\u00bb"'`.,()\-]/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** Что произойдёт при загрузке. Ничего не меняет. */
function listStructure() {
  const parsed = _разобратьНовуюСтруктуру_();
  if (!parsed.ok) return parsed;

  const divs = _valuesOpt_(SH.DIV);
  const dm = _divMap_(divs);
  const comp = _valuesOpt_(SH.COMP);
  const cm = _compMap_(comp);
  const pos = _valuesOpt_(SH.POS);

  const compCnt = {}, posCnt = {};
  for (let i = 1; i < comp.length; i++) {
    const u = _normName_(_cell_(comp[i], cm, 'unit'));
    if (u) compCnt[u] = (compCnt[u] || 0) + 1;
  }
  for (let i = 1; i < pos.length; i++) {
    const u = _normName_(_str_(pos[i][4]));
    if (u) posCnt[u] = (posCnt[u] || 0) + 1;
  }

  // что сейчас в таблице
  const cur = [];
  const byNorm = {}, byKey = {};
  for (let i = 1; i < divs.length; i++) {
    const u = _cell_(divs[i], dm, 'unit');
    if (!u) continue;
    const rec = {
      row: i + 1, unit: u, id: _cell_(divs[i], dm, 'idUnit'),
      resp: _cell_(divs[i], dm, 'resp'), head: _cell_(divs[i], dm, 'head')
    };
    cur.push(rec);
    byNorm[_normName_(u)] = rec;
    const k = _ключПодр_(u);
    if (k && !byKey[k]) byKey[k] = rec;
  }

  const same = [], renamed = [], added = [];
  const usedRows = {};
  parsed.list.forEach(function (n) {
    const hit = byNorm[_normName_(n.name)] || byKey[_ключПодр_(n.name)];
    if (hit && !usedRows[hit.row]) {
      usedRows[hit.row] = true;
      n.oldUnit = hit.unit;
      n.id = hit.id;
      n.resp = hit.resp;
      if (_normName_(hit.unit) === _normName_(n.name)) same.push(n);
      else renamed.push(n);
    } else {
      added.push(n);
    }
  });

  const archived = cur.filter(function (r) { return !usedRows[r.row]; }).map(function (r) {
    return { unit: r.unit, id: r.id, resp: r.resp,
             comp: compCnt[_normName_(r.unit)] || 0,
             pos: posCnt[_normName_(r.unit)] || 0 };
  });

  return {
    ok: true,
    total: parsed.list.length,
    same: same.length,
    renamed: renamed.map(function (n) { return { from: n.oldUnit, to: n.name, id: n.id,
                                                 comp: compCnt[_normName_(n.oldUnit)] || 0 }; }),
    added: added.map(function (n) { return { unit: n.name, level: n.level, head: n.head }; }),
    archived: archived,
    keepResp: parsed.list.filter(function (n) { return n.resp; }).length
  };
}

/**
 * Применяет структуру. opts = { archive: true|false }
 * archive=false — подразделения, которых нет в новой структуре, остаются на месте.
 */
function applyStructure(opts) {
  const lock = LockService.getScriptLock();
  const props = PropertiesService.getScriptProperties();
  try {
    if (!lock.tryLock(60000)) return { ok: false, error: 'Таблица занята, попробуйте ещё раз' };
    const parsed = _разобратьНовуюСтруктуру_();
    if (!parsed.ok) return parsed;

    props.setProperty('SYNC_BUSY', '1');
    props.setProperty('SYNC_AT', String(Date.now()));

    const plan = listStructure();
    if (!plan.ok) return plan;

    // ── 1. переименования расходятся по всем листам, где имя записано текстом ──
    const renames = {};
    plan.renamed.forEach(function (r) { renames[_normName_(r.from)] = r.to; });
    let touched = 0;
    if (plan.renamed.length) touched = _переименоватьВезде_(renames);

    // ── 2. архив ──
    let archived = 0;
    if (opts && opts.archive && plan.archived.length) {
      archived = _вАрхив_(plan.archived.map(function (a) { return a.unit; }));
    }

    // ── 3. сама оргструктура ──
    const sh = _sheet_(SH.DIV, true);
    const width = Math.max(sh.getLastColumn(), 14);
    const header = sh.getRange(1, 1, 1, width).getValues()[0];
    const dm = _colmap_(header, DIV_SPEC, DIV_FALLBACK, ['unit']);

    // прежние ответственные — по имени подразделения уже после переименования
    const prev = {};
    const old = _valuesOpt_(SH.DIV);
    const odm = _divMap_(old);
    for (let i = 1; i < old.length; i++) {
      const u = _cell_(old[i], odm, 'unit');
      if (!u) continue;
      prev[_normName_(u)] = {
        resp: _cell_(old[i], odm, 'resp'),
        idResp: _cell_(old[i], odm, 'idResp')
      };
    }

    // ID для всех направлений, подразделений и людей — тремя обращениями к листу
    const дир = [], подр = [], люди = [];
    parsed.list.forEach(function (n) {
      дир.push(n.dir);
      подр.push(n.name);
      if (n.head) люди.push(n.head);
      if (n.hrbp) люди.push(n.hrbp);
    });
    const idДир = _добавитьМного_('dirs', дир);
    const idПодр = _добавитьМного_('units', подр);
    const idЛюди = _добавитьМного_('people', люди);

    // порядок: сначала без руководителя, дальше как в структуре
    const list = parsed.list.slice();
    list.forEach(function (n, i) { n.__i = i; });
    list.sort(function (a, b) {
      const wa = a.head ? 1 : 0, wb = b.head ? 1 : 0;
      if (wa !== wb) return wa - wb;
      return a.__i - b.__i;
    });

    const rows = [];
    list.forEach(function (n, i) {
      const p = prev[_normName_(n.name)] || {};
      const row = new Array(width).fill('');
      const put = function (key, v) {
        const c = dm[key];
        if (c !== undefined && c >= 0 && c < width) row[c] = v;
      };
      put('num', i + 1);
      put('idDir', idДир[_normName_(n.dir)] || '');
      put('dir', n.dir);
      put('idUnit', idПодр[_normName_(n.name)] || '');
      put('unit', n.name);
      put('level', n.level);
      put('idHead', n.head ? (idЛюди[_normName_(n.head)] || '') : '');
      put('head', n.head);
      put('idResp', p.idResp || '');
      put('resp', p.resp || '');
      put('idHrbp', n.hrbp ? (idЛюди[_normName_(n.hrbp)] || '') : '');
      put('hrbp', n.hrbp);
      rows.push(row);
    });

    // чистим старое тело листа и пишем новое
    const lastRow = sh.getLastRow();
    if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, width).clearContent();
    if (sh.getMaxRows() < rows.length + 1) {
      sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows());
    }
    if (rows.length) sh.getRange(2, 1, rows.length, width).setValues(rows);

    SpreadsheetApp.flush();
    _сброситьСправочник_();
    _создатьПользователей_(false);
    пересчитатьСтатусы_(true);
    SpreadsheetApp.flush();

    _log_('меню', 'загрузка оргструктуры',
      'стало подразделений: ' + rows.length + ', переименовано: ' + plan.renamed.length +
      ', добавлено: ' + plan.added.length + ', в архив: ' + archived +
      ', строк поправлено: ' + touched);

    return { ok: true, total: rows.length, renamed: plan.renamed.length,
             added: plan.added.length, archived: archived, touched: touched };
  } catch (e) {
    return { ok: false, error: 'Ошибка: ' + e.message };
  } finally {
    props.deleteProperty('SYNC_BUSY');
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * Меняет название подразделения во всех листах, где оно записано текстом.
 * ID не трогаем — он и не менялся, в этом весь смысл переименования.
 */
function _переименоватьВезде_(renames) {
  let touched = 0;
  const места = [
    { sheet: SH.COMP,   col: null, spec: 'comp' },
    { sheet: SH.PEOPLE, col: 6 },                 // G Подразделение
    { sheet: SH.POS,    col: 4 },                 // E Подразделение
    { sheet: SH.STATUS, col: 0 },                 // A Подразделение
    { sheet: SH.SURVEY, col: 1 },                 // B Подразделение
    { sheet: SH.NEED,   col: 1 }
  ];

  места.forEach(function (m) {
    const sh = _findSheet_(m.sheet);
    if (!sh) return;
    const lr = sh.getLastRow();
    if (lr < 2) return;
    const width = Math.max(sh.getLastColumn(), 1);

    let col = m.col;
    if (m.spec === 'comp') {
      const cm = _compMap_([sh.getRange(1, 1, 1, width).getValues()[0]]);
      col = cm.unit;
    }
    if (col === undefined || col === null || col < 0) return;

    const rng = sh.getRange(2, col + 1, lr - 1, 1);
    const vals = rng.getValues();
    const fml = rng.getFormulas();
    let changed = false;
    for (let i = 0; i < vals.length; i++) {
      if (fml[i][0]) continue;                     // формула сама подтянет новое имя
      const k = _normName_(vals[i][0]);
      if (k && renames[k]) { vals[i][0] = renames[k]; changed = true; touched++; }
    }
    if (changed) rng.setValues(vals);
  });

  // и в самом справочнике — блок подразделений
  const ref = _findSheet_(SH.REF);
  if (ref) {
    const lc = Math.max(ref.getLastColumn(), 1);
    const p = _позицииБлоков_(ref.getRange(1, 1, 1, lc).getValues()[0])['units'];
    if (p && p.name >= 0) {
      const lr = ref.getLastRow();
      if (lr > 1) {
        const rng = ref.getRange(2, p.name + 1, lr - 1, 1);
        const vals = rng.getValues();
        let changed = false;
        for (let i = 0; i < vals.length; i++) {
          const k = _normName_(vals[i][0]);
          if (k && renames[k]) { vals[i][0] = renames[k]; changed = true; touched++; }
        }
        if (changed) rng.setValues(vals);
      }
    }
  }
  return touched;
}

/** Уводит подразделения в «Архив» вместе со штаткой. Строки не удаляются. */
function _вАрхив_(units) {
  if (!units || !units.length) return 0;
  const ss = _ss_();
  let arch = _findSheet_(SH_ARCH);
  if (!arch) {
    arch = ss.insertSheet(SH_ARCH);
    arch.getRange(1, 1, 1, 6).setValues([['Что', 'Название', 'Подробности', 'Строк конкурентов', 'Должностей', 'Когда']])
      .setFontWeight('bold').setBackground('#fce8b2');
    arch.setFrozenRows(1);
    arch.setColumnWidth(2, 340);
    arch.setColumnWidth(3, 420);
  }

  const comp = _valuesOpt_(SH.COMP);
  const cm = _compMap_(comp);
  const pos = _valuesOpt_(SH.POS);

  const now = _дата_(new Date(), true);
  const add = [];
  const посл = _sheet_(SH.POS);
  const убрать = {};

  units.forEach(function (u) {
    const k = _normName_(u);
    let nc = 0;
    for (let i = 1; i < comp.length; i++) {
      if (_normName_(_cell_(comp[i], cm, 'unit')) === k) nc++;
    }
    const должности = [];
    for (let i = 1; i < pos.length; i++) {
      if (_normName_(_str_(pos[i][4])) === k) { должности.push(_str_(pos[i][2])); убрать[i + 1] = true; }
    }
    add.push(['подразделение', u, должности.join('; '), nc, должности.length, now]);
  });

  if (add.length) arch.getRange(arch.getLastRow() + 1, 1, add.length, 6).setValues(add);

  // должности архивных подразделений убираем из штатки — иначе Шаг 2 их показывает
  const строки = Object.keys(убрать).map(Number).sort(function (a, b) { return b - a; });
  строки.forEach(function (r) { посл.deleteRow(r); });

  return add.length;
}

/** Пункт меню: вернуть подразделение из архива. */
function вернутьИзАрхива() {
  const arch = _findSheet_(SH_ARCH);
  if (!arch || arch.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('Архив пуст', 'Возвращать нечего.', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }
  const html = HtmlService.createHtmlOutput(_окноАрхива_())
    .setWidth(700).setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, 'Вернуть из архива');
}

/** Содержимое архива для окна. */
function listArchive() {
  const arch = _findSheet_(SH_ARCH);
  if (!arch || arch.getLastRow() < 2) return { rows: [] };
  const vals = arch.getRange(2, 1, arch.getLastRow() - 1, 6).getValues();
  const rows = [];
  for (let i = 0; i < vals.length; i++) {
    if (!_str_(vals[i][1])) continue;
    rows.push({ row: i + 2, unit: _str_(vals[i][1]), posList: _str_(vals[i][2]),
                comp: vals[i][3], pos: vals[i][4], when: _str_(vals[i][5]) });
  }
  return { rows: rows };
}

/** Возвращает подразделение в оргструктуру и штатку. rows = [номера строк архива] */
function restoreArchive(rows) {
  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(30000)) return { ok: false, error: 'Таблица занята' };
    if (!rows || !rows.length) return { ok: false, error: 'Ничего не выбрано' };

    const arch = _sheet_(SH_ARCH);
    const div = _sheet_(SH.DIV, true);
    const width = Math.max(div.getLastColumn(), 14);
    const dm = _colmap_(div.getRange(1, 1, 1, width).getValues()[0], DIV_SPEC, DIV_FALLBACK, ['unit']);
    const посл = _sheet_(SH.POS, true);

    let вернули = 0, должностей = 0;
    const убрать = [];

    rows.forEach(function (r) {
      const v = arch.getRange(r, 1, 1, 6).getValues()[0];
      const unit = _str_(v[1]);
      if (!unit) return;

      // в оргструктуру — наверх, как подразделение без руководителя
      div.insertRowsAfter(1, 1);
      const row = new Array(width).fill('');
      const put = function (key, val) {
        const c = dm[key];
        if (c !== undefined && c >= 0 && c < width) row[c] = val;
      };
      put('idUnit', _добавитьВСправочник_('units', unit));
      put('unit', unit);
      put('dir', unit);
      put('level', 1);
      div.getRange(2, 1, 1, width).setValues([row]);

      // штатка
      const список = _str_(v[2]).split(';').map(function (s) { return s.trim(); }).filter(String);
      if (список.length) {
        const start = посл.getLastRow() + 1;
        const данные = список.map(function (d, i) {
          return [start + i - 1, _добавитьВСправочник_('positions', d) || '', d, _идПо_('units', unit), unit];
        });
        посл.getRange(start, 1, данные.length, 5).setValues(данные);
        должностей += данные.length;
      }
      убрать.push(r);
      вернули++;
    });

    убрать.sort(function (a, b) { return b - a; }).forEach(function (r) { arch.deleteRow(r); });

    SpreadsheetApp.flush();
    _сброситьСправочник_();
    пересчитатьСтатусы_(true);
    _log_('меню', 'возврат из архива', 'подразделений: ' + вернули + ', должностей: ' + должностей);

    return { ok: true, count: вернули, pos: должностей };
  } catch (e) {
    return { ok: false, error: 'Ошибка: ' + e.message };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Разметка окна загрузки структуры. */
function _окноСтруктуры_() {
  return '<!DOCTYPE html><html><head><base target="_top"><meta charset="utf-8"><style>' +
    'body{font:13.5px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;' +
      'margin:0;padding:16px;color:#16202a}' +
    'h3{margin:0 0 4px;font-size:15px}p.h{color:#66737f;margin:0 0 14px;font-size:12.5px;line-height:1.45}' +
    '.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0}' +
    '.box{border:1px solid #e2e6ea;border-radius:10px;padding:12px}' +
    '.box b{display:block;font-size:22px;line-height:1.1;margin-bottom:2px}' +
    '.box span{color:#66737f;font-size:12px}' +
    '.list{max-height:190px;overflow:auto;border:1px solid #e2e6ea;border-radius:10px;padding:10px;' +
      'font-size:12.5px;margin-bottom:12px}' +
    '.list div{padding:2px 0;border-bottom:1px solid #f4f6f8}' +
    '.warn{background:#fdf3e0;color:#8a5a00;border-radius:8px;padding:11px 13px;font-size:12.5px;line-height:1.5}' +
    '.err{background:#fdecea;color:#c0392b;border-radius:8px;padding:10px 12px;margin:10px 0}' +
    '.ok{background:#e3f5ea;border:1px solid #1a7f4b;border-radius:10px;padding:14px;margin:6px 0}' +
    'label.chk{display:flex;gap:8px;align-items:flex-start;margin:12px 0}' +
    '.act{display:flex;gap:10px;margin-top:16px}' +
    'button{font:inherit;flex:1;min-height:42px;border-radius:9px;border:1px solid #e2e6ea;' +
      'background:#fff;cursor:pointer}' +
    'button.go{background:#1f6feb;border-color:#1f6feb;color:#fff;font-weight:600}' +
    'button:disabled{opacity:.5;cursor:default}' +
    '</style></head><body><div id="app">Читаем лист «Новая структура»…</div><script>' +
    'var P=null;' +
    'google.script.run.withSuccessHandler(function(d){P=d;draw();})' +
      '.withFailureHandler(function(e){document.getElementById("app").innerHTML=' +
      '"<div class=err>"+(e.message||"Ошибка")+"</div>";}).listStructure();' +
    'function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){' +
      'return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}' +
    'function draw(){' +
      'if(!P||!P.ok){' +
        'document.getElementById("app").innerHTML="<h3>Не получилось</h3><div class=err>"+' +
          'esc((P&&P.error)||"Лист не найден")+"</div>"+' +
          '"<p class=h>Нажмите кнопку ниже — создам лист и покажу формат.</p>"+' +
          '"<div class=act><button onclick=google.script.host.close()>Отмена</button>"+' +
          '"<button class=go onclick=prep()>Создать лист «Новая структура»</button></div>";' +
        'return;}' +
      'var h="<h3>Что произойдёт</h3><p class=h>Пока ничего не изменено. Ниже — что даст загрузка.</p>";' +
      'h+="<div class=grid>"+' +
        '"<div class=box><b>"+P.total+"</b><span>подразделений станет всего</span></div>"+' +
        '"<div class=box><b>"+P.added.length+"</b><span>добавится новых</span></div>"+' +
        '"<div class=box><b>"+P.renamed.length+"</b><span>переименуется, ID сохранится</span></div>"+' +
        '"<div class=box><b>"+P.archived.length+"</b><span>уйдёт в архив</span></div></div>";' +
      'if(P.renamed.length){' +
        'h+="<b style=\\"font-size:13px\\">Переименования</b><div class=list>"+' +
          'P.renamed.map(function(r){return "<div>"+esc(r.from)+" → <b>"+esc(r.to)+"</b>"+' +
            '(r.comp?" · строк конкурентов "+r.comp:"")+"</div>";}).join("")+"</div>";}' +
      'if(P.archived.length){' +
        'h+="<b style=\\"font-size:13px\\">В архив</b><div class=list>"+' +
          'P.archived.map(function(a){return "<div>"+esc(a.unit)+' +
            '" · конкурентов "+a.comp+" · должностей "+a.pos+"</div>";}).join("")+"</div>";}' +
      'h+="<label class=chk><input type=checkbox id=arch checked><span>Убрать в архив то, чего нет в новой структуре. ' +
        'Вернуть можно пунктом меню «Вернуть из архива». Снимите галочку — эти подразделения останутся на месте.</span></label>";' +
      'h+="<div class=warn>Ответственные, которых уже назначили, сохранятся. ' +
        'Подразделения без руководителя встанут первыми строками под шапкой. ' +
        'Отменить целиком можно через Файл → История версий.</div>";' +
      'h+="<div id=err></div><div class=act><button onclick=google.script.host.close()>Отмена</button>"+' +
        '"<button class=go id=go onclick=run()>Загрузить структуру</button></div>";' +
      'document.getElementById("app").innerHTML=h;' +
    '}' +
    'function prep(){google.script.run.withSuccessHandler(function(){google.script.host.close();})' +
      '.подготовитьЛистСтруктуры();}' +
    'function run(){' +
      'var b=document.getElementById("go");b.disabled=true;b.textContent="Загружаем, это долго…";' +
      'google.script.run.withSuccessHandler(done).withFailureHandler(function(e){' +
        'b.disabled=false;b.textContent="Загрузить структуру";' +
        'document.getElementById("err").innerHTML="<div class=err>"+esc(e.message||"Ошибка")+"</div>";})' +
        '.applyStructure({archive:document.getElementById("arch").checked});' +
    '}' +
    'function done(r){' +
      'if(!r||!r.ok){var b=document.getElementById("go");if(b){b.disabled=false;b.textContent="Загрузить структуру";}' +
        'document.getElementById("err").innerHTML="<div class=err>"+esc((r&&r.error)||"Не удалось")+"</div>";return;}' +
      'document.getElementById("app").innerHTML="<h3>Структура загружена</h3><div class=ok>"+' +
        '"подразделений: "+r.total+"<br>переименовано: "+r.renamed+"<br>добавлено: "+r.added+' +
        '"<br>в архив: "+r.archived+"<br>строк поправлено в других листах: "+r.touched+' +
        '"<br><br>Учётки и статусы пересчитаны. Дальше — «Назначить ответственных…».</div>"+' +
        '"<div class=act><button class=go onclick=google.script.host.close()>Закрыть</button></div>";' +
    '}' +
    '<\/script></body></html>';
}

/** Разметка окна возврата из архива. */
function _окноАрхива_() {
  return '<!DOCTYPE html><html><head><base target="_top"><meta charset="utf-8"><style>' +
    'body{font:13.5px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;' +
      'margin:0;padding:16px;color:#16202a}' +
    'h3{margin:0 0 4px;font-size:15px}p.h{color:#66737f;margin:0 0 12px;font-size:12.5px}' +
    'table{border-collapse:collapse;width:100%;font-size:13px}' +
    'th{text-align:left;color:#66737f;font-size:12px;padding:6px 8px;border-bottom:1px solid #e2e6ea}' +
    'td{padding:6px 8px;border-bottom:1px solid #f4f6f8}' +
    '.wrap{max-height:380px;overflow:auto;border:1px solid #e2e6ea;border-radius:10px}' +
    '.act{display:flex;gap:10px;margin-top:14px}' +
    'button{font:inherit;flex:1;min-height:42px;border-radius:9px;border:1px solid #e2e6ea;background:#fff;cursor:pointer}' +
    'button.go{background:#1f6feb;border-color:#1f6feb;color:#fff;font-weight:600}' +
    'button:disabled{opacity:.5}' +
    '.err{background:#fdecea;color:#c0392b;border-radius:8px;padding:10px 12px;margin:10px 0}' +
    '.ok{background:#e3f5ea;border:1px solid #1a7f4b;border-radius:10px;padding:14px}' +
    '</style></head><body><div id="app">Загрузка…</div><script>' +
    'var A=null;' +
    'google.script.run.withSuccessHandler(function(d){A=d;draw();}).listArchive();' +
    'function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){' +
      'return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}' +
    'function draw(){' +
      'var h="<h3>Вернуть из архива</h3><p class=h>Отметьте, что вернуть. Подразделение встанет первой строкой ' +
        'оргструктуры, должности вернутся в штатку.</p>";' +
      'h+="<div class=wrap><table><thead><tr><th style=\\"width:34px\\"></th><th>Подразделение</th>"+' +
        '"<th>Конкурентов</th><th>Должностей</th><th>Когда убрали</th></tr></thead><tbody>";' +
      'h+=A.rows.map(function(r){return "<tr><td><input type=checkbox value=\\""+r.row+"\\"></td>"+' +
        '"<td>"+esc(r.unit)+"</td><td>"+r.comp+"</td><td>"+r.pos+"</td><td>"+esc(r.when)+"</td></tr>";}).join("");' +
      'h+="</tbody></table></div><div id=err></div>";' +
      'h+="<div class=act><button onclick=google.script.host.close()>Закрыть</button>"+' +
        '"<button class=go id=go onclick=run()>Вернуть отмеченные</button></div>";' +
      'document.getElementById("app").innerHTML=h;' +
    '}' +
    'function run(){' +
      'var rows=[],ins=document.querySelectorAll("input[type=checkbox]");' +
      'for(var i=0;i<ins.length;i++) if(ins[i].checked) rows.push(Number(ins[i].value));' +
      'if(!rows.length){document.getElementById("err").innerHTML="<div class=err>Ничего не отмечено</div>";return;}' +
      'var b=document.getElementById("go");b.disabled=true;b.textContent="Возвращаем…";' +
      'google.script.run.withSuccessHandler(done).withFailureHandler(function(e){' +
        'b.disabled=false;b.textContent="Вернуть отмеченные";' +
        'document.getElementById("err").innerHTML="<div class=err>"+esc(e.message||"Ошибка")+"</div>";})' +
        '.restoreArchive(rows);' +
    '}' +
    'function done(r){' +
      'if(!r||!r.ok){var b=document.getElementById("go");if(b){b.disabled=false;b.textContent="Вернуть отмеченные";}' +
        'document.getElementById("err").innerHTML="<div class=err>"+esc((r&&r.error)||"Не удалось")+"</div>";return;}' +
      'document.getElementById("app").innerHTML="<h3>Готово</h3><div class=ok>вернулось подразделений: "+r.count+' +
        '"<br>должностей: "+r.pos+"</div><div class=act><button class=go onclick=google.script.host.close()>Закрыть</button></div>";' +
    '}' +
    '<\/script></body></html>';
}

// ─────────────────────────────────────────────────────────────
// НАЗНАЧИТЬ ОТВЕТСТВЕННЫХ
// Спуск ответственности умеет только то, что выводится из таблицы:
// у отдела есть свой руководитель — он и становится ответственным.
// Здесь наоборот: человека выбирают руками из справочника. Нужно там,
// где руководитель дивизиона данные собирать не будет, а кандидата
// знает только HR — начальник цеха, инженер, кто-то из участников опроса.
// ─────────────────────────────────────────────────────────────

/** Пункт меню: окно назначения. */
function назначитьОтветственных() {
  const html = HtmlService.createHtmlOutput(_окноНазначения_())
    .setWidth(860).setHeight(660);
  SpreadsheetApp.getUi().showModalDialog(html, 'Назначить ответственных за обзор рынка');
}

/** Подразделения и список людей для выпадающего списка. Ничего не меняет. */
function listAssign() {
  const divs = _valuesOpt_(SH.DIV);
  const dm = _divMap_(divs);
  const comp = _valuesOpt_(SH.COMP);
  const cm = _compMap_(comp);

  const cnt = {};
  for (let i = 1; i < comp.length; i++) {
    const u = _cell_(comp[i], cm, 'unit');
    if (u) cnt[_normName_(u)] = (cnt[_normName_(u)] || 0) + 1;
  }

  // сколько подразделений тянет каждый ответственный — по этому видно «зонтики»
  const load = {};
  for (let i = 1; i < divs.length; i++) {
    const r = _cell_(divs[i], dm, 'resp');
    if (r) load[_normName_(r)] = (load[_normName_(r)] || 0) + 1;
  }

  const rows = [];
  for (let i = 1; i < divs.length; i++) {
    const unit = _cell_(divs[i], dm, 'unit');
    if (!unit) continue;
    const resp = _cell_(divs[i], dm, 'resp');
    rows.push({
      row: i + 1,
      id: _cell_(divs[i], dm, 'idUnit'),
      unit: unit,
      dir: _cell_(divs[i], dm, 'dir'),
      level: Number(_cell_(divs[i], dm, 'level') || 0),
      head: _cell_(divs[i], dm, 'head'),
      resp: resp,
      comp: cnt[_normName_(unit)] || 0,
      load: resp ? (load[_normName_(resp)] || 0) : 0
    });
  }

  // Без ответственного — наверх, дальше «зонтики» (один человек на 3+ подразделения)
  rows.sort(function (a, b) {
    const wa = a.resp ? (a.load >= 3 ? 1 : 2) : 0;
    const wb = b.resp ? (b.load >= 3 ? 1 : 2) : 0;
    if (wa !== wb) return wa - wb;
    return a.unit.localeCompare(b.unit, 'ru');
  });

  return { rows: rows, people: _именаБлока_('people') };
}

/**
 * Пишет выбранных ответственных в «Подразделения» и синхронизирует
 * строки «Конкурентов» — иначе в строках останется прежняя фамилия.
 * list = [{ row, unit, name }]
 */
function saveAssign(list) {
  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(30000)) return { ok: false, error: 'Таблица занята, попробуйте ещё раз' };
    if (!list || !list.length) return { ok: false, error: 'Никого не выбрали' };

    const люди = {};
    _именаБлока_('people').forEach(function (n) { люди[_normName_(n)] = n; });

    const sh = _sheet_(SH.DIV);
    const width = Math.max(sh.getLastColumn(), 1);
    const dm = _divMap_([sh.getRange(1, 1, 1, width).getValues()[0]]);
    const put = function (row, key, value) {
      const c = dm[key];
      if (c === undefined || c < 0 || c >= width) return;
      const cell = sh.getRange(row, c + 1);
      if (cell.getFormula()) return;             // формулу не трогаем
      cell.setValue(value);
    };

    const done = [];
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const name = _str_(it && it.name);
      const row = Number(it && it.row);
      if (!row) continue;
      if (name && !люди[_normName_(name)]) {
        return { ok: false, error: 'В справочнике нет: ' + name };
      }
      const canon = name ? люди[_normName_(name)] : '';
      put(row, 'idResp', canon ? _идПо_('people', canon) : '');
      put(row, 'resp', canon);
      done.push({ unit: _str_(it.unit), name: canon });
    }

    // те же имена в строках «Конкурентов»
    let touched = 0;
    const csh = _sheet_(SH.COMP);
    const clr = csh.getLastRow(), cw = Math.max(csh.getLastColumn(), 1);
    if (clr > 1 && done.length) {
      const cm = _compMap_([csh.getRange(1, 1, 1, cw).getValues()[0]]);
      const vals = csh.getRange(2, 1, clr - 1, cw).getValues();
      const byUnit = {};
      done.forEach(function (d) { if (d.unit) byUnit[_normName_(d.unit)] = d.name; });

      for (let i = 0; i < vals.length; i++) {
        const u = _normName_(_cell_(vals[i], cm, 'unit'));
        if (!u || !(u in byUnit)) continue;
        const who = byUnit[u];
        if (cm.resp !== undefined && cm.resp >= 0) vals[i][cm.resp] = who;
        if (cm.idResp !== undefined && cm.idResp >= 0) vals[i][cm.idResp] = who ? _идПо_('people', who) : '';
        touched++;
      }
      if (touched) {
        ['idResp', 'resp'].forEach(function (key) {
          const c = cm[key];
          if (c === undefined || c < 0) return;
          _writeCol_(csh, c, 2, vals.length, function (i) { return vals[i][c]; });
        });
      }
    }

    SpreadsheetApp.flush();
    _сброситьСправочник_();
    _создатьПользователей_(false);       // у новых ответственных появляется доступ
    пересчитатьСтатусы_(true);
    SpreadsheetApp.flush();

    _log_('меню', 'назначены ответственные',
      'подразделений: ' + done.length + ', строк конкурентов обновлено: ' + touched);

    return { ok: true, count: done.length, rows: touched };
  } catch (e) {
    return { ok: false, error: 'Ошибка: ' + e.message };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * Разметка окна. Список людей один на всё окно — <datalist>: в поле можно
 * и выбрать из выпадающего списка, и начать печатать фамилию.
 * 121 отдельный <select> со 125 фамилиями окно не тянет.
 */
function _окноНазначения_() {
  return '<!DOCTYPE html><html><head><base target="_top"><meta charset="utf-8"><style>' +
    'body{font:13.5px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;' +
      'margin:0;padding:14px;color:#16202a}' +
    'h3{margin:0 0 4px;font-size:15px}p.h{color:#66737f;margin:0 0 12px;font-size:12.5px;line-height:1.45}' +
    '.bar{display:flex;gap:10px;align-items:center;margin-bottom:10px}' +
    '.bar input{flex:1;font:inherit;padding:9px 10px;border:1px solid #e2e6ea;border-radius:9px}' +
    'label.chk{display:flex;gap:6px;align-items:center;white-space:nowrap;color:#66737f}' +
    'table{border-collapse:collapse;width:100%;font-size:13px}' +
    'th{text-align:left;color:#66737f;font-weight:600;font-size:12px;padding:6px 8px;' +
      'position:sticky;top:0;background:#fff;border-bottom:1px solid #e2e6ea}' +
    'td{padding:5px 8px;border-bottom:1px solid #f1f3f5;vertical-align:middle}' +
    'tr.need td{background:#fdf3e0}' +
    'tr.umbrella td{background:#fbfbfc}' +
    '.u{font-weight:600}.d{color:#66737f;font-size:11.5px}' +
    'input.pick{width:100%;font:inherit;padding:7px 8px;border:1px solid #e2e6ea;border-radius:8px}' +
    'input.pick.set{border-color:#1a7f4b;background:#f4fbf6}' +
    '.wrap{max-height:430px;overflow:auto;border:1px solid #e2e6ea;border-radius:10px}' +
    '.act{display:flex;gap:10px;margin-top:14px;align-items:center}' +
    'button{font:inherit;min-height:40px;padding:0 18px;border-radius:9px;border:1px solid #e2e6ea;' +
      'background:#fff;cursor:pointer}' +
    'button.go{background:#1f6feb;border-color:#1f6feb;color:#fff;font-weight:600}' +
    'button:disabled{opacity:.5;cursor:default}' +
    '.err{background:#fdecea;color:#c0392b;border-radius:8px;padding:9px 12px;margin:10px 0}' +
    '.ok{background:#e3f5ea;border:1px solid #1a7f4b;border-radius:10px;padding:14px;margin:6px 0}' +
    '.cnt{color:#66737f;margin-left:auto}' +
    '</style></head><body><div id="app">Загрузка…</div><script>' +
    'var D=null,sel={};' +
    'google.script.run.withSuccessHandler(function(d){D=d;draw();}).listAssign();' +
    'function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){' +
      'return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}' +
    'function draw(){' +
      'var h="<h3>Назначить ответственных</h3><p class=h>Жёлтым — подразделения без ответственного. ' +
        'Серым — те, где один человек тянет три и больше подразделений. ' +
        'Начните печатать фамилию или нажмите на поле — появится список из справочника. ' +
        'Пустое поле = оставить как есть.</p><div id=err></div>";' +
      'h+="<div class=bar><input id=q placeholder=\\"Поиск по подразделению или фамилии\\">"+' +
        '"<label class=chk><input type=checkbox id=only checked> только требующие внимания</label></div>";' +
      'h+="<datalist id=people>"+D.people.map(function(p){' +
        'return "<option value=\\""+esc(p)+"\\">";}).join("")+"</datalist>";' +
      'h+="<div class=wrap><table><thead><tr><th>Подразделение</th><th>Сейчас отвечает</th>"+' +
        '"<th style=\\"width:38%\\">Новый ответственный</th></tr></thead><tbody id=tb></tbody></table></div>";' +
      'h+="<div class=act><button onclick=google.script.host.close()>Закрыть</button>"+' +
        '"<button class=go id=go onclick=save()>Сохранить</button>"+' +
        '"<span class=cnt id=cnt></span></div>";' +
      'document.getElementById("app").innerHTML=h;' +
      'document.getElementById("q").oninput=rows;' +
      'document.getElementById("only").onchange=rows;' +
      'rows();' +
    '}' +
    'function rows(){' +
      'var q=(document.getElementById("q").value||"").toLowerCase();' +
      'var only=document.getElementById("only").checked;' +
      'var out="";' +
      'D.rows.forEach(function(r,i){' +
        'var need=!r.resp, umb=r.resp&&r.load>=3;' +
        'if(only&&!need&&!umb) return;' +
        'if(q&&(r.unit+" "+r.dir+" "+r.resp+" "+r.head).toLowerCase().indexOf(q)<0) return;' +
        'out+="<tr class=\\""+(need?"need":(umb?"umbrella":""))+"\\">"+' +
          '"<td><div class=u>"+esc(r.unit)+"</div><div class=d>"+esc(r.dir)+' +
            '" · ур."+r.level+" · конкурентов "+r.comp+(r.head?" · рук.: "+esc(r.head):"")+"</div></td>"+' +
          '"<td>"+(r.resp?esc(r.resp)+(umb?" <span class=d>("+r.load+" подр.)</span>":""):"<span class=d>никто</span>")+"</td>"+' +
          '"<td><input class=\\"pick"+(sel[r.row]?" set":"")+"\\" list=people data-row=\\""+r.row+"\\" "+' +
            '"data-unit=\\""+esc(r.unit)+"\\" value=\\""+esc(sel[r.row]||"")+"\\" placeholder=\\"выбрать из справочника\\"></td>"+' +
        '"</tr>";' +
      '});' +
      'document.getElementById("tb").innerHTML=out||"<tr><td colspan=3>Ничего не найдено</td></tr>";' +
      'var ins=document.getElementsByClassName("pick");' +
      'for(var k=0;k<ins.length;k++){ins[k].onchange=ins[k].oninput=onpick;}' +
      'count();' +
    '}' +
    'function onpick(e){' +
      'var el=e.target,row=el.getAttribute("data-row"),v=(el.value||"").trim();' +
      'if(v) sel[row]={name:v,unit:el.getAttribute("data-unit")}; else delete sel[row];' +
      'el.className="pick"+(v?" set":"");' +
      'count();' +
    '}' +
    'function count(){' +
      'var n=0;for(var k in sel) n++;' +
      'document.getElementById("cnt").textContent=n?("выбрано: "+n):"пока ничего не выбрано";' +
      'document.getElementById("go").disabled=!n;' +
    '}' +
    'function err(m){document.getElementById("err").innerHTML="<div class=err>"+esc(m)+"</div>";}' +
    'function save(){' +
      'var list=[];for(var row in sel) list.push({row:Number(row),unit:sel[row].unit,name:sel[row].name});' +
      'if(!list.length) return;' +
      'var b=document.getElementById("go");b.disabled=true;b.textContent="Сохраняем…";' +
      'google.script.run.withSuccessHandler(done).withFailureHandler(function(e){' +
        'b.disabled=false;b.textContent="Сохранить";err(e.message||"Ошибка");}).saveAssign(list);' +
    '}' +
    'function done(r){' +
      'var b=document.getElementById("go");' +
      'if(!r||!r.ok){if(b){b.disabled=false;b.textContent="Сохранить";}err((r&&r.error)||"Не удалось");return;}' +
      'document.getElementById("app").innerHTML="<h3>Готово</h3><div class=ok>"+' +
        '"назначено подразделений: "+r.count+"<br>строк «Конкурентов» обновлено: "+r.rows+' +
        '"<br><br>Учётные записи и статусы пересчитаны.</div>"+' +
        '"<div class=act><button class=go onclick=google.script.host.close()>Закрыть</button></div>";' +
    '}' +
    '<\/script></body></html>';
}

// ─────────────────────────────────────────────────────────────
// ОТЧЁТ О СОСТОЯНИИ
// Только чтение. Личные данные не выгружаются: ни паролей, ни телефонов,
// ни списка людей — только структура, количества и настройки.
// ─────────────────────────────────────────────────────────────

/** Пункт меню: собрать отчёт и показать в окне для копирования. */
function отчётОСостоянии() {
  const txt = _собратьСостояние_();
  const html = HtmlService.createHtmlOutput(_окноСостояния_(txt))
    .setWidth(720).setHeight(620);
  SpreadsheetApp.getUi().showModalDialog(html, 'Состояние системы');
}

/** Текст отчёта отдаётся окну по кнопке «Обновить». */
function getStateReport() { return _собратьСостояние_(); }

function _собратьСостояние_() {
  const L = [];
  const add = function (s) { L.push(s === undefined ? '' : String(s)); };
  const safe = function (fn, def) { try { return fn(); } catch (e) { return def === undefined ? ('ошибка: ' + e.message) : def; } };

  add('ОТЧЁТ О СОСТОЯНИИ · ' + safe(function () { return _дата_(new Date(), true); }, '?'));
  add('таблица: ' + safe(function () { return _ss_().getId(); }, '?'));
  add('часовой пояс: ' + safe(function () { return _ss_().getSpreadsheetTimeZone(); }, '?'));

  // ── версия кода: по наличию функций видно, какой Code.gs развёрнут ──
  add('');
  add('── ВЕРСИЯ КОДА ──');
  const marks = ['createUser', 'добавитьПользователя', 'проверитьФормулы', 'перенестиСтроки',
                 '_штаткаПоПодразделениям_', '_tgАктивировать_', '_убедитьсяЧтоФиоВидно_',
                 'отчётОСостоянии'];
  marks.forEach(function (m) {
    let has = false;
    try { has = (eval('typeof ' + m) === 'function'); } catch (e) { has = false; }
    add('  ' + (has ? '+' : '-') + ' ' + m);
  });

  // ── листы ──
  add('');
  add('── ЛИСТЫ ──');
  safe(function () {
    _ss_().getSheets().forEach(function (sh) {
      add('  ' + sh.getName() + '  строк: ' + sh.getLastRow() + ', колонок: ' + sh.getLastColumn());
    });
  });

  // ── шапки и распознанные колонки ──
  const dumpHead = function (name, spec, fallback, keys) {
    add('');
    add('── КОЛОНКИ «' + name + '» ──');
    const rows = safe(function () { return _valuesOpt_(name); }, []);
    if (!rows.length) { add('  лист пуст или не найден'); return; }
    add('  шапка: ' + rows[0].map(function (h) { return _str_(h) || '·'; }).join(' | '));
    const map = safe(function () { return _colmap_(rows[0], spec, fallback, keys); }, {});
    add('  распознано: ' + Object.keys(map).map(function (k) {
      return k + '=' + (map[k] >= 0 ? _indexToLetter_(map[k]) : '—');
    }).join(', '));
    if (rows[1]) {
      add('  пример строки 2: ' + rows[1].slice(0, 14).map(function (v) {
        const s = _str_(v); return s.length > 22 ? s.slice(0, 22) + '…' : (s || '·');
      }).join(' | '));
    }
  };
  dumpHead(SH.DIV, DIV_SPEC, DIV_FALLBACK, ['unit']);
  dumpHead(SH.COMP, COMP_SPEC, COMP_FALLBACK, ['unit', 'company']);
  dumpHead(SH.PEOPLE, PEOPLE_SPEC, PEOPLE_FALLBACK, ['fio']);

  // ── формулы: сколько их и есть ли короткие диапазоны ──
  add('');
  add('── ФОРМУЛЫ ──');
  safe(function () {
    const ref = _findSheet_(SH.REF);
    if (!ref) { add('  листа «' + SH.REF + '» нет'); return; }
    add('  «' + SH.REF + '»: строк ' + ref.getLastRow() + ', место до ' + ref.getMaxRows());
    [SH.PEOPLE, SH.DIV, SH.COMP].forEach(function (n) {
      const sh = _findSheet_(n);
      if (!sh || sh.getLastRow() < 2) { add('  ' + n + ': нет данных'); return; }
      const lc = Math.max(sh.getLastColumn(), 1);
      const f2 = sh.getRange(2, 1, 1, lc).getFormulas()[0];
      const cnt = f2.filter(String).length;
      const first = f2.filter(String)[0] || '';
      add('  ' + n + ': формул в строке 2 — ' + cnt + (first ? ', пример: ' + first.slice(0, 80) : ''));
    });
    const target = Math.max(ref.getMaxRows(), ref.getLastRow() + 500, 1000);
    const short = _найтиКороткиеДиапазоны_(target);
    add('  коротких диапазонов: ' + short.rows.length +
        (short.rows.length ? ' (лечится пунктом «Проверить формулы справочника»)' : ''));
  });

  // ── количества ──
  add('');
  add('── ДАННЫЕ ──');
  safe(function () {
    const divs = _valuesOpt_(SH.DIV), dm = _divMap_(divs);
    const seen = {}, dup = {};
    let withResp = 0, withHrbp = 0, n = 0;
    for (let i = 1; i < divs.length; i++) {
      const u = _cell_(divs[i], dm, 'unit');
      if (!u) continue;
      n++;
      const k = _normName_(u);
      if (seen[k]) dup[u] = (dup[u] || 1) + 1; else seen[k] = 1;
      if (_cell_(divs[i], dm, 'resp')) withResp++;
      if (_cell_(divs[i], dm, 'hrbp')) withHrbp++;
    }
    add('  подразделений: ' + n + ', уникальных названий: ' + Object.keys(seen).length);
    add('  с ответственным: ' + withResp + ', с HR BP: ' + withHrbp);
    const dn = Object.keys(dup);
    add('  ПОВТОРЫ НАЗВАНИЙ: ' + (dn.length ? dn.length : 'нет'));
    dn.slice(0, 10).forEach(function (x) { add('    «' + x + '»'); });
  });

  safe(function () {
    const comp = _valuesOpt_(SH.COMP), cm = _compMap_(comp);
    const st = {};
    let noId = 0, noUnit = 0;
    for (let i = 1; i < comp.length; i++) {
      const a = _cell_(comp[i], cm, 'actual') || 'пусто';
      st[a] = (st[a] || 0) + 1;
      if (!_cell_(comp[i], cm, 'id')) noId++;
      if (!_cell_(comp[i], cm, 'unit')) noUnit++;
    }
    add('  строк «' + SH.COMP + '»: ' + Math.max(comp.length - 1, 0));
    Object.keys(st).forEach(function (k) { add('    ' + k + ': ' + st[k]); });
    add('    без ID: ' + noId + ', без подразделения: ' + noUnit);
  });

  safe(function () {
    const surv = _valuesOpt_(SH.SURVEY);
    let act = 0, del = 0;
    const per = {};
    for (let i = 1; i < surv.length; i++) {
      if (_str_(surv[i][V.STATE]) === 'удалена') del++; else act++;
      const p = _str_(surv[i][V.PERIOD]) || '(без периода)';
      per[p] = (per[p] || 0) + 1;
    }
    add('  записей «' + SH.SURVEY + '»: активных ' + act + ', удалённых ' + del);
    Object.keys(per).forEach(function (k) { add('    ' + k + ': ' + per[k]); });
  });

  safe(function () {
    const u = _valuesOpt_(SH.USERS);
    const roles = {};
    let noUnits = 0;
    for (let i = 1; i < u.length; i++) {
      const r = _str_(u[i][U.ROLE]) || 'пусто';
      roles[r] = (roles[r] || 0) + 1;
      if (!_str_(u[i][U.UNITS])) noUnits++;
    }
    add('  учётных записей: ' + Math.max(u.length - 1, 0) +
        ' (' + Object.keys(roles).map(function (k) { return k + ': ' + roles[k]; }).join(', ') + ')');
    add('    без подразделений: ' + noUnits);
  });

  safe(function () {
    const p = _valuesOpt_(SH.PWD);
    let phones = 0, changed = 0;
    for (let i = 1; i < p.length; i++) {
      if (_str_(p[i][PW.PHONE])) phones++;
      if (_str_(p[i][PW.PWD]) === PWD_CHANGED) changed++;
    }
    add('  строк «' + SH.PWD + '»: ' + Math.max(p.length - 1, 0) +
        ', телефонов заполнено: ' + phones + ', пароль сменили сами: ' + changed);
  });

  safe(function () {
    const d = _должности_();
    const units = Object.keys(d.byUnit).length;
    add('  штатка: должностей всего ' + d.all.length + ', подразделений со штаткой ' + units);
  });

  // ── период и настройки ──
  add('');
  add('── ПЕРИОД И НАСТРОЙКИ ──');
  safe(function () {
    const p = _период_();
    add('  период: «' + p.name + '», состояние: ' + p.state + ', с ' + p.from + ' по ' + (p.to || '—'));
  });
  safe(function () {
    const props = PropertiesService.getScriptProperties();
    add('  токен бота задан: ' + (props.getProperty('TG_TOKEN') ? 'да' : 'НЕТ'));
    add('  значок опубликован: ' + (props.getProperty('FAVICON_URL') ? 'да' : 'нет (берётся из кода)'));
    add('  окно быстрого ответа бота: ' + (props.getProperty('TG_ACTIVE_UNTIL') ? 'использовалось' : 'ещё нет'));
  });
  safe(function () {
    const wh = _tgCall_('getWebhookInfo', {});
    if (wh && wh.url) {
      add('  Telegram-бот: ВЕБХУК CLOUDFLARE АКТИВЕН ⚡ (' + wh.url + ')');
    } else {
      const poll = _тгТриггерОпроса_().length > 0;
      add('  Telegram-бот: ' + (poll ? 'резервный опрос (раз в минуту)' : 'ВЫКЛЮЧЕН'));
    }
  });
  safe(function () {
    const t = ScriptApp.getProjectTriggers().map(function (x) { return x.getHandlerFunction(); });
    const cnt = {};
    t.forEach(function (h) { cnt[h] = (cnt[h] || 0) + 1; });
    add('  триггеров: ' + t.length + ' (' +
        (Object.keys(cnt).map(function (k) { return k + '×' + cnt[k]; }).join(', ') || 'нет') + ')');
    add('  автосинхронизация: ' + (cnt['приИзменении'] ? 'включена' : 'ВЫКЛЮЧЕНА'));
  });

  // ── журнал: что происходило в последнее время ──
  add('');
  add('── ПОСЛЕДНИЕ ЗАПИСИ ЖУРНАЛА ──');
  safe(function () {
    const lg = _valuesOpt_(SH.LOG);
    if (lg.length < 2) { add('  журнал пуст'); return; }
    lg.slice(-12).reverse().forEach(function (r) {
      add('  ' + _дата_(r[0], true) + '  ' + _str_(r[1]) + '  ' + _str_(r[2]) + '  ' + _str_(r[3]).slice(0, 60));
    });
  });

  return L.join('\n');
}

function _окноСостояния_(txt) {
  const esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  return '<!DOCTYPE html><html><head><base target="_top"><style>' +
    'body{font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;' +
      'margin:0;padding:14px;color:#16202a;display:flex;flex-direction:column;height:100vh;box-sizing:border-box}' +
    'p.h{color:#66737f;margin:0 0 10px;font-size:12.5px;line-height:1.4}' +
    'textarea{flex:1;width:100%;box-sizing:border-box;font:12px/1.5 ui-monospace,Consolas,monospace;' +
      'border:1px solid #e2e6ea;border-radius:9px;padding:10px;resize:none;background:#f8f9fa}' +
    '.act{display:flex;gap:10px;margin-top:12px}' +
    'button{font:inherit;flex:1;min-height:40px;border-radius:9px;border:1px solid #e2e6ea;' +
      'background:#fff;cursor:pointer}' +
    'button.go{background:#1f6feb;border-color:#1f6feb;color:#fff;font-weight:600}' +
    '</style></head><body>' +
    '<p class="h">Личных данных здесь нет: ни паролей, ни телефонов, ни списка людей — ' +
      'только структура, количества и настройки. Нажмите «Выделить всё», скопируйте и передайте.</p>' +
    '<textarea id="t" readonly>' + esc(txt) + '</textarea>' +
    '<div class="act">' +
      '<button onclick="google.script.host.close()">Закрыть</button>' +
      '<button class="go" onclick="var t=document.getElementById(\'t\');t.focus();t.select();' +
        'try{document.execCommand(\'copy\');this.textContent=\'Скопировано\';}catch(e){}">' +
        'Выделить всё и скопировать</button>' +
    '</div></body></html>';
}

// ─────────────────────────────────────────────────────────────
// ПАНЕЛЬ КОНТРОЛЯ
// Список несоответствий с живым состоянием и кнопкой «Исправить» там,
// где исправление однозначно. Спорное не чинится само — только показывается.
// ─────────────────────────────────────────────────────────────

/** Пункт меню: открыть панель. */
function панельКонтроля() {
  const html = HtmlService.createHtmlOutput(_окноПанели_())
    .setWidth(760).setHeight(640);
  SpreadsheetApp.getUi().showModalDialog(html, 'Панель контроля');
}

/**
 * Полный список проверок с текущими значениями.
 * level: ok — всё хорошо, warn — стоит посмотреть, bad — мешает работе.
 * fix — идентификатор действия; пусто, если чинить надо руками.
 */
function checkAll() {
  const out = [];
  const push = function (o) { out.push(o); };
  const safe = function (fn, def) { try { return fn(); } catch (e) { return def; } };

  // 1. Диапазоны ВПР
  safe(function () {
    const ref = _findSheet_(SH.REF);
    if (!ref) return;
    const target = Math.max(ref.getMaxRows(), ref.getLastRow() + 500, 1000);
    const n = _найтиКороткиеДиапазоны_(target).rows.length;
    push({ id: 'formulas', title: 'Короткие диапазоны ВПР',
      hint: 'Формулы не видят новые строки «' + SH.REF + '»: ФИО не подтягивается, учётка не создаётся',
      count: n, unit: 'ячеек', level: n ? 'bad' : 'ok', fix: n ? 'formulas' : '' });
  });

  // 2. Строки конкурентов без ID
  safe(function () {
    const comp = _valuesOpt_(SH.COMP);
    const cm = _compMap_(comp);
    let n = 0;
    for (let i = 1; i < comp.length; i++) if (!_cell_(comp[i], cm, 'id')) n++;
    push({ id: 'ids', title: 'Строки «' + SH.COMP + '» без ID',
      hint: 'Без ID форма не найдёт строку при сохранении — правки уйдут в пустоту',
      count: n, unit: 'строк', level: n ? 'bad' : 'ok', fix: n ? 'ids' : '' });
  });

  // 3. Люди без учётной записи
  safe(function () {
    const people = _valuesOpt_(SH.PEOPLE);
    const pm = _peopleMap_(people);
    const users = _valuesOpt_(SH.USERS);
    const have = {};
    for (let i = 1; i < users.length; i++) {
      const f = _str_(users[i][U.FIO]);
      if (f) have[_normName_(f)] = true;
    }
    let n = 0;
    const names = [];
    for (let i = 1; i < people.length; i++) {
      const f = _cell_(people[i], pm, 'fio');
      if (!f || _похожеНаId_(f)) continue;
      if (!have[_normName_(f)]) { n++; if (names.length < 5) names.push(f); }
    }
    push({ id: 'noacc', title: 'Люди без учётной записи',
      hint: n ? 'Например: ' + names.join(', ') : 'Все из «' + SH.PEOPLE + '» имеют логин',
      count: n, unit: 'чел.', level: n ? 'bad' : 'ok', fix: n ? 'users' : '' });
  });

  // 4. Повторы названий подразделений
  safe(function () {
    const divs = _valuesOpt_(SH.DIV);
    const dm = _divMap_(divs);
    const seen = {}, dup = {};
    for (let i = 1; i < divs.length; i++) {
      const u = _cell_(divs[i], dm, 'unit');
      if (!u) continue;
      const k = _normName_(u);
      if (seen[k]) dup[u] = true; else seen[k] = i + 1;
    }
    const names = Object.keys(dup);
    push({ id: 'dup', title: 'Повторы названий подразделений',
      hint: names.length ? names.slice(0, 3).join(' · ') : 'Каждое название встречается один раз',
      count: names.length, unit: 'назв.', level: names.length ? 'warn' : 'ok', fix: '' });
  });

  // 5. Подразделения без ответственного
  safe(function () {
    const divs = _valuesOpt_(SH.DIV);
    const dm = _divMap_(divs);
    let n = 0;
    const names = [];
    for (let i = 1; i < divs.length; i++) {
      const u = _cell_(divs[i], dm, 'unit');
      if (!u) continue;
      const r = _cell_(divs[i], dm, 'resp') || _cell_(divs[i], dm, 'head');
      if (!r || r === '—') { n++; if (names.length < 4) names.push(u); }
    }
    push({ id: 'noresp', title: 'Подразделения без ответственного',
      hint: n ? names.join(' · ') : 'У каждого подразделения есть ответственный',
      count: n, unit: 'подр.', level: n ? 'warn' : 'ok', fix: '' });
  });

  // 6. Расхождения из листа «Связи»
  safe(function () {
    const sh = _findSheet_(SH.LINKS);
    const n = sh ? Math.max(sh.getLastRow() - 1, 0) : 0;
    push({ id: 'links', title: 'Расхождения в «' + SH.LINKS + '»',
      hint: n ? 'Откройте лист «' + SH.LINKS + '»: там строки, потерявшие связь. Сироты удаляются отдельным пунктом меню'
              : 'Всё связано корректно',
      count: n, unit: 'строк', level: n ? 'warn' : 'ok', fix: n ? 'sync' : '' });
  });

  // 7. Статусы заполнения
  safe(function () {
    const divs = _valuesOpt_(SH.DIV);
    const dm = _divMap_(divs);
    let units = 0;
    for (let i = 1; i < divs.length; i++) if (_cell_(divs[i], dm, 'unit')) units++;
    const st = _valuesOpt_(SH.STATUS);
    const rows = Math.max(st.length - 1, 0);
    const diff = Math.abs(units - rows);
    push({ id: 'status', title: 'Лист «' + SH.STATUS + '»',
      hint: diff ? 'Строк ' + rows + ', подразделений ' + units + ' — расходится'
                 : 'Совпадает с оргструктурой: ' + rows,
      count: diff, unit: 'расх.', level: diff ? 'warn' : 'ok', fix: diff ? 'statuses' : '' });
  });

  // 8. Автосинхронизация
  safe(function () {
    const on = _автосинхронизацияВключена_();
    push({ id: 'autosync', title: 'Автосинхронизация',
      hint: on ? 'Пересчёт запускается сам через 20 секунд после правки'
               : 'Правки оргструктуры не подхватываются автоматически',
      count: on ? 0 : 1, unit: '', level: on ? 'ok' : 'bad', fix: on ? '' : 'autosync',
      text: on ? 'включена' : 'выключена' });
  });

  // 9. Опрос бота
  safe(function () {
    const hasToken = !!_tgToken_();
    const on = _тгТриггерОпроса_().length > 0;
    push({ id: 'bot', title: 'Телеграм-бот',
      hint: !hasToken ? 'Токен не задан — бот не работает'
            : (on ? 'Опрос включён, сообщения разбираются' : 'Токен есть, но опрос выключен'),
      count: (hasToken && on) ? 0 : 1, unit: '',
      level: !hasToken ? 'warn' : (on ? 'ok' : 'bad'),
      fix: (hasToken && !on) ? 'bot' : '',
      text: !hasToken ? 'нет токена' : (on ? 'работает' : 'выключен') });
  });

  // 10. Телефоны для бота
  safe(function () {
    const p = _valuesOpt_(SH.PWD);
    let with_ = 0, total = 0;
    for (let i = 1; i < p.length; i++) {
      if (!_str_(p[i][PW.LOGIN])) continue;
      total++;
      if (_str_(p[i][PW.PHONE])) with_++;
    }
    const n = total - with_;
    push({ id: 'phones', title: 'Телефоны для бота',
      hint: n ? 'Без телефона бот человека не узнает. Заполните колонку «Телефон» на листе «' + SH.PWD + '»'
              : 'У всех есть телефон',
      count: n, unit: 'чел.', level: n ? 'warn' : 'ok', fix: '',
      text: with_ + ' из ' + total });
  });

  const bad = out.filter(function (x) { return x.level === 'bad'; }).length;
  const warn = out.filter(function (x) { return x.level === 'warn'; }).length;
  return { at: _дата_(new Date(), true), checks: out, bad: bad, warn: warn };
}

/** Выполняет исправление и сразу возвращает свежее состояние. */
function runFix(id) {
  const lock = LockService.getScriptLock();
  let msg = '';
  try {
    if (!lock.tryLock(30000)) return { ok: false, error: 'Таблица занята, попробуйте ещё раз' };

    if (id === 'formulas') {
      const ref = _sheet_(SH.REF);
      const target = Math.max(ref.getMaxRows(), ref.getLastRow() + 500, 1000);
      const found = _найтиКороткиеДиапазоны_(target);
      let done = 0;
      found.rows.forEach(function (x) {
        try { _findSheet_(x.sheet).getRange(x.row, x.col).setFormula(x.after); done++; } catch (e) {}
      });
      SpreadsheetApp.flush();
      msg = 'Удлинено диапазонов: ' + done;

    } else if (id === 'ids') {
      _подготовитьЛистКонкуренты_();
      SpreadsheetApp.flush();
      msg = 'ID проставлены';

    } else if (id === 'users') {
      SpreadsheetApp.flush();
      const n = _создатьПользователей_(false);
      SpreadsheetApp.flush();
      msg = 'Учётных записей: ' + n;

    } else if (id === 'statuses') {
      пересчитатьСтатусы_(true);
      msg = 'Статусы пересчитаны';

    } else if (id === 'sync') {
      const r = синхронизировать_({ users: true });
      msg = 'Синхронизация выполнена, расхождений: ' + r.issues;

    } else if (id === 'autosync') {
      включитьАвтосинхронизацию_();
      msg = 'Автосинхронизация включена';

    } else if (id === 'bot') {
      _tgCall_('deleteWebhook', { drop_pending_updates: false });
      _тгТриггерОпроса_().forEach(function (t) { ScriptApp.deleteTrigger(t); });
      ScriptApp.newTrigger('телеграмОпрос').timeBased().everyMinutes(1).create();
      msg = 'Опрос бота включён';

    } else {
      return { ok: false, error: 'Неизвестное действие: ' + id };
    }

    _log_('панель', 'исправление', id + ' — ' + msg);
    const state = checkAll();
    state.ok = true;
    state.msg = msg;
    return state;
  } catch (e) {
    return { ok: false, error: 'Ошибка: ' + e.message };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function _окноПанели_() {
  return '<!DOCTYPE html><html><head><base target="_top"><style>' +
    'body{font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;' +
      'margin:0;padding:14px;color:#16202a;background:#fff}' +
    '.top{display:flex;align-items:center;gap:12px;margin-bottom:12px}' +
    '.top b{font-size:15px;flex:1}' +
    '.top span{font-size:12px;color:#66737f}' +
    '.sum{display:flex;gap:8px;margin-bottom:12px}' +
    '.sum div{flex:1;border-radius:9px;padding:9px 12px;font-size:13px;font-weight:600;text-align:center}' +
    '.s-bad{background:#fdecea;color:#c0392b}.s-warn{background:#fdf3e0;color:#8a5a00}' +
    '.s-ok{background:#e3f5ea;color:#1a7f4b}' +
    'table{width:100%;border-collapse:collapse}' +
    'td{padding:9px 8px;border-bottom:1px solid #eef1f3;vertical-align:top}' +
    'td.n{width:88px;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}' +
    'td.a{width:120px}' +
    '.t{font-weight:600}' +
    '.h{font-size:12px;color:#66737f;margin-top:2px;line-height:1.35}' +
    '.v{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12.5px;font-weight:700}' +
    '.v-ok{background:#e3f5ea;color:#1a7f4b}.v-warn{background:#fdf3e0;color:#8a5a00}' +
    '.v-bad{background:#fdecea;color:#c0392b}' +
    'button{font:inherit;border-radius:8px;border:1px solid #e2e6ea;background:#fff;cursor:pointer;' +
      'min-height:34px;padding:0 12px;width:100%;font-size:13px}' +
    'button.go{background:#1f6feb;border-color:#1f6feb;color:#fff;font-weight:600}' +
    'button:disabled{opacity:.45;cursor:default}' +
    'button.sm{width:auto;min-height:30px;font-size:12.5px}' +
    '#msg{margin-top:10px;font-size:13px;color:#1a7f4b;min-height:18px}' +
    '</style></head><body>' +
    '<div class="top"><b>Состояние системы</b>' +
      '<span id="ts">…</span>' +
      '<button class="sm" id="auto" onclick="toggleAuto()">Авто: вкл</button>' +
      '<button class="sm" onclick="load()">Обновить</button></div>' +
    '<div id="sum" class="sum"></div>' +
    '<div id="body">Загрузка…</div>' +
    '<div id="msg"></div>' +
    '<script>' +
    'var timer=null,auto=true,busy=false,secs=0;' +
    'function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){' +
      'return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}' +
    'function draw(d){' +
      'document.getElementById("ts").textContent="обновлено "+d.at;' +
      'var s=document.getElementById("sum");' +
      's.innerHTML="<div class=\\"s-bad\\">мешает работе: "+d.bad+"</div>"+' +
        '"<div class=\\"s-warn\\">стоит посмотреть: "+d.warn+"</div>"+' +
        '"<div class=\\"s-ok\\">в порядке: "+(d.checks.length-d.bad-d.warn)+"</div>";' +
      'var h="<table>";' +
      'd.checks.forEach(function(c){' +
        'var val=c.text!==undefined?c.text:(c.count+(c.unit?" "+c.unit:""));' +
        'if(c.level==="ok"&&c.text===undefined) val="в порядке";' +
        'h+="<tr><td><div class=t>"+esc(c.title)+"</div><div class=h>"+esc(c.hint)+"</div></td>"+' +
          "\"<td class=n><span class='v v-\"+c.level+\"'>\"+esc(val)+\"</span></td>\"+" +
          '"<td class=a>"+(c.fix?"<button class=go onclick=\\"fix(\'"+c.fix+"\')\\">Исправить</button>":"")+"</td></tr>";' +
      '});' +
      'h+="</table>";' +
      'document.getElementById("body").innerHTML=h;' +
    '}' +
    'function load(){' +
      'if(busy)return; busy=true;' +
      'google.script.run.withSuccessHandler(function(d){busy=false;secs=0;draw(d);})' +
        '.withFailureHandler(function(e){busy=false;' +
          'document.getElementById("msg").textContent="Нет связи: "+(e.message||"");}).checkAll();' +
    '}' +
    'function fix(id){' +
      'if(busy)return; busy=true;' +
      'document.getElementById("msg").textContent="Исправляем…";' +
      '[].forEach.call(document.querySelectorAll("button"),function(b){b.disabled=true;});' +
      'google.script.run.withSuccessHandler(function(d){' +
        'busy=false;secs=0;' +
        'if(!d||!d.ok){document.getElementById("msg").textContent=(d&&d.error)||"Не удалось";load();return;}' +
        'document.getElementById("msg").textContent=d.msg;' +
        'draw(d);' +
      '}).withFailureHandler(function(e){busy=false;' +
        'document.getElementById("msg").textContent="Ошибка: "+(e.message||"");load();}).runFix(id);' +
    '}' +
    'function toggleAuto(){' +
      'auto=!auto;' +
      'document.getElementById("auto").textContent="Авто: "+(auto?"вкл":"выкл");' +
    '}' +
    // Тик раз в секунду: считаем время и раз в 15 секунд перечитываем состояние.
    // Чаще нельзя — каждый проход читает половину таблицы и тратит суточную квоту.
    'setInterval(function(){' +
      'secs++;' +
      'if(auto&&secs>=15) load();' +
    '},1000);' +
    'load();' +
    '<\/script></body></html>';
}

// ─────────────────────────────────────────────────────────────
// СПУСТИТЬ ОТВЕТСТВЕННОСТЬ НА УРОВЕНЬ НИЖЕ
// Руководитель департамента перестаёт заполнять данные за все свои отделы;
// каждый отдел получает своего руководителя. Там, где своего руководителя
// в таблице нет, ничего не трогаем — подставлять некого, и выдумывать нельзя.
// ─────────────────────────────────────────────────────────────

/** Пункт меню. */
function спуститьОтветственность() {
  const html = HtmlService.createHtmlOutput(_окноСпуска_())
    .setWidth(720).setHeight(640);
  SpreadsheetApp.getUi().showModalDialog(html, 'Спустить ответственность на уровень ниже');
}

/**
 * Разбирает оргструктуру на департаменты и отделы.
 * Департамент — строка уровня 0–1; отделы — строки того же направления уровнем ниже.
 */
function _разборИерархии_() {
  const divs = _valuesOpt_(SH.DIV);
  const dm = _divMap_(divs);
  const byDir = {};

  for (let i = 1; i < divs.length; i++) {
    const unit = _cell_(divs[i], dm, 'unit');
    if (!unit) continue;
    const dir = _cell_(divs[i], dm, 'dir');
    const lvl = Number(_cell_(divs[i], dm, 'level') || 0);
    const rec = {
      row: i + 1, unit: unit, dir: dir, level: lvl,
      head: _cell_(divs[i], dm, 'head'),
      resp: _cell_(divs[i], dm, 'resp'),
      hrbp: _cell_(divs[i], dm, 'hrbp')
    };
    if (!byDir[dir]) byDir[dir] = { head: null, kids: [] };
    if (lvl <= 1 && !byDir[dir].head) byDir[dir].head = rec;
    else byDir[dir].kids.push(rec);
  }
  return { map: dm, byDir: byDir };
}

/** Что произойдёт при спуске. Ничего не меняет — только считает. */
function listDemote() {
  const h = _разборИерархии_();
  const comp = _valuesOpt_(SH.COMP);
  const cm = _compMap_(comp);
  const rowsPerUnit = {};
  for (let i = 1; i < comp.length; i++) {
    const u = _cell_(comp[i], cm, 'unit');
    if (u) rowsPerUnit[u] = (rowsPerUnit[u] || 0) + 1;
  }

  const move = [];      // отделы, которым есть кого поставить
  const stuck = [];     // отделы без своего руководителя
  const already = [];   // отделы, где свой руководитель уже назначен
  const depts = [];     // сами департаменты

  Object.keys(h.byDir).forEach(function (dir) {
    const d = h.byDir[dir];
    if (!d.head || !d.kids.length) return;          // одиночное подразделение — не трогаем
    const dHead = _normName_(d.head.head || d.head.resp);

    depts.push({
      row: d.head.row, unit: d.head.unit, dir: dir,
      resp: d.head.resp, rows: rowsPerUnit[d.head.unit] || 0, kids: d.kids.length
    });

    d.kids.forEach(function (k) {
      const own = _str_(k.head);
      const hasOwn = own && own !== '—' && _normName_(own) !== dHead;
      if (hasOwn) {
        if (_normName_(own) !== _normName_(k.resp)) {
          move.push({ row: k.row, unit: k.unit, dir: dir, from: k.resp, to: own,
                      rows: rowsPerUnit[k.unit] || 0 });
        } else {
          already.push({ unit: k.unit, dir: dir, resp: k.resp });
        }
      } else {
        stuck.push({ row: k.row, unit: k.unit, dir: dir, resp: k.resp,
                     rows: rowsPerUnit[k.unit] || 0 });
      }
    });
  });

  const sortBy = function (a, b) { return a.unit.localeCompare(b.unit, 'ru'); };
  move.sort(sortBy); stuck.sort(sortBy); depts.sort(sortBy);

  let deptRows = 0;
  depts.forEach(function (d) { deptRows += d.rows; });

  return {
    depts: depts, move: move, stuck: stuck, already: already,
    deptRows: deptRows,
    counts: { depts: depts.length, move: move.length, stuck: stuck.length,
              already: already.length }
  };
}

/**
 * Применяет спуск.
 * opts = { move: true|false, clearDepts: true|false }
 * ID пишем вместе с именем: имена в соседних колонках могут быть формулами,
 * тогда сработает только ID, и это правильный порядок.
 */
function runDemote(opts) {
  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(30000)) return { ok: false, error: 'Таблица занята, попробуйте ещё раз' };

    const plan = listDemote();
    const sh = _sheet_(SH.DIV);
    const width = Math.max(sh.getLastColumn(), 1);
    const dm = _divMap_([sh.getRange(1, 1, 1, width).getValues()[0]]);

    const put = function (row, key, value) {
      const c = dm[key];
      if (c === undefined || c < 0 || c >= width) return;
      const cell = sh.getRange(row, c + 1);
      if (cell.getFormula()) return;              // формулу не трогаем
      cell.setValue(value);
    };

    let moved = 0, cleared = 0;

    if (opts && opts.move) {
      plan.move.forEach(function (m) {
        put(m.row, 'idResp', _idПо_('people', m.to));
        put(m.row, 'resp', m.to);
        moved++;
      });
    }

    if (opts && opts.clearDepts) {
      plan.depts.forEach(function (d) {
        put(d.row, 'idResp', '');
        put(d.row, 'resp', '');
        cleared++;
      });
    }

    SpreadsheetApp.flush();
    _сброситьСправочник_();
    _создатьПользователей_(false);      // роли и доступы пересобираем сразу
    пересчитатьСтатусы_(true);
    SpreadsheetApp.flush();

    _log_('меню', 'спуск ответственности',
      'отделов переназначено: ' + moved + ', департаментов очищено: ' + cleared);

    const after = listDemote();
    return { ok: true, moved: moved, cleared: cleared,
             stuck: after.stuck.length, plan: after };
  } catch (e) {
    return { ok: false, error: 'Ошибка: ' + e.message };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function _окноСпуска_() {
  return '<!DOCTYPE html><html><head><base target="_top"><style>' +
    'body{font:13.5px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;' +
      'margin:0;padding:14px;color:#16202a}' +
    'h3{margin:0 0 4px;font-size:15px}p.h{color:#66737f;margin:0 0 12px;font-size:12.5px;line-height:1.45}' +
    '.sum{display:flex;gap:8px;margin-bottom:12px}' +
    '.sum div{flex:1;border-radius:9px;padding:9px 10px;font-size:12.5px;text-align:center;line-height:1.35}' +
    '.s-ok{background:#e3f5ea;color:#1a7f4b}.s-warn{background:#fdf3e0;color:#8a5a00}' +
    '.s-n{background:#eef1f3;color:#3a4a47}' +
    '.box{border:1px solid #e2e6ea;border-radius:10px;padding:12px;margin:12px 0}' +
    '.box label{display:flex;gap:10px;align-items:flex-start;margin-bottom:10px;cursor:pointer}' +
    '.box label:last-child{margin-bottom:0}' +
    'details{margin:10px 0}summary{cursor:pointer;font-weight:600;font-size:13px}' +
    'table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12.5px}' +
    'td{padding:5px 6px;border-bottom:1px solid #eef1f3;vertical-align:top}' +
    '.warn{background:#fdf3e0;color:#8a5a00;border-radius:8px;padding:10px 12px;font-size:12.5px;' +
      'line-height:1.45;margin:10px 0}' +
    '.err{background:#fdecea;color:#c0392b;border-radius:8px;padding:10px 12px;margin:10px 0}' +
    '.ok{background:#e3f5ea;border:1px solid #1a7f4b;border-radius:10px;padding:14px;margin:6px 0}' +
    '.act{display:flex;gap:10px;margin-top:14px}' +
    'button{font:inherit;flex:1;min-height:40px;border-radius:9px;border:1px solid #e2e6ea;' +
      'background:#fff;cursor:pointer}' +
    'button.go{background:#1f6feb;border-color:#1f6feb;color:#fff;font-weight:600}' +
    'button:disabled{opacity:.5;cursor:default}' +
    '</style></head><body><div id="app">Считаем…</div><script>' +
    'var D=null;' +
    'google.script.run.withSuccessHandler(function(d){D=d;draw();}).listDemote();' +
    'function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){' +
      'return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}' +
    'function rows(list,f){return list.map(f).join("");}' +
    'function draw(){' +
      'var h="<h3>Спустить ответственность на уровень ниже</h3>"+' +
        '"<p class=h>Руководитель департамента перестанет заполнять данные за отделы. ' +
        'Каждый отдел получит своего руководителя из колонки «Руководитель».</p>";' +
      'h+="<div class=sum>"+' +
        '"<div class=s-n>департаментов<br><b>"+D.counts.depts+"</b></div>"+' +
        '"<div class=s-ok>уже со своим<br><b>"+D.counts.already+"</b></div>"+' +
        '"<div class=s-ok>переедет<br><b>"+D.counts.move+"</b></div>"+' +
        '"<div class=s-warn>некому передать<br><b>"+D.counts.stuck+"</b></div></div>";' +
      'if(D.counts.move){' +
        'h+="<details open><summary>Отделы, которым назначим своего руководителя ("+D.counts.move+")</summary><table>"+' +
          'rows(D.move,function(m){return "<tr><td>"+esc(m.unit)+"</td><td>"+esc(m.from||"—")+" → <b>"+esc(m.to)+"</b></td></tr>";})+' +
          '"</table></details>";' +
      '}' +
      'if(D.counts.stuck){' +
        'h+="<details><summary>Отделы без своего руководителя ("+D.counts.stuck+") — останутся как есть</summary>"+' +
          '"<table>"+rows(D.stuck,function(m){return "<tr><td>"+esc(m.unit)+"</td><td>"+esc(m.resp||"—")+"</td></tr>";})+' +
          '"</table></details>";' +
      '}' +
      'h+="<div class=box>"+' +
        '"<label><input type=checkbox id=cMove checked><span><b>Назначить отделам их руководителей</b>"+' +
          '"<br><small>"+D.counts.move+" отделов</small></span></label>"+' +
        '"<label><input type=checkbox id=cClear><span><b>Снять ответственного с самих департаментов</b>"+' +
          '"<br><small>"+D.counts.depts+" департаментов, за ними "+D.deptRows+" строк конкурентов — ' +
          'после снятия их никто не увидит, пока не назначите кого-то</small></span></label></div>";' +
      'if(D.counts.stuck){' +
        'h+="<div class=warn>У "+D.counts.stuck+" отделов в колонке «Руководитель» стоит тот же человек, ' +
          'что и у департамента, либо пусто. Подставить некого — эти строки не изменятся. ' +
          'Выгрузите список, впишите ФИО и вернитесь сюда.</div>"+' +
          '"<div class=act><button onclick=expList()>Выгрузить список на лист</button>"+' +
          '"<button onclick=applyList()>Забрать вписанные ФИО</button></div>";' +
      '}' +
      'h+="<div id=err></div><div class=act><button onclick=google.script.host.close()>Отмена</button>"+' +
        '"<button class=go id=go onclick=go()>Применить</button></div>";' +
      'document.getElementById("app").innerHTML=h;' +
    '}' +
    'function expList(){' +
      'document.getElementById("err").innerHTML="Выгружаем…";' +
      'google.script.run.withSuccessHandler(function(r){' +
        'document.getElementById("err").innerHTML="<div class=warn>Лист «Нужны руководители» готов: "+' +
          'r.count+" строк. Впишите ФИО в колонку «Новый руководитель», потом нажмите ' +
          '«Забрать вписанные ФИО».</div>";' +
      '}).exportNeedHeads();' +
    '}' +
    'function applyList(){' +
      'document.getElementById("err").innerHTML="Забираем…";' +
      'google.script.run.withSuccessHandler(function(r){' +
        'if(!r||!r.ok){document.getElementById("err").innerHTML=' +
          '"<div class=err>"+esc((r&&r.error)||"Не удалось")+"</div>";return;}' +
        'var t="Назначено руководителей: <b>"+r.done+"</b>";' +
        'if(r.skipped&&r.skipped.length) t+="<br>Пропущено: "+esc(r.skipped.join("; "));' +
        'document.getElementById("err").innerHTML="<div class=ok>"+t+"</div>";' +
        'google.script.run.withSuccessHandler(function(d){D=d;draw();}).listDemote();' +
      '}).applyNeedHeads();' +
    '}' +
    'function go(){' +
      'var o={move:document.getElementById("cMove").checked,' +
             'clearDepts:document.getElementById("cClear").checked};' +
      'if(!o.move&&!o.clearDepts){document.getElementById("err").innerHTML=' +
        '"<div class=err>Отметьте хотя бы одно действие</div>";return;}' +
      'var b=document.getElementById("go");b.disabled=true;b.textContent="Применяем…";' +
      'google.script.run.withSuccessHandler(done).withFailureHandler(function(e){' +
        'b.disabled=false;b.textContent="Применить";' +
        'document.getElementById("err").innerHTML="<div class=err>"+esc(e.message||"Ошибка")+"</div>";' +
      '}).runDemote(o);' +
    '}' +
    'function done(r){' +
      'if(!r||!r.ok){var b=document.getElementById("go");if(b){b.disabled=false;b.textContent="Применить";}' +
        'document.getElementById("err").innerHTML="<div class=err>"+esc((r&&r.error)||"Не удалось")+"</div>";return;}' +
      'var h="<h3>Готово</h3><div class=ok>"+' +
        '"Отделам назначены свои руководители: <b>"+r.moved+"</b><br>"+' +
        '"Департаментов очищено: <b>"+r.cleared+"</b><br>"+' +
        '"Осталось без своего руководителя: <b>"+r.stuck+"</b></div>";' +
      'if(r.stuck){h+="<div class=warn>По этим отделам впишите руководителей в лист «Подразделения» ' +
        'и запустите пункт ещё раз.</div>";}' +
      'h+="<div class=warn>Учётные записи и статусы уже пересчитаны. ' +
        'Откатить можно через Файл → История версий.</div>";' +
      'h+="<div class=act><button class=go onclick=google.script.host.close()>Закрыть</button></div>";' +
      'document.getElementById("app").innerHTML=h;' +
    '}' +
    '<\/script></body></html>';
}

/**
 * Выгружает отделы, которым некого назначить, на лист «Нужны руководители».
 * Вы вписываете ФИО в колонку «Новый руководитель» — и вторым действием
 * они переносятся в «Подразделения». Иначе назначать некого: в оргструктуре
 * у этих отделов стоит руководитель департамента.
 */
function exportNeedHeads() {
  const plan = listDemote();
  const sh = _sheet_(SH.NEED, true);
  sh.clear();

  const head = ['ID', 'Подразделение', 'Направление', 'Сейчас отвечает',
                'Новый руководитель', 'Строк конкурентов'];
  sh.getRange(1, 1, 1, head.length).setValues([head])
    .setFontWeight('bold').setBackground('#fff2cc');
  sh.setFrozenRows(1);

  if (plan.stuck.length) {
    const divs = _valuesOpt_(SH.DIV);
    const dm = _divMap_(divs);
    const pid = {};
    for (let i = 1; i < divs.length; i++) {
      const u = _cell_(divs[i], dm, 'unit');
      if (u) pid[u] = _cell_(divs[i], dm, 'idUnit');
    }
    const rows = plan.stuck.map(function (s) {
      return [pid[s.unit] || '', s.unit, s.dir, s.resp || '', '', s.rows];
    });
    sh.getRange(2, 1, rows.length, head.length).setValues(rows);
    sh.getRange(2, 5, rows.length, 1).setBackground('#fff2cc');
  }
  sh.setColumnWidth(2, 300); sh.setColumnWidth(3, 260);
  sh.setColumnWidth(4, 240); sh.setColumnWidth(5, 240);
  _ss_().setActiveSheet(sh);
  return { ok: true, count: plan.stuck.length };
}

/**
 * Переносит вписанные ФИО с листа «Нужны руководители» в «Подразделения»:
 * человек становится и руководителем отдела, и ответственным за обзор.
 */
function applyNeedHeads() {
  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(30000)) return { ok: false, error: 'Таблица занята, попробуйте ещё раз' };

    const need = _valuesOpt_(SH.NEED);
    if (need.length < 2) return { ok: false, error: 'Лист «' + SH.NEED + '» пуст — сначала выгрузите список' };

    const sh = _sheet_(SH.DIV);
    const width = Math.max(sh.getLastColumn(), 1);
    const dm = _divMap_([sh.getRange(1, 1, 1, width).getValues()[0]]);
    const rows = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), width).getValues();

    const rowOf = {};
    for (let i = 1; i < rows.length; i++) {
      const u = _cell_(rows[i], dm, 'unit');
      if (u) rowOf[_normName_(u)] = i + 1;
    }

    const put = function (row, key, value) {
      const c = dm[key];
      if (c === undefined || c < 0 || c >= width) return;
      const cell = sh.getRange(row, c + 1);
      if (cell.getFormula()) return;
      cell.setValue(value);
    };

    let done = 0;
    const skipped = [];
    for (let i = 1; i < need.length; i++) {
      const unit = _str_(need[i][1]);
      const who = _str_(need[i][4]);
      if (!unit || !who) continue;
      if (_похожеНаId_(who)) { skipped.push(unit + ' — в колонке стоит ID, а не ФИО'); continue; }
      const r = rowOf[_normName_(unit)];
      if (!r) { skipped.push(unit + ' — не найдено в «' + SH.DIV + '»'); continue; }

      // Человека может ещё не быть в справочнике — заводим, чтобы связь по ID работала
      const pid = _добавитьВСправочник_('people', who);
      put(r, 'idHead', pid); put(r, 'head', who);
      put(r, 'idResp', pid); put(r, 'resp', who);
      done++;
    }

    SpreadsheetApp.flush();
    _сброситьСправочник_();
    _создатьПользователей_(false);
    пересчитатьСтатусы_(true);
    SpreadsheetApp.flush();

    _log_('меню', 'назначены руководители отделов', 'назначено: ' + done);
    return { ok: true, done: done, skipped: skipped };
  } catch (e) {
    return { ok: false, error: 'Ошибка: ' + e.message };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ─────────────────────────────────────────────────────────────
// ИСПРАВЛЕНИЕ СЕГМЕНТОВ КОМПАНИЙ
// ─────────────────────────────────────────────────────────────

/**
 * Исправляет ошибочные сегменты и дубли компаний в листах
 * «Конкуренты» и «Справочник компаний».
 *
 * Запуск: меню «Обзор рынка → Проверка → Исправить сегменты компаний»
 * или вызвать из редактора скриптов.
 */
function исправитьСегментыКомпаний() {
  const ui = SpreadsheetApp.getUi();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    ui.alert('Ошибка', 'Другой процесс заблокировал таблицу. Попробуйте через минуту.', ui.ButtonSet.OK);
    return;
  }

  try {
    // ═══ 1. ПРАВИЛА ИСПРАВЛЕНИЯ СЕГМЕНТОВ ═══
    // Сопоставляем по нормализованному имени, латинице/кириллице и по ID компании
    const isAHT = function(name, id) {
      const n = _normName_(name).replace(/[^a-zа-я0-9]/g, '');
      const i = _normName_(id).replace(/[^a-zа-я0-9]/g, '');
      return n === 'ант' || n === 'aht' || n === 'ant' || n === 'aнт' || i === 'k18' || i === 'к18';
    };

    const isOzoda = function(name) {
      const n = _normName_(name);
      return n.indexOf('озода') >= 0 && n.indexOf('косметик') >= 0;
    };

    const isMolochnaya = function(name) {
      const n = _normName_(name);
      return n.indexOf('молочная радость') >= 0;
    };

    const isOrdiFatir = function(name) {
      const n = _normName_(name);
      return n.indexOf('орди фатир') >= 0 || n.indexOf('ордифатир') >= 0;
    };

    const isSeganch = function(name) {
      const n = _normName_(name);
      return n.indexOf('сеганч') >= 0 || n.indexOf('сеганҷ') >= 0;
    };

    // ═══ 2. КАРТА ДУБЛЕЙ ═══
    const dupeMap = {
      'хочидавлат':       'Хочи Давлат',
      'хочидаврон':       'Хочи Даврон',
      'хочиобид- рухак':  'Хочи Обид',
      'ҷдмм "сахо"':      'Сахо',
      'ҷсп "зухал"':      'Зухал',
      'ҷдмм "аҷр"':       'АҶР',
    };

    // ═══ 3. ИСПРАВЛЯЕМ ЛИСТ «КОНКУРЕНТЫ» ═══
    const compSh = _sheet_(SH.COMP);
    const compLr = compSh.getLastRow();
    const compLc = compSh.getLastColumn();
    let compFixed = 0, dupeFixed = 0;

    if (compLr > 1 && compLc > 0) {
      const allData = compSh.getRange(1, 1, compLr, compLc).getValues();
      const header = allData[0].map(function(h) { return _str_(h); });
      
      // Ищем реальные номера колонок по заголовкам
      let colComp = -1, colIdComp = -1, colSeg = -1;
      for (let c = 0; c < header.length; c++) {
        const h = _normName_(header[c]);
        if (h.indexOf('компания') >= 0 && h.indexOf('id') < 0 && h.indexOf('ид') < 0) colComp = c + 1;
        if (h === 'id комп' || h === 'id_комп' || h === 'id компания' || h === 'ид комп') colIdComp = c + 1;
        if (h === 'сегмент' || h === 'отрасль') colSeg = c + 1;
      }
      
      // Запасные позиции, если заголовки не распознаны
      if (colComp < 0) colComp = 7;
      if (colSeg < 0) colSeg = 9;

      for (let r = 2; r <= compLr; r++) {
        const row = allData[r - 1];
        const name = _str_(row[colComp - 1]);
        const idComp = colIdComp > 0 ? _str_(row[colIdComp - 1]) : '';
        const curSeg = _str_(row[colSeg - 1]);

        let newSeg = null;
        if (isAHT(name, idComp)) {
          newSeg = 'Телеком';
        } else if (isOzoda(name)) {
          newSeg = 'Пр-во/текстиль';
        } else if (isMolochnaya(name)) {
          newSeg = 'Молочное пр-во';
        } else if (isOrdiFatir(name)) {
          newSeg = 'Мукомольное пр-во';
        } else if (isSeganch(name)) {
          newSeg = 'РБУ / товарный бетон';
        }

        if (newSeg && curSeg !== newSeg) {
          compSh.getRange(r, colSeg).setValue(newSeg);
          compFixed++;
        }

        // Исправляем дубли
        const norm = _normName_(name);
        if (dupeMap[norm] && name !== dupeMap[norm]) {
          compSh.getRange(r, colComp).setValue(dupeMap[norm]);
          dupeFixed++;
        }
      }
    }

    // ═══ 4. ИСПРАВЛЯЕМ ЛИСТ «СПРАВОЧНИК КОМПАНИЙ» ═══
    const dictSh = _findSheet_(SH.DICT);
    let dictFixed = 0;

    if (dictSh && dictSh.getLastRow() > 1) {
      const dictLr = dictSh.getLastRow();
      const dictData = dictSh.getRange(1, 1, dictLr, Math.max(dictSh.getLastColumn(), 7)).getValues();

      for (let r = 2; r <= dictLr; r++) {
        const row = dictData[r - 1];
        const name = _str_(row[1]);
        const curSeg = _str_(row[2]);

        let newSeg = null;
        if (isAHT(name, '')) {
          newSeg = 'Телеком';
        } else if (isOzoda(name)) {
          newSeg = 'Пр-во/текстиль';
        } else if (isMolochnaya(name)) {
          newSeg = 'Молочное пр-во';
        } else if (isOrdiFatir(name)) {
          newSeg = 'Мукомольное пр-во';
        } else if (isSeganch(name)) {
          newSeg = 'РБУ / товарный бетон';
        }

        if (newSeg && curSeg !== newSeg) {
          dictSh.getRange(r, 3).setValue(newSeg);
          dictFixed++;
        }
      }
    }

    SpreadsheetApp.flush();

    // ═══ 5. ОБНОВЛЯЕМ СВОДНЫЙ СПРАВОЧНИК ═══
    const compCount = _обновитьСправочникКомпаний_();

    _log_('меню', 'исправление сегментов',
      'сегментов в Конкурентах: ' + compFixed +
      ', дублей в Конкурентах: ' + dupeFixed +
      ', сегментов в Справочнике: ' + dictFixed +
      ', итого компаний: ' + compCount);

    ui.alert('Исправление завершено',
      '✅ Обновлено строк в листе «Конкуренты»: ' + compFixed + '\n' +
      '✅ Обновлено дублей: ' + dupeFixed + '\n' +
      '✅ Обновлено в «Справочнике компаний»: ' + dictFixed + '\n' +
      '✅ Всего уникальных компаний: ' + compCount + '\n\n' +
      'АНТ переведён в сегмент: Телеком.',
      ui.ButtonSet.OK);

  } catch (e) {
    ui.alert('Ошибка', 'Не удалось исправить: ' + e.message, ui.ButtonSet.OK);
    _log_('ошибка', 'исправление сегментов', e.message);
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ─────────────────────────────────────────────────────────────
// РАСШИРЕННЫЙ АНАЛИТИЧЕСКИЙ ДАШБОРД И ПАНЕЛЬ АДМИНИСТРАТОРА
// ─────────────────────────────────────────────────────────────

/**
 * Расширенный аналитический дашборд для C&B и руководства:
 * - Сводные показатели сбора данных
 * - Прогресс по HR BP и Дирекциям
 * - Анализ заработных плат по должностям: Min, P25, Median, P75, Max, размах вилки, детализация по компаниям
 * - Анализ соцпакета и бенефитов (топ льгот с процентами охвата)
 * - Анализ структуры бонусов (типы премий, периодичность)
 * - Топ упоминаемых компаний-конкурентов
 */
function apiCBDashboardExtended(token, filters) {
  try {
    const u = _auth_(token);
    if (u.role !== 'admin' && u.role !== 'cb' && u.role !== 'hrbp' && u.role !== 'dir_head') {
      return { ok: false, error: 'Недостаточно прав для просмотра аналитического дашборда' };
    }

    filters = filters || {};
    const filterDir = _str_(filters.dir);
    const filterHrbp = _str_(filters.hrbp);
    const searchPos = _str_(filters.search).toLowerCase();

    const surv = _valuesOpt_(SH.SURVEY);
    const comp = _valuesOpt_(SH.COMP);
    const divs = _valuesOpt_(SH.DIV);
    const dm = _divMap_(divs);
    const cm = _compMap_(comp);

    // Карта подразделений
    const unitMap = {};
    for (let i = 1; i < divs.length; i++) {
      const un = _cell_(divs[i], dm, 'unit');
      if (!un) continue;
      unitMap[un] = {
        dir: _cell_(divs[i], dm, 'dir'),
        head: _cell_(divs[i], dm, 'head'),
        resp: _cell_(divs[i], dm, 'resp'),
        hrbp: _cell_(divs[i], dm, 'hrbp'),
        totalComp: 0,
        doneComp: 0,
        askComp: 0,
        surveysCount: 0
      };
    }

    // Подсчет конкурентов по подразделениям
    for (let i = 1; i < comp.length; i++) {
      const un = _cell_(comp[i], cm, 'unit');
      if (!unitMap[un]) continue;
      const actual = _cell_(comp[i], cm, 'actual');
      unitMap[un].totalComp++;
      const k = _класс_(actual);
      if (k === 'done') unitMap[un].doneComp++;
      else if (k === 'ask') unitMap[un].askComp++;
    }

    // Обработка данных обзора рынка
    let totalRecords = 0;
    let recordsWithSalary = 0;
    const posMap = {};
    const benefitStats = {};
    const bonusStats = { hasBonus: 0, noBonus: 0, unknown: 0, types: {}, periods: {} };
    const compRank = {};
    const curStats = {};

    for (let i = 1; i < surv.length; i++) {
      if (_str_(surv[i][V.STATE]) === 'удалена') continue;
      const un = _str_(surv[i][V.UNIT]);
      const uInfo = unitMap[un] || { dir: '', hrbp: '', resp: '' };

      // Применение фильтров
      if (filterDir && uInfo.dir !== filterDir) continue;
      if (filterHrbp && uInfo.hrbp !== filterHrbp) continue;

      const posOur = _str_(surv[i][V.POS_OUR]);
      const company = _str_(surv[i][V.COMPANY]);
      const pFrom = Number(_num_(surv[i][V.PAY_FROM])) || 0;
      const pTo = Number(_num_(surv[i][V.PAY_TO])) || 0;
      const cur = _str_(surv[i][V.CUR]) || 'сомони';
      const payPer = _str_(surv[i][V.PAY_PER]) || 'в месяц';
      const bonHas = _str_(surv[i][V.BON_HAS]).toLowerCase();
      const bonSize = _str_(surv[i][V.BON_SIZE]);
      const bonType = _str_(surv[i][V.BON_TYPE]);
      const bonPer = _str_(surv[i][V.BON_PER]);
      const benefits = _str_(surv[i][V.BENEFITS]) ? _str_(surv[i][V.BENEFITS]).split(';').map(function(s){ return s.trim(); }).filter(String) : [];
      const note = _str_(surv[i][V.NOTE]);

      if (searchPos && posOur.toLowerCase().indexOf(searchPos) < 0 && company.toLowerCase().indexOf(searchPos) < 0) {
        continue;
      }

      totalRecords++;
      if (unitMap[un]) unitMap[un].surveysCount++;
      if (company) compRank[company] = (compRank[company] || 0) + 1;
      curStats[cur] = (curStats[cur] || 0) + 1;

      // Бонусы
      if (bonHas === 'да') {
        bonusStats.hasBonus++;
        if (bonType) bonusStats.types[bonType] = (bonusStats.types[bonType] || 0) + 1;
        if (bonPer) bonusStats.periods[bonPer] = (bonusStats.periods[bonPer] || 0) + 1;
      } else if (bonHas === 'нет') {
        bonusStats.noBonus++;
      } else {
        bonusStats.unknown++;
      }

      // Льготы
      benefits.forEach(function(b) {
        benefitStats[b] = (benefitStats[b] || 0) + 1;
      });

      // Зарплатный анализ
      if (posOur) {
        if (!posMap[posOur]) {
          posMap[posOur] = {
            pos: posOur,
            count: 0,
            salarySamples: [],
            companies: []
          };
        }
        posMap[posOur].count++;

        let avgPay = 0;
        if (pFrom > 0 || pTo > 0) {
          recordsWithSalary++;
          avgPay = (pFrom > 0 && pTo > 0) ? Math.round((pFrom + pTo) / 2) : (pFrom || pTo);
          posMap[posOur].salarySamples.push(avgPay);
        }

        posMap[posOur].companies.push({
          company: company,
          unit: un,
          dir: uInfo.dir,
          pFrom: pFrom,
          pTo: pTo,
          avg: avgPay,
          cur: cur,
          payPer: payPer,
          bonHas: bonHas,
          bonSize: bonSize,
          bonType: bonType,
          bonPer: bonPer,
          benefits: benefits,
          note: note
        });
      }
    }

    // Перцентили и вилки
    const positionsList = Object.keys(posMap).map(function(k) {
      const item = posMap[k];
      const s = item.salarySamples.sort(function(a, b) { return a - b; });
      const n = s.length;
      let min = 0, p25 = 0, median = 0, p75 = 0, max = 0, avg = 0;

      if (n > 0) {
        min = s[0];
        max = s[n - 1];
        avg = Math.round(s.reduce(function(acc, v) { return acc + v; }, 0) / n);
        
        // P25
        const i25 = (n - 1) * 0.25;
        const l25 = Math.floor(i25);
        p25 = Math.round(s[l25] + (s[Math.min(l25 + 1, n - 1)] - s[l25]) * (i25 - l25));

        // Median (P50)
        const i50 = (n - 1) * 0.5;
        const l50 = Math.floor(i50);
        median = Math.round(s[l50] + (s[Math.min(l50 + 1, n - 1)] - s[l50]) * (i50 - l50));

        // P75
        const i75 = (n - 1) * 0.75;
        const l75 = Math.floor(i75);
        p75 = Math.round(s[l75] + (s[Math.min(l75 + 1, n - 1)] - s[l75]) * (i75 - l75));
      }

      return {
        pos: k,
        count: item.count,
        withSalaryCount: n,
        min: min,
        p25: p25,
        median: median,
        p75: p75,
        max: max,
        avg: avg,
        forkSpreadPct: (min > 0 && max > min) ? Math.round(((max - min) / min) * 100) : 0,
        companies: item.companies
      };
    }).sort(function(a, b) { return b.count - a.count; });

    // Прогресс по HR BP
    const hrbpGroups = {};
    const dirGroups = {};
    Object.keys(unitMap).forEach(function(un) {
      const u = unitMap[un];
      const hName = u.hrbp || 'Не назначен';
      const dName = u.dir || 'Без направления';

      if (!hrbpGroups[hName]) {
        hrbpGroups[hName] = { hrbp: hName, unitsTotal: 0, unitsDone: 0, compTotal: 0, compDone: 0, surveysTotal: 0 };
      }
      hrbpGroups[hName].unitsTotal++;
      if (u.totalComp > 0 && u.doneComp === u.totalComp) hrbpGroups[hName].unitsDone++;
      hrbpGroups[hName].compTotal += u.totalComp;
      hrbpGroups[hName].compDone += u.doneComp;
      hrbpGroups[hName].surveysTotal += u.surveysCount;

      if (!dirGroups[dName]) {
        dirGroups[dName] = { dir: dName, unitsTotal: 0, unitsDone: 0, compTotal: 0, compDone: 0, surveysTotal: 0 };
      }
      dirGroups[dName].unitsTotal++;
      if (u.totalComp > 0 && u.doneComp === u.totalComp) dirGroups[dName].unitsDone++;
      dirGroups[dName].compTotal += u.totalComp;
      dirGroups[dName].compDone += u.doneComp;
      dirGroups[dName].surveysTotal += u.surveysCount;
    });

    const hrbpProgress = Object.keys(hrbpGroups).map(function(k) {
      const g = hrbpGroups[k];
      g.pct = g.compTotal ? Math.round((g.compDone / g.compTotal) * 100) : 0;
      return g;
    }).sort(function(a, b) { return b.pct - a.pct; });

    const dirProgress = Object.keys(dirGroups).map(function(k) {
      const g = dirGroups[k];
      g.pct = g.compTotal ? Math.round((g.compDone / g.compTotal) * 100) : 0;
      return g;
    }).sort(function(a, b) { return b.pct - a.pct; });

    // Топ льгот
    const topBenefits = Object.keys(benefitStats).map(function(k) {
      return {
        name: k,
        count: benefitStats[k],
        pct: totalRecords ? Math.round((benefitStats[k] / totalRecords) * 100) : 0
      };
    }).sort(function(a, b) { return b.count - a.count; });

    // Топ компаний
    const topCompetitors = Object.keys(compRank).map(function(k) {
      return { company: k, count: compRank[k] };
    }).sort(function(a, b) { return b.count - a.count; }).slice(0, 30);

    const totalDivs = Object.keys(unitMap).length;
    const completedDivs = Object.keys(unitMap).filter(function(k) {
      return unitMap[k].totalComp > 0 && unitMap[k].doneComp === unitMap[k].totalComp;
    }).length;
    const totalComps = Object.keys(unitMap).reduce(function(acc, k) { return acc + unitMap[k].totalComp; }, 0);
    const checkedComps = Object.keys(unitMap).reduce(function(acc, k) { return acc + unitMap[k].doneComp; }, 0);

    return {
      ok: true,
      summary: {
        totalDivisions: totalDivs,
        completedDivisions: completedDivs,
        divCompletionPct: totalDivs ? Math.round((completedDivs / totalDivs) * 100) : 0,
        totalCompetitorLinks: totalComps,
        checkedCompetitorLinks: checkedComps,
        compCompletionPct: totalComps ? Math.round((checkedComps / totalComps) * 100) : 0,
        totalSurveyRecords: totalRecords,
        recordsWithSalary: recordsWithSalary,
        positionsCount: positionsList.length
      },
      hrbpProgress: hrbpProgress,
      dirProgress: dirProgress,
      positions: positionsList,
      topBenefits: topBenefits,
      bonuses: bonusStats,
      topCompetitors: topCompetitors,
      currencies: curStats,
      period: _период_()
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Список пользователей для панели администратора */
function apiAdminGetUsers(token) {
  try {
    const u = _auth_(token);
    if (u.role !== 'admin' && u.role !== 'cb') {
      return { ok: false, error: 'Доступ разрешён только Администраторам и C&B' };
    }

    const ush = _sheet_(SH.USERS);
    const uLr = ush.getLastRow();
    const uRows = uLr > 1 ? ush.getRange(2, 1, uLr - 1, 7).getValues() : [];

    const psh = _findSheet_(SH.PWD);
    const pRows = (psh && psh.getLastRow() > 1)
      ? psh.getRange(2, 1, psh.getLastRow() - 1, PWD_COLS).getValues()
      : [];

    const phoneMap = {};
    const pwdMap = {};
    pRows.forEach(function(r) {
      const login = _str_(r[PW.LOGIN]);
      if (login) {
        phoneMap[_normName_(login)] = _str_(r[PW.PHONE]);
        pwdMap[_normName_(login)] = _str_(r[PW.PWD]);
      }
    });

    const props = PropertiesService.getScriptProperties().getProperties();
    const tgLinkedLogins = {};
    Object.keys(props).forEach(function(k) {
      if (k.indexOf('tgchat_') === 0) {
        tgLinkedLogins[_normName_(props[k])] = true;
      }
    });

    const users = uRows.map(function(r, idx) {
      const login = _str_(r[U.LOGIN]);
      const normLog = _normName_(login);
      const unitsList = _str_(r[U.UNITS]).split(';').map(function(s){ return s.trim(); }).filter(String);
      return {
        row: idx + 2,
        login: login,
        fio: _str_(r[U.FIO]),
        role: _str_(r[U.ROLE]) || 'user',
        units: unitsList,
        active: (_str_(r[U.ACTIVE]) || 'да').toLowerCase() === 'да',
        lastIn: _дата_(r[U.LASTIN], true),
        phone: phoneMap[normLog] || '',
        hasPassword: !!pwdMap[normLog],
        hasTelegram: !!tgLinkedLogins[normLog]
      };
    });

    return { ok: true, users: users };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Сохранение / создание пользователя через панель администратора */
function apiAdminSaveUser(token, payload) {
  const lock = LockService.getScriptLock();
  try {
    const u = _auth_(token);
    if (u.role !== 'admin' && u.role !== 'cb') {
      return { ok: false, error: 'Доступ разрешён только Администраторам и C&B' };
    }
    if (!lock.tryLock(15000)) return { ok: false, error: 'Таблица занята, повторите попытку' };

    const fio = _str_(payload.fio);
    let login = _str_(payload.login);
    const role = _str_(payload.role) || 'user';
    const active = payload.active !== false ? 'да' : 'нет';
    const units = Array.isArray(payload.units) ? payload.units.map(_str_).filter(String) : [];
    const phone = _телефон_(payload.phone || '');
    const password = _str_(payload.password);

    if (!fio) return { ok: false, error: 'Укажите ФИО пользователя' };

    const ush = _sheet_(SH.USERS, true);
    const uLr = ush.getLastRow();
    const uRows = uLr > 1 ? ush.getRange(2, 1, uLr - 1, 7).getValues() : [];

    let targetRow = -1;
    for (let i = 0; i < uRows.length; i++) {
      if (login && _normName_(uRows[i][U.LOGIN]) === _normName_(login)) {
        targetRow = i + 2;
        break;
      }
    }

    if (targetRow > 0) {
      // Обновление существующего
      ush.getRange(targetRow, U.FIO + 1).setValue(fio);
      ush.getRange(targetRow, U.ROLE + 1).setValue(role);
      ush.getRange(targetRow, U.UNITS + 1).setValue(units.join('; '));
      ush.getRange(targetRow, U.ACTIVE + 1).setValue(active);
      if (password) {
        ush.getRange(targetRow, U.HASH + 1).setValue(_hash_(password));
      }
    } else {
      // Новый пользователь
      if (!login) {
        const taken = {};
        uRows.forEach(function(r){ taken[_normName_(r[U.LOGIN])] = true; });
        login = _makeLogin_(fio, taken);
      }
      const rawPwd = password || _makePassword_();
      const hash = _hash_(rawPwd);
      ush.appendRow([login, hash, fio, role, units.join('; '), active, '']);
      targetRow = ush.getLastRow();
      
      // Запись в пароли
      const psh = _подготовитьЛистПаролей_();
      psh.appendRow([fio, role, login, rawPwd, phone, units.length]);
    }

    // Синхронизация телефона в «Пароли (выдать)»
    if (phone || targetRow > 0) {
      _записатьТелефон_(login, phone);
    }

    _log_(u.login, 'админ правка пользователя', login + ' (' + fio + ', роль: ' + role + ')');
    SpreadsheetApp.flush();

    return { ok: true, login: login, message: 'Пользователь сохранён' };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Блокировка / разблокировка пользователя */
function apiAdminToggleUser(token, login, active) {
  try {
    const u = _auth_(token);
    if (u.role !== 'admin' && u.role !== 'cb') return { ok: false, error: 'Доступ ограничен' };
    const cleanLog = _str_(login);
    const user = _findUser_(cleanLog);
    if (!user) return { ok: false, error: 'Пользователь не найден' };

    const val = active ? 'да' : 'нет';
    _sheet_(SH.USERS).getRange(user.row, U.ACTIVE + 1).setValue(val);
    _log_(u.login, 'статус пользователя', cleanLog + ' ➔ ' + val);
    return { ok: true, active: active };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Сброс пароля пользователя администратором */
function apiAdminResetPassword(token, login) {
  try {
    const u = _auth_(token);
    if (u.role !== 'admin' && u.role !== 'cb') return { ok: false, error: 'Доступ ограничен' };
    const cleanLog = _str_(login);
    const user = _findUser_(cleanLog);
    if (!user) return { ok: false, error: 'Пользователь не найден' };

    const newPwd = _makePassword_();
    _sheet_(SH.USERS).getRange(user.row, U.HASH + 1).setValue(_hash_(newPwd));

    const psh = _findSheet_(SH.PWD);
    if (psh && psh.getLastRow() > 1) {
      const pRows = psh.getRange(2, 1, psh.getLastRow() - 1, PWD_COLS).getValues();
      for (let i = 0; i < pRows.length; i++) {
        if (_normName_(pRows[i][PW.LOGIN]) === _normName_(cleanLog)) {
          psh.getRange(i + 2, PW.PWD + 1).setValue(newPwd);
          break;
        }
      }
    }

    _log_(u.login, 'сброс пароля', cleanLog);
    return { ok: true, login: cleanLog, newPassword: newPwd };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Получение оргструктуры для панели администратора */
function apiAdminGetDivisions(token) {
  try {
    const u = _auth_(token);
    if (u.role !== 'admin' && u.role !== 'cb' && u.role !== 'hrbp') {
      return { ok: false, error: 'Доступ ограничен' };
    }

    const divs = _values_(SH.DIV);
    const dm = _divMap_(divs);
    const list = [];
    for (let i = 1; i < divs.length; i++) {
      const un = _cell_(divs[i], dm, 'unit');
      if (!un) continue;
      list.push({
        row: i + 1,
        num: _cell_(divs[i], dm, 'num') || i,
        dir: _cell_(divs[i], dm, 'dir'),
        unit: un,
        level: _cell_(divs[i], dm, 'level'),
        head: _cell_(divs[i], dm, 'head'),
        resp: _cell_(divs[i], dm, 'resp'),
        hrbp: _cell_(divs[i], dm, 'hrbp'),
        note: _cell_(divs[i], dm, 'note')
      });
    }

    return { ok: true, divisions: list };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Сохранение подразделения администратором */
function apiAdminSaveDivision(token, payload) {
  const lock = LockService.getScriptLock();
  try {
    const u = _auth_(token);
    if (u.role !== 'admin' && u.role !== 'cb') return { ok: false, error: 'Доступ ограничен' };
    if (!lock.tryLock(15000)) return { ok: false, error: 'Таблица занята' };

    const un = _str_(payload.unit);
    const dir = _str_(payload.dir);
    const head = _str_(payload.head);
    const resp = _str_(payload.resp);
    const hrbp = _str_(payload.hrbp);
    const note = _str_(payload.note);

    if (!un) return { ok: false, error: 'Укажите название подразделения' };

    const sh = _sheet_(SH.DIV);
    const lr = sh.getLastRow();
    const rows = sh.getRange(1, 1, lr, Math.max(sh.getLastColumn(), 9)).getValues();
    const dm = _divMap_(rows);

    for (let r = 2; r <= lr; r++) {
      if (_cell_(rows[r - 1], dm, 'unit') === un) {
        if (dm.dir >= 0 && dir) sh.getRange(r, dm.dir + 1).setValue(dir);
        if (dm.head >= 0) sh.getRange(r, dm.head + 1).setValue(head);
        if (dm.resp >= 0) sh.getRange(r, dm.resp + 1).setValue(resp);
        if (dm.hrbp >= 0 && hrbp) sh.getRange(r, dm.hrbp + 1).setValue(hrbp);
        if (dm.note >= 0) sh.getRange(r, dm.note + 1).setValue(note);
        break;
      }
    }

    _log_(u.login, 'правка подразделения', un + ' (руководитель: ' + head + ', ответственный: ' + resp + ')');
    SpreadsheetApp.flush();
    return { ok: true, message: 'Подразделение обновлено' };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Получение журнала аудита */
function apiAdminGetAuditLog(token, limit) {
  try {
    const u = _auth_(token);
    if (u.role !== 'admin' && u.role !== 'cb') return { ok: false, error: 'Доступ ограничен' };
    const lSh = _findSheet_(SH.LOG);
    if (!lSh || lSh.getLastRow() < 2) return { ok: true, logs: [] };

    const count = Math.min(limit || 100, lSh.getLastRow() - 1);
    const startRow = Math.max(2, lSh.getLastRow() - count + 1);
    const vals = lSh.getRange(startRow, 1, lSh.getLastRow() - startRow + 1, 4).getValues();

    const logs = vals.map(function(r) {
      return {
        dt: _дата_(r[0], true),
        login: _str_(r[1]),
        action: _str_(r[2]),
        detail: _str_(r[3])
      };
    }).reverse();

    return { ok: true, logs: logs };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Сервисные операции обслуживания в 1 клик через веб-панель */
function apiAdminRunMaintenance(token, taskType) {
  try {
    const u = _auth_(token);
    if (u.role !== 'admin' && u.role !== 'cb') return { ok: false, error: 'Доступ ограничен' };

    let msg = '';
    if (taskType === 'clean_segments') {
      исправитьСегментыКомпаний();
      msg = 'Сегменты и дубли компаний проверены и нормализованы.';
    } else if (taskType === 'fix_links') {
      починитьРасхождения_();
      msg = 'Расхождения и битые связи в листе «Связи» устранены.';
    } else if (taskType === 'sync_status') {
      пересчитатьСтатусы_(true);
      msg = 'Статусы заполнения и прогресс пересчитаны.';
    } else {
      return { ok: false, error: 'Неизвестный тип задачи: ' + taskType };
    }

    _log_(u.login, 'сервис ' + taskType, msg);
    return { ok: true, message: msg };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

