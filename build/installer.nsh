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
  Call liraRequireUserInstall
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
  !define LIRA_AGREEMENT_URL "https://lirahub.cn/legal/terms"
  !define LIRA_PRIVACY_URL "https://lirahub.cn/legal/privacy"
  Var liraAgreementPage
  Var liraAgreementAccept
  Var liraAgreementDecline
  Var liraAgreementAccepted
  Var liraAgreementLogo
  Var liraAgreementLogoBitmap
  Var liraAgreementTextFont

  ; The builder reserves this slot and supplies an MUI-only update pre-hook.
  ; Our custom page applies the same skip before creating any controls.
  !ifdef MUI_PAGE_CUSTOMFUNCTION_PRE
    !define LIRA_AGREEMENT_PRE "${MUI_PAGE_CUSTOMFUNCTION_PRE}"
    !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !endif
  Page custom liraShowAgreement liraLeaveAgreement
  !define LIRA_AGREEMENT_PAGE_DEFINED

  Function liraShowAgreement
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    !ifdef LIRA_AGREEMENT_PRE
      Call "${LIRA_AGREEMENT_PRE}"
    !endif
    !insertmacro MUI_HEADER_TEXT "LIRA" "版本 ${VERSION} · 用户协议与隐私政策"
    InitPluginsDir
    File /oname=$PLUGINSDIR\lira-wordmark.bmp "${BUILD_RESOURCES_DIR}\installer-wordmark.bmp"
    System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "LIRA", i 0x5000000E, i 0, i 0, i 0, i 0, p $HWNDPARENT, p 0, p 0, p 0) p .r0'
    StrCpy $liraAgreementLogo $0
    !insertmacro liraPlaceControl $liraAgreementLogo 24 10 62 24
    IntOp $1 62 * $liraUiDpi
    IntOp $1 $1 / 96
    IntOp $2 24 * $liraUiDpi
    IntOp $2 $2 / 96
    System::Call 'user32::LoadImageW(p 0, w "$PLUGINSDIR\lira-wordmark.bmp", i 0, i r1, i r2, i 0x2010) p .r0'
    StrCpy $liraAgreementLogoBitmap $0
    SendMessage $liraAgreementLogo ${STM_SETIMAGE} 0 $liraAgreementLogoBitmap
    ShowWindow $mui.Header.Text ${SW_HIDE}
    nsDialogs::Create 1018
    Pop $liraAgreementPage
    StrCpy $liraUiPage $liraAgreementPage
    Call liraPrepareInstallerPage

    System::Call '*(i 8, i 0x8000) p .r0'
    System::Call 'comctl32::InitCommonControlsEx(p r0)'
    System::Free $0
    nsDialogs::CreateControl "SysLink" ${WS_CHILD}|${WS_VISIBLE}|${WS_TABSTOP} 0 0 0 100% 0 '欢迎使用 LIRA。本软件提供直播互动与内容管理辅助功能，部分功能依赖网络及第三方服务，并涉及账号凭据、配置及互动数据的云端处理。安装前，请仔细阅读<a href="${LIRA_AGREEMENT_URL}">《用户协议》</a>和<a href="${LIRA_PRIVACY_URL}">《隐私政策》</a>，了解使用规则、信息处理及责任限制。选择同意并继续安装，即表示您接受用户协议并已阅读隐私政策；如不同意，请取消安装。'
    Pop $0
    !insertmacro liraPlaceControl $0 0 0 $liraUiPageWidth 88
    SendMessage $liraAgreementPage ${WM_GETFONT} 0 0 $1
    ; Add two logical pixels and keep the installer's Microsoft YaHei UI typeface.
    System::Alloc 92
    Pop $2
    System::Call 'gdi32::GetObjectW(p r1, i 92, p r2)'
    System::Call '*$2(i .r3)'
    IntOp $4 2 * $liraUiDpi
    IntOp $4 $4 / 96
    IntOp $3 $3 - $4
    System::Call 'gdi32::CreateFontW(i r3, i 0, i 0, i 0, i 400, i 0, i 0, i 0, i 1, i 0, i 0, i 5, i 0, w "Microsoft YaHei UI") p .r1'
    StrCpy $liraAgreementTextFont $1
    System::Free $2
    SendMessage $0 ${WM_SETFONT} $liraAgreementTextFont 0
    ${NSD_OnNotify} $0 liraOpenOnlineAgreement
    ${NSD_CreateRadioButton} 0 0 100% 0 "我同意用户协议，并已阅读隐私政策(&A)"
    Pop $liraAgreementAccept
    ${NSD_AddStyle} $liraAgreementAccept ${WS_GROUP}
    !insertmacro liraPlaceControl $liraAgreementAccept 0 104 $liraUiPageWidth 24
    ${NSD_CreateRadioButton} 0 0 100% 0 "我不同意(&D)"
    Pop $liraAgreementDecline
    !insertmacro liraPlaceControl $liraAgreementDecline 0 134 $liraUiPageWidth 24
    ${If} $liraAgreementAccepted == ${BST_CHECKED}
      ${NSD_Check} $liraAgreementAccept
    ${Else}
      ${NSD_Check} $liraAgreementDecline
    ${EndIf}
    ${NSD_OnClick} $liraAgreementAccept liraAgreementClicked
    ${NSD_OnClick} $liraAgreementDecline liraAgreementClicked
    Call liraAgreementChanged
    nsDialogs::Show
  FunctionEnd

  Function liraAgreementChanged
    ${NSD_GetState} $liraAgreementAccept $liraAgreementAccepted
    GetDlgItem $0 $HWNDPARENT 1
    EnableWindow $0 $liraAgreementAccepted
  FunctionEnd

  Function liraAgreementClicked
    Pop $0
    Call liraAgreementChanged
  FunctionEnd

  Function liraLeaveAgreement
    ${NSD_GetState} $liraAgreementAccept $liraAgreementAccepted
    ${If} $liraAgreementAccepted != ${BST_CHECKED}
      Abort
    ${EndIf}
    System::Call 'user32::DestroyWindow(p $liraAgreementLogo)'
    System::Call 'gdi32::DeleteObject(p $liraAgreementLogoBitmap)'
    System::Call 'gdi32::DeleteObject(p $liraAgreementTextFont)'
    ShowWindow $mui.Header.Text ${SW_SHOW}
  FunctionEnd

  Function liraOpenOnlineAgreement
    Pop $0
    Pop $1
    Pop $2
    ; SysLink reports both mouse activation (NM_CLICK) and Enter (NM_RETURN).
    ${If} $1 == -2
    ${OrIf} $1 == -4
      ; NMLINK contains NMHDR, then LITEM.mask and the zero-based link index.
      System::Call '*$2(p, p, i, i, i .r3)'
      ${If} $3 == 0
        ExecShell "open" "${LIRA_AGREEMENT_URL}"
      ${ElseIf} $3 == 1
        ExecShell "open" "${LIRA_PRIVACY_URL}"
      ${EndIf}
    ${EndIf}
    ${NSD_Return} 0
  FunctionEnd

!macroend

!macro customHeader
  !include "installer-process.nsh"
  !ifndef BUILD_UNINSTALLER
    !insertmacro liraInstallerUi
    !include "installer-data.nsh"
    !include "installer-per-user.nsh"
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
      Call liraRequireWritableInstallDirectory
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
    ; NSIS 3.0.4 searches the working directory before its include directories.
    ; The wrapper restores the builder directory after its one include override.
    !cd "${BUILD_RESOURCES_DIR}\nsis"
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
