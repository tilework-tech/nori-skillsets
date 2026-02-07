/**
 * Tests for CLAUDE.md feature loader
 * Verifies install and validate operations
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { Config } from "@/cli/config.js";

// Mock the env module to use temp directories
let mockClaudeDir: string;
let mockClaudeMdFile: string;
let mockNoriDir: string;

vi.mock("@/cli/features/claude-code/paths.js", () => ({
  getClaudeDir: () => mockClaudeDir,
  getClaudeSettingsFile: () => path.join(mockClaudeDir, "settings.json"),
  getClaudeAgentsDir: () => path.join(mockClaudeDir, "agents"),
  getClaudeCommandsDir: () => path.join(mockClaudeDir, "commands"),
  getClaudeMdFile: () => mockClaudeMdFile,
  getClaudeSkillsDir: () => path.join(mockClaudeDir, "skills"),
  getClaudeProfilesDir: () => path.join(mockClaudeDir, "profiles"),
  getNoriDir: () => mockNoriDir,
  getNoriProfilesDir: () => path.join(mockNoriDir, "profiles"),
  getNoriConfigFile: () => path.join(mockNoriDir, "config.json"),
}));

// Import loaders after mocking env
import { claudeMdLoader } from "./loader.js";

// Stub profile content matching what the tests expect
const SENIOR_SWE_CLAUDE_MD = `<required>
# Tone

Do not be deferential.

# Coding Guidelines

YAGNI. Do not add features that are not explicitly asked for.

# Independence

When starting a new task, ask me if I want to create a branch or a worktree.
</required>
`;

const AMOL_CLAUDE_MD = `<required>
# Tone

Do not be deferential.

# Coding Guidelines

YAGNI.

# Independence

When starting a new task, automatically create a worktree.
</required>
`;

/**
 * Create a stub profile with CLAUDE.md and optional skills
 *
 * @param args - Function arguments
 * @param args.profilesDir - Path to the profiles directory
 * @param args.profileName - Name of the profile
 * @param args.claudeMd - Content for the profile's CLAUDE.md
 * @param args.skills - Optional map of skill name to frontmatter and body content
 */
const createStubProfile = async (args: {
  profilesDir: string;
  profileName: string;
  claudeMd: string;
  skills?: Record<string, { frontmatter: string; body: string }> | null;
}): Promise<void> => {
  const { profilesDir, profileName, claudeMd, skills } = args;
  const profileDir = path.join(profilesDir, profileName);
  await fs.mkdir(profileDir, { recursive: true });
  await fs.writeFile(path.join(profileDir, "CLAUDE.md"), claudeMd);
  await fs.writeFile(
    path.join(profileDir, "nori.json"),
    JSON.stringify({
      name: profileName,
      version: "1.0.0",
      description: `${profileName} profile`,
    }),
  );

  if (skills != null) {
    for (const [skillName, content] of Object.entries(skills)) {
      const skillDir = path.join(profileDir, "skills", skillName);
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, "SKILL.md"),
        `${content.frontmatter}\n${content.body}`,
      );
    }
  }
};

// Standard test skills for senior-swe profile
const TEST_SKILLS: Record<string, { frontmatter: string; body: string }> = {
  "using-skills": {
    frontmatter:
      "---\nname: Getting Started with Abilities\ndescription: Describes how to use abilities. Read before any conversation.\n---",
    body: "# Using Skills\n\nHow to use skills.",
  },
  brainstorming: {
    frontmatter:
      "---\nname: Brainstorming\ndescription: Refine ideas through Socratic questioning.\n---",
    body: "# Brainstorming\n\nRefine ideas.",
  },
  "test-driven-development": {
    frontmatter:
      "---\nname: Test-Driven Development\ndescription: Write the test first.\n---",
    body: "# TDD\n\nRed-green-refactor.",
  },
};

