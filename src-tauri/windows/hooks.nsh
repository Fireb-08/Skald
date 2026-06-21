; Skald NSIS installer hooks.
;
; Builds the LibVLC plugin cache (plugins.dat) on the *target* machine, right
; after the installer finishes copying files into $INSTDIR.
;
; Why at install time and not at build time:
;   VLC's plugins.dat embeds, for every plugin, its absolute path plus the file's
;   size and mtime. Both only become final once NSIS has extracted the plugin
;   DLLs into their permanent install location. A cache generated on the build
;   machine is rejected by libvlc on the user's machine (path/mtime mismatch),
;   which forces a full rescan of all ~135 plugin DLLs on the first play — the
;   multi-second "first launch" startup delay this hook eliminates.
;
; vlc-cache-gen.exe requirements (verified against VLC 3.0.23):
;   * libvlccore.dll must sit in the generator's own directory. It does:
;     the resource mapping places vlc-cache-gen.exe and libvlccore.dll both
;     directly in $INSTDIR, and Windows searches the executable's directory.
;   * the plugins path argument MUST be absolute. A relative path silently
;     produces an empty 0-module cache (exit code 0, ~24-byte file). $INSTDIR
;     is always absolute, so "$INSTDIR\plugins" is correct.

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Generating LibVLC plugin cache..."
  ; Run from $INSTDIR so libvlccore.dll resolves from the executable directory.
  SetOutPath "$INSTDIR"
  nsExec::ExecToLog '"$INSTDIR\vlc-cache-gen.exe" "$INSTDIR\plugins"'
  Pop $0
  DetailPrint "vlc-cache-gen finished (exit code $0)."
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; plugins.dat is generated after install, so it is not in the tracked file
  ; list the uninstaller deletes. Remove it explicitly to avoid an orphan that
  ; would keep the plugins\ directory from being pruned.
  Delete "$INSTDIR\plugins\plugins.dat"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Per-user state lives OUTSIDE $INSTDIR, so the normal uninstaller (which only
  ; removes tracked install files) leaves it behind — which is why a reinstall used
  ; to show old libraries and skip onboarding. Clean it up here.
  ;
  ;   $LOCALAPPDATA\Skald         — Rust ProjectDirs("com","","Skald") data/cache root:
  ;                                 catalog.db, eq.json, paths.json, cover cache,
  ;                                 library/chapter caches, and the (default-location)
  ;                                 offline downloads.
  ;   $LOCALAPPDATA\com.skald.app — the WebView2 profile (localStorage: the
  ;                                 skald.onboarded flag, auth token, all prefs).
  ;                                 Keep this in sync with tauri.conf.json `identifier`.
  ;
  ; CRITICAL: skip entirely during a SILENT uninstall. Tauri runs this same
  ; uninstaller silently as the first step of an app UPDATE; wiping the user's
  ; library/downloads/settings on every update would be catastrophic. A real
  ; uninstall from Add/Remove Programs is interactive, so IfSilent cleanly
  ; distinguishes the two.
  ;
  ; Note: a downloads folder the user RELOCATED (Settings → Downloads) lives at a
  ; user-chosen path we don't track here and is intentionally left untouched, as is
  ; any local-library audio (which lives in the user's own folders, never appdata).
  IfSilent skald_userdata_done
    MessageBox MB_YESNO|MB_ICONQUESTION "Also remove your Skald library data, downloads, and settings?$\n$\nYour audiobook files stored in their own folders are NOT affected." /SD IDNO IDNO skald_userdata_done
      RMDir /r "$LOCALAPPDATA\Skald"
      RMDir /r "$LOCALAPPDATA\com.skald.app"
  skald_userdata_done:
!macroend
