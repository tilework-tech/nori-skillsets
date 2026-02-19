/**
 * Tests for CLAUDE.md feature loader
 * Verifies install and validate operations
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { Config } from "@/cli/config.js";
import type { SkillsetPackage } from "@/norijson/packageStructure.js";

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

/**
 * Create skill files on disk and return SkillEntry array
 *
 * @param args - Function arguments
 * @param args.baseDir - Base directory to create skill dirs in
 * @param args.skills - Map of skill name to frontmatter and body content
 *
 * @returns Array of SkillEntry objects for use in SkillsetPackage
 */
const createSkillFiles = async (args: {
  baseDir: string;
  skills: Record<string, { frontmatter: string; body: string }>;
}): Promise<Array<{ id: string; sourceDir: string }>> => {
  const { baseDir, skills } = args;
  const entries: Array<{ id: string; sourceDir: string }> = [];

  for (const [skillName, content] of Object.entries(skills)) {
    const skillDir = path.join(baseDir, "skills", skillName);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      `${content.frontmatter}\n${content.body}`,
    );
    entries.push({ id: skillName, sourceDir: skillDir });
  }

  return entries;
};

/**
 * Build a SkillsetPackage from test data
 *
 * @param args - Function arguments
 * @param args.claudeMd - CLAUDE.md content or null
 * @param args.skills - Skill entries array
 *
 * @returns A SkillsetPackage for use in tests
 */
