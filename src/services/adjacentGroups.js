'use strict';

/**
 * Автоопределение смежных групп подразделений.
 *
 * Смежная группа — площадки с одинаковой структурой должностей, отличающиеся
 * только «точкой»: регионом/городом ИЛИ производственной площадкой
 * (завод Г1/Б2/Т1, Анхор, ТМК, Фаровон…). Раньше группу заводил админ
 * вручную по каждому подразделению; здесь мы её ПРЕДЛАГАЕМ, а админ
 * подтверждает одной кнопкой (записывается общий group_key).
 *
 * Как ищем (в пределах одного направления, dir):
 *  - у названия отбрасываем ведущий код («0101 ») и хвостовой «различитель» —
 *    заглавное слово/аббревиатуру/номер (Душанбе, Анхор, Г1, КЗ-1, «3»);
 *    строчные смысловые слова («масла», «сырья», «продукции») НЕ режем —
 *    это часть роли, а не точка;
 *  - оставшийся «корень роли» — ключ группировки;
 *  - предлагаем только если в корне ≥2 площадок И ≥2 разных различителя
 *    (пустой различитель — головное подразделение — тоже считается).
 *  - подразделения с ручным group_key не трогаем.
 * Одиночки не предлагаются. saveSurveyDetails всё равно игнорирует группы <2.
 */

// Города/регионы Таджикистана — только для того, чтобы при объединении
// проставить осмысленный divisions.region. На саму группировку список
// больше не влияет (см. splitRoleAndPoint).
const REGION_TOKENS = [
  'Душанбе', 'Худжанд', 'Бохтар', 'Куляб', 'Кулоб', 'Хорог', 'Истаравшан',
  'Турсунзаде', 'Турсунзода', 'Вахдат', 'Канибадам', 'Исфара', 'Пенджикент',
  'Панджакент', 'Рашт', 'Рашта', 'Дангара', 'Гиссар', 'Хисор', 'Яван', 'Спитамен',
  'Гафуров', 'Б.Гафуров', 'Согд', 'Хатлон', 'РРП', 'ГБАО', 'Курган-Тюбе',
  'Кургантюбе', 'Нурек', 'Норак', 'Леваканд', 'Джиликуль', 'Восе', 'Фархор',
  'Шаартуз', 'Кабадиён', 'Носири-Хусрав', 'Джаббор-Расулов', 'Аштский',
  'Раштский', 'Пяндж', 'Балхи', 'Кушониён', 'Абдурахмони-Джоми', 'Навобод'
];
const REGION_SET = new Set(REGION_TOKENS.map(t => t.toLowerCase().replace(/ё/g, 'е')));

function norm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

// Отбрасываем ведущий числовой код («0101 », «12.3 »).
function stripCode(name) {
  return String(name || '').replace(/^\s*\d+[\s.\-–]*/, '').trim();
}

function regionRe(token) {
  return new RegExp('(^|[\\s,–-])' + token.replace(/[.\-]/g, '\\$&') + '\\s*$', 'i');
}

/** Регион подразделения по хвосту названия ('' если это не известный город). */
function detectRegion(unitName) {
  const n = stripCode(unitName);
  for (const t of REGION_TOKENS) {
    if (regionRe(t).test(n)) return t;
  }
  return '';
}

/**
 * Токен-хвост похож на «точку» (город / площадку / номер), а не на смысловое
 * слово роли: начинается с заглавной (кириллица/латиница), или это аббревиатура
 * из заглавных с цифрами/дефисом, или голое число. Строчные слова — не точка.
 */
function isPointToken(tok) {
  if (!tok) return false;
  if (/^\d+$/.test(tok)) return true;                       // «1», «3»
  if (/^[A-ZА-Я][A-ZА-Я0-9.\-]*$/.test(tok)) return true;   // «Г1», «КЗ-1», «ТМК», «T2», «ЖБИ»
  if (/^[A-ZА-Я][a-zа-я]+\d*$/.test(tok)) return true;      // «Анхор», «Душанбе», «Фаровон», «Навобод»
  return false;
}

