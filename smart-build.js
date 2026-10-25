/**
 * Aura AI — Smart APK Builder
 * Auto-answers bubblewrap prompts via spawn + stdout watching
 */
const { spawn, spawnSync, execSync } = require('child_process');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = __dirname;
const TWA  = path.join(ROOT, 'twa-build');
const PORT = 5757;

// ── Colours ───────────────────────────────────────────────────────
const G  = s => `\x1b[32m${s}\x1b[0m`;
const B  = s => `\x1b[34;1m${s}\x1b[0m`;
const Y  = s => `\x1b[33m${s}\x1b[0m`;
const R  = s => `\x1b[31m${s}\x1b[0m`;
const C  = s => `\x1b[36m${s}\x1b[0m`;
const W  = s => `\x1b[1m${s}\x1b[0m`;
const ok   = m => console.log(` ${G('✔')} ${m}`);
const info = m => console.log(` ${C('ℹ')} ${m}`);
const warn = m => console.log(` ${Y('⚠')} ${m}`);
const step = m => console.log(`\n ${B('▶')} ${W(m)}`);
const bar  = m => {
  const line = '═'.repeat(58);
  console.log(`\n\x1b[35;1m${line}\n  ${m}\n${line}\x1b[0m\n`);
};

// ── Local static server ───────────────────────────────────────────
function startServer() {
  const mime = {
    '.html':'text/html','.css':'text/css','.js':'application/javascript',
    '.json':'application/json','.png':'image/png','.svg':'image/svg+xml',
    '.ico':'image/x-icon','.webmanifest':'application/manifest+json',
  };
  const srv = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    const fp  = path.join(ROOT, url === '/' ? 'index.html' : url);
    try {
      const data = fs.readFileSync(fp);
      res.writeHead(200, { 'Content-Type': mime[path.extname(fp)] || 'text/plain', 'Access-Control-Allow-Origin':'*' });
      res.end(data);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  return new Promise(r => srv.listen(PORT, () => r(srv)));
}

// ── Ensure placeholder icon ───────────────────────────────────────
function ensureIcons() {
  // Minimal valid PNG (8x8 solid indigo) encoded in base64
  const SMALL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVQI12P8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  for (const size of [48, 72, 96, 128, 192, 256, 512]) {
    const p = path.join(ROOT, `icon-${size}.png`);
    if (!fs.existsSync(p) || fs.statSync(p).size < 100) {
      fs.writeFileSync(p, SMALL_PNG);
    }
  }
  ok('App icons ready');
}

// ── Auto-answer bubblewrap prompts ────────────────────────────────
// Bubblewrap asks a series of prompts. We detect keywords and respond.
const ANSWERS = [
  // Pattern (in received output)  →  Answer to send
  { match: /install.*jdk/i,                    ans: 'Y\n',  note: 'Install JDK' },
  { match: /install.*android.*sdk/i,           ans: 'Y\n',  note: 'Install Android SDK' },
  { match: /jdk.*installation/i,               ans: 'Y\n',  note: 'JDK installation' },
  { match: /sdk.*installation/i,               ans: 'Y\n',  note: 'SDK installation' },
  { match: /domain.*host/i,                    ans: '\n',   note: 'Domain (use default)' },
  { match: /application.*name/i,               ans: '\n',   note: 'App name (use default)' },
  { match: /short.*name/i,                     ans: '\n',   note: 'Short name (use default)' },
  { match: /package.*name|application.*id/i,   ans: '\n',   note: 'Package name (use default)' },
  { match: /display.*mode/i,                   ans: '\n',   note: 'Display mode (use default)' },
  { match: /orientation/i,                     ans: '\n',   note: 'Orientation (use default)' },
  { match: /status.*bar.*color|theme.*color/i, ans: '\n',   note: 'Theme color (use default)' },
  { match: /background.*color/i,               ans: '\n',   note: 'BG color (use default)' },
  { match: /icon.*url/i,                       ans: '\n',   note: 'Icon URL (use default)' },
  { match: /maskable.*icon/i,                  ans: '\n',   note: 'Maskable icon (use default)' },
  { match: /signing.*key|keystore/i,           ans: '\n',   note: 'Signing key (use default)' },
  { match: /key.*alias/i,                      ans: '\n',   note: 'Key alias (use default)' },
  { match: /notification/i,                    ans: '\n',   note: 'Notifications (use default)' },
  { match: /google.*play|play.*billing/i,      ans: 'N\n',  note: 'Play billing (No)' },
  { match: /location.*delegation/i,            ans: 'N\n',  note: 'Location delegation (No)' },
  { match: /site.*settings/i,                  ans: '\n',   note: 'Site settings (use default)' },
  { match: /version.*code/i,                   ans: '\n',   note: 'Version code (use default)' },
  { match: /version.*name/i,                   ans: '\n',   note: 'Version name (use default)' },
  { match: /\(Y\/n\)|\(y\/N\)|\[.*\]/i,        ans: '\n',   note: 'Generic default' },
  { match: /\?[\s]+$/,                         ans: '\n',   note: 'Generic question' },
];

function spawnWithAutoAnswer(cmd, args, cwd, envExtra = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...envExtra };
    const proc = spawn(cmd, args, {
      shell:  true,
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let buf    = '';
    let lastAnswerTime = 0;

    const tryAnswer = () => {
      const now = Date.now();
      if (now - lastAnswerTime < 300) return; // debounce

      for (const rule of ANSWERS) {
        if (rule.match.test(buf)) {
          lastAnswerTime = now;
          info(`  Auto-answer [${rule.note}]: ${JSON.stringify(rule.ans.trim() || '(Enter)')}`);
          proc.stdin.write(rule.ans);
          buf = ''; // clear buffer after answering
          return;
        }
      }
    };

    // Pipe stdout to console and detect prompts
    proc.stdout.on('data', chunk => {
      const text = chunk.toString();
      process.stdout.write(text);
      buf += text;
      // If output seems to have paused at a prompt line, answer it
      setTimeout(tryAnswer, 500);
    });

    proc.stderr.on('data', chunk => {
      const text = chunk.toString();
      process.stderr.write(text);
      buf += text;
      setTimeout(tryAnswer, 500);
    });

    // Periodically send Enter in case we missed a prompt
    const heartbeat = setInterval(() => {
      if (Date.now() - lastAnswerTime > 8000) {
        proc.stdin.write('\n');
        lastAnswerTime = Date.now();
      }
    }, 8000);

    proc.on('close', code => {
      clearInterval(heartbeat);
      if (code === 0 || code === null) resolve(code);
      else reject(new Error(`Process exited with code ${code}`));
    });

    proc.on('error', err => {
      clearInterval(heartbeat);
      reject(err);
    });

    // Initial newline push after 2s in case of any initial prompts
    setTimeout(() => { proc.stdin.write('\n'); }, 2000);
  });
}

