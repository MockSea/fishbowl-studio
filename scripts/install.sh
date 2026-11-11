#!/bin/sh
# Installs the standalone Fishbowl Studio for macOS or Linux and starts it.
#
#   curl -fsSL https://raw.githubusercontent.com/MockSea/fishbowl-studio/main/scripts/install.sh | sh
#
# Downloads the latest release's executable for this computer and SHA256SUMS, refuses to install
# if the checksum doesn't match, puts it in ~/.local/bin (or $FISHBOWL_BIN_DIR) and runs it.
# Set FISHBOWL_VERSION=v1.2.3 for a particular release, FISHBOWL_NO_START=1 to only install.
set -eu

repo="MockSea/fishbowl-studio"
case "$(uname -s)" in
  Darwin) os=macos ;;
  Linux) os=linux ;;
  *) echo "This installer is for macOS and Linux. On Windows use scripts/install.ps1." >&2; exit 1 ;;
esac
case "$(uname -m)" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64) arch=x64 ;;
  *) echo "There's no standalone build for $(uname -m). Use the npx command from the README instead (needs Node 20 or newer): https://github.com/$repo" >&2; exit 1 ;;
esac
asset="fishbowl-studio-$os-$arch"
if [ "$os" = linux ] && [ "$arch" = arm64 ]; then
  echo "There's no standalone build for Linux on ARM yet. Use the npx command from the README instead (needs Node 20 or newer): https://github.com/$repo" >&2
  exit 1
fi

if [ -n "${FISHBOWL_VERSION:-}" ]; then base="https://github.com/$repo/releases/download/$FISHBOWL_VERSION"
else base="https://github.com/$repo/releases/latest/download"; fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
echo "Downloading $asset..."
curl -fL --proto '=https' --progress-bar -o "$tmp/$asset" "$base/$asset"
curl -fsSL --proto '=https' -o "$tmp/SHA256SUMS" "$base/SHA256SUMS"

want=$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1 }' "$tmp/SHA256SUMS")
if command -v sha256sum >/dev/null 2>&1; then got=$(sha256sum "$tmp/$asset" | awk '{ print $1 }')
else got=$(shasum -a 256 "$tmp/$asset" | awk '{ print $1 }'); fi
if [ -z "$want" ] || [ "$want" != "$got" ]; then
  echo "The download doesn't match its checksum in SHA256SUMS, so it wasn't installed." >&2
  exit 1
fi
echo "Checksum matches."

dir="${FISHBOWL_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$dir"
mv "$tmp/$asset" "$dir/fishbowl-studio"
chmod 755 "$dir/fishbowl-studio"
echo "Installed $dir/fishbowl-studio"
case ":$PATH:" in
  *":$dir:"*) ;;
  *) echo "$dir isn't on your PATH; start it later with: $dir/fishbowl-studio" ;;
esac

[ -n "${FISHBOWL_NO_START:-}" ] && exit 0
exec "$dir/fishbowl-studio"
