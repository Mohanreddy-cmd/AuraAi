/**
 * Aura AI — APK Pipeline Runner
 * Starts local server + runs bubblewrap init + build = AuraAI.apk
 */
const { spawnSync, spawn } = require('child_process');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT   = __dirname;
const TWA    = path.join(ROOT, 'twa-build');
const PORT   = 5757;
const BASE   = `http://localhost:${PORT}`;

// ── Colours ──────────────────────────────────────────────────────
const G = s => `\x1b[32m${s}\x1b[0m`;
const B = s => `\x1b[34m\x1b[1m${s}\x1b[0m`;
const Y = s => `\x1b[33m${s}\x1b[0m`;
const R = s => `\x1b[31m${s}\x1b[0m`;
const C = s => `\x1b[36m${s}\x1b[0m`;
const W = s => `\x1b[1m${s}\x1b[0m`;

function banner(msg) {
  const line = '═'.repeat(58);
  console.log(`\n\x1b[35m\x1b[1m${line}\x1b[0m`);
  console.log(`\x1b[35m\x1b[1m  ${msg}\x1b[0m`);
  console.log(`\x1b[35m\x1b[1m${line}\x1b[0m\n`);
}
function ok(m)   { console.log(` ${G('✔')} ${m}`); }
function info(m) { console.log(` ${C('ℹ')} ${m}`); }
function warn(m) { console.log(` ${Y('⚠')} ${m}`); }
function step(m) { console.log(`\n ${B('▶')} ${W(m)}`); }
function err(m)  { console.log(` ${R('✘')} ${m}`); }

