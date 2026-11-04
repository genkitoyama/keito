#!/usr/bin/env bash
# Build keito for macOS to hand to others: signed with a Developer ID, notarized by Apple and
# stapled, so it opens on another Mac without a Gatekeeper warning.
#
# Once, before the first release, keep the notarization credentials in the keychain:
#   xcrun notarytool store-credentials keito --apple-id <Apple ID> --team-id <team ID>
# (it asks for an app-specific password made at account.apple.com).
#
#   KEITO_NOTARY_PROFILE  keychain profile to notarize with (default: keito)
#   KEITO_SIGNING_TEAM  team ID whose Developer ID Application certificate signs (needed when the
#                       keychain holds more than one)
#   APPLE_SIGNING_IDENTITY  the certificate's full name, in place of KEITO_SIGNING_TEAM
#   KEITO_SKIP_NOTARIZE=1  sign only, for a build that stays on this Mac
#
# It also makes the update the app fetches for itself (see plugins.updater in tauri.conf.json):
# the stapled app packed as .app.tar.gz and signed with the updater's key, and latest.json naming
# it. Both go on the GitHub release beside the .dmg. The key is made once, and kept safe (the app
# accepts no update signed with any other, so losing it means users update by hand once):
#   npx tauri signer generate -w ~/.tauri/keito.key
# and its public key (~/.tauri/keito.key.pub) goes in tauri.conf.json.
#
#   TAURI_SIGNING_PRIVATE_KEY_PATH  the updater's key (default: ~/.tauri/keito.key)
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD  its password (asked for when not set)
#   KEITO_UPDATE_URL  where the .app.tar.gz will be downloaded from, its name left out (default:
#                     the GitHub release of this version)
set -euo pipefail
cd "$(dirname "$0")/.."

profile="${KEITO_NOTARY_PROFILE:-keito}"
if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
  ids="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | sort -u)"
  [ -n "${KEITO_SIGNING_TEAM:-}" ] && ids="$(printf '%s\n' "$ids" | grep -F "(${KEITO_SIGNING_TEAM})" || true)"
  if [ -z "$ids" ]; then
    echo "署名に使う Developer ID Application の証明書がキーチェーンにありません${KEITO_SIGNING_TEAM:+（チーム ${KEITO_SIGNING_TEAM}）}。" >&2
    exit 1
  fi
  # Never pick one of several by chance: the team that signs is the one users see.
  if [ "$(printf '%s\n' "$ids" | wc -l)" -gt 1 ]; then
    echo "Developer ID Application の証明書が複数あります。KEITO_SIGNING_TEAM=<チーム ID> で選んでください:" >&2
    printf '  %s\n' "$ids" >&2
    exit 1
  fi
  APPLE_SIGNING_IDENTITY="$ids"
fi
export APPLE_SIGNING_IDENTITY
notarize=1
[ "${KEITO_SKIP_NOTARIZE:-}" = 1 ] && notarize=0
if [ "$notarize" = 1 ] && ! xcrun notarytool history --keychain-profile "$profile" >/dev/null 2>&1; then
  echo "公証用の認証情報（キーチェーンのプロファイル \"$profile\"）が見つかりません。先にこれを一度実行してください:" >&2
  echo "  xcrun notarytool store-credentials $profile --apple-id <Apple ID> --team-id <チーム ID>" >&2
  exit 1
fi

# The updater's key, tried on a scrap now: a missing key or a wrong password stops it here, not
# after the build and the wait for notarization. A build that stays on this Mac does without it.
key="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/keito.key}"
updates=1
if [ ! -f "$key" ]; then
  if [ "$notarize" = 1 ]; then
    echo "アップデート用の署名鍵が見つかりません: $key" >&2
    echo "  最初に一度だけ作ります: npx tauri signer generate -w ~/.tauri/keito.key" >&2
    echo "  （公開鍵 ~/.tauri/keito.key.pub の中身を src-tauri/tauri.conf.json の plugins.updater.pubkey に入れます）" >&2
    exit 1
  fi
  updates=0
fi
if [ "$updates" = 1 ]; then
  if [ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD+set}" ]; then
    read -rsp "アップデート用の署名鍵のパスワード: " TAURI_SIGNING_PRIVATE_KEY_PASSWORD
    echo
  fi
  # The app checks updates against the public key it was built with: one that is not this key's
  # would refuse every update from the next release on.
  if [ "$(tr -d '[:space:]' <"$key.pub" 2>/dev/null)" != "$(node -p "require('./src-tauri/tauri.conf.json').plugins.updater.pubkey")" ]; then
    echo "src-tauri/tauri.conf.json の plugins.updater.pubkey が、署名鍵の公開鍵 $key.pub の中身と違います。" >&2
    exit 1
  fi
  # The password reaches the signer alone, not `tauri build`.
  sign_update() { TAURI_SIGNING_PRIVATE_KEY_PATH="$key" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" npx tauri signer sign "$@" >/dev/null; }
  scrap="$(mktemp -d)"
  trap 'rm -rf "$scrap"' EXIT
  : >"$scrap/scrap"
  if ! sign_update "$scrap/scrap"; then
    echo "アップデート用の署名鍵で署名できませんでした（パスワードが違うかもしれません）: $key" >&2
    exit 1
  fi
fi

echo "署名: $APPLE_SIGNING_IDENTITY"
npx tauri build --bundles app,dmg

bundle=src-tauri/target/release/bundle
app="$(ls -d "$bundle"/macos/*.app | head -n 1)"
dmg="$(ls -t "$bundle"/dmg/*.dmg | head -n 1)"
codesign --verify --deep --strict "$app"

if [ "$notarize" = 1 ]; then
  echo "公証に出しています（数分かかります）: $dmg"
  xcrun notarytool submit "$dmg" --keychain-profile "$profile" --wait
  # The ticket goes with the disk image, and with the app for when it is copied out of it.
  xcrun stapler staple "$dmg"
  xcrun stapler staple "$app"
  spctl --assess --type open --context context:primary-signature -v "$dmg"
  spctl --assess --type execute -v "$app"
fi

if [ "$updates" = 0 ]; then
  echo "できました: $dmg"
  echo "（アップデート用の署名鍵がないので、アプリのアップデート用のファイルは作っていません）"
  exit 0
fi
# The update: the app as stapled, packed with nothing of this Mac's own (extended attributes and
# AppleDouble files would land inside the bundle and break its signature), then signed for this
# version, so that the app refuses it announced as any other.
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")"
case "$(uname -m)" in
  arm64) arch=aarch64 ;;
  *) arch="$(uname -m)" ;;
esac
tarball="$bundle/macos/keito_${version}_${arch}.app.tar.gz"
COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata -czf "$tarball" -C "$(dirname "$app")" "$(basename "$app")"
sign_update --app-version "$version" "$tarball"
latest="$bundle/latest.json"
url="${KEITO_UPDATE_URL:-https://github.com/genkitoyama/keito/releases/download/v$version}/$(basename "$tarball")"
node -e '
  const [version, platform, url, signature] = process.argv.slice(1);
  const latest = { version, pub_date: new Date().toISOString(), platforms: { [platform]: { url, signature } } };
  process.stdout.write(JSON.stringify(latest, null, 2) + "\n");
' "$version" "darwin-$arch" "$url" "$(cat "$tarball.sig")" >"$latest"

echo "できました。GitHub のリリース v$version に、次の 3 つを上げます:"
echo "  $dmg"
echo "  $tarball"
echo "  $latest"
echo "例: gh release create v$version \"$dmg\" \"$tarball\" \"$latest\" --title \"keito $version\" --notes-file <リリースノート>"
