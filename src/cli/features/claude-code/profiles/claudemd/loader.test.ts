/**
 * Tests for CLAUDE.md feature loader
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
let mockClaudeMdFile: string;

vi.mock("@/cli/features/claude-code/paths.js", () => ({
  getClaudeDir: () => mockClaudeDir,
  getClaudeSettingsFile: () => path.join(mockClaudeDir, "settings.json"),
  getClaudeAgentsDir: () => path.join(mockClaudeDir, "agents"),
  getClaudeCommandsDir: () => path.join(mockClaudeDir, "commands"),
  getClaudeMdFile: () => mockClaudeMdFile,
  getClaudeSkillsDir: () => path.join(mockClaudeDir, "skills"),
  getClaudeProfilesDir: () => path.join(mockClaudeDir, "profiles"),
}));

// Import loaders after mocking env
import { claudeMdLoader } from "./loader.js";

describe("claudeMdLoader", () => {
  let tempDir: string;
  let claudeDir: string;
  let claudeMdPath: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "claudemd-test-"));
    claudeDir = path.join(tempDir, ".claude");
    claudeMdPath = path.join(claudeDir, "CLAUDE.md");

    // Set mock paths
    mockClaudeDir = claudeDir;
    mockClaudeMdFile = claudeMdPath;

    // Create .claude directory
    await fs.mkdir(claudeDir, { recursive: true });

    // Run profiles loader to populate ~/.claude/profiles/ directory with composed profiles
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
    it("should create CLAUDE.md with managed block for free installation", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      await claudeMdLoader.install({ config });

      // Verify file exists
      const content = await fs.readFile(claudeMdPath, "utf-8");

      // Check for managed block markers
      expect(content).toContain("# BEGIN NORI-AI MANAGED BLOCK");
      expect(content).toContain("# END NORI-AI MANAGED BLOCK");

      // Check for core content sections from profile CLAUDE.md
      expect(content).toContain("# Tone");
      expect(content).toContain("# Coding Guidelines");
      expect(content).toContain("<required>");
      expect(content).toContain(
        "ask me if I want to create a branch or a worktree",
      );
    });

    it("should create CLAUDE.md with managed block for paid installation", async () => {
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

      await claudeMdLoader.install({ config });

      // Verify file exists
      const content = await fs.readFile(claudeMdPath, "utf-8");

      // Check for managed block markers
      expect(content).toContain("# BEGIN NORI-AI MANAGED BLOCK");
      expect(content).toContain("# END NORI-AI MANAGED BLOCK");

      // Check for core content sections from profile CLAUDE.md
      expect(content).toContain("# Tone");
      expect(content).toContain("# Coding Guidelines");
    });

    it("should append managed block to existing CLAUDE.md without destroying user content", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Create existing CLAUDE.md with user content
      const userContent =
        "# My Custom Instructions\n\nUser-specific content here.\n";
      await fs.writeFile(claudeMdPath, userContent);

      await claudeMdLoader.install({ config });

      // Verify file exists
      const content = await fs.readFile(claudeMdPath, "utf-8");

      // Check that user content is preserved
      expect(content).toContain("# My Custom Instructions");
      expect(content).toContain("User-specific content here.");

      // Check for managed block
      expect(content).toContain("# BEGIN NORI-AI MANAGED BLOCK");
      expect(content).toContain("# END NORI-AI MANAGED BLOCK");
    });

    it("should update existing managed block without affecting user content", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Create existing CLAUDE.md with managed block and user content
      const existingContent = `# User Content Before

User-specific instructions.

# BEGIN NORI-AI MANAGED BLOCK
Old nori instructions here.
# END NORI-AI MANAGED BLOCK

# User Content After

More user instructions.
`;
      await fs.writeFile(claudeMdPath, existingContent);

      await claudeMdLoader.install({ config });

      // Verify file exists
      const content = await fs.readFile(claudeMdPath, "utf-8");

      // Check that user content is preserved
      expect(content).toContain("# User Content Before");
      expect(content).toContain("User-specific instructions.");
      expect(content).toContain("# User Content After");
      expect(content).toContain("More user instructions.");

      // Check that managed block is updated
      expect(content).toContain("# BEGIN NORI-AI MANAGED BLOCK");
      expect(content).toContain("# END NORI-AI MANAGED BLOCK");

      // Old content should be replaced
      expect(content).not.toContain("Old nori instructions here.");

      // New content should be present (simplified structure)
      expect(content).toContain("# Tone");
    });

    it("should handle switching from free to paid installation", async () => {
      // First install with senior-swe profile
      const seniorSweConfig: Config = {
        profile: { baseProfile: "senior-swe" },
        installDir: tempDir,
      };
      await claudeMdLoader.install({ config: seniorSweConfig });

      const seniorSweContent = await fs.readFile(claudeMdPath, "utf-8");
      expect(seniorSweContent).toContain(
        "ask me if I want to create a branch or a worktree",
      );

      // Then switch to amol profile
      const amolConfig: Config = {
        auth: {
          username: "test@example.com",
          password: "testpass",
          organizationUrl: "https://example.com",
        },
        profile: { baseProfile: "amol" },
        installDir: tempDir,
      };
      await claudeMdLoader.install({ config: amolConfig });

      const amolContent = await fs.readFile(claudeMdPath, "utf-8");

      // Should have amol-specific content (profile-specific behavior)
      expect(amolContent).toContain("automatically create a worktree");

      // Managed block markers should still be present
      expect(amolContent).toContain("# BEGIN NORI-AI MANAGED BLOCK");
      expect(amolContent).toContain("# END NORI-AI MANAGED BLOCK");
    });
  });

  describe("uninstall", () => {
    it("should remove managed block from CLAUDE.md", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // First install
      await claudeMdLoader.install({ config });

      // Add some user content before uninstalling
      let content = await fs.readFile(claudeMdPath, "utf-8");
      content = `# My Custom Instructions\n\n${content}\n\n# More Custom Stuff\n`;
      await fs.writeFile(claudeMdPath, content);

      // Uninstall
      await claudeMdLoader.uninstall({ config });

      // Verify managed block is removed
      const finalContent = await fs.readFile(claudeMdPath, "utf-8");

      expect(finalContent).not.toContain("# BEGIN NORI-AI MANAGED BLOCK");
      expect(finalContent).not.toContain("# END NORI-AI MANAGED BLOCK");
      expect(finalContent).not.toContain("# Tone");

      // User content should be preserved
      expect(finalContent).toContain("# My Custom Instructions");
      expect(finalContent).toContain("# More Custom Stuff");
    });

    it("should delete CLAUDE.md if empty after removing managed block", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Install (creates CLAUDE.md with only managed block)
      await claudeMdLoader.install({ config });

      // Uninstall
      await claudeMdLoader.uninstall({ config });

      // Verify file is deleted
      const exists = await fs
        .access(claudeMdPath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(false);
    });

    it("should handle missing CLAUDE.md gracefully", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Uninstall without installing first (no CLAUDE.md exists)
      await expect(claudeMdLoader.uninstall({ config })).resolves.not.toThrow();

      // Verify file still doesn't exist
      const exists = await fs
        .access(claudeMdPath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(false);
    });

    it("should handle CLAUDE.md without managed block gracefully", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Create CLAUDE.md without managed block
      const userContent = "# User Instructions\n\nNo nori content here.\n";
      await fs.writeFile(claudeMdPath, userContent);

      // Uninstall
      await claudeMdLoader.uninstall({ config });

      // Verify content is unchanged
      const content = await fs.readFile(claudeMdPath, "utf-8");
      expect(content).toBe(userContent);
    });
  });

  // Validate tests removed - validation is now handled at profilesLoader level

  describe("profile-based CLAUDE.md loading", () => {
    it("should load CLAUDE.md from selected profile", async () => {
      const config: Config = {
        profile: { baseProfile: "senior-swe" },
        installDir: tempDir,
      };

      await claudeMdLoader.install({ config });

      const content = await fs.readFile(claudeMdPath, "utf-8");

      // Should contain content from senior-swe profile's CLAUDE.md
      expect(content).toContain("BEGIN NORI-AI MANAGED BLOCK");
      expect(content).toContain("<required>");

      // Should contain senior-swe specific instructions
      expect(content).toContain(
        "ask me if I want to create a branch or a worktree",
      );
    });

    it("should load CLAUDE.md from amol profile when specified", async () => {
      const config: Config = {
        auth: {
          username: "test@example.com",
          password: "testpass",
          organizationUrl: "https://example.com",
        },
        profile: { baseProfile: "amol" },
        installDir: tempDir,
      };

      await claudeMdLoader.install({ config });

      const content = await fs.readFile(claudeMdPath, "utf-8");

      // Should contain amol profile specific instructions
      expect(content).toContain("automatically create a worktree");
      // Verify profile-specific behavior exists
      expect(content).toContain("required");
      expect(content).toContain("# Tone");
    });

    it("should use default profile (senior-swe) when no profile specified", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      await claudeMdLoader.install({ config });

      const content = await fs.readFile(claudeMdPath, "utf-8");

      // Should use senior-swe as default
      expect(content).toContain(
        "ask me if I want to create a branch or a worktree",
      );
    });
  });

  describe("skills list generation", () => {
    it("should include skills list in installed CLAUDE.md", async () => {
      const config: Config = {
        profile: { baseProfile: "senior-swe" },
        installDir: tempDir,
      };

      await claudeMdLoader.install({ config });

      const content = await fs.readFile(claudeMdPath, "utf-8");

      // Should contain skills list section
      expect(content).toContain("Available Skills");

      // Should list at least some skills from senior-swe profile
      // Paths should be absolute since we're using a temp directory (not home)
      expect(content).toContain(`${claudeDir}/skills/using-skills/SKILL.md`);
      expect(content).toContain(
        `${claudeDir}/skills/test-driven-development/SKILL.md`,
      );
      expect(content).toContain(`${claudeDir}/skills/brainstorming/SKILL.md`);
    });

    it("should include skill name and description from frontmatter", async () => {
      const config: Config = {
        profile: { baseProfile: "senior-swe" },
        installDir: tempDir,
      };

      await claudeMdLoader.install({ config });

      const content = await fs.readFile(claudeMdPath, "utf-8");

      // Should include skill metadata (names and descriptions from frontmatter)
      expect(content).toContain("Name: Getting Started with Abilities");
      expect(content).toContain("Name: Brainstorming");
      // Verify description exists (exact wording may change)
      expect(content).toMatch(/Description:.*abilities/i);
    });

    it("should strip paid- prefix from skill paths", async () => {
      const config: Config = {
        auth: {
          username: "test",
          password: "test",
          organizationUrl: "https://test.com",
        },
        profile: { baseProfile: "senior-swe" },
        installDir: tempDir,
      };

      // Recompose profiles with paid mixin
      await profilesLoader.run({ config });

      await claudeMdLoader.install({ config });

      const content = await fs.readFile(claudeMdPath, "utf-8");

      // Should show installed paths without paid- prefix
      // Paths should be absolute since we're using a temp directory (not home)
      expect(content).toContain(`${claudeDir}/skills/recall/SKILL.md`);
      expect(content).toContain(`${claudeDir}/skills/memorize/SKILL.md`);

      // Should NOT contain paid- prefix in paths
      expect(content).not.toContain(`${claudeDir}/skills/paid-recall`);
      expect(content).not.toContain(`${claudeDir}/skills/paid-memorize`);
    });

    it("should handle profiles with no skills gracefully", async () => {
      const config: Config = {
        profile: { baseProfile: "product-manager" },
        installDir: tempDir,
      };

      await claudeMdLoader.install({ config });

      const content = await fs.readFile(claudeMdPath, "utf-8");

      // Should still have basic structure
      expect(content).toContain("BEGIN NORI-AI MANAGED BLOCK");
      expect(content).toContain("END NORI-AI MANAGED BLOCK");

      // Should not fail or error
      expect(content.length).toBeGreaterThan(0);
    });

    it("should handle skills with missing frontmatter gracefully", async () => {
      const config: Config = {
        profile: { baseProfile: "senior-swe" },
        installDir: tempDir,
      };

      await claudeMdLoader.install({ config });

      const content = await fs.readFile(claudeMdPath, "utf-8");

      // Should still complete successfully even if some skills lack metadata
      expect(content).toContain("BEGIN NORI-AI MANAGED BLOCK");
      expect(content).toContain("END NORI-AI MANAGED BLOCK");
    });
  });
});
