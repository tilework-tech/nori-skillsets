/**
 * Tests for path utility functions
 */

import * as os from "os";
import * as path from "path";

import { describe, it, expect } from "vitest";

import { normalizeInstallDir, resolveInstallDir } from "./path.js";

describe("normalizeInstallDir", () => {
  describe("default behavior", () => {
    it("should return os.homedir() when no installDir provided", () => {
      const result = normalizeInstallDir({});
      expect(result).toBe(os.homedir());
    });

    it("should return os.homedir() when installDir is null", () => {
      const result = normalizeInstallDir({ installDir: null });
      expect(result).toBe(os.homedir());
    });

    it("should return os.homedir() when installDir is undefined", () => {
      const result = normalizeInstallDir({ installDir: undefined });
      expect(result).toBe(os.homedir());
    });
  });

  describe("custom installDir", () => {
    it("should return the provided absolute path as base directory", () => {
      const result = normalizeInstallDir({ installDir: "/custom/path" });
      expect(result).toBe("/custom/path");
    });

    it("should expand tilde to home directory", () => {
      const result = normalizeInstallDir({ installDir: "~/my-project" });
      expect(result).toBe(path.join(os.homedir(), "my-project"));
    });

    it("should resolve relative paths to absolute paths", () => {
      const result = normalizeInstallDir({ installDir: "./my-project" });
      expect(result).toBe(path.join(process.cwd(), "my-project"));
    });

    it("should handle paths with trailing slashes", () => {
      const result = normalizeInstallDir({ installDir: "/custom/path/" });
      expect(result).toBe("/custom/path");
    });

    it("should not strip .claude suffix when no agentDirNames provided", () => {
      const result = normalizeInstallDir({
        installDir: "/custom/path/.claude",
      });
      expect(result).toBe("/custom/path/.claude");
    });

    it("should strip configured agent dir suffixes", () => {
      const result = normalizeInstallDir({
        installDir: "/custom/path/.claude",
        agentDirNames: [".claude"],
      });
      expect(result).toBe("/custom/path");
    });

    it("should strip any matching agent dir suffix from multiple options", () => {
      const result = normalizeInstallDir({
        installDir: "/custom/path/.cursor",
        agentDirNames: [".claude", ".cursor"],
      });
      expect(result).toBe("/custom/path");
    });

    it("should not strip non-matching agent dir suffixes", () => {
      const result = normalizeInstallDir({
        installDir: "/custom/path/.other",
        agentDirNames: [".claude", ".cursor"],
      });
      expect(result).toBe("/custom/path/.other");
    });
  });

  describe("edge cases", () => {
    it("should handle empty string by using home directory", () => {
      const result = normalizeInstallDir({ installDir: "" });
      expect(result).toBe(os.homedir());
    });

    it("should handle paths with spaces", () => {
      const result = normalizeInstallDir({
        installDir: "/path/with spaces/project",
      });
      expect(result).toBe("/path/with spaces/project");
    });

    it("should normalize multiple slashes", () => {
      const result = normalizeInstallDir({
        installDir: "/custom//path///project",
      });
      expect(result).toBe("/custom/path/project");
    });
  });
});

describe("resolveInstallDir", () => {
  it("should use CLI flag when provided", () => {
    const result = resolveInstallDir({
      cliInstallDir: "/custom/cli/path",
      config: { installDir: "/config/path" },
    });
    expect(result).toBe("/custom/cli/path");
  });

  it("should use config.installDir when no CLI flag provided", () => {
    const result = resolveInstallDir({
      config: { installDir: "/config/path" },
    });
    expect(result).toBe("/config/path");
  });

  it("should fall back to home directory when no CLI flag and no config", () => {
    const result = resolveInstallDir({});
    expect(result).toBe(os.homedir());
  });

  it("should fall back to home directory when CLI flag is empty string", () => {
    const result = resolveInstallDir({
      cliInstallDir: "",
      config: null,
    });
    expect(result).toBe(os.homedir());
  });

  it("should fall back to home directory when config is null", () => {
    const result = resolveInstallDir({
      config: null,
    });
    expect(result).toBe(os.homedir());
  });

  it("should normalize CLI flag with tilde expansion", () => {
    const result = resolveInstallDir({
      cliInstallDir: "~/my-project",
      config: null,
    });
    expect(result).toBe(path.join(os.homedir(), "my-project"));
  });

  it("should prefer CLI flag over config even when both are provided", () => {
    const result = resolveInstallDir({
      cliInstallDir: "/from-cli",
      config: { installDir: "/from-config" },
    });
    expect(result).toBe("/from-cli");
  });

  it("should normalize config.installDir with tilde expansion", () => {
    const result = resolveInstallDir({
      config: { installDir: "~/my-project" },
    });
    expect(result).toBe(path.join(os.homedir(), "my-project"));
  });

  it("should fall back to home directory when config.installDir is empty string", () => {
    const result = resolveInstallDir({
      config: { installDir: "" },
    });
    expect(result).toBe(os.homedir());
  });
});
