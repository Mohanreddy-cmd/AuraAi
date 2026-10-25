/**
 * Aura AI - Final APK Builder
 * Uses pre-downloaded JDK17 + Android SDK to build APK
 */
const { spawn } = require('child_process');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT    = __dirname;
const TOOLS   = path.join(ROOT, '.build-tools');
const JDK     = path.join(TOOLS, 'jdk17');
const SDK     = path.join(TOOLS, 'android-sdk');
const TWA     = path.join(ROOT, 'twa-build');
const PORT    = 5757;
const BASE    = `http://localhost:${PORT}`;

const G = s => `\x1b[32m${s}\x1b[0m`;
const B = s => `\x1b[34;1m${s}\x1b[0m`;
const Y = s => `\x1b[33m${s}\x1b[0m`;
const C = s => `\x1b[36m${s}\x1b[0m`;
const W = s => `\x1b[1m${s}\x1b[0m`;
const ok   = m => console.log(` ${G('✔')} ${m}`);
const info = m => console.log(` ${C('ℹ')} ${m}`);
const warn = m => console.log(` ${Y('⚠')} ${m}`);
const step = m => console.log(`\n ${B('▶')} ${W(m)}`);
const bar  = m => { const l='═'.repeat(58); console.log(`\n\x1b[35;1m${l}\n  ${m}\n${l}\x1b[0m\n`); };

// Build env with our JDK + SDK
const buildEnv = {
  ...process.env,
  JAVA_HOME:            JDK,
  ANDROID_HOME:         SDK,
  ANDROID_SDK_ROOT:     SDK,
  BUBBLEWRAP_JDK_PATH:  JDK,
  BUBBLEWRAP_SDK_PATH:  SDK,
  PATH: `${path.join(JDK,'bin')};${path.join(SDK,'cmdline-tools','latest','bin')};${path.join(SDK,'platform-tools')};${process.env.PATH}`,
};

// Start local HTTP server
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
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise(r => srv.listen(PORT, () => r(srv)));
}

// Spawn process with smart auto-answer
function spawnAnswered(cmd, args, cwd, answerRules) {
  return new Promise((resolve) => {
    info(`Running: ${cmd} ${args.join(' ')}`);
    const proc = spawn(cmd, args, { shell:true, cwd, env:buildEnv, stdio:['pipe','pipe','pipe'] });
    
    let buf = '';
    let lastAns = 0;

    const tryAnswer = () => {
      const now = Date.now();
      if (now - lastAns < 400) return;
      for (const {match, ans, note} of answerRules) {
        if (match.test(buf)) {
          lastAns = now;
          info(`  → Answering [${note}]: ${JSON.stringify(ans.trim()||'<Enter>')}`);
          proc.stdin.write(ans);
          buf = '';
          return;
        }
      }
    };

    proc.stdout.on('data', chunk => { process.stdout.write(chunk); buf += chunk.toString(); setTimeout(tryAnswer, 600); });
    proc.stderr.on('data', chunk => { process.stderr.write(chunk); buf += chunk.toString(); setTimeout(tryAnswer, 600); });
    
    // Heartbeat: send Enter every 10s if no answer was sent recently
    const hb = setInterval(() => {
      if (Date.now() - lastAns > 10000) {
        proc.stdin.write('\n');
        lastAns = Date.now();
      }
    }, 10000);

    proc.on('close', code => { clearInterval(hb); resolve(code); });
    proc.on('error', () => { clearInterval(hb); resolve(1); });

    // Initial Enter after 3s
    setTimeout(() => proc.stdin.write('\n'), 3000);
  });
}

// Answer rules for bubblewrap init
const INIT_RULES = [
  { match: /install.*jdk/i,              ans: 'N\n', note: 'Use our own JDK' },
  { match: /path.*jdk|jdk.*path/i,       ans: `${JDK}\n`, note: 'JDK path' },
  { match: /install.*android.*sdk/i,     ans: 'N\n', note: 'Use our own SDK' },
  { match: /path.*sdk|sdk.*path|android.*sdk.*location/i, ans: `${SDK}\n`, note: 'SDK path' },
  { match: /\(Y\/n\)/i,                  ans: 'Y\n', note: 'Yes to default' },
  { match: /\(y\/N\)/i,                  ans: 'N\n', note: 'No to optional' },
  { match: /domain|host.*name/i,         ans: '\n',  note: 'Domain default' },
  { match: /application.*name|app.*name/i, ans: '\n', note: 'App name default' },
  { match: /short.*name/i,               ans: '\n',  note: 'Short name default' },
  { match: /package.*name|application.*id/i, ans: '\n', note: 'Package default' },
  { match: /display.*mode/i,             ans: '\n',  note: 'Display default' },
  { match: /theme.*color|status.*bar/i,  ans: '\n',  note: 'Color default' },
  { match: /background.*color/i,         ans: '\n',  note: 'BG color default' },
  { match: /icon.*url/i,                 ans: '\n',  note: 'Icon default' },
  { match: /maskable/i,                  ans: '\n',  note: 'Maskable default' },
  { match: /signing|keystore/i,          ans: '\n',  note: 'Signing default' },
  { match: /alias/i,                     ans: '\n',  note: 'Alias default' },
  { match: /version.*code/i,             ans: '\n',  note: 'Version code' },
  { match: /version.*name/i,             ans: '\n',  note: 'Version name' },
  { match: /orientation/i,               ans: '\n',  note: 'Orientation default' },
  { match: /notification/i,              ans: '\n',  note: 'Notification default' },
  { match: /play.*billing|google.*play/i,ans: 'N\n', note: 'No play billing' },
  { match: /location/i,                  ans: 'N\n', note: 'No location' },
  { match: /site.*settings/i,            ans: '\n',  note: 'Site settings default' },
  { match: /\?\s*$/m,                    ans: '\n',  note: 'Generic prompt' },
];

