; =========================================================================
; GatilhoBR - Custom NSIS Script Include
; =========================================================================

!macro customInstall
  DetailPrint "Registrando integração de navegadores e Native Messaging no GatilhoBR..."
  nsExec::ExecToLog 'powershell.exe -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File "$INSTDIR\resources\installer\register-integration.ps1" -InstallRoot "$INSTDIR"'
!macroend

!macro customUnInstall
  DetailPrint "Removendo integração de navegadores do GatilhoBR..."
  Delete "$LOCALAPPDATA\GatilhoBR\pending_onboarding.flag"
  nsExec::ExecToLog 'powershell.exe -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File "$INSTDIR\resources\installer\register-integration.ps1" -InstallRoot "$INSTDIR" -Uninstall'
!macroend

; Launch parameter / flag pós-instalação: --onboarding=install
