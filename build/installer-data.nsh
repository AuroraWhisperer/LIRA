Var liraPreviousInstallDir
Var liraDataSource
Var liraDataBackup
Var liraDataStage
Var liraDataBanner
Var liraCopySource
Var liraCopyTarget

Function liraWaitForAppExit
  StrCpy $liraDataStage "等待旧版 LIRA 退出"
  StrCpy $R4 "未执行"
  StrCpy $liraDataSource "$liraPreviousInstallDir\data"
  StrCpy $R3 0
  liraFindRunningApp:
    nsProcess::_FindProcess /NOUNLOAD "${APP_EXECUTABLE_FILENAME}"
    Pop $R0
    nsProcess::_Unload
    StrCmp $R0 603 liraAppExited
    StrCpy $R5 "旧版 LIRA 还在运行。请关闭它的所有窗口，等待几秒后重试；找不到窗口时，可重启电脑后直接运行安装包。"
    StrCmp $R0 0 liraAppStillRunning
    StrCpy $R5 "无法确认旧版 LIRA 是否退出，进程检查返回码：$R0。"
    Call liraInstallDataFailure
  liraAppStillRunning:
    ; Silent updates already ask Electron to quit and must let it finish cleanup.
    IfSilent liraWaitForExitPoll
    StrCmp $R3 0 0 liraWaitForExitPoll
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "LIRA 正在运行。安装程序将自动关闭 LIRA，然后继续更新。$\r$\n$\r$\n播放和直播互动将暂时中断。点击“确定”继续，或点击“取消”稍后更新。" /SD IDCANCEL IDOK liraCloseRunningApp
  liraCancelInstall:
    SetErrorLevel 2
    Quit
  liraCloseRunningApp:
    Call liraRequestAppExit
    StrCpy $R3 0
  liraWaitForExitPoll:
    IntOp $R3 $R3 + 1
    IntCmp $R3 40 liraAppExitTimeout
    Sleep 250
    Goto liraFindRunningApp
  liraAppExitTimeout:
    IfSilent liraAppExitFailed
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "安装程序未能自动关闭 LIRA。请关闭它的所有窗口后点击“重试”，或点击“取消”稍后更新。$\r$\n$\r$\n数据尚未移动。" /SD IDCANCEL IDRETRY liraCloseRunningApp
    Goto liraCancelInstall
  liraAppExitFailed:
    Call liraInstallDataFailure
  liraAppExited:
FunctionEnd

Function liraRequestAppExit
  ; Request normal closure of every owned window, including auxiliary windows.
  ; Never force termination: preservation still waits for all processes to exit.
  System::Store "s"
  GetFullPathName $5 "$liraPreviousInstallDir\${APP_EXECUTABLE_FILENAME}"
  GetFullPathName $6 "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  System::Get '(p.r1, p) iss'
  Pop $0
  System::Call 'user32::EnumWindows(k r0, p 0) i.s'
  liraNextAppWindow:
    Pop $2
    StrCpy $3 $2 8
    StrCmp $3 "callback" 0 liraAppWindowsDone
    System::Call 'user32::GetWindowThreadProcessId(p r1, *i .r2)'
    System::Call 'kernel32::OpenProcess(i 0x1000, i 0, i r2) p.r2'
    StrCmp $2 0 liraContinueAppWindows
    System::Call 'kernel32::QueryFullProcessImageNameW(p r2, i 0, w.r3, *i ${NSIS_MAX_STRLEN}) i.r4'
    System::Call 'kernel32::CloseHandle(p r2)'
    StrCmp $4 0 liraContinueAppWindows
    StrCmp $3 $5 liraCloseAppWindow
    StrCmp $3 $6 0 liraContinueAppWindows
  liraCloseAppWindow:
    System::Call 'user32::PostMessageW(p r1, i 0x0010, p 0, p 0)'
  liraContinueAppWindows:
    Push 1
    System::Call $0
    Goto liraNextAppWindow
  liraAppWindowsDone:
    System::Free $0
    System::Store "l"
