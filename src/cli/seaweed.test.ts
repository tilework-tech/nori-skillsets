/**
 * Tests for the seaweed CLI
 *
 * The seaweed CLI is a minimal registry-focused CLI that provides simplified commands:
 * - search (searches org registry)
 * - download (downloads profile package)
 * - install (downloads and installs profile)
 * - update (updates installed profile)
 * - upload (uploads profile to registry)
 * - version (built-in)
 *
 * It does NOT provide nori-ai commands like install (standalone), uninstall, check, etc.
 * It also does NOT provide registry-* prefixed commands (those are nori-ai only).
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

  it("should have update command (simplified from registry-update)", () => {
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

    // Should have "update" as a command (not registry-update)
    const lines = output.split("\n");
    const hasUpdateCommand = lines.some(
      (line) =>
        line.trim().startsWith("update ") || line.trim().startsWith("update\t"),
    );
    expect(hasUpdateCommand).toBe(true);
  });

  it("should have upload command (simplified from registry-upload)", () => {
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

    // Should have "upload" as a command (not registry-upload)
    const lines = output.split("\n");
    const hasUploadCommand = lines.some(
      (line) =>
        line.trim().startsWith("upload ") || line.trim().startsWith("upload\t"),
    );
    expect(hasUploadCommand).toBe(true);
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

  it("should NOT have registry-search command (nori-ai only)", () => {
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

    expect(output).not.toContain("registry-search");
  });

  it("should NOT have registry-download command (nori-ai only)", () => {
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

    expect(output).not.toContain("registry-download");
  });

  it("should NOT have registry-install command (nori-ai only)", () => {
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

    expect(output).not.toContain("registry-install");
  });

  it("should NOT have registry-update command (nori-ai only)", () => {
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

    expect(output).not.toContain("registry-update");
  });

  it("should NOT have registry-upload command (nori-ai only)", () => {
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

    expect(output).not.toContain("registry-upload");
  });

  it("should NOT have uninstall command (nori-ai only)", () => {
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

    expect(output).not.toContain("uninstall");
  });

  it("should NOT have check command (nori-ai only)", () => {
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

    expect(output).not.toContain("check");
  });

  it("should NOT have switch-profile command (nori-ai only)", () => {
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

    expect(output).not.toContain("switch-profile");
  });

  it("should NOT have skill-search command (nori-ai only)", () => {
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

    expect(output).not.toContain("skill-search");
  });

  it("should NOT have skill-download command (nori-ai only)", () => {
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

    expect(output).not.toContain("skill-download");
  });

  it("should NOT have skill-upload command (nori-ai only)", () => {
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

    expect(output).not.toContain("skill-upload");
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
    expect(output).toContain("$ seaweed update");
    expect(output).toContain("$ seaweed upload");
    expect(output).toContain("$ seaweed switch-skillset");
  });
});
