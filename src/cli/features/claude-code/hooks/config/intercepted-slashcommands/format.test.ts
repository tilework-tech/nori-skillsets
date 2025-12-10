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
  it("should wrap single-word message with green color codes", () => {
    const result = formatSuccess({ message: "Hello" });

    expect(result).toBe(`${GREEN}Hello${NC}`);
  });

  it("should wrap each word separately for multi-word messages", () => {
    const result = formatSuccess({ message: "Line 1\nLine 2\nLine 3" });

    // Each word should have its own color codes
    expect(result).toBe(
      `${GREEN}Line${NC} ${GREEN}1${NC}\n${GREEN}Line${NC} ${GREEN}2${NC}\n${GREEN}Line${NC} ${GREEN}3${NC}`,
    );
  });

  it("should handle empty string", () => {
    const result = formatSuccess({ message: "" });

    expect(result).toBe("");
  });

  it("should handle message with only newlines", () => {
    const result = formatSuccess({ message: "\n\n" });

    // Empty lines produce empty strings
    expect(result).toBe("\n\n");
  });

  it("should handle message ending with newline", () => {
    const result = formatSuccess({ message: "Hello\n" });

    expect(result).toBe(`${GREEN}Hello${NC}\n`);
  });
});

describe("formatError", () => {
  it("should wrap single-word message with red color codes", () => {
    const result = formatError({ message: "Error" });

    expect(result).toBe(`${RED}Error${NC}`);
  });

  it("should wrap each word separately for multi-word messages", () => {
    const result = formatError({ message: "Error 1\nError 2" });

    expect(result).toBe(
      `${RED}Error${NC} ${RED}1${NC}\n${RED}Error${NC} ${RED}2${NC}`,
    );
  });

  it("should handle empty string", () => {
    const result = formatError({ message: "" });

    expect(result).toBe("");
  });

  it("should handle message with multiple consecutive newlines", () => {
    const result = formatError({ message: "Error\n\nDetails" });

    expect(result).toBe(`${RED}Error${NC}\n\n${RED}Details${NC}`);
  });
});

describe("terminal re-wrap resilience", () => {
  /**
   * These tests verify that colors persist when Claude Code's terminal
   * re-wraps our output at a narrower width than we expected.
   *
   * The key insight: we can't predict the actual terminal width, so we
   * must color each word individually to survive any re-wrapping.
   */

  it("should color each word so colors persist after re-wrapping", () => {
    const message = "Hello world test";
    const result = formatSuccess({ message });

    // Each word should be individually colored
    // Format: GREEN + word + NC for each word, joined by spaces
    expect(result).toBe(
      `${GREEN}Hello${NC} ${GREEN}world${NC} ${GREEN}test${NC}`,
    );
  });

  it("should handle multi-word lines with explicit newlines", () => {
    const message = "Line one here\nLine two here";
    const result = formatSuccess({ message });

    // Each word on each line should be colored
    expect(result).toBe(
      `${GREEN}Line${NC} ${GREEN}one${NC} ${GREEN}here${NC}\n${GREEN}Line${NC} ${GREEN}two${NC} ${GREEN}here${NC}`,
    );
  });

  it("should handle multiple spaces between words", () => {
    const message = "Hello  world";
    const result = formatSuccess({ message });

    // Multiple spaces should be preserved, each word colored
    expect(result).toBe(`${GREEN}Hello${NC}  ${GREEN}world${NC}`);
  });

  it("should handle leading and trailing spaces", () => {
    const message = "  Hello world  ";
    const result = formatSuccess({ message });

    // Leading/trailing spaces preserved, words colored
    expect(result).toBe(`  ${GREEN}Hello${NC} ${GREEN}world${NC}  `);
  });

  it("should handle empty words from multiple spaces gracefully", () => {
    const message = "a   b";
    const result = formatSuccess({ message });

    // Three spaces between a and b
    expect(result).toBe(`${GREEN}a${NC}   ${GREEN}b${NC}`);
  });

  it("should work with formatError as well", () => {
    const message = "Error message here";
    const result = formatError({ message });

    expect(result).toBe(`${RED}Error${NC} ${RED}message${NC} ${RED}here${NC}`);
  });

  it("should handle real-world message that caused the bug", () => {
    const message =
      "Session transcripts are now DISABLED. Your conversations will not be summarized or stored.";
    const result = formatSuccess({ message });

    // Every word should start with GREEN and end with NC
    const words = message.split(" ");
    for (const word of words) {
      expect(result).toContain(`${GREEN}${word}${NC}`);
    }
  });
});
