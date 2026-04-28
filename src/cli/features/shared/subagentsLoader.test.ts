/**
 * Tests for shared subagents loader
 * Verifies that createSubagentsLoader emits target-specific subagent files from
 * the skillset's subagents directory to the agent's subagents directory,
 * applies template substitution, and filters out docs files.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { createSubagentsLoader } from "@/cli/features/shared/subagentsLoader.js";

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
    mcpDir: null,
  };
};

const createTestSkillsetWithDirs = async (args: {
  skillsetsDir: string;
  skillsetName: string;
  flatFiles?: Record<string, string> | null;
  directories?: Record<string, Record<string, string>> | null;
}): Promise<Skillset> => {
  const { skillsetsDir, skillsetName, flatFiles, directories } = args;
  const skillsetDir = path.join(skillsetsDir, skillsetName);
  await fs.mkdir(skillsetDir, { recursive: true });
  await fs.writeFile(
    path.join(skillsetDir, "nori.json"),
    JSON.stringify({ name: skillsetName, version: "1.0.0" }),
  );

  const sDir = path.join(skillsetDir, "subagents");
  await fs.mkdir(sDir, { recursive: true });

  if (flatFiles != null) {
    for (const [filename, content] of Object.entries(flatFiles)) {
      await fs.writeFile(path.join(sDir, filename), content);
    }
  }

  if (directories != null) {
    for (const [dirName, files] of Object.entries(directories)) {
      const subDir = path.join(sDir, dirName);
      await fs.mkdir(subDir, { recursive: true });
      for (const [filename, content] of Object.entries(files)) {
        await fs.writeFile(path.join(subDir, filename), content);
      }
    }
  }

  return {
    name: skillsetName,
    dir: skillsetDir,
    metadata: { name: skillsetName, version: "1.0.0" },
    skillsDir: null,
    configFilePath: null,
    slashcommandsDir: null,
    subagentsDir: sDir,
    mcpDir: null,
  };
};

// ---- test data --------------------------------------------------------------

const TEST_SUBAGENTS: Record<string, string> = {
  "nori-codebase-analyzer.md":
    "# Codebase Analyzer\n\nAnalyze codebase.\nRead: `{{skills_dir}}/some-skill/SKILL.md`\n",
  "nori-web-search-researcher.md":
    "# Web Search Researcher\n\nResearch on the web.\n",
};

const TEST_TOML_SUBAGENTS: Record<string, string> = {
  "nori-codebase-analyzer.toml":
    'name = "nori-codebase-analyzer"\ndescription = "Analyzes codebase"\nsandbox_mode = "read-only"\n\ndeveloper_instructions = """\nRead: {{skills_dir}}/some-skill/SKILL.md\n"""\n',
  "nori-knowledge-researcher.toml":
    'name = "nori-knowledge-researcher"\ndescription = "Research specialist"\nsandbox_mode = "read-only"\n',
};

const TEST_PAIRED_SUBAGENTS: Record<string, string> = {
  "nori-code-reviewer.md":
    "---\nname: nori-code-reviewer\ndescription: Review changed code\ntools: Read, Grep, Glob, Bash, TodoWrite\nmodel: inherit\n---\n\nReview the diff carefully.\nRead: {{skills_dir}}/review/SKILL.md\n",
  "nori-code-reviewer.toml":
    'name = "nori-code-reviewer"\ndescription = "Review changed code"\nsandbox_mode = "read-only"\nmodel = "gpt-5.3-codex-spark"\nmodel_reasoning_effort = "high"\n\ndeveloper_instructions = """\nThis text should not win.\n"""\n',
};

const TEST_MARKDOWN_ONLY_SUBAGENTS: Record<string, string> = {
  "nori-task-runner.md":
    "---\nname: nori-task-runner\ndescription: Run a task outside the main context\nmodel: inherit\n---\n\nComplete the delegated task without stopping.\n",
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
        targetFormat: "markdown",
      });
      expect(loader.managedDirs).toEqual(["agents", "extra-agents"]);
    });
  });

  describe("target-specific emission", () => {
    it("should emit markdown-only subagents as Codex TOML", async () => {
      const loader = createSubagentsLoader({
        managedDirs: ["agents"],
        targetFormat: "codex-toml",
      });
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "codex-markdown-only-test",
      });
      const skillset = await createTestSkillset({
        skillsetsDir: noriProfilesDir,
        skillsetName: "codex-markdown-only-test",
        subagents: TEST_MARKDOWN_ONLY_SUBAGENTS,
      });

      await loader.run({ agent, config, skillset });

      const emittedContent = await fs.readFile(
        path.join(agentsDir, "nori-task-runner.toml"),
        "utf-8",
      );
      expect(emittedContent).toContain('name = "nori-task-runner"');
      expect(emittedContent).toContain(
        'description = "Run a task outside the main context"',
      );
      expect(emittedContent).toContain('sandbox_mode = "read-only"');
      expect(emittedContent).toContain(
        "Complete the delegated task without stopping.",
      );
      expect(emittedContent).not.toContain('model = "inherit"');
    });

    it("should emit paired markdown and TOML sources as Codex TOML", async () => {
      const loader = createSubagentsLoader({
        managedDirs: ["agents"],
        targetFormat: "codex-toml",
      });
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "codex-paired-test",
      });
      const skillset = await createTestSkillset({
        skillsetsDir: noriProfilesDir,
        skillsetName: "codex-paired-test",
        subagents: TEST_PAIRED_SUBAGENTS,
      });

      await loader.run({ agent, config, skillset });

      const emittedContent = await fs.readFile(
        path.join(agentsDir, "nori-code-reviewer.toml"),
        "utf-8",
      );
      expect(emittedContent).toContain('model = "gpt-5.3-codex-spark"');
      expect(emittedContent).toContain('model_reasoning_effort = "high"');
      expect(emittedContent).toContain('sandbox_mode = "read-only"');
      expect(emittedContent).toContain("Review the diff carefully.");
      expect(emittedContent).toContain(
        path.join(agentDir, "skills", "review", "SKILL.md"),
      );
      expect(emittedContent).not.toContain("This text should not win.");

      const markdownExists = await fs
        .access(path.join(agentsDir, "nori-code-reviewer.md"))
        .then(() => true)
        .catch(() => false);
      expect(markdownExists).toBe(false);
    });

    it("should emit paired markdown and TOML sources as Pi markdown", async () => {
      const loader = createSubagentsLoader({
        managedDirs: ["agents"],
        targetFormat: "pi-markdown",
      });
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "pi-paired-test",
      });
      const skillset = await createTestSkillset({
        skillsetsDir: noriProfilesDir,
        skillsetName: "pi-paired-test",
        subagents: TEST_PAIRED_SUBAGENTS,
      });

      await loader.run({ agent, config, skillset });

      const emittedContent = await fs.readFile(
        path.join(agentsDir, "nori-code-reviewer.md"),
        "utf-8",
      );
      expect(emittedContent).toContain("name: nori-code-reviewer");
      expect(emittedContent).toContain("description: Review changed code");
      expect(emittedContent).toContain("thinking: high");
      expect(emittedContent).toContain("tools: read, grep, find, bash");
      expect(emittedContent).toContain("Review the diff carefully.");
      expect(emittedContent).toContain(
        path.join(agentDir, "skills", "review", "SKILL.md"),
      );
      expect(emittedContent).not.toContain("This text should not win.");
      expect(emittedContent).not.toContain("model:");
    });

    it("should emit TOML-only subagents as Pi markdown fallback", async () => {
      const loader = createSubagentsLoader({
        managedDirs: ["agents"],
        targetFormat: "pi-markdown",
      });
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "pi-toml-fallback-test",
      });
      const skillset = await createTestSkillset({
        skillsetsDir: noriProfilesDir,
        skillsetName: "pi-toml-fallback-test",
        subagents: TEST_TOML_SUBAGENTS,
      });

      await loader.run({ agent, config, skillset });

      const content = await fs.readFile(
        path.join(agentsDir, "nori-codebase-analyzer.md"),
        "utf-8",
      );
      expect(content).toContain("name: nori-codebase-analyzer");
      expect(content).toContain("description: Analyzes codebase");
      expect(content).toContain("tools: read, grep, find, ls");
      expect(content).toContain("Read:");
      expect(content).not.toContain("{{skills_dir}}");
      expect(content).toContain(
        path.join(agentDir, "skills", "some-skill", "SKILL.md"),
      );
    });

    it("should exclude docs for Codex emission", async () => {
      const loader = createSubagentsLoader({
        managedDirs: ["agents"],
        targetFormat: "codex-toml",
      });
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "docs-codex-test",
      });
      const skillset = await createTestSkillset({
        skillsetsDir: noriProfilesDir,
        skillsetName: "docs-codex-test",
        subagents: {
          ...TEST_MARKDOWN_ONLY_SUBAGENTS,
          "docs.md": "# Markdown docs\n",
          "docs.toml": 'name = "docs"\ndescription = "Ignored docs"\n',
        },
      });

      await loader.run({ agent, config, skillset });

      const docsTomlExists = await fs
        .access(path.join(agentsDir, "docs.toml"))
        .then(() => true)
        .catch(() => false);
      const docsMdExists = await fs
        .access(path.join(agentsDir, "docs.md"))
        .then(() => true)
        .catch(() => false);

      expect(docsTomlExists).toBe(false);
      expect(docsMdExists).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should return early without error when skillset is null", async () => {
      const loader = createSubagentsLoader({ managedDirs: ["agents"] });
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "null-skillset-test",
      });

      // Should complete without throwing
      await loader.run({ agent, config, skillset: null });

      // agents dir should not be created (loader returns before mkdir)
      const agentsDirExists = await fs
        .access(agentsDir)
        .then(() => true)
        .catch(() => false);
      expect(agentsDirExists).toBe(false);
    });

    it("should return early without error when skillset has null subagentsDir", async () => {
      const loader = createSubagentsLoader({ managedDirs: ["agents"] });
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "no-subagents-dir-test",
      });

      const skillset: Skillset = {
        name: "no-subagents-dir-test",
        dir: path.join(noriProfilesDir, "no-subagents-dir-test"),
        metadata: { name: "no-subagents-dir-test", version: "1.0.0" },
        skillsDir: null,
        configFilePath: null,
        slashcommandsDir: null,
        subagentsDir: null,
        mcpDir: null,
      };

      // Should complete without throwing
      await loader.run({ agent, config, skillset });

      // agents dir should be empty (loader clears it then returns early)
      const files = await fs.readdir(agentsDir);
      expect(files).toHaveLength(0);
    });
  });

  describe("directory-based subagents", () => {
    it("should flatten directory-based subagent to a single .md file", async () => {
      const loader = createSubagentsLoader({ managedDirs: ["agents"] });
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "dir-subagent-test",
      });
      const skillset = await createTestSkillsetWithDirs({
        skillsetsDir: noriProfilesDir,
        skillsetName: "dir-subagent-test",
        directories: {
          "complex-agent": {
            "SUBAGENT.md":
              "---\nname: Complex Agent\ndescription: A complex agent\n---\n\n# Complex Agent\n\nDo complex things.\n",
            "nori.json": '{"name":"complex-agent","version":"1.0.0"}',
            "README.md": "# README\n\nDocumentation for complex-agent.\n",
          },
        },
      });

      await loader.run({ agent, config, skillset });

      // SUBAGENT.md should be flattened to agents/complex-agent.md
      const content = await fs.readFile(
        path.join(agentsDir, "complex-agent.md"),
        "utf-8",
      );
      expect(content).toContain("# Complex Agent");
      expect(content).toContain("Do complex things.");
    });

    it("should apply template substitution to directory-based subagent SUBAGENT.md", async () => {
      const loader = createSubagentsLoader({ managedDirs: ["agents"] });
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "dir-template-test",
      });
      const skillset = await createTestSkillsetWithDirs({
        skillsetsDir: noriProfilesDir,
        skillsetName: "dir-template-test",
        directories: {
          "template-agent": {
            "SUBAGENT.md":
              "# Template Agent\n\nRead: `{{skills_dir}}/some-skill/SKILL.md`\n",
          },
        },
      });

      await loader.run({ agent, config, skillset });

      const content = await fs.readFile(
        path.join(agentsDir, "template-agent.md"),
        "utf-8",
      );
      expect(content).not.toContain("{{skills_dir}}");
      expect(content).toContain(
        path.join(agentDir, "skills", "some-skill", "SKILL.md"),
      );
    });

    it("should handle mixed flat files and directory-based subagents", async () => {
      const loader = createSubagentsLoader({ managedDirs: ["agents"] });
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "mixed-format-test",
      });
      const skillset = await createTestSkillsetWithDirs({
        skillsetsDir: noriProfilesDir,
        skillsetName: "mixed-format-test",
        flatFiles: {
          "simple-agent.md": "# Simple Agent\n\nI am simple.\n",
        },
        directories: {
          "complex-agent": {
            "SUBAGENT.md": "# Complex Agent\n\nI am complex.\n",
          },
        },
      });

      await loader.run({ agent, config, skillset });

      // Both should be installed
      const simpleContent = await fs.readFile(
        path.join(agentsDir, "simple-agent.md"),
        "utf-8",
      );
      expect(simpleContent).toContain("I am simple.");

      const complexContent = await fs.readFile(
        path.join(agentsDir, "complex-agent.md"),
        "utf-8",
      );
      expect(complexContent).toContain("I am complex.");
    });

    it("should prefer directory over flat file on name collision", async () => {
      const loader = createSubagentsLoader({ managedDirs: ["agents"] });
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "collision-test",
      });
      const skillset = await createTestSkillsetWithDirs({
        skillsetsDir: noriProfilesDir,
        skillsetName: "collision-test",
        flatFiles: {
          "foo.md": "# Flat Foo\n\nI am the flat version.\n",
        },
        directories: {
          foo: {
            "SUBAGENT.md": "# Directory Foo\n\nI am the directory version.\n",
          },
        },
      });

      await loader.run({ agent, config, skillset });

      // Directory version should win
      const content = await fs.readFile(
        path.join(agentsDir, "foo.md"),
        "utf-8",
      );
      expect(content).toContain("I am the directory version.");
      expect(content).not.toContain("I am the flat version.");
    });

    it("should ignore directories without SUBAGENT.md", async () => {
      const loader = createSubagentsLoader({ managedDirs: ["agents"] });
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "no-subagent-md-test",
      });
      const skillset = await createTestSkillsetWithDirs({
        skillsetsDir: noriProfilesDir,
        skillsetName: "no-subagent-md-test",
        flatFiles: {
          "real-agent.md": "# Real Agent\n\nI exist.\n",
        },
        directories: {
          "random-dir": {
            "README.md": "# Some random directory\n",
          },
        },
      });

      await loader.run({ agent, config, skillset });

      // Real agent should be installed
      const realExists = await fs
        .access(path.join(agentsDir, "real-agent.md"))
        .then(() => true)
        .catch(() => false);
      expect(realExists).toBe(true);

      // Random dir should NOT produce an installed agent
      const randomExists = await fs
        .access(path.join(agentsDir, "random-dir.md"))
        .then(() => true)
        .catch(() => false);
      expect(randomExists).toBe(false);
    });

    it("should not exclude docs.md inside a subagent directory", async () => {
      const loader = createSubagentsLoader({ managedDirs: ["agents"] });
      const config = createTestConfig({
        installDir: tempDir,
        activeSkillset: "docs-inside-dir-test",
      });
      const skillset = await createTestSkillsetWithDirs({
        skillsetsDir: noriProfilesDir,
        skillsetName: "docs-inside-dir-test",
        flatFiles: {
          "docs.md": "# Top-level docs should be excluded\n",
        },
        directories: {
          "my-agent": {
            "SUBAGENT.md":
              "# My Agent\n\nI reference docs.md in my directory.\n",
            "docs.md": "# Internal docs - should not affect anything\n",
          },
        },
      });

      await loader.run({ agent, config, skillset });

      // Top-level docs.md should still be excluded
      const topDocsExists = await fs
        .access(path.join(agentsDir, "docs.md"))
        .then(() => true)
        .catch(() => false);
      expect(topDocsExists).toBe(false);

      // The directory-based subagent should still be installed
      const agentExists = await fs
        .access(path.join(agentsDir, "my-agent.md"))
        .then(() => true)
        .catch(() => false);
      expect(agentExists).toBe(true);
    });
  });
});