/**
 * Делит название (без кода) на «корень роли» и «точку».
 * Отрезаем от конца подряд идущие point-токены, но оставляем в корне ≥2 слова.
 * Пример: «Хозяйственная служба Анхор 3» → { role:'Хозяйственная служба', point:'Анхор 3' }
 *         «Отдел оптовых продаж масла»   → { role:'Отдел оптовых продаж масла', point:'' }
 */
function splitRoleAndPoint(unitName) {
  const words = stripCode(unitName).split(/\s+/).filter(Boolean);
  const point = [];
  while (words.length >= 3 && isPointToken(words[words.length - 1])) {
    point.unshift(words.pop());
  }
  return { role: words.join(' '), point: point.join(' ') };
}

/**
 * Родительское/сводное подразделение — в предложения не берём:
 *  - ведущий код оканчивается на «00» («0100 Филиал ТД Душанбе» — узел филиала,
 *    под ним лежат 0101, 0102…);
 *  - явно исключено из обзоров (is_survey_target = 0);
 *  - на него ссылаются как на parent_unit другие подразделения.
 */
function isParentLike(d, parentUnitSet) {
  if (/^\s*\d+00(?=[\s.\-–]|$)/.test(String(d.unit || ''))) return true;
  if (d.is_survey_target != null && Number(d.is_survey_target) === 0) return true;
  if (parentUnitSet && parentUnitSet.has(String(d.unit || '').trim())) return true;
  return false;
}

/**
 * @param {Array<{unit:string, dir?:string, group_key?:string, region?:string, is_survey_target?:number, parent_unit?:string}>} divisions
 * @returns {Array<{key:string, dir:string, units:Array<{unit:string, region:string}>}>}
 */
function suggestAdjacentGroups(divisions) {
  const parentUnitSet = new Set(
    (divisions || [])
      .map(d => String((d && d.parent_unit) || '').trim())
      .filter(Boolean)
  );

  const buckets = {};
  (divisions || []).forEach(d => {
    if (!d || !d.unit) return;
    if (String(d.group_key || '').trim()) return; // ручной ключ — не предлагаем
    if (isParentLike(d, parentUnitSet)) return;   // родительские/сводные узлы
    const { role, point } = splitRoleAndPoint(d.unit);
    if (!role || role.split(/\s+/).length < 2) return; // корень роли из <2 слов — пропускаем
    const key = norm(d.dir || '') + ' :: ' + norm(role);
    (buckets[key] = buckets[key] || []).push({ d, role, point });
  });

  const out = [];
  Object.keys(buckets).forEach(bk => {
    const arr = buckets[bk];
    if (arr.length < 2) return;
    // Нужно ≥2 РАЗНЫХ непустых различителя. Пара «X» + «X 3» (одна площадка и
    // её пронумерованный под-узел) даёт лишь один непустой различитель — это
    // не смежная группа, а родитель/потомок.
    const points = new Set(arr.map(x => norm(x.point)).filter(Boolean));
    if (points.size < 2) return;

    const withReg = arr.map(x => ({
      unit: x.d.unit,
      region: detectRegion(x.d.unit) || String(x.d.region || '').trim()
        || (REGION_SET.has(norm(x.point)) ? x.point : '')
    }));

    out.push({
      key: arr[0].role.replace(/\s+/g, ' ').trim(),
      dir: arr[0].d.dir || '',
      units: withReg.sort((a, b) => a.unit.localeCompare(b.unit, 'ru'))
    });
  });

  // Ключ группы пишется в divisions.group_key и по нему matchится всё
  // сохранение (surveyController). Значит он должен быть УНИКАЛЕН: если одно
  // и то же имя роли встречается в разных направлениях («Производственный
  // цех» в комбикормах и в муке) — уточняем направлением.
  const keyCount = {};
  out.forEach(g => { keyCount[g.key] = (keyCount[g.key] || 0) + 1; });
  out.forEach(g => {
    if (keyCount[g.key] > 1 && g.dir) g.key = g.key + ' · ' + g.dir;
  });

  return out.sort((a, b) => a.key.localeCompare(b.key, 'ru'));
}

module.exports = { suggestAdjacentGroups, detectRegion, splitRoleAndPoint };
