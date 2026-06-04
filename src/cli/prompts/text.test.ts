/**
 * Tests for @clack/prompts text wrapper
 */

import * as clack from "@clack/prompts";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { promptText } from "@/cli/prompts/text.js";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  text: vi.fn(),
  isCancel: vi.fn(),
  cancel: vi.fn(),
}));

describe("text", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("promptText", () => {
    it("returns user input when valid", async () => {
      vi.mocked(clack.text).mockResolvedValueOnce("user-input");
      vi.mocked(clack.isCancel).mockReturnValue(false);

      const result = await promptText({ message: "Enter name:" });

      expect(result).toBe("user-input");
      expect(clack.text).toHaveBeenCalledWith({
        message: "Enter name:",
      });
    });

    it("passes placeholder when provided", async () => {
      vi.mocked(clack.text).mockResolvedValueOnce("user-input");
      vi.mocked(clack.isCancel).mockReturnValue(false);

      await promptText({ message: "Enter name:", placeholder: "my-name" });

      expect(clack.text).toHaveBeenCalledWith({
        message: "Enter name:",
        placeholder: "my-name",
      });
    });

    it("passes validation function when provided", async () => {
      vi.mocked(clack.text).mockResolvedValueOnce("valid-input");
      vi.mocked(clack.isCancel).mockReturnValue(false);

      const customValidate = vi.fn().mockReturnValue(undefined);

      await promptText({
        message: "Enter name:",
        validate: customValidate,
      });

      // Verify that clack.text was called with a validate function
      const callArgs = vi.mocked(clack.text).mock.calls[0][0];
      expect(typeof callArgs.validate).toBe("function");

      // Call the validate function to ensure it delegates to our custom one
      if (typeof callArgs.validate === "function") {
        callArgs.validate("test-value");
      }
      expect(customValidate).toHaveBeenCalledWith({ value: "test-value" });
    });

    it("calls handleCancel and exits when user cancels", async () => {
      const cancelSymbol = Symbol("cancel");
      vi.mocked(clack.text).mockResolvedValueOnce(cancelSymbol as any);
      vi.mocked(clack.isCancel).mockReturnValue(true);

      // Mock process.exit to throw so we can test it was called
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      await expect(promptText({ message: "Enter name:" })).rejects.toThrow(
        "process.exit called",
      );

      expect(clack.cancel).toHaveBeenCalledWith("Operation cancelled.");
      expect(exitSpy).toHaveBeenCalledWith(0);

      exitSpy.mockRestore();
    });

    it("passes defaultValue when provided", async () => {
      vi.mocked(clack.text).mockResolvedValueOnce("default-value");
      vi.mocked(clack.isCancel).mockReturnValue(false);

      await promptText({
        message: "Enter name:",
        defaultValue: "default-value",
      });

      expect(clack.text).toHaveBeenCalledWith({
        message: "Enter name:",
        defaultValue: "default-value",
      });
    });

    it("passes initialValue when provided", async () => {
      vi.mocked(clack.text).mockResolvedValueOnce("initial-value");
      vi.mocked(clack.isCancel).mockReturnValue(false);

      await promptText({
        message: "Enter name:",
        initialValue: "initial-value",
      });

      expect(clack.text).toHaveBeenCalledWith({
        message: "Enter name:",
        initialValue: "initial-value",
      });
    });
  });
});
