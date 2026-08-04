ManifestDPIAware true

!macro customInit
  ; If the old uninstaller is missing but a registry entry exists, remove the stale
  ; entry so NSIS does not abort with "Failed to uninstall old application files.: 2"
  StrCpy $R1 0
  customInitLoop:
    EnumRegKey $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall" $R1
    StrCmp $R0 "" customInitDone
    ReadRegStr $R2 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R0" "DisplayName"
    StrCmp $R2 "点歌助手" customInitFound
    IntOp $R1 $R1 + 1
    Goto customInitLoop
  customInitFound:
    ReadRegStr $R3 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R0" "UninstallString"
    IfFileExists "$R3" customInitDone
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R0"
  customInitDone:
!macroend

!macro customUnInstall
  RMDir /r "$APPDATA\bilibili-live-song-plugin"
  ; 清理旧版本残留在 %APPDATA% 下的 Electron Chromium 持久化分区数据
  ; （新版本已将 userData 重定向到安装目录，此目录仅用于旧版本升级时的清理）
  RMDir /r "$APPDATA\点歌助手"
!macroend
