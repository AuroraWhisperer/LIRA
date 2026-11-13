; Local install utilities based on electron-builder 26.18.0.
; Keep support routines compatible with its installSection.nsh and include/installer.nsh.
; Define the safe upgrade macro directly: the upstream legacy function must not be emitted.
; Recheck these contracts when upgrading app-builder-lib.
;
; The MIT License (MIT)
;
; Copyright (c) 2015 Loopline Systems
;
; Permission is hereby granted, free of charge, to any person obtaining a copy
; of this software and associated documentation files (the "Software"), to deal
; in the Software without restriction, including without limitation the rights
; to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
; copies of the Software, and to permit persons to whom the Software is
; furnished to do so, subject to the following conditions:
;
; The above copyright notice and this permission notice shall be included in all
; copies or substantial portions of the Software.
;
; THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
; IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
; FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
; AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
; LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
; OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
; SOFTWARE.

!macro moveFile FROM TO
  ClearErrors
  Rename `${FROM}` `${TO}`
  ${if} ${errors}
    # not clear - can NSIS rename on another drive or not, so, in case of error, just copy
    ClearErrors
    !insertmacro copyFile `${FROM}` `${TO}`
    Delete `${FROM}`
  ${endif}
!macroend

!macro copyFile FROM TO
  ${StdUtils.GetParentPath} $R5 `${TO}`
  CreateDirectory `$R5`
  ClearErrors
  CopyFiles /SILENT `${FROM}` `${TO}`
!macroend

Function GetInQuotes
  Exch $R0
  Push $R1
  Push $R2
  Push $R3

   StrCpy $R2 -1
   IntOp $R2 $R2 + 1
    StrCpy $R3 $R0 1 $R2
    StrCmp $R3 "" 0 +3
     StrCpy $R0 ""
     Goto Done
    StrCmp $R3 '"' 0 -5

   IntOp $R2 $R2 + 1
   StrCpy $R0 $R0 "" $R2

   StrCpy $R2 0
   IntOp $R2 $R2 + 1
    StrCpy $R3 $R0 1 $R2
    StrCmp $R3 "" 0 +3
     StrCpy $R0 ""
     Goto Done
    StrCmp $R3 '"' 0 -5

   StrCpy $R0 $R0 $R2
   Done:

  Pop $R3
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd

!macro GetInQuotes Var Str
  Push "${Str}"
  Call GetInQuotes
  Pop "${Var}"
!macroend

Function GetFileParent
  Exch $R0
  Push $R1
  Push $R2
  Push $R3

  StrCpy $R1 0
  StrLen $R2 $R0

  loop:
    IntOp $R1 $R1 + 1
    IntCmp $R1 $R2 get 0 get
    StrCpy $R3 $R0 1 -$R1
    StrCmp $R3 "\" get
  Goto loop

  get:
    StrCpy $R0 $R0 -$R1

    Pop $R3
    Pop $R2
    Pop $R1
    Exch $R0
FunctionEnd

Var /GLOBAL isTryToKeepShortcuts

!macro setIsTryToKeepShortcuts
  StrCpy $isTryToKeepShortcuts "true"
  !ifdef allowToChangeInstallationDirectory
    ${ifNot} ${isUpdated}
      StrCpy $isTryToKeepShortcuts "false"
    ${endIf}
  !endif
!macroend

# https://nsis-dev.github.io/NSIS-Forums/html/t-172971.html
!macro readReg VAR ROOT_KEY SUB_KEY NAME
  ${if} "${ROOT_KEY}" == "SHELL_CONTEXT"
    ReadRegStr "${VAR}" SHELL_CONTEXT "${SUB_KEY}" "${NAME}"
  ${elseif} "${ROOT_KEY}" == "HKEY_CURRENT_USER"
    ReadRegStr "${VAR}" HKEY_CURRENT_USER "${SUB_KEY}" "${NAME}"
  ${elseif} "${ROOT_KEY}" == "HKEY_LOCAL_MACHINE"
    ReadRegStr "${VAR}" HKEY_LOCAL_MACHINE "${SUB_KEY}" "${NAME}"
  ${else}
    MessageBox MB_OK "Unsupported ${ROOT_KEY}"
  ${endif}
!macroend

Function handleUninstallResult
  Var /GLOBAL rootKey_uninstallResult
  Exch $rootKey_uninstallResult

  ${if} "$rootKey_uninstallResult" == "SHELL_CONTEXT"
    !ifmacrodef customUnInstallCheck
      !insertmacro customUnInstallCheck
      Return
    !endif
  ${elseif} "$rootKey_uninstallResult" == "HKEY_CURRENT_USER"
    !ifmacrodef customUnInstallCheckCurrentUser
      !insertmacro customUnInstallCheckCurrentUser
      Return
    !endif
  ${endif}

  IfErrors 0 +3
  DetailPrint `Uninstall was not successful. Not able to launch uninstaller!`
  Return

  ${if} $R0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
    DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
    SetErrorLevel 2
    Quit
  ${endif}
FunctionEnd

!macro handleUninstallResult ROOT_KEY
  Push "${ROOT_KEY}"
  Call handleUninstallResult
!macroend

; The installed legacy uninstaller may recursively delete unrelated files.
; Run the uninstaller from this package without replacing the old executable.
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
