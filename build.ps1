# ╔══════════════════════════════════════════════════════════════╗
# ║  Aura AI — PowerShell APK Builder                          ║
# ║  Downloads JDK + Android SDK reliably, then builds APK     ║
# ║  Run: powershell -ExecutionPolicy Bypass -File build.ps1   ║
# ╚══════════════════════════════════════════════════════════════╝

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'   # faster Invoke-WebRequest

$ROOT    = $PSScriptRoot
$TOOLS   = "$ROOT\.build-tools"
$JDK_DIR = "$TOOLS\jdk17"
$SDK_DIR = "$TOOLS\android-sdk"
$TWA_DIR = "$ROOT\twa-build"
$OUT_APK = "$ROOT\AuraAI.apk"
$PORT    = 5757

# ── Colour helpers ────────────────────────────────────────────────
function OK   { param($m) Write-Host " [+] $m" -ForegroundColor Green  }
function INFO { param($m) Write-Host " [i] $m" -ForegroundColor Cyan   }
function WARN { param($m) Write-Host " [!] $m" -ForegroundColor Yellow }
function ERR  { param($m) Write-Host " [x] $m" -ForegroundColor Red    }
function STEP { param($m) Write-Host "`n [>] $m" -ForegroundColor Blue  }
function BANNER {
    param($m)
    $line = "=" * 60
    Write-Host "`n$line" -ForegroundColor Magenta
    Write-Host "  $m"    -ForegroundColor Magenta
    Write-Host "$line`n" -ForegroundColor Magenta
}

# ── Download with retry ───────────────────────────────────────────
function Download-File {
    param($Url, $Dest, $Label, $Retries = 3)
    if ((Test-Path $Dest) -and (Get-Item $Dest).Length -gt 1MB) {
        OK "Already downloaded: $Label"
        return
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $Dest) | Out-Null
    for ($i = 1; $i -le $Retries; $i++) {
        try {
            STEP "Downloading $Label (attempt $i/$Retries)..."
            INFO "URL: $Url"
            Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing -TimeoutSec 300
            $size = [math]::Round((Get-Item $Dest).Length / 1MB, 1)
            OK "Downloaded $Label ($size MB)"
            return
        } catch {
            WARN "Attempt $i failed: $($_.Exception.Message)"
            if ($i -lt $Retries) {
                INFO "Retrying in 5 seconds..."
                Start-Sleep 5
            }
        }
    }
    throw "Failed to download $Label after $Retries attempts"
}

# ── Start local HTTP server (background job) ──────────────────────
function Start-PWAServer {
    param($Root, $Port)
    $job = Start-Job -ScriptBlock {
        param($root, $port)
        $listener = [System.Net.HttpListener]::new()
        $listener.Prefixes.Add("http://localhost:$port/")
        $listener.Start()
        $mimeTypes = @{
            '.html' = 'text/html'; '.css' = 'text/css'; '.js' = 'application/javascript'
            '.json' = 'application/json'; '.png' = 'image/png'; '.svg' = 'image/svg+xml'
            '.ico'  = 'image/x-icon'; '.webmanifest' = 'application/manifest+json'
        }
        while ($listener.IsListening) {
            try {
                $ctx  = $listener.GetContext()
                $req  = $ctx.Request
                $resp = $ctx.Response
                $urlPath = $req.Url.LocalPath
                if ($urlPath -eq '/') { $urlPath = '/index.html' }
                $filePath = Join-Path $root $urlPath.TrimStart('/')
                if (Test-Path $filePath) {
                    $ext  = [System.IO.Path]::GetExtension($filePath)
                    $mime = if ($mimeTypes[$ext]) { $mimeTypes[$ext] } else { 'text/plain' }
                    $data = [System.IO.File]::ReadAllBytes($filePath)
                    $resp.ContentType   = $mime
                    $resp.ContentLength64 = $data.Length
                    $resp.Headers.Add('Access-Control-Allow-Origin', '*')
                    $resp.OutputStream.Write($data, 0, $data.Length)
                } else {
                    $resp.StatusCode = 404
                }
                $resp.OutputStream.Close()
            } catch {}
        }
    } -ArgumentList $Root, $Port
    Start-Sleep 1
    return $job
}

# ════════════════════════════════════════════════════════════════
BANNER "🤖  AURA AI — APK BUILDER (PowerShell)"
INFO "Node.js: $(node --version 2>$null)"
INFO "Platform: Windows"
INFO "Output: $OUT_APK"

# Create directories
New-Item -ItemType Directory -Force -Path $TOOLS, $TWA_DIR | Out-Null

# ── STEP 1: Download JDK 17 ───────────────────────────────────────
BANNER "STEP 1 — Java Development Kit 17"

$JDK_ZIP = "$TOOLS\jdk17.zip"
# Adoptium OpenJDK 17 Windows x64 (direct GitHub release)
$JDK_URL = "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.10%2B7/OpenJDK17U-jdk_x64_windows_hotspot_17.0.10_7.zip"

