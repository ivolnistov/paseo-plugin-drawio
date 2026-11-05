// Per-user cache location shared by the launcher and the ELK preparation step.
import { chmodSync, lstatSync, mkdirSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

/**
 * The platform's per-user cache directory for this plugin, never a shared temporary directory:
 * it holds code that is evaluated later (the verified ELK bundle).
 */
export function userCacheHome(env = process.env, platform = process.platform, home = homedir()) {
  if (platform === "darwin") return path.join(home, "Library", "Caches", "paseo-plugin-drawio");
  if (platform === "win32") return path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "paseo-plugin-drawio", "Cache");
  const xdg = env.XDG_CACHE_HOME && path.isAbsolute(env.XDG_CACHE_HOME) ? env.XDG_CACHE_HOME : path.join(home, ".cache");
  return path.join(xdg, "paseo-plugin-drawio");
}

export const PREPARE_CACHE_HOME = userCacheHome();

const ownUid = () => (typeof process.getuid === "function" ? process.getuid() : null);

/** Creates `dir` if needed and makes sure it is a real directory owned by this user, mode 0700. */
export function ensurePrivateDirectory(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = lstatSync(dir);
  const uid = ownUid();
  if (!stat.isDirectory() || stat.isSymbolicLink() || (uid !== null && stat.uid !== uid)) {
    throw new Error(`${dir} is not a private directory owned by this user`);
  }
  if (process.platform !== "win32" && (stat.mode & 0o777) !== 0o700) chmodSync(dir, 0o700);
  return dir;
}

/** `dir` when it can be made private; otherwise a new private temporary directory. */
export function privateCacheDirectory(dir) {
  try {
    return ensurePrivateDirectory(dir);
  } catch {
    return mkdtempSync(path.join(tmpdir(), "paseo-plugin-drawio-"));
  }
}

/**
 * True when `file` is a regular file (not a link) owned by this user and not writable by group or
 * others. Windows reports every writable file as mode 0666 and has no POSIX group or other bits,
 * so there only the file type is checked, as for directories.
 */
export function isPrivateFile(stat, platform = process.platform) {
  if (!stat.isFile() || stat.isSymbolicLink()) return false;
  if (platform === "win32") return true;
  const uid = ownUid();
  return (uid === null || stat.uid === uid) && (stat.mode & 0o022) === 0;
}