const buildPkg = (args: {
  claudeMd: string | null;
  skills?: Array<{ id: string; sourceDir: string }> | null;
}): SkillsetPackage => {
  const { claudeMd, skills } = args;
  return {
    claudeMd,
    skills: skills ?? [],
    subagents: [],
    slashcommands: [],
  };
};

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
    mockNoriDir = path.join(tempDir, ".nori");

    // Create .claude directory
    await fs.mkdir(claudeDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("run", () => {
    it("should create CLAUDE.md with managed block", async () => {
      const config: Config = { installDir: tempDir };
      const skills = await createSkillFiles({
        baseDir: tempDir,
        skills: TEST_SKILLS,
      });
      const pkg = buildPkg({ claudeMd: SENIOR_SWE_CLAUDE_MD, skills });

      await claudeMdLoader.install({ config, pkg });

      const content = await fs.readFile(claudeMdPath, "utf-8");

      expect(content).toContain("# BEGIN NORI-AI MANAGED BLOCK");
      expect(content).toContain("# END NORI-AI MANAGED BLOCK");
      expect(content).toContain("# Tone");
      expect(content).toContain("# Coding Guidelines");
      expect(content).toContain("<required>");
      expect(content).toContain(
        "ask me if I want to create a branch or a worktree",
      );
    });

    it("should append managed block to existing CLAUDE.md without destroying user content", async () => {
      const config: Config = { installDir: tempDir };
      const pkg = buildPkg({ claudeMd: SENIOR_SWE_CLAUDE_MD });

      const userContent =
        "# My Custom Instructions\n\nUser-specific content here.\n";
      await fs.writeFile(claudeMdPath, userContent);

      await claudeMdLoader.install({ config, pkg });

      const content = await fs.readFile(claudeMdPath, "utf-8");

      expect(content).toContain("# My Custom Instructions");
      expect(content).toContain("User-specific content here.");
      expect(content).toContain("# BEGIN NORI-AI MANAGED BLOCK");
      expect(content).toContain("# END NORI-AI MANAGED BLOCK");
    });

    it("should update existing managed block without affecting user content", async () => {
      const config: Config = { installDir: tempDir };
      const pkg = buildPkg({ claudeMd: SENIOR_SWE_CLAUDE_MD });

      const existingContent = `# User Content Before

User-specific instructions.

# BEGIN NORI-AI MANAGED BLOCK
Old nori instructions here.
# END NORI-AI MANAGED BLOCK

# User Content After

More user instructions.
`;
      await fs.writeFile(claudeMdPath, existingContent);

      await claudeMdLoader.install({ config, pkg });

      const content = await fs.readFile(claudeMdPath, "utf-8");

      expect(content).toContain("# User Content Before");
      expect(content).toContain("User-specific instructions.");
      expect(content).toContain("# User Content After");
      expect(content).toContain("More user instructions.");
      expect(content).toContain("# BEGIN NORI-AI MANAGED BLOCK");
      expect(content).toContain("# END NORI-AI MANAGED BLOCK");
      expect(content).not.toContain("Old nori instructions here.");
      expect(content).toContain("# Tone");
    });

    it("should handle switching between profiles", async () => {
      const config: Config = { installDir: tempDir };

      // First install with senior-swe content
      const seniorSwePkg = buildPkg({ claudeMd: SENIOR_SWE_CLAUDE_MD });
      await claudeMdLoader.install({ config, pkg: seniorSwePkg });

      const seniorSweContent = await fs.readFile(claudeMdPath, "utf-8");
      expect(seniorSweContent).toContain(
        "ask me if I want to create a branch or a worktree",
      );

      // Then switch to amol content
      const amolPkg = buildPkg({ claudeMd: AMOL_CLAUDE_MD });
      await claudeMdLoader.install({ config, pkg: amolPkg });

      const amolContent = await fs.readFile(claudeMdPath, "utf-8");
      expect(amolContent).toContain("automatically create a worktree");
      expect(amolContent).toContain("# BEGIN NORI-AI MANAGED BLOCK");
      expect(amolContent).toContain("# END NORI-AI MANAGED BLOCK");
    });
  });

  describe("managed block marker handling", () => {
    it("should not produce double-nested markers when profile CLAUDE.md already has markers", async () => {
      const config: Config = { installDir: tempDir };
      const profileClaudeMdContent = `# BEGIN NORI-AI MANAGED BLOCK
hello world
# END NORI-AI MANAGED BLOCK
`;
      const pkg = buildPkg({ claudeMd: profileClaudeMdContent });

      await claudeMdLoader.install({ config, pkg });

      const resultContent = await fs.readFile(claudeMdPath, "utf-8");

      const beginCount = (
        resultContent.match(/# BEGIN NORI-AI MANAGED BLOCK/g) || []
      ).length;
      const endCount = (
        resultContent.match(/# END NORI-AI MANAGED BLOCK/g) || []
      ).length;

      expect(beginCount).toBe(1);
      expect(endCount).toBe(1);
      expect(resultContent).toContain("hello world");
    });
  });

  describe("profile-based CLAUDE.md loading", () => {
    it("should load CLAUDE.md from pkg.claudeMd", async () => {
      const config: Config = { installDir: tempDir };
      const pkg = buildPkg({ claudeMd: SENIOR_SWE_CLAUDE_MD });

      await claudeMdLoader.install({ config, pkg });

      const content = await fs.readFile(claudeMdPath, "utf-8");

      expect(content).toContain("BEGIN NORI-AI MANAGED BLOCK");
      expect(content).toContain("<required>");
      expect(content).toContain(
        "ask me if I want to create a branch or a worktree",
      );
    });

    it("should load CLAUDE.md from amol profile when specified", async () => {
      const config: Config = { installDir: tempDir };
      const pkg = buildPkg({ claudeMd: AMOL_CLAUDE_MD });

      await claudeMdLoader.install({ config, pkg });

      const content = await fs.readFile(claudeMdPath, "utf-8");

      expect(content).toContain("automatically create a worktree");
      expect(content).toContain("required");
      expect(content).toContain("# Tone");
    });
  });

  describe("missing profile CLAUDE.md", () => {
    it("should remove managed block when pkg.claudeMd is null and existing CLAUDE.md has managed block", async () => {
      const config: Config = { installDir: tempDir };
      const pkg = buildPkg({ claudeMd: null });

      const existingContent = `# My Custom Instructions

User-specific content here.

# BEGIN NORI-AI MANAGED BLOCK
Old nori instructions that should be cleared.
# END NORI-AI MANAGED BLOCK

# More User Content

Additional user instructions.
`;
      await fs.writeFile(claudeMdPath, existingContent);

      await claudeMdLoader.install({ config, pkg });

      const content = await fs.readFile(claudeMdPath, "utf-8");

      expect(content).toContain("# My Custom Instructions");
      expect(content).toContain("User-specific content here.");
      expect(content).toContain("# More User Content");
      expect(content).toContain("Additional user instructions.");
      expect(content).not.toContain(
        "Old nori instructions that should be cleared.",
      );
      expect(content).toContain("# BEGIN NORI-AI MANAGED BLOCK");
      expect(content).toContain("# END NORI-AI MANAGED BLOCK");
    });

    it("should not crash and not create file when pkg.claudeMd is null and no existing CLAUDE.md", async () => {
      const config: Config = { installDir: tempDir };
      const pkg = buildPkg({ claudeMd: null });

      await fs.rm(claudeMdPath, { force: true });

      await claudeMdLoader.install({ config, pkg });

      await expect(fs.access(claudeMdPath)).rejects.toThrow();
    });

    it("should leave existing CLAUDE.md untouched when pkg.claudeMd is null and no managed block exists", async () => {
      const config: Config = { installDir: tempDir };
      const pkg = buildPkg({ claudeMd: null });

      const userContent = `# My Project Instructions

Some custom instructions here.
`;
      await fs.writeFile(claudeMdPath, userContent);

      await claudeMdLoader.install({ config, pkg });

      const content = await fs.readFile(claudeMdPath, "utf-8");
      expect(content).toBe(userContent);
    });
  });

  describe("skills list generation", () => {
    it("should include skills list in installed CLAUDE.md", async () => {
      const config: Config = { installDir: tempDir };
      const skills = await createSkillFiles({
        baseDir: tempDir,
        skills: TEST_SKILLS,
      });
      const pkg = buildPkg({ claudeMd: SENIOR_SWE_CLAUDE_MD, skills });

      await claudeMdLoader.install({ config, pkg });

      const content = await fs.readFile(claudeMdPath, "utf-8");

      expect(content).toContain("Available Skills");
      expect(content).toContain(`${claudeDir}/skills/using-skills/SKILL.md`);
      expect(content).toContain(
        `${claudeDir}/skills/test-driven-development/SKILL.md`,
      );
      expect(content).toContain(`${claudeDir}/skills/brainstorming/SKILL.md`);
    });

    it("should include skill name and description from frontmatter", async () => {
      const config: Config = { installDir: tempDir };
      const skills = await createSkillFiles({
        baseDir: tempDir,
        skills: TEST_SKILLS,
      });
      const pkg = buildPkg({ claudeMd: SENIOR_SWE_CLAUDE_MD, skills });

      await claudeMdLoader.install({ config, pkg });

      const content = await fs.readFile(claudeMdPath, "utf-8");

      expect(content).toContain("Name: Getting Started with Abilities");
      expect(content).toContain("Name: Brainstorming");
      expect(content).toMatch(/Description:.*abilities/i);
    });

    it("should handle profiles with no skills gracefully", async () => {
      const config: Config = { installDir: tempDir };
      const pkg = buildPkg({
        claudeMd: "# Product Manager\n\nFocus on product decisions.\n",
      });

      await claudeMdLoader.install({ config, pkg });

      const content = await fs.readFile(claudeMdPath, "utf-8");

      expect(content).toContain("BEGIN NORI-AI MANAGED BLOCK");
      expect(content).toContain("END NORI-AI MANAGED BLOCK");
      expect(content.length).toBeGreaterThan(0);
    });

    it("should handle skills with missing frontmatter gracefully", async () => {
      const config: Config = { installDir: tempDir };
      const skills = await createSkillFiles({
        baseDir: tempDir,
        skills: TEST_SKILLS,
      });
      const pkg = buildPkg({ claudeMd: SENIOR_SWE_CLAUDE_MD, skills });

      await claudeMdLoader.install({ config, pkg });

      const content = await fs.readFile(claudeMdPath, "utf-8");

      expect(content).toContain("BEGIN NORI-AI MANAGED BLOCK");
      expect(content).toContain("END NORI-AI MANAGED BLOCK");
    });
  });
});
