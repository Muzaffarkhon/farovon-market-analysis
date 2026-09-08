// Точка входа Vercel: то же Express-приложение, завёрнутое в одну
// serverless-функцию. src/server.js экспортирует app и вызывает app.listen
// только при прямом запуске (require.main === module), поэтому здесь достаточно
// реэкспорта — Vercel сам вызывает экспортированный обработчик на каждый запрос.
//
// Маршрутизация: vercel.json переписывает все пути на /api, дальше внутренний
// роутинг Express разбирает и статику client/, и /api/*, и SPA-fallback.
module.exports = require('../src/server.js');
