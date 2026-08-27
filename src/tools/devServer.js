const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const express = require('express');
const path = require('path');

const PORT = parseInt(process.env.PORT || '3000', 10);
const TARGET_URL = 'https://farovon-market-analysis.onrender.com';

const app = express();

// Читаем тело запроса
app.use(express.raw({ type: '*/*', limit: '20mb' }));

// Проксируем /api и /health к живому бэкенду Render с автоповтором при прогреве
app.all(['/api', '/api/*', '/health'], async (req, res) => {
  const targetUrl = TARGET_URL + req.originalUrl;
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (k.toLowerCase() !== 'host' && k.toLowerCase() !== 'connection') {
      headers[k] = v;
    }
  }

  const fetchOptions = {
    method: req.method,
    headers: headers,
    signal: AbortSignal.timeout(60000)
  };

  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Buffer.isBuffer(req.body) && req.body.length > 0) {
    fetchOptions.body = req.body;
  }

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const proxyRes = await fetch(targetUrl, fetchOptions);
      res.status(proxyRes.status);
      
      proxyRes.headers.forEach((val, key) => {
        if (key.toLowerCase() !== 'content-encoding' && key.toLowerCase() !== 'transfer-encoding') {
          res.setHeader(key, val);
        }
      });

      const buffer = await proxyRes.arrayBuffer();
      return res.send(Buffer.from(buffer));
    } catch (err) {
      lastError = err;
      console.warn(`⚠️ Попытка ${attempt}/3 проксирования к Render (${targetUrl}) не удалась:`, err.message);
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  console.error('❌ Proxy error after 3 attempts:', lastError?.message);
  res.status(502).json({ ok: false, error: 'Сервер Render просыпается (cold start). Повторите через 5-10 секунд: ' + lastError?.message });
});

// Отдаём локальный статический фронтенд из public/
app.use(express.static(path.join(__dirname, '../../public')));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🚀 Локальный хост для тестирования запущен: http://localhost:${PORT}`);
  console.log(`📁 Фронтенд (локально): public/ (любые правки видны мгновенно при F5)`);
  console.log(`🔗 Бэкенд и База Данных (прокси): ${TARGET_URL}\n`);
});
