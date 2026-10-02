import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const childProcess =
  require("child_process") as typeof import("node:child_process");

interface ReleaseCredentials {
  isOfficialBuild(env?: NodeJS.ProcessEnv): boolean;
  validateCredentialPair(
    env: NodeJS.ProcessEnv,
    firstName: string,
    secondName: string,
    required?: boolean,
  ): boolean;
}

const { isOfficialBuild, validateCredentialPair } =
  require("../scripts/release-credentials.cjs") as ReleaseCredentials;
const { EVS_PACKAGE } = require("../build/evs.cjs") as { EVS_PACKAGE: string };
interface HookContext {
  appOutDir: string;
  electronPlatformName: string;
}

type BuildHook = (context: HookContext) => Promise<void>;

const afterPack = require("../build/afterPack.cjs").default as BuildHook;
const afterSign = require("../build/afterSign.cjs").default as BuildHook;
const releaseWorkflow = readFileSync(
  ".github/workflows/release-linux.yml",
  "utf8",
);
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
  build: {
    afterPack?: string;
    afterSign?: string;
    win?: { signAndEditExecutable?: boolean };
  };
};
const activeHooks = [
  { name: "macOS afterPack", hook: afterPack, platform: "darwin" },
  { name: "Windows afterSign", hook: afterSign, platform: "win32" },
] as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("release credential gates", () => {
  it("recognises GitHub tag builds as official", () => {
    expect(isOfficialBuild({ GITHUB_REF_TYPE: "tag" })).toBe(true);
    expect(isOfficialBuild({ GITHUB_REF_TYPE: "branch" })).toBe(false);
    expect(isOfficialBuild({})).toBe(false);
  });

  it("allows an unconfigured local build", () => {
    expect(validateCredentialPair({}, "KEY", "SECRET")).toBe(false);
  });

  it("rejects a partial credential pair", () => {
    expect(() =>
      validateCredentialPair({ KEY: "key" }, "KEY", "SECRET"),
    ).toThrow("KEY and SECRET must be set together");
    expect(() =>
      validateCredentialPair({ SECRET: "secret" }, "KEY", "SECRET"),
    ).toThrow("KEY and SECRET must be set together");
  });

  it("requires a complete pair for an official build", () => {
    expect(() => validateCredentialPair({}, "KEY", "SECRET", true)).toThrow(
      "KEY and SECRET are required for tag builds",
    );
    expect(
      validateCredentialPair(
        { KEY: "key", SECRET: "secret" },
        "KEY",
        "SECRET",
        true,
      ),
    ).toBe(true);
  });
});

