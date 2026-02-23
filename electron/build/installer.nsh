!macro customInit
  ; On update, read the previous install location from the registry
  ; so the update installs to the same directory the user originally chose.
  ReadRegStr $0 SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "InstallLocation"
  ${if} $0 != ""
    StrCpy $INSTDIR $0
  ${endif}
!macroend
