/**
 * Tests for subagents feature loader
 * Verifies install, uninstall, and validate operations
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { profilesLoader } from "@/cli/features/claude-code/profiles/loader.js";

import type { Config } from "@/cli/config.js";

// Mock the env module to use temp directories
let mockClaudeDir: string;
let mockClaudeAgentsDir: string;

vi.mock("@/cli/features/claude-code/paths.js", () => ({
  getClaudeDir: () => mockClaudeDir,
  getClaudeSettingsFile: () => path.join(mockClaudeDir, "settings.json"),
  getClaudeAgentsDir: () => mockClaudeAgentsDir,
  getClaudeCommandsDir: () => path.join(mockClaudeDir, "commands"),
  getClaudeMdFile: () => path.join(mockClaudeDir, "CLAUDE.md"),
  getClaudeSkillsDir: () => path.join(mockClaudeDir, "skills"),
  getClaudeProfilesDir: () => path.join(mockClaudeDir, "profiles"),
}));

// Import loaders after mocking env
import { subagentsLoader } from "./loader.js";

describe("subagentsLoader", () => {
  let tempDir: string;
  let claudeDir: string;
  let agentsDir: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "subagents-test-"));
    claudeDir = path.join(tempDir, ".claude");
    agentsDir = path.join(claudeDir, "agents");

    // Set mock paths
    mockClaudeDir = claudeDir;
    mockClaudeAgentsDir = agentsDir;

    // Create directories
    await fs.mkdir(claudeDir, { recursive: true });

    // Install profiles first to set up composed profile structure
    // Run profiles loader to populate ~/.claude/profiles/ directory
    // This is required since feature loaders now read from ~/.claude/profiles/
    const config: Config = {
      installDir: tempDir,
      agents: {
        "claude-code": { profile: { baseProfile: "senior-swe" } },
      },
    };
    await profilesLoader.run({ config });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("run", () => {
    it("should create agents directory and copy subagent files for free installation", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      await subagentsLoader.install({ config });

      // Verify agents directory exists
      const exists = await fs
        .access(agentsDir)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      // Verify at least one subagent file was copied
      const files = await fs.readdir(agentsDir);
      expect(files.length).toBeGreaterThan(0);

      // Free mode should have common subagents like nori-codebase-analyzer
      const fileNames = await fs.readdir(agentsDir);
      const hasCodebaseAnalyzer = fileNames.includes(
        "nori-codebase-analyzer.md",
      );
      expect(hasCodebaseAnalyzer).toBe(true);
    });

    it("should create agents directory and copy subagent files for paid installation", async () => {
      const config: Config = {
        auth: {
          username: "test",
          password: "test",
          organizationUrl: "https://test.com",
        },
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Recompose profiles with paid mixin
      await profilesLoader.run({ config });

      await subagentsLoader.install({ config });

      // Verify agents directory exists
      const exists = await fs
        .access(agentsDir)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      // Verify at least one subagent file was copied
      const files = await fs.readdir(agentsDir);
      expect(files.length).toBeGreaterThan(0);

      // Paid mode should have nori-knowledge-researcher subagent
      const fileNames = await fs.readdir(agentsDir);
      const hasKnowledgeResearcher = fileNames.includes(
        "nori-knowledge-researcher.md",
      );
      expect(hasKnowledgeResearcher).toBe(true);
    });

    it("should copy more subagents for paid than free installation", async () => {
      const freeConfig: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };
      const paidConfig: Config = {
        auth: {
          username: "test",
          password: "test",
          organizationUrl: "https://test.com",
        },
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Free installation
      await profilesLoader.run({ config: freeConfig });
      await subagentsLoader.install({ config: freeConfig });
      const freeFiles = await fs.readdir(agentsDir);
      const freeCount = freeFiles.length;

      // Clean up for paid installation
      await fs.rm(agentsDir, { recursive: true, force: true });

      // Paid installation
      await profilesLoader.run({ config: paidConfig });
      await subagentsLoader.install({ config: paidConfig });
      const paidFiles = await fs.readdir(agentsDir);
      const paidCount = paidFiles.length;

      // Paid should have at least as many as free (includes additional like nori-knowledge-researcher)
      expect(paidCount).toBeGreaterThanOrEqual(freeCount);
    });

    it("should handle reinstallation (update scenario)", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // First installation
      await subagentsLoader.install({ config });

      const firstFiles = await fs.readdir(agentsDir);
      expect(firstFiles.length).toBeGreaterThan(0);

      // Second installation (update)
      await subagentsLoader.install({ config });

      const secondFiles = await fs.readdir(agentsDir);
      expect(secondFiles.length).toBeGreaterThan(0);
    });
  });

  describe("uninstall", () => {
    it("should remove subagent files for free installation", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Install first
      await subagentsLoader.install({ config });

      // Verify files exist
      let files = await fs.readdir(agentsDir);
      const initialCount = files.length;
      expect(initialCount).toBeGreaterThan(0);

      // Uninstall
      await subagentsLoader.uninstall({ config });

      // Verify nori subagent files are removed
      const exists = await fs
        .access(agentsDir)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        files = await fs.readdir(agentsDir);
        // Should have removed the nori-codebase-analyzer and other free subagents
        const hasCodebaseAnalyzer = files.includes("nori-codebase-analyzer.md");
        expect(hasCodebaseAnalyzer).toBe(false);
      }
    });

    it("should remove subagent files for paid installation", async () => {
      const config: Config = {
        installDir: tempDir,
        auth: {
          username: "test@example.com",
          password: "testpass",
          organizationUrl: "https://example.com",
        },
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Install first
      await subagentsLoader.install({ config });

      // Verify files exist
      let files = await fs.readdir(agentsDir);
      const initialCount = files.length;
      expect(initialCount).toBeGreaterThan(0);

      // Uninstall
      await subagentsLoader.uninstall({ config });

      // Verify nori subagent files are removed
      const exists = await fs
        .access(agentsDir)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        files = await fs.readdir(agentsDir);
        // Should have removed nori-knowledge-researcher and other paid subagents
        const hasKnowledgeResearcher = files.includes(
          "nori-knowledge-researcher.md",
        );
        expect(hasKnowledgeResearcher).toBe(false);
      }
    });

    it("should handle missing agents directory gracefully", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Uninstall without installing first
      await expect(
        subagentsLoader.uninstall({ config }),
      ).resolves.not.toThrow();
    });
  });

  describe("template substitution", () => {
    it("should substitute template placeholders in subagent files", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Get a subagent file from the profile directory and add a template placeholder
      const profileSubagentsDir = path.join(
        claudeDir,
        "profiles",
        "senior-swe",
        "subagents",
      );
      const files = await fs.readdir(profileSubagentsDir);
      const mdFile = files.find((f) => f.endsWith(".md") && f !== "docs.md");

      // Ensure we actually have a subagent file to test with
      expect(mdFile).toBeDefined();

      if (mdFile) {
        // Add template placeholder to the file
        const subagentPath = path.join(profileSubagentsDir, mdFile);
        await fs.writeFile(
          subagentPath,
          "Read: `{{skills_dir}}/some-skill/SKILL.md`",
        );

        await subagentsLoader.install({ config });

        // Check the installed file
        const installedPath = path.join(agentsDir, mdFile);
        const content = await fs.readFile(installedPath, "utf-8");

        // Should have substituted {{skills_dir}} with actual path
        const expectedSkillsDir = path.join(claudeDir, "skills");
        expect(content).toContain(expectedSkillsDir);
        expect(content).not.toContain("{{skills_dir}}");
      }
    });
  });

  // Validate tests removed - validation is now handled at profilesLoader level
});
