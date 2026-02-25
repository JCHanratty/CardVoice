; Fix install directory casing.
; oneClick NSIS uses package.json "name" (lowercase "cardvoice") for the
; install directory, but productName is "CardVoice" (PascalCase).
; This causes shortcut target mismatches after updates.
; Force the install directory to use PascalCase "CardVoice".

!macro preInit
  SetRegView 64
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\CardVoice"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\CardVoice"
  SetRegView 32
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\CardVoice"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\CardVoice"
!macroend
