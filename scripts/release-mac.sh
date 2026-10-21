#!/usr/bin/env bash
# Build keito for macOS to hand to others: signed with a Developer ID, notarized by Apple and
# stapled, so it opens on another Mac without a Gatekeeper warning.
#
# Once, before the first release, keep the notarization credentials in the keychain:
#   xcrun notarytool store-credentials keito --apple-id <Apple ID> --team-id <team ID>
# (it asks for an app-specific password made at account.apple.com).
#
#   KEITO_NOTARY_PROFILE  keychain profile to notarize with (default: keito)
#   APPLE_SIGNING_IDENTITY  certificate to sign with (default: the first Developer ID Application)
#   KEITO_SKIP_NOTARIZE=1  sign only, for a build that stays on this Mac
set -euo pipefail
cd "$(dirname "$0")/.."

profile="${KEITO_NOTARY_PROFILE:-keito}"
if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
  APPLE_SIGNING_IDENTITY="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -n 1)"
fi
if [ -z "$APPLE_SIGNING_IDENTITY" ]; then
  echo "署名に使う Developer ID Application の証明書がキーチェーンにありません。" >&2
  exit 1
fi
export APPLE_SIGNING_IDENTITY
notarize=1
[ "${KEITO_SKIP_NOTARIZE:-}" = 1 ] && notarize=0
if [ "$notarize" = 1 ] && ! xcrun notarytool history --keychain-profile "$profile" >/dev/null 2>&1; then
  echo "公証用の認証情報（キーチェーンのプロファイル \"$profile\"）が見つかりません。先にこれを一度実行してください:" >&2
  echo "  xcrun notarytool store-credentials $profile --apple-id <Apple ID> --team-id <チーム ID>" >&2
  exit 1
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
echo "できました: $dmg"
