!ifdef BUILD_UNINSTALLER
  Var liraDeleteDataRequested
  Var liraDeleteDataConfirmed
  !define LIRA_UNINSTALL_PREFIX "un."
!else
  !define LIRA_UNINSTALL_PREFIX ""
!endif

; NSIS RMDir /r follows junctions. Walk real directories and unlink reparse points.
Function ${LIRA_UNINSTALL_PREFIX}liraRemoveTree
  Exch $R3
  Push $R4
  Push $R5
  Push $R7
  ClearErrors
  System::Call 'kernel32::GetFileAttributesW(w "$R3") i .R7'
  IntCmp $R7 -1 liraTreeFailed
  IntOp $R5 $R7 & 0x10
  StrCmp $R5 0 liraTreeFile
  IntOp $R7 $R7 & 0x400
  StrCmp $R7 0 0 liraTreeDirectory
  FindFirst $R4 $R5 "$R3\*"
  liraTreeNext:
    StrCmp $R5 "" liraTreeClosed
    StrCmp $R5 "." liraTreeSkip
    StrCmp $R5 ".." liraTreeSkip
    Push "$R3\$R5"
    Call ${LIRA_UNINSTALL_PREFIX}liraRemoveTree
    IfErrors liraTreeCloseFailed
    liraTreeSkip:
      FindNext $R4 $R5
      Goto liraTreeNext
  liraTreeClosed:
    FindClose $R4
  liraTreeDirectory:
    ClearErrors
    RMDir "$R3"
    Goto liraTreeDone
  liraTreeFile:
    Delete "$R3"
    Goto liraTreeDone
  liraTreeCloseFailed:
    FindClose $R4
  liraTreeFailed:
    SetErrors
  liraTreeDone:
    Pop $R7
    Pop $R5
    Pop $R4
    Pop $R3
FunctionEnd

!macro customUnInit
  StrCpy $liraDeleteDataRequested "0"
  StrCpy $liraDeleteDataConfirmed "0"
!macroend

!macro customUnWelcomePage
  !include nsDialogs.nsh
  Var liraDeleteDataCheckbox
  UninstPage custom un.liraUninstallOptions un.liraUninstallOptionsLeave

  Function un.liraUninstallOptions
    StrCpy $liraDeleteDataRequested "0"
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "卸载 LIRA" "日志和更新文件将删除，用户数据默认保留。"
    nsDialogs::Create 1018
    Pop $R0
    ${If} $R0 == error
      SetErrorLevel 2
      Quit
    ${EndIf}
    ${NSD_CreateLabel} 0u 0u 100% 28u "保留数据后，重新安装到此目录可继续使用原有设置和资料。"
    Pop $R0
    ${NSD_CreateCheckbox} 0u 38u 100% 18u "同时删除用户数据"
    Pop $liraDeleteDataCheckbox
    ${NSD_Uncheck} $liraDeleteDataCheckbox
    ${NSD_CreateLabel} 0u 64u 100% 38u "包括曲库、配置、历史记录、登录状态和上传素材，也会清理当前用户的旧版 LIRA 数据。删除前会再次确认。"
    Pop $R0
    ${NSD_CreateLabel} 0u 110u 100% 26u "数据位置：$INSTDIR\data"
    Pop $R0
    nsDialogs::Show
  FunctionEnd

  Function un.liraUninstallOptionsLeave
    ${NSD_GetState} $liraDeleteDataCheckbox $liraDeleteDataRequested
  FunctionEnd
!macroend

!macro customUnInstall
  ; Confirm after the builder has selected the installation and checked app exit.
  StrCpy $liraDeleteDataConfirmed "0"
  ${IfNot} ${isUpdated}
  ${AndIfNot} ${Silent}
  ${AndIf} $liraDeleteDataRequested == "1"
    MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "确定同时删除 LIRA 的本地用户数据吗？$\r$\n$\r$\n将删除曲库、配置、历史记录、登录状态和上传素材，重装后无法恢复。$\r$\n数据位置：$INSTDIR\data$\r$\n同时清理当前用户的旧版 LIRA 数据和登录资料。手工备份和云端数据不受影响。$\r$\n$\r$\n选择“否”将保留数据并继续卸载。" /SD IDNO IDYES liraDataDeletionConfirmed
    Goto liraDataConfirmationDone
    liraDataDeletionConfirmed:
      StrCpy $liraDeleteDataConfirmed "1"
  ${EndIf}
  liraDataConfirmationDone:
