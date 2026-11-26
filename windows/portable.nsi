Unicode true
Name "Исследование операций"
OutFile "${OUTPUT}"
SetCompressor /SOLID lzma
SetCompressorDictSize 16
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true

VIProductVersion "3.0.0.0"
VIAddVersionKey "ProductName" "Исследование операций"
VIAddVersionKey "FileDescription" "Исследование операций"
VIAddVersionKey "FileVersion" "3.0.0"
VIAddVersionKey "ProductVersion" "3.0.0"
VIAddVersionKey "LegalCopyright" "Operations Lab and included open source components"

Section
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\OperationsLab"
  ClearErrors
  File /r /x operations-profile "${INPUT_FILES}"
  IfErrors failed
  ExecWait '"$PLUGINSDIR\OperationsLab\OperationsLab.exe"' $0
  IfErrors failed
  SetErrorLevel $0
  Goto done
  failed:
    MessageBox MB_ICONSTOP "Не удалось запустить лабораторную работу. Проверьте свободное место на диске и что у вас 64-разрядная Windows 10 или 11."
    SetErrorLevel 1
  done:
    SetOutPath "$TEMP"
SectionEnd
