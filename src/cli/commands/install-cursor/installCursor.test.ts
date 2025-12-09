/**
 * Tests for install-cursor CLI command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { installCursorMain } from "./installCursor.js";

describe("install-cursor command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {
      // Suppress console output during tests
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should output 'unimplemented'", async () => {
    await installCursorMain();

    expect(consoleSpy).toHaveBeenCalledWith("unimplemented");
  });
});
