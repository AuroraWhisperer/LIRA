!define MUI_CUSTOMFUNCTION_GUIINIT liraInitInstallerUi

Var liraUiDpi
Var liraUiWidth
Var liraUiHeight
Var liraUiPage
Var liraUiPageWidth
Var liraUiPageHeight
Var liraUiBrandingFont
Var liraUiFinishIcon

; Coordinates are logical pixels; font sizes remain native point sizes.
!macro liraPlaceControl HANDLE X Y WIDTH HEIGHT
  IntOp $R5 ${X} * $liraUiDpi
  IntOp $R5 $R5 / 96
  IntOp $R6 ${Y} * $liraUiDpi
  IntOp $R6 $R6 / 96
  IntOp $R7 ${WIDTH} * $liraUiDpi
  IntOp $R7 $R7 / 96
  IntOp $R8 ${HEIGHT} * $liraUiDpi
  IntOp $R8 $R8 / 96
  System::Call 'user32::SetWindowPos(p ${HANDLE}, p 0, i R5, i R6, i R7, i R8, i 0x14)'
!macroend

!macro liraPlaceItem PARENT ID X Y WIDTH HEIGHT
  GetDlgItem $R0 ${PARENT} ${ID}
  !insertmacro liraPlaceControl $R0 ${X} ${Y} ${WIDTH} ${HEIGHT}
!macroend

!macro customInstallMode
  !ifndef BUILD_UNINSTALLER
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW liraShowInstallMode
  !endif
!macroend

!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW liraShowInstallProgress
!macroend

