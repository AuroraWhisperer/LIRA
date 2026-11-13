; Runtime data lives beside the executable; keep installation scoped to the current user.
Function liraRequireUserInstall
  ${If} $installMode != "CurrentUser"
    StrCpy $R5 "LIRA 仅支持当前用户安装。旧的全用户安装及数据未改动；请先备份 data，卸载旧版时保留用户数据，再以当前用户模式安装到可写目录。"
  ${Else}
    ; The builder's silent section checks these flags even when CurrentUser is selected.
    StrCpy $hasPerMachineInstallation "0"
    StrCpy $hasPerUserInstallation "1"
    Return
  ${EndIf}
  SetErrorLevel 2
  MessageBox MB_OK|MB_ICONSTOP "$R5" /SD IDOK
  Quit
FunctionEnd

; Retained package directories must not redirect the next archive extraction.
; Inspect every descendant before following it, including unpacked dependencies.
Function liraCheckPackageLinks
  Exch $R1
  Push $R2
  Push $R3
  Push $R4
  StrCpy $R0 0
  System::Call 'kernel32::GetFileAttributesW(w "$R1") i .R4 ?e'
  Pop $R3
  IntCmp $R4 -1 liraPackageAttributesMissing liraPackageAttributesReady liraPackageAttributesReady
  liraPackageAttributesMissing:
    StrCmp $R3 2 liraPackageLinksDone
    StrCmp $R3 3 liraPackageLinksDone liraPackageLinksUnsafe
  liraPackageAttributesReady:
  IntOp $R2 $R4 & 0x400
  StrCmp $R2 0 0 liraPackageLinksUnsafe
  IntOp $R2 $R4 & 0x10
  StrCmp $R2 0 liraPackageLinksDone
  ClearErrors
  FindFirst $R2 $R3 "$R1\*"
  IfErrors liraPackageLinksUnsafe
  liraPackageLinkNext:
    StrCmp $R3 "" liraPackageLinksClosed
    StrCmp $R3 "." liraPackageLinkSkip
    StrCmp $R3 ".." liraPackageLinkSkip
    Push "$R1\$R3"
    Call liraCheckPackageLinks
    StrCmp $R0 0 liraPackageLinkSkip
    FindClose $R2
    Goto liraPackageLinksUnsafe
  liraPackageLinkSkip:
    FindNext $R2 $R3
    Goto liraPackageLinkNext
  liraPackageLinksClosed:
    FindClose $R2
    Goto liraPackageLinksDone
  liraPackageLinksUnsafe:
    StrCpy $R0 1
  liraPackageLinksDone:
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
FunctionEnd

Function liraCheckDirectoryWrite
  StrCpy $R0 0
  IfFileExists "$R1\*.*" liraProbeDirectory
  IfFileExists "$R1" liraDirectoryNotWritable liraDirectoryWriteDone
  liraProbeDirectory:
    ClearErrors
    GetTempFileName $R2 "$R1"
    IfErrors liraDirectoryNotWritable
    Delete "$R2"
    IfErrors liraDirectoryNotWritable liraDirectoryWriteDone
  liraDirectoryNotWritable:
    StrCpy $R0 1
  liraDirectoryWriteDone:
FunctionEnd

Function liraRequireWritableInstallDirectory
  Call liraRequireUserInstall
  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR") i .R0'
  IntCmp $R0 -1 liraInstallDirectoryResolved
  IntOp $R0 $R0 & 0x400
  StrCmp $R0 0 0 liraInstallDirectoryLinked
  liraInstallDirectoryResolved:
  ClearErrors
  CreateDirectory "$INSTDIR"
  IfErrors liraInstallDirectoryDenied
  StrCpy $R1 "$INSTDIR"
  Call liraCheckDirectoryWrite
  StrCmp $R0 0 0 liraInstallDirectoryDenied
  Push "$INSTDIR\resources"
  Call liraCheckPackageLinks
  StrCmp $R0 0 0 liraInstallDirectoryLinked
  Push "$INSTDIR\locales"
  Call liraCheckPackageLinks
  StrCmp $R0 0 0 liraInstallDirectoryLinked
  StrCpy $R1 "$INSTDIR\data"
  Call liraCheckDirectoryWrite
  StrCmp $R0 0 0 liraInstallDirectoryDenied
  StrCpy $R1 "$INSTDIR\logs"
  Call liraCheckDirectoryWrite
  StrCmp $R0 0 0 liraInstallDirectoryDenied
  StrCpy $R1 "$INSTDIR\updates"
  Call liraCheckDirectoryWrite
  StrCmp $R0 0 0 liraInstallDirectoryDenied
  ; A remembered default is not ownership: only the actual registration or our
  ; retained-data marker permits installing into a nonempty directory.
  ReadRegStr $R3 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  StrCmp $R3 "" liraCheckRetainedInstallation
  GetFullPathName $R3 "$R3"
  GetFullPathName $R4 "$INSTDIR"
  StrCmp $R3 $R4 liraInstallDirectoryAccepted
  liraCheckRetainedInstallation:
    ReadINIStr $R3 "$INSTDIR\lira-installation.ini" "installation" "appId"
    StrCmp $R3 "com.aurorawhisperer.lira" liraInstallDirectoryAccepted
    ClearErrors
    FindFirst $R3 $R4 "$INSTDIR\*"
    IfErrors liraInstallDirectoryDenied
    liraCheckInstallEntry:
      StrCmp $R4 "" liraInstallDirectoryEmpty
      StrCmp $R4 "." liraNextInstallEntry
      StrCmp $R4 ".." liraNextInstallEntry
      FindClose $R3
      SetErrorLevel 2
      MessageBox MB_OK|MB_ICONSTOP "安装已停止，所选目录含有无法确认归属的文件。原有文件未改动。$\r$\n请选择一个空文件夹；更新已有 LIRA 时请使用原安装目录。$\r$\n$\r$\n$INSTDIR" /SD IDOK
      Quit
    liraNextInstallEntry:
      FindNext $R3 $R4
      Goto liraCheckInstallEntry
    liraInstallDirectoryEmpty:
      FindClose $R3
  liraInstallDirectoryAccepted:
  Return
  liraInstallDirectoryLinked:
    SetErrorLevel 2
    MessageBox MB_OK|MB_ICONSTOP "安装已停止，旧程序和数据未改动。$\r$\n所选安装目录或其中的 resources、locales 含有链接，或无法安全检查。请使用可访问的普通目录，先备份并移走相关链接后重试。$\r$\n$\r$\n$INSTDIR" /SD IDOK
    Quit
  liraInstallDirectoryDenied:
    SetErrorLevel 2
    MessageBox MB_OK|MB_ICONSTOP "安装已停止，旧程序和数据未改动。$\r$\n当前用户无法检查所选目录，或无法写入目录及其中的 data、logs、updates。请重新运行安装程序并选择当前用户可访问、可写的位置。$\r$\n$\r$\n$INSTDIR" /SD IDOK
    Quit
FunctionEnd
