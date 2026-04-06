/**
 * Tests for shared agent operations (agentOperations.ts)
 *
 * These tests use a synthetic AgentConfig pointing at real temp directories
 * to validate the behavior of each shared operation function.
 */

import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  getManagedFiles,
  getManagedDirs,
  isInstalledAtDir,
  markInstall,
  installSkillset,
  switchSkillset,
  removeSkillset,
  detectLocalChanges,
  detectExistingConfig,
  captureExistingConfig,
  findArtifacts,
} from "@/cli/features/agentOperations.js";

import type { Config } from "@/cli/config.js";
import type { AgentConfig, AgentLoader } from "@/cli/features/agentRegistry.js";

// Mock os.homedir so getNoriDir / getNoriSkillsetsDir resolve to temp dirs
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

// Test-scoped nori dir (set in each suite's beforeEach via os.homedir mock)
const TEST_NORI_DIR = "/tmp/agent-ops-test-nori";

vi.mock("@/norijson/skillset.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getNoriDir: () => TEST_NORI_DIR,
    getNoriSkillsetsDir: () => `${TEST_NORI_DIR}/profiles`,
  };
});

// Mock @clack/prompts to suppress output during tests
vi.mock("@clack/prompts", () => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    step: vi.fn(),
    message: vi.fn(),
  },
  note: vi.fn(),
}));

/**
 * Create a test AgentConfig that uses a temp directory as its agent dir.
 * The agent dir is `{installDir}/.test-agent`.
 *
 * @param args - Optional configuration for the test agent
 * @param args.loaders - Array of loaders to register on the agent
 * @param args.getArtifactPatterns - Function returning artifact dir/file patterns
 *
 * @returns An AgentConfig suitable for testing
 */
const createTestAgent = (args?: {
  loaders?: Array<AgentLoader> | null;
  getArtifactPatterns?:
    | (() => {
        dirs: ReadonlyArray<string>;
        files: ReadonlyArray<string>;
      })
    | null;
}): AgentConfig => {
  const loaders = args?.loaders ?? [];
  const getArtifactPatterns = args?.getArtifactPatterns ?? null;

  return {
    name: "claude-code",
    displayName: "Test Agent",
    description: "A test agent for agentOperations tests",

    getAgentDir: (a: { installDir: string }) =>
      path.join(a.installDir, ".test-agent"),
    getSkillsDir: (a: { installDir: string }) =>
      path.join(a.installDir, ".test-agent", "skills"),
    getSubagentsDir: (a: { installDir: string }) =>
      path.join(a.installDir, ".test-agent", "agents"),
    getSlashcommandsDir: (a: { installDir: string }) =>
      path.join(a.installDir, ".test-agent", "commands"),
    getInstructionsFilePath: (a: { installDir: string }) =>
      path.join(a.installDir, ".test-agent", "INSTRUCTIONS.md"),

    getLoaders: () => loaders,

    getArtifactPatterns: getArtifactPatterns,
  };
};

describe("getManagedFiles", () => {
  it("should aggregate managedFiles from all loaders", () => {
    const agent = createTestAgent({
      loaders: [
        {
          name: "loader-a",
          description: "A",
          managedFiles: ["file-a.md", "file-b.json"],
          run: async () => undefined,
        },
        {
          name: "loader-b",
          description: "B",
          managedFiles: ["file-c.sh"],
          run: async () => undefined,
        },
      ],
    });

    const result = getManagedFiles({ agent });
    expect(result).toContain("file-a.md");
    expect(result).toContain("file-b.json");
    expect(result).toContain("file-c.sh");
  });

  it("should deduplicate managed files across loaders", () => {
    const agent = createTestAgent({
      loaders: [
        {
          name: "loader-a",
          description: "A",
          managedFiles: ["shared.md", "unique-a.md"],
          run: async () => undefined,
        },
        {
          name: "loader-b",
          description: "B",
          managedFiles: ["shared.md", "unique-b.md"],
          run: async () => undefined,
        },
      ],
    });

    const result = getManagedFiles({ agent });
    const sharedCount = result.filter((f) => f === "shared.md").length;
    expect(sharedCount).toBe(1);
    expect(result).toContain("unique-a.md");
    expect(result).toContain("unique-b.md");
  });

  it("should handle loaders with no managedFiles", () => {
    const agent = createTestAgent({
      loaders: [
        {
          name: "loader-no-files",
          description: "No managed files",
          run: async () => undefined,
        },
        {
          name: "loader-with-files",
          description: "Has files",
          managedFiles: ["only.md"],
          run: async () => undefined,
        },
      ],
    });

    const result = getManagedFiles({ agent });
    expect(result).toContain("only.md");
    expect(result).toHaveLength(1);
  });

  it("should return empty array when no loaders have managedFiles", () => {
    const agent = createTestAgent({
      loaders: [
        { name: "empty", description: "Empty", run: async () => undefined },
      ],
    });

    const result = getManagedFiles({ agent });
    expect(result).toHaveLength(0);
  });
});

