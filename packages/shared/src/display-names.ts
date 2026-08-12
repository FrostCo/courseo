/**
 * Presentation-only helpers that turn on-disk names into friendly display
 * names. Never used for filesystem operations — renames, URLs, and
 * progress keys always use the real names.
 */

export interface SplitName {
  /** Ordering prefix with leading zeros trimmed ("00" → "0"), or null. */
  ordinal: string | null;
  label: string;
}

/**
 * Split a "00-Name" / "3. Name" / "02_Name" / "4) Name" style ordering
 * prefix from a name. Capped at three digits so year prefixes
 * ("2024-Retrospective") stay intact.
 */
export function splitOrderingPrefix(name: string): SplitName {
  const match = /^(\d{1,3})(?:\s*[-_.:)]\s*|\s+)(.+)$/.exec(name);
  if (!match) return { ordinal: null, label: name };
  return { ordinal: String(Number(match[1])), label: match[2]! };
}

/** Drop a recognizable file extension for display ("intro.mp4" → "intro"). */
export function stripExtension(name: string): string {
  const stripped = name.replace(/\.[a-z0-9]{1,5}$/i, "");
  return stripped === "" ? name : stripped;
}
