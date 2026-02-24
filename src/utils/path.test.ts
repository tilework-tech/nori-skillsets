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
      configInstallDir: "/config/path",
    });
    expect(result.path).toBe("/custom/cli/path");
  });

  it("should use configInstallDir when no CLI flag provided", () => {
    const result = resolveInstallDir({
      configInstallDir: "/config/path",
    });
    expect(result.path).toBe("/config/path");
  });

  it("should fall back to home directory when no CLI flag and no config", () => {
    const result = resolveInstallDir({});
    expect(result.path).toBe(os.homedir());
  });

  it("should fall back to home directory when CLI flag is empty string", () => {
    const result = resolveInstallDir({
      cliInstallDir: "",
      configInstallDir: null,
    });
    expect(result.path).toBe(os.homedir());
  });

  it("should fall back to home directory when configInstallDir is null", () => {
    const result = resolveInstallDir({
      configInstallDir: null,
    });
    expect(result.path).toBe(os.homedir());
  });

  it("should normalize CLI flag with tilde expansion", () => {
    const result = resolveInstallDir({
      cliInstallDir: "~/my-project",
      configInstallDir: null,
    });
    expect(result.path).toBe(path.join(os.homedir(), "my-project"));
  });

  it("should prefer CLI flag over config even when both are provided", () => {
    const result = resolveInstallDir({
      cliInstallDir: "/from-cli",
      configInstallDir: "/from-config",
    });
    expect(result.path).toBe("/from-cli");
  });

  it("should normalize configInstallDir with tilde expansion", () => {
    const result = resolveInstallDir({
      configInstallDir: "~/my-project",
    });
    expect(result.path).toBe(path.join(os.homedir(), "my-project"));
  });

  it("should fall back to home directory when configInstallDir is empty string", () => {
    const result = resolveInstallDir({
      configInstallDir: "",
    });
    expect(result.path).toBe(os.homedir());
  });

  describe("source provenance", () => {
    it("should return source 'cli' when cliInstallDir is provided", () => {
      const result = resolveInstallDir({
        cliInstallDir: "/from-cli",
        configInstallDir: "/from-config",
      });
      expect(result.source).toBe("cli");
    });

    it("should return source 'config' when using configInstallDir", () => {
      const result = resolveInstallDir({
        configInstallDir: "/from-config",
      });
      expect(result.source).toBe("config");
    });

    it("should return source 'default' when falling back to home directory", () => {
      const result = resolveInstallDir({});
      expect(result.source).toBe("default");
    });

    it("should return source 'default' when configInstallDir is null", () => {
      const result = resolveInstallDir({
        configInstallDir: null,
      });
      expect(result.source).toBe("default");
    });

    it("should return source 'default' when configInstallDir is empty string", () => {
      const result = resolveInstallDir({
        configInstallDir: "",
      });
      expect(result.source).toBe("default");
    });

    it("should return source 'cli' even when cliInstallDir matches configInstallDir", () => {
      const result = resolveInstallDir({
        cliInstallDir: "/same/path",
        configInstallDir: "/same/path",
      });
      expect(result.source).toBe("cli");
    });
  });
});
