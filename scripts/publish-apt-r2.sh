#!/usr/bin/env bash
# Publish a Hydra release to the apt repository on Cloudflare R2, served at
# https://apt.six9.uk: a pool of the last KEEP versions under
# pool/main/h/hydra-music/ and a signed suite, dists/stable, with by-hash
# indexes. .github/workflows/apt-r2.yml runs it in four steps, so each step
# holds only the secret it needs:
#
#   verify          check the release's own signed files and the .deb (no secret)
#   fetch           read the repository's current state from R2 (R2 credentials)
#   build <key>     write and sign the new index (the signing key, in $GNUPGHOME)
#   upload          upload in a safe order, then prune (R2 credentials)
#
# State passes between the steps through $APT_WORK. The release files are
# expected in $APT_WORK/release: the .deb, InRelease and Packages, as every
# GitHub release carries them. Everything is checked against
# packaging/hydra.gpg, the public key users install.
#
# Environment: APT_WORK, APT_BUCKET (hydra-apt), and for fetch and upload
# R2_ACCOUNT_ID, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY. APT_ENDPOINT
# and APT_KEYRING replace the R2 endpoint and the public key, for a local test
# against another S3 server with a throwaway key.
set -euo pipefail

BUCKET=${APT_BUCKET:-hydra-apt}
KEEP=${APT_KEEP:-5}
PACKAGE=hydra-music
ARCH=amd64
SUITE=stable
POOL=pool/main/h/$PACKAGE
BINARY=dists/$SUITE/main/binary-$ARCH
# The public key users install. APT_KEYRING replaces it for a local test only.
KEYRING=$(realpath "${APT_KEYRING:-$(dirname "${BASH_SOURCE[0]}")/../packaging/hydra.gpg}")

# Cache lifetimes: pool files and by-hash indexes never change under their
# name; the suite's index files change with every release, and Cloudflare must
# not hide a new one for long.
IMMUTABLE="public, max-age=31536000, immutable"
SHORT="public, max-age=60"
KEY_CACHE="public, max-age=3600"

fail() {
  echo "error: $*" >&2
  exit 1
}

# aws-cli against R2. R2 rejects the checksums recent aws-cli versions add to
# every request unless they are asked for, and its region is "auto".
s3() {
  local endpoint=${APT_ENDPOINT:-}
  if [ -z "$endpoint" ]; then
    : "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is not set}"
    endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
  fi
  AWS_REQUEST_CHECKSUM_CALCULATION=when_required \
    AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
    AWS_DEFAULT_REGION=auto \
    aws --endpoint-url "$endpoint" --no-cli-pager "$@"
}

# Upload one file with its cache lifetime and media type.
put() {
  local file=$1 key=$2 cache=$3 type=$4
  s3 s3 cp --no-progress --only-show-errors "$file" "s3://${BUCKET}/${key}" \
    --cache-control "$cache" --content-type "$type"
  echo "uploaded ${key}"
}

# The size of an object in bytes, or nothing when it does not exist.
remote_size() {
  s3 s3api head-object --bucket "$BUCKET" --key "$1" --query ContentLength --output text 2>/dev/null || true
}

# Every key under a prefix, one per line.
remote_keys() {
  s3 s3api list-objects-v2 --bucket "$BUCKET" --prefix "$1" --output json |
    jq -r '.Contents // [] | .[].Key'
}

# A field of the first stanza in a Packages file.
field() {
  awk -v name="$2" -F': ' '$1 == name { print substr($0, length(name) + 3); exit }' "$1"
}

# The entries of one checksum section (SHA256, SHA512) of a Release file, as
# "<hash> <path>" lines.
release_sums() {
  awk -v section="$2:" '
    /^[^ ]/ { inside = ($1 == section) ; next }
    inside && NF == 3 { print $1, $3 }
  ' "$1"
}

