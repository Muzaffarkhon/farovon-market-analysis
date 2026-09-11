'use strict';

/**
 * Грейдирование должностей и оценка рисков незаменимости ключевого персонала.
 *
 * Здесь только математика и классификаторы — без запросов к базе и без HTTP,
 * чтобы правила расчёта можно было прогонять тестами и менять в одном месте.
 * Источник правил — PLAN_GRADING_AND_KEY_PERSONNEL.md (разделы 3.1 и 3.2).
 *
 * Оценивается ТРЕБОВАНИЕ К ФУНКЦИИ (роли), а не человек: одна и та же
 * должность в разных цехах может получить разный грейд только если у неё
 * реально разные требования.
 */

const MIN_FACTOR = 1;
const MAX_FACTOR = 5;

/**
 * Четыре функциональные группы. У производства 4 фактора, у остальных 3 —
 * отсюда разная длина `weights`. `maxGrade` — самый низкий уровень шкалы:
 * у производства и вспомогательного персонала шкала 6 → 1, у торгового
 * и АУП 5 → 1.
 */
const GROUPS = {
  production: { label: 'Производственный персонал', weights: [0.30, 0.30, 0.25, 0.15], maxGrade: 6 },
  auxiliary:  { label: 'Вспомогательный персонал',  weights: [0.40, 0.30, 0.30],       maxGrade: 6 },
  sales:      { label: 'Торговый персонал',         weights: [0.50, 0.30, 0.20],       maxGrade: 5 },
  aup:        { label: 'АУП',                       weights: [0.40, 0.40, 0.20],       maxGrade: 5 }
};

const GROUP_KEYS = Object.keys(GROUPS);

/**
 * Нижние границы баллов по уровням, от старшего уровня к младшему.
 * Балл ниже 1.70 — это самый низкий уровень шкалы группы (6 у производства
 * и вспомогательного, 5 у торгового и АУП), поэтому отдельной строки в
 * таблице для него нет.
 */
const GRADE_THRESHOLDS = [
  { grade: 1, from: 4.60 },
  { grade: 2, from: 4.00 },
  { grade: 3, from: 3.30 },
  { grade: 4, from: 2.50 },
  { grade: 5, from: 1.70 }
];

/** Пороги суммарного индекса риска (4 фактора по 1–5, итого 4–20 баллов). */
const RISK_LEVELS = [
  {
    status: 'standard', label: 'Штатный сотрудник', max: 8,
    recommendation: 'Рисков нет, замена доступна в рабочем порядке.'
  },
  {
    status: 'attention', label: 'Зона внимания', max: 13,
    recommendation: 'Необходима плановая регламентация, составление карт наладки и инструкций.'
  },
  {
    status: 'critical', label: 'Критический риск незаменимости', max: 20,
    recommendation: 'Срочно назначить официального дублёра и оформить наставничество на 3–6 месяцев ' +
      'с временной персональной надбавкой. После аттестации дублёра надбавка снимается.'
  }
];

const RISK_FACTOR_LABELS = {
  bus_factor: 'Незаменимость (Bus Factor)',
  replacement_time: 'Срок замены',
  knowledge_monopoly: 'Монополия на знания',
  financial_risk: 'Цена ошибки или простоя'
};

const RISK_FACTOR_FIELDS = ['bus_factor', 'replacement_time', 'knowledge_monopoly', 'financial_risk'];

class GradingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GradingError';
  }
}

function normalizeGroup(groupType) {
  const key = String(groupType || '').trim().toLowerCase();
  if (!GROUPS[key]) {
    throw new GradingError('Неизвестная группа должностей: ' + (groupType || '(пусто)'));
  }
  return key;
}

/** Балл фактора — целое число от 1 до 5; «4», 4 и 4.0 принимаем, «высокий» — нет. */
function parseFactor(value, label) {
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < MIN_FACTOR || num > MAX_FACTOR) {
    throw new GradingError(`Оценка «${label}» должна быть целым числом от ${MIN_FACTOR} до ${MAX_FACTOR}`);
  }
  return num;
}

/**
 * Проверка ответов анкеты: количество оценок должно точно совпадать с числом
 * факторов группы — иначе оператор пропустил вопрос, и балл молча оказался бы
 * заниженным. Возвращает оценки, приведённые к числам.
 */
function normalizeFactors(groupType, factors) {
  const key = normalizeGroup(groupType);
  const { weights } = GROUPS[key];
  const list = Array.isArray(factors) ? factors : [];

  if (list.length !== weights.length) {
    throw new GradingError(
      `Для группы «${GROUPS[key].label}» нужно ${weights.length} оценок, получено ${list.length}`
    );
  }
  return list.map((value, i) => parseFactor(value, `Фактор ${i + 1}`));
}

/** Взвешенный балл должности: сумма «оценка фактора × вес фактора». */
function calcWeightedScore(groupType, factors) {
  const key = normalizeGroup(groupType);
  const { weights } = GROUPS[key];
  const score = normalizeFactors(key, factors).reduce((sum, value, i) => sum + value * weights[i], 0);
  return Math.round(score * 100) / 100;
}

/** Грейд (уровень) по взвешенному баллу. Чем выше балл — тем старше уровень. */
function calcGrade(groupType, score) {
  const key = normalizeGroup(groupType);
  const num = Number(score);
  if (!Number.isFinite(num)) throw new GradingError('Балл должности не рассчитан');

  const hit = GRADE_THRESHOLDS.find(t => num >= t.from);
  return hit ? hit.grade : GROUPS[key].maxGrade;
}

/** Полный расчёт по анкете грейдирования: балл + уровень одним вызовом. */
function evaluatePosition(groupType, factors) {
  const key = normalizeGroup(groupType);
  const values = normalizeFactors(key, factors);
  const weightedScore = calcWeightedScore(key, values);
  return {
    groupType: key,
    groupLabel: GROUPS[key].label,
    // Уже приведённые к числам оценки — их и пишем в базу (в теле запроса
    // приходят строки «5», а CHECK в SQLite строку не примет).
    factors: values,
    weightedScore,
    gradeLevel: calcGrade(key, weightedScore)
  };
}

/**
 * Индекс риска незаменимости: простая сумма четырёх оценок 1–5.
 * Веса здесь намеренно не применяются — все четыре фактора равнозначны
 * (уход носителя знаний бьёт по бизнесу одинаково, с какой стороны ни зайди).
 */
function evaluateRisk(answers) {
  const src = answers || {};
  const values = RISK_FACTOR_FIELDS.map(field => parseFactor(src[field], RISK_FACTOR_LABELS[field]));
  const totalScore = values.reduce((sum, v) => sum + v, 0);
  const level = RISK_LEVELS.find(l => totalScore <= l.max) || RISK_LEVELS[RISK_LEVELS.length - 1];

  return {
    factors: {
      bus_factor: values[0],
      replacement_time: values[1],
      knowledge_monopoly: values[2],
      financial_risk: values[3]
    },
    totalScore,
    status: level.status,
    statusLabel: level.label,
    recommendation: level.recommendation
  };
}

module.exports = {
  GROUPS,
  GROUP_KEYS,
  GRADE_THRESHOLDS,
  RISK_LEVELS,
  RISK_FACTOR_FIELDS,
  RISK_FACTOR_LABELS,
  GradingError,
  normalizeGroup,
  normalizeFactors,
  calcWeightedScore,
  calcGrade,
  evaluatePosition,
  evaluateRisk
};
