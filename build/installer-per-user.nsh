; Runtime data lives beside the executable, so the install must work without elevation.
Function liraRequireUserInstall
  ${If} ${UAC_IsAdmin}
    StrCpy $R5 "请关闭安装程序后直接双击运行，不要选择“以管理员身份运行”。LIRA 需要以当前用户权限保存安装目录中的数据。"
  ${ElseIf} $installMode != "CurrentUser"
    StrCpy $R5 "LIRA 仅支持当前用户安装。旧的全用户安装及数据未改动；请先备份 data，卸载旧版时保留用户数据，再以普通权限安装到可写目录。"
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
  ClearErrors
  CreateDirectory "$INSTDIR"
  IfErrors liraInstallDirectoryDenied
  StrCpy $R1 "$INSTDIR"
  Call liraCheckDirectoryWrite
  StrCmp $R0 0 0 liraInstallDirectoryDenied
  StrCpy $R1 "$INSTDIR\data"
  Call liraCheckDirectoryWrite
  StrCmp $R0 0 0 liraInstallDirectoryDenied
  StrCpy $R1 "$INSTDIR\logs"
  Call liraCheckDirectoryWrite
  StrCmp $R0 0 0 liraInstallDirectoryDenied
  StrCpy $R1 "$INSTDIR\updates"
  Call liraCheckDirectoryWrite
  StrCmp $R0 0 0 liraInstallDirectoryDenied
  Return
  liraInstallDirectoryDenied:
    SetErrorLevel 2
    MessageBox MB_OK|MB_ICONSTOP "安装已停止，旧程序和数据未改动。$\r$\n当前用户无法写入所选目录或其中的 data、logs、updates。请重新运行安装程序并选择当前用户可写的位置。$\r$\n$\r$\n$INSTDIR" /SD IDOK
    Quit
FunctionEnd
