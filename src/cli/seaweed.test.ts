/**
 * Tests for the seaweed CLI
 *
 * The seaweed CLI is a minimal registry-focused CLI that provides simplified commands:
 * - search (searches org registry)
 * - download (downloads profile package)
 * - install (downloads and installs profile)
 * - download-skill (downloads skill package)
 * - switch-skillset (switches skillset)
 * - version (built-in)
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("seaweed CLI", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "seaweed-cli-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should have the correct CLI name", () => {
    let output = "";

    try {
      output = execSync("node build/src/cli/seaweed.js --help", {
        encoding: "utf-8",
        stdio: "pipe",
        env: { ...process.env, FORCE_COLOR: "0", HOME: tempDir },
      });
    } catch (error: unknown) {
      if (error && typeof error === "object") {
        const execError = error as { stdout?: string; stderr?: string };
        output = execError.stdout || execError.stderr || "";
      }
    }

    // Verify the CLI is named "seaweed"
    expect(output).toContain("Usage: seaweed");
  });

  it("should show version when --version flag is used", () => {
    let output = "";

    try {
      output = execSync("node build/src/cli/seaweed.js --version", {
        encoding: "utf-8",
        stdio: "pipe",
        env: { ...process.env, FORCE_COLOR: "0", HOME: tempDir },
      });
    } catch (error: unknown) {
      if (error && typeof error === "object") {
        const execError = error as { stdout?: string; stderr?: string };
        output = execError.stdout || execError.stderr || "";
      }
    }

    // Should output a version number (e.g., "19.1.6")
    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("should have search command (simplified from registry-search)", () => {
    let output = "";

    try {
      output = execSync("node build/src/cli/seaweed.js --help", {
        encoding: "utf-8",
        stdio: "pipe",
        env: { ...process.env, FORCE_COLOR: "0", HOME: tempDir },
      });
    } catch (error: unknown) {
      if (error && typeof error === "object") {
        const execError = error as { stdout?: string; stderr?: string };
        output = execError.stdout || execError.stderr || "";
      }
    }

    // Should have "search" as a command (not registry-search)
    const lines = output.split("\n");
    const hasSearchCommand = lines.some(
      (line) =>
        line.trim().startsWith("search ") || line.trim().startsWith("search\t"),
    );
    expect(hasSearchCommand).toBe(true);
  });

  it("should have download command (simplified from registry-download)", () => {
    let output = "";

    try {
      output = execSync("node build/src/cli/seaweed.js --help", {
        encoding: "utf-8",
        stdio: "pipe",
        env: { ...process.env, FORCE_COLOR: "0", HOME: tempDir },
      });
    } catch (error: unknown) {
      if (error && typeof error === "object") {
        const execError = error as { stdout?: string; stderr?: string };
        output = execError.stdout || execError.stderr || "";
      }
    }

    // Should have "download" as a command (not registry-download)
    const lines = output.split("\n");
    const hasDownloadCommand = lines.some(
      (line) =>
        line.trim().startsWith("download ") ||
        line.trim().startsWith("download\t"),
    );
    expect(hasDownloadCommand).toBe(true);
  });

  it("should have install command (simplified from registry-install)", () => {
    let output = "";

    try {
      output = execSync("node build/src/cli/seaweed.js --help", {
        encoding: "utf-8",
        stdio: "pipe",
        env: { ...process.env, FORCE_COLOR: "0", HOME: tempDir },
      });
    } catch (error: unknown) {
      if (error && typeof error === "object") {
        const execError = error as { stdout?: string; stderr?: string };
        output = execError.stdout || execError.stderr || "";
      }
    }

    // Should have "install" as a command (simplified from registry-install)
    const lines = output.split("\n");
    const hasInstallCommand = lines.some(
      (line) =>
        line.trim().startsWith("install ") ||
        line.trim().startsWith("install\t"),
    );
    expect(hasInstallCommand).toBe(true);
  });

  it("should have switch-skillset command", () => {
    let output = "";

    try {
      output = execSync("node build/src/cli/seaweed.js --help", {
        encoding: "utf-8",
        stdio: "pipe",
        env: { ...process.env, FORCE_COLOR: "0", HOME: tempDir },
      });
    } catch (error: unknown) {
      if (error && typeof error === "object") {
        const execError = error as { stdout?: string; stderr?: string };
        output = execError.stdout || execError.stderr || "";
      }
    }

    // Should have "switch-skillset" as a command
    const lines = output.split("\n");
    const hasSwitchSkillsetCommand = lines.some(
      (line) =>
        line.trim().startsWith("switch-skillset ") ||
        line.trim().startsWith("switch-skillset\t"),
    );
    expect(hasSwitchSkillsetCommand).toBe(true);
  });

  it("should have download-skill command", () => {
    let output = "";

    try {
      output = execSync("node build/src/cli/seaweed.js --help", {
        encoding: "utf-8",
        stdio: "pipe",
        env: { ...process.env, FORCE_COLOR: "0", HOME: tempDir },
      });
    } catch (error: unknown) {
      if (error && typeof error === "object") {
        const execError = error as { stdout?: string; stderr?: string };
        output = execError.stdout || execError.stderr || "";
      }
    }

    // Should have "download-skill" as a command
    const lines = output.split("\n");
    const hasDownloadSkillCommand = lines.some(
      (line) =>
        line.trim().startsWith("download-skill ") ||
        line.trim().startsWith("download-skill\t"),
    );
    expect(hasDownloadSkillCommand).toBe(true);
  });

  it("should show help when no arguments provided", () => {
    let output = "";

    try {
      output = execSync("node build/src/cli/seaweed.js", {
        encoding: "utf-8",
        stdio: "pipe",
        env: { ...process.env, FORCE_COLOR: "0", HOME: tempDir },
      });
    } catch (error: unknown) {
      if (error && typeof error === "object") {
        const execError = error as { stdout?: string; stderr?: string };
        output = execError.stdout || execError.stderr || "";
      }
    }

    expect(output).toContain("Usage: seaweed");
    expect(output).toContain("Commands:");
  });

  it("should show examples with simplified command names in help", () => {
    let output = "";

    try {
      output = execSync("node build/src/cli/seaweed.js --help", {
        encoding: "utf-8",
        stdio: "pipe",
        env: { ...process.env, FORCE_COLOR: "0", HOME: tempDir },
      });
    } catch (error: unknown) {
      if (error && typeof error === "object") {
        const execError = error as { stdout?: string; stderr?: string };
        output = execError.stdout || execError.stderr || "";
      }
    }

    // Help examples should use simplified command names
    expect(output).toContain("$ seaweed search");
    expect(output).toContain("$ seaweed download");
    expect(output).toContain("$ seaweed install");
    expect(output).toContain("$ seaweed switch-skillset");
    expect(output).toContain("$ seaweed download-skill");
  });
});
