/**
 * Integration tests for the generic install pipeline
 * Tests end-to-end installation for both Claude Code and Codex agents
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { installProfile } from "./installProfile.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline-test-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

/**
 * Creates a stub profile in .nori/profiles/{profileName}/ with:
 * - CLAUDE.md (instructions)
 * - skills/test-skill/SKILL.md
 * - subagents/test-subagent.md
 * - slashcommands/test-command.md
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 * @param args.profileName - Name of the profile to create
 */
const createStubProfile = async (args: {
  installDir: string;
  profileName: string;
}): Promise<void> => {
  const { installDir, profileName } = args;
  const profileDir = path.join(installDir, ".nori", "profiles", profileName);

  // Instructions file
  await fs.mkdir(profileDir, { recursive: true });
  await fs.writeFile(
    path.join(profileDir, "CLAUDE.md"),
    "# Test Profile\n\nUse TodoWrite to track tasks.\n",
  );

  // Skill
  const skillDir = path.join(profileDir, "skills", "test-skill");
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    [
      "---",
      "name: test-skill",
      "description: A test skill for pipeline testing",
      "---",
      "",
      "# Test Skill",
      "",
      "Use TodoWrite to plan. Skills are in {{skills_dir}}.",
    ].join("\n"),
  );

  // Subagent
  const subagentsDir = path.join(profileDir, "subagents");
  await fs.mkdir(subagentsDir, { recursive: true });
  await fs.writeFile(
    path.join(subagentsDir, "test-subagent.md"),
    "# Test Subagent\n\nSearch skills in {{skills_dir}}.\n",
  );

  // Slash command
  const commandsDir = path.join(profileDir, "slashcommands");
  await fs.mkdir(commandsDir, { recursive: true });
  await fs.writeFile(
    path.join(commandsDir, "test-command.md"),
    "# Test Command\n\nRun from {{commands_dir}}.\n",
  );

  // nori.json
  await fs.writeFile(
    path.join(profileDir, "nori.json"),
    JSON.stringify({
      name: profileName,
      version: "1.0.0",
      description: "Test profile",
    }),
  );
};

