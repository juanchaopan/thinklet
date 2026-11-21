#!/usr/bin/env bash
# Runs the web component tests inside the pinned Playwright image, where the
# screenshot baselines are made and compared (`task test-component`). The
# repository is mounted at /repo; every node_modules directory in it is
# covered by a Docker volume, so the Linux packages installed here never mix
# with the host's. /cache keeps the pnpm and, when needed, Node.js downloads
# between runs.
set -euo pipefail

cd /repo

node_version="v$(tr -d '[:space:]' < .node-version)"
if [ "$(node --version)" != "$node_version" ]; then
  case "$(uname -m)" in
    x86_64) node_arch=x64 ;;
    aarch64) node_arch=arm64 ;;
    *) echo "Unsupported architecture $(uname -m)" >&2; exit 1 ;;
  esac
  node_dir="/cache/node-$node_version-linux-$node_arch"
  if [ ! -x "$node_dir/bin/node" ]; then
    archive="node-$node_version-linux-$node_arch.tar.xz"
    download="$(mktemp -d)"
    curl --fail --silent --show-error --location --output "$download/$archive" \
      "https://nodejs.org/dist/$node_version/$archive"
    curl --fail --silent --show-error --location --output "$download/SHASUMS256.txt" \
      "https://nodejs.org/dist/$node_version/SHASUMS256.txt"
    (cd "$download" && grep " $archive\$" SHASUMS256.txt | sha256sum --check --status)
    mkdir -p "$node_dir"
    tar --extract --xz --file "$download/$archive" --directory "$node_dir" --strip-components=1
    rm -rf "$download"
  fi
  export PATH="$node_dir/bin:$PATH"
fi

pnpm_version="$(node --print "require('./package.json').packageManager.split('@')[1]")"
pnpm_dir="/cache/pnpm-$pnpm_version"
if [ ! -x "$pnpm_dir/bin/pnpm" ]; then
  npm install --global --silent --prefix "$pnpm_dir" "pnpm@$pnpm_version"
fi
export PATH="$pnpm_dir/bin:$PATH"

# The store sits on the same volume as the root node_modules so pnpm can
# hard-link packages instead of copying them.
pnpm install --frozen-lockfile --reporter=append-only --store-dir /repo/node_modules/.pnpm-store

# The web app imports the contracts package from its build.
pnpm --filter @thinklet/contracts run build

pnpm --filter web run test:component
