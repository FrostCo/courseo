import { describe, expect, it } from "vitest";
import {
  baseName,
  encodePathForUrl,
  isSafeRelPath,
  isValidName,
  joinPath,
  parentPath,
} from "./paths.js";

describe("isValidName", () => {
  it("accepts ordinary folder and file names", () => {
    expect(isValidName("Jane Author")).toBe(true);
    expect(isValidName("01 Intro & Basics")).toBe(true);
    expect(isValidName("lesson.mp4")).toBe(true);
  });

  it("rejects separators, traversal, and hidden names", () => {
    expect(isValidName("a/b")).toBe(false);
    expect(isValidName("a\\b")).toBe(false);
    expect(isValidName("..")).toBe(false);
    expect(isValidName(".hidden")).toBe(false);
  });

  it("rejects empty, untrimmed, trailing-dot, and control chars", () => {
    expect(isValidName("")).toBe(false);
    expect(isValidName(" padded ")).toBe(false);
    expect(isValidName("name.")).toBe(false);
    expect(isValidName("a\tb")).toBe(false);
  });
});

describe("isSafeRelPath", () => {
  it("accepts normal relative paths", () => {
    expect(isSafeRelPath("Section 1/lesson.mp4")).toBe(true);
    expect(isSafeRelPath("notes.txt")).toBe(true);
  });

  it("rejects traversal and absolute paths", () => {
    expect(isSafeRelPath("../escape")).toBe(false);
    expect(isSafeRelPath("a/../b")).toBe(false);
    expect(isSafeRelPath("/etc/passwd")).toBe(false);
    expect(isSafeRelPath("a/./b")).toBe(false);
  });

  it("rejects empty paths, empty segments, backslashes, and NUL", () => {
    expect(isSafeRelPath("")).toBe(false);
    expect(isSafeRelPath("a//b")).toBe(false);
    expect(isSafeRelPath("a/")).toBe(false);
    expect(isSafeRelPath("a\\b")).toBe(false);
    expect(isSafeRelPath("a\0b")).toBe(false);
  });
});

describe("encodePathForUrl", () => {
  it("encodes segments but keeps real slashes (no %2F)", () => {
    const encoded = encodePathForUrl("Section 1/lesson & notes.pdf");
    expect(encoded).toBe("Section%201/lesson%20%26%20notes.pdf");
    expect(encoded).not.toContain("%2F");
  });
});

describe("joinPath / parentPath / baseName", () => {
  it("joins while dropping empty segments", () => {
    expect(joinPath("", "a", "b")).toBe("a/b");
    expect(joinPath("a")).toBe("a");
  });

  it("splits parent and base", () => {
    expect(parentPath("a/b/c.txt")).toBe("a/b");
    expect(parentPath("c.txt")).toBe("");
    expect(baseName("a/b/c.txt")).toBe("c.txt");
    expect(baseName("c.txt")).toBe("c.txt");
  });
});