describe("release build scripts", () => {
  it("ignores platforms outside each hook phase before credential validation", async () => {
    vi.stubEnv("GITHUB_REF_TYPE", "tag");
    vi.stubEnv("EVS_ACCOUNT_NAME", "");
    vi.stubEnv("EVS_PASSWD", "");
    const execFileSync = vi.spyOn(childProcess, "execFileSync");

    await expect(
      afterPack({
        appOutDir: "/tmp/hydra-test",
        electronPlatformName: "win32",
      }),
    ).resolves.toBeUndefined();
    await expect(
      afterPack({
        appOutDir: "/tmp/hydra-test",
        electronPlatformName: "linux",
      }),
    ).resolves.toBeUndefined();
    await expect(
      afterSign({
        appOutDir: "/tmp/hydra-test",
        electronPlatformName: "darwin",
      }),
    ).resolves.toBeUndefined();
    await expect(
      afterSign({
        appOutDir: "/tmp/hydra-test",
        electronPlatformName: "linux",
      }),
    ).resolves.toBeUndefined();
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("invokes production VMP signing only in each platform active phase", async () => {
    vi.stubEnv("GITHUB_REF_TYPE", "tag");
    vi.stubEnv("EVS_ACCOUNT_NAME", "account");
    vi.stubEnv("EVS_PASSWD", "password");
    const execFileSync = vi
      .spyOn(childProcess, "execFileSync")
      .mockReturnValue(Buffer.alloc(0));

    await afterPack({
      appOutDir: "/tmp/hydra-macos",
      electronPlatformName: "darwin",
    });
    await afterSign({
      appOutDir: "/tmp/hydra-windows",
      electronPlatformName: "win32",
    });

    expect(execFileSync).toHaveBeenNthCalledWith(
      1,
      "uvx",
      ["--from", EVS_PACKAGE, "evs-vmp", "sign-pkg", "/tmp/hydra-macos"],
      { stdio: "inherit" },
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      "uvx",
      ["--from", EVS_PACKAGE, "evs-vmp", "sign-pkg", "/tmp/hydra-windows"],
      { stdio: "inherit" },
    );
    expect(execFileSync).toHaveBeenCalledTimes(2);
  });

  it.each(activeHooks)(
    "$name skips an unconfigured local build",
    async ({ hook, platform }) => {
      vi.stubEnv("GITHUB_REF_TYPE", "branch");
      vi.stubEnv("EVS_ACCOUNT_NAME", "");
      vi.stubEnv("EVS_PASSWD", "");
      const execFileSync = vi.spyOn(childProcess, "execFileSync");

      await expect(
        hook({ appOutDir: "/tmp/hydra-test", electronPlatformName: platform }),
      ).resolves.toBeUndefined();
      expect(execFileSync).not.toHaveBeenCalled();
    },
  );

  it.each(activeHooks)(
    "$name rejects missing credentials for a tag build",
    async ({ hook, platform }) => {
      vi.stubEnv("GITHUB_REF_TYPE", "tag");
      vi.stubEnv("EVS_ACCOUNT_NAME", "");
      vi.stubEnv("EVS_PASSWD", "");

      await expect(
        hook({ appOutDir: "/tmp/hydra-test", electronPlatformName: platform }),
      ).rejects.toThrow(
        "EVS_ACCOUNT_NAME and EVS_PASSWD are required for tag builds",
      );
    },
  );

  it.each(activeHooks)(
    "$name rejects partial credentials",
    async ({ hook, platform }) => {
      vi.stubEnv("GITHUB_REF_TYPE", "branch");
      vi.stubEnv("EVS_ACCOUNT_NAME", "account");
      vi.stubEnv("EVS_PASSWD", "");

      await expect(
        hook({ appOutDir: "/tmp/hydra-test", electronPlatformName: platform }),
      ).rejects.toThrow("EVS_ACCOUNT_NAME and EVS_PASSWD must be set together");
    },
  );

  it.each(activeHooks)(
    "$name propagates an EVS failure",
    async ({ hook, platform }) => {
      vi.stubEnv("GITHUB_REF_TYPE", "tag");
      vi.stubEnv("EVS_ACCOUNT_NAME", "account");
      vi.stubEnv("EVS_PASSWD", "password");
      vi.spyOn(childProcess, "execFileSync").mockImplementation(() => {
        throw new Error("EVS failed");
      });

      await expect(
        hook({ appOutDir: "/tmp/hydra-test", electronPlatformName: platform }),
      ).rejects.toThrow("EVS failed");
    },
  );

});

it("releases the fork from main with the apt signing key as its only secret", () => {
  expect(releaseWorkflow).toMatch(
    /on:\n  push:\n    branches: \[main\]\n    paths: \["package.json"\]\n\n/,
  );
  expect(releaseWorkflow).toContain("run: just build");
  expect(releaseWorkflow.match(/secrets\.[A-Z_]+/g)).toEqual(["secrets.HYDRA_GPG_PRIVATE_KEY"]);
  expect(releaseWorkflow).not.toMatch(/SIDRA_LASTFM|EVS_|GITHUB_REF_TYPE/);
});

// apt reads the repository from releases/latest/download/, so every release
// must carry it and be Latest; a pre-release would leave apt on the old one.
// Only a push to main may release: no manual or pull-request trigger, and
// every job checks the ref as well.
it("runs only for pushes to main", () => {
  expect(releaseWorkflow).not.toMatch(/workflow_dispatch|pull_request|workflow_run|repository_dispatch|schedule:/);
  const jobs = releaseWorkflow.slice(releaseWorkflow.indexOf("\njobs:"));
  const jobCount = (jobs.match(/^  [a-z-]+:\n/gm) ?? []).length;
  const refChecks = (jobs.match(/^    if: github\.ref == 'refs\/heads\/main'/gm) ?? []).length;
  expect(jobCount).toBeGreaterThan(0);
  expect(refChecks).toBe(jobCount);
});

it("publishes a signed apt repository on a Latest release", () => {
  const step = releaseWorkflow.slice(
    releaseWorkflow.indexOf("- name: Build and sign the apt repository"),
    releaseWorkflow.indexOf("- name: Tag the commit and publish the release"),
  );
  expect(step).toContain("HYDRA_GPG_PRIVATE_KEY: ${{ secrets.HYDRA_GPG_PRIVATE_KEY }}");
  expect(step).toContain("scripts/build-apt-repo.sh release \"$key\" packaging/hydra.gpg");
  const publish = releaseWorkflow.slice(
    releaseWorkflow.indexOf("gh release create"),
  );
  for (const asset of [
    "release/*.deb",
    "release/SHA256SUMS",
    "release/Packages",
    "release/Packages.gz",
    "release/Release",
    "release/Release.gpg",
    "release/InRelease",
    "packaging/hydra.gpg",
  ]) {
    expect(publish, asset).toContain(asset);
  }
  expect(publish).toContain("--latest");
  expect(releaseWorkflow).not.toContain("--prerelease");
  // The secret reaches the signing step only.
  expect(releaseWorkflow.indexOf("secrets.HYDRA_GPG_PRIVATE_KEY")).toBeGreaterThan(
    releaseWorkflow.indexOf("- name: Build and sign the apt repository"),
  );
});

it("keeps Filename in Packages relative and checks the signatures", () => {
  const script = readFileSync("scripts/build-apt-repo.sh", "utf8");
  expect(script).toContain("apt-ftparchive packages . > Packages");
  expect(script).toContain('gpgv --keyring "$keyring" InRelease');
  expect(script).toContain('gpgv --keyring "$keyring" Release.gpg Release');
});

// From 2.0.0 versions are plain MAJOR.MINOR.PATCH, so a pre-release suffix
// such as the old -hydra.N must stop the release rather than tag it.
it("releases plain MAJOR.MINOR.PATCH versions only", () => {
  expect(releaseWorkflow).toContain(
    'if [[ ! "$VERSION" =~ ^[0-9]+\\.[0-9]+\\.[0-9]+$ ]]; then',
  );
});

it("carries a plain version the workflow will release", () => {
  expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
});

it("pins castlabs-evs to an exact release", () => {
  expect(EVS_PACKAGE).toMatch(/^castlabs-evs==\d+\.\d+\.\d+$/);
});

it("registers the platform VMP hooks without disabling Windows executable edits", () => {
  expect(packageJson.build.afterPack).toBe("build/afterPack.cjs");
  expect(packageJson.build.afterSign).toBe("build/afterSign.cjs");
  expect(packageJson.build.win?.signAndEditExecutable).not.toBe(false);
});

// Hydra 1.x shipped as the sidra package. The hydra .deb must take over from
// it on install, files under /opt/Hydra included, or dpkg refuses the overlap.
describe("deb package swap", () => {
  it("declares Conflicts, Replaces and Provides on sidra", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      name: string;
      build: { deb: { fpm?: string[] } };
    };
    expect(pkg.name).toBe("hydra");
    const fpm = pkg.build.deb.fpm ?? [];
    for (const field of ["--conflicts", "--replaces", "--provides"]) {
      expect(fpm[fpm.indexOf(field) + 1], field).toBe("sidra");
    }
  });

  // Ubuntu and Debian ship THC-Hydra as hydra at a higher version, which apt
  // offered as an upgrade over ours, and its /usr/bin/hydra clashed with ours.
  it("ships as hydra-music and relates only to our own hydra <= 2.0.1", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      name: string;
      desktopName: string;
      build: {
        linux: { executableName: string; syncDesktopName?: boolean };
        deb: { packageName?: string; fpm?: string[] };
      };
    };
    expect(pkg.build.deb.packageName).toBe("hydra-music");
    expect(pkg.build.linux.executableName).toBe("hydra-music");
    const fpm = pkg.build.deb.fpm ?? [];
    const pairs = fpm.slice(0, -1).map((arg, i) => `${arg} ${fpm[i + 1]}`);
    expect(pairs).toContain("--deb-field Breaks: hydra (<= 2.0.1)");
    expect(pairs).toContain("--replaces hydra (<= 2.0.1)");
    // An unversioned relation would block installing THC-Hydra beside us.
    expect(fpm.filter((arg) => /^hydra\b/.test(arg))).toEqual(["hydra (<= 2.0.1)"]);
    // The window class and MPRIS DesktopEntry stay hydra, so the launcher does.
    expect(pkg.desktopName).toBe(`${pkg.name}.desktop`);
    expect(pkg.build.linux.syncDesktopName).toBe(true);
  });
});

