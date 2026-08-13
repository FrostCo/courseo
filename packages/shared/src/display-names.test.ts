import { describe, expect, it } from "vitest";
import {
  replaceUnderscores,
  splitOrderingPrefix,
  stripExtension,
} from "./display-names.js";

describe("splitOrderingPrefix", () => {
  it("splits dash-style prefixes and trims leading zeros", () => {
    expect(splitOrderingPrefix("00-News & Announcements")).toEqual({
      ordinal: "0",
      label: "News & Announcements",
    });
    expect(splitOrderingPrefix("01-Getting Started")).toEqual({
      ordinal: "1",
      label: "Getting Started",
    });
  });

  it("supports common separator variants", () => {
    expect(splitOrderingPrefix("01 - Getting Started").ordinal).toBe("1");
    expect(splitOrderingPrefix("12. Introduction").ordinal).toBe("12");
    expect(splitOrderingPrefix("02_Setup").ordinal).toBe("2");
    expect(splitOrderingPrefix("4) Wrap-up").ordinal).toBe("4");
    expect(splitOrderingPrefix("10 Deep Dive").ordinal).toBe("10");
  });

  it("leaves unprefixed and year-prefixed names alone", () => {
    expect(splitOrderingPrefix("Introduction")).toEqual({
      ordinal: null,
      label: "Introduction",
    });
    expect(splitOrderingPrefix("2024-Retrospective").ordinal).toBeNull();
  });

  it("does not treat an all-numeric name as a prefix", () => {
    expect(splitOrderingPrefix("42").ordinal).toBeNull();
  });
});

describe("stripExtension", () => {
  it("drops recognizable extensions", () => {
    expect(stripExtension("intro.mp4")).toBe("intro");
    expect(stripExtension("notes.md")).toBe("notes");
    expect(stripExtension("archive.tar.gz")).toBe("archive.tar");
  });

  it("keeps names without extensions or with nothing before the dot", () => {
    expect(stripExtension("no-extension")).toBe("no-extension");
    expect(stripExtension(".hidden")).toBe(".hidden");
  });
});

describe("replaceUnderscores", () => {
  it("turns underscore separators into spaces", () => {
    expect(replaceUnderscores("Getting_Started_Guide")).toBe(
      "Getting Started Guide",
    );
    expect(replaceUnderscores("double__underscore")).toBe(
      "double underscore",
    );
  });

  it("leaves normal names and degenerate cases alone", () => {
    expect(replaceUnderscores("Getting Started")).toBe("Getting Started");
    expect(replaceUnderscores("___")).toBe("___");
  });
});
