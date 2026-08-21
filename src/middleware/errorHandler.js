function errorHandler(err, req, res, next) {
  console.error('❌ Server Error:', err);

  const status = err.status || 500;
  const message = err.message || 'Внутренняя ошибка сервера';

  res.status(status).json({
    ok: false,
    error: err.code || 'SERVER_ERROR',
    message: message
  });
}

module.exports = errorHandler;
