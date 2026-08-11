/**
 * Pure helpers for the relative POSIX paths used throughout the app
 * (lesson paths within a course, course paths within a library).
 *
 * These are *shape* checks shared by client and server. The server must
 * still resolve real paths and verify containment inside the library root
 * before touching the filesystem (spec §6.9) — symlink escapes can only be
 * caught there.
 */

/**
 * A safe relative path is non-empty, uses forward slashes, and contains no
 * empty, ".", or ".." segments, no leading slash, no backslashes, and no
 * NUL bytes.
 */
export function isSafeRelPath(path: string): boolean {
  if (path.length === 0) return false;
  if (path.includes("\0") || path.includes("\\")) return false;
  const segments = path.split("/");
  return segments.every(
    (segment) => segment !== "" && segment !== "." && segment !== "..",
  );
}

/**
 * Build a URL path from a relative file path: each segment is
 * percent-encoded, but separators stay as real "/" characters. This avoids
 * `%2F` in URLs, which some reverse proxies reject before routing
 * (spec §6.2).
 */
export function encodePathForUrl(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** Join path segments, dropping empty parts. */
export function joinPath(...segments: string[]): string {
  return segments.filter((segment) => segment !== "").join("/");
}

/** Parent of a relative path, or "" for a top-level entry. */
export function parentPath(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

/** Final segment of a relative path. */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