// Unregistering /usr/bin/hydra from postrm ran after dpkg had deleted the
// target, so update-alternatives warned about a dangling link group.
describe("deb remove scripts", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    productName: string;
    build: {
      linux: { executableName: string };
      deb: { afterRemove?: string; fpm?: string[] };
    };
  };
  const exe = pkg.build.linux.executableName;

  it("unregisters the link from prerm on remove, and leaves it on upgrade", () => {
    const fpm = pkg.build.deb.fpm ?? [];
    const prermPath = fpm[fpm.indexOf("--before-remove") + 1];
    expect(prermPath).toBe("build/linux/before-remove.sh");
    const prerm = readFileSync(prermPath, "utf8");
    expect(prerm).toMatch(/case "\$1" in\n\s+remove\|deconfigure\)/);
    expect(prerm).toContain(
      `update-alternatives --remove '${exe}' '/opt/${pkg.productName}/${exe}'`,
    );
    expect(prerm).toContain(`rm -f '/usr/bin/${exe}'`);
  });

  it("keeps update-alternatives out of postrm", () => {
    const postrm = readFileSync(pkg.build.deb.afterRemove ?? "", "utf8");
    const commands = postrm.split("\n").filter((line) => !line.trim().startsWith("#"));
    expect(commands.join("\n")).not.toContain("update-alternatives");
    expect(postrm).toContain("APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'");
  });
});
