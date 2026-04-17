/**
 * Tests for per-file change list formatting helpers.
 *
 * These helpers produce user-visible strings that appear in clack `note`s and
 * in option hints. Tests pin down the human-readable output, not internals.
 */

import { describe, it, expect } from "vitest";

import type { FileChange } from "@/api/registrar.js";

import {
  countFileChanges,
  formatDiscardHint,
  formatFileChangesForNote,
  summarizeFileChangeCounts,
} from "./fileChangesFormat.js";

describe("formatFileChangesForNote", () => {
  it("lists each file with its status on its own line, sorted by path", () => {
    const fileChanges: ReadonlyArray<FileChange> = [
      { path: "helpers/foo.py", status: "added", isBinary: false },
      { path: "assets/logo.png", status: "modified", isBinary: true },
      { path: "SKILL.md", status: "modified", isBinary: false },
    ];

    const output = formatFileChangesForNote({ fileChanges });
    const lines = output.split("\n");

    // All three paths appear, one per line, and the list is sorted stably
    // regardless of input order.
    expect(lines).toHaveLength(3);
    const joined = lines.join("\n");
    expect(joined).toContain("SKILL.md");
    expect(joined).toContain("helpers/foo.py");
    expect(joined).toContain("assets/logo.png");

    // Confirm sort is stable: re-formatting the same input twice in different
    // orders produces the same string.
    const output2 = formatFileChangesForNote({
      fileChanges: [
        { path: "SKILL.md", status: "modified", isBinary: false },
        { path: "assets/logo.png", status: "modified", isBinary: true },
        { path: "helpers/foo.py", status: "added", isBinary: false },
      ],
    });
    expect(output).toBe(output2);
  });

  it("marks binary files with a (binary) tag", () => {
    const output = formatFileChangesForNote({
      fileChanges: [
        { path: "logo.png", status: "modified", isBinary: true },
        { path: "README.md", status: "modified", isBinary: false },
      ],
    });

    const logoLine = output
      .split("\n")
      .find((l) => l.includes("logo.png")) as string;
    const readmeLine = output
      .split("\n")
      .find((l) => l.includes("README.md")) as string;

    expect(logoLine).toContain("binary");
    expect(readmeLine).not.toContain("binary");
  });

  it("renders removed and added statuses", () => {
    const output = formatFileChangesForNote({
      fileChanges: [
        { path: "old.py", status: "removed", isBinary: false },
        { path: "new.py", status: "added", isBinary: false },
      ],
    });

    expect(output).toContain("removed");
    expect(output).toContain("added");
  });

  it("does not leak existingContent into the rendered output", () => {
    const output = formatFileChangesForNote({
      fileChanges: [
        {
          path: "SKILL.md",
          status: "modified",
          isBinary: false,
          existingContent: "SECRET_EXISTING_CONTENT_MARKER",
        },
      ],
    });

    expect(output).not.toContain("SECRET_EXISTING_CONTENT_MARKER");
  });

  it("returns empty string when list is empty", () => {
    expect(formatFileChangesForNote({ fileChanges: [] })).toBe("");
  });
});

describe("countFileChanges", () => {
  it("returns the entry count, treating null/undefined/empty as 0", () => {
    expect(
      countFileChanges({
        fileChanges: [
          { path: "a", status: "added", isBinary: false },
          { path: "b", status: "modified", isBinary: false },
        ],
      }),
    ).toBe(2);
    expect(countFileChanges({ fileChanges: null })).toBe(0);
    expect(countFileChanges({})).toBe(0);
    expect(countFileChanges({ fileChanges: [] })).toBe(0);
  });
});

describe("formatDiscardHint", () => {
  it("returns a pluralized clause for counts greater than 1", () => {
    expect(formatDiscardHint({ count: 3 })).toContain("3 file changes");
    expect(formatDiscardHint({ count: 3 })).not.toContain("3 file change.");
  });

  it("returns a singular clause for count of exactly 1", () => {
    const hint = formatDiscardHint({ count: 1 });
    expect(hint).toContain("1 file change");
    expect(hint).not.toContain("1 file changes");
  });

  it("returns the generic fallback for zero or negative counts", () => {
    expect(formatDiscardHint({ count: 0 })).toContain("any local changes");
    expect(formatDiscardHint({ count: 0 })).not.toMatch(/\d/);
  });
});

describe("summarizeFileChangeCounts", () => {
  it("produces a compact tally string with non-zero status groups", () => {
    const output = summarizeFileChangeCounts({
      fileChanges: [
        { path: "a", status: "added", isBinary: false },
        { path: "b", status: "added", isBinary: false },
        { path: "c", status: "modified", isBinary: false },
        { path: "d", status: "removed", isBinary: false },
      ],
    });

    // e.g. "2 added, 1 modified, 1 removed"
    expect(output).toContain("2 added");
    expect(output).toContain("1 modified");
    expect(output).toContain("1 removed");
  });

  it("omits status groups with zero count", () => {
    const output = summarizeFileChangeCounts({
      fileChanges: [
        { path: "a", status: "added", isBinary: false },
        { path: "b", status: "added", isBinary: false },
      ],
    });

    expect(output).toContain("2 added");
    expect(output).not.toContain("modified");
    expect(output).not.toContain("removed");
  });

  it("returns empty string when there are no changes", () => {
    expect(summarizeFileChangeCounts({ fileChanges: [] })).toBe("");
    expect(summarizeFileChangeCounts({ fileChanges: null })).toBe("");
    expect(summarizeFileChangeCounts({})).toBe("");
  });
});
