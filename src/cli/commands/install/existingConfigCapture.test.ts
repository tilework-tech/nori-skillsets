/**
 * Tests for existing config capture functionality
 * Verifies detection and capture of existing Claude Code configurations
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { promptUser } from "@/cli/prompt.js";

// Mock the prompt module
vi.mock("@/cli/prompt.js", () => ({
  promptUser: vi.fn(),
}));

const mockedPromptUser = vi.mocked(promptUser);

// Mock paths module to use temp directories
let mockClaudeDir = "";
let mockNoriDir = "";

vi.mock("@/cli/features/claude-code/paths.js", () => ({
  getClaudeDir: () => mockClaudeDir,
  getClaudeMdFile: () => path.join(mockClaudeDir, "CLAUDE.md"),
  getClaudeSkillsDir: () => path.join(mockClaudeDir, "skills"),
  getClaudeAgentsDir: () => path.join(mockClaudeDir, "agents"),
  getClaudeCommandsDir: () => path.join(mockClaudeDir, "commands"),
  getNoriDir: () => mockNoriDir,
  getNoriProfilesDir: () => path.join(mockNoriDir, "profiles"),
}));

// Import after mocking
import {
  detectExistingConfig,
  captureExistingConfigAsProfile,
  promptForExistingConfigCapture,
} from "./existingConfigCapture.js";

describe("existingConfigCapture", () => {
  let tempDir: string;
  let claudeDir: string;
  let noriDir: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "existing-config-capture-test-"),
    );
    claudeDir = path.join(tempDir, ".claude");
    noriDir = path.join(tempDir, ".nori");

    // Set mock paths
    mockClaudeDir = claudeDir;
    mockNoriDir = noriDir;

    // Clear mocks
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("detectExistingConfig", () => {
    it("should return null when no .claude directory exists", async () => {
      const result = await detectExistingConfig({ installDir: tempDir });
      expect(result).toBeNull();
    });

    it("should return null when .claude directory is empty", async () => {
      await fs.mkdir(claudeDir, { recursive: true });

      const result = await detectExistingConfig({ installDir: tempDir });
      expect(result).toBeNull();
    });

    it("should detect CLAUDE.md when it exists", async () => {
      await fs.mkdir(claudeDir, { recursive: true });
      await fs.writeFile(
        path.join(claudeDir, "CLAUDE.md"),
        "# My Custom Instructions\n\nSome content here.",
      );

      const result = await detectExistingConfig({ installDir: tempDir });

      expect(result).not.toBeNull();
      expect(result!.hasClaudeMd).toBe(true);
      expect(result!.hasManagedBlock).toBe(false);
    });

    it("should detect managed block in CLAUDE.md", async () => {
      await fs.mkdir(claudeDir, { recursive: true });
      await fs.writeFile(
        path.join(claudeDir, "CLAUDE.md"),
        `# My Custom Instructions

# BEGIN NORI-AI MANAGED BLOCK
Some managed content
# END NORI-AI MANAGED BLOCK

More custom content.`,
      );

      const result = await detectExistingConfig({ installDir: tempDir });

      expect(result).not.toBeNull();
      expect(result!.hasClaudeMd).toBe(true);
      expect(result!.hasManagedBlock).toBe(true);
    });

    it("should detect skills directory with SKILL.md files", async () => {
      await fs.mkdir(claudeDir, { recursive: true });
      const skillsDir = path.join(claudeDir, "skills");
      await fs.mkdir(skillsDir, { recursive: true });

      // Create a skill with SKILL.md
      const mySkillDir = path.join(skillsDir, "my-skill");
      await fs.mkdir(mySkillDir, { recursive: true });
      await fs.writeFile(
        path.join(mySkillDir, "SKILL.md"),
        "---\nname: My Skill\n---\n\nSkill content.",
      );

      const result = await detectExistingConfig({ installDir: tempDir });

      expect(result).not.toBeNull();
      expect(result!.hasSkills).toBe(true);
      expect(result!.skillCount).toBe(1);
    });

    it("should count multiple skills correctly", async () => {
      await fs.mkdir(claudeDir, { recursive: true });
      const skillsDir = path.join(claudeDir, "skills");
      await fs.mkdir(skillsDir, { recursive: true });

      // Create multiple skills
      for (const skillName of ["skill-1", "skill-2", "skill-3"]) {
        const skillDir = path.join(skillsDir, skillName);
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(
          path.join(skillDir, "SKILL.md"),
          `---\nname: ${skillName}\n---\n\nContent.`,
        );
      }

      const result = await detectExistingConfig({ installDir: tempDir });

      expect(result).not.toBeNull();
      expect(result!.hasSkills).toBe(true);
      expect(result!.skillCount).toBe(3);
    });

    it("should not count empty skill directories", async () => {
      await fs.mkdir(claudeDir, { recursive: true });
      const skillsDir = path.join(claudeDir, "skills");
      await fs.mkdir(skillsDir, { recursive: true });

      // Create empty skill directory (no SKILL.md)
      const emptySkillDir = path.join(skillsDir, "empty-skill");
      await fs.mkdir(emptySkillDir, { recursive: true });

      // Create valid skill
      const validSkillDir = path.join(skillsDir, "valid-skill");
      await fs.mkdir(validSkillDir, { recursive: true });
      await fs.writeFile(path.join(validSkillDir, "SKILL.md"), "Content");

      const result = await detectExistingConfig({ installDir: tempDir });

      expect(result).not.toBeNull();
      expect(result!.hasSkills).toBe(true);
      expect(result!.skillCount).toBe(1);
    });

    it("should detect agents directory with .md files", async () => {
      await fs.mkdir(claudeDir, { recursive: true });
      const agentsDir = path.join(claudeDir, "agents");
      await fs.mkdir(agentsDir, { recursive: true });

      await fs.writeFile(
        path.join(agentsDir, "my-agent.md"),
        "# My Agent\n\nAgent instructions.",
      );

      const result = await detectExistingConfig({ installDir: tempDir });

      expect(result).not.toBeNull();
      expect(result!.hasAgents).toBe(true);
      expect(result!.agentCount).toBe(1);
    });

    it("should count multiple agents correctly", async () => {
      await fs.mkdir(claudeDir, { recursive: true });
      const agentsDir = path.join(claudeDir, "agents");
      await fs.mkdir(agentsDir, { recursive: true });

      await fs.writeFile(path.join(agentsDir, "agent-1.md"), "Agent 1");
      await fs.writeFile(path.join(agentsDir, "agent-2.md"), "Agent 2");

      const result = await detectExistingConfig({ installDir: tempDir });

      expect(result).not.toBeNull();
      expect(result!.hasAgents).toBe(true);
      expect(result!.agentCount).toBe(2);
    });

    it("should not count non-.md files in agents directory", async () => {
      await fs.mkdir(claudeDir, { recursive: true });
      const agentsDir = path.join(claudeDir, "agents");
      await fs.mkdir(agentsDir, { recursive: true });

      await fs.writeFile(path.join(agentsDir, "valid-agent.md"), "Agent");
      await fs.writeFile(path.join(agentsDir, "not-an-agent.txt"), "Text file");
      await fs.writeFile(path.join(agentsDir, "config.json"), "{}");

      const result = await detectExistingConfig({ installDir: tempDir });

      expect(result).not.toBeNull();
      expect(result!.hasAgents).toBe(true);
      expect(result!.agentCount).toBe(1);
    });

    it("should detect commands directory with .md files", async () => {
      await fs.mkdir(claudeDir, { recursive: true });
      const commandsDir = path.join(claudeDir, "commands");
      await fs.mkdir(commandsDir, { recursive: true });

      await fs.writeFile(
        path.join(commandsDir, "my-command.md"),
        "# My Command\n\nCommand content.",
      );

      const result = await detectExistingConfig({ installDir: tempDir });

      expect(result).not.toBeNull();
      expect(result!.hasCommands).toBe(true);
      expect(result!.commandCount).toBe(1);
    });

    it("should count multiple commands correctly", async () => {
      await fs.mkdir(claudeDir, { recursive: true });
      const commandsDir = path.join(claudeDir, "commands");
      await fs.mkdir(commandsDir, { recursive: true });

      await fs.writeFile(path.join(commandsDir, "cmd-1.md"), "Command 1");
      await fs.writeFile(path.join(commandsDir, "cmd-2.md"), "Command 2");
      await fs.writeFile(path.join(commandsDir, "cmd-3.md"), "Command 3");

      const result = await detectExistingConfig({ installDir: tempDir });

      expect(result).not.toBeNull();
      expect(result!.hasCommands).toBe(true);
      expect(result!.commandCount).toBe(3);
    });

    it("should detect all components together", async () => {
      await fs.mkdir(claudeDir, { recursive: true });

      // Create CLAUDE.md with managed block
      await fs.writeFile(
        path.join(claudeDir, "CLAUDE.md"),
        `# BEGIN NORI-AI MANAGED BLOCK\nManaged\n# END NORI-AI MANAGED BLOCK`,
      );

      // Create skills
      const skillsDir = path.join(claudeDir, "skills");
      await fs.mkdir(skillsDir, { recursive: true });
      const skill1 = path.join(skillsDir, "skill-1");
      await fs.mkdir(skill1, { recursive: true });
      await fs.writeFile(path.join(skill1, "SKILL.md"), "Skill 1");
      const skill2 = path.join(skillsDir, "skill-2");
      await fs.mkdir(skill2, { recursive: true });
      await fs.writeFile(path.join(skill2, "SKILL.md"), "Skill 2");

      // Create agents
      const agentsDir = path.join(claudeDir, "agents");
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.writeFile(path.join(agentsDir, "agent.md"), "Agent");

      // Create commands
      const commandsDir = path.join(claudeDir, "commands");
      await fs.mkdir(commandsDir, { recursive: true });
      await fs.writeFile(path.join(commandsDir, "cmd-1.md"), "Cmd 1");
      await fs.writeFile(path.join(commandsDir, "cmd-2.md"), "Cmd 2");
      await fs.writeFile(path.join(commandsDir, "cmd-3.md"), "Cmd 3");

      const result = await detectExistingConfig({ installDir: tempDir });

      expect(result).not.toBeNull();
      expect(result!.hasClaudeMd).toBe(true);
      expect(result!.hasManagedBlock).toBe(true);
      expect(result!.hasSkills).toBe(true);
      expect(result!.skillCount).toBe(2);
      expect(result!.hasAgents).toBe(true);
      expect(result!.agentCount).toBe(1);
      expect(result!.hasCommands).toBe(true);
      expect(result!.commandCount).toBe(3);
    });
  });

  describe("captureExistingConfigAsProfile", () => {
    it("should create profile directory in .nori/profiles/", async () => {
      // Set up existing config
      await fs.mkdir(claudeDir, { recursive: true });
      await fs.writeFile(
        path.join(claudeDir, "CLAUDE.md"),
        "# My Instructions",
      );

      await captureExistingConfigAsProfile({
        installDir: tempDir,
        profileName: "my-captured-profile",
      });

      const profileDir = path.join(noriDir, "profiles", "my-captured-profile");
      const exists = await fs
        .access(profileDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it("should create valid profile.json with builtin: false", async () => {
      await fs.mkdir(claudeDir, { recursive: true });
      await fs.writeFile(
        path.join(claudeDir, "CLAUDE.md"),
        "# My Instructions",
      );

      await captureExistingConfigAsProfile({
        installDir: tempDir,
        profileName: "captured-config",
      });

      const profileJsonPath = path.join(
        noriDir,
        "profiles",
        "captured-config",
        "profile.json",
      );
      const profileJson = JSON.parse(
        await fs.readFile(profileJsonPath, "utf-8"),
      );

      expect(profileJson.name).toBe("captured-config");
      expect(profileJson.description).toBe(
        "Captured from existing configuration",
      );
      expect(profileJson.builtin).toBe(false);
    });

    it("should copy CLAUDE.md with managed block markers added when not present", async () => {
      await fs.mkdir(claudeDir, { recursive: true });
      const originalContent = "# My Custom Instructions\n\nSome content here.";
      await fs.writeFile(path.join(claudeDir, "CLAUDE.md"), originalContent);

      await captureExistingConfigAsProfile({
        installDir: tempDir,
        profileName: "captured",
      });

      const capturedClaudeMd = await fs.readFile(
        path.join(noriDir, "profiles", "captured", "CLAUDE.md"),
        "utf-8",
      );

      expect(capturedClaudeMd).toContain("# BEGIN NORI-AI MANAGED BLOCK");
      expect(capturedClaudeMd).toContain("# END NORI-AI MANAGED BLOCK");
      expect(capturedClaudeMd).toContain("# My Custom Instructions");
      expect(capturedClaudeMd).toContain("Some content here.");
    });

    it("should preserve existing managed block content without double-wrapping", async () => {
      await fs.mkdir(claudeDir, { recursive: true });
      const originalContent = `# User content before

# BEGIN NORI-AI MANAGED BLOCK
Managed content here
# END NORI-AI MANAGED BLOCK

# User content after`;
      await fs.writeFile(path.join(claudeDir, "CLAUDE.md"), originalContent);

      await captureExistingConfigAsProfile({
        installDir: tempDir,
        profileName: "captured",
      });

      const capturedClaudeMd = await fs.readFile(
        path.join(noriDir, "profiles", "captured", "CLAUDE.md"),
        "utf-8",
      );

      // Should not have double BEGIN markers
      const beginCount = (
        capturedClaudeMd.match(/# BEGIN NORI-AI MANAGED BLOCK/g) || []
      ).length;
      expect(beginCount).toBe(1);

      // Should preserve all content
      expect(capturedClaudeMd).toContain("# User content before");
      expect(capturedClaudeMd).toContain("Managed content here");
      expect(capturedClaudeMd).toContain("# User content after");
    });

    it("should copy skills directory preserving structure", async () => {
      await fs.mkdir(claudeDir, { recursive: true });
      await fs.writeFile(path.join(claudeDir, "CLAUDE.md"), "# Instructions");

      // Create skills
      const skillsDir = path.join(claudeDir, "skills");
      await fs.mkdir(skillsDir, { recursive: true });

      const mySkillDir = path.join(skillsDir, "my-skill");
      await fs.mkdir(mySkillDir, { recursive: true });
      await fs.writeFile(
        path.join(mySkillDir, "SKILL.md"),
        "---\nname: My Skill\n---\n\nSkill content.",
      );
      await fs.writeFile(
        path.join(mySkillDir, "helper.ts"),
        "export const helper = () => {};",
      );

      await captureExistingConfigAsProfile({
        installDir: tempDir,
        profileName: "captured",
      });

      // Verify skill was copied
      const capturedSkillDir = path.join(
        noriDir,
        "profiles",
        "captured",
        "skills",
        "my-skill",
      );
      const skillMdExists = await fs
        .access(path.join(capturedSkillDir, "SKILL.md"))
        .then(() => true)
        .catch(() => false);
      const helperExists = await fs
        .access(path.join(capturedSkillDir, "helper.ts"))
        .then(() => true)
        .catch(() => false);

      expect(skillMdExists).toBe(true);
      expect(helperExists).toBe(true);

      // Verify content
      const skillContent = await fs.readFile(
        path.join(capturedSkillDir, "SKILL.md"),
        "utf-8",
      );
      expect(skillContent).toContain("name: My Skill");
    });

    it("should copy agents directory as subagents", async () => {
      await fs.mkdir(claudeDir, { recursive: true });
      await fs.writeFile(path.join(claudeDir, "CLAUDE.md"), "# Instructions");

      // Create agents
      const agentsDir = path.join(claudeDir, "agents");
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.writeFile(
        path.join(agentsDir, "my-agent.md"),
        "# My Agent\n\nAgent instructions.",
      );

      await captureExistingConfigAsProfile({
        installDir: tempDir,
        profileName: "captured",
      });

      // Verify agent was copied to subagents directory
      const capturedAgentPath = path.join(
        noriDir,
        "profiles",
        "captured",
        "subagents",
        "my-agent.md",
      );
      const exists = await fs
        .access(capturedAgentPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      const content = await fs.readFile(capturedAgentPath, "utf-8");
      expect(content).toContain("# My Agent");
    });

    it("should copy commands directory as slashcommands", async () => {
      await fs.mkdir(claudeDir, { recursive: true });
      await fs.writeFile(path.join(claudeDir, "CLAUDE.md"), "# Instructions");

      // Create commands
      const commandsDir = path.join(claudeDir, "commands");
      await fs.mkdir(commandsDir, { recursive: true });
      await fs.writeFile(
        path.join(commandsDir, "my-command.md"),
        "# My Command\n\nCommand content.",
      );

      await captureExistingConfigAsProfile({
        installDir: tempDir,
        profileName: "captured",
      });

      // Verify command was copied to slashcommands directory
      const capturedCommandPath = path.join(
        noriDir,
        "profiles",
        "captured",
        "slashcommands",
        "my-command.md",
      );
      const exists = await fs
        .access(capturedCommandPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      const content = await fs.readFile(capturedCommandPath, "utf-8");
      expect(content).toContain("# My Command");
    });

    it("should handle partial configs gracefully (only CLAUDE.md)", async () => {
      await fs.mkdir(claudeDir, { recursive: true });
      await fs.writeFile(
        path.join(claudeDir, "CLAUDE.md"),
        "# Only CLAUDE.md exists",
      );
      // No skills, agents, or commands directories

      await captureExistingConfigAsProfile({
        installDir: tempDir,
        profileName: "partial",
      });

      const profileDir = path.join(noriDir, "profiles", "partial");

      // CLAUDE.md should exist
      const claudeMdExists = await fs
        .access(path.join(profileDir, "CLAUDE.md"))
        .then(() => true)
        .catch(() => false);
      expect(claudeMdExists).toBe(true);

      // profile.json should exist
      const profileJsonExists = await fs
        .access(path.join(profileDir, "profile.json"))
        .then(() => true)
        .catch(() => false);
      expect(profileJsonExists).toBe(true);

      // Other directories should not exist (or be empty)
      const skillsExists = await fs
        .access(path.join(profileDir, "skills"))
        .then(() => true)
        .catch(() => false);
      expect(skillsExists).toBe(false);
    });

    it("should handle empty CLAUDE.md", async () => {
      await fs.mkdir(claudeDir, { recursive: true });
      await fs.writeFile(path.join(claudeDir, "CLAUDE.md"), "");

      await captureExistingConfigAsProfile({
        installDir: tempDir,
        profileName: "empty-claude",
      });

      const capturedClaudeMd = await fs.readFile(
        path.join(noriDir, "profiles", "empty-claude", "CLAUDE.md"),
        "utf-8",
      );

      // Should still have managed block markers even if content is empty
      expect(capturedClaudeMd).toContain("# BEGIN NORI-AI MANAGED BLOCK");
      expect(capturedClaudeMd).toContain("# END NORI-AI MANAGED BLOCK");
    });

    it("should create nori.json with correct schema", async () => {
      await fs.mkdir(claudeDir, { recursive: true });
      await fs.writeFile(
        path.join(claudeDir, "CLAUDE.md"),
        "# My Instructions",
      );

      await captureExistingConfigAsProfile({
        installDir: tempDir,
        profileName: "captured-config",
      });

      const noriJsonPath = path.join(
        noriDir,
        "profiles",
        "captured-config",
        "nori.json",
      );
      const noriJson = JSON.parse(await fs.readFile(noriJsonPath, "utf-8"));

      expect(noriJson.name).toBe("captured-config");
      expect(noriJson.version).toBe("1.0.0");
      expect(noriJson.dependencies).toBeDefined();
      expect(noriJson.dependencies.skills).toBeDefined();
    });

    it("should populate nori.json skills from captured skills directory", async () => {
      await fs.mkdir(claudeDir, { recursive: true });
      await fs.writeFile(path.join(claudeDir, "CLAUDE.md"), "# Instructions");

      // Create skills
      const skillsDir = path.join(claudeDir, "skills");
      await fs.mkdir(skillsDir, { recursive: true });

      const skill1Dir = path.join(skillsDir, "my-skill");
      await fs.mkdir(skill1Dir, { recursive: true });
      await fs.writeFile(path.join(skill1Dir, "SKILL.md"), "Skill 1 content");

      const skill2Dir = path.join(skillsDir, "another-skill");
      await fs.mkdir(skill2Dir, { recursive: true });
      await fs.writeFile(path.join(skill2Dir, "SKILL.md"), "Skill 2 content");

      await captureExistingConfigAsProfile({
        installDir: tempDir,
        profileName: "with-skills",
      });

      const noriJsonPath = path.join(
        noriDir,
        "profiles",
        "with-skills",
        "nori.json",
      );
      const noriJson = JSON.parse(await fs.readFile(noriJsonPath, "utf-8"));

      expect(noriJson.dependencies.skills).toEqual({
        "my-skill": "*",
        "another-skill": "*",
      });
    });

    it("should create nori.json with empty skills when no skills directory exists", async () => {
      await fs.mkdir(claudeDir, { recursive: true });
      await fs.writeFile(
        path.join(claudeDir, "CLAUDE.md"),
        "# Only CLAUDE.md exists",
      );

      await captureExistingConfigAsProfile({
        installDir: tempDir,
        profileName: "no-skills",
      });

      const noriJsonPath = path.join(
        noriDir,
        "profiles",
        "no-skills",
        "nori.json",
      );
      const noriJson = JSON.parse(await fs.readFile(noriJsonPath, "utf-8"));

      expect(noriJson.dependencies.skills).toEqual({});
    });

    it("should only include valid skills (directories with SKILL.md) in nori.json", async () => {
      await fs.mkdir(claudeDir, { recursive: true });
      await fs.writeFile(path.join(claudeDir, "CLAUDE.md"), "# Instructions");

      const skillsDir = path.join(claudeDir, "skills");
      await fs.mkdir(skillsDir, { recursive: true });

      // Valid skill with SKILL.md
      const validSkillDir = path.join(skillsDir, "valid-skill");
      await fs.mkdir(validSkillDir, { recursive: true });
      await fs.writeFile(path.join(validSkillDir, "SKILL.md"), "Valid skill");

      // Invalid - directory without SKILL.md
      const invalidSkillDir = path.join(skillsDir, "invalid-skill");
      await fs.mkdir(invalidSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(invalidSkillDir, "README.md"),
        "No SKILL.md",
      );

      // Invalid - file, not directory
      await fs.writeFile(
        path.join(skillsDir, "not-a-skill.txt"),
        "Just a file",
      );

      await captureExistingConfigAsProfile({
        installDir: tempDir,
        profileName: "mixed-skills",
      });

      const noriJsonPath = path.join(
        noriDir,
        "profiles",
        "mixed-skills",
        "nori.json",
      );
      const noriJson = JSON.parse(await fs.readFile(noriJsonPath, "utf-8"));

      // Only the valid skill should be included
      expect(noriJson.dependencies.skills).toEqual({
        "valid-skill": "*",
      });
    });
  });

  describe("promptForExistingConfigCapture", () => {
    it("should display what was detected", async () => {
      mockedPromptUser.mockResolvedValueOnce("n"); // User declines

      await promptForExistingConfigCapture({
        existingConfig: {
          hasClaudeMd: true,
          hasManagedBlock: false,
          hasSkills: true,
          skillCount: 3,
          hasAgents: true,
          agentCount: 2,
          hasCommands: true,
          commandCount: 1,
        },
      });

      // This test just verifies the function runs without error
      // The actual display is handled by logger which we don't mock here
      expect(mockedPromptUser).toHaveBeenCalled();
    });

    it("should show warning when managed block is detected", async () => {
      mockedPromptUser.mockResolvedValueOnce("n"); // User declines

      // We can't easily test console output, but we can verify the function
      // runs and accepts hasManagedBlock: true
      await promptForExistingConfigCapture({
        existingConfig: {
          hasClaudeMd: true,
          hasManagedBlock: true,
          hasSkills: false,
          skillCount: 0,
          hasAgents: false,
          agentCount: 0,
          hasCommands: false,
          commandCount: 0,
        },
      });

      expect(mockedPromptUser).toHaveBeenCalled();
    });

    it("should return null when user declines to save", async () => {
      mockedPromptUser.mockResolvedValueOnce("n");

      const result = await promptForExistingConfigCapture({
        existingConfig: {
          hasClaudeMd: true,
          hasManagedBlock: false,
          hasSkills: false,
          skillCount: 0,
          hasAgents: false,
          agentCount: 0,
          hasCommands: false,
          commandCount: 0,
        },
      });

      expect(result).toBeNull();
    });

    it("should return profile name when user accepts and provides name", async () => {
      mockedPromptUser
        .mockResolvedValueOnce("y") // User accepts
        .mockResolvedValueOnce("my-profile"); // Profile name

      const result = await promptForExistingConfigCapture({
        existingConfig: {
          hasClaudeMd: true,
          hasManagedBlock: false,
          hasSkills: false,
          skillCount: 0,
          hasAgents: false,
          agentCount: 0,
          hasCommands: false,
          commandCount: 0,
        },
      });

      expect(result).toBe("my-profile");
    });

    it("should re-prompt for empty profile name", async () => {
      mockedPromptUser
        .mockResolvedValueOnce("y") // User accepts
        .mockResolvedValueOnce("") // Empty name (invalid)
        .mockResolvedValueOnce("valid-name"); // Valid name

      const result = await promptForExistingConfigCapture({
        existingConfig: {
          hasClaudeMd: true,
          hasManagedBlock: false,
          hasSkills: false,
          skillCount: 0,
          hasAgents: false,
          agentCount: 0,
          hasCommands: false,
          commandCount: 0,
        },
      });

      expect(result).toBe("valid-name");
      // Should have been called 3 times: accept, empty name, valid name
      expect(mockedPromptUser).toHaveBeenCalledTimes(3);
    });

    it("should re-prompt for profile name with invalid characters", async () => {
      mockedPromptUser
        .mockResolvedValueOnce("y") // User accepts
        .mockResolvedValueOnce("Invalid Name!") // Invalid (has spaces and !)
        .mockResolvedValueOnce("valid-name"); // Valid name

      const result = await promptForExistingConfigCapture({
        existingConfig: {
          hasClaudeMd: true,
          hasManagedBlock: false,
          hasSkills: false,
          skillCount: 0,
          hasAgents: false,
          agentCount: 0,
          hasCommands: false,
          commandCount: 0,
        },
      });

      expect(result).toBe("valid-name");
      expect(mockedPromptUser).toHaveBeenCalledTimes(3);
    });

    it("should accept profile name with hyphens and numbers", async () => {
      mockedPromptUser
        .mockResolvedValueOnce("y") // User accepts
        .mockResolvedValueOnce("my-profile-123"); // Valid name with hyphens and numbers

      const result = await promptForExistingConfigCapture({
        existingConfig: {
          hasClaudeMd: true,
          hasManagedBlock: false,
          hasSkills: false,
          skillCount: 0,
          hasAgents: false,
          agentCount: 0,
          hasCommands: false,
          commandCount: 0,
        },
      });

      expect(result).toBe("my-profile-123");
    });
  });
});
