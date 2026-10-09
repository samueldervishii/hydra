// The apt repository on Cloudflare R2 (https://apt.six9.uk): the workflow
// that publishes it, how the release workflow calls it, and the script that
// does the work. Static checks on the YAML and the script, plus the script's
// own helpers, run through bash.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/apt-r2.yml", "utf8");
const releaseWorkflow = readFileSync(".github/workflows/release-linux.yml", "utf8");
const script = readFileSync("scripts/publish-apt-r2.sh", "utf8");

/** The text of one step, from its name to the next step. */
function step(name: string): string {
  const start = workflow.indexOf(`- name: ${name}\n`);
  expect(start, name).toBeGreaterThan(-1);
  const next = workflow.indexOf("\n      - name: ", start + 1);
  return next === -1 ? workflow.slice(start) : workflow.slice(start, next);
}

/** The body of one of the script's functions. */
function fn(name: string): string {
  const start = script.indexOf(`${name}() {`);
  expect(start, name).toBeGreaterThan(-1);
  return script.slice(start, script.indexOf("\n}\n", start));
}

/** Run a helper from the script in bash and return what it prints. */
function helper(code: string, input = ""): string {
  return execFileSync("bash", ["-c", `source scripts/publish-apt-r2.sh; ${code}`], {
    input,
    encoding: "utf8",
  });
}

describe("apt repository workflow", () => {
  // A release created with the release workflow's own token starts no other
  // workflow, so the release workflow calls this one; dispatch republishes.
  it("runs when called or dispatched, and on nothing else", () => {
    const on = workflow.slice(workflow.indexOf("\non:\n"), workflow.indexOf("\npermissions:"));
    expect(on).toMatch(/^  workflow_call:\n    inputs:\n      tag:\n/m);
    expect(on).toMatch(/^  workflow_dispatch:\n/m);
    expect(on).not.toMatch(/^  (release|push|pull_request|schedule|repository_dispatch|workflow_run):/m);
    expect(on).toMatch(/workflow_call:[\s\S]*required: true[\s\S]*workflow_dispatch:[\s\S]*required: false/);
  });

  it("runs from main only, in the Release environment, with a read-only token", () => {
    expect(workflow).toMatch(/^permissions:\n  contents: read\n/m);
    expect(workflow).toContain("    if: github.ref == 'refs/heads/main'\n");
    expect(workflow).toContain("    environment: Release\n");
    expect(workflow).toMatch(/^    permissions:\n      contents: read\n/m);
    expect(workflow).not.toMatch(/: write$/m);
    expect(workflow).toMatch(/concurrency:\n  group: apt-r2\n  cancel-in-progress: false/);
  });

  it("gives each step only the secret it needs", () => {
    const r2 = ["secrets.R2_ACCESS_KEY_ID", "secrets.R2_SECRET_ACCESS_KEY", "secrets.R2_ACCOUNT_ID"];
    const secrets = (text: string) => [...text.matchAll(/secrets\.[A-Z0-9_]+/g)].map((m) => m[0]).sort();
    expect(secrets(step("Download and verify the release"))).toEqual([]);
    expect(secrets(step("Read the repository on R2"))).toEqual([...r2].sort());
    expect(secrets(step("Build and sign the index"))).toEqual(["secrets.HYDRA_GPG_PRIVATE_KEY"]);
    expect(secrets(step("Upload to R2"))).toEqual([...r2].sort());
    // Nowhere else: no job-level env, no other step.
    expect(secrets(workflow)).toEqual(
      [...r2, ...r2, "secrets.HYDRA_GPG_PRIVATE_KEY"].sort(),
    );
  });

  it("imports the key into a keyring removed when the signing step ends, even on failure", () => {
    const sign = step("Build and sign the index");
    const trap = sign.indexOf(`trap 'rm -rf "$GNUPGHOME"' EXIT`);
    expect(sign.indexOf("GNUPGHOME=$(mktemp -d)")).toBeGreaterThan(-1);
    expect(trap).toBeGreaterThan(sign.indexOf("GNUPGHOME=$(mktemp -d)"));
    expect(trap).toBeLessThan(sign.indexOf("gpg --batch --quiet --import"));
    expect(sign).toContain("packaging/hydra.gpg");
    // The key never reaches a command line or the log.
    expect(sign).not.toMatch(/echo "\$HYDRA_GPG_PRIVATE_KEY"|--passphrase/);
  });

  it("runs the steps in order: verify, fetch, build, upload", () => {
    const at = (name: string) => workflow.indexOf(`scripts/publish-apt-r2.sh ${name}`);
    expect(at("verify")).toBeGreaterThan(-1);
    expect(at("verify")).toBeLessThan(at("fetch"));
    expect(at("fetch")).toBeLessThan(at("build"));
    expect(at("build")).toBeLessThan(at("upload"));
  });

  // A called workflow sees no secret its caller did not pass, not even its own
  // environment's: without inherit, 2.7.1's apt job read all three R2 secrets
  // as empty. No secret is named here, so none is handed on beyond inherit.
  it("is called by the release workflow once the release is published, inheriting secrets", () => {
    const start = releaseWorkflow.indexOf("\n  apt:\n");
    expect(start).toBeGreaterThan(-1);
    const job = releaseWorkflow.slice(start);
    expect(job).toContain("    needs: [check, publish]\n");
    expect(job).toContain("    uses: ./.github/workflows/apt-r2.yml\n");
    expect(job).toContain("      tag: ${{ needs.check.outputs.version }}\n");
    expect(job).toMatch(/^    permissions:\n      contents: read$/m);
    expect(job).toContain("    secrets: inherit\n");
    expect(job).not.toMatch(/secrets\./);
    expect(job.match(/secrets/g)).toHaveLength(1);
  });
});

