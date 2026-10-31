ManifestDPIAware true

!include "installer-uninstall.nsh"

!macro customCheckAppRunning
  !ifdef BUILD_UNINSTALLER
    StrCpy $liraPreviousInstallDir "$INSTDIR"
    Call un.liraEnsureAppExited
    StrCmp $R0 0 liraBuilderAppExited
    SetErrorLevel 2
    MessageBox MB_OK|MB_ICONSTOP "卸载已停止，数据仍保留。$\r$\n$\r$\n$R5" /SD IDOK
    Quit
    liraBuilderAppExited:
  !else
    Call liraWaitForAppExit
  !endif
!macroend

!macro customInit
  Call liraSelectDefaultDirectory
  ; Only inspect this app's key in electron-builder's selected install context.
  ; Its UninstallString is a quoted executable followed by install-mode arguments.
  ReadRegStr $R3 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  StrCpy $R4 $R3 1
  StrCmp $R4 '"' 0 customInitDone
  Push "$R3"
  Call GetInQuotes
  Pop $R4
  ; An empty/malformed/unknown command is not proof that its executable is missing.
  StrCmp $R4 "" customInitDone
  IfFileExists "$R4" customInitDone
  DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"
  customInitDone:
!macroend

!macro customWelcomePage
  ; The builder resets INSTDIR when the install mode changes. Apply the fresh
  ; install default again in its directory-page pre-hook, including update pages.
  !include "installer-directory.nsh"
!macroend

!macro licensePage
  ; Decline starts selected; Next stays disabled until the user accepts.
  !define MUI_PAGE_HEADER_TEXT "用户协议"
  !define MUI_PAGE_HEADER_SUBTEXT "安装 LIRA 前，请仔细阅读下面的协议。"
  !define MUI_LICENSEPAGE_TEXT_TOP "滚动鼠标或按 Page Down 键可以查看全部内容。"
  !define MUI_LICENSEPAGE_TEXT_BOTTOM "选中“我已阅读并同意以上协议”才能继续安装；不同意的话，可以点“取消”退出。"
  !define MUI_LICENSEPAGE_RADIOBUTTONS
  !define MUI_LICENSEPAGE_RADIOBUTTONS_TEXT_ACCEPT "我已阅读并同意以上协议(&A)"
  !define MUI_LICENSEPAGE_RADIOBUTTONS_TEXT_DECLINE "我不同意(&D)"
  !insertmacro MUI_PAGE_LICENSE "${BUILD_RESOURCES_DIR}\..\public\pages\admin\toolbox\user-agreement.txt"
!macroend

!macro customHeader
  !include "installer-process.nsh"
  !ifndef BUILD_UNINSTALLER
    !include "installer-data.nsh"
    Function liraSelectDefaultDirectory
      ReadRegStr $liraPreviousInstallDir SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "InstallLocation"
      !insertmacro GetDParameter $R0
      StrCmp $R0 "" 0 liraDirectorySelected
      StrCmp $liraPreviousInstallDir "" 0 liraDirectorySelected
      IfFileExists "D:\*.*" 0 liraDirectorySelected
      StrCpy $INSTDIR "D:\LIRA"
      liraDirectorySelected:
        StrCmp $liraPreviousInstallDir "" 0 liraDirectoryReady
        StrCpy $liraPreviousInstallDir "$INSTDIR"
      liraDirectoryReady:
    FunctionEnd
    ; This section runs after directory selection and before the builder's install
    ; section. An unelevated all-users instance leaves preservation to its child.
    Section "-LIRA Preserve Data"
      ${If} $installMode == "all"
      ${AndIfNot} ${UAC_IsAdmin}
        Goto liraPreservationDeferred
      ${EndIf}
      Call liraWaitForAppExit
      SetDetailsPrint textonly
      DetailPrint "正在准备安装 LIRA，请稍候…"
      SetDetailsPrint listonly
      ; Electron profiles are per-user even for an all-users installation.
      SetShellVarContext current
      Call liraPreserveInstallData
      SetDetailsPrint textonly
      DetailPrint "正在安装 LIRA，请稍候…"
      SetDetailsPrint listonly
      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}
      liraPreservationDeferred:
    SectionEnd
  !endif
!macroend

!macro customInstall
  Call liraRestoreInstallData
  ; Keep the updater's cached installer alongside its local download cache.
  Push "$INSTDIR\updates\${APP_INSTALLER_STORE_FILE}"
  Call GetFileParent
  Pop $R0
  CreateDirectory "$R0"
  ClearErrors
  StrCmp "$EXEPATH" "$INSTDIR\updates\${APP_INSTALLER_STORE_FILE}" liraInstallerCached
  CopyFiles /SILENT "$EXEPATH" "$INSTDIR\updates\${APP_INSTALLER_STORE_FILE}"
  liraInstallerCached:
    SetShellVarContext current
    Delete "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
    ${If} $installMode == "all"
      SetShellVarContext all
    ${EndIf}
!macroend
