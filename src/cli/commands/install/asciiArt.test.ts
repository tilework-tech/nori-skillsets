import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { displayNoriBanner } from "./asciiArt.js";

describe("displayNoriBanner", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it("should output NORI ASCII art to console", () => {
    displayNoriBanner();

    // Verify console.log was called
    expect(consoleLogSpy).toHaveBeenCalled();

    // Capture all output
    const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");

    // Verify ASCII art contains NORI in block letters
    expect(output).toContain("███╗   ██╗");
    expect(output).toContain("██████╗");
  });

  it("should apply blue color by default", () => {
    displayNoriBanner();

    // Capture all output
    const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");

    // Verify blue ANSI color code is present
    expect(output).toContain("\x1b[0;34m");
    // Verify reset code is present
    expect(output).toContain("\x1b[0m");
  });

  it("should allow custom color override", () => {
    const customColor = "\x1b[0;32m"; // Green
    displayNoriBanner({ color: customColor });

    // Capture all output
    const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");

    // Verify custom color code is present
    expect(output).toContain(customColor);
  });

  it("should handle null color parameter", () => {
    // Should not crash with null color
    expect(() => displayNoriBanner({ color: null })).not.toThrow();

    // Verify console.log was still called
    expect(consoleLogSpy).toHaveBeenCalled();
  });

  it("should output eight lines of ASCII art", () => {
    displayNoriBanner();

    // Each line of the banner should be a separate console.log call
    // Expected: 1 newline + 6 lines of banner + 1 newline = 8 total
    expect(consoleLogSpy.mock.calls.length).toBe(8);
  });

  it("should include all expected box-drawing characters", () => {
    displayNoriBanner();

    const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("");

    // Verify key box-drawing characters used in block letter NORI design
    const expectedChars = ["█", "╗", "║", "╔", "═", "╚", "╝"];

    expectedChars.forEach((char) => {
      expect(output).toContain(char);
    });
  });
});
