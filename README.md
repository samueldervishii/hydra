<p align="center"><img src="assets/branding/hydra-icon.png" alt="Hydra" width="96" height="96"></p>

# Hydra

An Apple Music desktop client for Linux, a fork of [Sidra](https://github.com/wimpysworld/sidra).

## Install via apt

Add the signing key and the repository once, then install. Updates arrive through `apt upgrade` and the Software Updater like any other package:

```bash
sudo wget -qO /usr/share/keyrings/hydra.gpg https://github.com/samueldervishii/hydra/releases/latest/download/hydra.gpg
gpg --show-keys /usr/share/keyrings/hydra.gpg   # fingerprint 3620 EBD1 BECC 5DA8 21BE  A555 085D 4BC4 8EFD 3C56
echo "deb [signed-by=/usr/share/keyrings/hydra.gpg] https://github.com/samueldervishii/hydra/releases/latest/download/ ./" \
  | sudo tee /etc/apt/sources.list.d/hydra.list
sudo apt update
sudo apt install hydra-music
```

If you have Hydra 2.0.0 or 2.0.1 installed, finish with `sudo apt install hydra-music hydra-` instead, so apt removes the old `hydra` package rather than replacing it with THC-Hydra.

## Install the .deb by hand

Download the `.deb` and `SHA256SUMS` from the [releases page](https://github.com/samueldervishii/hydra/releases), then check and install it from the folder you saved them in:

```bash
sha256sum -c SHA256SUMS
sudo apt install ./<file>.deb
```

Only Linux amd64 is built.

### Upgrading from 2.0.0 or 2.0.1

Those releases were packaged as `hydra`, a name Ubuntu and Debian already use for THC-Hydra, a network security tool, so the Software Updater offers that tool as an "upgrade". From 2.0.2 the package is `hydra-music` and the command `hydra-music`. Install it with `hydra-` at the end, which removes the old package in the same step; without it apt would replace the old package with THC-Hydra instead:

```bash
sudo apt-mark unhold hydra   # only if you held it
sudo apt install ./Hydra-2.0.2-linux-amd64.deb hydra-
```

Your settings and sign-in stay, because the app still uses `~/.config/Hydra`.

### Upgrading from 1.x

Up to 1.1.2-hydra.10 the package was called `sidra`. From 2.0.2 it is `hydra-music`, and installing it removes the `sidra` package for you. Hydra now keeps its data in `~/.config/Hydra`: on the first start it copies your settings across from `~/.config/Sidra`, but not the sign-in, so sign in to Apple Music once more. `~/.config/Sidra` is left as it was; delete it when you no longer need it. Re-pin Hydra in your dock if you had pinned the old entry.

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
- **Top bar:** replaces Apple's sidebar with a slim bar holding Back, Home, Search and All Playlists, once you are signed in. Ctrl+B or Settings switches back to Apple's sidebar for Library, Radio and Pins.
- **Songs-first search:** Ctrl+K or the bar's Search button opens a search that lists songs only, with the artist's own songs first; click one to play it and queue the rest. "All results in Apple Music" opens Apple's full search.
- **No update checks:** the app never contacts upstream for updates and never replaces itself.

## Credits

Based on Sidra by Martin Wimpress ([wimpysworld](https://github.com/wimpysworld)): <https://github.com/wimpysworld/sidra>.

Licensed under the [Blue Oak Model License 1.0.0](LICENSE) (BlueOak-1.0.0).
