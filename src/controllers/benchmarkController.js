const benchmarkService = require('../services/benchmarkService');
const benchmarkImportService = require('../services/benchmarkImportService');
const fxService = require('../services/fxService');
const xlsxReader = require('../services/xlsxReader');

exports.getSources = async (req, res) => {
  try {
    const sources = await benchmarkService.getSources();
    res.json({ ok: true, sources });
  } catch (err) {
    console.error('getSources error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка получения источников данных' });
  }
};

exports.setPositionWeights = async (req, res) => {
  try {
    const body = req.body || {};
    const saved = await benchmarkService.setPositionWeights(body.positionId, body.weights, req.user && (req.user.fio || req.user.login));
    res.json({ ok: true, weights: saved });
  } catch (err) {
    if (/не найдена/.test(err.message)) return res.status(404).json({ ok: false, error: err.message });
    console.error('setPositionWeights error:', err);
    res.status(500).json({ ok: false, error: 'Не удалось сохранить веса по должности' });
  }
};

exports.setSourceWeights = async (req, res) => {
  try {
    const saved = await benchmarkService.setSourceWeights(req.body && req.body.weights);
    res.json({ ok: true, weights: saved });
  } catch (err) {
    console.error('setSourceWeights error:', err);
    res.status(500).json({ ok: false, error: 'Не удалось сохранить веса источников' });
  }
};

exports.createSource = async (req, res) => {
  try {
    const { key, title, kind, isLicensed, defaultCurrency, notes } = req.body;
    const source = await benchmarkService.createSource({ key, title, kind, isLicensed, defaultCurrency, notes });
    res.json({ ok: true, source });
  } catch (err) {
    console.error('createSource error:', err);
    res.status(400).json({ ok: false, error: 'Не удалось создать источник данных' });
  }
};

exports.updateSource = async (req, res) => {
  try {
    const b = req.body || {};
    const source = await benchmarkService.updateSource(b.key, {
      title: b.title, kind: b.kind, defaultCurrency: b.defaultCurrency,
      isLicensed: b.isLicensed, notes: b.notes, hidden: b.hidden
    });
    res.json({ ok: true, source });
  } catch (err) {
    if (/не найден|нельзя|пустым/.test(err.message)) return res.status(400).json({ ok: false, error: err.message });
    console.error('updateSource error:', err);
    res.status(500).json({ ok: false, error: 'Не удалось изменить источник' });
  }
};

exports.getDatasets = async (req, res) => {
  try {
    const { sourceKey, state } = req.query;
    const datasets = await benchmarkService.getDatasets({ sourceKey, state });
    res.json({ ok: true, datasets });
  } catch (err) {
    console.error('getDatasets error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка получения датасетов' });
  }
};

exports.getSourcePositions = async (req, res) => {
  try {
    const { sourceKey } = req.params;
    const positions = await benchmarkService.getSourcePositions(sourceKey);
    res.json({ ok: true, positions });
  } catch (err) {
    console.error('getSourcePositions error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка получения должностей источника' });
  }
};

exports.getMappings = async (req, res) => {
  try {
    const { sourceKey } = req.query;
    const mappings = await benchmarkService.getMappings(sourceKey);
    res.json({ ok: true, mappings });
  } catch (err) {
    console.error('getMappings error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка получения сопоставлений' });
  }
};

exports.suggestMappings = async (req, res) => {
  try {
    const { sourceKey } = req.params;
    const suggestions = await benchmarkService.suggestMappings(sourceKey);
    res.json({ ok: true, suggestions });
  } catch (err) {
    console.error('suggestMappings error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка подбора сопоставлений' });
  }
};

exports.saveMapping = async (req, res) => {
  try {
    const { dictPositionId, sourcePositionId, confidence, note } = req.body;
    await benchmarkService.saveMapping({
      dictPositionId: Number(dictPositionId),
      sourcePositionId: Number(sourcePositionId),
      confidence,
      note,
      mappedBy: req.user.fio || req.user.login
    });
    res.json({ ok: true, message: 'Сопоставление сохранено' });
  } catch (err) {
    console.error('saveMapping error:', err);
    res.status(400).json({ ok: false, error: 'Ошибка сохранения сопоставления' });
  }
};

exports.deleteMapping = async (req, res) => {
  try {
    const { id } = req.params;
    await benchmarkService.deleteMapping(Number(id));
    res.json({ ok: true, message: 'Сопоставление удалено' });
  } catch (err) {
    console.error('deleteMapping error:', err);
    res.status(400).json({ ok: false, error: 'Ошибка удаления сопоставления' });
  }
};

