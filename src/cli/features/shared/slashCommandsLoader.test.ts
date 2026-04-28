/**
 * Tests for shared slash commands loader
 * Verifies that createSlashCommandsLoader copies .md files from the
 * skillset's slashcommands directory to the agent's commands directory,
 * applies template substitution, and filters out docs.md.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { createSlashCommandsLoader } from "@/cli/features/shared/slashCommandsLoader.js";

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
  slashcommands?: Record<string, string> | null;
}): Promise<Skillset> => {
  const { skillsetsDir, skillsetName, slashcommands } = args;
  const skillsetDir = path.join(skillsetsDir, skillsetName);
  await fs.mkdir(skillsetDir, { recursive: true });
  await fs.writeFile(
    path.join(skillsetDir, "nori.json"),
    JSON.stringify({ name: skillsetName, version: "1.0.0" }),
  );

  let slashcommandsDir: string | null = null;
  if (slashcommands != null) {
    const cmdDir = path.join(skillsetDir, "slashcommands");
    await fs.mkdir(cmdDir, { recursive: true });
    for (const [filename, content] of Object.entries(slashcommands)) {
      await fs.writeFile(path.join(cmdDir, filename), content);
    }
    slashcommandsDir = cmdDir;
  }

  return {
    name: skillsetName,
    dir: skillsetDir,
    metadata: { name: skillsetName, version: "1.0.0" },
    skillsDir: null,
    configFilePath: null,
    slashcommandsDir,
    subagentsDir: null,
    mcpDir: null,
  };
};

// ---- test data --------------------------------------------------------------

const TEST_SLASH_COMMANDS: Record<string, string> = {
  "nori-init-docs.md": "# Init Docs\n\nInitialize documentation.\n",
  "nori-create-profile.md":
    "# Create Profile\n\nCreate a new profile at {{profiles_dir}}/new.\n",
};

// ---- tests ------------------------------------------------------------------

describe("createSlashCommandsLoader", () => {
  let tempDir: string;
  let agentDir: string;
  let commandsDir: string;
  let noriProfilesDir: string;
  let agent: AgentConfig;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "slashcmd-loader-test-"));
    agentDir = path.join(tempDir, ".test-agent");
    commandsDir = path.join(agentDir, "commands");

    mockHomeDir = tempDir;
    mockNoriDir = path.join(tempDir, ".nori");
    noriProfilesDir = path.join(mockNoriDir, "profiles");

    await fs.mkdir(agentDir, { recursive: true });
    await fs.mkdir(noriProfilesDir, { recursive: true });

    agent = createTestAgent({ agentDir });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe("copying .md files", () => {
    it("should copy .md files from skillset slashcommands dir to agent commands dir", async () => {
      const loader = createSlashCommandsLoader({ managedDirs: ["commands"] });
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "cmd-test",
      });
      const skillset = await createTestSkillset({
        skillsetsDir: noriProfilesDir,
        skillsetName: "cmd-test",
        slashcommands: TEST_SLASH_COMMANDS,
      });

      await loader.run({ agent, config, skillset });

      const initDocsPath = path.join(commandsDir, "nori-init-docs.md");
      const createProfilePath = path.join(
        commandsDir,
        "nori-create-profile.md",
      );

      const initDocsExists = await fs
        .access(initDocsPath)
        .then(() => true)
        .catch(() => false);
      const createProfileExists = await fs
        .access(createProfilePath)
        .then(() => true)
        .catch(() => false);

      expect(initDocsExists).toBe(true);
      expect(createProfileExists).toBe(true);
    });
  });

  describe("template substitution", () => {
    it("should apply template substitution to copied .md files", async () => {
      const loader = createSlashCommandsLoader({ managedDirs: ["commands"] });
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "template-cmd-test",
      });
      const skillset = await createTestSkillset({
        skillsetsDir: noriProfilesDir,
        skillsetName: "template-cmd-test",
        slashcommands: TEST_SLASH_COMMANDS,
      });

      await loader.run({ agent, config, skillset });

      const content = await fs.readFile(
        path.join(commandsDir, "nori-create-profile.md"),
        "utf-8",
      );
      expect(content).not.toContain("{{profiles_dir}}");
    });
  });

  describe("filtering docs.md", () => {
    it("should not copy docs.md files", async () => {
      const loader = createSlashCommandsLoader({ managedDirs: ["commands"] });
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "docs-filter-test",
      });
      const skillset = await createTestSkillset({
        skillsetsDir: noriProfilesDir,
        skillsetName: "docs-filter-test",
        slashcommands: {
          ...TEST_SLASH_COMMANDS,
          "docs.md":
            "# Documentation\n\nThis is docs.md and should not be copied.\n",
        },
      });

      await loader.run({ agent, config, skillset });

      const docsExists = await fs
        .access(path.join(commandsDir, "docs.md"))
        .then(() => true)
        .catch(() => false);
      expect(docsExists).toBe(false);

      // But other files should be copied
      const initDocsExists = await fs
        .access(path.join(commandsDir, "nori-init-docs.md"))
        .then(() => true)
        .catch(() => false);
      expect(initDocsExists).toBe(true);
    });
  });

  describe("managedDirs", () => {
    it("should set managedDirs from factory args on the returned loader", () => {
      const loader = createSlashCommandsLoader({
        managedDirs: ["commands", "extra-commands"],
      });
      expect(loader.managedDirs).toEqual(["commands", "extra-commands"]);
    });
  });

  describe("dotfile preservation", () => {
    it("should preserve top-level dotfile entries in the commands directory across reinstall", async () => {
      const loader = createSlashCommandsLoader({ managedDirs: ["commands"] });
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "preserve-dotfiles-cmd",
      });
      const skillset = await createTestSkillset({
        skillsetsDir: noriProfilesDir,
        skillsetName: "preserve-dotfiles-cmd",
        slashcommands: TEST_SLASH_COMMANDS,
      });

      await fs.mkdir(commandsDir, { recursive: true });
      const systemDir = path.join(commandsDir, ".system");
      await fs.mkdir(systemDir, { recursive: true });
      const markerPath = path.join(systemDir, "marker.txt");
      await fs.writeFile(markerPath, "external content");

      await loader.run({ agent, config, skillset });

      const markerContent = await fs.readFile(markerPath, "utf-8");
      expect(markerContent).toBe("external content");

      const initDocsExists = await fs
        .access(path.join(commandsDir, "nori-init-docs.md"))
        .then(() => true)
        .catch(() => false);
      expect(initDocsExists).toBe(true);
    });

    it("should still remove a stale non-dotfile command on reinstall", async () => {
      const loader = createSlashCommandsLoader({ managedDirs: ["commands"] });
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "stale-cmd-removal",
      });
      const skillset = await createTestSkillset({
        skillsetsDir: noriProfilesDir,
        skillsetName: "stale-cmd-removal",
        slashcommands: TEST_SLASH_COMMANDS,
      });

      await fs.mkdir(commandsDir, { recursive: true });
      const stalePath = path.join(commandsDir, "old-command.md");
      await fs.writeFile(stalePath, "stale");

      await loader.run({ agent, config, skillset });

      const staleExists = await fs
        .access(stalePath)
        .then(() => true)
        .catch(() => false);
      expect(staleExists).toBe(false);
    });
  });
});
