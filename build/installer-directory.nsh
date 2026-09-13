; Keep electron-builder's update-page behavior while setting the local default.
!macroundef skipPageIfUpdated
!macro skipPageIfUpdated
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
