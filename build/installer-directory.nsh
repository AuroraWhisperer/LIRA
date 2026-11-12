; Keep electron-builder's update-page behavior while setting the local default.
!macroundef skipPageIfUpdated
!macro skipPageIfUpdated
  !ifdef LIRA_AGREEMENT_PAGE_DEFINED
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW liraShowInstallDirectory
    !define MUI_DIRECTORYPAGE_TEXT_TOP "点击“浏览”可以更换安装位置，确认后点击“安装”。"
  !endif
  !define UniqueID ${__LINE__}
  Function skipPageIfUpdated_${UniqueID}
    Call liraSelectDefaultDirectory
    ${If} ${isUpdated}
      Abort
    ${EndIf}
  FunctionEnd
  !define MUI_PAGE_CUSTOMFUNCTION_PRE skipPageIfUpdated_${UniqueID}
  !undef UniqueID
!macroend
