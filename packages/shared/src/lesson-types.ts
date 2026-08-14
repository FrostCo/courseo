/**
 * Lesson-type detection — the app's core "product knowledge".
 *
 * Kept in the shared package (pure, no runtime deps) so the server (scan)
 * and the web UI (viewer dispatch) classify files identically.
 *
 * Extension sets mirror the reference behavior in docs/spec.md §2.
 */

export type LessonType =
  | "video"
  | "audio"
  | "pdf"
  | "html"
  | "text"
  | "document"
  | "quiz";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".webm", ".mov", ".avi"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".aac"]);
const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const TEXT_EXTENSIONS = new Set([".txt", ".md"]);
const DOCUMENT_EXTENSIONS = new Set([".docx", ".doc", ".rtf"]);
const SUBTITLE_EXTENSIONS = new Set([".srt", ".vtt"]);

/**
 * Keyword match with explicit boundaries (JS \b treats "_" as a word
 * character, which would miss "quiz_3") so "latest.mp4" or "contest.txt"
 * are not quizzes, while "Unit Test.md", "final-exam.txt", and
 * "quiz_3.html" are.
 */
const QUIZ_KEYWORDS = /(^|[^a-z0-9])(quiz|exam|test|assessment)([^a-z0-9]|$)/i;

/** Lowercased extension including the dot, or "" when there is none. */
export function fileExtension(filename: string): string {
  const base = filename.slice(filename.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

/** Subtitle files attach to a video; they are not standalone lessons. */
export function isSubtitleFile(filename: string): boolean {
  return SUBTITLE_EXTENSIONS.has(fileExtension(filename));
}

/** "en", "eng", "en-US" — the tags the player's track labels understand. */
const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[a-z]{2,4})?$/i;

/**
 * True when a subtitle file is a sidecar for the lesson with the given
 * basename (extension already stripped): either the same basename
 * ("video.srt" for "video.mp4") or basename plus a language tag
 * ("video.en.srt", "video.en-US.srt"). A bare name prefix is NOT enough —
 * "1.1.srt" belongs to "1.1.mp4", not to "1.mp4".
 */
export function isSubtitleSidecarFor(
  subtitleFilename: string,
  lessonBase: string,
): boolean {
  if (!isSubtitleFile(subtitleFilename)) return false;
  const dot = subtitleFilename.lastIndexOf(".");
  const base = dot > 0 ? subtitleFilename.slice(0, dot) : subtitleFilename;
  if (base === lessonBase) return true;
  if (!base.startsWith(lessonBase + ".")) return false;
  return LANGUAGE_TAG.test(base.slice(lessonBase.length + 1));
}

/**
 * Detect the lesson type for a filename, or null when the file is not a
 * lesson at all (unknown extension, or a subtitle sidecar).
 *
 * Quiz detection only reclassifies text-like content (text/html/document/pdf)
 * — a video named "practice test.mp4" is still played as video.
 */
export function detectLessonType(filename: string): LessonType | null {
  const ext = fileExtension(filename);
  if (SUBTITLE_EXTENSIONS.has(ext)) return null;
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";

  let type: LessonType;
  if (ext === ".pdf") type = "pdf";
  else if (HTML_EXTENSIONS.has(ext)) type = "html";
  else if (TEXT_EXTENSIONS.has(ext)) type = "text";
  else if (DOCUMENT_EXTENSIONS.has(ext)) type = "document";
  else return null;

  const base = filename.slice(filename.lastIndexOf("/") + 1);
  return QUIZ_KEYWORDS.test(base) ? "quiz" : type;
}