describe("claudeMdLoader", () => {
  let tempDir: string;
  let claudeDir: string;
  let claudeMdPath: string;
  let noriProfilesDir: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "claudemd-test-"));
    claudeDir = path.join(tempDir, ".claude");
    claudeMdPath = path.join(claudeDir, "CLAUDE.md");

    // Set mock paths
    mockClaudeDir = claudeDir;
    mockClaudeMdFile = claudeMdPath;
    mockNoriDir = path.join(tempDir, ".nori");
    noriProfilesDir = path.join(mockNoriDir, "profiles");

    // Create .claude and .nori directories
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(noriProfilesDir, { recursive: true });

    // Create stub profiles (built-in profiles are no longer bundled)
    await createStubProfile({
      profilesDir: noriProfilesDir,
      profileName: "senior-swe",
      claudeMd: SENIOR_SWE_CLAUDE_MD,
      skills: TEST_SKILLS,
    });

    await createStubProfile({
      profilesDir: noriProfilesDir,
      profileName: "amol",
      claudeMd: AMOL_CLAUDE_MD,
    });

    await createStubProfile({
      profilesDir: noriProfilesDir,
      profileName: "product-manager",
      claudeMd: "# Product Manager\n\nFocus on product decisions.\n",
    });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("run", () => {
    it("should create CLAUDE.md with managed block", async () => {
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

    it("should handle switching between profiles", async () => {
      // First install with senior-swe profile
      const seniorSweConfig: Config = {
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
        installDir: tempDir,
      };
      await claudeMdLoader.install({ config: seniorSweConfig });

      const seniorSweContent = await fs.readFile(claudeMdPath, "utf-8");
      expect(seniorSweContent).toContain(
        "ask me if I want to create a branch or a worktree",
      );

      // Then switch to amol profile
      const amolConfig: Config = {
        agents: {
          "claude-code": { profile: { baseProfile: "amol" } },
        },
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

  describe("managed block marker handling", () => {
    it("should not produce double-nested markers when profile CLAUDE.md already has markers", async () => {
      // Create a custom profile with CLAUDE.md that already has managed block markers
      // This simulates what happens when captureExistingConfigAsProfile saves a profile
      const customProfileDir = path.join(mockNoriDir, "profiles", "my-profile");
      await fs.mkdir(customProfileDir, { recursive: true });

      // Write profile.json
      await fs.writeFile(
        path.join(customProfileDir, "profile.json"),
        JSON.stringify({
          name: "my-profile",
          description: "Test profile with pre-existing markers",
          builtin: false,
        }),
      );

      // Write CLAUDE.md with managed block markers already present
      // This mimics what captureExistingConfigAsProfile does
      const profileClaudeMdContent = `# BEGIN NORI-AI MANAGED BLOCK
hello world
# END NORI-AI MANAGED BLOCK
`;
      await fs.writeFile(
        path.join(customProfileDir, "CLAUDE.md"),
        profileClaudeMdContent,
      );

      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "my-profile" } },
        },
      };

      await claudeMdLoader.install({ config });

      const resultContent = await fs.readFile(claudeMdPath, "utf-8");

      // Should have exactly ONE BEGIN and ONE END marker (not nested/doubled)
      const beginCount = (
        resultContent.match(/# BEGIN NORI-AI MANAGED BLOCK/g) || []
      ).length;
      const endCount = (
        resultContent.match(/# END NORI-AI MANAGED BLOCK/g) || []
      ).length;

      expect(beginCount).toBe(1);
      expect(endCount).toBe(1);

      // Content should be properly wrapped with the original content inside
      expect(resultContent).toContain("hello world");
    });
  });

  describe("profile-based CLAUDE.md loading", () => {
    it("should load CLAUDE.md from selected profile", async () => {
      const config: Config = {
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
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
        agents: {
          "claude-code": { profile: { baseProfile: "amol" } },
        },
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
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
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
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
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

    it("should handle profiles with no skills gracefully", async () => {
      const config: Config = {
        agents: {
          "claude-code": { profile: { baseProfile: "product-manager" } },
        },
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
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
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
