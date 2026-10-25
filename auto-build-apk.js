/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Aura AI — Full Auto APK Builder                          ║
 * ║   Downloads JDK + Android SDK + builds signed APK          ║
 * ║   Run: node auto-build-apk.js                              ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const { execSync, spawnSync } = require('child_process');
const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

// ── Config ────────────────────────────────────────────────────────
const ROOT   = __dirname;
const TOOLS  = path.join(ROOT, '.build-tools');
const JDK_DIR= path.join(TOOLS, 'jdk');
const SDK_DIR= path.join(TOOLS, 'android-sdk');
const TWA_DIR= path.join(ROOT,  'android-twa');
const OUT_DIR= ROOT; // APK output next to this script

const APP = {
  name:        'Aura AI',
  packageName: 'com.auraai.chatassistant',
  version:     '1.0.0',
  versionCode:  1,
  host:        'localhost',
  port:        45678,
  themeColor:  '#0D0F14',
  bgColor:     '#0D0F14',
};

// JDK 17 (Windows x64)  — OpenJDK from Adoptium
const JDK_URL = 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.10%2B7/OpenJDK17U-jdk_x64_windows_hotspot_17.0.10_7.zip';
const JDK_ZIP = path.join(TOOLS, 'jdk17.zip');

// Android command-line tools (latest)
const SDK_URL = 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip';
const SDK_ZIP = path.join(TOOLS, 'cmdline-tools.zip');

// ── Colours ───────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', cyan: '\x1b[36m',
  yellow: '\x1b[33m', red: '\x1b[31m', blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

function log(msg, type = 'info') {
  const pre = {
    info:    `${C.cyan}ℹ${C.reset} `,
    ok:      `${C.green}✔${C.reset} `,
    warn:    `${C.yellow}⚠${C.reset} `,
    err:     `${C.red}✘${C.reset} `,
    step:    `${C.blue}${C.bold}▶${C.reset} `,
    header:  `${C.magenta}${C.bold}`,
  };
  if (type === 'header') {
    console.log(`\n${pre.header}${'─'.repeat(56)}${C.reset}`);
    console.log(`${pre.header}  ${msg}${C.reset}`);
    console.log(`${pre.header}${'─'.repeat(56)}${C.reset}`);
  } else {
    console.log(`${pre[type] || '  '}${msg}`);
  }
}

function run(cmd, opts = {}) {
  const result = spawnSync(cmd, { shell: true, stdio: opts.silent ? 'pipe' : 'inherit', ...opts });
  if (result.status !== 0 && !opts.ignoreErrors) {
    throw new Error(`Command failed: ${cmd}`);
  }
  return result.stdout?.toString().trim() || '';
}

function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }

// ── Download with progress ─────────────────────────────────────────
function download(url, dest, label) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) {
      log(`Already downloaded: ${label}`, 'ok');
      return resolve();
    }
    mkdirp(path.dirname(dest));
    log(`Downloading ${label}…`, 'step');
    const file = fs.createWriteStream(dest);
    let downloaded = 0, total = 0;

    function get(url) {
      const mod = url.startsWith('https') ? https : http;
      mod.get(url, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          return get(res.headers.location);
        }
        total = parseInt(res.headers['content-length'] || '0', 10);
        res.on('data', chunk => {
          downloaded += chunk.length;
          if (total > 0) {
            const pct = Math.round(downloaded / total * 100);
            process.stdout.write(`\r    ${pct}% (${(downloaded/1024/1024).toFixed(1)} MB / ${(total/1024/1024).toFixed(1)} MB)   `);
          }
          file.write(chunk);
        });
        res.on('end', () => { file.end(); process.stdout.write('\n'); resolve(); });
        res.on('error', reject);
      }).on('error', reject);
    }
    get(url);
    file.on('error', reject);
  });
}

