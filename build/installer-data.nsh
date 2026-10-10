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
  Call liraEnsureAppExited
  StrCmp $R0 0 liraAppExitReady
  Call liraInstallDataFailure
  liraAppExitReady:
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
    SetDetailsPrint textonly
    DetailPrint "正在备份本地数据，请稍候…"
    SetDetailsPrint lastused
    IfSilent liraPrepareCopy
    Banner::show /NOUNLOAD /set 76 "正在更新 LIRA" "正在保留本地数据，请稍候…"
    StrCpy $liraDataBanner "1"
  liraPrepareCopy:
    StrCpy $liraDataStage "保留旧版数据"
    StrCpy $liraCopySource "$liraDataSource"
    StrCpy $liraCopyTarget "$liraDataBackup.partial"
    IfFileExists "$liraCopyTarget\*.*" 0 liraPrepareCopyReady
    Push "$liraCopyTarget"
    Call liraRemoveTree
    IfErrors liraPrepareFailed
  liraPrepareCopyReady:
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
    IfFileExists "$liraCopyTarget\*.*" 0 liraPrepareFailed
    Push "$liraCopyTarget"
    Call liraRemoveTree
  liraPrepareFailed:
    Call liraInstallDataFailure
  liraRecoverBackup:
    StrCpy $liraDataSource "$liraDataBackup"
FunctionEnd

Function liraRestoreInstallData
  StrCmp $liraDataBackup "" liraRestoreDone
  SetDetailsPrint textonly
  DetailPrint "正在恢复本地数据，请稍候…"
  SetDetailsPrint lastused
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
    Push "$liraDataBackup"
    Call liraRemoveTree
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
