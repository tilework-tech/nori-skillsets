/**
 * Tests for shared skills loader
 * Verifies that skillsLoader copies skills from a skillset into the
 * agent's skills directory, applying template substitution to .md files.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { skillsLoader } from "@/cli/features/shared/skillsLoader.js";

import type { Config } from "@/cli/config.js";
import type { AgentConfig } from "@/cli/features/agentRegistry.js";
import type { Skillset } from "@/norijson/skillset.js";

// Suppress clack output during tests
vi.mock("@clack/prompts", () => ({
  log: { info: vi.fn(), warn: vi.fn(), success: vi.fn(), error: vi.fn() },
  note: vi.fn(),
}));

// Mock os.homedir to point at the temp directory
let mockHomeDir: string;
vi.mock("os", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof os;
  return {
    ...actual,
    homedir: () => mockHomeDir,
    tmpdir: actual.tmpdir,
  };
});

let mockNoriDir: string;

// Mock bundled skillsets installer
const mockCopyBundledSkills = vi.fn();
vi.mock("@/cli/features/bundled-skillsets/installer.js", () => ({
  getBundledSkillsDir: () => "/nonexistent-bundled-skills",
  copyBundledSkills: (...args: Array<unknown>) =>
    mockCopyBundledSkills(...args),
}));

// ---- helpers ----------------------------------------------------------------

const createTestAgent = (args: { agentDir: string }): AgentConfig => {
  const { agentDir } = args;
  const dirName = path.basename(agentDir);
  return {
    name: "claude-code",
    displayName: "Test Agent",
    description: "Test agent for shared loader tests",
    getAgentDir: (a: { installDir: string }) =>
      path.join(a.installDir, dirName),
    getSkillsDir: (a: { installDir: string }) =>
      path.join(a.installDir, dirName, "skills"),
    getSubagentsDir: (a: { installDir: string }) =>
      path.join(a.installDir, dirName, "agents"),
    getSlashcommandsDir: (a: { installDir: string }) =>
      path.join(a.installDir, dirName, "commands"),
    getInstructionsFilePath: (a: { installDir: string }) =>
      path.join(a.installDir, dirName, "CLAUDE.md"),
    getLoaders: () => [],
  };
};

const createTestConfig = (args: {
  installDir: string;
  activeSkillset?: string | null;
}): Config => {
  const { installDir, activeSkillset } = args;
  return { installDir, activeSkillset };
};

const createTestSkillset = async (args: {
  skillsetsDir: string;
  skillsetName: string;
  skills?: Record<string, string> | null;
  extraFiles?: Record<string, string> | null;
}): Promise<Skillset> => {
  const { skillsetsDir, skillsetName, skills, extraFiles } = args;
  const skillsetDir = path.join(skillsetsDir, skillsetName);
  await fs.mkdir(skillsetDir, { recursive: true });
  await fs.writeFile(
    path.join(skillsetDir, "nori.json"),
    JSON.stringify({ name: skillsetName, version: "1.0.0" }),
  );

  let skillsDir: string | null = null;
  if (skills != null && Object.keys(skills).length > 0) {
    const sDir = path.join(skillsetDir, "skills");
    for (const [skillName, content] of Object.entries(skills)) {
      const dir = path.join(sDir, skillName);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "SKILL.md"), content);
    }
    // Write any extra non-md files into skills directory
    if (extraFiles != null) {
      for (const [relPath, content] of Object.entries(extraFiles)) {
        const fullPath = path.join(sDir, relPath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content);
      }
    }
    skillsDir = sDir;
  }

  return {
    name: skillsetName,
    dir: skillsetDir,
    metadata: { name: skillsetName, version: "1.0.0" },
    skillsDir,
    configFilePath: null,
    slashcommandsDir: null,
    subagentsDir: null,
  };
};

// ---- test data --------------------------------------------------------------

const TEST_SKILLS: Record<string, string> = {
  "using-skills": [
    "---",
    "name: Getting Started with Abilities",
    "description: Describes how to use abilities.",
    "---",
    "# Using Skills",
    "",
    "Skills at {{skills_dir}}/some-skill/SKILL.md",
  ].join("\n"),
  "creating-skills": [
    "---",
    "name: Creating-Skills",
    "description: Use when you need to create a new custom skill.",
    "---",
    "# Creating Skills",
  ].join("\n"),
};

// ---- tests ------------------------------------------------------------------

describe("skillsLoader", () => {
  let tempDir: string;
  let agentDir: string;
  let skillsDir: string;
  let noriProfilesDir: string;
  let agent: AgentConfig;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-loader-test-"));
    agentDir = path.join(tempDir, ".test-agent");
    skillsDir = path.join(agentDir, "skills");

    mockHomeDir = tempDir;
    mockNoriDir = path.join(tempDir, ".nori");
    noriProfilesDir = path.join(mockNoriDir, "profiles");

    await fs.mkdir(agentDir, { recursive: true });
    await fs.mkdir(noriProfilesDir, { recursive: true });

    agent = createTestAgent({ agentDir });

    mockCopyBundledSkills.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe("copying skills", () => {
    it("should copy skills from skillset.skillsDir to the agent skills directory", async () => {
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "test-skillset",
      });
      const skillset = await createTestSkillset({
        skillsetsDir: noriProfilesDir,
        skillsetName: "test-skillset",
        skills: TEST_SKILLS,
      });

      await skillsLoader.run({ agent, config, skillset });

      // Verify skills were copied
      const usingSkillsPath = path.join(skillsDir, "using-skills", "SKILL.md");
      const creatingSkillsPath = path.join(
        skillsDir,
        "creating-skills",
        "SKILL.md",
      );

      const usingSkillsExists = await fs
        .access(usingSkillsPath)
        .then(() => true)
        .catch(() => false);
      const creatingSkillsExists = await fs
        .access(creatingSkillsPath)
        .then(() => true)
        .catch(() => false);

      expect(usingSkillsExists).toBe(true);
      expect(creatingSkillsExists).toBe(true);
    });
  });

  describe("template substitution", () => {
    it("should apply template substitution to .md files", async () => {
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "template-test",
      });
      const skillset = await createTestSkillset({
        skillsetsDir: noriProfilesDir,
        skillsetName: "template-test",
        skills: TEST_SKILLS,
      });

      await skillsLoader.run({ agent, config, skillset });

      const content = await fs.readFile(
        path.join(skillsDir, "using-skills", "SKILL.md"),
        "utf-8",
      );
      expect(content).not.toContain("{{skills_dir}}");
      // Should have been replaced with the actual agent skills path
      expect(content).toContain(
        path.join(agentDir, "skills", "some-skill", "SKILL.md"),
      );
    });

    it("should copy non-.md files directly without template substitution", async () => {
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "non-md-test",
      });
      const skillset = await createTestSkillset({
        skillsetsDir: noriProfilesDir,
        skillsetName: "non-md-test",
        skills: {
          "my-skill": "---\nname: My Skill\n---\n# My Skill",
        },
        extraFiles: {
          "my-skill/script.sh": "#!/bin/bash\necho {{skills_dir}}",
        },
      });

      await skillsLoader.run({ agent, config, skillset });

      const scriptContent = await fs.readFile(
        path.join(skillsDir, "my-skill", "script.sh"),
        "utf-8",
      );
      // Non-md files should NOT have template substitution applied
      expect(scriptContent).toContain("{{skills_dir}}");
    });
  });

  describe("missing skillsDir", () => {
    it("should handle missing skillset.skillsDir gracefully", async () => {
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "empty-test",
      });
      const skillset = await createTestSkillset({
        skillsetsDir: noriProfilesDir,
        skillsetName: "empty-test",
        // no skills -> skillsDir will be null
      });

      // Should not throw
      await expect(
        skillsLoader.run({ agent, config, skillset }),
      ).resolves.not.toThrow();
    });
  });

  describe("bundled skills", () => {
    it("should copy bundled skills during installation", async () => {
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "bundled-test",
      });
      const skillset = await createTestSkillset({
        skillsetsDir: noriProfilesDir,
        skillsetName: "bundled-test",
        skills: TEST_SKILLS,
      });

      await skillsLoader.run({ agent, config, skillset });

      // Verify copyBundledSkills was called with the correct destination
      expect(mockCopyBundledSkills).toHaveBeenCalled();
      const callArgs = mockCopyBundledSkills.mock.calls[0][0];
      expect(callArgs.destSkillsDir).toBe(skillsDir);
    });
  });
});
