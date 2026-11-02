#!/bin/sh
# Sourced only from Installer's private script directory. No production fixture overrides.
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH
umask 022
fail() { /bin/echo "Unhook: $*" >&2; exit 1; }
app=/Applications/Unhook.app
label=org.unhook.installed-system-helper
helper=/Library/PrivilegedHelperTools/org.unhook.installed-system-helper
job=/Library/LaunchDaemons/org.unhook.installed-system-helper.plist
support='/Library/Application Support/Unhook'
pins="$support/approved-code-hashes"
# ACLs can grant write access even when the POSIX mode appears safe.
protected() {
  [ ! -L "$1" ] || fail "Symbolic link at protected installation path: $1."
  [ -e "$1" ] || fail "Missing protected installation path: $1. Reinstall Unhook."
  metadata=$(/usr/bin/stat -f '%u %Lp %l' "$1") || fail "Cannot inspect $1."
  owner=${metadata%% *}; remainder=${metadata#* }; mode=${remainder%% *}; links=${remainder#* }
  if [ -f "$1" ]; then [ "$links" = 1 ] || fail "Protected installation file has multiple hard links: $1."; fi
  [ "$owner" = 0 ] || fail "Installation path must be owned by root: $1."
  [ $((0$mode & 0022)) -eq 0 ] || fail "Installation path must not be writable by group or other users: $1."
  [ "$(/bin/ls -lde "$1" | /usr/bin/wc -l | /usr/bin/tr -d ' ')" = 1 ] || fail "Remove unexpected ACLs from protected installation path: $1."
}
ancestors() {
  for directory in / /Library '/Library/Application Support'; do protected "$directory"; [ -d "$directory" ] || fail "Expected directory: $directory."; done
  # /Applications may be root:admin 775 on macOS. Nothing there is executed
  # by Installer; approved executable hashes protect replacement clients.
  [ -d /Applications ] && [ ! -L /Applications ] || fail "/Applications must be a regular directory."
  [ "$(/usr/bin/stat -f '%u' /Applications)" = 0 ] || fail "/Applications must be owned by root."
  for directory in /Library/PrivilegedHelperTools /Library/LaunchDaemons "$support"; do
    if [ -e "$directory" ] || [ -L "$directory" ]; then protected "$directory"; [ -d "$directory" ] || fail "Expected directory: $directory."; fi
  done
  for file in "$helper" "$job" "$pins"; do
    if [ -e "$file" ] || [ -L "$file" ]; then protected "$file"; [ -f "$file" ] || fail "Expected regular file: $file."; fi
  done
}
verify_code() {
  code=$1; identifier=$2
  /usr/bin/codesign --verify --deep --strict --all-architectures "$code" || fail "Invalid executable signature: $code."
  binary=$code
  if [ -d "$code" ]; then binary="$code/Contents/MacOS/unhook"; fi
  architectures=$(/usr/bin/lipo -archs "$binary") || fail "Cannot inspect architectures: $code."
  for architecture in $architectures; do
    case "$architecture" in arm64|x86_64) ;; *) fail "Unsupported executable architecture." ;; esac
    display=$(/usr/bin/codesign -d --verbose=4 --arch "$architecture" "$code" 2>&1) || fail "Cannot inspect executable signature."
    /bin/echo "$display" | /usr/bin/awk -v id="$identifier" '
      /^Identifier=/ { if($0=="Identifier="id) identifier=1 }
      /flags=0x[0-9a-f]+\(/ { if($0 ~ /runtime/ && $0 ~ /flags=0x1[0-9a-f][0-9a-f][0-9a-f][0-9a-f]\(/) runtime=1 }
      END {exit !(identifier && runtime)}' || fail "Expected hardened executable identifier: $identifier."
    /usr/bin/codesign -d --entitlements :- --arch "$architecture" "$code" > "$scratch/entitlements.plist" 2>/dev/null || fail "Cannot inspect entitlements."
    if [ -s "$scratch/entitlements.plist" ]; then
      /usr/bin/plutil -lint "$scratch/entitlements.plist" >/dev/null || fail "Invalid executable entitlements."
      for entitlement in com.apple.security.get-task-allow com.apple.security.cs.disable-library-validation com.apple.security.cs.allow-dyld-environment-variables com.apple.security.cs.allow-jit com.apple.security.cs.allow-unsigned-executable-memory com.apple.security.cs.disable-executable-page-protection; do
        value=$(/usr/libexec/PlistBuddy -c "Print :$entitlement" "$scratch/entitlements.plist" 2>/dev/null || :)
        [ "$value" != true ] || fail "Unsafe executable entitlement: $entitlement."
      done
    fi
    /bin/echo "$display" | /usr/bin/awk -F= '/^CDHash=[0-9a-f]+$/ && length($2)==40 { print $2; found=1 } END {exit !found}' >> "$scratch/hashes" || fail "Missing executable code hash."
  done
}
