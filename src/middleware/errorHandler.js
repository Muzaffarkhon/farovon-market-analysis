function errorHandler(err, req, res, next) {
  console.error('❌ Server Error:', err);

  const status = err.status || 500;

  // Для 5xx наружу отдаём общий текст: err.message может содержать детали
  // реализации, пути, куски SQL. Подробности остаются в логах Render.
  // Для 4xx (валидация и т.п.) текст ошибки полезен пользователю — оставляем.
  const message = status >= 500
    ? 'Внутренняя ошибка сервера'
    : (err.message || 'Ошибка запроса');

  res.status(status).json({
    ok: false,
    error: err.code || (status >= 500 ? 'SERVER_ERROR' : 'BAD_REQUEST'),
    message: message
  });
}

module.exports = errorHandler;