describe("getManagedDirs", () => {
  it("should aggregate managedDirs from all loaders", () => {
    const agent = createTestAgent({
      loaders: [
        {
          name: "loader-a",
          description: "A",
          managedDirs: ["skills", "agents"],
          run: async () => undefined,
        },
        {
          name: "loader-b",
          description: "B",
          managedDirs: ["commands"],
          run: async () => undefined,
        },
      ],
    });

    const result = getManagedDirs({ agent });
    expect(result).toContain("skills");
    expect(result).toContain("agents");
    expect(result).toContain("commands");
  });

  it("should deduplicate managed dirs across loaders", () => {
    const agent = createTestAgent({
      loaders: [
        {
          name: "loader-a",
          description: "A",
          managedDirs: ["skills"],
          run: async () => undefined,
        },
        {
          name: "loader-b",
          description: "B",
          managedDirs: ["skills", "rules"],
          run: async () => undefined,
        },
      ],
    });

    const result = getManagedDirs({ agent });
    const skillsCount = result.filter((d) => d === "skills").length;
    expect(skillsCount).toBe(1);
    expect(result).toContain("rules");
  });

  it("should return empty array when no loaders have managedDirs", () => {
    const agent = createTestAgent({
      loaders: [
        { name: "empty", description: "Empty", run: async () => undefined },
      ],
    });

    const result = getManagedDirs({ agent });
    expect(result).toHaveLength(0);
  });
});

describe("isInstalledAtDir", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "agent-ops-installed-test-"),
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should return true when .nori-managed marker exists in agent dir", () => {
    const agent = createTestAgent();
    const agentDir = agent.getAgentDir({ installDir: tempDir });
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, ".nori-managed"), "test-skillset");

    expect(isInstalledAtDir({ agent, path: tempDir })).toBe(true);
  });

  it("should return false for empty directory", () => {
    const agent = createTestAgent();

    expect(isInstalledAtDir({ agent, path: tempDir })).toBe(false);
  });

  it("should return true when instructions file contains NORI-AI MANAGED BLOCK (backwards compat)", () => {
    const agent = createTestAgent();
    const agentDir = agent.getAgentDir({ installDir: tempDir });
    fs.mkdirSync(agentDir, { recursive: true });

    const instructionsPath = agent.getInstructionsFilePath({
      installDir: tempDir,
    });
    fs.writeFileSync(
      instructionsPath,
      "# BEGIN NORI-AI MANAGED BLOCK\nsome content\n# END NORI-AI MANAGED BLOCK",
    );

    expect(isInstalledAtDir({ agent, path: tempDir })).toBe(true);
  });

  it("should return false when instructions file exists but has no managed block", () => {
    const agent = createTestAgent();
    const agentDir = agent.getAgentDir({ installDir: tempDir });
    fs.mkdirSync(agentDir, { recursive: true });

    const instructionsPath = agent.getInstructionsFilePath({
      installDir: tempDir,
    });
    fs.writeFileSync(instructionsPath, "# Just some regular content");

    expect(isInstalledAtDir({ agent, path: tempDir })).toBe(false);
  });
});

