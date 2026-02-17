/**
 * Tests for update prompt module
 *
 * Tests the update prompt presentation and user interaction handling.
 */

import * as clack from "@clack/prompts";
import { describe, it, expect, vi, afterEach } from "vitest";

import {
  formatUpdateMessage,
  getUpdateCommand,
  showUpdatePrompt,
} from "./updatePrompt.js";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    message: vi.fn(),
  },
  select: vi.fn(),
  isCancel: vi.fn(() => false),
}));

describe("updatePrompt", () => {
  describe("formatUpdateMessage", () => {
    it("should include current and latest version", () => {
      const message = formatUpdateMessage({
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
      });
      expect(message).toContain("1.0.0");
      expect(message).toContain("2.0.0");
    });

    it("should include update available text", () => {
      const message = formatUpdateMessage({
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
      });
      expect(message.toLowerCase()).toContain("update available");
    });
  });

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

    it("should log info and return skip in non-interactive mode", async () => {
      const result = await showUpdatePrompt({
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
        isInteractive: false,
        updateCommand: getUpdateCommand({ installSource: "npm" }),
      });

      expect(result).toBe("skip");
      expect(clack.log.info).toHaveBeenCalled();
      const infoMessage = vi.mocked(clack.log.info).mock.calls[0][0] as string;
      expect(infoMessage).toContain("1.0.0");
      expect(infoMessage).toContain("2.0.0");
      expect(infoMessage).toContain("npm install");
    });

    it("should use fallback command in non-interactive mode when updateCommand is null", async () => {
      const result = await showUpdatePrompt({
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
        isInteractive: false,
        updateCommand: null,
      });

      expect(result).toBe("skip");
      const infoMessage = vi.mocked(clack.log.info).mock.calls[0][0] as string;
      expect(infoMessage).toContain("npm install -g nori-skillsets@latest");
    });

    it("should use select prompt in interactive mode", async () => {
      vi.mocked(clack.select).mockResolvedValueOnce("update");

      const result = await showUpdatePrompt({
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
        isInteractive: true,
        updateCommand: getUpdateCommand({ installSource: "npm" }),
      });

      expect(result).toBe("update");
      expect(clack.log.warn).toHaveBeenCalled();
      expect(clack.select).toHaveBeenCalled();
    });

    it("should return skip when user cancels interactive prompt", async () => {
      vi.mocked(clack.select).mockResolvedValueOnce(Symbol("cancel"));
      vi.mocked(clack.isCancel).mockReturnValueOnce(true);

      const result = await showUpdatePrompt({
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
        isInteractive: true,
        updateCommand: getUpdateCommand({ installSource: "npm" }),
      });

      expect(result).toBe("skip");
    });
  });
});
