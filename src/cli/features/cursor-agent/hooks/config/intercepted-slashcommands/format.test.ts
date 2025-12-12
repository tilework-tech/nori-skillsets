/**
 * Tests for cursor-agent format utilities
 *
 * Cursor IDE does not render ANSI escape codes in its UI,
 * so format functions must return plain text (no ANSI codes).
 */

import { describe, expect, it } from "vitest";

import { formatError, formatSuccess } from "./format.js";

// ANSI escape code pattern - should NOT be present in output
const ANSI_PATTERN = /\x1b\[[0-9;]*m/;

describe("formatSuccess", () => {
  it("should return plain text without ANSI codes", () => {
    const result = formatSuccess({ message: "Hello world" });

    expect(result).not.toMatch(ANSI_PATTERN);
  });

  it("should prefix message with success symbol", () => {
    const result = formatSuccess({ message: "Operation complete" });

    expect(result).toBe("✓ Operation complete");
  });

  it("should preserve multiline messages", () => {
    const result = formatSuccess({ message: "Line 1\nLine 2\nLine 3" });

    expect(result).toBe("✓ Line 1\nLine 2\nLine 3");
    expect(result).not.toMatch(ANSI_PATTERN);
  });

  it("should handle empty message", () => {
    const result = formatSuccess({ message: "" });

    expect(result).toBe("✓ ");
    expect(result).not.toMatch(ANSI_PATTERN);
  });
});

describe("formatError", () => {
  it("should return plain text without ANSI codes", () => {
    const result = formatError({ message: "Something went wrong" });

    expect(result).not.toMatch(ANSI_PATTERN);
  });

  it("should prefix message with error symbol", () => {
    const result = formatError({ message: "File not found" });

    expect(result).toBe("✗ File not found");
  });

  it("should preserve multiline messages", () => {
    const result = formatError({ message: "Error 1\nError 2" });

    expect(result).toBe("✗ Error 1\nError 2");
    expect(result).not.toMatch(ANSI_PATTERN);
  });

  it("should handle empty message", () => {
    const result = formatError({ message: "" });

    expect(result).toBe("✗ ");
    expect(result).not.toMatch(ANSI_PATTERN);
  });
});