describe("installProfile", () => {
  describe("Claude Code agent", () => {
    it("installs instructions to .claude/CLAUDE.md with managed block", async () => {
      await createStubProfile({
        installDir: tempDir,
        profileName: "test-profile",
      });

      await installProfile({
        agentName: "claude-code",
        profileName: "test-profile",
        installDir: tempDir,
      });

      const claudeMdPath = path.join(tempDir, ".claude", "CLAUDE.md");
      const content = await fs.readFile(claudeMdPath, "utf-8");

      expect(content).toContain("# BEGIN NORI-AI MANAGED BLOCK");
      expect(content).toContain("# END NORI-AI MANAGED BLOCK");
      expect(content).toContain("Test Profile");
    });

    it("installs skills to .claude/skills/", async () => {
      await createStubProfile({
        installDir: tempDir,
        profileName: "test-profile",
      });

      await installProfile({
        agentName: "claude-code",
        profileName: "test-profile",
        installDir: tempDir,
      });

      const skillPath = path.join(
        tempDir,
        ".claude",
        "skills",
        "test-skill",
        "SKILL.md",
      );
      const content = await fs.readFile(skillPath, "utf-8");

      expect(content).toContain("# Test Skill");
      // Template substitution should have replaced {{skills_dir}}
      expect(content).toContain(path.join(tempDir, ".claude", "skills"));
      expect(content).not.toContain("{{skills_dir}}");
    });

    it("installs subagents to .claude/agents/", async () => {
      await createStubProfile({
        installDir: tempDir,
        profileName: "test-profile",
      });

      await installProfile({
        agentName: "claude-code",
        profileName: "test-profile",
        installDir: tempDir,
      });

      const subagentPath = path.join(
        tempDir,
        ".claude",
        "agents",
        "test-subagent.md",
      );
      const content = await fs.readFile(subagentPath, "utf-8");

      expect(content).toContain("# Test Subagent");
      expect(content).toContain(path.join(tempDir, ".claude", "skills"));
      expect(content).not.toContain("{{skills_dir}}");
    });

    it("installs slash commands to .claude/commands/", async () => {
      await createStubProfile({
        installDir: tempDir,
        profileName: "test-profile",
      });

      await installProfile({
        agentName: "claude-code",
        profileName: "test-profile",
        installDir: tempDir,
      });

      const commandPath = path.join(
        tempDir,
        ".claude",
        "commands",
        "test-command.md",
      );
      const content = await fs.readFile(commandPath, "utf-8");

      expect(content).toContain("# Test Command");
      expect(content).toContain(path.join(tempDir, ".claude", "commands"));
      expect(content).not.toContain("{{commands_dir}}");
    });

    it("preserves Claude-specific tool names in content", async () => {
      await createStubProfile({
        installDir: tempDir,
        profileName: "test-profile",
      });

      await installProfile({
        agentName: "claude-code",
        profileName: "test-profile",
        installDir: tempDir,
      });

      const skillPath = path.join(
        tempDir,
        ".claude",
        "skills",
        "test-skill",
        "SKILL.md",
      );
      const content = await fs.readFile(skillPath, "utf-8");

      // Claude should keep TodoWrite as-is
      expect(content).toContain("TodoWrite");
    });
  });

  describe("Codex agent", () => {
    it("installs instructions to .codex/AGENTS.md with managed block", async () => {
      await createStubProfile({
        installDir: tempDir,
        profileName: "test-profile",
      });

      await installProfile({
        agentName: "codex",
        profileName: "test-profile",
        installDir: tempDir,
      });

      const agentsMdPath = path.join(tempDir, ".codex", "AGENTS.md");
      const content = await fs.readFile(agentsMdPath, "utf-8");

      expect(content).toContain("# BEGIN NORI-AI MANAGED BLOCK");
      expect(content).toContain("# END NORI-AI MANAGED BLOCK");
      expect(content).toContain("Test Profile");
    });

    it("installs skills to .codex/skills/ with vocabulary translation", async () => {
      await createStubProfile({
        installDir: tempDir,
        profileName: "test-profile",
      });

      await installProfile({
        agentName: "codex",
        profileName: "test-profile",
        installDir: tempDir,
      });

      const skillPath = path.join(
        tempDir,
        ".codex",
        "skills",
        "test-skill",
        "SKILL.md",
      );
      const content = await fs.readFile(skillPath, "utf-8");

      expect(content).toContain("# Test Skill");
      // Vocabulary translation: TodoWrite -> update_plan
      expect(content).toContain("update_plan");
      expect(content).not.toContain("TodoWrite");
      // Template substitution: {{skills_dir}} -> .codex/skills
      expect(content).toContain(path.join(tempDir, ".codex", "skills"));
      expect(content).not.toContain("{{skills_dir}}");
    });

    it("installs subagents to .codex/agents/", async () => {
      await createStubProfile({
        installDir: tempDir,
        profileName: "test-profile",
      });

      await installProfile({
        agentName: "codex",
        profileName: "test-profile",
        installDir: tempDir,
      });

      const subagentPath = path.join(
        tempDir,
        ".codex",
        "agents",
        "test-subagent.md",
      );
      const content = await fs.readFile(subagentPath, "utf-8");

      expect(content).toContain("# Test Subagent");
      // Template substitution should use codex paths
      expect(content).toContain(path.join(tempDir, ".codex", "skills"));
    });

    it("installs slash commands to .codex/commands/", async () => {
      await createStubProfile({
        installDir: tempDir,
        profileName: "test-profile",
      });

      await installProfile({
        agentName: "codex",
        profileName: "test-profile",
        installDir: tempDir,
      });

      const commandPath = path.join(
        tempDir,
        ".codex",
        "commands",
        "test-command.md",
      );
      const content = await fs.readFile(commandPath, "utf-8");

      expect(content).toContain("# Test Command");
      expect(content).toContain(path.join(tempDir, ".codex", "commands"));
    });

    it("translates vocabulary in instructions", async () => {
      await createStubProfile({
        installDir: tempDir,
        profileName: "test-profile",
      });

      await installProfile({
        agentName: "codex",
        profileName: "test-profile",
        installDir: tempDir,
      });

      const agentsMdPath = path.join(tempDir, ".codex", "AGENTS.md");
      const content = await fs.readFile(agentsMdPath, "utf-8");

      // Instructions had "Use TodoWrite to track tasks"
      expect(content).toContain("update_plan");
      expect(content).not.toContain("TodoWrite");
    });
  });

  describe("handles missing optional directories", () => {
    it("installs without subagents when subagents dir is missing", async () => {
      const profileDir = path.join(
        tempDir,
        ".nori",
        "profiles",
        "minimal-profile",
      );
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(path.join(profileDir, "CLAUDE.md"), "# Minimal\n");
      await fs.writeFile(
        path.join(profileDir, "nori.json"),
        JSON.stringify({ name: "minimal-profile", version: "1.0.0" }),
      );

      // Should not throw
      await installProfile({
        agentName: "codex",
        profileName: "minimal-profile",
        installDir: tempDir,
      });

      const agentsMdPath = path.join(tempDir, ".codex", "AGENTS.md");
      const content = await fs.readFile(agentsMdPath, "utf-8");
      expect(content).toContain("# Minimal");
    });
  });
});