# Versions sorted newest first by dpkg's rules.
sort_versions() {
  local sorted=() version i placed
  while read -r version; do
    [ -n "$version" ] || continue
    placed=false
    for i in "${!sorted[@]}"; do
      if dpkg --compare-versions "$version" gt "${sorted[$i]}"; then
        sorted=("${sorted[@]:0:$i}" "$version" "${sorted[@]:$i}")
        placed=true
        break
      fi
    done
    $placed || sorted+=("$version")
  done
  if [ ${#sorted[@]} -gt 0 ]; then printf '%s\n' "${sorted[@]}"; fi
}

# Check the release's InRelease against hydra.gpg, its Packages against the
# hash InRelease signs, and the .deb against the hash and size Packages gives,
# so only a .deb the release pipeline signed is published again.
cmd_verify() {
  : "${APT_WORK:?APT_WORK must name the working folder}"
  local dir=$APT_WORK/release
  [ -f "$dir/InRelease" ] && [ -f "$dir/Packages" ] || fail "InRelease and Packages are missing from $dir"
  gpgv --keyring "$KEYRING" --output "$APT_WORK/release.verified" "$dir/InRelease"
  local signed actual
  signed=$(release_sums "$APT_WORK/release.verified" SHA256 | awk '$2 == "Packages" { print $1 }')
  actual=$(sha256sum "$dir/Packages" | cut -d' ' -f1)
  [ -n "$signed" ] && [ "$signed" = "$actual" ] || fail "Packages does not match the signed InRelease"

  local package version arch filename sha size
  package=$(field "$dir/Packages" Package)
  version=$(field "$dir/Packages" Version)
  arch=$(field "$dir/Packages" Architecture)
  filename=$(field "$dir/Packages" Filename)
  sha=$(field "$dir/Packages" SHA256)
  size=$(field "$dir/Packages" Size)
  [ "$package" = "$PACKAGE" ] || fail "the release's package is '$package', not $PACKAGE"
  [ "$arch" = "$ARCH" ] || fail "the release's architecture is '$arch', not $ARCH"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "'$version' is not a plain MAJOR.MINOR.PATCH version"
  if [ -n "${APT_TAG:-}" ] && [ "$APT_TAG" != "$version" ]; then
    fail "the release is tagged $APT_TAG but carries version $version"
  fi
  local deb=$dir/${filename#./}
  [[ "$filename" =~ ^\./[A-Za-z0-9._-]+\.deb$ ]] && [ -f "$deb" ] || fail "the release's .deb is missing"
  [ "$(sha256sum "$deb" | cut -d' ' -f1)" = "$sha" ] || fail "the .deb does not match the signed Packages"
  [ "$(stat -c %s "$deb")" = "$size" ] || fail "the .deb's size does not match the signed Packages"
  printf 'VERSION=%s\nDEB=%s\n' "$version" "$deb" > "$APT_WORK/release.env"
  echo "verified ${PACKAGE} ${version} (${size} bytes) against the release's signed index"
}

# Read what R2 holds: the pool's versions, which of them to keep, and the
# current Release, whose by-hash files stay until the next run replaces it.
cmd_fetch() {
  : "${APT_WORK:?APT_WORK must name the working folder}"
  # shellcheck source=/dev/null
  . "$APT_WORK/release.env"
  local repo=$APT_WORK/repo
  rm -rf "$repo"
  mkdir -p "$repo/$POOL"

  local existing=() keep=() key version
  while read -r key; do
    if [[ "$key" =~ ^${POOL}/${PACKAGE}_([0-9]+\.[0-9]+\.[0-9]+)_${ARCH}\.deb$ ]]; then
      existing+=("${BASH_REMATCH[1]}")
    fi
  done < <(remote_keys "$POOL/")

  mapfile -t keep < <({ printf '%s\n' "$VERSION"; if [ ${#existing[@]} -gt 0 ]; then printf '%s\n' "${existing[@]}"; fi; } | sort -u | sort_versions | head -n "$KEEP")
  printf '%s\n' "${keep[@]}" | grep -qxF "$VERSION" || fail "$VERSION is older than the $KEEP versions the repository keeps"
  printf '%s\n' "${keep[@]}" > "$APT_WORK/keep"
  : > "$APT_WORK/prune"
  for version in "${existing[@]}"; do
    printf '%s\n' "${keep[@]}" | grep -qxF "$version" || echo "$version" >> "$APT_WORK/prune"
  done

  # apt-ftparchive indexes real files, so the versions kept come down again.
  for version in "${keep[@]}"; do
    [ "$version" = "$VERSION" ] && continue
    key=$POOL/${PACKAGE}_${version}_${ARCH}.deb
    s3 s3 cp --no-progress --only-show-errors "s3://${BUCKET}/${key}" "$repo/$key"
  done

  remote_size "$POOL/${PACKAGE}_${VERSION}_${ARCH}.deb" > "$APT_WORK/new-remote-size"
  rm -f "$APT_WORK/old-Release"
  if [ -n "$(remote_size "dists/$SUITE/Release")" ]; then
    s3 s3 cp --no-progress --only-show-errors "s3://${BUCKET}/dists/$SUITE/Release" "$APT_WORK/old-Release"
  fi
  echo "keeping: ${keep[*]}; pruning after upload: $(paste -sd' ' "$APT_WORK/prune")"
}

# Write Packages, Packages.gz and Release with by-hash indexes for the kept
# versions, sign InRelease and Release.gpg with <key>, and check both against
# hydra.gpg. The key must be in $GNUPGHOME without a passphrase.
cmd_build() {
  : "${APT_WORK:?APT_WORK must name the working folder}"
  local key=${1:?usage: $0 build <key fingerprint>}
  # shellcheck source=/dev/null
  . "$APT_WORK/release.env"
  local repo=$APT_WORK/repo
  cp "$DEB" "$repo/$POOL/${PACKAGE}_${VERSION}_${ARCH}.deb"
  rm -rf "$repo/dists"
  mkdir -p "$repo/$BINARY"
  (
    cd "$repo"
    apt-ftparchive packages "$POOL" > "$BINARY/Packages"
    gzip -9 -n -k "$BINARY/Packages"
    # Written outside the suite first, so Release never hashes a copy of itself.
    local release
    release=$(mktemp)
    apt-ftparchive \
      -o APT::FTPArchive::DoByHash=true \
      -o APT::FTPArchive::Release::Origin=Hydra \
      -o APT::FTPArchive::Release::Label=Hydra \
      -o APT::FTPArchive::Release::Suite=$SUITE \
      -o APT::FTPArchive::Release::Codename=$SUITE \
      -o APT::FTPArchive::Release::Architectures=$ARCH \
      -o APT::FTPArchive::Release::Components=main \
      -o "APT::FTPArchive::Release::Description=Hydra, an Apple Music desktop client" \
      release "dists/$SUITE" > "$release"
    mv "$release" "dists/$SUITE/Release"
    chmod 644 "dists/$SUITE/Release"
  )

  local stanzas
  stanzas=$(grep -c '^Package: ' "$repo/$BINARY/Packages")
  [ "$stanzas" -eq "$(wc -l < "$APT_WORK/keep")" ] || fail "Packages lists $stanzas versions, not the $(wc -l < "$APT_WORK/keep") kept"
  grep -q '^Acquire-By-Hash: yes$' "$repo/dists/$SUITE/Release" || fail "Release does not offer by-hash indexes"
  if release_sums "$repo/dists/$SUITE/Release" SHA256 | grep -q 'by-hash/'; then
    fail "Release lists its own by-hash files"
  fi

  gpg --batch --yes --local-user "$key" --digest-algo SHA512 \
    --clearsign --output "$repo/dists/$SUITE/InRelease" "$repo/dists/$SUITE/Release"
  gpg --batch --yes --local-user "$key" --digest-algo SHA512 \
    --armor --detach-sign --output "$repo/dists/$SUITE/Release.gpg" "$repo/dists/$SUITE/Release"
  gpgv --keyring "$KEYRING" "$repo/dists/$SUITE/InRelease"
  gpgv --keyring "$KEYRING" "$repo/dists/$SUITE/Release.gpg" "$repo/dists/$SUITE/Release"

  cp "$KEYRING" "$repo/hydra.gpg"
  echo "signed dists/$SUITE for $(paste -sd' ' "$APT_WORK/keep")"
}

# Upload so apt never sees an index naming a file that is not there yet: the
# new .deb, then the by-hash indexes, Packages, Release, and InRelease and
# Release.gpg last. Pruned .debs and by-hash files no Release names any more
# are deleted only after that, keeping the previous Release's, which a client
# that read it a moment ago may still ask for.
cmd_upload() {
  : "${APT_WORK:?APT_WORK must name the working folder}"
  # shellcheck source=/dev/null
  . "$APT_WORK/release.env"
  local repo=$APT_WORK/repo
  [ -f "$repo/dists/$SUITE/InRelease" ] && [ -f "$repo/dists/$SUITE/Release.gpg" ] || fail "nothing signed to upload"

  local deb_key=$POOL/${PACKAGE}_${VERSION}_${ARCH}.deb
  local remote local_size
  remote=$(cat "$APT_WORK/new-remote-size")
  local_size=$(stat -c %s "$repo/$deb_key")
  if [ -z "$remote" ] || [ "$remote" = "None" ]; then
    put "$repo/$deb_key" "$deb_key" "$IMMUTABLE" application/vnd.debian.binary-package
  elif [ "$remote" = "$local_size" ]; then
    echo "${deb_key} is already published"
  else
    fail "${deb_key} is already published with a different size; a published version never changes"
  fi

  local file
  while read -r file; do
    put "$repo/$file" "$file" "$IMMUTABLE" application/octet-stream
  done < <(cd "$repo" && find "$BINARY/by-hash" -type f | sort)
  put "$repo/$BINARY/Packages.gz" "$BINARY/Packages.gz" "$SHORT" application/gzip
  put "$repo/$BINARY/Packages" "$BINARY/Packages" "$SHORT" "text/plain; charset=utf-8"
  put "$repo/dists/$SUITE/Release" "dists/$SUITE/Release" "$SHORT" "text/plain; charset=utf-8"
  put "$repo/dists/$SUITE/InRelease" "dists/$SUITE/InRelease" "$SHORT" "text/plain; charset=utf-8"
  put "$repo/dists/$SUITE/Release.gpg" "dists/$SUITE/Release.gpg" "$SHORT" application/pgp-signature
  put "$repo/hydra.gpg" hydra.gpg "$KEY_CACHE" application/pgp-keys

  local version
  while read -r version; do
    [ -n "$version" ] || continue
    s3 s3 rm --only-show-errors "s3://${BUCKET}/$POOL/${PACKAGE}_${version}_${ARCH}.deb"
    echo "pruned ${PACKAGE} ${version}"
  done < "$APT_WORK/prune"

  # by-hash files the new and the previous Release name.
  local wanted=$APT_WORK/by-hash-wanted
  (cd "$repo" && find "$BINARY/by-hash" -type f) > "$wanted"
  if [ -f "$APT_WORK/old-Release" ]; then
    local algo hash path
    for algo in SHA256 SHA512; do
      while read -r hash path; do
        echo "dists/$SUITE/$(dirname "$path")/by-hash/$algo/$hash"
      done < <(release_sums "$APT_WORK/old-Release" "$algo")
    done >> "$wanted"
  fi
  local key
  while read -r key; do
    grep -qxF "$key" "$wanted" && continue
    s3 s3 rm --only-show-errors "s3://${BUCKET}/${key}"
    echo "removed stale ${key}"
  done < <(remote_keys "$BINARY/by-hash/")
  echo "published ${PACKAGE} ${VERSION} to ${BUCKET}"
}

# Run a step, unless the file is sourced: test/aptR2.test.ts sources it to
# call the helpers on their own.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-}" in
    verify) cmd_verify ;;
    fetch) cmd_fetch ;;
    build) shift; cmd_build "$@" ;;
    upload) cmd_upload ;;
    *) echo "usage: $0 verify|fetch|build <key fingerprint>|upload" >&2; exit 2 ;;
  esac
fi