FunctionEnd

Function liraPreserveInstallData
  StrCpy $liraDataStage "检查安装数据目录"
  StrCpy $R4 "未执行"
  StrCpy $R5 "安装目录不能是磁盘根目录，也不能嵌套在旧安装目录内部。"
  StrCmp $INSTDIR "" liraPrepareFailed
  StrCmp $liraPreviousInstallDir "" liraPrepareFailed
  ClearErrors
  CreateDirectory "$INSTDIR"
  IfErrors liraPrepareFailed
  GetFullPathName $R0 "$INSTDIR"
  StrCmp $R0 "" liraPrepareFailed
  StrCpy $INSTDIR $R0
  GetFullPathName $R0 "$INSTDIR\.."
  StrCmp $R0 $INSTDIR liraPrepareFailed
  GetFullPathName $R0 "$liraPreviousInstallDir\.."
  StrCmp $R0 $liraPreviousInstallDir liraPrepareFailed
  StrCpy $liraDataBackup "$INSTDIR.lira-data-backup"
  StrCpy $R0 "$liraPreviousInstallDir\"
  StrLen $R1 $R0
  StrCpy $R2 $liraDataBackup $R1
  StrCmp $R2 $R0 liraPrepareFailed

  StrCpy $liraDataSource "$liraPreviousInstallDir\data"
  IfFileExists "$liraDataSource\*.*" liraCheckDestination
  StrCpy $liraDataSource "$INSTDIR\data"
  IfFileExists "$liraDataSource\*.*" liraCheckBackup
  StrCpy $liraDataSource "$APPDATA\com.aurorawhisperer.lira\data"
  IfFileExists "$liraDataSource\*.*" liraCheckBackup
  IfFileExists "$liraDataBackup\*.*" liraRecoverBackup
  StrCpy $liraDataBackup ""
  Return

  liraCheckDestination:
    StrCmp $liraPreviousInstallDir $INSTDIR liraCheckBackup
    StrCpy $R5 "新旧安装目录都有数据，已停止安装以避免覆盖。请把诊断报告发给提供安装包的人。"
    IfFileExists "$INSTDIR\data\*.*" liraPrepareFailed

  liraCheckBackup:
    StrCpy $R5 "发现上次安装保留的数据，请勿删除或覆盖。请把诊断报告发给提供安装包的人。"
    IfFileExists "$liraDataBackup" liraPrepareFailed
    IfSilent liraPrepareCopy
    Banner::show /NOUNLOAD "LIRA 正在保留数据，完成后仍存放在安装目录。请稍候。"
    StrCpy $liraDataBanner "1"
  liraPrepareCopy:
    StrCpy $liraDataStage "保留旧版数据"
    StrCpy $liraCopySource "$liraDataSource"
    StrCpy $liraCopyTarget "$liraDataBackup.partial"
    RMDir /r "$liraCopyTarget"
    Call liraCopyData
    StrCmp $R4 "error" liraPrepareCopyFailed
    IntCmp $R4 8 liraPrepareCopyFailed liraPublishBackup liraPrepareCopyFailed
  liraPublishBackup:
    StrCpy $liraDataStage "保存安装前的数据备份"
    ClearErrors
    Rename "$liraCopyTarget" "$liraDataBackup"
    IfErrors liraPrepareCopyFailed
    Call liraCloseDataBanner
    Return
  liraPrepareCopyFailed:
    RMDir /r "$liraCopyTarget"
  liraPrepareFailed:
    Call liraInstallDataFailure
  liraRecoverBackup:
    StrCpy $liraDataSource "$liraDataBackup"
FunctionEnd