describe("markInstall", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ops-mark-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should create .nori-managed file with skillset name", () => {
    const agent = createTestAgent();
    const agentDir = agent.getAgentDir({ installDir: tempDir });
    fs.mkdirSync(agentDir, { recursive: true });

    markInstall({ agent, path: tempDir, skillsetName: "senior-swe" });

    const content = fs.readFileSync(
      path.join(agentDir, ".nori-managed"),
      "utf-8",
    );
    expect(content).toBe("senior-swe");
  });

  it("should create agent dir if it does not exist", () => {
    const agent = createTestAgent();

    markInstall({ agent, path: tempDir, skillsetName: "my-profile" });

    const agentDir = agent.getAgentDir({ installDir: tempDir });
    const markerPath = path.join(agentDir, ".nori-managed");
    expect(fs.existsSync(markerPath)).toBe(true);
    expect(fs.readFileSync(markerPath, "utf-8")).toBe("my-profile");
  });

  it("should write empty string when skillsetName is not provided", () => {
    const agent = createTestAgent();

    markInstall({ agent, path: tempDir });

    const agentDir = agent.getAgentDir({ installDir: tempDir });
    const content = fs.readFileSync(
      path.join(agentDir, ".nori-managed"),
      "utf-8",
    );
    expect(content).toBe("");
  });
});

describe("installSkillset", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ops-install-test-"));
    vi.mocked(os.homedir).mockReturnValue(tempDir);

    // Clean up mocked nori dir
    try {
      fs.rmSync(TEST_NORI_DIR, { recursive: true, force: true });
    } catch {}
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    try {
      fs.rmSync(TEST_NORI_DIR, { recursive: true, force: true });
    } catch {}
    vi.clearAllMocks();
  });

  it("should run loaders in order and collect string returns as settings labels", async () => {
    const runOrder: Array<string> = [];

    const agent = createTestAgent({
      loaders: [
        {
          name: "first-loader",
          description: "First",
          managedFiles: ["INSTRUCTIONS.md"],
          managedDirs: ["skills"],
          run: async () => {
            runOrder.push("first");
            return "First Setting";
          },
        },
        {
          name: "second-loader",
          description: "Second",
          run: async () => {
            runOrder.push("second");
            // returns void, should not be collected
          },
        },
        {
          name: "third-loader",
          description: "Third",
          run: async () => {
            runOrder.push("third");
            return "Third Setting";
          },
        },
      ],
    });

    // Create a skillset directory
    const skillsetDir = path.join(TEST_NORI_DIR, "profiles", "test-skillset");
    fs.mkdirSync(skillsetDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsetDir, "nori.json"),
      JSON.stringify({ name: "test-skillset", version: "1.0.0" }),
    );

    const config: Config = {
      installDir: tempDir,
      activeSkillset: "test-skillset",
    };

    await installSkillset({ agent, config });

    expect(runOrder).toEqual(["first", "second", "third"]);
  });

  it("should write manifest when skipManifest is false", async () => {
    const agent = createTestAgent({
      loaders: [
        {
          name: "test-loader",
          description: "Test",
          managedFiles: ["INSTRUCTIONS.md"],
          run: async ({ agent: a, config: c }) => {
            // Create a managed file so the manifest has something to track
            const agentDir = a.getAgentDir({ installDir: c.installDir });
            fs.mkdirSync(agentDir, { recursive: true });
            fs.writeFileSync(path.join(agentDir, "INSTRUCTIONS.md"), "# Test");
          },
        },
      ],
    });

    // Create skillset at both the mocked path and the os.homedir-based path
    // so that both external callers (via mocked getNoriSkillsetsDir) and
    // internal module calls (via os.homedir) can find the skillset.
    const noriJsonContent = JSON.stringify({
      name: "test-skillset",
      version: "1.0.0",
    });
    const skillsetDir = path.join(TEST_NORI_DIR, "profiles", "test-skillset");
    fs.mkdirSync(skillsetDir, { recursive: true });
    fs.writeFileSync(path.join(skillsetDir, "nori.json"), noriJsonContent);
    const homeSkillsetDir = path.join(
      tempDir,
      ".nori",
      "profiles",
      "test-skillset",
    );
    fs.mkdirSync(homeSkillsetDir, { recursive: true });
    fs.writeFileSync(path.join(homeSkillsetDir, "nori.json"), noriJsonContent);

    const config: Config = {
      installDir: tempDir,
      activeSkillset: "test-skillset",
    };

    await installSkillset({ agent, config, skipManifest: false });

    // Manifest should exist
    const { getManifestPath } = await import("@/cli/features/manifest.js");
    const manifestPath = getManifestPath({ agentName: agent.name });
    expect(fs.existsSync(manifestPath)).toBe(true);
  });

  it("should skip manifest when skipManifest is true", async () => {
    const agent = createTestAgent({
      loaders: [
        {
          name: "test-loader",
          description: "Test",
          managedFiles: ["INSTRUCTIONS.md"],
          run: async ({ agent: a, config: c }) => {
            const agentDir = a.getAgentDir({ installDir: c.installDir });
            fs.mkdirSync(agentDir, { recursive: true });
            fs.writeFileSync(path.join(agentDir, "INSTRUCTIONS.md"), "# Test");
          },
        },
      ],
    });

    const skillsetDir = path.join(TEST_NORI_DIR, "profiles", "test-skillset");
    fs.mkdirSync(skillsetDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsetDir, "nori.json"),
      JSON.stringify({ name: "test-skillset", version: "1.0.0" }),
    );

    const config: Config = {
      installDir: tempDir,
      activeSkillset: "test-skillset",
    };

    await installSkillset({ agent, config, skipManifest: true });

    // Manifest should NOT exist
    const { getManifestPath } = await import("@/cli/features/manifest.js");
    const manifestPath = getManifestPath({ agentName: agent.name });
    expect(fs.existsSync(manifestPath)).toBe(false);
  });
});

