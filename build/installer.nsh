ManifestDPIAware true

!macro customInit
  ; Preserve the install-local data used by older releases before electron-builder
  ; runs their uninstaller. The destination intentionally differs from
  ; $APPDATA\LIRA because the already-installed uninstaller deletes that path.
  IfFileExists "$INSTDIR\data\*.*" 0 persistentDataMigrationDone
  IfFileExists "$APPDATA\com.aurorawhisperer.lira\data\*.*" persistentDataMigrationDone 0
  CreateDirectory "$APPDATA\com.aurorawhisperer.lira"
  RMDir "$APPDATA\com.aurorawhisperer.lira\data"
  RMDir /r "$APPDATA\com.aurorawhisperer.lira\data.migration"
  nsExec::ExecToStack '"$SYSDIR\robocopy.exe" "$INSTDIR\data" "$APPDATA\com.aurorawhisperer.lira\data.migration" /E /XJ /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP'
  Pop $R4
  Pop $R5
  StrCmp $R4 "error" persistentDataMigrationFailed
  IntCmp $R4 8 persistentDataMigrationFailed persistentDataMigrationPublish persistentDataMigrationFailed

  persistentDataMigrationPublish:
    ClearErrors
    Rename "$APPDATA\com.aurorawhisperer.lira\data.migration" "$APPDATA\com.aurorawhisperer.lira\data"
    IfErrors persistentDataMigrationFailed persistentDataMigrationDone

  persistentDataMigrationFailed:
    RMDir /r "$APPDATA\com.aurorawhisperer.lira\data.migration"
    Abort "LIRA 无法把旧版用户数据迁移到永久保存目录。安装已停止，旧数据仍保留在原安装目录。"

  persistentDataMigrationDone:
  ; If the old uninstaller is missing but a registry entry exists, remove the stale
  ; entry so NSIS does not abort with "Failed to uninstall old application files.: 2"
  StrCpy $R1 0
  customInitLoop:
    EnumRegKey $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall" $R1
    StrCmp $R0 "" customInitDone
    ReadRegStr $R2 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R0" "DisplayName"
    StrCmp $R2 "LIRA" customInitFound
    IntOp $R1 $R1 + 1
    Goto customInitLoop
  customInitFound:
    ReadRegStr $R3 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R0" "UninstallString"
    IfFileExists "$R3" customInitDone
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R0"
  customInitDone:
!macroend
