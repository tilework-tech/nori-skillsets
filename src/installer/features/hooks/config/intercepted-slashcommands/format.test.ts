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
