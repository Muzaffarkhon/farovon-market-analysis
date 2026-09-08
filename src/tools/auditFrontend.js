/**
 * Проверки, которые ловят то, чего не видно в диффе:
 *  1) синтаксис всего <script> целиком (потерянная кавычка при склейке строк);
 *  2) классы, которые есть в разметке, но которых нет в CSS, — этот паттерн
 *     уже трижды давал невидимые поломки (.pickrow, .menu, .dlg*, .prog-*);
 *  3) методы call('...'), для которых не объявлен маршрут в API_ROUTES, —
 *     именно так «+ Добавить должность» молча не работала.
 */
const fs = require('fs');
const html = fs.readFileSync('client/index.html', 'utf8');
const css = fs.readFileSync('client/style.css', 'utf8');

const blocks = html.match(/<script>[\s\S]*?<\/script>/g) || [];
const js = blocks
  .map(s => s.replace(/^<script>/, '').replace(/<\/script>$/, ''))
  .join('\n;\n');

let fail = false;

try {
  new Function(js);
  console.log('OK  JS: синтаксис чист');
} catch (e) {
  console.log('BAD JS:', e.message);
  process.exit(1);
}

// ── Классы из разметки ────────────────────────────────────────────────────
// Берём только «чистые» имена: куски вида `dlg-go '+(opts.danger?…` — это
// склейка строк в JS, а не имя класса.
const used = new Set();
for (const m of html.matchAll(/class="([^"]*)"/g)) {
  for (const token of m[1].split(/\s+/)) {
    if (/^[a-zA-Z][\w-]*$/.test(token)) used.add(token);
  }
}

// Классы-«ручки» для JS: по ним ищут узел в DOM, оформления у них нет и быть
// не должно. Держим списком, иначе проверка начнёт давать ложные срабатывания
// и её перестанут читать.
const JS_HOOKS = new Set([
  'dlg-go',   // фокус на кнопке подтверждения в ask()
  'dash-row'  // строка отчёта, по клику открывающая подразделение
]);

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const missing = [...used].filter(c => {
  if (JS_HOOKS.has(c)) return false;
  const re = new RegExp('\\.' + escapeRe(c) + '(?![\\w-])');
  return !re.test(css);
});

if (missing.length) {
  fail = true;
  console.log('BAD Классы без CSS: ' + missing.join(', '));
} else {
  console.log('OK  CSS: все классы описаны');
}

// ── call() без маршрута ───────────────────────────────────────────────────
const routes = new Set([...js.matchAll(/\b(api[A-Za-z0-9]+)\s*:/g)].map(m => m[1]));
const calls = new Set([...js.matchAll(/call\(\s*'([A-Za-z0-9]+)'/g)].map(m => m[1]));
const noRoute = [...calls].filter(c => !routes.has(c));

if (noRoute.length) {
  fail = true;
  console.log('BAD call() без маршрута в API_ROUTES: ' + noRoute.join(', '));
} else {
  console.log('OK  API: у каждого call() есть маршрут (' + calls.size + ' шт.)');
}

// ── Иконки ────────────────────────────────────────────────────────────────
const iconsBlock = js.slice(js.indexOf('var ICONS'), js.indexOf('var ICONS') + 9000);
const iconNames = new Set([...iconsBlock.matchAll(/^\s{2}([a-zA-Z]+):/gm)].map(m => m[1]));
const iconUses = new Set([...js.matchAll(/\bic(?:Bare)?\(\s*'([a-zA-Z]+)'/g)].map(m => m[1]));
const badIcons = [...iconUses].filter(i => !iconNames.has(i));

if (badIcons.length) {
  fail = true;
  console.log('BAD Иконки, которых нет в наборе: ' + badIcons.join(', '));
} else {
  console.log('OK  Иконки: все имена существуют (' + iconUses.size + ' шт.)');
}

process.exit(fail ? 1 : 0);
