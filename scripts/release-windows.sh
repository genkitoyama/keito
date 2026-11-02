#!/usr/bin/env bash
# Build keito for Windows (x64) on this Mac, to hand to others: the installer
# keito_<version>_x64-setup.exe, cross-compiled with cargo-xwin and packed by NSIS, and the in-app
# update made of it (signed with the updater's key and named in the release's latest.json, beside
# the macOS update when that is made too; see scripts/updater.sh).
#
# Once, before the first build:
#   rustup target add x86_64-pc-windows-msvc
#   cargo install --locked cargo-xwin   # it fetches the Windows SDK and CRT on the first build
#   brew install nsis llvm
#
# The installer is not code-signed (Authenticode): Windows SmartScreen warns when it is first
# opened (WindowsによってPCが保護されました → 詳細情報 → 実行). Signing it, once there is a
# certificate, comes before the updater's signature, which is made over the file as it is handed out
# (bundle > windows > signCommand in tauri.conf.json runs a signer for each file the build makes).
#
#   TAURI_SIGNING_PRIVATE_KEY_PATH, TAURI_SIGNING_PRIVATE_KEY_PASSWORD, KEITO_UPDATE_URL: see scripts/updater.sh
set -euo pipefail
cd "$(dirname "$0")/.."

target=x86_64-pc-windows-msvc
# Homebrew keeps its LLVM (clang-cl, llvm-rc, llvm-lib for the C parts) off the PATH.
llvm="$(brew --prefix llvm 2>/dev/null || true)"
[ -n "$llvm" ] && [ -d "$llvm/bin" ] && export PATH="$llvm/bin:$PATH"
missing=()
rustup target list --installed | grep -qx "$target" || missing+=("rustup target add $target")
command -v cargo-xwin >/dev/null || missing+=("cargo install --locked cargo-xwin")
command -v makensis >/dev/null || missing+=("brew install nsis")
command -v clang-cl >/dev/null || missing+=("brew install llvm")
if [ ${#missing[@]} -gt 0 ]; then
  echo "Windows 版のビルドに要るものが足りません。先にこれを実行してください:" >&2
  printf '  %s\n' "${missing[@]}" >&2
  exit 1
fi

. scripts/updater.sh
updater_check

npx tauri build --runner cargo-xwin --target "$target" --bundles nsis

version="$(node -p "require('./src-tauri/tauri.conf.json').version")"
setup="src-tauri/target/$target/release/bundle/nsis/keito_${version}_x64-setup.exe"
if [ ! -f "$setup" ]; then
  echo "インストーラーが見つかりません: $setup" >&2
  exit 1
fi
# The installer is the update too: the app runs it, without asking, in place of the one installed.
updater_add "$setup" "$version" windows-x86_64

echo "できました: $setup"
release_say "$version"
