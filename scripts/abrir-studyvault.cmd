@echo off
rem Abre StudyVault: arranca el servidor (minimizado) si no está en marcha y abre el navegador.
cd /d "%~dp0.."
powershell -NoProfile -Command "try { Invoke-WebRequest http://127.0.0.1:5173 -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  start "StudyVault (servidor)" /min cmd /c "npm run dev"
  powershell -NoProfile -Command "for ($i = 0; $i -lt 90; $i++) { try { Invoke-WebRequest http://127.0.0.1:5173 -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep 1 } }"
)
start "" http://localhost:5173
