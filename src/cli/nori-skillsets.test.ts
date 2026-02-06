/**
 * Tests for the nori-skillsets CLI
 *
 * The nori-skillsets CLI is a minimal registry-focused CLI that provides simplified commands:
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

describe("nori-skillsets CLI", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nori-skillsets-cli-test-"),
    );
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
      output = execSync("node build/src/cli/nori-skillsets.js --help", {
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

    // Verify the CLI is named "nori-skillsets"
    expect(output).toContain("Usage: nori-skillsets");
  });

  it("should show version when --version flag is used", () => {
    let output = "";

    try {
      output = execSync("node build/src/cli/nori-skillsets.js --version", {
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
      output = execSync("node build/src/cli/nori-skillsets.js --help", {
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
      output = execSync("node build/src/cli/nori-skillsets.js --help", {
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
      output = execSync("node build/src/cli/nori-skillsets.js --help", {
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
      output = execSync("node build/src/cli/nori-skillsets.js --help", {
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
      output = execSync("node build/src/cli/nori-skillsets.js --help", {
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

  it("should have init command", () => {
    let output = "";

    try {
      output = execSync("node build/src/cli/nori-skillsets.js --help", {
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

    // Should have "init" as a command
    const lines = output.split("\n");
    const hasInitCommand = lines.some(
      (line) =>
        line.trim().startsWith("init ") || line.trim().startsWith("init\t"),
    );
    expect(hasInitCommand).toBe(true);
  });

  it("should show help when no arguments provided", () => {
    let output = "";

    try {
      output = execSync("node build/src/cli/nori-skillsets.js", {
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

    expect(output).toContain("Usage: nori-skillsets");
    expect(output).toContain("Commands:");
  });

  it("should show examples with simplified command names in help", () => {
    let output = "";

    try {
      output = execSync("node build/src/cli/nori-skillsets.js --help", {
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
    expect(output).toContain("$ nori-skillsets init");
    expect(output).toContain("$ nori-skillsets search");
    expect(output).toContain("$ nori-skillsets download");
    expect(output).toContain("$ nori-skillsets install");
    expect(output).toContain("$ nori-skillsets switch-skillset");
    expect(output).toContain("$ nori-skillsets list-skillsets");
    expect(output).toContain("$ nori-skillsets download-skill");
  });

  it("should accept 'switch' as a hidden alias for switch-skillset", () => {
    let helpOutput = "";

    try {
      helpOutput = execSync("node build/src/cli/nori-skillsets.js --help", {
        encoding: "utf-8",
        stdio: "pipe",
        env: { ...process.env, FORCE_COLOR: "0", HOME: tempDir },
      });
    } catch (error: unknown) {
      if (error && typeof error === "object") {
        const execError = error as { stdout?: string; stderr?: string };
        helpOutput = execError.stdout || execError.stderr || "";
      }
    }

    // 'switch' should NOT appear as its own command in help (it's hidden)
    const lines = helpOutput.split("\n");
    const hasSwitchAsOwnCommand = lines.some((line) => {
      const trimmed = line.trim();
      return (
        (trimmed.startsWith("switch ") || trimmed.startsWith("switch\t")) &&
        !trimmed.startsWith("switch-skillset") &&
        !trimmed.startsWith("switch-skillsets")
      );
    });
    expect(hasSwitchAsOwnCommand).toBe(false);

    // 'switch --help' should show the switch command's own help (with <name> argument)
    let switchOutput = "";

    try {
      switchOutput = execSync(
        "node build/src/cli/nori-skillsets.js switch --help",
        {
          encoding: "utf-8",
          stdio: "pipe",
          env: { ...process.env, FORCE_COLOR: "0", HOME: tempDir },
        },
      );
    } catch (error: unknown) {
      if (error && typeof error === "object") {
        const execError = error as {
          stdout?: string;
          stderr?: string;
        };
        switchOutput = execError.stdout || execError.stderr || "";
      }
    }

    // Should show the switch subcommand's own help, not the top-level help
    expect(switchOutput).toContain("nori-skillsets switch");
    expect(switchOutput).toContain("<name>");
  });

  it("should have list-skillsets command", () => {
    let output = "";

    try {
      output = execSync("node build/src/cli/nori-skillsets.js --help", {
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

    // Should have "list-skillsets" as a command
    expect(output).toContain("list-skillsets");
    expect(output).toContain("List locally available skillsets");
  });
});