describe("switchSkillset", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ops-switch-test-"));
    vi.mocked(os.homedir).mockReturnValue(tempDir);

    // Clean up mocked nori dir
    try {
      fs.rmSync(TEST_NORI_DIR, { recursive: true, force: true });
    } catch {}
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    try {
      fs.rmSync(TEST_NORI_DIR, { recursive: true, force: true });
    } catch {}
    vi.clearAllMocks();
  });

  it("should succeed for valid skillset with nori.json", async () => {
    const agent = createTestAgent();

    const skillsetDir = path.join(TEST_NORI_DIR, "profiles", "valid-skillset");
    fs.mkdirSync(skillsetDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsetDir, "nori.json"),
      JSON.stringify({ name: "valid-skillset", version: "1.0.0" }),
    );

    await expect(
      switchSkillset({
        agent,
        installDir: tempDir,
        skillsetName: "valid-skillset",
      }),
    ).resolves.not.toThrow();
  });

  it("should throw for nonexistent skillset", async () => {
    const agent = createTestAgent();

    await expect(
      switchSkillset({
        agent,
        installDir: tempDir,
        skillsetName: "nonexistent-skillset",
      }),
    ).rejects.toThrow(/not found/);
  });
});

describe("removeSkillset", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ops-remove-test-"));
    vi.mocked(os.homedir).mockReturnValue(tempDir);
  });

  afterEach(async () => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("should remove managed files tracked in manifest", async () => {
    const agent = createTestAgent({
      loaders: [
        {
          name: "loader",
          description: "Loader",
          managedFiles: ["INSTRUCTIONS.md"],
          managedDirs: ["skills"],
          run: async () => undefined,
        },
      ],
    });

    const agentDir = agent.getAgentDir({ installDir: tempDir });
    fs.mkdirSync(agentDir, { recursive: true });

    // Create managed files
    fs.writeFileSync(path.join(agentDir, "INSTRUCTIONS.md"), "# Config");
    fs.writeFileSync(path.join(agentDir, ".nori-managed"), "test-skillset");

    const skillsDir = path.join(agentDir, "skills", "test-skill");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(path.join(skillsDir, "SKILL.md"), "# Test skill");

    // Create manifest
    const { computeFileHash, writeManifest, getManifestPath } =
      await import("@/cli/features/manifest.js");
    const instructionHash = await computeFileHash({
      filePath: path.join(agentDir, "INSTRUCTIONS.md"),
    });
    const skillHash = await computeFileHash({
      filePath: path.join(skillsDir, "SKILL.md"),
    });
    const manifestPath = getManifestPath({ agentName: agent.name });
    await writeManifest({
      manifestPath,
      manifest: {
        version: 1,
        createdAt: new Date().toISOString(),
        skillsetName: "test-skillset",
        files: {
          "INSTRUCTIONS.md": instructionHash,
          "skills/test-skill/SKILL.md": skillHash,
        },
      },
    });

    await removeSkillset({ agent, installDir: tempDir });

    // Managed files should be gone
    expect(fs.existsSync(path.join(agentDir, "INSTRUCTIONS.md"))).toBe(false);
    expect(fs.existsSync(path.join(agentDir, ".nori-managed"))).toBe(false);
    expect(fs.existsSync(manifestPath)).toBe(false);
  });

  it("should also remove legacy manifest for claude-code agent", async () => {
    const agent = createTestAgent({
      loaders: [
        {
          name: "loader",
          description: "Loader",
          managedFiles: ["INSTRUCTIONS.md"],
          run: async () => undefined,
        },
      ],
    });

    const agentDir = agent.getAgentDir({ installDir: tempDir });
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "INSTRUCTIONS.md"), "# Config");
    fs.writeFileSync(path.join(agentDir, ".nori-managed"), "test-skillset");

    // Create both primary and legacy manifests
    const { computeFileHash, writeManifest, getManifestPath } =
      await import("@/cli/features/manifest.js");
    const hash = await computeFileHash({
      filePath: path.join(agentDir, "INSTRUCTIONS.md"),
    });

    // Write primary manifest
    const manifestPath = getManifestPath({ agentName: agent.name });
    await writeManifest({
      manifestPath,
      manifest: {
        version: 1,
        createdAt: new Date().toISOString(),
        skillsetName: "test-skillset",
        files: { "INSTRUCTIONS.md": hash },
      },
    });

    // Write legacy manifest (only for claude-code)
    const { getLegacyManifestPath } =
      await import("@/cli/features/manifest.js");
    const legacyPath = getLegacyManifestPath();
    await writeManifest({
      manifestPath: legacyPath,
      manifest: {
        version: 1,
        createdAt: new Date().toISOString(),
        skillsetName: "test-skillset",
        files: { "INSTRUCTIONS.md": hash },
      },
    });

    await removeSkillset({ agent, installDir: tempDir });

    // Both manifests should be cleaned up
    expect(fs.existsSync(manifestPath)).toBe(false);
    expect(fs.existsSync(legacyPath)).toBe(false);
  });

  it("should complete without error when no manifest exists", async () => {
    const agent = createTestAgent();

    await expect(
      removeSkillset({ agent, installDir: tempDir }),
    ).resolves.not.toThrow();
  });
});

