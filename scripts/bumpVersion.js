/**
 * scripts/bumpVersion.js
 * 
 * Автоматический инкремент и синхронизация версии проекта:
 * - package.json
 * - client/index.html (?v=...)
 * - client/app-core.js (APP_VERSION, window.APP_VERSION)
 * - client/app.js (window.APP_VERSION)
 * - client/sw.js (CACHE_NAME = 'farovon-market-v...')
 * 
 * Использование:
 *   node scripts/bumpVersion.js          -> инкремент patch (2.5.0 -> 2.5.1)
 *   node scripts/bumpVersion.js minor    -> инкремент minor (2.5.0 -> 2.6.0)
 *   node scripts/bumpVersion.js major    -> инкремент major (2.5.0 -> 3.0.0)
 *   node scripts/bumpVersion.js --sync   -> синхронизация всех файлов под текущую версию package.json
 *   node scripts/bumpVersion.js --hook   -> запуск из git pre-commit хука
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT_DIR, 'package.json');
const HTML_PATH = path.join(ROOT_DIR, 'client/index.html');
const CORE_PATH = path.join(ROOT_DIR, 'client/app-core.js');
const APP_PATH = path.join(ROOT_DIR, 'client/app.js');
const SW_PATH = path.join(ROOT_DIR, 'client/sw.js');

const VERSION_METADATA_FILES = [
  'package.json',
  'package-lock.json'
];

const VERSION_SYNC_FILES = [
  'package.json',
  'package-lock.json',
  'client/index.html',
  'client/app-core.js',
  'client/app.js',
  'client/sw.js'
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function parseVersion(verStr) {
  const clean = verStr.replace(/^v/, '').trim();
  const parts = clean.split('.').map(n => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return { major: parts[0], minor: parts[1], patch: parts[2] };
}

function bumpVersion(curVer, bumpType) {
  const { major, minor, patch } = parseVersion(curVer);
  switch (bumpType) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
    default:
      return `${major}.${minor}.${patch + 1}`;
  }
}

function getStagedFiles() {
  try {
    const out = execSync('git diff --cached --name-only', { cwd: ROOT_DIR, encoding: 'utf8' });
    return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch (e) {
    return [];
  }
}

function getHeadVersion() {
  try {
    const out = execSync('git show HEAD:package.json', { cwd: ROOT_DIR, encoding: 'utf8' });
    const pkg = JSON.parse(out);
    return pkg.version || null;
  } catch (e) {
    return null;
  }
}

function main() {
  const args = process.argv.slice(2);
  const isHook = args.includes('--hook');
  let shouldSyncOnly = args.includes('--sync');
  const bumpArg = args.find(a => !a.startsWith('--')) || 'patch';

  if (!fs.existsSync(PKG_PATH)) {
    console.error('❌ package.json не найден!');
    process.exit(1);
  }

  const pkg = readJson(PKG_PATH);
  const curVer = pkg.version || '1.0.0';

  // Если запуск из git pre-commit хука:
  if (isHook) {
    const staged = getStagedFiles();
    if (staged.length === 0) {
      // Ничего не застейджено
      process.exit(0);
    }
    // Проверяем, застейджено ли что-то кроме самих файлов версии
    const nonVersionFiles = staged.filter(f => !VERSION_METADATA_FILES.includes(f.replace(/\\/g, '/')));
    if (nonVersionFiles.length === 0) {
      // Застейджены только файлы версии — не бампаем повторно во избежание цикла
      process.exit(0);
    }

    // Если версия уже была увеличена относительно HEAD, бамп уже сделан для этого набора правок
    const headVer = getHeadVersion();
    if (headVer && headVer !== curVer) {
      shouldSyncOnly = true;
    }
  }

  let nextVer = curVer;
  if (!shouldSyncOnly) {
    if (/^\d+\.\d+\.\d+$/.test(bumpArg)) {
      nextVer = bumpArg;
    } else {
      nextVer = bumpVersion(curVer, bumpArg);
    }
  }

  console.log(`\n🚀 [bumpVersion] ${shouldSyncOnly ? 'Синхронизация версии' : `Обновление версии: v${curVer} -> v${nextVer}`}`);

  // 1. package.json
  if (pkg.version !== nextVer) {
    pkg.version = nextVer;
    fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    console.log(`  ✓ package.json -> ${nextVer}`);
  }

  // 2. client/index.html
  if (fs.existsSync(HTML_PATH)) {
    let html = fs.readFileSync(HTML_PATH, 'utf8');
    // Заменяем ?v=... на всех скриптах и стилях, а также текст в бейджах версий
    let updatedHtml = html.replace(/\?v=[a-zA-Z0-9._-]+/g, `?v=${nextVer}`);
    updatedHtml = updatedHtml.replace(/(<span class="sheet-ver-badge"[^>]*>)[^<]*(<\/span>)/g, `$1v${nextVer}$2`);
    if (updatedHtml !== html) {
      fs.writeFileSync(HTML_PATH, updatedHtml, 'utf8');
      console.log(`  ✓ client/index.html (?v=${nextVer}, бейдж: v${nextVer})`);
    }
  }

  // 3. client/app-core.js
  if (fs.existsSync(CORE_PATH)) {
    let core = fs.readFileSync(CORE_PATH, 'utf8');
    // Обновляем var APP_VERSION = ...; и гарантируем window.APP_VERSION
    const coreRegex = /var APP_VERSION = (?:window\.APP_VERSION \|\| )?['"]v?[^'"]+['"];(?:\r?\n)?(?:window\.APP_VERSION = APP_VERSION;)?/;
    const replacement = `var APP_VERSION = window.APP_VERSION || 'v${nextVer}';\nwindow.APP_VERSION = APP_VERSION;`;
    if (coreRegex.test(core)) {
      core = core.replace(coreRegex, replacement);
      fs.writeFileSync(CORE_PATH, core, 'utf8');
      console.log(`  ✓ client/app-core.js (v${nextVer})`);
    }
  }

  // 4. client/app.js
  if (fs.existsSync(APP_PATH)) {
    let appJs = fs.readFileSync(APP_PATH, 'utf8');
    // Заменяем любые захардкоженные дефолты на текущую версию
    const appRegex = /\(window\.APP_VERSION \|\| ['"]v?[^'"]+['"]\)/g;
    const replacement = `(window.APP_VERSION || 'v${nextVer}')`;
    if (appRegex.test(appJs)) {
      appJs = appJs.replace(appRegex, replacement);
      fs.writeFileSync(APP_PATH, appJs, 'utf8');
      console.log(`  ✓ client/app.js (v${nextVer})`);
    }
  }

  // 5. client/sw.js
  if (fs.existsSync(SW_PATH)) {
    let sw = fs.readFileSync(SW_PATH, 'utf8');
    const safeVer = nextVer.replace(/\./g, '-');
    const swRegex = /const CACHE_NAME = ['"]farovon-market-v[^'"]+['"];/;
    const replacement = `const CACHE_NAME = 'farovon-market-v${safeVer}';`;
    if (swRegex.test(sw)) {
      sw = sw.replace(swRegex, replacement);
      fs.writeFileSync(SW_PATH, sw, 'utf8');
      console.log(`  ✓ client/sw.js (CACHE_NAME: farovon-market-v${safeVer})`);
    }
  }

  // 6. Если в режиме git-хука или есть застейдженные файлы, добавляем файлы версии в git index
  if (isHook) {
    try {
      execSync(`git add ${VERSION_SYNC_FILES.join(' ')}`, { cwd: ROOT_DIR });
      console.log(`  ✓ Файлы версии автоматически добавлены в коммит (git add)`);
    } catch (e) {
      console.warn(`  ⚠️ Не удалось выполнить git add для файлов версии: ${e.message}`);
    }
  }

  console.log(`✨ Версия успешно обновлена: v${nextVer}\n`);
}

main();
