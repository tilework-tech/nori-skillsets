/**
 * Tests for @clack/prompts cancel handling utilities
 */

import * as clack from "@clack/prompts";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { handleCancel } from "@/cli/prompts/utils.js";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  cancel: vi.fn(),
}));

describe("utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
