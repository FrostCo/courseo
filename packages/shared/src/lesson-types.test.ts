import { describe, expect, it } from "vitest";
import {
  detectLessonType,
  fileExtension,
  isSubtitleFile,
} from "./lesson-types.js";

describe("fileExtension", () => {
  it("lowercases and includes the dot", () => {
    expect(fileExtension("Lesson.MP4")).toBe(".mp4");
  });

  it("uses the last dot only", () => {
    expect(fileExtension("archive.tar.gz")).toBe(".gz");
  });

  it("ignores dots in directory names", () => {
    expect(fileExtension("Section 1.2/notes")).toBe("");
  });

  it("treats dotfiles as extensionless", () => {
    expect(fileExtension(".gitignore")).toBe("");
  });
});

describe("detectLessonType", () => {
  it.each([
    ["intro.mp4", "video"],
    ["lecture.MKV", "video"],
    ["clip.webm", "video"],
    ["episode.mp3", "audio"],
    ["sample.wav", "audio"],
    ["slides.pdf", "pdf"],
    ["page.html", "html"],
    ["page.htm", "html"],
    ["notes.txt", "text"],
    ["README.md", "text"],
    ["handout.docx", "document"],
    ["old.doc", "document"],
    ["legacy.rtf", "document"],
  ])("%s → %s", (filename, expected) => {
    expect(detectLessonType(filename)).toBe(expected);
  });

  it("returns null for unknown extensions and subtitles", () => {
    expect(detectLessonType("data.json")).toBeNull();
    expect(detectLessonType("noext")).toBeNull();
    expect(detectLessonType("captions.srt")).toBeNull();
    expect(detectLessonType("captions.vtt")).toBeNull();
  });

  it("reclassifies text-like files with quiz keywords", () => {
    expect(detectLessonType("Final Exam.pdf")).toBe("quiz");
    expect(detectLessonType("quiz_3.html")).toBe("quiz");
    expect(detectLessonType("Unit Test.md")).toBe("quiz");
    expect(detectLessonType("self-assessment.txt")).toBe("quiz");
  });

  it("does not reclassify media as quiz", () => {
    expect(detectLessonType("practice test.mp4")).toBe("video");
    expect(detectLessonType("exam review.mp3")).toBe("audio");
  });

  it("requires word boundaries for quiz keywords", () => {
    expect(detectLessonType("latest.txt")).toBe("text");
    expect(detectLessonType("contest rules.md")).toBe("text");
  });

  it("only matches quiz keywords in the filename, not the directory", () => {
    expect(detectLessonType("Test Prep/notes.txt")).toBe("text");
  });
});

describe("isSubtitleFile", () => {
  it("detects srt and vtt", () => {
    expect(isSubtitleFile("captions.srt")).toBe(true);
    expect(isSubtitleFile("captions.VTT")).toBe(true);
    expect(isSubtitleFile("lesson.mp4")).toBe(false);
  });
});
