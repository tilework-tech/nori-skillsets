/**
 * Tests for diffFormat shared utility
 */

import { describe, expect, it } from "vitest";

import { formatDiffForNote } from "./diffFormat.js";

describe("formatDiffForNote", () => {
  it("should show added lines with green + prefix", () => {
    const result = formatDiffForNote({
      existingContent: "line1\n",
      localContent: "line1\nline2\n",
    });

    expect(result).toContain("+ line2");
  });

  it("should show removed lines with red - prefix", () => {
    const result = formatDiffForNote({
      existingContent: "line1\nline2\n",
      localContent: "line1\n",
    });

    expect(result).toContain("- line2");
  });

  it("should show unchanged lines with space prefix", () => {
    const result = formatDiffForNote({
      existingContent: "line1\nline2\n",
      localContent: "line1\nline2\n",
    });

    expect(result).toContain("  line1");
    expect(result).toContain("  line2");
  });

  it("should handle completely different content", () => {
    const result = formatDiffForNote({
      existingContent: "old content\n",
      localContent: "new content\n",
    });

    expect(result).toContain("- old content");
    expect(result).toContain("+ new content");
  });

  it("should handle empty existing content", () => {
    const result = formatDiffForNote({
      existingContent: "",
      localContent: "new line\n",
    });

    expect(result).toContain("+ new line");
  });

  it("should handle empty local content", () => {
    const result = formatDiffForNote({
      existingContent: "old line\n",
      localContent: "",
    });

    expect(result).toContain("- old line");
  });
});
