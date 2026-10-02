#!/usr/bin/env bash
# Turn a folder holding the hydra-music .deb into a flat apt repository:
# writes Packages, Packages.gz, Release, InRelease and Release.gpg beside it.
#
# Usage: scripts/build-apt-repo.sh <folder> <key fingerprint> <public keyring>
#
# The signing key must already be in $GNUPGHOME without a passphrase. The
# public keyring is the one users install (packaging/hydra.gpg); both
# signatures are checked against it, so a release signed by any other key
# fails here rather than on every user's apt update.
#
# Each GitHub release carries these files beside its .deb, and users point apt
# at releases/latest/download/, so Filename in Packages must stay relative to
# that folder (./Hydra-<version>-linux-amd64.deb).
set -euo pipefail

if [ $# -ne 3 ]; then
  echo "usage: $0 <folder> <key fingerprint> <public keyring>" >&2
  exit 2
fi
dir=$1
key=$2
keyring=$(realpath "$3")

cd "$dir"
shopt -s nullglob
debs=(*.deb)
if (( ${#debs[@]} != 1 )); then
  echo "error: expected one .deb in $dir, found ${#debs[@]}" >&2
  exit 1
fi
rm -f Packages Packages.gz Release InRelease Release.gpg

apt-ftparchive packages . > Packages
gzip -9 -n -k Packages

# Written outside the folder first, so Release never hashes a stale copy of
# itself.
release=$(mktemp)
apt-ftparchive \
  -o APT::FTPArchive::Release::Origin=Hydra \
  -o APT::FTPArchive::Release::Label=Hydra \
  -o APT::FTPArchive::Release::Architectures=amd64 \
  -o "APT::FTPArchive::Release::Description=Hydra, an Apple Music desktop client" \
  release . > "$release"
mv "$release" Release
chmod 644 Release

gpg --batch --yes --local-user "$key" --digest-algo SHA512 \
  --clearsign --output InRelease Release
gpg --batch --yes --local-user "$key" --digest-algo SHA512 \
  --armor --detach-sign --output Release.gpg Release

gpgv --keyring "$keyring" InRelease
gpgv --keyring "$keyring" Release.gpg Release
echo "apt repository ready in $(pwd): ${debs[0]}, Packages, Packages.gz, Release, InRelease, Release.gpg"
