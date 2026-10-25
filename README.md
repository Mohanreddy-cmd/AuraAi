# 🤖 Aura AI — Installation & APK Guide

> AI-powered chat assistant with GPT-4o, image generation, data analysis & voice input

---

## 📁 Project Files

| File | Description |
|------|-------------|
| `index.html` | Main app shell |
| `style.css` | Dark-mode UI styles |
| `app.js` | AI engine & chat logic |
| `manifest.json` | PWA manifest (enables install) |
| `sw.js` | Service Worker (offline support) |
| `offline.html` | Offline fallback page |
| `build-apk.js` | APK builder script |
| `generate-icons.html` | Icon generator tool |
| `package.json` | npm scripts |

---

## 🚀 Method 1 — Install Directly (No APK Needed)

### Android (Chrome)
1. Open `index.html` in **Chrome on Android**
2. Tap **⋮ menu → "Add to Home screen"**
3. Tap **"Install"**
4. ✅ App icon appears on home screen — works like native!

### iPhone / iPad (Safari)
1. Open in **Safari**
2. Tap the **Share icon** (□↑)
3. Tap **"Add to Home Screen"** → **Add**
4. ✅ Full-screen app experience!

---

## 📲 Method 2 — Generate Real APK (Easiest)

### Using PWABuilder Online (Free, No Android Studio needed)

**Step 1:** Serve the app with HTTPS
```powershell
# In the aura-ai folder:
npx serve . -p 3000

# In a second terminal, create HTTPS tunnel:
npx ngrok http 3000
# → Copy the https://xxxx.ngrok.io URL
```

**Step 2:** Go to [pwabuilder.com](https://www.pwabuilder.com)

**Step 3:** Paste your HTTPS URL → Click **"Start"**

**Step 4:** Click **"Package for Stores"** → **Android** → **Download**

**Step 5:** Unzip → find `app-release-signed.apk` → install on Android!

---

## ⚙️ Method 3 — Build APK with Bubblewrap CLI

**Requirements:** Node.js 16+, Android SDK (or Android Studio)

```powershell
# Install dependencies
cd C:\Users\haris\.gemini\antigravity\scratch\aura-ai
npm install

# Run the APK builder
node build-apk.js
# → Outputs: AuraAI.apk
```

---

## 🔧 Method 4 — GitHub Pages → PWABuilder APK

```powershell
# Push to GitHub
git init
git add .
git commit -m "Aura AI v1.0"
git remote add origin https://github.com/YOUR_USERNAME/aura-ai.git
git push -u origin main

# Enable GitHub Pages → Settings → Pages → Deploy from main
# Your URL: https://YOUR_USERNAME.github.io/aura-ai/

# Then use PWABuilder with that URL to download APK
```

---

## 🔑 Enable Real AI (Optional)

To use actual GPT-4o responses:
1. Get an API key from [platform.openai.com](https://platform.openai.com)
2. Open the app → Click **⚙️ Settings**
3. Paste your key in **"OpenAI API Key"** field
4. Click **"Save Settings"**
5. ✅ Real AI responses activated!

---

## 📊 Features

| Feature | Status |
|---------|--------|
| GPT-4o Chat | ✅ (with API key) / Demo mode |
| Image Generation | ✅ Demo mode |
| Data Analysis + Charts | ✅ Built-in |
| Code Generation | ✅ Built-in |
| Voice Input | ✅ Web Speech API |
| Offline Support | ✅ Service Worker |
| Conversation History | ✅ localStorage |
| PWA Install (Android/iOS) | ✅ |
| Model Selector | ✅ GPT-4o, Claude, Gemini |
| Push Notifications | ✅ Service Worker |

---

## 📦 APK Install on Android

Once you have `AuraAI.apk`:

1. Copy APK to your Android device
2. Open **Settings → Security → Unknown Sources** → Enable
3. Tap the APK file → **Install**
4. Open **Aura AI** from your app drawer!

> ⚠️ Enable "Install from unknown sources" in Android Settings first

---

*Built with ❤️ using PWA + Service Worker + Chart.js + OpenAI API*
