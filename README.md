# Hydra

An Apple Music desktop client for Linux, a fork of [Sidra](https://github.com/wimpysworld/sidra).

## Install

Download the `.deb` and `SHA256SUMS` from the [releases page](https://github.com/samueldervishii/sidra/releases), then check and install it from the folder you saved them in:

```bash
sha256sum -c SHA256SUMS
sudo apt install ./<file>.deb
```

Only Linux amd64 is built. The package is still called `sidra`, so it upgrades an existing Sidra install, and your sign-in and settings in `~/.config/Sidra` carry over.

## Build from source

You need Node 24 and [just](https://github.com/casey/just). They can live in a local `.tools/` folder, which git ignores, with a `.tools/env.sh` that puts them on your `PATH` for the current terminal:

```bash
# .tools/env.sh
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$ROOT/.tools/node/bin:$ROOT/.tools/bin:$PATH"
export npm_config_cache="$ROOT/.tools/npm-cache"
```

Then:

```bash
source .tools/env.sh
npm ci
just test
just run
```

`just run` uses the same settings folder as an installed copy, so quit the installed app first or the new one exits straight away.

## What this fork adds

- **Performance mode:** removes Apple's heavy blur layers, which make dragging the window lag. On by default; toggle it in Settings.
- **Collapsible sidebar:** shrinks the sidebar to a narrow strip with Back, Home, Search and All Playlists. Use the button at the top of the sidebar, Ctrl+B or Settings.
- **No update checks:** the app never contacts upstream for updates and never replaces itself.

## Credits

Based on Sidra by Martin Wimpress ([wimpysworld](https://github.com/wimpysworld)): <https://github.com/wimpysworld/sidra>.

Licensed under the [Blue Oak Model License 1.0.0](LICENSE) (BlueOak-1.0.0).
