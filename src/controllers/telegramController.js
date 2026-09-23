const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { queryOne, queryAll, run } = require('../db/database');
const { getBotUsername, sendTelegramMessage, answerCallbackQuery } = require('../services/telegramService');
const { getActivePeriod } = require('../services/periodService');
const supportChat = require('../services/supportChatService');

const LINK_TTL_MINUTES = 10;

// Все сообщения бота уходят с parse_mode: 'HTML' (см. telegramService). ФИО и
// логин вводит администратор — символы < > & в них ломают разметку, а то и
// подставляют теги. Экранируем перед вставкой в текст сообщения.
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const HELP_TEXT = 'Доступные команды:\n' +
  '/login — получить логин и пароль для входа\n' +
  '/status — мои подразделения и прогресс заполнения\n' +
  '/unlink — отвязать этот Telegram от аккаунта\n' +
  '/link — привязать по номеру телефона\n' +
  '/support — написать в чат поддержки\n' +
  '/help — этот список';

/** Пользователь запрашивает ссылку для привязки своего Telegram — одноразовый токен
 *  на 10 минут, чтобы чужой чат нельзя было привязать к чужому логину по угадыванию. */
exports.link = async (req, res) => {
  if (!config.telegramBotToken) {
    return res.status(503).json({ ok: false, error: 'Telegram-бот не подключён' });
  }
  const username = await getBotUsername();
  if (!username) {
    return res.status(503).json({ ok: false, error: 'Не удалось связаться с Telegram-ботом' });
  }

  const token = crypto.randomBytes(16).toString('hex');

  // Срок действия считаем в SQL, а не в JS: telegram_link_expires должен сравниваться
  // с datetime('now') строкой-в-строку (webhook ниже делает "expires > datetime('now')"),
  // а new Date().toISOString() даёт другой формат ("...T...Z" против "... ..."),
  // из-за чего сравнение сравнивало бы разные форматы и ссылка не истекала бы никогда.
  await run(
    `UPDATE users SET telegram_link_token = ?, telegram_link_expires = datetime('now', '+${LINK_TTL_MINUTES} minutes') WHERE id = ?`,
    [token, req.user.id]
  );

  res.json({
    ok: true,
    deepLink: `https://t.me/${username}?start=${token}`,
    expiresInMinutes: LINK_TTL_MINUTES
  });
};

/**
 * Юзернейм бота для экрана входа (кнопка «Открыть бота» и ссылка «Написать
 * администратору» — обе ведут в один и тот же бот, разбор незнакомых
 * сообщений на «написать администратору» уже реализован внутри самого бота,
 * см. supportChatService). Публичный роут: до входа в систему у человека
 * ещё нет JWT, а username бота — не секрет.
 */
exports.botInfo = async (req, res) => {
  const username = config.telegramBotToken ? await getBotUsername() : null;
  res.json({ ok: true, username: username || null });
};