// Find output APK
function findApk() {
  const candidates = [
    path.join(TWA, 'app-release-signed.apk'),
    path.join(TWA, 'app-release.apk'),
    path.join(TWA, 'app', 'build', 'outputs', 'apk', 'release', 'app-release-signed.apk'),
    path.join(TWA, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
    path.join(TWA, 'app', 'build', 'outputs', 'apk', 'release', 'app-release-unsigned.apk'),
    path.join(TWA, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
  ];
  return candidates.find(p => { try { return fs.existsSync(p) && fs.statSync(p).size > 10000; } catch { return false; }});
}

async function main() {
  console.clear();
  bar('AURA AI  -  FINAL APK BUILD');
  info(`JDK:  ${JDK}`);
  info(`SDK:  ${SDK}`);
  
  // Verify JDK and SDK exist
  if (!fs.existsSync(path.join(JDK, 'bin', 'java.exe'))) {
    console.error('ERROR: JDK not found at ' + JDK); process.exit(1);
  }
  if (!fs.existsSync(path.join(SDK, 'cmdline-tools', 'latest', 'bin', 'sdkmanager.bat'))) {
    console.error('ERROR: SDK not found at ' + SDK); process.exit(1);
  }
  ok('JDK 17 verified');
  ok('Android SDK verified');

  fs.mkdirSync(TWA, { recursive: true });

  // Start server
  step('Starting PWA server...');
  const server = await startServer();
  ok(`Server running at ${C(BASE)}`);

  // Verify manifest is served
  try {
    await new Promise((resolve, reject) => {
      http.get(`${BASE}/manifest.json`, res => {
        if (res.statusCode === 200) { ok('manifest.json served OK'); resolve(); }
        else reject(new Error('manifest not found'));
      }).on('error', reject);
    });
  } catch(e) {
    warn('manifest check failed: ' + e.message);
  }

  // bubblewrap init
  step('Running bubblewrap init...');
  info('Using pre-installed JDK 17 and Android SDK (no downloads needed)');
  const initCode = await spawnAnswered(
    'bubblewrap',
    ['init', '--manifest', `${BASE}/manifest.json`],
    TWA,
    INIT_RULES
  );
  
  if (initCode === 0) {
    ok('bubblewrap init completed!');
  } else {
    warn(`bubblewrap init exited ${initCode} - attempting build anyway`);
  }

  // bubblewrap build
  step('Running bubblewrap build...');
  const buildCode = await spawnAnswered(
    'bubblewrap',
    ['build'],
    TWA,
    [{ match: /\(Y\/n\)/i, ans:'Y\n', note:'confirm' }, { match:/\?\s*$/m, ans:'\n', note:'prompt' }]
  );

  server.close();

  // Find and copy APK
  step('Locating APK...');
  const found = findApk();

  if (found) {
    const dest = path.join(ROOT, 'AuraAI.apk');
    fs.copyFileSync(found, dest);
    const mb = (fs.statSync(dest).size / 1024 / 1024).toFixed(2);
    bar('SUCCESS  -  AuraAI.apk IS READY!');
    ok(`APK saved  -> ${G(dest)}`);
    ok(`APK size   -> ${G(mb + ' MB')}`);
    console.log(`\n ${W('Install on Android:')}`);
    console.log('  1. Transfer AuraAI.apk to your Android device');
    console.log('  2. Settings -> Security -> Install unknown apps -> Enable');
    console.log('  3. Tap AuraAI.apk -> Install -> Open');
    console.log(`  4. ${G('Aura AI is now on your phone!')} 🎉\n`);
  } else {
    bar('PARTIALLY DONE - ONE MANUAL STEP LEFT');
    warn('APK not in expected output path. Project is at: ' + TWA);
    info('Run these to finish:');
    console.log(`\n  $env:JAVA_HOME = "${JDK}"`);
    console.log(`  $env:ANDROID_HOME = "${SDK}"`);
    console.log(`  cd "${TWA}"`);
    console.log(`  .\\gradlew.bat assembleRelease\n`);
    // Check what's in the twa dir
    if (fs.existsSync(TWA)) {
      info('Files in twa-build: ' + fs.readdirSync(TWA).join(', '));
    }
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