if (Test-Path "$JDK_DIR\bin\java.exe") {
    OK "JDK 17 already installed at $JDK_DIR"
} else {
    Download-File -Url $JDK_URL -Dest $JDK_ZIP -Label "OpenJDK 17 (~180 MB)"

    STEP "Extracting JDK..."
    Expand-Archive -Path $JDK_ZIP -DestinationPath $TOOLS -Force
    # Rename extracted folder to jdk17
    $extracted = Get-ChildItem $TOOLS -Directory | Where-Object { $_.Name -like "jdk*17*" -and $_.Name -ne "jdk17" } | Select-Object -First 1
    if ($extracted) {
        if (Test-Path $JDK_DIR) { Remove-Item $JDK_DIR -Recurse -Force }
        Rename-Item $extracted.FullName "jdk17"
    }
    OK "JDK 17 installed at $JDK_DIR"
}

$env:JAVA_HOME = $JDK_DIR
$env:PATH      = "$JDK_DIR\bin;$env:PATH"
$javaVer = & "$JDK_DIR\bin\java.exe" -version 2>&1
OK "Java: $($javaVer | Select-Object -First 1)"

# ── STEP 2: Download Android SDK command-line tools ───────────────
BANNER "STEP 2 — Android SDK"

$SDK_ZIP     = "$TOOLS\cmdline-tools.zip"
$SDKTOOLS    = "$SDK_DIR\cmdline-tools\latest"
$SDKMANAGER  = "$SDKTOOLS\bin\sdkmanager.bat"

$SDK_URL = "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"

if (Test-Path $SDKMANAGER) {
    OK "Android SDK tools already present"
} else {
    Download-File -Url $SDK_URL -Dest $SDK_ZIP -Label "Android Command-Line Tools (~135 MB)"

    STEP "Extracting Android SDK tools..."
    $extractTo = "$SDK_DIR\cmdline-tools"
    New-Item -ItemType Directory -Force -Path $extractTo | Out-Null
    Expand-Archive -Path $SDK_ZIP -DestinationPath $extractTo -Force

    # Bubblewrap expects cmdline-tools/latest
    $rawCmdTools = "$extractTo\cmdline-tools"
    if (Test-Path $rawCmdTools) {
        if (Test-Path "$extractTo\latest") { Remove-Item "$extractTo\latest" -Recurse -Force }
        Rename-Item $rawCmdTools "latest"
    }
    OK "Android SDK tools extracted"
}

$env:ANDROID_HOME     = $SDK_DIR
$env:ANDROID_SDK_ROOT = $SDK_DIR
$env:PATH             = "$SDKTOOLS\bin;$SDK_DIR\platform-tools;$env:PATH"

# Accept licenses and install required SDK packages
STEP "Accepting Android SDK licenses and installing packages..."
$licInput = "y`ny`ny`ny`ny`ny`ny`n"
foreach ($pkg in @('build-tools;34.0.0', 'platforms;android-34', 'platform-tools')) {
    INFO "  Installing: $pkg"
    $licInput | & "$SDKMANAGER" "--sdk_root=$SDK_DIR" $pkg 2>&1 | Out-Null
}
OK "Android SDK packages installed"

# ── STEP 3: Start PWA server ──────────────────────────────────────
BANNER "STEP 3 — Starting PWA Server"
$serverJob = Start-PWAServer -Root $ROOT -Port $PORT
INFO "PWA server running at http://localhost:$PORT"
# Quick check
try {
    $resp = Invoke-WebRequest "http://localhost:$PORT/manifest.json" -UseBasicParsing -TimeoutSec 5
    OK "Server responding — manifest.json loaded ($($resp.Content.Length) bytes)"
} catch {
    WARN "Server may still be starting..."
}

# ── STEP 4: Run bubblewrap init ───────────────────────────────────
BANNER "STEP 4 — Bubblewrap Init (Creating Android Project)"

# Set bubblewrap env so it uses OUR JDK/SDK (no downloads needed)
$env:BUBBLEWRAP_JDK_PATH = $JDK_DIR
$env:BUBBLEWRAP_SDK_PATH = $SDK_DIR

STEP "Running: bubblewrap init"
INFO "Using manifest: http://localhost:$PORT/manifest.json"

# Feed answers via stdin for any remaining interactive prompts
# N = use our own JDK, N = use our own SDK, then Enter for all defaults
$answers = "N`nN`n`n`n`n`n`n`n`n`n`n`n`n`n`n`n`n`n`n`n`n`n`n"

