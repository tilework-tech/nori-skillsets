/**
 * Tests for shared instructions loader
 * Verifies that createInstructionsLoader produces a Loader that manages
 * an instructions file (e.g. CLAUDE.md) via managed-block semantics.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { createInstructionsLoader } from "@/cli/features/shared/instructionsLoader.js";

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
vi.mock("@/cli/features/bundled-skillsets/installer.js", () => ({
  getBundledSkillsDir: () => "/nonexistent-bundled-skills",
  copyBundledSkills: vi.fn(),
}));

// ---- helpers ----------------------------------------------------------------

/**
 * Build a minimal AgentConfig that points at temp directories.
 * @param args - Function arguments
 * @param args.agentDir - Path to the agent config directory
 *
 * @returns A minimal AgentConfig for testing
 */
const createTestAgent = (args: { agentDir: string }): AgentConfig => {
  const { agentDir } = args;
  return {
    name: "claude-code",
    displayName: "Test Agent",
    description: "Test agent for shared loader tests",
    getAgentDir: (a: { installDir: string }) =>
      path.join(a.installDir, path.basename(agentDir)),
    getSkillsDir: (a: { installDir: string }) =>
      path.join(a.installDir, path.basename(agentDir), "skills"),
    getSubagentsDir: (a: { installDir: string }) =>
      path.join(a.installDir, path.basename(agentDir), "agents"),
    getSlashcommandsDir: (a: { installDir: string }) =>
      path.join(a.installDir, path.basename(agentDir), "commands"),
    getInstructionsFilePath: (a: { installDir: string }) =>
      path.join(a.installDir, path.basename(agentDir), "CLAUDE.md"),
    getLoaders: () => [],
  };
};

const createSplitPathAgent = (args: {
  agentDir: string;
  commandsDir: string;
  instructionsFilePath: string;
  skillsDir: string;
}): AgentConfig => {
  const { agentDir, commandsDir, instructionsFilePath, skillsDir } = args;
  return {
    name: "pi",
    displayName: "Pi",
    description: "Pi test agent for shared loader tests",
    getAgentDir: () => agentDir,
    getSkillsDir: () => skillsDir,
    getSubagentsDir: () => path.join(agentDir, "agent", "subagents"),
    getSlashcommandsDir: () => commandsDir,
    getInstructionsFilePath: () => instructionsFilePath,
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

/**
 * Create a minimal skillset directory on disk and return a Skillset object.
 * @param args - Function arguments
 * @param args.skillsetsDir - Path to the profiles directory
 * @param args.skillsetName - Name of the skillset
 * @param args.configContent - Content for the skillset's AGENTS.md
 * @param args.skills - Map of skill name to frontmatter and body content
 *
 * @returns A Skillset pointing at the created directory
 */
const createTestSkillset = async (args: {
  skillsetsDir: string;
  skillsetName: string;
  configContent?: string | null;
  skills?: Record<string, { frontmatter: string; body: string }> | null;
}): Promise<Skillset> => {
  const { skillsetsDir, skillsetName, configContent, skills } = args;
  const skillsetDir = path.join(skillsetsDir, skillsetName);
  await fs.mkdir(skillsetDir, { recursive: true });
  await fs.writeFile(
    path.join(skillsetDir, "nori.json"),
    JSON.stringify({
      name: skillsetName,
      version: "1.0.0",
      description: `${skillsetName} test skillset`,
    }),
  );

  let configFilePath: string | null = null;
  if (configContent != null) {
    const cfgPath = path.join(skillsetDir, "AGENTS.md");
    await fs.writeFile(cfgPath, configContent);
    configFilePath = cfgPath;
  }

  let skillsDir: string | null = null;
  if (skills != null) {
    const sDir = path.join(skillsetDir, "skills");
    for (const [skillName, content] of Object.entries(skills)) {
      const dir = path.join(sDir, skillName);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "SKILL.md"),
        `${content.frontmatter}\n${content.body}`,
      );
    }
    skillsDir = sDir;
  }

  return {
    name: skillsetName,
    dir: skillsetDir,
    metadata: {
      name: skillsetName,
      version: "1.0.0",
      description: `${skillsetName} test skillset`,
    },
    skillsDir,
    configFilePath,
    slashcommandsDir: null,
    subagentsDir: null,
    mcpDir: null,
  };
};

