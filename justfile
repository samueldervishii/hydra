# List available recipes
default:
    @just --list

# Install project dependencies
install:
    npm install
    @just _fix-frameworks
    @just _sign-evs

# Restore macOS framework symlinks that extract-zip breaks during npm install
[macos]
[private]
_fix-frameworks:
    #!/usr/bin/env bash
    set -euo pipefail
    frameworks_dir="node_modules/electron/dist/Electron.app/Contents/Frameworks"
    if [ ! -d "$frameworks_dir" ]; then
        exit 0
    fi
    for fw in "$frameworks_dir"/*.framework; do
        if [ -d "$fw/Versions/A" ] && [ ! -L "$fw/Versions/Current" ]; then
            ln -sf A "$fw/Versions/Current"
            name=$(basename "$fw" .framework)
            if [ -e "$fw/Versions/A/$name" ] && [ ! -L "$fw/$name" ]; then
                ln -sf "Versions/Current/$name" "$fw/$name"
            fi
            if [ -d "$fw/Versions/A/Resources" ] && [ ! -L "$fw/Resources" ]; then
                ln -sf "Versions/Current/Resources" "$fw/Resources"
            fi
            if [ -d "$fw/Versions/A/Libraries" ] && [ ! -L "$fw/Libraries" ]; then
                ln -sf "Versions/Current/Libraries" "$fw/Libraries"
            fi
            if [ -d "$fw/Versions/A/Helpers" ] && [ ! -L "$fw/Helpers" ]; then
                ln -sf "Versions/Current/Helpers" "$fw/Helpers"
            fi
        fi
    done

[linux]
[private]
_fix-frameworks:

# Sign the local Electron binary with CastLabs EVS VMP
[macos]
[private]
_sign-evs:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ ! -d "node_modules/electron/dist/Electron.app" ]; then
        exit 0
    fi
    evs_package=$(node -p "require('./build/evs.cjs').EVS_PACKAGE")
    uvx --from "$evs_package" evs-vmp sign-pkg node_modules/electron/dist

[linux]
[private]
_sign-evs:

# Build TypeScript into dist/
build: _fix-frameworks _sign-evs
    npx tsc

# Run the app (builds first)
run: build
    npx electron .

# Run with debug logging to file
run-debug: build
    ELECTRON_LOG_LEVEL=debug npx electron .

# Run with DevTools open (builds first)
run-devtools: build
    HYDRA_DEVTOOLS=1 npx electron .

# Run with debug logging and DevTools (builds first)
run-inspect: build
    ELECTRON_LOG_LEVEL=debug HYDRA_DEVTOOLS=1 npx electron .

# Run without building (use after initial build for faster iteration)
run-fast:
    npx electron .

# Run with CDP exposed for Playwright attach (builds first)
run-cdp PORT="9222": build
    npx electron . --remote-debugging-port={{PORT}} --remote-debugging-address=127.0.0.1

# Run with CDP, debug logging, and DevTools (builds first)
run-cdp-inspect PORT="9222": build
    ELECTRON_LOG_LEVEL=debug HYDRA_DEVTOOLS=1 npx electron . --remote-debugging-port={{PORT}} --remote-debugging-address=127.0.0.1

# Run with CDP without building (use after initial build for faster iteration)
run-cdp-fast PORT="9222":
    npx electron . --remote-debugging-port={{PORT}} --remote-debugging-address=127.0.0.1

# Watch TypeScript for changes and rebuild
watch:
    npx tsc --watch

# Run static checks; the workflow check is skipped, with a warning, where actionlint is not installed
lint:
    @if command -v actionlint >/dev/null 2>&1; then actionlint; else echo "warning: actionlint not found, skipping the workflow check" >&2; fi
    npx tsc --noEmit
    npx tsc -p tsconfig.test.json --noEmit

# Run tests
test:
    npm test

# npm audit omits devDependencies even when a dependency, such as electron, ships.
# Validate electron-builder configuration and audit runtime dependencies
validate:
    @ELECTRON_SKIP_BINARY_DOWNLOAD=1 node scripts/validate-build-config.cjs
    npm audit --omit=dev

# Generate all app, logo, DMG, tray and menu assets
generate-assets: _generate-branding _generate-dmg-background _generate-menu-icons

# Generate the app icon, logo, splash image and tray icons from assets/branding
[private]
_generate-branding:
    python3 scripts/generate-branding.py

# Generate DMG background PNGs from SVG source
[private]
_generate-dmg-background:
    rsvg-convert -w 540 -h 380 -o build/background.png assets/source/hydra-background.svg
    rsvg-convert -w 1080 -h 760 -o build/background@2x.png assets/source/hydra-background.svg
    optipng -strip all -o7 -quiet build/background.png build/background@2x.png

# Generate tray menu icon PNGs from SVG sources
[private]
_generate-menu-icons:
    #!/usr/bin/env bash
    set -euo pipefail
    src="assets/source/tray-menu"
    out="assets/icons/tray/menu"
    for svg in "$src"/*.svg; do
        name=$(basename "$svg" .svg)
        for variant in light dark; do
            dir="$out/$variant"
            mkdir -p "$dir"
            if [ "$variant" = "dark" ]; then
                sed 's/<svg /<svg fill="#FFFFFF" /' "$svg" \
                    | rsvg-convert -w 64 -h 64 -o "$dir/$name.png"
            else
                rsvg-convert -w 64 -h 64 -o "$dir/$name.png" "$svg"
            fi
            optipng -strip all -o7 -quiet "$dir/$name.png"
        done
    done

# Clean build artefacts
clean:
    rm -rf dist/

# The cache directory is lowercase because src/artwork.ts names it INTERNAL_NAME from src/identity.ts
# Clear all Hydra user data and caches
[macos]
clear:
    rm -rf ~/Library/Application\ Support/Hydra
    rm -rf ~/Library/Caches/hydra
    rm -rf ~/Library/Logs/Hydra
    @echo "Hydra data cleared"

# The cache directory is lowercase because src/artwork.ts names it INTERNAL_NAME from src/identity.ts
# Clear all Hydra user data and caches
[linux]
clear:
    rm -rf ~/.config/Hydra
    rm -rf ~/.cache/hydra
    @echo "Hydra data cleared"

# This recipe makes a fast local package, not a release build. Releases come from
# .github/workflows/release-linux.yml when main changes the version in package.json.
# Build a local development package for Linux or macOS
package: build
    #!/usr/bin/env bash
    set -euo pipefail

    base_version=$(node -p "require('./package.json').version")
    commit_count=$(git rev-list --count HEAD)
    short_hash=$(git rev-parse --short HEAD)
    dev_version="${base_version}-dev.${commit_count}.${short_hash}"

    trap 'npm version "$base_version" --no-git-tag-version --allow-same-version >/dev/null 2>&1' EXIT

    npm version "$dev_version" --no-git-tag-version --allow-same-version
    npx electron-builder {{ if os() == "linux" { "--linux AppImage" } else if os() == "macos" { "--mac dmg --x64 --arm64" } else { error('Unsupported platform') } }}

# Show log file location and tail recent entries
[linux]
logs:
    @echo "Log file: ~/.config/Hydra/logs/main.log"
    @tail -50 ~/.config/Hydra/logs/main.log 2>/dev/null || echo "No log file yet. Run the app first."

# Show log file location and tail recent entries
[macos]
logs:
    @echo "Log file: ~/Library/Logs/Hydra/main.log"
    @tail -50 ~/Library/Logs/Hydra/main.log 2>/dev/null || echo "No log file yet. Run the app first."
