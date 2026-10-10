Var liraPreviousInstallDir

!ifdef BUILD_UNINSTALLER
  !define LIRA_PROCESS_PREFIX "un."
  !define LIRA_PROCESS_ACTION "卸载"
!else
  !define LIRA_PROCESS_PREFIX ""
  !define LIRA_PROCESS_ACTION "安装"
!endif

; Returns 0 only after the selected installations have no remaining processes.
; Errors return their Windows code in R0 and a reportable explanation in R5.
Function ${LIRA_PROCESS_PREFIX}liraEnsureAppExited
  StrCpy $R3 0
  System::Call 'kernel32::GetTickCount() i.R2'
  liraFindRunningApp:
    Call ${LIRA_PROCESS_PREFIX}liraFindAppProcess
    StrCmp $R0 603 liraAppExited
    StrCpy $R5 "LIRA 进程仍未退出，可能是启动失败后残留在后台。请保存未完成的操作，在任务管理器中结束此安装目录的 LIRA，或重启电脑后重试。目录：$liraPreviousInstallDir；$INSTDIR。"
    StrCmp $R0 0 liraAppStillRunning
    StrCpy $R5 "无法确认 LIRA 是否退出，进程检查返回码：$R0。"
    Return
  liraAppStillRunning:
    ; Silent updates must let Electron finish its own cleanup.
    IfSilent liraWaitForExitPoll
    StrCmp $R3 0 0 liraWaitForExitPoll
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "LIRA 正在运行。将自动关闭此安装目录的 LIRA，然后继续${LIRA_PROCESS_ACTION}。$\r$\n$\r$\n播放和直播互动将暂时中断。点击“确定”继续，或点击“取消”稍后处理。" /SD IDCANCEL IDOK liraCloseRunningApp
  liraCancelInstall:
    SetErrorLevel 2
    Quit
  liraCloseRunningApp:
    Call ${LIRA_PROCESS_PREFIX}liraRequestAppExit
    System::Call 'kernel32::GetTickCount() i.R2'
  liraWaitForExitPoll:
    StrCpy $R3 1
    System::Call 'kernel32::GetTickCount() i.R1'
    IntOp $R1 $R1 - $R2
    IntCmpU $R1 10000 liraAppExitTimeout 0 liraAppExitTimeout
    Sleep 250
    Goto liraFindRunningApp
  liraAppExitTimeout:
    IfSilent liraAppExitFailed
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "LIRA 进程仍未退出，可能是启动失败后残留在后台。$\r$\n$\r$\n请保存未完成的操作，在任务管理器中结束此安装目录的 LIRA，或重启电脑后重试。处理后点击“重试”，或点击“取消”稍后处理。$\r$\n$\r$\n目录：$liraPreviousInstallDir；$INSTDIR$\r$\n尚未继续处理数据。" /SD IDCANCEL IDRETRY liraCloseRunningApp
    Goto liraCancelInstall
  liraAppExitFailed:
    StrCpy $R0 258
    Return
  liraAppExited:
    StrCpy $R0 0
FunctionEnd

; NSIS is a 32-bit Unicode process; PROCESSENTRY32W has 556 bytes here.
; QueryFullProcessImageNameW also resolves 64-bit Electron processes.
Function ${LIRA_PROCESS_PREFIX}liraFindAppProcess
  ; Avoid enumerating the whole process table when no matching name exists.
  nsProcess::_FindProcess /NOUNLOAD "${APP_EXECUTABLE_FILENAME}"
  Pop $R0
  nsProcess::_Unload
  StrCmp $R0 0 0 liraProcessAbsent
  System::Store "s"
  GetFullPathName $5 "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  StrCpy $6 ""
  StrCmp $liraPreviousInstallDir "" +2
    GetFullPathName $6 "$liraPreviousInstallDir\${APP_EXECUTABLE_FILENAME}"
  System::Call 'kernel32::GetCurrentProcessId() i.r9'
  System::Call 'kernel32::CreateToolhelp32Snapshot(i 2, i 0) p.r0 ?e'
  Pop $R0
  StrCmp $0 -1 liraProcessCheckDone
  System::Alloc 556
  Pop $1
  StrCmp $1 0 liraProcessAllocationFailed
  System::Call '*$1(i 556)'
  System::Call 'kernel32::Process32FirstW(p r0, p r1) i.r2 ?e'
  Pop $R0
  liraProcessEntry:
    StrCmp $2 0 liraProcessEnumerationEnded
    System::Call '*$1(i, i, i.r3, p, i, i, i, i, i, &w260.r4)'
    StrCmp $3 $9 liraProcessNext
    StrCmp $4 "${APP_EXECUTABLE_FILENAME}" 0 liraProcessNext
    System::Call 'kernel32::OpenProcess(i 0x1000, i 0, i r3) p.r7 ?e'
    Pop $R0
    StrCmp $7 0 liraProcessOpenFailed
    System::Call 'kernel32::QueryFullProcessImageNameW(p r7, i 0, w.r4, *i ${NSIS_MAX_STRLEN}) i.r8 ?e'
    Pop $R0
    StrCmp $8 0 liraProcessQueryFailed
    System::Call 'kernel32::CloseHandle(p r7)'
    StrCmp $4 $5 liraProcessFound
    StrCmp $4 $6 liraProcessFound
  liraProcessNext:
    System::Call 'kernel32::Process32NextW(p r0, p r1) i.r2 ?e'
    Pop $R0
    Goto liraProcessEntry
  liraProcessOpenFailed:
    ; A process may exit after the snapshot. Other failures are not proof of exit.
    StrCmp $R0 87 liraProcessNext liraProcessFreeEntry
  liraProcessQueryFailed:
    System::Call 'kernel32::GetExitCodeProcess(p r7, *i.r8) i.r2'
    System::Call 'kernel32::CloseHandle(p r7)'
    StrCmp $2 0 liraProcessFreeEntry
    StrCmp $8 259 liraProcessFreeEntry liraProcessNext
  liraProcessEnumerationEnded:
    StrCmp $R0 18 0 liraProcessFreeEntry
    StrCpy $R0 603
    Goto liraProcessFreeEntry
  liraProcessFound:
    StrCpy $R0 0
  liraProcessFreeEntry:
    System::Free $1
    Goto liraProcessCloseSnapshot
  liraProcessAllocationFailed:
    StrCpy $R0 8
  liraProcessCloseSnapshot:
    System::Call 'kernel32::CloseHandle(p r0)'
  liraProcessCheckDone:
    Push $R0
    System::Store "l"
    Pop $R0
  liraProcessAbsent:
FunctionEnd

Function ${LIRA_PROCESS_PREFIX}liraRequestAppExit
  ; Ask every owned window to close normally; never force termination.
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
