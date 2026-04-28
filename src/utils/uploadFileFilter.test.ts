/**
 * Tests for upload file filter
 */

import { describe, it, expect } from "vitest";

import { shouldExcludeFromUpload } from "./uploadFileFilter.js";

describe("shouldExcludeFromUpload", () => {
  it("excludes the local download metadata file", () => {
    expect(shouldExcludeFromUpload({ fileName: ".nori-version" })).toBe(true);
  });

  it("excludes vim swap files (.swp/.swo)", () => {
    expect(shouldExcludeFromUpload({ fileName: ".SKILL.md.swp" })).toBe(true);
    expect(shouldExcludeFromUpload({ fileName: ".SKILL.md.swo" })).toBe(true);
    expect(shouldExcludeFromUpload({ fileName: ".notes.txt.swp" })).toBe(true);
  });

  it("excludes Vim/Emacs backup files (trailing tilde)", () => {
    expect(shouldExcludeFromUpload({ fileName: "SKILL.md~" })).toBe(true);
    expect(shouldExcludeFromUpload({ fileName: "notes.txt~" })).toBe(true);
  });

  it("excludes macOS Finder metadata", () => {
    expect(shouldExcludeFromUpload({ fileName: ".DS_Store" })).toBe(true);
  });

  it("excludes macOS AppleDouble resource forks", () => {
    expect(shouldExcludeFromUpload({ fileName: "._SKILL.md" })).toBe(true);
    expect(shouldExcludeFromUpload({ fileName: "._image.png" })).toBe(true);
  });

  it("excludes Windows thumbnail database", () => {
    expect(shouldExcludeFromUpload({ fileName: "Thumbs.db" })).toBe(true);
  });

  it("does not exclude regular skill content files", () => {
    expect(shouldExcludeFromUpload({ fileName: "SKILL.md" })).toBe(false);
    expect(shouldExcludeFromUpload({ fileName: "nori.json" })).toBe(false);
    expect(shouldExcludeFromUpload({ fileName: "AGENTS.md" })).toBe(false);
    expect(shouldExcludeFromUpload({ fileName: "script.sh" })).toBe(false);
    expect(shouldExcludeFromUpload({ fileName: "README.md" })).toBe(false);
  });

  it("does not exclude files with tilde elsewhere in the name", () => {
    expect(shouldExcludeFromUpload({ fileName: "~tildaFile.md" })).toBe(false);
    expect(shouldExcludeFromUpload({ fileName: "some~file.md" })).toBe(false);
  });

  it("does not exclude files that merely contain 'swp' but are not swap files", () => {
    expect(shouldExcludeFromUpload({ fileName: "swap.md" })).toBe(false);
    expect(shouldExcludeFromUpload({ fileName: "myswp.txt" })).toBe(false);
  });

  it("does not exclude DS_Store-lookalikes that don't match exactly", () => {
    expect(shouldExcludeFromUpload({ fileName: ".ds_store" })).toBe(false);
    expect(shouldExcludeFromUpload({ fileName: "DS_Store" })).toBe(false);
  });

  it("matches the basename when given a relative or absolute path", () => {
    expect(
      shouldExcludeFromUpload({
        fileName: "skills/my-skill/.SKILL.md.swp",
      }),
    ).toBe(true);
    expect(
      shouldExcludeFromUpload({
        fileName: "/abs/path/.DS_Store",
      }),
    ).toBe(true);
    expect(
      shouldExcludeFromUpload({
        fileName: "skills/my-skill/SKILL.md",
      }),
    ).toBe(false);
  });
});
