; Custom NSIS hooks for Overdrive installer.
;
; Problem: When the user runs auto-update, the installer shows
; "Overdrive cannot be closed" because lingering python.exe child processes
; (spawned by the Overdrive Engine worker) hold open handles to files inside the
; install dir, AND/OR the Overdrive.exe parent itself isn't fully gone yet.
;
; Solution: Before any install/uninstall step runs, force-kill anything that
; could be holding files: Overdrive.exe (with /T to take down children) and any
; python.exe whose image path is inside our install directory.
;
; We use PowerShell (guaranteed on Windows 10+) instead of cmd/wmic because
; quoting is far more reliable and wmic was removed/optional on Win11.

!macro overdriveKillRunning
  ; Kill Overdrive.exe and every child process. Both casings to be safe.
  nsExec::Exec 'taskkill /F /T /IM overdrive.exe'
  nsExec::Exec 'taskkill /F /T /IM Overdrive.exe'

  ; Kill any python.exe whose ExecutablePath is inside the install dir.
  ; -ErrorAction SilentlyContinue + try/catch makes a no-match a no-op.
  ; NSIS uses $ for variable expansion, so PowerShell's $_ must be escaped
  ; as $$_ to survive into the spawned command line.
  nsExec::Exec 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Get-CimInstance Win32_Process -Filter \"Name=''python.exe''\" -ErrorAction SilentlyContinue | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith(''$INSTDIR'', [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue } } catch { }"'

  ; Give the OS a moment to release file handles.
  Sleep 500
  ClearErrors
!macroend

!macro customInit
  !insertmacro overdriveKillRunning
!macroend

!macro customInstall
  !insertmacro overdriveKillRunning
!macroend

!macro customUnInit
  !insertmacro overdriveKillRunning
!macroend