!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    Function StartApp
      ${If} ${isUpdated}
        StrCpy $1 "--updated"
      ${Else}
        StrCpy $1 ""
      ${EndIf}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION StartApp
  !endif
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW liraShowInstallFinish
  !define MUI_FINISHPAGE_TITLE "安装完成"
  !define MUI_FINISHPAGE_TEXT "LIRA 已安装完成。$\r$\n点击“完成”退出安装向导。"
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro liraInstallerUi
  SetFont "Microsoft YaHei UI" 9

  Function liraInitInstallerUi
    System::Store "S"
    System::Call 'user32::GetDpiForWindow(p $HWNDPARENT) i .r0'
    StrCpy $liraUiDpi $0
    IntOp $1 $0 * 640
    IntOp $1 $1 / 96
    IntOp $2 $0 * 400
    IntOp $2 $2 / 96
    System::Call 'user32::GetWindowRect(p $HWNDPARENT, @r3)'
    System::Call '*$3(i .r4, i .r5, i .r6, i .r7)'
    IntOp $6 $6 + $4
    IntOp $6 $6 - $1
    IntOp $6 $6 / 2
    IntOp $7 $7 + $5
    IntOp $7 $7 - $2
    IntOp $7 $7 / 2
    System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i r6, i r7, i r1, i r2, i 0x14)'
    System::Call 'user32::GetClientRect(p $HWNDPARENT, @r3)'
    System::Call '*$3(i, i, i .r1, i .r2)'
    IntOp $1 $1 * 96
    IntOp $liraUiWidth $1 / $liraUiDpi
    IntOp $2 $2 * 96
    IntOp $liraUiHeight $2 / $liraUiDpi

    IntOp $0 $liraUiWidth - 100
    !insertmacro liraPlaceItem $HWNDPARENT 1034 0 0 $liraUiWidth 66
    !insertmacro liraPlaceItem $HWNDPARENT 1037 24 12 $0 22
    !insertmacro liraPlaceItem $HWNDPARENT 1038 24 37 $0 20
    CreateFont $0 "Microsoft YaHei UI" 10 700
    SendMessage $mui.Header.Text ${WM_SETFONT} $0 0
    System::Call 'gdi32::DeleteObject(p $mui.Header.Text.Font)'
    StrCpy $mui.Header.Text.Font $0
    IntOp $0 $liraUiWidth - 56
    !insertmacro liraPlaceItem $HWNDPARENT 1039 $0 16 32 32
    !insertmacro liraPlaceItem $HWNDPARENT 1036 0 66 $liraUiWidth 1

    IntOp $0 $liraUiWidth - 48
    IntOp $1 $liraUiHeight - 148
    !insertmacro liraPlaceItem $HWNDPARENT 1018 24 84 $0 $1
    IntOp $1 $liraUiHeight - 40
    !insertmacro liraPlaceItem $HWNDPARENT 1044 0 0 $liraUiWidth $1
    !insertmacro liraPlaceItem $HWNDPARENT 1045 0 $1 $liraUiWidth 1
    IntOp $0 $liraUiWidth - 32
    !insertmacro liraPlaceItem $HWNDPARENT 1035 16 $1 $0 1
    IntOp $1 $liraUiHeight - 55
    !insertmacro liraPlaceItem $HWNDPARENT 1028 16 $1 $0 12
    !insertmacro liraPlaceItem $HWNDPARENT 1256 16 $1 $0 12
    CreateFont $liraUiBrandingFont "Microsoft YaHei UI" 8
    SendMessage $mui.Branding.Text ${WM_SETFONT} $liraUiBrandingFont 0
    SendMessage $mui.Branding.Background ${WM_SETFONT} $liraUiBrandingFont 0
    IntOp $1 $liraUiHeight - 32
    IntOp $0 $liraUiWidth - 264
    !insertmacro liraPlaceItem $HWNDPARENT 3 $0 $1 80 24
    IntOp $0 $liraUiWidth - 184
    !insertmacro liraPlaceItem $HWNDPARENT 1 $0 $1 80 24
    IntOp $0 $liraUiWidth - 96
    !insertmacro liraPlaceItem $HWNDPARENT 2 $0 $1 80 24
    System::Store "L"
  FunctionEnd

  Function liraPrepareInstallerPage
    IntOp $liraUiPageWidth $liraUiWidth - 48
    IntOp $liraUiPageHeight $liraUiHeight - 148
    !insertmacro liraPlaceControl $liraUiPage 24 84 $liraUiPageWidth $liraUiPageHeight
  FunctionEnd

  Function liraLayoutAgreement
    System::Store "S"
    StrCpy $liraUiPage $mui.LicensePage
    Call liraPrepareInstallerPage
    IntOp $0 $liraUiPageHeight - 40
    !insertmacro liraPlaceItem $liraUiPage 1034 0 $0 $liraUiPageWidth 18
    IntOp $0 $0 + 22
    !insertmacro liraPlaceItem $liraUiPage 1035 0 $0 $liraUiPageWidth 18
    System::Store "L"
  FunctionEnd

  !ifndef INSTALL_MODE_PER_ALL_USERS
  Function liraShowInstallMode
    System::Store "S"
    StrCpy $liraUiPage $MultiUser.InstallModePage
    Call liraPrepareInstallerPage
    IntOp $0 $liraUiPageWidth - 16
    !insertmacro liraPlaceControl $MultiUser.InstallModePage.Text 0 0 $liraUiPageWidth 36
    !insertmacro liraPlaceControl $MultiUser.InstallModePage.AllUsers 8 52 $0 24
    !insertmacro liraPlaceControl $MultiUser.InstallModePage.CurrentUser 8 84 $0 24
    !insertmacro liraPlaceControl $RadioButtonLabel1 8 124 $0 64
    System::Store "L"
  FunctionEnd
  !endif

  !ifdef MUI_DIRECTORYPAGE
  Function liraShowInstallDirectory
    System::Store "S"
    StrCpy $liraUiPage $mui.DirectoryPage
    Call liraPrepareInstallerPage
    !insertmacro liraPlaceItem $liraUiPage 1006 0 0 $liraUiPageWidth 48
    !insertmacro liraPlaceItem $liraUiPage 1020 0 64 $liraUiPageWidth 60
    IntOp $0 $liraUiPageWidth - 112
    !insertmacro liraPlaceItem $liraUiPage 1019 12 88 $0 24
    IntOp $0 $liraUiPageWidth - 92
    !insertmacro liraPlaceItem $liraUiPage 1001 $0 88 80 24
    !insertmacro liraPlaceItem $liraUiPage 1023 0 142 $liraUiPageWidth 18
    !insertmacro liraPlaceItem $liraUiPage 1024 0 164 $liraUiPageWidth 18
    System::Store "L"
  FunctionEnd
  !endif

  Function liraShowInstallProgress
    System::Store "S"
    StrCpy $liraUiPage $mui.InstFilesPage
    Call liraPrepareInstallerPage
    !insertmacro liraPlaceItem $liraUiPage 1006 0 8 $liraUiPageWidth 20
    !insertmacro liraPlaceItem $liraUiPage 1004 0 42 $liraUiPageWidth 14
    !insertmacro liraPlaceItem $liraUiPage 1027 0 76 84 24
    IntOp $0 $liraUiPageHeight - 110
    !insertmacro liraPlaceItem $liraUiPage 1016 0 110 $liraUiPageWidth $0
    System::Store "L"
  FunctionEnd

  Function liraShowInstallFinish
    System::Store "S"
    IntOp $0 $liraUiHeight - 40
    !insertmacro liraPlaceControl $mui.FinishPage 0 0 $liraUiWidth $0
    ShowWindow $mui.FinishPage.Image ${SW_HIDE}
    ${NSD_CreateIcon} 0 0 0 0 ""
    Pop $liraUiFinishIcon
    SendMessage $mui.Header.Image ${STM_GETICON} 0 0 $0
    SendMessage $liraUiFinishIcon ${STM_SETICON} $0 0
    !insertmacro liraPlaceControl $liraUiFinishIcon 24 30 32 32
    IntOp $0 $liraUiWidth - 112
    !insertmacro liraPlaceControl $mui.FinishPage.Title 84 32 $0 40
    !insertmacro liraPlaceControl $mui.FinishPage.Text 84 94 $0 56
    !ifndef MUI_FINISHPAGE_NOREBOOTSUPPORT
      ${If} ${RebootFlag}
        !insertmacro liraPlaceControl $mui.FinishPage.RebootNow 84 170 $0 22
        !insertmacro liraPlaceControl $mui.FinishPage.RebootLater 84 200 $0 22
      ${EndIf}
    !endif
    !ifdef MUI_FINISHPAGE_RUN_VARIABLES
      !insertmacro liraPlaceControl $mui.FinishPage.Run 84 170 $0 22
    !endif
    System::Store "L"
  FunctionEnd
!macroend
