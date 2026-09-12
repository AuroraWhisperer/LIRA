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
