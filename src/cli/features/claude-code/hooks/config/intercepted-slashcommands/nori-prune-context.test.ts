/**
 * Tests for nori-prune-context intercepted slash command
 *
 * This command clears accumulated permissions from settings.local.json files
 * to reduce context token usage.
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { stripAnsi } from "@/cli/features/test-utils/index.js";

import type { HookInput } from "./types.js";

import { noriPruneContext } from "./nori-prune-context.js";

describe("nori-prune-context", () => {
  let testDir: string;
  let homeClaudeDir: string;
  let projectClaudeDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    // Create test directory structure
    testDir = await fs.mkdtemp(path.join(tmpdir(), "nori-prune-context-test-"));

    // Mock HOME
    originalHome = process.env.HOME;
    process.env.HOME = testDir;

    // Create home .claude directory
    homeClaudeDir = path.join(testDir, ".claude");
    await fs.mkdir(homeClaudeDir, { recursive: true });

    // Create project with .claude directory
    projectClaudeDir = path.join(testDir, "project", ".claude");
    await fs.mkdir(projectClaudeDir, { recursive: true });
  });

  afterEach(async () => {
    // Restore HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    // Clean up
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  const createInput = (args: {
    prompt: string;
    cwd?: string | null;
  }): HookInput => {
    const { prompt, cwd } = args;
    return {
      prompt,
      cwd: cwd ?? path.join(testDir, "project"),
      session_id: "test-session",
      transcript_path: "",
      permission_mode: "default",
      hook_event_name: "UserPromptSubmit",
    };
  };

  describe("matchers", () => {
    it("should have valid regex matchers", () => {
      expect(noriPruneContext.matchers).toBeInstanceOf(Array);
      expect(noriPruneContext.matchers.length).toBeGreaterThan(0);

      for (const matcher of noriPruneContext.matchers) {
        expect(() => new RegExp(matcher)).not.toThrow();
      }
    });

    it("should match /nori-prune-context", () => {
      const regex = new RegExp(noriPruneContext.matchers[0]);
      expect(regex.test("/nori-prune-context")).toBe(true);
      expect(regex.test("/nori-prune-context ")).toBe(true);
    });

    it("should not match other commands", () => {
      const regex = new RegExp(noriPruneContext.matchers[0]);
      expect(regex.test("/nori-prune")).toBe(false);
      expect(regex.test("/prune-context")).toBe(false);
      expect(regex.test("nori-prune-context")).toBe(false);
    });
  });

  describe("run function", () => {
    it("should return block decision", async () => {
      const input = createInput({ prompt: "/nori-prune-context" });
      const result = await noriPruneContext.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
    });

    it("should report nothing to prune when no settings.local.json exists", async () => {
      const input = createInput({ prompt: "/nori-prune-context" });
      const result = await noriPruneContext.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(stripAnsi(result!.reason!).toLowerCase()).toMatch(
        /nothing to prune|no permissions|already clean/,
      );
    });

    it("should report nothing to prune when permissions.allow is empty", async () => {
      // Create settings.local.json with empty allow
      await fs.writeFile(
        path.join(homeClaudeDir, "settings.local.json"),
        JSON.stringify({
          permissions: {
            allow: [],
            deny: ["Bash(rm -rf)"],
          },
        }),
      );

      const input = createInput({ prompt: "/nori-prune-context" });
      const result = await noriPruneContext.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(stripAnsi(result!.reason!).toLowerCase()).toMatch(
        /nothing to prune|no permissions|already clean/,
      );
    });
  });

  describe("pruning behavior", () => {
    it("should clear permissions.allow from home settings.local.json", async () => {
      // Create settings.local.json with permissions
      await fs.writeFile(
        path.join(homeClaudeDir, "settings.local.json"),
        JSON.stringify({
          permissions: {
            allow: ["Bash(npm test)", "Bash(git push)"],
            deny: ["Bash(rm -rf)"],
            ask: ["Bash(git push --force)"],
          },
        }),
      );

      const input = createInput({ prompt: "/nori-prune-context" });
      const result = await noriPruneContext.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");

      // Verify allow is cleared but deny/ask preserved
      const updatedSettings = JSON.parse(
        await fs.readFile(
          path.join(homeClaudeDir, "settings.local.json"),
          "utf-8",
        ),
      );
      expect(updatedSettings.permissions.allow).toEqual([]);
      expect(updatedSettings.permissions.deny).toEqual(["Bash(rm -rf)"]);
      expect(updatedSettings.permissions.ask).toEqual([
        "Bash(git push --force)",
      ]);
    });

    it("should clear permissions.allow from project settings.local.json", async () => {
      // Create settings.local.json with permissions in project
      await fs.writeFile(
        path.join(projectClaudeDir, "settings.local.json"),
        JSON.stringify({
          permissions: {
            allow: ["Bash(npm run lint)", "Bash(npm run build)"],
            deny: [],
          },
        }),
      );

      const input = createInput({ prompt: "/nori-prune-context" });
      const result = await noriPruneContext.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");

      // Verify allow is cleared
      const updatedSettings = JSON.parse(
        await fs.readFile(
          path.join(projectClaudeDir, "settings.local.json"),
          "utf-8",
        ),
      );
      expect(updatedSettings.permissions.allow).toEqual([]);
    });

    it("should clear permissions from both home and project settings.local.json", async () => {
      // Create settings in both locations
      await fs.writeFile(
        path.join(homeClaudeDir, "settings.local.json"),
        JSON.stringify({
          permissions: {
            allow: ["Bash(home-command)"],
            deny: [],
          },
        }),
      );
      await fs.writeFile(
        path.join(projectClaudeDir, "settings.local.json"),
        JSON.stringify({
          permissions: {
            allow: ["Bash(project-command)"],
            deny: [],
          },
        }),
      );

      const input = createInput({ prompt: "/nori-prune-context" });
      const result = await noriPruneContext.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");

      // Verify both are cleared
      const homeSettings = JSON.parse(
        await fs.readFile(
          path.join(homeClaudeDir, "settings.local.json"),
          "utf-8",
        ),
      );
      const projectSettings = JSON.parse(
        await fs.readFile(
          path.join(projectClaudeDir, "settings.local.json"),
          "utf-8",
        ),
      );
      expect(homeSettings.permissions.allow).toEqual([]);
      expect(projectSettings.permissions.allow).toEqual([]);
    });

    it("should preserve other settings fields", async () => {
      // Create settings with additional fields
      await fs.writeFile(
        path.join(homeClaudeDir, "settings.local.json"),
        JSON.stringify({
          permissions: {
            allow: ["Bash(npm test)"],
            deny: [],
            additionalDirectories: ["../docs"],
          },
          someOtherField: "value",
        }),
      );

      const input = createInput({ prompt: "/nori-prune-context" });
      await noriPruneContext.run({ input });

      // Verify other fields preserved
      const updatedSettings = JSON.parse(
        await fs.readFile(
          path.join(homeClaudeDir, "settings.local.json"),
          "utf-8",
        ),
      );
      expect(updatedSettings.permissions.additionalDirectories).toEqual([
        "../docs",
      ]);
      expect(updatedSettings.someOtherField).toBe("value");
    });
  });

  describe("backup behavior", () => {
    it("should create backup before modifying home settings", async () => {
      // Create settings.local.json with permissions
      const originalContent = JSON.stringify({
        permissions: {
          allow: ["Bash(npm test)"],
          deny: [],
        },
      });
      await fs.writeFile(
        path.join(homeClaudeDir, "settings.local.json"),
        originalContent,
      );

      const input = createInput({ prompt: "/nori-prune-context" });
      await noriPruneContext.run({ input });

      // Verify backup exists
      const backupPath = path.join(homeClaudeDir, "settings.local.json.backup");
      const backupExists = await fs
        .access(backupPath)
        .then(() => true)
        .catch(() => false);
      expect(backupExists).toBe(true);

      // Verify backup has original content
      const backupContent = await fs.readFile(backupPath, "utf-8");
      expect(JSON.parse(backupContent)).toEqual(JSON.parse(originalContent));
    });

    it("should create backup before modifying project settings", async () => {
      // Create settings.local.json with permissions
      const originalContent = JSON.stringify({
        permissions: {
          allow: ["Bash(npm run build)"],
          deny: [],
        },
      });
      await fs.writeFile(
        path.join(projectClaudeDir, "settings.local.json"),
        originalContent,
      );

      const input = createInput({ prompt: "/nori-prune-context" });
      await noriPruneContext.run({ input });

      // Verify backup exists
      const backupPath = path.join(
        projectClaudeDir,
        "settings.local.json.backup",
      );
      const backupExists = await fs
        .access(backupPath)
        .then(() => true)
        .catch(() => false);
      expect(backupExists).toBe(true);
    });
  });

  describe("output messages", () => {
    it("should report pruned count in success message", async () => {
      // Create settings with multiple permissions
      await fs.writeFile(
        path.join(homeClaudeDir, "settings.local.json"),
        JSON.stringify({
          permissions: {
            allow: ["Bash(cmd1)", "Bash(cmd2)", "Bash(cmd3)"],
            deny: [],
          },
        }),
      );

      const input = createInput({ prompt: "/nori-prune-context" });
      const result = await noriPruneContext.run({ input });

      expect(result).not.toBeNull();
      const reason = stripAnsi(result!.reason!);
      expect(reason).toMatch(/3|pruned/i);
    });

    it("should mention backup location in success message", async () => {
      await fs.writeFile(
        path.join(homeClaudeDir, "settings.local.json"),
        JSON.stringify({
          permissions: {
            allow: ["Bash(npm test)"],
            deny: [],
          },
        }),
      );

      const input = createInput({ prompt: "/nori-prune-context" });
      const result = await noriPruneContext.run({ input });

      expect(result).not.toBeNull();
      const reason = stripAnsi(result!.reason!);
      expect(reason.toLowerCase()).toMatch(/backup/);
    });
  });

  describe("error handling", () => {
    it("should handle malformed JSON gracefully", async () => {
      // Create malformed settings.local.json
      await fs.writeFile(
        path.join(homeClaudeDir, "settings.local.json"),
        "{ invalid json }",
      );

      const input = createInput({ prompt: "/nori-prune-context" });

      // Should not throw
      await expect(noriPruneContext.run({ input })).resolves.not.toThrow();
    });
  });
});
