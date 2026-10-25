#!/usr/bin/env node
/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║  Aura AI — APK Builder Script                               ║
 * ║  Generates Android APK from PWA using Bubblewrap CLI        ║
 * ║  Run: node build-apk.js                                     ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { execSync, exec } = require('child_process');
const fs   = require('fs');
const path = require('path');
const http = require('http');

const CONFIG = {
  appName:       'Aura AI',
  packageName:   'com.auraai.chatassistant',
  versionName:   '1.0.0',
  versionCode:   1,
  displayMode:   'standalone',
  themeColor:    '#0D0F14',
  backgroundColor:'#0D0F14',
  startUrl:      '/',
  iconPath:      path.join(__dirname, 'icon-512.png'),
  port:          8080,
  signingKey:    'aura-ai-release.keystore',
  keyAlias:      'aura-ai',
  keyPassword:   'auraai2024',
};

const log = (msg, type = 'info') => {
  const icons = { info:'ℹ️ ', ok:'✅ ', warn:'⚠️ ', err:'❌ ', step:'🔷 ' };
  console.log(`${icons[type] || '  '}${msg}`);
};

const run = (cmd, opts = {}) => {
  log(`Running: ${cmd}`, 'step');
  try {
    return execSync(cmd, { stdio: 'inherit', ...opts });
  } catch (e) {
    throw new Error(`Command failed: ${cmd}\n${e.message}`);
  }
};

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  🤖 AURA AI — APK Builder');
  console.log('═'.repeat(60) + '\n');

  // Step 1: Check Node.js version
  log('Checking Node.js version…', 'step');
  const nodeVer = process.version;
  log(`Node.js ${nodeVer} detected`, 'ok');
  if (parseInt(nodeVer.slice(1)) < 16) {
    log('Node.js 16+ required. Download from nodejs.org', 'err');
    process.exit(1);
  }

  // Step 2: Check/install @bubblewrap/cli
  log('Checking Bubblewrap CLI…', 'step');
  try {
    execSync('bubblewrap --version', { stdio: 'pipe' });
    log('Bubblewrap already installed', 'ok');
  } catch {
    log('Installing @bubblewrap/cli globally (this may take 2–3 minutes)…', 'warn');
    run('npm install -g @bubblewrap/cli');
    log('Bubblewrap installed!', 'ok');
  }

  // Step 3: Start local HTTP server to serve the PWA
  log('Starting local PWA server on port ' + CONFIG.port + '…', 'step');
  const server = http.createServer((req, res) => {
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    const ext  = path.extname(filePath).toLowerCase();
    const mime = { '.html':'text/html', '.css':'text/css', '.js':'application/javascript',
                   '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };
    try {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain', 'Cache-Control':'no-cache' });
      res.end(data);
    } catch {
      res.writeHead(404); res.end('Not found');
    }
  });
  server.listen(CONFIG.port);
  log(`Server running at http://localhost:${CONFIG.port}`, 'ok');

  const pwaUrl = `http://localhost:${CONFIG.port}`;

  // Step 4: Init Bubblewrap project
  const twaDir = path.join(__dirname, 'android-twa');
  if (!fs.existsSync(twaDir)) fs.mkdirSync(twaDir, { recursive: true });

  log('Initializing Android TWA project…', 'step');
  const twaJson = {
    packageId:        CONFIG.packageName,
    host:             `localhost:${CONFIG.port}`,
    name:             CONFIG.appName,
    launcherName:     CONFIG.appName,
    display:          CONFIG.displayMode,
    themeColor:       { r:13, g:15, b:20, a:255 },
    backgroundColor:  { r:13, g:15, b:20, a:255 },
    startUrl:         CONFIG.startUrl,
    iconUrl:          `${pwaUrl}/icon-512.png`,
    maskableIconUrl:  `${pwaUrl}/icon-512.png`,
    appVersion:       CONFIG.versionName,
    appVersionCode:   CONFIG.versionCode,
    signingKey: {
      path:     CONFIG.signingKey,
      alias:    CONFIG.keyAlias,
    },
    splashScreenFadeOutDuration: 300,
    enableNotifications: true,
    shortcuts:        [],
    generatorApp:     'bubblewrap-cli',
    webManifestUrl:   `${pwaUrl}/manifest.json`,
    fallbackType:     'customtabs',
    features:         { locationDelegation: { enabled: true }, playBilling: { enabled: false } },
    alphaDependencies: { enabled: false },
    enableSiteSettingsShortcut: true,
    isChromeOSOnly: false,
    isMetaQuest: false,
    fullScopeUrl: pwaUrl,
    minSdkVersion: 21,
    orientation: 'default',
  };

  fs.writeFileSync(path.join(twaDir, 'twa-manifest.json'), JSON.stringify(twaJson, null, 2));
  log('TWA manifest created', 'ok');

  // Step 5: Run bubblewrap init + build
  log('Building Android project with Bubblewrap…', 'step');
  log('This step requires Android SDK. If not installed, see instructions below.', 'warn');

  try {
    process.chdir(twaDir);
    run(`bubblewrap init --manifest ${pwaUrl}/manifest.json`);
    run('bubblewrap build');

    // Find the output APK
    const apkPath = path.join(twaDir, 'app-release-signed.apk');
    const destApk = path.join(__dirname, 'AuraAI.apk');
    if (fs.existsSync(apkPath)) {
      fs.copyFileSync(apkPath, destApk);
      log(`APK built successfully! → ${destApk}`, 'ok');
    }
  } catch (e) {
    log('Bubblewrap build failed. Falling back to PWABuilder instructions…', 'warn');
    showFallbackInstructions();
  } finally {
    server.close();
  }
}