/** Отвязка из самого приложения (кнопка «Telegram привязан» → «Отвязать» в профиле). */
exports.unlink = async (req, res) => {
  try {
    await run('UPDATE users SET telegram_chat_id = NULL WHERE id = ?', [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Telegram unlink error:', err);
    res.status(500).json({ ok: false, error: 'Не удалось отвязать Telegram' });
  }
};

/** Найти живого пользователя по chat_id — общая проверка для команд ниже. */
async function findByChatId(chatId) {
  return queryOne(
    'SELECT id, fio, units FROM users WHERE telegram_chat_id = ? AND archived_at IS NULL AND active = 1',
    [String(chatId)]
  );
}

const NOT_LINKED_MSG = 'Аккаунт не привязан. Откройте приложение «Обзор рынка» → Профиль → «Привязать Telegram».';

/**
 * Последние 9 цифр — локальный номер без кода страны (+992) и без ведущих
 * нулей/плюсов, в любом написании. И users.phone, и Telegram-контакт
 * сравниваются в этом виде — форматы у них исторически расходятся
 * (с кодом страны/без, с ведущим нулём/без).
 */
function normalizePhone(raw) {
  return String(raw || '').replace(/\D/g, '').slice(-9);
}

// Текст второй кнопки на CONTACT_KEYBOARD — reply-кнопка (не инлайн) шлёт
// этот текст обычным сообщением при нажатии, ловим его в processTelegramUpdate
// той же обработкой, что и инлайн-«support:start» (см. openSupportThreadForGuest).
const SUPPORT_TEXT_LABEL = '💬 Написать администратору';
// Кнопка самообслуживания рядом с готовыми вопросами в чате поддержки —
// показывает вопрос+ответ сразу, без ожидания администратора, для тех
// guest-фраз, у которых в админке заполнен «Ответ».
const FAQ_LABEL = '❓ Частые вопросы';

/** Клавиатура «поделиться номером» — request_contact сам просит у Telegram
 *  разрешение и подставляет ровно тот номер, что привязан к аккаунту
 *  пользователя, руками вводить/подделать нельзя. Вторая кнопка — сразу уйти
 *  в чат поддержки, не дожидаясь неудачной попытки распознать номер. */
const CONTACT_KEYBOARD = {
  reply_markup: {
    keyboard: [
      [{ text: '📱 Отправить номер телефона', request_contact: true }],
      [{ text: SUPPORT_TEXT_LABEL }]
    ],
    resize_keyboard: true,
    one_time_keyboard: true
  }
};
const REMOVE_KEYBOARD = { reply_markup: { remove_keyboard: true } };

/**
 * Раньше на сообщениях о неудачной идентификации (номер не найден, нет
 * привязки и т.п.) всё заканчивалось — бот просто советовал обратиться в
 * HR, без способа сразу спросить, что не так. Кнопка открывает чат
 * поддержки: дальше человек пишет прямо сюда, C&B отвечает из админки
 * («Чат поддержки»), ответ приходит в этот же чат.
 */
const SUPPORT_KEYBOARD = {
  reply_markup: {
    inline_keyboard: [[{ text: SUPPORT_TEXT_LABEL, callback_data: 'support:start' }]]
  }
};

// web_app требует HTTPS — на локальном http://localhost Telegram отклонит всё
// сообщение с такой кнопкой, поэтому там же откатываемся на обычную url-кнопку
// (встроенный браузер вместо полноэкранного Mini App). Общий хелпер для
// resetAndSendCredentials и постоянной клавиатуры ниже — раньше эта логика
// была продублирована на каждом месте отдельно.
function webAppOpenButton(text) {
  const platformUrl = config.webappUrl;
  return /^https:\/\//i.test(platformUrl)
    ? { text, web_app: { url: platformUrl } }
    : { text, url: platformUrl };
}

const PROGRESS_LABEL = '📊 Мой прогресс';

/**
 * Единственная постоянная reply-клавиатура диалога — раньше клавиатуры
 * менялись бессистемно (reply на /start, inline на /login, снова reply на
 * /support) и REMOVE_KEYBOARD стирал их после первого же успешного шага,
 * ничем не заменяя. Показываем эту клавиатуру после каждой успешной
 * привязки/входа и держим её до явной отвязки (см. handleUnlink). Функция,
 * не константа — `config.webappUrl` должен читаться на момент отправки, не
 * застывать на моменте загрузки модуля (см. webAppOpenButton выше).
 */
function mainKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [webAppOpenButton('🚀 Открыть систему')],
        [{ text: PROGRESS_LABEL }, { text: SUPPORT_TEXT_LABEL }]
      ],
      resize_keyboard: true
    }
  };
}

/**
 * Диплинк с токеном не всегда доезжает как готовое сообщение — часть клиентов
 * Telegram (особенно если чат с ботом уже когда-то открывали) просто
 * открывает чат, не подставляя «/start <токен>» в поле ввода, и человек
 * видит «ничего не произошло». Поэтому даже при невалидном/просроченном
 * токене не останавливаемся на ошибке, а сразу предлагаем более надёжный
 * способ — поделиться номером телефона одной кнопкой.
 */
/** Генерация читаемого и надёжного временного пароля */
function generateTempPassword() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[crypto.randomInt(0, chars.length)];
  }
  // Гарантируем цифру и букву: заменяем два первых символа на заведомо
  // цифру и заведомо букву (позиции случайны за счёт остального кода).
  code = '23456789'[crypto.randomInt(0, 8)] + 'ABCDEFGHJKLMNPQRSTUVWXYZ'[crypto.randomInt(0, 24)] + code.slice(2);
  return 'Fv-' + code;
}

