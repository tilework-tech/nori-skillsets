/**
 * Tests for update prompt module
 *
 * Tests the update prompt presentation and user interaction handling.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import {
  formatUpdateMessage,
  getUpdateCommand,
  showUpdatePrompt,
} from "./updatePrompt.js";

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

    it("should print to stderr and return skip in non-interactive mode", async () => {
      const stderrSpy = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);

      const result = await showUpdatePrompt({
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
        isInteractive: false,
        updateCommand: getUpdateCommand({ installSource: "npm" }),
      });

      expect(result).toBe("skip");
      expect(stderrSpy).toHaveBeenCalled();
      const written = stderrSpy.mock.calls[0][0] as string;
      expect(written).toContain("1.0.0");
      expect(written).toContain("2.0.0");
      expect(written).toContain("npm install");
    });

    it("should use fallback command in non-interactive mode when updateCommand is null", async () => {
      const stderrSpy = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);

      const result = await showUpdatePrompt({
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
        isInteractive: false,
        updateCommand: null,
      });

      expect(result).toBe("skip");
      const written = stderrSpy.mock.calls[0][0] as string;
      expect(written).toContain("npm install -g nori-skillsets@latest");
    });
  });
});