describe("detectLocalChanges", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ops-detect-test-"));
    vi.mocked(os.homedir).mockReturnValue(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("should return diff when files are modified", async () => {
    const agent = createTestAgent({
      loaders: [
        {
          name: "loader",
          description: "Loader",
          managedFiles: ["INSTRUCTIONS.md"],
          run: async () => undefined,
        },
      ],
    });

    const agentDir = agent.getAgentDir({ installDir: tempDir });
    fs.mkdirSync(agentDir, { recursive: true });
    const filePath = path.join(agentDir, "INSTRUCTIONS.md");
    fs.writeFileSync(filePath, "# Original content");

    // Create manifest with original hash
    const { computeFileHash, writeManifest, getManifestPath } =
      await import("@/cli/features/manifest.js");
    const originalHash = await computeFileHash({ filePath });
    const manifestPath = getManifestPath({ agentName: agent.name });
    await writeManifest({
      manifestPath,
      manifest: {
        version: 1,
        createdAt: new Date().toISOString(),
        skillsetName: "test-skillset",
        files: { "INSTRUCTIONS.md": originalHash },
      },
    });

    // Modify the file
    fs.writeFileSync(filePath, "# Modified content");

    const diff = await detectLocalChanges({ agent, installDir: tempDir });
    expect(diff).not.toBeNull();
    expect(diff!.modified).toContain("INSTRUCTIONS.md");
  });

  it("should return null when no manifest exists", async () => {
    const agent = createTestAgent();

    const diff = await detectLocalChanges({ agent, installDir: tempDir });
    expect(diff).toBeNull();
  });

  it("should return null when files match the manifest", async () => {
    const agent = createTestAgent({
      loaders: [
        {
          name: "loader",
          description: "Loader",
          managedFiles: ["INSTRUCTIONS.md"],
          run: async () => undefined,
        },
      ],
    });

    const agentDir = agent.getAgentDir({ installDir: tempDir });
    fs.mkdirSync(agentDir, { recursive: true });
    const filePath = path.join(agentDir, "INSTRUCTIONS.md");
    fs.writeFileSync(filePath, "# Unchanged content");

    const { computeFileHash, writeManifest, getManifestPath } =
      await import("@/cli/features/manifest.js");
    const hash = await computeFileHash({ filePath });
    const manifestPath = getManifestPath({ agentName: agent.name });
    await writeManifest({
      manifestPath,
      manifest: {
        version: 1,
        createdAt: new Date().toISOString(),
        skillsetName: "test-skillset",
        files: { "INSTRUCTIONS.md": hash },
      },
    });

    const diff = await detectLocalChanges({ agent, installDir: tempDir });
    expect(diff).toBeNull();
  });
});

