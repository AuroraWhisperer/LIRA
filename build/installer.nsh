ManifestDPIAware true

!include "installer-uninstall.nsh"

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

!macro customHeader
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