Function liraRestoreInstallData
  StrCmp $liraDataBackup "" liraRestoreDone
  StrCpy $liraDataStage "把数据恢复到安装目录"
  StrCpy $R4 "未执行"
  StrCpy $R5 "数据仍保留在备份目录，请勿删除。请把诊断报告发给提供安装包的人。"
  IfFileExists "$INSTDIR\data" liraRestoreExisting
  ClearErrors
  Rename "$liraDataBackup" "$INSTDIR\data"
  IfErrors liraRestoreFailed liraRestoreFinished
  liraRestoreExisting:
    ; New uninstallers keep data. Only restore into the same original directory.
    StrCmp "$liraDataSource" "$INSTDIR\data" 0 liraRestoreFailed
    StrCpy $liraCopySource "$liraDataBackup"
    StrCpy $liraCopyTarget "$INSTDIR\data"
    Call liraCopyData
    StrCmp $R4 "error" liraRestoreFailed
    IntCmp $R4 8 liraRestoreFailed liraRestoreCopied liraRestoreFailed
  liraRestoreCopied:
    ClearErrors
    RMDir /r "$liraDataBackup"
    IfErrors liraRestoreFailed
  liraRestoreFinished:
    StrCpy $liraDataBackup ""
  liraRestoreDone:
    Return
  liraRestoreFailed:
    Call liraInstallDataFailure
FunctionEnd

Function liraCopyData
  Delete "$TEMP\LIRA-install-copy.txt"
  nsExec::ExecToStack '"$SYSDIR\robocopy.exe" "$liraCopySource" "$liraCopyTarget" /E /XJ /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP /UNILOG:"$TEMP\LIRA-install-copy.txt"'
  Pop $R4
  Pop $R5
FunctionEnd

Function liraCloseDataBanner
  StrCmp $liraDataBanner "1" 0 liraBannerClosed
  Banner::destroy
  StrCpy $liraDataBanner ""
  liraBannerClosed:
FunctionEnd

Function liraInstallDataFailure
  Call liraCloseDataBanner
  ClearErrors
  FileOpen $R0 "$TEMP\LIRA-install-error.txt" w
  IfErrors liraReportUnavailable
  FileWriteUTF16LE /BOM $R0 "LIRA ${VERSION} 安装失败报告$\r$\n步骤：$liraDataStage$\r$\n复制工具返回码：$R4$\r$\n旧数据：$liraDataSource$\r$\n目标目录：$INSTDIR\data$\r$\n保留目录：$liraDataBackup$\r$\n$\r$\n详细信息：$\r$\n$R5$\r$\n"
  IfErrors liraReportWriteFailed
  StrCmp $liraCopyTarget "" liraReportClose
  FileOpen $R2 "$TEMP\LIRA-install-copy.txt" r
  IfErrors liraReportClose
  FileSeek $R2 2
  liraReportCopyLine:
    ClearErrors
    FileReadUTF16LE $R2 $R3
    IfErrors liraReportCopyDone
    FileWriteUTF16LE $R0 "$R3"
    IfErrors liraReportCopyFailed
    Goto liraReportCopyLine
  liraReportCopyFailed:
    FileClose $R2
    Goto liraReportWriteFailed
  liraReportCopyDone:
    FileClose $R2
  liraReportClose:
  ClearErrors
  FileClose $R0
  IfErrors liraReportUnavailable
  StrCpy $R1 "详细报告：$TEMP\LIRA-install-error.txt"
  Goto liraReportReady
  liraReportWriteFailed:
    FileClose $R0
  liraReportUnavailable:
    StrCpy $R1 "详细报告未能保存，请拍下整个报错窗口。"
  liraReportReady:
    SetErrorLevel 2
    MessageBox MB_OK|MB_ICONSTOP "LIRA 安装已停止，数据仍保留。$\r$\n$\r$\n步骤：$liraDataStage$\r$\n复制工具返回码：$R4$\r$\n$R1$\r$\n$\r$\n请不要卸载旧版或删除数据、备份目录。$\r$\n请把完整窗口截图和安装诊断报告发给提供安装包的人。" /SD IDOK
    Quit
FunctionEnd