/**
 * Сбрасывает пароль пользователю и присылает новый ему в личный чат Telegram.
 * Общий код для двух точек входа:
 *   - команда /login в боте (сам пользователь);
 *   - админское «Сбросить пароль» в приложении — новый пароль уходит
 *     пользователю, администратор его НЕ видит (пароль знает только владелец).
 *
 * `user` — строка из users с полями id, login, fio, telegram_chat_id.
 * `source` — 'self' | 'admin' (только для записи в журнал).
 * Возвращает { ok:true } либо { ok:false, reason:'not_linked'|'system_admin'|'not_found' }.
 */
async function resetAndSendCredentials(user, source) {
  if (!user) return { ok: false, reason: 'not_found' };
  if (user.login === 'admin') return { ok: false, reason: 'system_admin' };
  if (!user.telegram_chat_id) return { ok: false, reason: 'not_linked' };

  const tempPassword = generateTempPassword();
  const platformUrl = config.webappUrl;

  const msg = `🔐 <b>Данные для входа в систему «Обзор рынка»:</b>\n\n` +
    `👤 <b>Логин:</b> <code>${escHtml(user.login)}</code>\n` +
    `🔑 <b>Временный пароль:</b> <code>${escHtml(tempPassword)}</code>\n\n` +
    `⚠️ <i>Рекомендуем сменить этот пароль в профиле сразу после входа.</i>\n\n` +
    `🌐 <b>Ссылка на платформу:</b>\n${platformUrl}`;

  // Сначала пытаемся доставить — и только если ушло, меняем хэш. Иначе при
  // недоступном боте пароль бы уже сменился, а пользователь остался бы без
  // нового (лок-аут).
  const sent = await sendTelegramMessage(user.telegram_chat_id, msg, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[webAppOpenButton('🚀 Открыть «Обзор рынка»')]]
    }
  });
  if (!sent) return { ok: false, reason: 'send_failed' };

  // Восстанавливаем постоянную клавиатуру отдельным сообщением — Telegram не
  // позволяет одновременно inline- и reply-разметку на одном сообщении, а
  // кнопка выше нужна именно inline (открывает конкретно эти учётные данные).
  await sendTelegramMessage(user.telegram_chat_id, 'Готово. Кнопки ниже 👇', mainKeyboard());

  await run('UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?', [
    bcrypt.hashSync(tempPassword, 12),
    new Date().toISOString(),
    user.id
  ]);

  await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
    user.login,
    source === 'admin' ? 'сброс пароля админом (выслан в telegram)' : 'сброс пароля telegram',
    source === 'admin'
      ? `Новый пароль для ${user.fio} сгенерирован и отправлен пользователю в Telegram`
      : `Пользователь ${user.fio} запросил данные для входа через Telegram`
  ]);

  return { ok: true };
}

exports.resetAndSendCredentials = resetAndSendCredentials;
// Для юнит-тестов клавиатуры (не бизнес-логика, но должны совпадать
// подписи и переключение web_app/url по протоколу).
exports.webAppOpenButton = webAppOpenButton;
exports.mainKeyboard = mainKeyboard;
exports.PROGRESS_LABEL = PROGRESS_LABEL;

/** Запрос логина и генерация нового пароля после привязки Telegram */
async function handleLogin(chatId) {
  const user = await queryOne(
    'SELECT id, login, fio, telegram_chat_id FROM users WHERE telegram_chat_id = ? AND archived_at IS NULL AND active = 1',
    [String(chatId)]
  );
  if (!user) {
    await sendTelegramMessage(chatId, NOT_LINKED_MSG, SUPPORT_KEYBOARD);
    return;
  }

  const result = await resetAndSendCredentials(user, 'self');
  if (!result.ok && result.reason === 'system_admin') {
    await sendTelegramMessage(
      chatId,
      '⚠️ Пароль системного администратора не может быть сброшен через Telegram-бота. Обратитесь к системному инженеру.'
    );
  }
}

