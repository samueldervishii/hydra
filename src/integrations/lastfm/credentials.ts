/**
 * The Last.fm API account Hydra signs its requests with. It is in neither the
 * source nor the build: each user registers their own at
 * https://www.last.fm/api/account/create and supplies it through
 * HYDRA_LASTFM_API_KEY and HYDRA_LASTFM_API_SECRET, or else through
 * lastfm.json in the user data folder (~/.config/Hydra/lastfm.json):
 *
 *   { "apiKey": "<32 hex characters>", "apiSecret": "<32 hex characters>" }
 *
 * Without either, scrobbling stays hidden. No value read here is ever logged.
 */
import { readFileSync } from "fs";
import path from "path";
import { app } from "electron";
import log from "electron-log/main";

const credentialsLog = log.scope("lastfm");

/** The application key and shared secret of a Last.fm API account. */
export interface LastfmCredentials {
  apiKey: string;
  apiSecret: string;
}

/** Last.fm issues both values as 32 hexadecimal characters. */
const CREDENTIAL_FORMAT = /^[0-9a-f]{32}$/i;

/** The user-supplied credentials file, beside config.json. */
export function lastfmCredentialsPath(): string {
  return path.join(app.getPath("userData"), "lastfm.json");
}

function valid(apiKey: unknown, apiSecret: unknown): LastfmCredentials | null {
  if (typeof apiKey !== "string" || typeof apiSecret !== "string") return null;
  const key = apiKey.trim();
  const secret = apiSecret.trim();
  if (!CREDENTIAL_FORMAT.test(key) || !CREDENTIAL_FORMAT.test(secret)) return null;
  return { apiKey: key, apiSecret: secret };
}

/**
 * Read the credentials, the environment first and then the file, or null when
 * neither supplies a usable pair. A pair that is present but malformed is
 * reported, naming the source and never the values.
 */
export function loadCredentials(
  env: NodeJS.ProcessEnv = process.env,
  readFile: () => string = () => readFileSync(lastfmCredentialsPath(), "utf8"),
): LastfmCredentials | null {
  const envKey = env.HYDRA_LASTFM_API_KEY;
  const envSecret = env.HYDRA_LASTFM_API_SECRET;
  if (envKey || envSecret) {
    const fromEnv = valid(envKey, envSecret);
    if (fromEnv) return fromEnv;
    credentialsLog.warn(
      "HYDRA_LASTFM_API_KEY and HYDRA_LASTFM_API_SECRET must both be set, each to 32 hexadecimal characters",
    );
  }

  let text: string;
  try {
    text = readFile();
  } catch (err: unknown) {
    const missing = (err as NodeJS.ErrnoException | null)?.code === "ENOENT";
    if (missing) credentialsLog.info("no API credentials: scrobbling is off until lastfm.json exists");
    else credentialsLog.warn("lastfm.json could not be read");
    return null;
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown> | null;
    const fromFile = valid(parsed?.apiKey, parsed?.apiSecret);
    if (fromFile) return fromFile;
  } catch {
    // Reported below with the other malformed cases.
  }
  credentialsLog.warn(
    'lastfm.json must hold { "apiKey": ..., "apiSecret": ... }, each 32 hexadecimal characters',
  );
  return null;
}