// ── Find bubblewrap binary ────────────────────────────────────────
function findBubblewrap() {
  try {
    const r = spawnSync('bubblewrap', ['--version'], { shell: true, stdio: 'pipe' });
    if (r.status === 0) return 'bubblewrap';
  } catch {}
  // Try npm global bin
  try {
    const npmBin = execSync('npm bin -g', { stdio: 'pipe' }).toString().trim();
    const bw = path.join(npmBin, 'bubblewrap.cmd');
    if (fs.existsSync(bw)) return `"${bw}"`;
  } catch {}
  // Try npx
  return 'npx @bubblewrap/cli';
}

// ── Find output APK ───────────────────────────────────────────────
function findApk() {
  const candidates = [
    path.join(TWA, 'app-release-signed.apk'),
    path.join(TWA, 'app-release.apk'),
    path.join(TWA, 'app', 'build', 'outputs', 'apk', 'release', 'app-release-signed.apk'),
    path.join(TWA, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
    path.join(TWA, 'app', 'build', 'outputs', 'apk', 'release', 'app-release-unsigned.apk'),
    path.join(TWA, 'app', 'build', 'outputs', 'apk', 'debug',   'app-debug.apk'),
  ];
  return candidates.find(p => {
    try { return fs.existsSync(p) && fs.statSync(p).size > 10000; } catch { return false; }
  });
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  console.clear();
  bar('🤖  AURA AI — APK BUILDER  v2');

  // Prepare
  fs.mkdirSync(TWA, { recursive: true });

  // Icons
  step('Preparing app icons…');
  ensureIcons();

  // Server
  step('Starting PWA server…');
  const server = await startServer();
  const BASE   = `http://localhost:${PORT}`;
  ok(`Server → ${C(BASE)}`);

  // Find bubblewrap
  const BW = findBubblewrap();
  ok(`Bubblewrap → ${C(BW)}`);

  // ── INIT ─────────────────────────────────────────────────────────
  step(`bubblewrap init (auto-answering all prompts)…`);
  info(`Manifest: ${BASE}/manifest.json`);
  info('Bubblewrap will download JDK + Android SDK on first run (~500 MB)');
  info('All prompts will be auto-answered with recommended defaults\n');

  try {
    await spawnWithAutoAnswer(
      BW,
      ['init', `--manifest ${BASE}/manifest.json`],
      TWA,
      {
        BUBBLEWRAP_SKIP_FETCH: '0',
        CI: '0', // NOT CI so prompts appear; we answer them
      }
    );
    ok('bubblewrap init complete!');
  } catch (e) {
    warn(`init exited with error: ${e.message}`);
    warn('Attempting to continue with build anyway…');
  }

  // ── BUILD ─────────────────────────────────────────────────────────
  step('bubblewrap build…');
  try {
    await spawnWithAutoAnswer(BW, ['build'], TWA, {});
    ok('bubblewrap build complete!');
  } catch (e) {
    warn(`build step error: ${e.message}`);
  }

  server.close();

  // ── Locate APK ────────────────────────────────────────────────────
  step('Locating APK output…');
  const found = findApk();

  if (found) {
    const dest = path.join(ROOT, 'AuraAI.apk');
    fs.copyFileSync(found, dest);
    const mb = (fs.statSync(dest).size / 1024 / 1024).toFixed(2);

    bar('✅  BUILD SUCCESSFUL  —  AuraAI.apk READY!');
    ok(`Saved to  → ${G(dest)}`);
    ok(`File size → ${G(mb + ' MB')}`);
    console.log(`\n ${W('Install on Android:')}`);
    console.log('  1. Copy AuraAI.apk to your Android device (USB / WhatsApp / email)');
    console.log('  2. Settings → Security → "Install unknown apps" → Enable');
    console.log('  3. Tap the APK file → Install → Open');
    console.log(`  4. ${G('Enjoy Aura AI on your phone!')} 🚀\n`);
  } else {
    bar('⚠  BUILD COMPLETE — MANUAL STEP NEEDED');
    warn('APK not found in output. Android project was generated at:');
    info(TWA);
    console.log('\n  To build manually, open a terminal and run:');
    console.log(`  ${C(`cd "${TWA}"`)}`);
    console.log(`  ${C('.\\gradlew.bat assembleRelease')}\n`);
    console.log('  Or use the instant online method:');
    console.log(`  1. ${Y('npx serve . -p 3000')}  (in the aura-ai folder)`);
    console.log(`  2. ${Y('npx ngrok http 3000')}   (copy the https URL)`);
    console.log(`  3. ${Y('https://www.pwabuilder.com')} → paste URL → Android → Download APK\n`);
  }
}

main().catch(e => {
  console.error(R('\nFatal error: ') + e.message);
  process.exit(1);
});
