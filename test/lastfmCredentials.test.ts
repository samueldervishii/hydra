import { describe, expect, it, vi } from "vitest";
import log from "electron-log/main";
import {
  lastfmCredentialsPath,
  loadCredentials,
} from "../src/integrations/lastfm/credentials";

const KEY = "0123456789abcdef0123456789abcdef";
const SECRET = "FEDCBA9876543210FEDCBA9876543210";

const fileWith = (value: unknown) => () => JSON.stringify(value);
const noFile = () => {
  throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
};

function logged(): string {
  const scope = log.scope("lastfm");
  return JSON.stringify([
    ...vi.mocked(scope.info).mock.calls,
    ...vi.mocked(scope.warn).mock.calls,
  ]);
}

describe("Last.fm credentials", () => {
  it("lives beside config.json in the user data folder", () => {
    expect(lastfmCredentialsPath()).toBe("/tmp/hydra-test/userData/lastfm.json");
  });

  it("reads the environment first", () => {
    const readFile = vi.fn(fileWith({ apiKey: SECRET, apiSecret: KEY }));
    expect(
      loadCredentials({ HYDRA_LASTFM_API_KEY: KEY, HYDRA_LASTFM_API_SECRET: SECRET }, readFile),
    ).toEqual({ apiKey: KEY, apiSecret: SECRET });
    expect(readFile).not.toHaveBeenCalled();
  });

  it("reads lastfm.json without the environment, trimming stray whitespace", () => {
    expect(loadCredentials({}, fileWith({ apiKey: ` ${KEY}\n`, apiSecret: SECRET }))).toEqual({
      apiKey: KEY,
      apiSecret: SECRET,
    });
  });

  it("falls back to the file when the environment pair is incomplete", () => {
    vi.mocked(log.scope("lastfm").warn).mockClear();
    expect(
      loadCredentials({ HYDRA_LASTFM_API_KEY: KEY }, fileWith({ apiKey: KEY, apiSecret: SECRET })),
    ).toEqual({ apiKey: KEY, apiSecret: SECRET });
    expect(vi.mocked(log.scope("lastfm").warn)).toHaveBeenCalledOnce();
  });

  it("is absent without the environment or the file", () => {
    expect(loadCredentials({}, noFile)).toBeNull();
  });

  it.each([
    ["not JSON", () => "apiKey=abc"],
    ["null", fileWith(null)],
    ["a missing secret", fileWith({ apiKey: KEY })],
    ["a short key", fileWith({ apiKey: KEY.slice(1), apiSecret: SECRET })],
    ["a non-hex secret", fileWith({ apiKey: KEY, apiSecret: "z".repeat(32) })],
    ["numbers", fileWith({ apiKey: 1, apiSecret: 2 })],
  ])("rejects a file with %s", (_name, readFile) => {
    expect(loadCredentials({}, readFile)).toBeNull();
  });

  it("is absent when the file cannot be read", () => {
    const denied = () => {
      throw Object.assign(new Error("EACCES"), { code: "EACCES" });
    };
    expect(loadCredentials({}, denied)).toBeNull();
  });

  it("never logs a credential, even a malformed one", () => {
    loadCredentials({ HYDRA_LASTFM_API_KEY: "short", HYDRA_LASTFM_API_SECRET: SECRET }, fileWith({ apiKey: KEY, apiSecret: "bad" }));
    expect(logged()).not.toContain(KEY);
    expect(logged()).not.toContain(SECRET);
    expect(logged()).not.toContain("short");
  });
});