/** Онлайн-курс валюты к сомони. */
exports.getFxRate = async (req, res) => {
  try {
    const r = await fxService.getRate(req.query.currency);
    res.json({ ok: true, ...r, currencies: fxService.CURRENCIES });
  } catch (err) {
    console.error('getFxRate error:', err.message);
    res.status(502).json({ ok: false, error: err.message, currencies: fxService.CURRENCIES });
  }
};

/** Листы загруженной книги Excel (файл приходит base64-строкой). */
exports.xlsxSheets = async (req, res) => {
  try {
    const buf = Buffer.from(String((req.body || {}).fileBase64 || ''), 'base64');
    const wb = xlsxReader.loadWorkbook(buf);
    res.json({ ok: true, sheets: wb.sheetNames() });
  } catch (err) {
    console.error('xlsxSheets error:', err.message);
    res.status(400).json({ ok: false, error: 'Не удалось прочитать файл: ' + err.message });
  }
};

/** Содержимое одного листа таблицей (до 3000 строк, до 40 колонок). */
exports.xlsxGrid = async (req, res) => {
  try {
    const b = req.body || {};
    const buf = Buffer.from(String(b.fileBase64 || ''), 'base64');
    const wb = xlsxReader.loadWorkbook(buf);
    const rows = wb.readSheet(String(b.sheet || ''), 3000).map(r => r.slice(0, 40));
    res.json({ ok: true, rows });
  } catch (err) {
    console.error('xlsxGrid error:', err.message);
    res.status(400).json({ ok: false, error: 'Не удалось прочитать лист: ' + err.message });
  }
};

exports.dryRunImport = async (req, res) => {
  try {
    const { sourceKey, text, mode, columnMap, currency, reportDate, dataAsOf, title, fxRate } = req.body;
    const report = await benchmarkImportService.dryRun({
      sourceKey, text, mode, columnMap, currency, reportDate, dataAsOf, title, fxRate
    });
    res.json({ ok: true, report });
  } catch (err) {
    console.error('dryRunImport error:', err);
    res.status(400).json({ ok: false, error: 'Ошибка предпросмотра импорта' });
  }
};

exports.commitImport = async (req, res) => {
  try {
    const { sourceKey, text, mode, columnMap, currency, reportDate, dataAsOf, title, fxRate, fxDate, methodology } = req.body;
    // Курс берём на сервере, а не из тела запроса: иначе загрузку можно было бы
    // «пересчитать» произвольным числом.
    let rate = 1, rateDate = '';
    if (currency && fxService.normCode(currency) !== 'TJS') {
      const r = await fxService.getRate(currency);
      rate = r.rate; rateDate = r.date;
    }
    const result = await benchmarkImportService.commit({
      sourceKey, text, mode, columnMap, currency, reportDate, dataAsOf, title, user: req.user,
      fxRate: rate, fxDate: rateDate, methodology
    });
    res.json({ ok: true, result, message: 'Датасет успешно импортирован' });
  } catch (err) {
    console.error('commitImport error:', err);
    res.status(400).json({ ok: false, error: 'Ошибка сохранения датасета' });
  }
};

exports.compare = async (req, res) => {
  try {
    const { positionId, positionName } = req.query;
    const result = await benchmarkService.compare({
      positionId: positionId ? Number(positionId) : null,
      positionName,
      user: req.user
    });
    res.json({ ok: true, result });
  } catch (err) {
    console.error('compare error:', err);
    res.status(400).json({ ok: false, error: 'Ошибка формирования сравнения' });
  }
};

exports.deleteDataset = async (req, res) => {
  try {
    const { id } = req.params;
    await benchmarkService.deleteDataset(Number(id));
    res.json({ ok: true, message: 'Датасет успешно удален' });
  } catch (err) {
    console.error('deleteDataset error:', err);
    res.status(400).json({ ok: false, error: 'Ошибка удаления датасета' });
  }
};

exports.exportMatrix = async (req, res) => {
  try {
    const csv = await benchmarkService.exportMatrix({ user: req.user });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="farovon_benchmark_matrix.csv"');
    res.send(csv);
  } catch (err) {
    console.error('exportMatrix error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка экспорта матрицы' });
  }
};

exports.getSummaryWidgets = async (req, res) => {
  try {
    const widgets = await benchmarkService.getBenchmarkSummaryWidgets({ user: req.user });
    res.json({ ok: true, widgets });
  } catch (err) {
    console.error('getSummaryWidgets error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка загрузки виджетов' });
  }
};
