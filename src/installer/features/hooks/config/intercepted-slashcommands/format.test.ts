/**
 * Tests for format utilities
 */

import { describe, it, expect } from "vitest";

import { formatSuccess, formatError } from "./format.js";

// ANSI color codes for verification
const GREEN = "\x1b[0;32m";
const RED = "\x1b[0;31m";
const NC = "\x1b[0m"; // No Color / Reset

describe("formatSuccess", () => {
  it("should wrap single-line message with green color codes", () => {
    const result = formatSuccess({ message: "Hello" });

    expect(result).toBe(`${GREEN}Hello${NC}`);
  });

  it("should wrap each line separately for multi-line messages", () => {
    const result = formatSuccess({ message: "Line 1\nLine 2\nLine 3" });

    // Each line should have its own color codes
    expect(result).toBe(
      `${GREEN}Line 1${NC}\n${GREEN}Line 2${NC}\n${GREEN}Line 3${NC}`,
    );
  });

  it("should handle empty string", () => {
    const result = formatSuccess({ message: "" });

    expect(result).toBe(`${GREEN}${NC}`);
  });

  it("should handle message with only newlines", () => {
    const result = formatSuccess({ message: "\n\n" });

    // Empty lines should also be wrapped
    expect(result).toBe(`${GREEN}${NC}\n${GREEN}${NC}\n${GREEN}${NC}`);
  });

  it("should handle message ending with newline", () => {
    const result = formatSuccess({ message: "Hello\n" });

    expect(result).toBe(`${GREEN}Hello${NC}\n${GREEN}${NC}`);
  });
});

describe("formatError", () => {
  it("should wrap single-line message with red color codes", () => {
    const result = formatError({ message: "Error occurred" });

    expect(result).toBe(`${RED}Error occurred${NC}`);
  });

  it("should wrap each line separately for multi-line messages", () => {
    const result = formatError({ message: "Error 1\nError 2" });

    expect(result).toBe(`${RED}Error 1${NC}\n${RED}Error 2${NC}`);
  });

  it("should handle empty string", () => {
    const result = formatError({ message: "" });

    expect(result).toBe(`${RED}${NC}`);
  });

  it("should handle message with multiple consecutive newlines", () => {
    const result = formatError({ message: "Error\n\nDetails" });

    expect(result).toBe(`${RED}Error${NC}\n${RED}${NC}\n${RED}Details${NC}`);
  });
});

describe("soft wrap handling", () => {
  it("should pre-wrap long lines and apply colors to each wrapped line", () => {
    // Create a message longer than 80 chars (default terminal width)
    const longMessage = "a".repeat(100);
    const result = formatSuccess({ message: longMessage });

    // The message should be wrapped into multiple lines
    const lines = result.split("\n");
    expect(lines.length).toBeGreaterThan(1);

    // Each line should start with GREEN and end with NC
    for (const line of lines) {
      expect(line.startsWith(GREEN)).toBe(true);
      expect(line.endsWith(NC)).toBe(true);
    }
  });

  it("should handle mix of explicit newlines and long lines", () => {
    // First line is short, second line is long
    const message = "Short\n" + "b".repeat(100);
    const result = formatSuccess({ message });

    const lines = result.split("\n");
    // Should have at least 3 lines: "Short", and the long line wrapped
    expect(lines.length).toBeGreaterThanOrEqual(3);

    // Each line should have proper color codes
    for (const line of lines) {
      expect(line.startsWith(GREEN)).toBe(true);
      expect(line.endsWith(NC)).toBe(true);
    }
  });
});
