/**
 * Tests for @clack/prompts cancel handling utilities
 */

import * as clack from "@clack/prompts";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { handleCancel, isCancel } from "@/cli/prompts/utils.js";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  isCancel: vi.fn(),
  cancel: vi.fn(),
}));

describe("utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isCancel", () => {
    it("returns true when @clack/prompts isCancel returns true", () => {
      const cancelSymbol = Symbol("cancel");
      vi.mocked(clack.isCancel).mockReturnValue(true);

      const result = isCancel({ value: cancelSymbol });

      expect(result).toBe(true);
      expect(clack.isCancel).toHaveBeenCalledWith(cancelSymbol);
    });

    it("returns false when @clack/prompts isCancel returns false", () => {
      vi.mocked(clack.isCancel).mockReturnValue(false);

      const result = isCancel({ value: "some-value" });

      expect(result).toBe(false);
      expect(clack.isCancel).toHaveBeenCalledWith("some-value");
    });

    it("handles null values", () => {
      vi.mocked(clack.isCancel).mockReturnValue(false);

      const result = isCancel({ value: null });

      expect(result).toBe(false);
      expect(clack.isCancel).toHaveBeenCalledWith(null);
    });

    it("handles undefined values", () => {
      vi.mocked(clack.isCancel).mockReturnValue(false);

      const result = isCancel({ value: undefined });

      expect(result).toBe(false);
      expect(clack.isCancel).toHaveBeenCalledWith(undefined);
    });
  });

  describe("handleCancel", () => {
    beforeEach(() => {
      // Mock process.exit to throw so we can test it was called
      vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });
    });

    afterEach(() => {
      vi.mocked(process.exit).mockRestore();
    });

    it("calls clack cancel with default message and exits with code 0", () => {
      expect(() => handleCancel()).toThrow("process.exit called");

      expect(clack.cancel).toHaveBeenCalledWith("Operation cancelled.");
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    it("calls clack cancel with custom message and exits with code 0", () => {
      expect(() => handleCancel({ message: "Custom cancel message" })).toThrow(
        "process.exit called",
      );

      expect(clack.cancel).toHaveBeenCalledWith("Custom cancel message");
      expect(process.exit).toHaveBeenCalledWith(0);
    });
  });
});
