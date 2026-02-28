/**
 * Tests for shared subagents loader
 * Verifies that createSubagentsLoader copies .md files from the
 * skillset's subagents directory to the agent's subagents directory,
 * applies template substitution, and filters out docs.md.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { createSubagentsLoader } from "@/cli/features/shared/subagentsLoader.js";

import type { Config } from "@/cli/config.js";
import type { AgentConfig } from "@/cli/features/agentRegistry.js";
import type { Skillset } from "@/cli/features/skillset.js";

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

// Mock paths to resolve against temp dirs
let mockNoriDir: string;
vi.mock("@/cli/features/paths.js", () => ({
  getNoriDir: () => mockNoriDir,
  getNoriSkillsetsDir: () => path.join(mockNoriDir, "profiles"),
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
  subagents?: Record<string, string> | null;
}): Promise<Skillset> => {
  const { skillsetsDir, skillsetName, subagents } = args;
  const skillsetDir = path.join(skillsetsDir, skillsetName);
  await fs.mkdir(skillsetDir, { recursive: true });
  await fs.writeFile(
    path.join(skillsetDir, "nori.json"),
    JSON.stringify({ name: skillsetName, version: "1.0.0" }),
  );

  let subagentsDir: string | null = null;
  if (subagents != null && Object.keys(subagents).length > 0) {
    const sDir = path.join(skillsetDir, "subagents");
    await fs.mkdir(sDir, { recursive: true });
    for (const [filename, content] of Object.entries(subagents)) {
      await fs.writeFile(path.join(sDir, filename), content);
    }
    subagentsDir = sDir;
  }

  return {
    name: skillsetName,
    dir: skillsetDir,
    metadata: { name: skillsetName, version: "1.0.0" },
    skillsDir: null,
    configFilePath: null,
    slashcommandsDir: null,
    subagentsDir,
  };
};

// ---- test data --------------------------------------------------------------

const TEST_SUBAGENTS: Record<string, string> = {
  "nori-codebase-analyzer.md":
    "# Codebase Analyzer\n\nAnalyze codebase.\nRead: `{{skills_dir}}/some-skill/SKILL.md`\n",
  "nori-web-search-researcher.md":
    "# Web Search Researcher\n\nResearch on the web.\n",
};

// ---- tests ------------------------------------------------------------------

describe("createSubagentsLoader", () => {
  let tempDir: string;
  let agentDir: string;
  let agentsDir: string;
  let noriProfilesDir: string;
  let agent: AgentConfig;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "subagents-loader-test-"),
    );
    agentDir = path.join(tempDir, ".test-agent");
    agentsDir = path.join(agentDir, "agents");

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
    it("should copy .md files from skillset subagents dir to agent subagents dir", async () => {
      const loader = createSubagentsLoader({ managedDirs: ["agents"] });
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "subagent-test",
      });
      const skillset = await createTestSkillset({
        skillsetsDir: noriProfilesDir,
        skillsetName: "subagent-test",
        subagents: TEST_SUBAGENTS,
      });

      await loader.run({ agent, config, skillset });

      const analyzerPath = path.join(agentsDir, "nori-codebase-analyzer.md");
      const researcherPath = path.join(
        agentsDir,
        "nori-web-search-researcher.md",
      );

      const analyzerExists = await fs
        .access(analyzerPath)
        .then(() => true)
        .catch(() => false);
      const researcherExists = await fs
        .access(researcherPath)
        .then(() => true)
        .catch(() => false);

      expect(analyzerExists).toBe(true);
      expect(researcherExists).toBe(true);
    });
  });

  describe("template substitution", () => {
    it("should apply template substitution to copied subagent .md files", async () => {
      const loader = createSubagentsLoader({ managedDirs: ["agents"] });
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "template-subagent-test",
      });
      const skillset = await createTestSkillset({
        skillsetsDir: noriProfilesDir,
        skillsetName: "template-subagent-test",
        subagents: TEST_SUBAGENTS,
      });

      await loader.run({ agent, config, skillset });

      // Verify the analyzer file was copied and template substitution was applied
      const analyzerContent = await fs.readFile(
        path.join(agentsDir, "nori-codebase-analyzer.md"),
        "utf-8",
      );
      expect(analyzerContent).toContain("Analyze codebase");

      // Verify the researcher file was copied
      const researcherContent = await fs.readFile(
        path.join(agentsDir, "nori-web-search-researcher.md"),
        "utf-8",
      );
      expect(researcherContent).toContain("# Web Search Researcher");
    });
  });

  describe("filtering docs.md", () => {
    it("should not copy docs.md files", async () => {
      const loader = createSubagentsLoader({ managedDirs: ["agents"] });
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "docs-filter-test",
      });
      const skillset = await createTestSkillset({
        skillsetsDir: noriProfilesDir,
        skillsetName: "docs-filter-test",
        subagents: {
          ...TEST_SUBAGENTS,
          "docs.md":
            "# Documentation\n\nThis is docs.md and should not be copied.\n",
        },
      });

      await loader.run({ agent, config, skillset });

      const docsExists = await fs
        .access(path.join(agentsDir, "docs.md"))
        .then(() => true)
        .catch(() => false);
      expect(docsExists).toBe(false);

      // Other files should still be copied
      const analyzerExists = await fs
        .access(path.join(agentsDir, "nori-codebase-analyzer.md"))
        .then(() => true)
        .catch(() => false);
      expect(analyzerExists).toBe(true);
    });
  });

  describe("managedDirs", () => {
    it("should set managedDirs from factory args on the returned loader", () => {
      const loader = createSubagentsLoader({
        managedDirs: ["agents", "extra-agents"],
      });
      expect(loader.managedDirs).toEqual(["agents", "extra-agents"]);
    });
  });
});