describe("detectExistingConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "agent-ops-existing-test-"),
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should return config info when skills and instructions exist", async () => {
    const agent = createTestAgent();
    const agentDir = agent.getAgentDir({ installDir: tempDir });
    fs.mkdirSync(agentDir, { recursive: true });

    // Create instructions file
    const instructionsPath = agent.getInstructionsFilePath({
      installDir: tempDir,
    });
    fs.writeFileSync(instructionsPath, "# My custom config");

    // Create skills dir with a skill
    const skillsDir = agent.getSkillsDir({ installDir: tempDir });
    const testSkillDir = path.join(skillsDir, "test-skill");
    fs.mkdirSync(testSkillDir, { recursive: true });
    fs.writeFileSync(path.join(testSkillDir, "SKILL.md"), "# Test skill");

    const result = await detectExistingConfig({ agent, installDir: tempDir });

    expect(result).not.toBeNull();
    expect(result!.hasConfigFile).toBe(true);
    expect(result!.hasSkills).toBe(true);
    expect(result!.skillCount).toBe(1);
  });

  it("should return null for empty dir", async () => {
    const agent = createTestAgent();

    const result = await detectExistingConfig({ agent, installDir: tempDir });

    expect(result).toBeNull();
  });

  it("should detect managed block in instructions file", async () => {
    const agent = createTestAgent();
    const agentDir = agent.getAgentDir({ installDir: tempDir });
    fs.mkdirSync(agentDir, { recursive: true });

    const instructionsPath = agent.getInstructionsFilePath({
      installDir: tempDir,
    });
    fs.writeFileSync(
      instructionsPath,
      "# BEGIN NORI-AI MANAGED BLOCK\ncontent\n# END NORI-AI MANAGED BLOCK",
    );

    const result = await detectExistingConfig({ agent, installDir: tempDir });

    expect(result).not.toBeNull();
    expect(result!.hasManagedBlock).toBe(true);
  });
});

