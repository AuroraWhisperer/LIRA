; Extend the installed builder template at its normal top-level include point.
!include "${PROJECT_DIR}\node_modules\app-builder-lib\templates\nsis\include\installUtil.nsh"

; The installed legacy uninstaller may recursively delete unrelated files.
; Run the uninstaller from this package without replacing the old executable.
!macroundef uninstallOldVersion
!macro uninstallOldVersion ROOT_KEY
  StrCpy $R0 0
  !insertmacro readReg $R1 "${ROOT_KEY}" "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ${If} $R1 != ""
    !insertmacro readReg $R2 "${ROOT_KEY}" "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $R2 != ""
      GetFullPathName $R2 "$R2"
      GetFullPathName $R3 "$liraPreviousInstallDir"
    ${Else}
      StrCpy $R3 "missing-install-location"
    ${EndIf}
    ${If} $installMode != "CurrentUser"
    ${OrIf} $R2 != $R3
      SetErrorLevel 2
      MessageBox MB_OK|MB_ICONSTOP "安装已停止：旧版安装位置或用户范围发生变化，原文件未删除。请重新运行安装包。" /SD IDOK
      Quit
    ${EndIf}
    InitPluginsDir
    File "/oname=$PLUGINSDIR\lira-safe-uninstaller.exe" "${UNINSTALLER_OUT_FILE}"
    !insertmacro setIsTryToKeepShortcuts
    StrCpy $R3 ""
    ${If} $isTryToKeepShortcuts == "true"
      StrCpy $R3 "--keep-shortcuts"
    ${EndIf}
    ClearErrors
    ExecWait '"$PLUGINSDIR\lira-safe-uninstaller.exe" /S /currentuser /KEEP_APP_DATA --updated $R3 _?=$R2' $R0
    ${If} ${Errors}
      StrCpy $R0 2
    ${EndIf}
    ; handleUninstallResult aborts for nonzero status; do not let a launch error
    ; enter its best-effort legacy "uninstaller missing" branch.
    ClearErrors
  ${EndIf}
!macroend

!cd "${PROJECT_DIR}\node_modules\app-builder-lib\templates\nsis"