try {
    $initProc = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c echo $answers | bubblewrap init --manifest http://localhost:${PORT}/manifest.json" `
        -WorkingDirectory $TWA_DIR `
        -Environment @{
            JAVA_HOME            = $JDK_DIR
            ANDROID_HOME         = $SDK_DIR
            ANDROID_SDK_ROOT     = $SDK_DIR
            BUBBLEWRAP_JDK_PATH  = $JDK_DIR
            BUBBLEWRAP_SDK_PATH  = $SDK_DIR
            PATH                 = "$JDK_DIR\bin;$SDKTOOLS\bin;$SDK_DIR\platform-tools;$env:PATH"
        } `
        -NoNewWindow -PassThru -Wait -RedirectStandardInput "$TOOLS\answers.txt"

    if ($initProc.ExitCode -eq 0) {
        OK "bubblewrap init completed successfully!"
    } else {
        WARN "bubblewrap init exited with code $($initProc.ExitCode) — trying to build anyway"
    }
} catch {
    WARN "Init error: $($_.Exception.Message)"
    WARN "Trying build step anyway..."
}

# ── STEP 5: Build APK ─────────────────────────────────────────────
BANNER "STEP 5 — Building APK"
STEP "Running: bubblewrap build"

$buildEnv = @{
    JAVA_HOME        = $JDK_DIR
    ANDROID_HOME     = $SDK_DIR
    ANDROID_SDK_ROOT = $SDK_DIR
    PATH             = "$JDK_DIR\bin;$SDKTOOLS\bin;$SDK_DIR\platform-tools;$env:PATH"
}

try {
    $buildProc = Start-Process -FilePath "bubblewrap" `
        -ArgumentList "build" `
        -WorkingDirectory $TWA_DIR `
        -Environment $buildEnv `
        -NoNewWindow -PassThru -Wait

    if ($buildProc.ExitCode -eq 0) {
        OK "bubblewrap build completed!"
    } else {
        WARN "bubblewrap build exit code: $($buildProc.ExitCode)"
        # Try direct gradle build
        STEP "Trying Gradle direct build..."
        $gradlew = "$TWA_DIR\gradlew.bat"
        if (Test-Path $gradlew) {
            $gradleProc = Start-Process -FilePath $gradlew `
                -ArgumentList "assembleRelease" `
                -WorkingDirectory $TWA_DIR `
                -Environment $buildEnv `
                -NoNewWindow -PassThru -Wait
            OK "Gradle build exit: $($gradleProc.ExitCode)"
        }
    }
} catch {
    WARN "Build error: $($_.Exception.Message)"
}

# ── STEP 6: Locate and copy APK ───────────────────────────────────
BANNER "STEP 6 — Locating APK"

Stop-Job $serverJob -ErrorAction SilentlyContinue | Out-Null
Remove-Job $serverJob -ErrorAction SilentlyContinue | Out-Null

$apkCandidates = @(
    "$TWA_DIR\app-release-signed.apk",
    "$TWA_DIR\app-release.apk",
    "$TWA_DIR\app\build\outputs\apk\release\app-release-signed.apk",
    "$TWA_DIR\app\build\outputs\apk\release\app-release.apk",
    "$TWA_DIR\app\build\outputs\apk\release\app-release-unsigned.apk",
    "$TWA_DIR\app\build\outputs\apk\debug\app-debug.apk"
)

$foundApk = $null
foreach ($candidate in $apkCandidates) {
    if ((Test-Path $candidate) -and (Get-Item $candidate).Length -gt 10KB) {
        $foundApk = $candidate
        break
    }
}

if ($foundApk) {
    Copy-Item $foundApk $OUT_APK -Force
    $sizeMB = [math]::Round((Get-Item $OUT_APK).Length / 1MB, 2)

    BANNER "✅  SUCCESS — AuraAI.apk READY!"
    OK "APK saved: $OUT_APK"
    OK "APK size:  $sizeMB MB"
    Write-Host ""
    Write-Host "  📲 Install on Android:" -ForegroundColor White
    Write-Host "  1. Copy AuraAI.apk to your Android phone"
    Write-Host "  2. Settings → Security → 'Install unknown apps' → Enable"
    Write-Host "  3. Tap AuraAI.apk → Install"
    Write-Host "  4. Open Aura AI from your app drawer!" -ForegroundColor Green
    Write-Host ""
    # Open the output folder
    Start-Process explorer.exe $ROOT
} else {
    BANNER "⚠  NEED ONE MORE STEP"
    WARN "APK not yet generated. Android project is ready at:"
    INFO $TWA_DIR
    Write-Host ""
    Write-Host "  Run these commands to finish:" -ForegroundColor White
    Write-Host "  cd `"$TWA_DIR`"" -ForegroundColor Cyan
    Write-Host "  `$env:JAVA_HOME = `"$JDK_DIR`"" -ForegroundColor Cyan
    Write-Host "  `$env:ANDROID_HOME = `"$SDK_DIR`"" -ForegroundColor Cyan
    Write-Host "  .\gradlew.bat assembleRelease" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  ── OR use PWABuilder (instant, no SDK needed) ──" -ForegroundColor Yellow
    Write-Host "  1. npx serve . -p 3000  (run in aura-ai folder)"
    Write-Host "  2. npx ngrok http 3000  (copy the https://... URL)"
    Write-Host "  3. Go to: https://www.pwabuilder.com"
    Write-Host "  4. Paste URL → Package for Stores → Android → Download APK"
    Write-Host ""
}

Write-Host "Done." -ForegroundColor Green