describe("apt repository script", () => {
  it("lays the repository out as agreed", () => {
    expect(script).toContain("PACKAGE=hydra-music");
    expect(script).toContain("ARCH=amd64");
    expect(script).toContain("SUITE=stable");
    expect(script).toContain("POOL=pool/main/h/$PACKAGE");
    expect(script).toContain("KEEP=${APT_KEEP:-5}");
    expect(script).toContain("BUCKET=${APT_BUCKET:-hydra-apt}");
    const build = fn("cmd_build");
    for (const option of [
      "APT::FTPArchive::DoByHash=true",
      "APT::FTPArchive::Release::Origin=Hydra",
      "APT::FTPArchive::Release::Label=Hydra",
      "APT::FTPArchive::Release::Suite=$SUITE",
      "APT::FTPArchive::Release::Codename=$SUITE",
      "APT::FTPArchive::Release::Architectures=$ARCH",
      "APT::FTPArchive::Release::Components=main",
    ]) {
      expect(build, option).toContain(option);
    }
  });

  it("re-signs only a .deb the release's signed index vouches for", () => {
    const verify = fn("cmd_verify");
    expect(verify).toContain('gpgv --keyring "$KEYRING"');
    expect(verify).toContain("Packages does not match the signed InRelease");
    expect(verify).toContain("the .deb does not match the signed Packages");
    expect(verify).toContain("the .deb's size does not match the signed Packages");
  });

  it("checks both signatures against hydra.gpg right after signing", () => {
    const build = fn("cmd_build");
    const signed = build.indexOf("--detach-sign");
    expect(build.indexOf("--clearsign")).toBeGreaterThan(-1);
    expect(build.indexOf('gpgv --keyring "$KEYRING" "$repo/dists/$SUITE/InRelease"')).toBeGreaterThan(signed);
    expect(build.indexOf('gpgv --keyring "$KEYRING" "$repo/dists/$SUITE/Release.gpg"')).toBeGreaterThan(signed);
    expect(script).toMatch(/^set -euo pipefail$/m);
    // The workflow's key is packaging/hydra.gpg unless a local test replaces it.
    expect(script).toContain('KEYRING=$(realpath "${APT_KEYRING:-$(dirname "${BASH_SOURCE[0]}")/../packaging/hydra.gpg}")');
    expect(workflow).not.toContain("APT_KEYRING");
    expect(workflow).not.toContain("APT_ENDPOINT");
  });

  // apt must never read an index naming a file that is not there yet, and a
  // pruned .deb or by-hash file goes only once the new index is live.
  it("uploads the .deb, by-hash, Packages, Release, InRelease and Release.gpg in that order, then prunes", () => {
    const upload = fn("cmd_upload");
    const order = [
      'put "$repo/$deb_key"',
      'find "$BINARY/by-hash"',
      'put "$repo/$BINARY/Packages.gz"',
      'put "$repo/$BINARY/Packages"',
      'put "$repo/dists/$SUITE/Release"',
      'put "$repo/dists/$SUITE/InRelease"',
      'put "$repo/dists/$SUITE/Release.gpg"',
      'put "$repo/hydra.gpg" hydra.gpg',
      's3 s3 rm --only-show-errors "s3://${BUCKET}/$POOL/',
      'removed stale',
    ];
    const at = order.map((needle) => upload.indexOf(needle));
    at.forEach((index, i) => expect(index, order[i]).toBeGreaterThan(-1));
    expect(at).toEqual([...at].sort((a, b) => a - b));
    // A different file under a published version's name fails the upload.
    expect(upload).toContain("a published version never changes");
  });

  it("sets long cache lifetimes on pool and by-hash files and short ones on the index", () => {
    expect(script).toContain('IMMUTABLE="public, max-age=31536000, immutable"');
    expect(script).toContain('SHORT="public, max-age=60"');
    const upload = fn("cmd_upload");
    expect(upload).toMatch(/put "\$repo\/\$deb_key" "\$deb_key" "\$IMMUTABLE"/);
    expect(upload).toMatch(/put "\$repo\/\$file" "\$file" "\$IMMUTABLE"/);
    for (const file of ["Packages.gz", "Packages", "Release", "InRelease", "Release.gpg"]) {
      expect(upload, file).toMatch(new RegExp(`/${file.replace(".", "\\.")}" "[^"]+${file.replace(".", "\\.")}" "\\$SHORT"`));
    }
  });

  it("talks to R2's S3 endpoint with the checksum settings R2 accepts", () => {
    const s3 = fn("s3");
    expect(s3).toContain('endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"');
    expect(s3).toContain("AWS_REQUEST_CHECKSUM_CALCULATION=when_required");
    expect(s3).toContain("AWS_DEFAULT_REGION=auto");
  });

  it("sorts versions newest first by dpkg's rules", () => {
    expect(helper("sort_versions", "2.9.0\n2.10.0\n2.7.1\n\n2.7.0\n")).toBe("2.10.0\n2.9.0\n2.7.1\n2.7.0\n");
    expect(helper("sort_versions", "")).toBe("");
  });

  it("reads a Release file's checksum sections", () => {
    const release = [
      "Origin: Hydra",
      "MD5Sum:",
      " aaaa 10 main/binary-amd64/Packages",
      "SHA256:",
      " bbbb 10 main/binary-amd64/Packages",
      " cccc 5 main/binary-amd64/Packages.gz",
      "SHA512:",
      " dddd 10 main/binary-amd64/Packages",
      "",
    ].join("\n");
    expect(helper('release_sums /dev/stdin SHA256', release)).toBe(
      "bbbb main/binary-amd64/Packages\ncccc main/binary-amd64/Packages.gz\n",
    );
    expect(helper('release_sums /dev/stdin SHA512', release)).toBe("dddd main/binary-amd64/Packages\n");
  });

  it("does nothing when sourced, and refuses an unknown step", () => {
    expect(helper("echo sourced")).toBe("sourced\n");
    expect(() =>
      execFileSync("bash", ["scripts/publish-apt-r2.sh", "deploy"], { stdio: "pipe" }),
    ).toThrow();
  });
});
