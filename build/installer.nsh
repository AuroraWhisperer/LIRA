ManifestDPIAware true

!include "installer-uninstall.nsh"
!ifndef BUILD_UNINSTALLER
  !include "installer-ui.nsh"
!endif

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
  !insertmacro liraInitUpdateProgress
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
  Var liraAgreementFont

  ; Decline starts selected; Next stays disabled until the user accepts.
  !define MUI_PAGE_HEADER_TEXT "用户协议与隐私说明"
  !define MUI_PAGE_HEADER_SUBTEXT "请阅读以下内容，同意后继续安装。"
  !define MUI_LICENSEPAGE_TEXT_TOP ""
  !define MUI_LICENSEPAGE_TEXT_BOTTOM ""
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW liraShowAgreement
  !define MUI_LICENSEPAGE_RADIOBUTTONS
  !define MUI_LICENSEPAGE_RADIOBUTTONS_TEXT_ACCEPT "我已阅读并同意以上协议(&A)"
  !define MUI_LICENSEPAGE_RADIOBUTTONS_TEXT_DECLINE "我不同意(&D)"
  !insertmacro MUI_PAGE_LICENSE "${BUILD_RESOURCES_DIR}\..\public\pages\admin\toolbox\user-agreement.txt"

  Function liraShowAgreement
    Call liraLayoutAgreement
    Push $0
    Push $1
    Push $2
    Push $3
    Push $4
    Push $5

    ShowWindow $mui.LicensePage.TopText ${SW_HIDE}
    ShowWindow $mui.LicensePage.Text ${SW_HIDE}
    StrCmp $liraAgreementFont "" 0 liraAgreementFontReady
    CreateFont $liraAgreementFont "Microsoft YaHei UI" 9
    liraAgreementFontReady:
      SendMessage $mui.LicensePage.LicenseText ${WM_SETFONT} $liraAgreementFont 0

    ; Use the space above the consent controls, measured in the current DPI.
    GetDlgItem $0 $mui.LicensePage 1034
    System::Call '*(i, i, i, i) p .r1'
    System::Call 'user32::GetWindowRect(p r0, p r1)'
    System::Call 'user32::MapWindowPoints(p 0, p $mui.LicensePage, p r1, i 2)'
    System::Call '*$1(i .r2, i .r3, i .r4, i .r5)'
    IntOp $5 $5 - $3
    IntOp $5 $5 / 2
    IntOp $3 $3 - $5
    IntOp $4 $4 - $2
    System::Call 'user32::SetWindowPos(p $mui.LicensePage.LicenseText, p 0, i r2, i 0, i r4, i r3, i 0x14)'

    ; Keep native word wrapping and scrolling, with an inset around the text.
    System::Call 'user32::GetClientRect(p $mui.LicensePage.LicenseText, p r1)'
    System::Call '*$1(i, i, i .r4, i .r3)'
    IntOp $4 $4 - $5
    IntOp $3 $3 - $5
    System::Call '*$1(i r5, i r5, i r4, i r3)'
    SendMessage $mui.LicensePage.LicenseText ${EM_SETRECT} 0 $1
    System::Free $1
    System::Call 'user32::SetFocus(p $mui.LicensePage.LicenseText)'

    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  FunctionEnd
!macroend

!macro customHeader
  !include "installer-process.nsh"
  !ifndef BUILD_UNINSTALLER
    !insertmacro liraInstallerUi
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
      SetDetailsPrint textonly
      DetailPrint "正在等待 LIRA 退出，请稍候…"
      SetDetailsPrint listonly
      Call liraWaitForAppExit
      SetDetailsPrint textonly
      DetailPrint "正在准备安装 LIRA，请稍候…"
      SetDetailsPrint listonly
      ; Match the exact uninstaller the builder will invoke in this context.
      StrCpy $liraPreviousUninstaller ""
      ReadRegStr $R3 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
      StrCpy $R4 $R3 1
      StrCmp $R4 '"' 0 liraUninstallerSelected
      Push "$R3"
      Call GetInQuotes
      Pop $liraPreviousUninstaller
      ${If} $installMode == "all"
        ; The builder also removes a per-user installation when installing for all.
        ReadRegStr $R3 HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
        ${If} $R3 != ""
          StrCpy $liraPreviousUninstaller ""
        ${EndIf}
      ${EndIf}
      liraUninstallerSelected:
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
  Call liraRecordDataPreservation
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
