# The in-app update, for the release scripts (sourced from the repository's root): the updater's key
# checked before the build, and each update signed for its version, gathered with the release's
# other files and named in its latest.json (see plugins.updater in tauri.conf.json).
#
# The key is made once, and kept safe (the app accepts no update signed with any other, so losing
# it means users update by hand once):
#   npx tauri signer generate -w ~/.tauri/keito.key
# and its public key (~/.tauri/keito.key.pub) goes in tauri.conf.json.
#
#   TAURI_SIGNING_PRIVATE_KEY_PATH  the updater's key (default: ~/.tauri/keito.key)
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD  its password (asked for when not set)
#   KEITO_UPDATE_URL  where the updates will be downloaded from, their names left out (default:
#                     the GitHub release of the version)

updater_key="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/keito.key}"

# Whether the updater's key is on this machine.
updater_has_key() { [ -f "$updater_key" ]; }

# Make sure the key can sign before the build: it is there, it is the one the app is built to trust,
# and its password is right (tried on a scrap). Stops the script otherwise.
updater_check() {
  if ! updater_has_key; then
    echo "アップデート用の署名鍵が見つかりません: $updater_key" >&2
    echo "  最初に一度だけ作ります: npx tauri signer generate -w ~/.tauri/keito.key" >&2
    echo "  （公開鍵 ~/.tauri/keito.key.pub の中身を src-tauri/tauri.conf.json の plugins.updater.pubkey に入れます）" >&2
    exit 1
  fi
  # The app checks updates against the public key it was built with: one that is not this key's
  # would refuse every update from the next release on.
  if [ "$(tr -d '[:space:]' <"$updater_key.pub" 2>/dev/null)" != "$(node -p "require('./src-tauri/tauri.conf.json').plugins.updater.pubkey")" ]; then
    echo "src-tauri/tauri.conf.json の plugins.updater.pubkey が、署名鍵の公開鍵 $updater_key.pub の中身と違います。" >&2
    exit 1
  fi
  if [ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD+set}" ]; then
    read -rsp "アップデート用の署名鍵のパスワード: " TAURI_SIGNING_PRIVATE_KEY_PASSWORD
    echo
  fi
  local scrap
  scrap="$(mktemp -d)"
  : >"$scrap/scrap"
  if ! updater_sign "$scrap/scrap"; then
    rm -rf "$scrap"
    echo "アップデート用の署名鍵で署名できませんでした（パスワードが違うかもしれません）: $updater_key" >&2
    exit 1
  fi
  rm -rf "$scrap"
}

# Sign a file with the updater's key; the password reaches the signer alone, not `tauri build`.
updater_sign() {
  TAURI_SIGNING_PRIVATE_KEY_PATH="$updater_key" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" npx tauri signer sign "$@" >/dev/null
}

# The folder the files of release $1 are gathered in, to go on its GitHub release.
release_dir() {
  local dir="src-tauri/target/release-files/v$1"
  mkdir -p "$dir"
  echo "$dir"
}

# The update $1 for version $2 on platform $3 (darwin-aarch64, windows-x86_64 …): signed for that
# version, so that the app refuses it announced as any other, put with the release's files, and
# named in its latest.json beside the other systems' updates of the same version.
updater_add() {
  local file="$1" version="$2" platform="$3" dir url
  dir="$(release_dir "$version")"
  updater_sign --app-version "$version" "$file"
  cp "$file" "$dir/"
  url="${KEITO_UPDATE_URL:-https://github.com/genkitoyama/keito/releases/download/v$version}/$(basename "$file")"
  node scripts/latest-json.mjs "$dir/latest.json" "$version" "$platform" "$url" "$(cat "$file.sig")"
}

# Say what goes on the release of version $1, and how.
release_say() {
  local dir
  dir="$(release_dir "$1")"
  echo "GitHub のリリース v$1 に上げるファイル（${dir}）:"
  ls -1 "$dir" | sed 's/^/  /'
  echo "latest.json に入っている OS: $(node -p "Object.keys(require('./$dir/latest.json').platforms).join(', ')")"
  echo "まだリリースがなければ: gh release create v$1 $dir/* --title \"keito $1\" --notes-file <リリースノート>"
  echo "もうあれば（もう一方の OS の分を足すとき）: gh release upload v$1 $dir/* --clobber"
}
