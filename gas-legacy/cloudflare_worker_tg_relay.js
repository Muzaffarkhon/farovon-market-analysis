/**
 * CLOUDFLARE WORKER: РЕЛЕ ДЛЯ TELEGRAM-БОТА ОБЗОРА РЫНКА (ГК «ФАРОВОН»)
 *
 * Назначение:
 * Принимает входящие вебхуки от Telegram и пересылает их в
 * Google Apps Script Web App (GAS), автоматически следуя перенаправлениям 302.
 *
 * Инструкция по установке:
 * 1. Войдите на https://dash.cloudflare.com
 * 2. Workers & Pages → Create Application → Create Worker.
 * 3. Назовите воркер (например, farovon-tg-relay).
 * 4. Нажмите «Deploy», затем «Edit code».
 * 5. Замените весь код на содержимое этого файла.
 * 6. Замените GAS_URL на ваш реальный URL веб-приложения (/exec).
 * 7. Нажмите «Deploy».
 * 8. Установите вебхук через браузер:
 *    https://api.telegram.org/bot<ТОКЕН_БОТА>/setWebhook?url=https://<ИМЯ_ВОРКЕРА>.workers.dev
 */

// ⚠️ ВСТАВЬТЕ СЮДА URL РАЗВЁРТЫВАНИЯ ВАШЕГО GOOGLE APPS SCRIPT (/exec)
const GAS_URL = "https://script.google.com/macros/s/ВАШ_SCRIPT_ID/exec";

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Farovon Telegram Webhook Relay is active and running!", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }

    try {
      const body = await request.text();

      await fetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body,
        redirect: "follow"
      });

      return new Response("ok", { status: 200 });
    } catch (err) {
      return new Response("error: " + err.message, { status: 200 });
    }
  }
};