import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { detectNoriPollution } from "./setup.js";

describe("detectNoriPollution", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pollution-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should not detect legitimate Claude Code artifacts", () => {
    const claudeDir = path.join(tempDir, ".claude");
    fs.mkdirSync(claudeDir);
    fs.writeFileSync(
      path.join(claudeDir, "settings.local.json"),
      JSON.stringify({ test: true }),
    );

    const pollution = detectNoriPollution(tempDir);
    expect(pollution).toEqual([]);
  });

  it("should detect Nori installation pollution", () => {
    // Create Nori files
    fs.writeFileSync(
      path.join(tempDir, ".nori-config.json"),
      JSON.stringify({}),
    );

    // Create Nori directories
    const claudeDir = path.join(tempDir, ".claude");
    fs.mkdirSync(claudeDir);
    fs.mkdirSync(path.join(claudeDir, "skills"));
    fs.mkdirSync(path.join(claudeDir, "profiles"));

    // Create Nori-managed CLAUDE.md
    fs.writeFileSync(
      path.join(claudeDir, "CLAUDE.md"),
      "# BEGIN NORI-AI MANAGED BLOCK\nContent\n# END NORI-AI MANAGED BLOCK",
    );

    const pollution = detectNoriPollution(tempDir);
    expect(pollution).toContain(".nori-config.json");
    expect(pollution).toContain(".claude/skills");
    expect(pollution).toContain(".claude/profiles");
    expect(pollution).toContain(".claude/CLAUDE.md");
  });
});