async function handleStart(chatId, token) {
  if (token) {
    const user = await queryOne(
      "SELECT id, fio FROM users WHERE telegram_link_token = ? AND telegram_link_expires > datetime('now')",
      [token]
    );
    if (user) {
      await run('UPDATE users SET telegram_chat_id = ?, telegram_link_token = NULL, telegram_link_expires = NULL WHERE id = ?', [
        String(chatId),
        user.id
      ]);
      await sendTelegramMessage(chatId,
        `Готово, ${escHtml(user.fio)}! Telegram привязан — теперь сюда будут приходить напоминания о заполнении обзора рынка.\n\n${HELP_TEXT}`,
        mainKeyboard());
      return;
    }
  }

  const already = await findByChatId(chatId);
  if (already) {
    await sendTelegramMessage(chatId, `Здравствуйте, ${escHtml(already.fio)}! Аккаунт уже привязан.\n\n${HELP_TEXT}`, mainKeyboard());
    return;
  }

  await sendTelegramMessage(chatId,
    'Здравствуйте! Чтобы привязать аккаунт, нажмите кнопку ниже и поделитесь номером телефона — ' +
    'найдём вас по номеру, указанному в приложении «Обзор рынка» (спросите администратора, ' +
    'если номер ещё не занесён).',
    CONTACT_KEYBOARD);
}

/** Привязка по общему номеру телефона — резервный путь, когда диплинк из
 *  приложения не подставился (см. комментарий к handleStart). */
async function handleContact(chatId, fromId, contact) {
  if (!contact || !contact.phone_number) return;
  // Кнопка request_contact всегда шлёт контакт нажавшего, но Telegram технически
  // допускает и ручную пересылку чужой карточки через скрепку — проверяем,
  // что это правда собственный номер отправителя, а не чей-то ещё.
  if (contact.user_id && fromId && contact.user_id !== fromId) {
    await sendTelegramMessage(chatId, 'Поделитесь своим собственным номером, не чужим.');
    return;
  }

  const norm = normalizePhone(contact.phone_number);
  if (!norm) {
    await sendTelegramMessage(chatId, 'Не удалось распознать номер.', REMOVE_KEYBOARD);
    return;
  }

  const users = await queryAll(
    "SELECT id, fio, phone FROM users WHERE archived_at IS NULL AND active = 1 AND TRIM(COALESCE(phone,'')) <> ''"
  );
  const match = users.find(u => normalizePhone(u.phone) === norm);

  if (!match) {
    // Не просто советуем написать в поддержку, а сразу открываем тред с этим
    // номером внутри — иначе номер, который человек только что ввёл, нигде
    // не сохраняется, и C&B нечем воспользоваться, чтобы поправить карточку.
    // Уведомление C&B — внутри saveIncomingMessage (throttled, единая точка
    // для обоих каналов, см. supportChatService.maybeNotifySupportTeam).
    const { id: threadId } = await supportChat.getOrCreateThread(chatId, contact.phone_number);
    await supportChat.saveIncomingMessage(threadId, `Указал номер ${contact.phone_number}, сотрудника с таким номером в системе нет.`);
    await sendTelegramMessage(chatId,
      'Не нашли сотрудника с таким номером в приложении «Обзор рынка». Мы передали ваш номер администратору — ' +
      'он поправит карточку, и вы сможете войти.',
      REMOVE_KEYBOARD);
    return;
  }

  await run('UPDATE users SET telegram_chat_id = ?, telegram_link_token = NULL, telegram_link_expires = NULL WHERE id = ?', [
    String(chatId),
    match.id
  ]);
  await sendTelegramMessage(chatId,
    `Готово, ${escHtml(match.fio)}! Telegram привязан по номеру телефона.\n\n${HELP_TEXT}`,
    mainKeyboard());
}

/** «Мои подразделения» — тот же прогресс, что на экране «Мои подразделения» в приложении,
 *  но коротким текстом: не тянем сюда весь getUserPayload, только счётчики. */
