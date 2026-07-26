@REM Author: Aurora
@REM Project Version: 1.0.0
@echo off
setlocal EnableExtensions

title Bilibili Live Song Helper - Stop
set "APP_DIR=%~dp0"

echo.
echo ==========================================
echo   Stop Bilibili Live Song Helper
echo ==========================================
echo.
echo Looking for this project's local service...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = (Resolve-Path '%APP_DIR%').Path.TrimEnd('\');" ^
  "$killed = New-Object System.Collections.Generic.List[int];" ^
  "foreach ($port in 3000..3019) {" ^
  "  try {" ^
  "    $health = Invoke-RestMethod -UseBasicParsing -Uri ('http://127.0.0.1:{0}/api/health' -f $port) -TimeoutSec 1;" ^
  "    $dbPaths = @($health.data.db, $health.data.songDb, $health.data.superChatDb, $health.data.giftDb) | Where-Object { $_ };" ^
  "    $isProjectService = $false;" ^
  "    foreach ($dbPath in $dbPaths) {" ^
  "      if ([string]$dbPath -and ([string]$dbPath).StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) { $isProjectService = $true; break; }" ^
  "    }" ^
  "    if ($health.ok -and $isProjectService) {" ^
  "      $pattern = '(?:127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\[::\]):' + $port + '\s+.*LISTENING\s+(\d+)$';" ^
  "      foreach ($line in netstat -ano) {" ^
  "        if ($line -match $pattern) {" ^
  "          $pidValue = [int]$Matches[1];" ^
  "          if (-not $killed.Contains($pidValue)) {" ^
  "            Stop-Process -Id $pidValue -Force -ErrorAction Stop;" ^
  "            $killed.Add($pidValue);" ^
  "          }" ^
  "        }" ^
  "      }" ^
  "    }" ^
  "  } catch {}" ^
  "}" ^
  "if ($killed.Count -gt 0) { Write-Host ('Stopped service process: ' + ($killed -join ', ')); } else { Write-Host 'No running service was found for this project.'; }"

echo.
echo Done. The local service port is now released.
echo.
pause
exit /b 0
