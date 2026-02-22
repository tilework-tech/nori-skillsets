/**
 * Tests for update prompt module
 *
 * Tests the update prompt presentation and user interaction handling.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import { getUpdateCommand, showUpdatePrompt } from "./updatePrompt.js";

vi.mock("@clack/prompts", () => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    step: vi.fn(),
    message: vi.fn(),
  },
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: "",
  })),
  confirm: vi.fn(),
  text: vi.fn(),
  select: vi.fn(),
  isCancel: vi.fn(),
}));

describe("updatePrompt", () => {
  describe("getUpdateCommand", () => {
    it("should return npm command for npm install source", () => {
      const result = getUpdateCommand({ installSource: "npm" });
      expect(result).not.toBeNull();
      expect(result!.displayCommand).toContain("npm");
      expect(result!.displayCommand).toContain("nori-skillsets");
    });

    it("should return bun command for bun install source", () => {
      const result = getUpdateCommand({ installSource: "bun" });
      expect(result).not.toBeNull();
      expect(result!.displayCommand).toContain("bun");
    });

    it("should return yarn command for yarn install source", () => {
      const result = getUpdateCommand({ installSource: "yarn" });
      expect(result).not.toBeNull();
      expect(result!.displayCommand).toContain("yarn");
    });

    it("should return pnpm command for pnpm install source", () => {
      const result = getUpdateCommand({ installSource: "pnpm" });
      expect(result).not.toBeNull();
      expect(result!.displayCommand).toContain("pnpm");
    });

    it("should return null for unknown install source", () => {
      const result = getUpdateCommand({ installSource: "unknown" });
      expect(result).toBeNull();
    });
  });

  describe("showUpdatePrompt", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should use log.warn and return skip in non-interactive mode", async () => {
      const clack = await import("@clack/prompts");

      const result = await showUpdatePrompt({
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
        isInteractive: false,
        updateCommand: getUpdateCommand({ installSource: "npm" }),
      });

      expect(result).toBe("skip");
      expect(clack.log.warn).toHaveBeenCalledWith(
        expect.stringContaining("1.0.0"),
      );
      expect(clack.log.warn).toHaveBeenCalledWith(
        expect.stringContaining("2.0.0"),
      );
      expect(clack.log.warn).toHaveBeenCalledWith(
        expect.stringContaining("npm install"),
      );
    });

    it("should use fallback command in non-interactive mode when updateCommand is null", async () => {
      const clack = await import("@clack/prompts");

      const result = await showUpdatePrompt({
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
        isInteractive: false,
        updateCommand: null,
      });

      expect(result).toBe("skip");
      expect(clack.log.warn).toHaveBeenCalledWith(
        expect.stringContaining("npm install -g nori-skillsets@latest"),
      );
    });

    it("should use clack select in interactive mode", async () => {
      const clack = await import("@clack/prompts");
      vi.mocked(clack.select).mockResolvedValueOnce("update");
      vi.mocked(clack.isCancel).mockReturnValue(false);

      const result = await showUpdatePrompt({
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
        isInteractive: true,
        updateCommand: getUpdateCommand({ installSource: "npm" }),
      });

      expect(result).toBe("update");
      expect(clack.select).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("1.0.0"),
          options: expect.arrayContaining([
            expect.objectContaining({ value: "update" }),
            expect.objectContaining({ value: "skip" }),
            expect.objectContaining({ value: "dismiss" }),
          ]),
        }),
      );
    });

    it("should return skip when user cancels the select prompt", async () => {
      const clack = await import("@clack/prompts");
      const cancelSymbol = Symbol("cancel");
      vi.mocked(clack.select).mockResolvedValueOnce(cancelSymbol);
      vi.mocked(clack.isCancel).mockReturnValue(true);

      const result = await showUpdatePrompt({
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
        isInteractive: true,
        updateCommand: getUpdateCommand({ installSource: "npm" }),
      });

      expect(result).toBe("skip");
    });

    it("should return dismiss when user selects dismiss", async () => {
      const clack = await import("@clack/prompts");
      vi.mocked(clack.select).mockResolvedValueOnce("dismiss");
      vi.mocked(clack.isCancel).mockReturnValue(false);

      const result = await showUpdatePrompt({
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
        isInteractive: true,
        updateCommand: getUpdateCommand({ installSource: "npm" }),
      });

      expect(result).toBe("dismiss");
    });
  });
});
