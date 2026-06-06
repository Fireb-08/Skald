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