!macroend

!macro liraValidateUninstallDirectory
  StrCmp $INSTDIR "" liraUnsafeUninstallDirectory
  GetFullPathName $R7 "$INSTDIR"
  StrCmp $R7 "" liraUnsafeUninstallDirectory
  GetFullPathName $R8 "$R7\.."
  StrCmp $R7 $R8 liraUnsafeUninstallDirectory
  IfFileExists "$R7" 0 liraUninstallDirectoryResolved
  System::Call 'kernel32::GetFileAttributesW(w "$R7") i .R8'
  IntOp $R8 $R8 & 0x400
  StrCmp $R8 0 0 liraUnsafeUninstallDirectory
  liraUninstallDirectoryResolved:
  StrCpy $INSTDIR "$R7"
  Goto liraUninstallDirectoryReady
  liraUnsafeUninstallDirectory:
    SetErrorLevel 2
    MessageBox MB_OK|MB_ICONSTOP "卸载已停止：安装目录无效或是目录链接。未删除文件。" /SD IDOK
    Quit
  liraUninstallDirectoryReady:
!macroend

!macro customRemoveFiles
  !insertmacro liraValidateUninstallDirectory
  ; Upgrade installers may be running from updates; retain every runtime directory.
  ${If} ${isUpdated}
  ${OrIf} ${Silent}
    StrCpy $liraDeleteDataConfirmed "0"
  ${EndIf}
  SetOutPath $TEMP
  FindFirst $R0 $R1 "$INSTDIR\*"
  liraRemoveNext:
    StrCmp $R1 "" liraRemoveDone
    StrCmp $R1 "." liraRemoveSkip
    StrCmp $R1 ".." liraRemoveSkip
    StrCmp $R1 "${UNINSTALL_FILENAME}" liraRemoveSkip
    ${If} $liraDeleteDataConfirmed != "1"
      StrCmp $R1 "data" liraRemoveSkip
    ${EndIf}
    ${If} ${isUpdated}
      StrCmp $R1 "logs" liraRemoveSkip
      StrCmp $R1 "updates" liraRemoveSkip
    ${EndIf}
    StrCpy $R6 "$INSTDIR\$R1"
    Push "$R6"
    Call ${LIRA_UNINSTALL_PREFIX}liraRemoveTree
    IfErrors liraRemoveFailed
    liraRemoveSkip:
      FindNext $R0 $R1
      Goto liraRemoveNext
  liraRemoveDone:
    FindClose $R0
    StrCpy $R0 ""
    ${If} $liraDeleteDataConfirmed == "1"
      ; These are the desktop's known migration sources, not arbitrary AppData.
      SetShellVarContext current
      StrCpy $R6 "$APPDATA\com.aurorawhisperer.lira"
      IfFileExists "$R6" 0 liraRemoveLegacyBrowser
      Push "$R6"
      Call ${LIRA_UNINSTALL_PREFIX}liraRemoveTree
      IfErrors liraRemoveFailed
      liraRemoveLegacyBrowser:
        StrCpy $R6 "$APPDATA\${APP_PACKAGE_NAME}"
        IfFileExists "$R6" 0 liraLegacyDataRemoved
        Push "$R6"
        Call ${LIRA_UNINSTALL_PREFIX}liraRemoveTree
        IfErrors liraRemoveFailed
      liraLegacyDataRemoved:
        ${If} $installMode == "all"
          SetShellVarContext all
        ${EndIf}
    ${EndIf}
    ; Keep the original uninstaller available if any cleanup step needs a retry.
    StrCpy $R6 "$INSTDIR\${UNINSTALL_FILENAME}"
    IfFileExists "$R6" 0 liraUninstallerRemoved
    ClearErrors
    Delete "$R6"
    IfErrors liraRemoveFailed
    liraUninstallerRemoved:
    ; A retained data directory intentionally prevents removal of the parent.
    RMDir "$INSTDIR"
    Goto liraRemovalFinished
  liraRemoveFailed:
    StrCmp $R0 "" +2
    FindClose $R0
    ${If} $installMode == "all"
      SetShellVarContext all
    ${EndIf}
    SetErrorLevel 2
    MessageBox MB_OK|MB_ICONSTOP "卸载未能完成，以下文件或目录未能清理：$\r$\n$R6$\r$\n$\r$\n请关闭占用文件的程序，检查目录权限后重试。已删除的文件无法恢复。" /SD IDOK
    Quit
  liraRemovalFinished:
!macroend