async function handleStatus(chatId) {
  const user = await findByChatId(chatId);
  if (!user) { await sendTelegramMessage(chatId, NOT_LINKED_MSG, SUPPORT_KEYBOARD); return; }

  const unitsList = (user.units || '').split(';').map(s => s.trim()).filter(Boolean);
  if (!unitsList.length) {
    await sendTelegramMessage(chatId, `Здравствуйте, ${escHtml(user.fio)}! За вами пока не закреплено подразделение — обратитесь к администратору.`);
    return;
  }

  const placeholders = unitsList.map(() => '?').join(',');
  // Только текущий год сбора — тот же счётчик, что показывает приложение
  // (см. dashboardController.getHRBPDashboard); без этого бот считал бы
  // анкеты всех лет сразу и не совпадал бы с тем, что видно в самом приложении.
  const currentPeriod = await getActivePeriod();
  // Position-first Шаг 1: выбор компаний по должности (заменяет прежний
  // унитарный на весь unit флаг competitors.actual) — «проверено» теперь
  // значит «по этой паре должность×компания уже внесены данные по рынку».
  const sels = await queryAll(
    `SELECT unit, pos_our, company FROM position_company_selections WHERE unit IN (${placeholders}) AND period_id = ?`,
    [...unitsList, currentPeriod ? currentPeriod.id : null]);
  const survs = await queryAll(
    `SELECT pos_our, company, pay_from, pay_to FROM surveys WHERE state != 'удалена' AND unit IN (${placeholders}) AND period_id = ?`,
    [...unitsList, currentPeriod ? currentPeriod.id : null]);

  const normPos = (v) => String(v == null ? '' : v).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  const filledKeys = new Set();
  survs.forEach(s => {
    if (Number(s.pay_from) > 0 || Number(s.pay_to) > 0) filledKeys.add(`${normPos(s.pos_our)}|${normPos(s.company)}`);
  });
  let done = 0;
  sels.forEach(s => {
    if (filledKeys.has(`${normPos(s.pos_our)}|${normPos(s.company)}`)) done++;
  });

  const unitLines = unitsList.slice(0, 10).map(u => '• ' + u).join('\n') +
    (unitsList.length > 10 ? `\n• и ещё ${unitsList.length - 10}` : '');

  await sendTelegramMessage(chatId,
    `📊 <b>${escHtml(user.fio)}</b>\n\n` +
    `Подразделений: <b>${unitsList.length}</b>\n` +
    `Участников рынка: <b>${done}/${sels.length}</b> проверено\n` +
    `Записей по должностям: <b>${survs.length}</b>\n\n${unitLines}`);
}

/**
 * Раньше /unlink спрашивал подтверждение inline-кнопками (callback_query) —
 * пользователь сообщил, что кнопки не срабатывали (либо задержка холодного
 * старта на бесплатном Render, либо сам механизм callback_query ненадёжен
 * для этого бота — воспроизвести из кода не удалось). Убрал промежуточный
 * шаг совсем: отвязка — не то действие, которое опасно сделать случайно
 * (привязать обратно можно тут же командой /link), а у самого приложения
 * уже есть свой explicit-confirm через ask() для того же действия.
 */
async function handleUnlink(chatId) {
  const user = await findByChatId(chatId);
  if (!user) { await sendTelegramMessage(chatId, NOT_LINKED_MSG, SUPPORT_KEYBOARD); return; }

  await run('UPDATE users SET telegram_chat_id = NULL WHERE id = ?', [user.id]);
  await sendTelegramMessage(
    chatId,
    `Telegram отвязан от аккаунта ${escHtml(user.fio)}. Привязать заново — командой /link.`,
    REMOVE_KEYBOARD
  );
}

/** Старые сообщения с inline-кнопками «Да, отвязать»/«Отмена» могли остаться
 *  в истории чата у тех, кто видел прошлую версию /unlink, — без ответа на
 *  callback_query кнопка так и висит с крутящимся индикатором. Отвечаем, но
 *  саму отвязку через кнопки больше не делаем (см. handleUnlink выше). */
async function handleStaleCallback(cb) {
  await sendTelegramMessage(
    (cb.message && cb.message.chat && cb.message.chat.id) || (cb.from && cb.from.id),
    'Эта кнопка устарела. Наберите /unlink ещё раз.'
  );
  await answerCallbackQuery(cb.id);
}

/**
 * Открывает (или переоткрывает) тред поддержки для этого чата — общая
 * логика для двух точек входа: инлайн-кнопки под сообщением
 * («support:start», см. handleSupportStart) и текстовой кнопки на
 * reply-клавиатуре («💬 Написать администратору», см. SUPPORT_TEXT_LABEL
 * ниже и её обработку в processTelegramUpdate). На этот момент в треде ещё
 * нет ни одного сообщения (текст придёт следующим апдейтом) — единственное
 * место, где уведомление C&B вызывается не изнутри записи сообщения, а
 * явно (throttled той же функцией, см. supportChatService.maybeNotifySupportTeam).
 */