function showFallbackInstructions() {
  console.log('\n' + '═'.repeat(60));
  console.log('  📲 ALTERNATIVE: Use PWABuilder (No Android Studio needed!)');
  console.log('═'.repeat(60));
  console.log(`
  The easiest way to get your APK without Android Studio:

  METHOD 1 — PWABuilder Online (Recommended):
  ────────────────────────────────────────────
  1. Serve this app via HTTPS (use: npx serve . -p 3000)
  2. Use ngrok to get HTTPS: npx ngrok http 3000
  3. Copy the HTTPS URL (e.g. https://abc123.ngrok.io)
  4. Go to: https://www.pwabuilder.com
  5. Paste your HTTPS URL → Analyze → Package for Stores
  6. Click "Android" → Download APK package
  7. Install APK on your Android device!

  METHOD 2 — GitHub Pages (Free HTTPS hosting):
  ────────────────────────────────────────────
  1. Push this folder to a GitHub repository
  2. Enable GitHub Pages (Settings → Pages → Deploy from main)
  3. Your app URL: https://[username].github.io/aura-ai/
  4. Go to pwabuilder.com → Enter your GitHub Pages URL
  5. Download APK

  METHOD 3 — Local Android Debug APK:
  ────────────────────────────────────
  If you have Android Studio installed:
    npx @bubblewrap/cli init --manifest https://your-url.com/manifest.json
    npx @bubblewrap/cli build
    → Outputs: app-release-signed.apk

  METHOD 4 — Install directly from browser (No APK needed!):
  ────────────────────────────────────────────────────────────
  On Android Chrome:
    1. Open the app URL in Chrome
    2. Tap the 3-dot menu → "Add to Home screen"
    3. Tap "Install"
    → App icon appears on home screen, works like a native app!

  On iPhone/iPad Safari:
    1. Open the app URL in Safari
    2. Tap the Share icon (box with arrow)
    3. Tap "Add to Home Screen" → "Add"
    → Full-screen app experience!
`);
}

main().catch(err => {
  log(err.message, 'err');
  showFallbackInstructions();
  process.exit(1);
});