// ── Unzip ─────────────────────────────────────────────────────────
function unzip(zipPath, destDir) {
  log(`Extracting ${path.basename(zipPath)}…`, 'step');
  mkdirp(destDir);
  run(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`);
  log('Extraction complete', 'ok');
}

// ── Start local HTTP server ────────────────────────────────────────
function startServer(port) {
  const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    let fp = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
    const ext  = path.extname(fp).toLowerCase();
    const mime = { '.html':'text/html;charset=utf-8', '.css':'text/css', '.js':'application/javascript',
                   '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml',
                   '.ico':'image/x-icon', '.webmanifest':'application/manifest+json' };
    try {
      const data = fs.readFileSync(fp);
      res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain', 'Access-Control-Allow-Origin':'*' });
      res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  server.listen(port);
  return server;
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  console.clear();
  log('AURA AI — AUTOMATED APK BUILDER', 'header');
  console.log(`  ${C.cyan}This script will:${C.reset}`);
  console.log(`  1. Download JDK 17 (if needed)`);
  console.log(`  2. Download Android SDK tools (if needed)`);
  console.log(`  3. Build a signed APK using Bubblewrap`);
  console.log(`  4. Save ${C.green}AuraAI.apk${C.reset} in this folder\n`);

  mkdirp(TOOLS);
  mkdirp(TWA_DIR);

  // ── Step 1: JDK ──────────────────────────────────────────────────
  log('STEP 1 — Java Development Kit (JDK 17)', 'header');
  let JAVA_HOME = process.env.JAVA_HOME || '';
  let javaExe   = '';

  // Check if java is already available
  const javaCheck = spawnSync('java', ['-version'], { shell:true, stdio:'pipe' });
  if (javaCheck.status === 0 || javaCheck.stderr?.toString().includes('version')) {
    log('Java already installed on system', 'ok');
    javaExe = 'java';
  } else {
    // Check if we already downloaded it
    const jdkBin = path.join(JDK_DIR, 'bin');
    const localJava = path.join(jdkBin, 'java.exe');
    if (fs.existsSync(localJava)) {
      log('Using previously downloaded JDK', 'ok');
      javaExe  = localJava;
      JAVA_HOME = JDK_DIR;
    } else {
      // Download JDK
      await download(JDK_URL, JDK_ZIP, 'OpenJDK 17 (~180 MB)');
      unzip(JDK_ZIP, TOOLS);
      // Find extracted JDK folder
      const entries = fs.readdirSync(TOOLS).filter(e => e.startsWith('jdk'));
      if (entries.length > 0) {
        const extracted = path.join(TOOLS, entries[0]);
        if (fs.existsSync(extracted) && extracted !== JDK_DIR) {
          fs.renameSync(extracted, JDK_DIR);
        }
      }
      if (fs.existsSync(path.join(JDK_DIR, 'bin', 'java.exe'))) {
        javaExe  = path.join(JDK_DIR, 'bin', 'java.exe');
        JAVA_HOME = JDK_DIR;
        log('JDK 17 installed successfully', 'ok');
      } else {
        throw new Error('JDK extraction failed — bin/java.exe not found');
      }
    }
  }
  process.env.JAVA_HOME = JAVA_HOME || path.dirname(path.dirname(javaExe.replace(/\\/g, '/')));

  // ── Step 2: Android SDK command-line tools ────────────────────────
  log('STEP 2 — Android SDK Command-Line Tools', 'header');
  const sdkCmdDir = path.join(SDK_DIR, 'cmdline-tools', 'latest');
  const sdkmanExe = path.join(sdkCmdDir, 'bin', 'sdkmanager.bat');

  if (fs.existsSync(sdkmanExe)) {
    log('Android SDK tools already present', 'ok');
  } else {
    await download(SDK_URL, SDK_ZIP, 'Android Command-Line Tools (~130 MB)');
    mkdirp(path.join(SDK_DIR, 'cmdline-tools'));
    unzip(SDK_ZIP, path.join(SDK_DIR, 'cmdline-tools'));
    // Rename extracted folder to 'latest'
    const raw = path.join(SDK_DIR, 'cmdline-tools', 'cmdline-tools');
    if (fs.existsSync(raw)) fs.renameSync(raw, sdkCmdDir);
    log('Android command-line tools installed', 'ok');
  }
  process.env.ANDROID_HOME = SDK_DIR;
  process.env.ANDROID_SDK_ROOT = SDK_DIR;

  // Accept licenses
  log('Accepting Android SDK licenses…', 'step');
  const licenseInput = 'y\ny\ny\ny\ny\ny\ny\n';
  spawnSync(sdkmanExe, ['--licenses'], {
    input: licenseInput, shell: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, JAVA_HOME: JAVA_HOME || '', ANDROID_HOME: SDK_DIR }
  });
  log('Licenses accepted', 'ok');

  // Install required SDK packages
  log('Installing Android SDK packages (build-tools, platforms)…', 'step');
  const packages = [
    'build-tools;34.0.0',
    'platforms;android-34',
    'platform-tools',
  ];
  for (const pkg of packages) {
    log(`  Installing ${pkg}…`, 'info');
    spawnSync(sdkmanExe, [`"${pkg}"`], {
      input: 'y\n', shell: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, JAVA_HOME: JAVA_HOME || '', ANDROID_HOME: SDK_DIR, ANDROID_SDK_ROOT: SDK_DIR }
    });
  }
  log('SDK packages installed', 'ok');

  // ── Step 3: Start local PWA server ───────────────────────────────
  log('STEP 3 — Starting Local PWA Server', 'header');
  const server = startServer(APP.port);
  const pwaUrl = `http://${APP.host}:${APP.port}`;
  log(`PWA server running at ${pwaUrl}`, 'ok');

  // ── Step 4: Bubblewrap init ───────────────────────────────────────
  log('STEP 4 — Initializing Android TWA Project', 'header');
  const twaManifest = {
    packageId:      APP.packageName,
    host:           `${APP.host}:${APP.port}`,
    name:           APP.name,
    launcherName:   APP.name,
    display:        'standalone',
    themeColor:     { r:13, g:15, b:20, a:255 },
    backgroundColor:{ r:13, g:15, b:20, a:255 },
    startUrl:       '/',
    iconUrl:        `${pwaUrl}/icon-512.png`,
    maskableIconUrl:`${pwaUrl}/icon-512.png`,
    appVersion:     APP.version,
    appVersionCode: APP.versionCode,
    signingKey: { path: 'aura-ai.keystore', alias: 'aura-ai' },
    splashScreenFadeOutDuration: 300,
    enableNotifications: true,
    shortcuts: [],
    generatorApp: 'bubblewrap-cli',
    webManifestUrl: `${pwaUrl}/manifest.json`,
    fallbackType: 'customtabs',
    features: { locationDelegation: { enabled: false }, playBilling: { enabled: false } },
    alphaDependencies: { enabled: false },
    enableSiteSettingsShortcut: true,
    isChromeOSOnly: false,
    isMetaQuest: false,
    minSdkVersion: 21,
    orientation: 'default',
    fullScopeUrl: pwaUrl,
  };
  fs.writeFileSync(path.join(TWA_DIR, 'twa-manifest.json'), JSON.stringify(twaManifest, null, 2));
  log('TWA manifest written', 'ok');

  // ── Step 5: Bubblewrap build ──────────────────────────────────────
  log('STEP 5 — Building Android APK (Bubblewrap)', 'header');

  const bubblewrapBin = path.join(
    run('npm root -g', { silent:true }),
    '@bubblewrap/cli/bin/bubblewrap'
  );

  const buildEnv = {
    ...process.env,
    JAVA_HOME:        JAVA_HOME || '',
    ANDROID_HOME:     SDK_DIR,
    ANDROID_SDK_ROOT: SDK_DIR,
    PATH:             `${path.join(JDK_DIR,'bin')};${path.join(SDK_DIR,'platform-tools')};${process.env.PATH}`,
  };

  log('Running: bubblewrap init…', 'step');
  const initResult = spawnSync(
    `node "${bubblewrapBin}" init --manifest ${pwaUrl}/manifest.json`,
    [], { shell:true, cwd:TWA_DIR, stdio:'inherit', env:buildEnv }
  );

  if (initResult.status !== 0) {
    log('Bubblewrap init failed — trying alternative build path…', 'warn');
    buildWithGradle(buildEnv, TWA_DIR);
  } else {
    log('Running: bubblewrap build…', 'step');
    spawnSync(`node "${bubblewrapBin}" build`, [],
      { shell:true, cwd:TWA_DIR, stdio:'inherit', env:buildEnv });
  }

  // ── Step 6: Locate & copy APK ─────────────────────────────────────
  log('STEP 6 — Locating Output APK', 'header');
  const apkCandidates = [
    path.join(TWA_DIR, 'app-release-signed.apk'),
    path.join(TWA_DIR, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
    path.join(TWA_DIR, 'app', 'build', 'outputs', 'apk', 'debug',   'app-debug.apk'),
  ];

  let foundApk = null;
  for (const p of apkCandidates) {
    if (fs.existsSync(p)) { foundApk = p; break; }
  }

  server.close();

  if (foundApk) {
    const dest = path.join(OUT_DIR, 'AuraAI.apk');
    fs.copyFileSync(foundApk, dest);
    const sizeMB = (fs.statSync(dest).size / 1024 / 1024).toFixed(1);

    log('BUILD SUCCESSFUL!', 'header');
    log(`APK saved: ${dest}`, 'ok');
    log(`APK size:  ${sizeMB} MB`, 'ok');
    console.log('\n' + '─'.repeat(56));
    console.log(`${C.green}${C.bold}  📲 Install on Android:${C.reset}`);
    console.log(`  1. Copy AuraAI.apk to your Android device`);
    console.log(`  2. Settings → Security → "Install unknown apps" → Enable`);
    console.log(`  3. Tap the APK file → Install`);
    console.log(`  4. Open "Aura AI" from your app drawer!`);
    console.log('─'.repeat(56) + '\n');
  } else {
    log('APK not found in expected output locations.', 'err');
    log('The Android project was initialized at: ' + TWA_DIR, 'info');
    log('To build manually:', 'info');
    console.log(`  cd "${TWA_DIR}"`);
    console.log(`  .\\gradlew assembleRelease`);
    log('Output will be in: app/build/outputs/apk/release/', 'info');
  }
}

function buildWithGradle(env, twaDir) {
  const gradlew = path.join(twaDir, 'gradlew.bat');
  if (!fs.existsSync(gradlew)) {
    log('gradlew not found — project may not have been initialized', 'err');
    return;
  }
  log('Building with Gradle directly…', 'step');
  spawnSync(`"${gradlew}" assembleRelease`, [],
    { shell:true, cwd:twaDir, stdio:'inherit', env });
}

main().catch(err => {
  console.error(`\n${C.red}${C.bold}Build Error:${C.reset}`, err.message);
  console.log(`\n${C.yellow}If the build failed, use PWABuilder instead:${C.reset}`);
  console.log('  1. Run: npx serve . -p 3000');
  console.log('  2. Run: npx ngrok http 3000');
  console.log('  3. Go to: https://www.pwabuilder.com');
  console.log('  4. Paste the ngrok HTTPS URL → Package for Android → Download APK\n');
  process.exit(1);
});