async function openSupportThreadForGuest(chatId) {
  if (!chatId) return;
  const { id: threadId } = await supportChat.getOrCreateThread(chatId);

  // Готовые вопросы гостю — reply-клавиатура (не inline): нажатие сразу
  // отправляет текст кнопки обычным сообщением, дальше идёт как любое
  // «in»-сообщение треда, без отдельной обработки. Список редактируется в
  // самой админке (support_quick_replies, audience='guest'), не хардкод.
  // Кнопка «Частые вопросы» — отдельной строкой снизу: у неё особая
  // обработка (показывает готовые ответы сама, не уходит человеку в тред).
  const questions = await supportChat.listQuickReplies('guest');
  const rows = questions.map(q => [{ text: q.text }]);
  if (questions.some(q => q.answer)) rows.push([{ text: FAQ_LABEL }]);
  const questionsKeyboard = rows.length ? {
    reply_markup: { keyboard: rows, resize_keyboard: true }
  } : undefined;

  await sendTelegramMessage(chatId, 'Опишите вопрос — администратор увидит и ответит здесь же.', questionsKeyboard);
  await supportChat.maybeNotifySupportTeam(threadId);
}

/** Нажатие инлайн-кнопки «Написать администратору» под сообщением бота. */
async function handleSupportStart(cb) {
  const chatId = (cb.message && cb.message.chat && cb.message.chat.id) || (cb.from && cb.from.id);
  await answerCallbackQuery(cb.id);
  await openSupportThreadForGuest(chatId);
}

/**
 * Обычное (не команда) сообщение от чата, у которого уже есть тред
 * поддержки. Переоткрывает закрытый тред при необходимости; уведомление
 * C&B — throttled, внутри saveIncomingMessage (см.
 * supportChatService.maybeNotifySupportTeam), не завязано на «закрыт/открыт».
 */
async function handleSupportMessage(chatId, thread, text) {
  let threadId = thread.id;
  if (thread.status === 'closed') {
    threadId = (await supportChat.getOrCreateThread(chatId)).id;
  }
  await supportChat.saveIncomingMessage(threadId, text);
}

/** Публичный эндпоинт — сюда Telegram шлёт входящие сообщения после setWebHook.
 *  Секретный заголовок проверяем сами: без него любой мог бы слать сюда что угодно
 *  от имени бота. */