// ── Static file server ────────────────────────────────────────────
function startServer() {
  const types = {
    '.html':'.html','.css':'text/css','.js':'application/javascript',
    '.json':'application/json','.png':'image/png','.ico':'image/x-icon',
    '.webmanifest':'application/manifest+json','.svg':'image/svg+xml',
  };
  const server = http.createServer((req, res) => {
    let p = path.join(ROOT, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
    const ext = path.extname(p);
    try {
      const data = fs.readFileSync(p);
      res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain', 'Access-Control-Allow-Origin':'*' });
      res.end(data);
    } catch { res.writeHead(404); res.end('404'); }
  });
  return new Promise(resolve => server.listen(PORT, () => resolve(server)));
}

// ── Run command helper (captures output) ──────────────────────────
function run(cmd, cwd, envExtra = {}, input = '') {
  const env = { ...process.env, ...envExtra };
  const r = spawnSync(cmd, [], {
    shell:  true,
    cwd:    cwd || ROOT,
    stdio:  input ? ['pipe','pipe','pipe'] : 'inherit',
    input:  input || undefined,
    env,
    timeout: 600_000,
  });
  return { ok: r.status === 0, out: r.stdout?.toString() || '', err: r.stderr?.toString() || '' };
}

// ── twa-manifest.json ─────────────────────────────────────────────
function writeTwaManifest() {
  fs.mkdirSync(TWA, { recursive: true });
  const manifest = {
    packageId:        'com.auraai.chatassistant',
    host:             `localhost:${PORT}`,
    name:             'Aura AI',
    launcherName:     'Aura AI',
    display:          'standalone',
    themeColor:       { r: 13,  g: 15,  b: 20,  a: 255 },
    backgroundColor:  { r: 13,  g: 15,  b: 20,  a: 255 },
    startUrl:         '/',
    iconUrl:          `${BASE}/icon-512.png`,
    maskableIconUrl:  `${BASE}/icon-512.png`,
    appVersion:       '1.0.0',
    appVersionCode:   1,
    signingKey: {
      path:  path.join(TWA, 'aura-ai.keystore').replace(/\\/g, '/'),
      alias: 'aura-ai',
    },
    splashScreenFadeOutDuration: 300,
    enableNotifications: true,
    shortcuts: [],
    generatorApp: 'bubblewrap-cli',
    webManifestUrl:   `${BASE}/manifest.json`,
    fallbackType: 'customtabs',
    features: {
      locationDelegation: { enabled: false },
      playBilling:        { enabled: false },
    },
    alphaDependencies: { enabled: false },
    enableSiteSettingsShortcut: true,
    isChromeOSOnly: false,
    isMetaQuest:    false,
    minSdkVersion:  21,
    orientation:   'default',
    fullScopeUrl:   BASE,
  };
  fs.writeFileSync(path.join(TWA, 'twa-manifest.json'), JSON.stringify(manifest, null, 2));
  ok('twa-manifest.json written');
}

// ── Generate a placeholder 512x512 PNG icon (data URI → file) ────
function ensureIcon() {
  const iconPath = path.join(ROOT, 'icon-512.png');
  if (fs.existsSync(iconPath) && fs.statSync(iconPath).size > 100) {
    ok('icon-512.png already exists');
    return;
  }
  // Minimal valid 1×1 blue PNG (base64) scaled up by Android
  // We use a simple 512×512 solid-color PNG created with Canvas in Node or fallback bytes
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAYAAAD0eNT6AAAABmJLR0QA/wD/AP+gvaeTAAAAB3RJ' +
    'TUFHAAAAZAAAAGQAAAAAw2FsAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH5gcPEBkuOH4r' +
    'tAAAABl0RVh0Q29tbWVudABDcmVhdGVkIHdpdGggR0lNUFeBDhcAAAWWSURBVHja7cExAQAAAMKg' +
    '9U9tCy+gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8AUBAAAAASdLOQAAAABJRU5ErkJggg==';
  fs.writeFileSync(iconPath, Buffer.from(pngBase64, 'base64'));
  ok('icon-512.png created (placeholder)');
}

// ── Build a keystore for signing ─────────────────────────────────
function ensureKeystore(javaHome) {
  const ks = path.join(TWA, 'aura-ai.keystore');
  if (fs.existsSync(ks)) { ok('Keystore already exists'); return; }
  step('Generating signing keystore…');
  const keytool = path.join(javaHome, 'bin', 'keytool');
  const cmd = `"${keytool}" -genkeypair -v -keystore "${ks}" -alias aura-ai ` +
              `-keyalg RSA -keysize 2048 -validity 10000 ` +
              `-dname "CN=Aura AI, OU=App, O=AuraAI, L=City, S=State, C=US" ` +
              `-storepass auraai2024 -keypass auraai2024`;
  const r = run(cmd, TWA);
  if (r.ok) ok('Keystore generated: aura-ai.keystore');
  else { warn('Keystore generation skipped (keytool not found) — bubblewrap will generate its own'); }
}

// ── Find Java home ─────────────────────────────────────────────────
function findJava() {
  // Check bubblewrap's default JDK install location
  const bwJdk = path.join(process.env.LOCALAPPDATA || '', 'bubblewrap', 'jdk');
  const candidates = [
    process.env.JAVA_HOME,
    bwJdk,
    'C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.10.7-hotspot',
    'C:\\Program Files\\Java\\jdk-17',
    'C:\\Program Files\\Microsoft\\jdk-17.0.10.7-hotspot',
  ].filter(Boolean);

  for (const c of candidates) {
    const exe = path.join(c, 'bin', 'java.exe');
    if (fs.existsSync(exe)) return c;
  }
  // Try PATH
  const r = spawnSync('where java', [], { shell:true, stdio:'pipe' });
  if (r.status === 0) {
    const p = r.stdout.toString().split('\n')[0].trim();
    if (p) return path.dirname(path.dirname(p));
  }
  return null;
}

// ── Find Android SDK ──────────────────────────────────────────────
function findAndroidSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'),
    path.join(process.env.LOCALAPPDATA || '', 'bubblewrap', 'android-sdk'),
    path.join(process.env.APPDATA || '', 'Local', 'Android', 'Sdk'),
    'C:\\Android\\Sdk',
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  console.clear();
  banner('🤖  AURA AI — APK BUILDER');
  info(`Node.js ${process.version}  |  Platform: ${process.platform}`);

  // Start server
  step('Starting local PWA server…');
  const server = await startServer();
  ok(`Server running → ${C(BASE)}`);

  // Ensure icon exists
  step('Checking app icon…');
  ensureIcon();

  // Write twa-manifest
  step('Writing TWA project manifest…');
  writeTwaManifest();

  // Run bubblewrap init using the manifest URL
  step(`Running bubblewrap init (this downloads JDK + SDK if missing)…`);
  info('This may take 5–15 minutes on first run (downloading ~500 MB)');
  info('Please wait — do not close this window\n');

  const initResult = run(
    `bubblewrap init --manifest ${BASE}/manifest.json`,
    TWA,
    {},
    // Pre-answer interactive prompts: accept all defaults
    '\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n'
  );

  // Find Java after bubblewrap possibly installed it
  const javaHome = findJava();
  if (javaHome) {
    ok(`JDK found: ${javaHome}`);
    ensureKeystore(javaHome);
    process.env.JAVA_HOME = javaHome;
  } else {
    warn('JDK not found on PATH — bubblewrap will use its own');
  }

  const sdkHome = findAndroidSdk();
  if (sdkHome) {
    ok(`Android SDK: ${sdkHome}`);
    process.env.ANDROID_HOME     = sdkHome;
    process.env.ANDROID_SDK_ROOT = sdkHome;
  }

  // Build
  step('Running bubblewrap build…');
  info('Compiling Android APK — please wait…\n');
  run('bubblewrap build', TWA, {
    JAVA_HOME:        javaHome || '',
    ANDROID_HOME:     sdkHome  || '',
    ANDROID_SDK_ROOT: sdkHome  || '',
  });

  // Find APK
  step('Locating output APK…');
  const candidates = [
    path.join(TWA, 'app-release-signed.apk'),
    path.join(TWA, 'app', 'build', 'outputs', 'apk', 'release', 'app-release-unsigned.apk'),
    path.join(TWA, 'app', 'build', 'outputs', 'apk', 'debug',   'app-debug.apk'),
    path.join(TWA, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
  ];

  server.close();

  let found = candidates.find(p => fs.existsSync(p));
  if (found) {
    const dest = path.join(ROOT, 'AuraAI.apk');
    fs.copyFileSync(found, dest);
    const mb = (fs.statSync(dest).size / 1024 / 1024).toFixed(2);
    banner('✅  BUILD SUCCESSFUL');
    ok(`APK saved → ${G(dest)}`);
    ok(`APK size  → ${G(mb + ' MB')}`);
    console.log(`\n ${W('To install on Android:')}`);
    console.log('  1. Transfer AuraAI.apk to your Android phone');
    console.log('  2. Settings → Security → "Install Unknown Apps" → Enable for Files');
    console.log('  3. Tap AuraAI.apk → Install');
    console.log(`  4. Open ${G('Aura AI')} from your app drawer!\n`);
  } else {
    banner('⚠  BUILD PARTIALLY COMPLETE');
    warn('APK not found in expected locations.');
    info(`Android project created at: ${C(TWA)}`);
    info('To finish building manually, run:');
    console.log(`\n  cd "${TWA}"`);
    console.log('  .\\gradlew assembleRelease\n');
    info('Or use PWABuilder — the fastest alternative:');
    console.log('  1. Run in a terminal: npx serve . -p 3000');
    console.log('  2. Run: npx ngrok http 3000  (copy the https URL)');
    console.log('  3. Go to: https://www.pwabuilder.com');
    console.log('  4. Paste URL → Package for Stores → Android → Download APK\n');
  }
}

main().catch(e => {
  err('Fatal: ' + e.message);
  process.exit(1);
});