// ---- test data --------------------------------------------------------------

const SAMPLE_CLAUDE_MD = `<required>
# Tone

Do not be deferential.

# Coding Guidelines

YAGNI.

# Independence

When starting a new task, ask me.
</required>
`;

const CLAUDE_MD_WITH_TEMPLATE = `<required>
Read skills at {{skills_dir}}/using-skills/SKILL.md
Install at {{install_dir}}/.nori-config.json
</required>
`;

const TEST_SKILLS: Record<string, { frontmatter: string; body: string }> = {
  "using-skills": {
    frontmatter:
      "---\nname: Getting Started with Abilities\ndescription: Describes how to use abilities.\n---",
    body: "# Using Skills\n\nHow to use skills.",
  },
  brainstorming: {
    frontmatter:
      "---\nname: Brainstorming\ndescription: Refine ideas through Socratic questioning.\n---",
    body: "# Brainstorming\n\nRefine ideas.",
  },
};

// ---- tests ------------------------------------------------------------------

describe("createInstructionsLoader", () => {
  let tempDir: string;
  let agentDir: string;
  let instructionsFile: string;
  let noriProfilesDir: string;
  let agent: AgentConfig;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "instructions-loader-test-"),
    );
    agentDir = path.join(tempDir, ".test-agent");
    instructionsFile = path.join(agentDir, "CLAUDE.md");

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

  describe("managed block writing", () => {
    it("should write a managed block to the instructions file when skillset has a config file", async () => {
      const loader = createInstructionsLoader({});
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "test-skillset",
      });
      const skillset = await createTestSkillset({
        skillsetsDir: noriProfilesDir,
        skillsetName: "test-skillset",
        configContent: SAMPLE_CLAUDE_MD,
      });

      await loader.run({ agent, config, skillset });

      const content = await fs.readFile(instructionsFile, "utf-8");
      expect(content).toContain("# BEGIN NORI-AI MANAGED BLOCK");
      expect(content).toContain("# END NORI-AI MANAGED BLOCK");
      expect(content).toContain("# Tone");
      expect(content).toContain("Do not be deferential");
    });
  });

  describe("template substitution", () => {
    it("should replace template placeholders with actual paths", async () => {
      const loader = createInstructionsLoader({});
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "template-test",
      });
      const skillset = await createTestSkillset({
        skillsetsDir: noriProfilesDir,
        skillsetName: "template-test",
        configContent: CLAUDE_MD_WITH_TEMPLATE,
      });

      await loader.run({ agent, config, skillset });

      const content = await fs.readFile(instructionsFile, "utf-8");
      expect(content).not.toContain("{{skills_dir}}");
      expect(content).not.toContain("{{install_dir}}");
      // The substituted path should include the agent dir's skills subdirectory
      expect(content).toContain(path.join(agentDir, "skills"));
    });

    it("should use agent-specific skills and commands paths when they differ from agentDir", async () => {
      const loader = createInstructionsLoader({});
      const piAgentDir = path.join(tempDir, ".pi");
      const piSkillsDir = path.join(tempDir, ".pi", "agent", "skills");
      const piCommandsDir = path.join(tempDir, ".pi", "commands");
      const piInstructionsFile = path.join(tempDir, ".pi", "AGENTS.md");
      await fs.mkdir(piAgentDir, { recursive: true });

      agent = createSplitPathAgent({
        agentDir: piAgentDir,
        commandsDir: piCommandsDir,
        instructionsFilePath: piInstructionsFile,
        skillsDir: piSkillsDir,
      });

      const loaderConfig = createTestConfig({
        installDir: tempDir,
        activeSkillset: "pi-template-test",
      });
      const skillset = await createTestSkillset({
        skillsetsDir: noriProfilesDir,
        skillsetName: "pi-template-test",
        configContent:
          "Read {{skills_dir}}/using-skills/SKILL.md\nCommands live at {{commands_dir}}\n",
        skills: TEST_SKILLS,
      });

      await loader.run({ agent, config: loaderConfig, skillset });

      const content = await fs.readFile(piInstructionsFile, "utf-8");
      expect(content).toContain(
        path.join(
          tempDir,
          ".pi",
          "agent",
          "skills",
          "using-skills",
          "SKILL.md",
        ),
      );
      expect(content).toContain(path.join(tempDir, ".pi", "commands"));
      expect(content).not.toContain(path.join(tempDir, ".pi", "skills"));
    });
  });

  describe("skills list generation", () => {
    it("should generate a skills list from skill files in the skillset", async () => {
      const loader = createInstructionsLoader({});
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "skills-test",
      });
      const skillset = await createTestSkillset({
        skillsetsDir: noriProfilesDir,
        skillsetName: "skills-test",
        configContent: SAMPLE_CLAUDE_MD,
        skills: TEST_SKILLS,
      });

      await loader.run({ agent, config, skillset });

      const content = await fs.readFile(instructionsFile, "utf-8");
      expect(content).toContain("Available Skills");
      expect(content).toContain("Name: Getting Started with Abilities");
      expect(content).toContain("Name: Brainstorming");
    });
  });

  describe("preserving existing content", () => {
    it("should preserve content outside the managed block when updating", async () => {
      // Write pre-existing content to the instructions file
      const existingContent = `# User Content Before

My custom instructions.

# BEGIN NORI-AI MANAGED BLOCK
Old managed content.
# END NORI-AI MANAGED BLOCK

# User Content After

More custom instructions.
`;
      await fs.writeFile(instructionsFile, existingContent);

      const loader = createInstructionsLoader({});
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "preserve-test",
      });
      const skillset = await createTestSkillset({
        skillsetsDir: noriProfilesDir,
        skillsetName: "preserve-test",
        configContent: SAMPLE_CLAUDE_MD,
      });

      await loader.run({ agent, config, skillset });

      const content = await fs.readFile(instructionsFile, "utf-8");
      // User content preserved
      expect(content).toContain("# User Content Before");
      expect(content).toContain("My custom instructions.");
      expect(content).toContain("# User Content After");
      expect(content).toContain("More custom instructions.");
      // Old managed content replaced
      expect(content).not.toContain("Old managed content.");
      // New managed content present
      expect(content).toContain("# Tone");
    });
  });

  describe("clearing managed block when no config file", () => {
    it("should clear managed block when skillset has no config file", async () => {
      // First, write a file with a managed block
      const existingContent = `# User Instructions

Custom stuff.

# BEGIN NORI-AI MANAGED BLOCK
Old nori instructions that should be cleared.
# END NORI-AI MANAGED BLOCK

# More User Content
`;
      await fs.writeFile(instructionsFile, existingContent);

      const loader = createInstructionsLoader({});
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "empty-test",
      });
      const skillset = await createTestSkillset({
        skillsetsDir: noriProfilesDir,
        skillsetName: "empty-test",
        // no configContent -> configFilePath will be null
      });

      await loader.run({ agent, config, skillset });

      const content = await fs.readFile(instructionsFile, "utf-8");
      // User content preserved
      expect(content).toContain("# User Instructions");
      expect(content).toContain("Custom stuff.");
      expect(content).toContain("# More User Content");
      // Old managed content cleared
      expect(content).not.toContain(
        "Old nori instructions that should be cleared.",
      );
      // Managed block markers still present (empty block)
      expect(content).toContain("# BEGIN NORI-AI MANAGED BLOCK");
      expect(content).toContain("# END NORI-AI MANAGED BLOCK");
    });
  });

  describe("managedFiles and managedDirs", () => {
    it("should set managedFiles from factory args on the returned loader", () => {
      const loader = createInstructionsLoader({
        managedFiles: ["CLAUDE.md", "settings.json"],
      });
      expect(loader.managedFiles).toEqual(["CLAUDE.md", "settings.json"]);
    });

    it("should set managedDirs from factory args on the returned loader", () => {
      const loader = createInstructionsLoader({
        managedDirs: ["skills", "agents"],
      });
      expect(loader.managedDirs).toEqual(["skills", "agents"]);
    });

    it("should leave managedFiles undefined when not provided", () => {
      const loader = createInstructionsLoader({});
      expect(loader.managedFiles).toBeUndefined();
    });

    it("should leave managedDirs undefined when not provided", () => {
      const loader = createInstructionsLoader({});
      expect(loader.managedDirs).toBeUndefined();
    });
  });
});