describe("captureExistingConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ops-capture-test-"));
    vi.mocked(os.homedir).mockReturnValue(tempDir);

    // Clean up mocked nori dir
    try {
      fs.rmSync(TEST_NORI_DIR, { recursive: true, force: true });
    } catch {}
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    try {
      fs.rmSync(TEST_NORI_DIR, { recursive: true, force: true });
    } catch {}
    vi.clearAllMocks();
  });

  it("should copy skills, agents, commands to skillset dir with correct renames", async () => {
    const agent = createTestAgent();
    const agentDir = agent.getAgentDir({ installDir: tempDir });
    fs.mkdirSync(agentDir, { recursive: true });

    // Create instructions file
    const instructionsPath = agent.getInstructionsFilePath({
      installDir: tempDir,
    });
    fs.writeFileSync(instructionsPath, "# My custom config");

    // Create skills
    const skillsDir = agent.getSkillsDir({ installDir: tempDir });
    const testSkillDir = path.join(skillsDir, "my-skill");
    fs.mkdirSync(testSkillDir, { recursive: true });
    fs.writeFileSync(path.join(testSkillDir, "SKILL.md"), "# My skill");

    // Create agents (subagents source)
    const agentsDir = agent.getSubagentsDir({ installDir: tempDir });
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "helper.md"), "# Helper agent");

    // Create commands (slashcommands source)
    const commandsDir = agent.getSlashcommandsDir({ installDir: tempDir });
    fs.mkdirSync(commandsDir, { recursive: true });
    fs.writeFileSync(path.join(commandsDir, "deploy.md"), "# Deploy command");

    // Create profiles directory
    const profilesDir = path.join(TEST_NORI_DIR, "profiles");
    fs.mkdirSync(profilesDir, { recursive: true });

    const config: Config = {
      installDir: tempDir,
      activeSkillset: "captured",
    };

    await captureExistingConfig({
      agent,
      installDir: tempDir,
      skillsetName: "captured",
      config,
    });

    const capturedDir = path.join(profilesDir, "captured");

    // Skills should be copied
    expect(
      fs.existsSync(path.join(capturedDir, "skills", "my-skill", "SKILL.md")),
    ).toBe(true);

    // Agents should be renamed to subagents
    expect(
      fs.existsSync(path.join(capturedDir, "subagents", "helper.md")),
    ).toBe(true);

    // Commands should be renamed to slashcommands
    expect(
      fs.existsSync(path.join(capturedDir, "slashcommands", "deploy.md")),
    ).toBe(true);
  });

  it("should write captured instructions to AGENTS.md in skillset dir", async () => {
    const agent = createTestAgent();
    const agentDir = agent.getAgentDir({ installDir: tempDir });
    fs.mkdirSync(agentDir, { recursive: true });

    // Create instructions file
    const instructionsPath = agent.getInstructionsFilePath({
      installDir: tempDir,
    });
    fs.writeFileSync(instructionsPath, "# My custom config");

    // Create profiles directory
    const profilesDir = path.join(TEST_NORI_DIR, "profiles");
    fs.mkdirSync(profilesDir, { recursive: true });

    const config: Config = {
      installDir: tempDir,
      activeSkillset: "captured",
    };

    await captureExistingConfig({
      agent,
      installDir: tempDir,
      skillsetName: "captured",
      config,
    });

    const capturedDir = path.join(profilesDir, "captured");

    // Should write AGENTS.md, not CLAUDE.md
    expect(fs.existsSync(path.join(capturedDir, "AGENTS.md"))).toBe(true);
    expect(fs.existsSync(path.join(capturedDir, "CLAUDE.md"))).toBe(false);
  });

  it("should create nori.json with skill names", async () => {
    const agent = createTestAgent();
    const agentDir = agent.getAgentDir({ installDir: tempDir });
    fs.mkdirSync(agentDir, { recursive: true });

    // Create instructions file
    const instructionsPath = agent.getInstructionsFilePath({
      installDir: tempDir,
    });
    fs.writeFileSync(instructionsPath, "# Config");

    // Create skills
    const skillsDir = agent.getSkillsDir({ installDir: tempDir });
    const skill1Dir = path.join(skillsDir, "skill-alpha");
    const skill2Dir = path.join(skillsDir, "skill-beta");
    fs.mkdirSync(skill1Dir, { recursive: true });
    fs.mkdirSync(skill2Dir, { recursive: true });
    fs.writeFileSync(path.join(skill1Dir, "SKILL.md"), "# Alpha");
    fs.writeFileSync(path.join(skill2Dir, "SKILL.md"), "# Beta");

    // Create profiles directory
    const profilesDir = path.join(TEST_NORI_DIR, "profiles");
    fs.mkdirSync(profilesDir, { recursive: true });

    const config: Config = {
      installDir: tempDir,
      activeSkillset: "captured",
    };

    await captureExistingConfig({
      agent,
      installDir: tempDir,
      skillsetName: "captured",
      config,
    });

    const capturedDir = path.join(profilesDir, "captured");
    const noriJsonPath = path.join(capturedDir, "nori.json");
    expect(fs.existsSync(noriJsonPath)).toBe(true);

    const noriJson = JSON.parse(fs.readFileSync(noriJsonPath, "utf-8"));
    expect(noriJson.name).toBe("captured");
    expect(noriJson.dependencies?.skills).toBeDefined();
    expect(noriJson.dependencies.skills["skill-alpha"]).toBe("*");
    expect(noriJson.dependencies.skills["skill-beta"]).toBe("*");
  });
});

