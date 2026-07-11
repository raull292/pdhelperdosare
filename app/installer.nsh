; Police Helper — pași custom la instalare (electron-builder nsis.include)
;
; La orice instalare/update, dacă mai există vechea aplicație
; "Generator Dosare Amenzi", o dezinstalăm silențios (uninstaller-ul ei
; își șterge shortcut-urile și pin-urile). Rulează o singură dată — după
; ce dispare din registry, macro-ul nu mai găsește nimic.

!macro cleanupLegacyApp ROOT
  StrCpy $R1 0
  loop_${ROOT}:
    EnumRegKey $R2 ${ROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall" $R1
    StrCmp $R2 "" done_${ROOT}
    ReadRegStr $R3 ${ROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R2" "DisplayName"
    StrCpy $R4 $R3 23
    StrCmp $R4 "Generator Dosare Amenzi" 0 next_${ROOT}
    ReadRegStr $R5 ${ROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R2" "UninstallString"
    StrCmp $R5 "" next_${ROOT}
    ExecWait '$R5 /S'
    Goto done_${ROOT}
  next_${ROOT}:
    IntOp $R1 $R1 + 1
    Goto loop_${ROOT}
  done_${ROOT}:
!macroend

!macro customInit
  !insertmacro cleanupLegacyApp HKCU
  !insertmacro cleanupLegacyApp HKLM
!macroend