/** Сравнение секретов за постоянное время — чтобы по времени ответа нельзя
 *  было побайтово подобрать секрет. Разная длина → сразу не совпало. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

exports.webhook = async (req, res) => {
  const secret = req.headers['x-telegram-bot-api-secret-token'];
  if (!config.telegramWebhookSecret || !safeEqual(secret, config.telegramWebhookSecret)) {
    return res.status(401).end();
  }

  // Telegram иногда доставляет один и тот же апдейт дважды (не дождался
  // ответа в свой таймаут и повторил) — без дедупликации по update_id это
  // обрабатывалось заново: дублировало сообщения в чате поддержки, второй
  // раз привязывало/отвязывало аккаунт и т.п. INSERT OR IGNORE — уже был,
  // выходим без повторной обработки, но всё равно отвечаем 200 (иначе
  // Telegram решит, что доставка не удалась, и продолжит повторять).
  const updateId = req.body && req.body.update_id;
  if (updateId != null) {
    try {
      const inserted = await run('INSERT OR IGNORE INTO telegram_updates (update_id) VALUES (?)', [updateId]);
      if (!inserted.rowsAffected) return res.status(200).end();
    } catch (err) {
      console.error('Telegram webhook dedup error:', err);
    }
  }

  // ВАЖНО: на serverless (Vercel) исполнение функции замораживается сразу после
  // отправки ответа — всё, что запланировано «на потом» через await, не
  // доедет. Поэтому обработку (и отправку ответа боту) завершаем ДО res.end(),
  // а не после. Обработчики короткие (запрос к БД + одна отправка), в таймаут
  // доставки Telegram (~60 c) укладываемся с запасом; повторной доставки из-за
  // «медленного 200» на практике не бывает.
  try {
    await processTelegramUpdate(req.body);
  } catch (err) {
    console.error('Telegram webhook error:', err);
  }
  res.status(200).end();
};

async function processTelegramUpdate(body) {
  const cb = body && body.callback_query;
  if (cb) {
    if (cb.data === 'support:start') { await handleSupportStart(cb); return; }
    await handleStaleCallback(cb);
    return;
  }

  const msg = body && body.message;
  if (!msg || !msg.chat) return;

  const chatId = msg.chat.id;

  if (msg.contact) {
    await handleContact(chatId, msg.from && msg.from.id, msg.contact);
    return;
  }

  if (!msg.text) return;
  const text = msg.text.trim();

  const startMatch = text.match(/^\/start(?:\s+([a-f0-9]{32}))?$/i);
  if (startMatch) { await handleStart(chatId, startMatch[1]); return; }

  // Ручной запасной путь — если диплинк из приложения не подставил
  // /start в поле ввода, человек всё равно может набрать /link сам.
  if (/^\/link\b/i.test(text)) { await handleStart(chatId, null); return; }
  if (/^\/(login|creds|password|pass|dostup)\b/i.test(text)) { await handleLogin(chatId); return; }
  if (/^\/status\b/i.test(text)) { await handleStatus(chatId); return; }
  if (/^\/unlink\b/i.test(text)) { await handleUnlink(chatId); return; }
  if (/^\/support\b/i.test(text)) { await openSupportThreadForGuest(chatId); return; }
  // Под списком команд — кнопка чата поддержки, чтобы привязанному сотруднику
  // не приходилось помнить /support.
  if (/^\/help\b/i.test(text)) { await sendTelegramMessage(chatId, HELP_TEXT, SUPPORT_KEYBOARD); return; }

  // Та же кнопка «Написать администратору», но текстовая (на CONTACT_KEYBOARD
  // и на постоянной mainKeyboard(), видна ещё до попытки распознать номер) —
  // не текст в переписку, а открытие/переоткрытие треда, как и её
  // инлайн-версия (support:start).
  if (text === SUPPORT_TEXT_LABEL) { await openSupportThreadForGuest(chatId); return; }

  // Кнопка «Мой прогресс» на постоянной клавиатуре — та же команда, что /status.
  if (text === PROGRESS_LABEL) { await handleStatus(chatId); return; }

  // «Частые вопросы» — самообслуживание: показываем вопрос+ответ сразу, не
  // отправляем нажатие в тред и не ждём администратора. Клавиатура при этом
  // не трогается — остаётся тот же набор кнопок, что был.
  if (text === FAQ_LABEL) {
    const all = await supportChat.listQuickReplies('guest');
    const answered = all.filter(q => q.answer);
    const faqText = answered.length
      ? answered.map(q => `❔ <b>${escHtml(q.text)}</b>\n${escHtml(q.answer)}`).join('\n\n')
      : 'Пока нет готовых ответов — опишите вопрос, ответит администратор.';
    await sendTelegramMessage(chatId, faqText, { parse_mode: 'HTML' });
    return;
  }

  // Команды разбираются и при открытом треде поддержки (вдруг человек
  // вспомнил код от HR) — только обычный текст без «/» уходит в переписку.
  if (!text.startsWith('/')) {
    const thread = await supportChat.findThreadByChatId(chatId);
    if (thread) { await handleSupportMessage(chatId, thread, text); return; }

    // Ответ на рассылку: у привязанного сотрудника обычно ещё нет треда, и
    // без этого его ответ уходил бы в «Не понял команду». Если ему за
    // последние 3 суток приходила рассылка — открываем тред поддержки и
    // кладём ответ туда, C&B отвечает из обычного «Чата поддержки».
    const recent = await queryOne(
      `SELECT broadcast_id FROM broadcast_recipients
       WHERE telegram_chat_id = ? AND status = 'sent' AND sent_at > datetime('now', '-3 days')
       ORDER BY id DESC LIMIT 1`, [String(chatId)]);
    if (recent) {
      // Уведомление C&B — внутри saveIncomingMessage (throttled).
      const { id: threadId } = await supportChat.getOrCreateThread(chatId);
      await supportChat.saveIncomingMessage(threadId, `↩ Ответ на рассылку #${recent.broadcast_id}:\n${text}`);
      await sendTelegramMessage(chatId, 'Спасибо, ответ передан администратору — он ответит здесь же.');
      return;
    }
  }

  await sendTelegramMessage(chatId, 'Не понял команду.\n\n' + HELP_TEXT);
}