describe("findArtifacts", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), "agent-ops-artifacts-test-"),
    );
  });

  afterEach(async () => {
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });

  it("should find agent dirs and files at multiple ancestor levels", async () => {
    const agent = createTestAgent({
      getArtifactPatterns: () => ({
        dirs: [".test-agent"],
        files: ["INSTRUCTIONS.md"],
      }),
    });

    // Create artifacts at startDir level
    const startDir = path.join(tempDir, "a", "b");
    await fsPromises.mkdir(startDir, { recursive: true });
    await fsPromises.mkdir(path.join(startDir, ".test-agent"), {
      recursive: true,
    });
    await fsPromises.writeFile(
      path.join(startDir, "INSTRUCTIONS.md"),
      "# Start",
    );

    // Create artifacts at parent level
    const parentDir = path.join(tempDir, "a");
    await fsPromises.mkdir(path.join(parentDir, ".test-agent"), {
      recursive: true,
    });

    const artifacts = await findArtifacts({
      agent,
      startDir,
      stopDir: parentDir,
    });

    expect(artifacts.length).toBeGreaterThanOrEqual(2);

    const artifactPaths = artifacts.map((a) => a.path);
    expect(artifactPaths).toContain(path.join(startDir, ".test-agent"));
    expect(artifactPaths).toContain(path.join(parentDir, ".test-agent"));
  });

  it("should return empty array for agent without getArtifactPatterns", async () => {
    const agent = createTestAgent({
      getArtifactPatterns: null,
    });

    const artifacts = await findArtifacts({ agent, startDir: tempDir });
    expect(artifacts).toEqual([]);
  });

  it("should respect stopDir", async () => {
    const agent = createTestAgent({
      getArtifactPatterns: () => ({
        dirs: [".test-agent"],
        files: [],
      }),
    });

    // Create a deep structure
    const deepDir = path.join(tempDir, "a", "b", "c");
    await fsPromises.mkdir(deepDir, { recursive: true });

    // Create artifacts at every level
    await fsPromises.mkdir(path.join(tempDir, ".test-agent"));
    await fsPromises.mkdir(path.join(tempDir, "a", ".test-agent"));
    await fsPromises.mkdir(path.join(tempDir, "a", "b", ".test-agent"));
    await fsPromises.mkdir(path.join(deepDir, ".test-agent"));

    // Stop at level "a/b" - should not find tempDir-level artifacts
    const stopDir = path.join(tempDir, "a", "b");
    const artifacts = await findArtifacts({
      agent,
      startDir: deepDir,
      stopDir,
    });

    const artifactPaths = artifacts.map((a) => a.path);

    // Should find at deepDir and stopDir levels
    expect(artifactPaths).toContain(path.join(deepDir, ".test-agent"));
    expect(artifactPaths).toContain(path.join(stopDir, ".test-agent"));

    // Should NOT find above stopDir
    expect(artifactPaths).not.toContain(path.join(tempDir, ".test-agent"));
    expect(artifactPaths).not.toContain(path.join(tempDir, "a", ".test-agent"));
  });
});
