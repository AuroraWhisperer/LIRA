#requires -version 5.1
$ErrorActionPreference = 'Stop'
$since = (Get-Date).AddDays(-2)
$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add('LIRA 安装诊断报告')
$lines.Add('收集时间：' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'))
$lines.Add('本工具只收集安装相关信息，不会运行安装包、修改系统设置或上传文件。')
$lines.Add('没有记录不代表没有故障；本报告不能单独证明故障原因。')
$lines.Add('')
$lines.Add('系统版本：' + [Environment]::OSVersion.Version)
$lines.Add('64 位操作系统：' + [Environment]::Is64BitOperatingSystem)
try {
  $windows = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
  $lines.Add('Windows 构建：' + $windows.CurrentBuildNumber + '.' + $windows.UBR + '，功能版本：' + $windows.DisplayVersion)
} catch { $lines.Add('Windows 构建信息读取失败：' + $_.Exception.Message) }

$lines.Add("`r`n--- 同文件夹内的 LIRA 安装包 ---")
$installers = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter 'lira-setup-*.exe' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 5)
if ($installers.Count -eq 0) { $lines.Add('未找到安装包；请把收集工具与安装包放在同一个文件夹再运行。') }
foreach ($installer in $installers) {
  $lines.Add('文件名：' + $installer.Name + '，字节数：' + $installer.Length)
  try {
    $lines.Add('SHA256：' + (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash)
    $lines.Add('签名状态：' + (Get-AuthenticodeSignature -LiteralPath $installer.FullName).Status)
  } catch { $lines.Add('文件校验失败：' + $_.Exception.Message) }
}

$lines.Add("`r`n--- 当前相关进程 ---")
$processes = @(Get-Process -Name 'lira-setup-*', 'LIRA', 'robocopy' -ErrorAction SilentlyContinue)
if ($processes.Count -eq 0) { $lines.Add('当前未发现 LIRA、安装包或数据复制进程。') }
foreach ($process in $processes) { $lines.Add($process.ProcessName + '，PID：' + $process.Id) }

$lines.Add("`r`n--- 安装器迁移报错 ---")
$migrationReport = Join-Path $env:TEMP 'LIRA-install-error.txt'
if (Test-Path -LiteralPath $migrationReport -PathType Leaf) {
  $reportInfo = Get-Item -LiteralPath $migrationReport
  $lines.Add('报错文件时间：' + $reportInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))
  if ($reportInfo.LastWriteTime -ge $since) {
    try { $lines.Add((Get-Content -LiteralPath $migrationReport -Encoding Unicode -Raw)) }
    catch { $lines.Add('迁移报告读取失败：' + $_.Exception.Message) }
  } else { $lines.Add('该报告早于最近两天，未作为本次故障信息收集。') }
} else { $lines.Add('未发现迁移报错文件。安装器可能未进入该阶段，或使用的是旧安装包。') }

$eventLogs = @(
  @{ LogName = 'Application'; Id = 1000, 1001, 1002, 33, 59; StartTime = $since },
  @{ LogName = 'Microsoft-Windows-Windows Defender/Operational'; Id = 1116, 1117; StartTime = $since },
  @{ LogName = 'Microsoft-Windows-CodeIntegrity/Operational'; Id = 3033, 3077; StartTime = $since },
  @{ LogName = 'Microsoft-Windows-AppLocker/EXE and DLL'; Id = 8004; StartTime = $since }
)
foreach ($filter in $eventLogs) {
  $lines.Add("`r`n--- 最近两天的相关系统记录：" + $filter.LogName + ' ---')
  try {
    $events = @(Get-WinEvent -FilterHashtable $filter -MaxEvents 500 -ErrorAction Stop |
      Where-Object { $_.Message -match '(?i)\blira(?:-setup-[^\s"\\]+)?\.exe\b' } | Select-Object -First 10)
    if ($events.Count -eq 0) { $lines.Add('查询范围内没有匹配的 LIRA 安装或崩溃记录。') }
    foreach ($event in $events) {
      $lines.Add($event.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss') + '，事件 ' + $event.Id)
      $lines.Add($event.Message)
    }
  } catch {
    if ($_.FullyQualifiedErrorId -like 'NoMatchingEventsFound*') { $lines.Add('查询范围内没有事件。') }
    else { $lines.Add('该日志不可读取或未启用：' + $_.Exception.Message) }
  }
}

$reportName = 'LIRA安装诊断-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt'
$outputPath = Join-Path $PSScriptRoot $reportName
try { [IO.File]::WriteAllLines($outputPath, $lines, [Text.UTF8Encoding]::new($true)) }
catch {
  $outputPath = Join-Path $env:TEMP $reportName
  [IO.File]::WriteAllLines($outputPath, $lines, [Text.UTF8Encoding]::new($true))
}
Write-Host ''
Write-Host '收集完成。请把下面这个 TXT 文件发给提供安装包的人：' -ForegroundColor Green
Write-Host $outputPath
Write-Host '如果安装时出现弹窗，请同时发送完整弹窗的截图或照片。'
