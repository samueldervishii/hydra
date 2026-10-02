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

it("releases the fork from main without secrets", () => {
  expect(releaseWorkflow).toMatch(
    /on:\n  push:\n    branches: \[main\]\n    paths: \["package.json"\]\n  workflow_dispatch:\n\n/,
  );
  expect(releaseWorkflow).toContain("run: just build");
  expect(releaseWorkflow).not.toMatch(/secrets\.|SIDRA_LASTFM|EVS_|GITHUB_REF_TYPE/);
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
});
