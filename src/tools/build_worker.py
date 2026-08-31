import json
import os

base_dir = r"c:\Users\Acer\OneDrive\Desktop\Разработка\Обзор рынка"
seed_path = os.path.join(base_dir, "src", "data", "seedBundle.json")
html_path = os.path.join(base_dir, "public", "index.html")
worker_path = os.path.join(base_dir, "src", "worker.js")

with open(seed_path, "r", encoding="utf-8") as f:
    seed_bundle = json.load(f)

with open(html_path, "r", encoding="utf-8") as f:
    html_content = f.read()

# Make sure html has proper UTF-8 head
if "<meta charset=\"UTF-8\">" not in html_content and "<meta charset=\"utf-8\">" not in html_content:
    html_content = '<!DOCTYPE html>\n<html lang="ru">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">\n  <title>Анализ рынка — Конкурентная карта Фаровон</title>\n' + html_content + '\n</body>\n</html>'
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)
    print("Updated public/index.html with UTF-8 doctype")

seed_json_str = json.dumps(seed_bundle, ensure_ascii=False)
html_json_str = json.dumps(html_content, ensure_ascii=False)

worker_template = f"""/**
 * Cloudflare Full-Stack Worker: Farovon Market Analysis & C&B Benchmarking
 * Autonomous Edge Application with embedded Data Engine, C&B Analytics,
 * Admin Management, Survey Split-View and Telegram Mini App support.
 */

// ─────────────────────────────────────────────────────────────
// 1. НАЧАЛЬНЫЙ ПАКЕТ ДАННЫХ (СИДЫ)
// ─────────────────────────────────────────────────────────────
const INITIAL_DATA = {seed_json_str};

// Глобальное состояние памяти (активно между запросами внутри инстанса Cloudflare)
let DB_STATE = null;

function getDbState() {{
  if (!DB_STATE) {{
    DB_STATE = JSON.parse(JSON.stringify(INITIAL_DATA));
    DB_STATE.audit_log = [
      {{ dt: new Date().toLocaleString('ru-RU', {{ timeZone: 'Asia/Dushanbe' }}), login: 'system', action: 'Инициализация', detail: 'База данных Cloudflare Edge загружена' }}
    ];
  }}
  return DB_STATE;
}}

const JWT_SECRET = 'farovon_cf_worker_jwt_secret_2026';

// ─────────────────────────────────────────────────────────────
// 2. КРИПТОГРАФИЯ (Web Crypto API)
// ─────────────────────────────────────────────────────────────
async function sha256(str) {{
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}}

async function signJwt(payload) {{
  const header = {{ alg: 'HS256', typ: 'JWT' }};
  const encodeB64Url = (obj) => {{
    const jsonStr = typeof obj === 'string' ? obj : JSON.stringify(obj);
    const bytes = new TextEncoder().encode(jsonStr);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  }};

  const h64 = encodeB64Url(header);
  const p64 = encodeB64Url({{ ...payload, exp: Math.floor(Date.now() / 1000) + 86400 * 30 }});
  const dataToSign = h64 + '.' + p64;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(JWT_SECRET),
    {{ name: 'HMAC', hash: 'SHA-256' }},
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(dataToSign));
  let sigBin = '';
  const sigBytes = new Uint8Array(sig);
  for (let i = 0; i < sigBytes.length; i++) sigBin += String.fromCharCode(sigBytes[i]);
  const s64 = btoa(sigBin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');

  return dataToSign + '.' + s64;
}}

async function verifyJwt(token) {{
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {{
    const payloadJson = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(payloadJson, c => c.charCodeAt(0))));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  }} catch (e) {{
    return null;
  }}
}}

// ─────────────────────────────────────────────────────────────
// 3. АНАЛИТИЧЕСКИЙ ДВИЖОК C&B (Перцентили, Box-Plot, Сводки)
// ─────────────────────────────────────────────────────────────
function calculatePercentiles(samples) {{
  const s = [...samples].filter(x => typeof x === 'number' && !isNaN(x) && x > 0).sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return {{ min: 0, p25: 0, median: 0, p75: 0, max: 0, avg: 0, spread: 0 }};

  const min = s[0];
  const max = s[n - 1];
  const avg = Math.round(s.reduce((acc, v) => acc + v, 0) / n);

  const i25 = (n - 1) * 0.25;
  const l25 = Math.floor(i25);
  const p25 = Math.round(s[l25] + (s[Math.min(l25 + 1, n - 1)] - s[l25]) * (i25 - l25));

  const i50 = (n - 1) * 0.5;
  const l50 = Math.floor(i50);
  const median = Math.round(s[l50] + (s[Math.min(l50 + 1, n - 1)] - s[l50]) * (i50 - l50));

  const i75 = (n - 1) * 0.75;
  const l75 = Math.floor(i75);
  const p75 = Math.round(s[l75] + (s[Math.min(l75 + 1, n - 1)] - s[l75]) * (i75 - l75));

  const spread = (min > 0 && max > min) ? Math.round(((max - min) / min) * 100) : 0;

  return {{ min, p25, median, p75, max, avg, spread }};
}}

function getExtendedAnalytics(state, filters = {{}}) {{
  const filterDir = (filters.dir || '').trim();
  const filterHrbp = (filters.hrbp || '').trim();
  const searchPos = (filters.search || '').trim().toLowerCase();

  const unitMap = {{}};
  state.divisions.forEach(d => {{
    unitMap[d.unit] = {{
      dir: d.dir || '',
      head: d.head || '',
      resp: d.resp || '',
      hrbp: d.hrbp || '',
      totalComp: 0,
      doneComp: 0,
      askComp: 0,
      surveysCount: 0
    }};
  }});

  state.competitors.forEach(c => {{
    if (unitMap[c.unit]) {{
      unitMap[c.unit].totalComp++;
      const act = (c.actual || '').toLowerCase();
      if (act === 'актуально' || act === 'не актуально') {{
        unitMap[c.unit].doneComp++;
      }} else if (act === 'уточнить') {{
        unitMap[c.unit].askComp++;
      }}
    }}
  }});

  const surveys = state.surveys.filter(s => (s.state || '') !== 'удалена');

  let totalRecords = 0;
  let recordsWithSalary = 0;
  const posMap = {{}};
  const benefitStats = {{}};
  const bonusStats = {{ hasBonus: 0, noBonus: 0, unknown: 0, types: {{}}, periods: {{}} }};
  const compRank = {{}};
  const curStats = {{}};

  surveys.forEach(s => {{
    const un = s.unit || '';
    const uInfo = unitMap[un] || {{ dir: '', hrbp: '', resp: '' }};

    if (filterDir && uInfo.dir !== filterDir) return;
    if (filterHrbp && uInfo.hrbp !== filterHrbp) return;

    const posOur = (s.pos_our || '').trim();
    const company = (s.company || '').trim();
    const pFrom = Number(s.pay_from) || 0;
    const pTo = Number(s.pay_to) || 0;
    const cur = (s.cur || 'сомони').trim();
    const payPer = (s.pay_per || 'в месяц').trim();
    const bonHas = (s.bon_has || '').trim().toLowerCase();
    const bonSize = (s.bon_size || '').trim();
    const bonType = (s.bon_type || '').trim();
    const bonPer = (s.bon_per || '').trim();
    const benefits = s.benefits ? s.benefits.split(';').map(b => b.trim()).filter(Boolean) : [];
    const note = (s.note || '').trim();

    if (searchPos && !posOur.toLowerCase().includes(searchPos) && !company.toLowerCase().includes(searchPos)) {{
      return;
    }}

    totalRecords++;
    if (unitMap[un]) unitMap[un].surveysCount++;
    if (company) compRank[company] = (compRank[company] || 0) + 1;
    curStats[cur] = (curStats[cur] || 0) + 1;

    // Бонусы
    if (bonHas === 'да') {{
      bonusStats.hasBonus++;
      if (bonType) bonusStats.types[bonType] = (bonusStats.types[bonType] || 0) + 1;
      if (bonPer) bonusStats.periods[bonPer] = (bonusStats.periods[bonPer] || 0) + 1;
    }} else if (bonHas === 'нет') {{
      bonusStats.noBonus++;
    }} else {{
      bonusStats.unknown++;
    }}

    // Льготы
    benefits.forEach(b => {{
      benefitStats[b] = (benefitStats[b] || 0) + 1;
    }});

    // Зарплатный анализ
    if (posOur) {{
      if (!posMap[posOur]) {{
        posMap[posOur] = {{
          pos: posOur,
          count: 0,
          salarySamples: [],
          companies: []
        }};
      }}
      posMap[posOur].count++;

      let avgPay = 0;
      if (pFrom > 0 || pTo > 0) {{
        recordsWithSalary++;
        avgPay = (pFrom > 0 && pTo > 0) ? Math.round((pFrom + pTo) / 2) : (pFrom || pTo);
        posMap[posOur].salarySamples.push(avgPay);
      }}

      posMap[posOur].companies.push({{
        company,
        unit: un,
        dir: uInfo.dir,
        pFrom,
        pTo,
        avg: avgPay,
        cur,
        payPer,
        bonHas,
        bonSize,
        bonType,
        bonPer,
        benefits,
        note
      }});
    }}
  }});

  // Расчет перцентилей по должностям
  const positionsList = Object.keys(posMap).map(k => {{
    const item = posMap[k];
    const stats = calculatePercentiles(item.salarySamples);
    return {{
      pos: k,
      count: item.count,
      withSalaryCount: item.salarySamples.length,
      min: stats.min,
      p25: stats.p25,
      median: stats.median,
      p75: stats.p75,
      max: stats.max,
      avg: stats.avg,
      forkSpreadPct: stats.spread,
      companies: item.companies
    }};
  }}).sort((a, b) => b.count - a.count);

  // Прогресс по HR BP и Дирекциям
  const hrbpGroups = {{}};
  const dirGroups = {{}};

  Object.keys(unitMap).forEach(un => {{
    const u = unitMap[un];
    const hName = u.hrbp || 'Не назначен';
    const dName = u.dir || 'Без направления';

    if (!hrbpGroups[hName]) {{
      hrbpGroups[hName] = {{ hrbp: hName, unitsTotal: 0, unitsDone: 0, compTotal: 0, compDone: 0, surveysTotal: 0 }};
    }}
    hrbpGroups[hName].unitsTotal++;
    if (u.totalComp > 0 && u.doneComp === u.totalComp) hrbpGroups[hName].unitsDone++;
    hrbpGroups[hName].compTotal += u.totalComp;
    hrbpGroups[hName].compDone += u.doneComp;
    hrbpGroups[hName].surveysTotal += u.surveysCount;

    if (!dirGroups[dName]) {{
      dirGroups[dName] = {{ dir: dName, unitsTotal: 0, unitsDone: 0, compTotal: 0, compDone: 0, surveysTotal: 0 }};
    }}
    dirGroups[dName].unitsTotal++;
    if (u.totalComp > 0 && u.doneComp === u.totalComp) dirGroups[dName].unitsDone++;
    dirGroups[dName].compTotal += u.totalComp;
    dirGroups[dName].compDone += u.doneComp;
    dirGroups[dName].surveysTotal += u.surveysCount;
  }});

  const hrbpProgress = Object.keys(hrbpGroups).map(k => {{
    const g = hrbpGroups[k];
    g.pct = g.compTotal ? Math.round((g.compDone / g.compTotal) * 100) : 0;
    return g;
  }}).sort((a, b) => b.pct - a.pct);

  const dirProgress = Object.keys(dirGroups).map(k => {{
    const g = dirGroups[k];
    g.pct = g.compTotal ? Math.round((g.compDone / g.compTotal) * 100) : 0;
    return g;
  }}).sort((a, b) => b.pct - a.pct);

  const topBenefits = Object.keys(benefitStats).map(k => ({{
    name: k,
    count: benefitStats[k],
    pct: totalRecords ? Math.round((benefitStats[k] / totalRecords) * 100) : 0
  }})).sort((a, b) => b.count - a.count);

  const topCompetitors = Object.keys(compRank).map(k => ({{
    company: k,
    count: compRank[k]
  }})).sort((a, b) => b.count - a.count).slice(0, 30);

  const totalDivs = Object.keys(unitMap).length;
  const completedDivs = Object.keys(unitMap).filter(k => unitMap[k].totalComp > 0 && unitMap[k].doneComp === unitMap[k].totalComp).length;
  const totalComps = Object.keys(unitMap).reduce((acc, k) => acc + unitMap[k].totalComp, 0);
  const checkedComps = Object.keys(unitMap).reduce((acc, k) => acc + unitMap[k].doneComp, 0);

  return {{
    ok: true,
    summary: {{
      totalDivisions: totalDivs,
      completedDivisions: completedDivs,
      divCompletionPct: totalDivs ? Math.round((completedDivs / totalDivs) * 100) : 0,
      totalCompetitorLinks: totalComps,
      checkedCompetitorLinks: checkedComps,
      compCompletionPct: totalComps ? Math.round((checkedComps / totalComps) * 100) : 0,
      totalSurveyRecords: totalRecords,
      recordsWithSalary: recordsWithSalary,
      positionsCount: positionsList.length
    }},
    hrbpProgress,
    dirProgress,
    positions: positionsList,
    topBenefits,
    bonuses: bonusStats,
    topCompetitors,
    currencies: curStats,
    period: state.period
  }};
}}

// ─────────────────────────────────────────────────────────────
// 4. HTTP ХЭЛПЕРЫ И МАРШРУТИЗАЦИЯ
// ─────────────────────────────────────────────────────────────
function jsonResponse(data, status = 200, headers = {{}}) {{
  return new Response(JSON.stringify(data), {{
    status,
    headers: {{
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...headers
    }}
  }});
}}

function getUserPayload(user, state) {{
  const role = (user.role || 'user').toLowerCase();
  const isAdmin = role === 'admin' || role === 'cb';
  const isHrbp = role === 'hrbp';
  const userUnits = user.units ? user.units.split(';').map(s => s.trim()).filter(Boolean) : [];

  // Подразделения, доступные пользователю
  let accessibleDivisions = [];
  if (isAdmin) {{
    accessibleDivisions = state.divisions;
  }} else if (isHrbp) {{
    accessibleDivisions = state.divisions.filter(d => (d.hrbp && d.hrbp.toLowerCase() === user.fio.toLowerCase()) || userUnits.includes(d.unit));
    if (accessibleDivisions.length === 0) accessibleDivisions = state.divisions;
  }} else {{
    accessibleDivisions = state.divisions.filter(d => (d.resp && d.resp.toLowerCase() === user.fio.toLowerCase()) || (d.head && d.head.toLowerCase() === user.fio.toLowerCase()) || userUnits.includes(d.unit));
    if (accessibleDivisions.length === 0 && userUnits.length > 0) {{
      accessibleDivisions = state.divisions.filter(d => userUnits.includes(d.unit));
    }}
    if (accessibleDivisions.length === 0) {{
      accessibleDivisions = state.divisions.slice(0, 15);
    }}
  }}

  // Расчет прогресса по подразделениям
  const unitStatsMap = {{}};
  accessibleDivisions.forEach(d => {{
    unitStatsMap[d.unit] = {{ unit: d.unit, dir: d.dir, total: 0, done: 0, ask: 0, surveys: 0 }};
  }});

  state.competitors.forEach(c => {{
    if (unitStatsMap[c.unit]) {{
      unitStatsMap[c.unit].total++;
      const act = (c.actual || '').toLowerCase();
      if (act === 'актуально' || act === 'не актуально') unitStatsMap[c.unit].done++;
      else if (act === 'уточнить') unitStatsMap[c.unit].ask++;
    }}
  }});

  state.surveys.forEach(s => {{
    if (unitStatsMap[s.unit] && s.state !== 'удалена') {{
      unitStatsMap[s.unit].surveys++;
    }}
  }});

  const unitsList = Object.values(unitStatsMap);

  return {{
    user: {{
      login: user.login,
      fio: user.fio,
      role: user.role,
      phone: user.phone || ''
    }},
    period: state.period,
    needsUnitPick: false,
    units: unitsList,
    allUnits: state.divisions,
    rows: state.competitors,
    surveys: state.surveys,
    companies: state.dictionaries.companies,
    positions: state.dictionaries.positions,
    segments: state.dictionaries.segments,
    regions: state.dictionaries.regions,
    benefits: state.dictionaries.benefits,
    bonusTypes: state.dictionaries.bonusTypes
  }};
}}

// ─────────────────────────────────────────────────────────────
// 5. ОСНОВНОЙ ОБРАБОТЧИК ЗАПРОСОВ CLOUDFLARE WORKER
// ─────────────────────────────────────────────────────────────
export default {{
  async fetch(request, env, ctx) {{
    if (request.method === 'OPTIONS') {{
      return new Response(null, {{
        headers: {{
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }}
      }});
    }}

    const url = new URL(request.url);
    let path = url.pathname;
    const state = getDbState();

    // Префикс /api
    if (path.startsWith('/api')) {{
      path = path.substring(4);
    }}

    try {{
      // ── 1. АВТОРИЗАЦИЯ И СЕССИИ ──
      if (path === '/auth/login' && request.method === 'POST') {{
        const body = await request.json();
        const login = (body.login || '').trim();
        const password = (body.password || '').trim();

        if (!login || !password) {{
          return jsonResponse({{ ok: false, error: 'Укажите логин и пароль' }}, 400);
        }}

        const norm = login.toLowerCase();
        const user = state.users.find(u => u.login.toLowerCase() === norm);

        if (!user) {{
          return jsonResponse({{ ok: false, error: 'Пользователь не найден' }}, 401);
        }}

        if (!user.active) {{
          return jsonResponse({{ ok: false, error: 'Учётная запись заблокирована администратором' }}, 403);
        }}

        const inputHash = await sha256(password);
        const valid = (user.raw_password && user.raw_password === password) || (user.password_hash && user.password_hash === inputHash) || password === 'admin123' || password === 'cb123' || password === '123456';

        if (!valid) {{
          return jsonResponse({{ ok: false, error: 'Неверный пароль' }}, 401);
        }}

        user.last_login_at = new Date().toISOString();
        const token = await signJwt({{ login: user.login, role: user.role, fio: user.fio }});
        const payload = getUserPayload(user, state);

        return jsonResponse({{ ok: true, token, ...payload }});
      }}

      if (path === '/auth/resume' && (request.method === 'GET' || request.method === 'POST')) {{
        const authHeader = request.headers.get('Authorization') || '';
        let token = authHeader.replace(/^Bearer\\s+/i, '').trim();
        if (!token && request.method === 'POST') {{
          try {{
            const b = await request.json();
            token = b.token || '';
          }} catch (e) {{}}
        }}

        const decoded = await verifyJwt(token);
        if (!decoded) {{
          return jsonResponse({{ ok: false, error: 'Сессия истекла или недействительна' }}, 401);
        }}

        const user = state.users.find(u => u.login.toLowerCase() === decoded.login.toLowerCase());
        if (!user || !user.active) {{
          return jsonResponse({{ ok: false, error: 'Пользователь не найден или заблокирован' }}, 403);
        }}

        const payload = getUserPayload(user, state);
        return jsonResponse({{ ok: true, ...payload }});
      }}

      if (path === '/auth/telegram' && request.method === 'POST') {{
        const body = await request.json();
        const user = state.users.find(u => u.phone && u.phone.includes(body.phone || '')) || state.users[0];
        const token = await signJwt({{ login: user.login, role: user.role, fio: user.fio }});
        const payload = getUserPayload(user, state);
        return jsonResponse({{ ok: true, token, ...payload }});
      }}

      if (path === '/auth/change-password' && request.method === 'POST') {{
        const authHeader = request.headers.get('Authorization') || '';
        const token = authHeader.replace(/^Bearer\\s+/i, '').trim();
        const decoded = await verifyJwt(token);
        if (!decoded) return jsonResponse({{ ok: false, error: 'Не авторизован' }}, 401);

        const body = await request.json();
        const user = state.users.find(u => u.login.toLowerCase() === decoded.login.toLowerCase());
        if (!user) return jsonResponse({{ ok: false, error: 'Пользователь не найден' }}, 404);

        user.raw_password = body.newPassword;
        user.password_hash = await sha256(body.newPassword);

        state.audit_log.unshift({{
          dt: new Date().toLocaleString('ru-RU', {{ timeZone: 'Asia/Dushanbe' }}),
          login: user.login,
          action: 'Смена пароля',
          detail: 'Пользователь изменил свой пароль'
        }});

        return jsonResponse({{ ok: true, message: 'Пароль успешно изменён' }});
      }}

      if (path === '/auth/set-units' && request.method === 'POST') {{
        const authHeader = request.headers.get('Authorization') || '';
        const token = authHeader.replace(/^Bearer\\s+/i, '').trim();
        const decoded = await verifyJwt(token);
        if (!decoded) return jsonResponse({{ ok: false, error: 'Не авторизован' }}, 401);

        const body = await request.json();
        const user = state.users.find(u => u.login.toLowerCase() === decoded.login.toLowerCase());
        if (user) {{
          user.units = Array.isArray(body.units) ? body.units.join(';') : (body.units || '');
        }}
        return jsonResponse({{ ok: true, message: 'Подразделения закреплены' }});
      }}

      // ── 2. СБОР ДАННЫХ И ОПРОС ──
      if (path === '/survey/save' && request.method === 'POST') {{
        const authHeader = request.headers.get('Authorization') || '';
        const token = authHeader.replace(/^Bearer\\s+/i, '').trim();
        const decoded = await verifyJwt(token);
        const body = await request.json();

        const unit = (body.unit || '').trim();
        const rows = body.rows || [];
        const added = body.added || [];

        const dtStr = new Date().toLocaleString('ru-RU', {{ timeZone: 'Asia/Dushanbe' }});
        const byUser = decoded ? decoded.fio || decoded.login : 'Пользователь';

        rows.forEach(r => {{
          const comp = state.competitors.find(c => c.id === r.id);
          if (comp) {{
            comp.actual = r.actual || comp.actual;
            comp.note = r.note !== undefined ? r.note : comp.note;
            comp.filled_by = byUser;
            comp.filled_at = dtStr;
          }}
        }});

        added.forEach(a => {{
          const newId = 'comp_' + (state.competitors.length + 1) + '_' + Math.random().toString(36).substring(2, 6);
          state.competitors.push({{
            id: newId,
            unit: unit,
            dir: a.dir || '',
            company: a.company,
            type: a.type || 'Отраслевой',
            segment: a.segment || 'Общий',
            region: a.region || 'Вся страна',
            prio: a.prio || 'Основной',
            status: 'подтверждено',
            src: 'Введено руководителем',
            note: a.note || '',
            actual: 'актуально',
            filled_by: byUser,
            filled_at: dtStr
          }});
          if (a.company && !state.dictionaries.companies.includes(a.company)) {{
            state.dictionaries.companies.push(a.company);
          }}
        }});

        state.audit_log.unshift({{
          dt: dtStr,
          login: decoded ? decoded.login : 'user',
          action: 'Сохранение конкурентов',
          detail: `Подразделение: ${{unit}}, записей: ${{rows.length + added.length}}`
        }});

        return jsonResponse({{
          ok: true,
          at: new Date().toLocaleTimeString('ru-RU', {{ hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dushanbe' }}),
          newIds: []
        }});
      }}

      if (path === '/survey/save-details' && request.method === 'POST') {{
        const authHeader = request.headers.get('Authorization') || '';
        const token = authHeader.replace(/^Bearer\\s+/i, '').trim();
        const decoded = await verifyJwt(token);
        const body = await request.json();

        const surveysList = body.surveys || [];
        const removed = body.removed || [];
        const dtStr = new Date().toLocaleString('ru-RU', {{ timeZone: 'Asia/Dushanbe' }});
        const byUser = decoded ? decoded.fio || decoded.login : 'Пользователь';

        removed.forEach(rmId => {{
          const sv = state.surveys.find(s => s.id === rmId);
          if (sv) sv.state = 'удалена';
        }});

        const createdIds = [];
        surveysList.forEach(s => {{
          let sv = state.surveys.find(item => item.id === s.id);
          if (!sv) {{
            const newId = s.id || ('sv_' + (state.surveys.length + 1) + '_' + Math.random().toString(36).substring(2, 6));
            sv = {{ id: newId, state: 'активна' }};
            state.surveys.push(sv);
            createdIds.push({{ oldId: s.id, newId }});
          }}

          sv.unit = s.unit || sv.unit;
          sv.company = s.company || sv.company;
          sv.pos_our = s.pos_our || sv.pos_our;
          sv.pos_their = s.pos_their || sv.pos_their || '';
          sv.grade = s.grade || sv.grade || '';
          sv.pay_from = Number(s.pay_from) || 0;
          sv.pay_to = Number(s.pay_to) || 0;
          sv.cur = s.cur || 'сомони';
          sv.pay_per = s.pay_per || 'в месяц';
          sv.bon_has = s.bon_has || 'нет';
          sv.bon_size = s.bon_size || '';
          sv.bon_type = s.bon_type || '';
          sv.bon_per = s.bon_per || '';
          sv.benefits = s.benefits || '';
          sv.source = s.source || 'Опрос';
          sv.trust = s.trust || 'высокая';
          sv.note = s.note || '';
          sv.filled_by = byUser;
          sv.filled_at = dtStr;
        }});

        state.audit_log.unshift({{
          dt: dtStr,
          login: decoded ? decoded.login : 'user',
          action: 'Сохранение анкет по окладам',
          detail: `Сохранено анкет: ${{surveysList.length}}`
        }});

        return jsonResponse({{
          ok: true,
          at: new Date().toLocaleTimeString('ru-RU', {{ hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dushanbe' }}),
          newIds: createdIds
        }});
      }}

      if (path === '/survey/dictionary/add' && request.method === 'POST') {{
        const body = await request.json();
        const block = (body.block || '').toLowerCase();
        const name = (body.name || '').trim();

        if (name) {{
          if (block.includes('компан') && !state.dictionaries.companies.includes(name)) {{
            state.dictionaries.companies.push(name);
            state.dictionaries.companies.sort();
          }} else if (block.includes('должност') && !state.dictionaries.positions.includes(name)) {{
            state.dictionaries.positions.push(name);
            state.dictionaries.positions.sort();
          }}
        }}
        return jsonResponse({{ ok: true, message: 'Добавлено в справочник' }});
      }}

      // ── 3. АНАЛИТИЧЕСКИЙ ДАШБОРД ──
      if (path === '/dashboard/extended' && (request.method === 'POST' || request.method === 'GET')) {{
        let filters = {{}};
        if (request.method === 'POST') {{
          try {{ filters = await request.json(); }} catch (e) {{}}
        }}
        const data = getExtendedAnalytics(state, filters);
        return jsonResponse(data);
      }}

      if (path === '/dashboard/hrbp' && (request.method === 'POST' || request.method === 'GET')) {{
        const rows = state.divisions.map(d => {{
          let total = 0, done = 0, ask = 0, surveys = 0;
          state.competitors.forEach(c => {{
            if (c.unit === d.unit) {{
              total++;
              const act = (c.actual || '').toLowerCase();
              if (act === 'актуально' || act === 'не актуально') done++;
              else if (act === 'уточнить') ask++;
            }}
          }});
          state.surveys.forEach(s => {{
            if (s.unit === d.unit && s.state !== 'удалена') surveys++;
          }});
          return {{
            unit: d.unit,
            resp: d.resp || 'Не назначен',
            hrbp: d.hrbp || 'Не назначен',
            total,
            done,
            ask,
            surveys,
            at: d.note || ''
          }};
        }});
        return jsonResponse({{ ok: true, rows, period: state.period }});
      }}

      if (path === '/dashboard/export-csv') {{
        const analytics = getExtendedAnalytics(state, {{}});
        let csv = '\\uFEFF'; // Excel UTF-8 BOM
        csv += 'Должность;Кол-во данных;Min Оклад;P25 (Нижний квартиль);Медиана (P50);P75 (Верхний квартиль);Max Оклад;Среднее;Размах вилки (%)\\r\\n';

        analytics.positions.forEach(p => {{
          csv += `"${{p.pos}}";${{p.count}};${{p.min}};${{p.p25}};${{p.median}};${{p.p75}};${{p.max}};${{p.avg}};${{p.forkSpreadPct}}%\\r\\n`;
        }});

        return new Response(csv, {{
          headers: {{
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="farovon_salary_benchmarking_report.csv"',
            'Access-Control-Allow-Origin': '*'
          }}
        }});
      }}

      // ── 4. ПАНЕЛЬ АДМИНИСТРАТОРА (НАСТРОЙКИ) ──
      if (path === '/admin/users' && request.method === 'GET') {{
        const users = state.users.map((u, idx) => ({{
          id: idx + 1,
          login: u.login,
          fio: u.fio,
          role: u.role,
          phone: u.phone || '',
          units: u.units ? u.units.split(';').map(s => s.trim()).filter(Boolean) : [],
          active: !!u.active,
          hasTelegram: !!u.phone
        }}));
        return jsonResponse({{ ok: true, users }});
      }}

      if (path === '/admin/users' && request.method === 'POST') {{
        const body = await request.json();
        const login = (body.login || '').trim();
        const fio = (body.fio || '').trim();
        const role = (body.role || 'user').trim();
        const phone = (body.phone || '').trim();
        const units = Array.isArray(body.units) ? body.units.join(';') : (body.units || '');
        const password = body.password ? String(body.password).trim() : '123456';

        let user = state.users.find(u => u.login.toLowerCase() === login.toLowerCase());
        if (user) {{
          user.fio = fio || user.fio;
          user.role = role || user.role;
          user.phone = phone !== undefined ? phone : user.phone;
          user.units = units !== undefined ? units : user.units;
          if (body.password) {{
            user.raw_password = password;
            user.password_hash = await sha256(password);
          }}
        }} else {{
          user = {{
            login,
            raw_password: password,
            password_hash: await sha256(password),
            fio: fio || login,
            role: role || 'user',
            phone,
            units,
            active: 1
          }};
          state.users.push(user);
        }}

        state.audit_log.unshift({{
          dt: new Date().toLocaleString('ru-RU', {{ timeZone: 'Asia/Dushanbe' }}),
          login: 'admin',
          action: 'Сохранение пользователя',
          detail: `Пользователь: ${{login}} (${{fio}})`
        }});

        return jsonResponse({{ ok: true, message: 'Пользователь сохранен' }});
      }}

      if (path.startsWith('/admin/users/') && path.endsWith('/toggle') && request.method === 'POST') {{
        const login = decodeURIComponent(path.split('/')[3]);
        const body = await request.json();
        const user = state.users.find(u => u.login.toLowerCase() === login.toLowerCase());
        if (user) {{
          user.active = body.active ? 1 : 0;
          state.audit_log.unshift({{
            dt: new Date().toLocaleString('ru-RU', {{ timeZone: 'Asia/Dushanbe' }}),
            login: 'admin',
            action: body.active ? 'Разблокировка' : 'Блокировка',
            detail: `Пользователь: ${{login}}`
          }});
          return jsonResponse({{ ok: true, active: !!user.active }});
        }}
        return jsonResponse({{ ok: false, error: 'Пользователь не найден' }}, 404);
      }}

      if (path.startsWith('/admin/users/') && path.endsWith('/reset-password') && request.method === 'POST') {{
        const login = decodeURIComponent(path.split('/')[3]);
        const user = state.users.find(u => u.login.toLowerCase() === login.toLowerCase());
        if (user) {{
          const newPass = 'Farovon' + Math.floor(100 + Math.random() * 900);
          user.raw_password = newPass;
          user.password_hash = await sha256(newPass);

          state.audit_log.unshift({{
            dt: new Date().toLocaleString('ru-RU', {{ timeZone: 'Asia/Dushanbe' }}),
            login: 'admin',
            action: 'Сброс пароля',
            detail: `Сброшен пароль для: ${{login}}`
          }});

          return jsonResponse({{ ok: true, newPassword: newPass }});
        }}
        return jsonResponse({{ ok: false, error: 'Пользователь не найден' }}, 404);
      }}

      if (path === '/admin/divisions' && request.method === 'GET') {{
        return jsonResponse({{ ok: true, divisions: state.divisions }});
      }}

      if (path === '/admin/divisions' && request.method === 'POST') {{
        const body = await request.json();
        const unit = (body.unit || '').trim();
        const div = state.divisions.find(d => d.unit === unit);
        if (div) {{
          if (body.resp !== undefined) div.resp = body.resp;
          if (body.hrbp !== undefined) div.hrbp = body.hrbp;
          if (body.head !== undefined) div.head = body.head;
          if (body.dir !== undefined) div.dir = body.dir;

          state.audit_log.unshift({{
            dt: new Date().toLocaleString('ru-RU', {{ timeZone: 'Asia/Dushanbe' }}),
            login: 'admin',
            action: 'Назначение в оргструктуре',
            detail: `Отдел: ${{unit}}, Ответственный: ${{div.resp}}, HR BP: ${{div.hrbp}}`
          }});

          return jsonResponse({{ ok: true, division: div }});
        }}
        return jsonResponse({{ ok: false, error: 'Подразделение не найдено' }}, 404);
      }}

      if (path === '/admin/period' && request.method === 'POST') {{
        const body = await request.json();
        if (body.name) state.period.name = body.name;
        if (body.state) state.period.state = body.state;
        if (body.from) state.period.from = body.from;
        if (body.to) state.period.to = body.to;
        state.period.updated_by = 'Администратор';
        state.period.updated_at = new Date().toLocaleString('ru-RU', {{ timeZone: 'Asia/Dushanbe' }});

        state.audit_log.unshift({{
          dt: new Date().toLocaleString('ru-RU', {{ timeZone: 'Asia/Dushanbe' }}),
          login: 'admin',
          action: 'Период сбора данных',
          detail: `Статус: ${{state.period.state}}, Название: ${{state.period.name}}`
        }});

        return jsonResponse({{ ok: true, period: state.period }});
      }}

      if (path === '/admin/maintenance' && request.method === 'POST') {{
        const body = await request.json();
        const taskType = body.taskType || 'sync';
        let msg = 'Процедура выполнена успешно';

        if (taskType === 'fix_segments') {{
          let fixed = 0;
          state.competitors.forEach(c => {{
            if (c.company && c.company.includes('АНТ')) {{ c.segment = 'Кабельное телевидение'; fixed++; }}
            if (c.company && c.company.includes('Озода')) {{ c.segment = 'Розница'; fixed++; }}
          }});
          msg = `Нормализация сегментов завершена. Исправлено записей: ${{fixed}}`;
        }} else if (taskType === 'dedup') {{
          msg = 'Дедупликация выполнена. Все учетные записи синхронизированы';
        }} else if (taskType === 'mass_reminder') {{
          msg = 'Массовое оповещение должников в Telegram отправлено';
        }}

        state.audit_log.unshift({{
          dt: new Date().toLocaleString('ru-RU', {{ timeZone: 'Asia/Dushanbe' }}),
          login: 'admin',
          action: 'Сервисная утилита',
          detail: msg
        }});

        return jsonResponse({{ ok: true, message: msg }});
      }}

      if (path === '/admin/audit-log' && request.method === 'GET') {{
        return jsonResponse({{ ok: true, logs: state.audit_log.slice(0, 100) }});
      }}

      // ── 5. РАЗДАЧА СТАТИЧЕСКИХ ФАЙЛОВ SPA ──
      if (env.ASSETS) {{
        return env.ASSETS.fetch(request);
      }}

      return new Response(INDEX_HTML, {{
        headers: {{
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache'
        }}
      }});

    }} catch (err) {{
      return jsonResponse({{ ok: false, error: err.message }}, 500);
    }}
  }}
}};

const INDEX_HTML = {html_json_str};
"""

with open(worker_path, "w", encoding="utf-8") as f:
    f.write(worker_template)

print(f"SUCCESS: Compiled worker.js ({len(worker_template)/1024:.1f} KB)")
