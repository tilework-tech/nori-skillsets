import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as os from "os";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { getConfigPath, saveConfig } from "@/cli/config.js";
import { cursorConfig } from "@/cli/features/cursor-agent/agent.js";
import {
  isInstalledAtDir,
  markInstall,
  switchSkillset,
  detectLocalChanges,
  removeSkillset,
  installSkillset,
  getAgentDir,
} from "@/cli/features/shared/agentHandlers.js";

// Mock os.homedir so getConfigPath resolves to test directories
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

vi.mock("@/cli/features/paths.js", () => {
  const testNoriDir = "/tmp/cursor-agent-test-nori";
  return {
    getNoriDir: () => testNoriDir,
    getNoriSkillsetsDir: () => `${testNoriDir}/profiles`,
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

describe("cursorConfig isInstalledAtDir", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-installed-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should return true when .cursor/.nori-managed exists", () => {
    const cursorDir = path.join(tempDir, ".cursor");
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.writeFileSync(path.join(cursorDir, ".nori-managed"), "senior-swe");

    expect(isInstalledAtDir({ agentConfig: cursorConfig, path: tempDir })).toBe(
      true,
    );
  });

  it("should return false when no marker exists", () => {
    expect(isInstalledAtDir({ agentConfig: cursorConfig, path: tempDir })).toBe(
      false,
    );
  });

  it("should return false when .cursor exists but has no .nori-managed", () => {
    const cursorDir = path.join(tempDir, ".cursor");
    fs.mkdirSync(cursorDir, { recursive: true });

    expect(isInstalledAtDir({ agentConfig: cursorConfig, path: tempDir })).toBe(
      false,
    );
  });
});

describe("cursorConfig markInstall", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-mark-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should create .cursor/.nori-managed with the skillset name", () => {
    const cursorDir = path.join(tempDir, ".cursor");
    fs.mkdirSync(cursorDir, { recursive: true });

    markInstall({
      agentConfig: cursorConfig,
      path: tempDir,
      skillsetName: "senior-swe",
    });

    const content = fs.readFileSync(
      path.join(cursorDir, ".nori-managed"),
      "utf-8",
    );
    expect(content).toBe("senior-swe");
  });

  it("should create .cursor directory if it does not exist", () => {
    markInstall({
      agentConfig: cursorConfig,
      path: tempDir,
      skillsetName: "my-profile",
    });

    const markerPath = path.join(tempDir, ".cursor", ".nori-managed");
    expect(fs.existsSync(markerPath)).toBe(true);
    expect(fs.readFileSync(markerPath, "utf-8")).toBe("my-profile");
  });

  it("should overwrite existing .nori-managed with new skillset name", () => {
    const cursorDir = path.join(tempDir, ".cursor");
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.writeFileSync(path.join(cursorDir, ".nori-managed"), "old-profile");

    markInstall({
      agentConfig: cursorConfig,
      path: tempDir,
      skillsetName: "new-profile",
    });

    const content = fs.readFileSync(
      path.join(cursorDir, ".nori-managed"),
      "utf-8",
    );
    expect(content).toBe("new-profile");
  });
});

describe("cursorConfig switchSkillset", () => {
  let tempDir: string;
  const TEST_NORI_DIR = "/tmp/cursor-agent-test-nori";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-switch-test-"));
    vi.mocked(os.homedir).mockReturnValue(tempDir);

    // Clean up test directories
    try {
      fs.rmSync(TEST_NORI_DIR, { recursive: true, force: true });
    } catch {}

    // Create profiles directory with valid profiles
    const skillsetDir = path.join(TEST_NORI_DIR, "profiles", "senior-swe");
    fs.mkdirSync(skillsetDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsetDir, "nori.json"),
      JSON.stringify({ name: "senior-swe", version: "1.0.0" }),
    );

    const otherProfileDir = path.join(TEST_NORI_DIR, "profiles", "documenter");
    fs.mkdirSync(otherProfileDir, { recursive: true });
    fs.writeFileSync(
      path.join(otherProfileDir, "nori.json"),
      JSON.stringify({ name: "documenter", version: "1.0.0" }),
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    try {
      fs.rmSync(TEST_NORI_DIR, { recursive: true, force: true });
    } catch {}
    vi.clearAllMocks();
  });

  it("should not update config on disk when switching skillsets", async () => {
    const configFile = getConfigPath();
    await saveConfig({
      username: "test@example.com",
      organizationUrl: "https://example.tilework.tech",
      refreshToken: "test-refresh-token",
      activeSkillset: "senior-swe",
      installDir: tempDir,
    });

    const configBefore = fs.readFileSync(configFile, "utf-8");

    await switchSkillset({
      agentConfig: cursorConfig,
      installDir: tempDir,
      skillsetName: "documenter",
    });

    // Config on disk should be completely unchanged — the agent layer
    // no longer owns config persistence
    const configAfter = fs.readFileSync(configFile, "utf-8");
    expect(configAfter).toBe(configBefore);
  });

  it("should throw error for non-existent skillset", async () => {
    await expect(
      switchSkillset({
        agentConfig: cursorConfig,
        installDir: tempDir,
        skillsetName: "non-existent",
      }),
    ).rejects.toThrow(/Profile "non-existent" not found/);
  });
});

describe("cursorConfig detectLocalChanges", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fsPromises.mkdtemp(
      path.join(tmpdir(), "cursor-detect-changes-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testInstallDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (testInstallDir) {
      await fsPromises.rm(testInstallDir, { recursive: true, force: true });
    }
  });

  it("should return null when no manifest exists", async () => {
    const diff = await detectLocalChanges({
      agentConfig: cursorConfig,
      installDir: testInstallDir,
    });
    expect(diff).toBeNull();
  });

  it("should detect modifications to AGENTS.md inside .cursor/rules/", async () => {
    const agentDir = getAgentDir({
      agentConfig: cursorConfig,
      installDir: testInstallDir,
    });
    const rulesDir = path.join(agentDir, "rules");
    await fsPromises.mkdir(rulesDir, { recursive: true });

    // AGENTS.md lives inside .cursor/rules/
    const agentsMdPath = path.join(rulesDir, "AGENTS.md");
    await fsPromises.writeFile(agentsMdPath, "# Original content");

    const { computeFileHash, writeManifest, getManifestPath } =
      await import("@/cli/features/manifest.js");
    const originalHash = await computeFileHash({ filePath: agentsMdPath });
    const manifestPath = getManifestPath({ agentName: cursorConfig.name });
    await writeManifest({
      manifestPath,
      manifest: {
        version: 1,
        createdAt: new Date().toISOString(),
        skillsetName: "test-skillset",
        files: { "rules/AGENTS.md": originalHash },
      },
    });

    // Modify the file
    await fsPromises.writeFile(agentsMdPath, "# Modified content");

    const diff = await detectLocalChanges({
      agentConfig: cursorConfig,
      installDir: testInstallDir,
    });
    expect(diff).not.toBeNull();
    expect(diff!.modified).toContain("rules/AGENTS.md");
  });
});

describe("cursorConfig removeSkillset", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fsPromises.mkdtemp(
      path.join(tmpdir(), "cursor-remove-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testInstallDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (testInstallDir) {
      await fsPromises.rm(testInstallDir, { recursive: true, force: true });
    }
  });

  it("should remove managed files, AGENTS.md in rules dir, and manifest", async () => {
    const agentDir = getAgentDir({
      agentConfig: cursorConfig,
      installDir: testInstallDir,
    });
    const rulesDir = path.join(agentDir, "rules");
    await fsPromises.mkdir(rulesDir, { recursive: true });

    // Create AGENTS.md inside .cursor/rules/
    const agentsMdPath = path.join(rulesDir, "AGENTS.md");
    await fsPromises.writeFile(agentsMdPath, "# Config");
    await fsPromises.writeFile(
      path.join(agentDir, ".nori-managed"),
      "test-skillset",
    );

    // Create a skill file inside .cursor/ to verify managed dirs are cleaned
    const skillsDir = path.join(agentDir, "skills", "test-skill");
    await fsPromises.mkdir(skillsDir, { recursive: true });
    await fsPromises.writeFile(
      path.join(skillsDir, "SKILL.md"),
      "# Test skill",
    );

    const { computeFileHash, writeManifest, getManifestPath } =
      await import("@/cli/features/manifest.js");
    const skillHash = await computeFileHash({
      filePath: path.join(skillsDir, "SKILL.md"),
    });
    const agentsMdHash = await computeFileHash({ filePath: agentsMdPath });
    const manifestPath = getManifestPath({ agentName: cursorConfig.name });
    await writeManifest({
      manifestPath,
      manifest: {
        version: 1,
        createdAt: new Date().toISOString(),
        skillsetName: "test-skillset",
        files: {
          "skills/test-skill/SKILL.md": skillHash,
          "rules/AGENTS.md": agentsMdHash,
        },
      },
    });

    await removeSkillset({
      agentConfig: cursorConfig,
      installDir: testInstallDir,
    });

    // AGENTS.md inside .cursor/rules/ should be cleaned up
    await expect(fsPromises.access(agentsMdPath)).rejects.toThrow();
    // .nori-managed marker should be gone
    await expect(
      fsPromises.access(path.join(agentDir, ".nori-managed")),
    ).rejects.toThrow();
    // Manifest should be gone
    await expect(fsPromises.access(manifestPath)).rejects.toThrow();
    // Root-level AGENTS.md should NOT exist
    await expect(
      fsPromises.access(path.join(testInstallDir, "AGENTS.md")),
    ).rejects.toThrow();
  });

  it("should complete without error when no manifest exists", async () => {
    await expect(
      removeSkillset({
        agentConfig: cursorConfig,
        installDir: testInstallDir,
      }),
    ).resolves.not.toThrow();
  });
});

describe("cursorConfig installSkillset", () => {
  let testInstallDir: string;
  const TEST_NORI_DIR = "/tmp/cursor-agent-test-nori";

  beforeEach(async () => {
    testInstallDir = await fsPromises.mkdtemp(
      path.join(tmpdir(), "cursor-install-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testInstallDir);

    // Clean up the mocked nori directory
    try {
      await fsPromises.rm(TEST_NORI_DIR, { recursive: true, force: true });
    } catch {}
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (testInstallDir) {
      await fsPromises.rm(testInstallDir, { recursive: true, force: true });
    }
    try {
      await fsPromises.rm(TEST_NORI_DIR, { recursive: true, force: true });
    } catch {}
  });

  it("should create marker file and manifest after installation", async () => {
    // Create a skillset at the mocked profiles path
    const skillsetDir = path.join(TEST_NORI_DIR, "profiles", "test-skillset");
    await fsPromises.mkdir(skillsetDir, { recursive: true });
    await fsPromises.writeFile(
      path.join(skillsetDir, "CLAUDE.md"),
      "# Test skillset config",
    );
    await fsPromises.writeFile(
      path.join(skillsetDir, "nori.json"),
      JSON.stringify({ name: "test-skillset", version: "1.0.0" }),
    );

    // Create agent dir
    const agentDir = getAgentDir({
      agentConfig: cursorConfig,
      installDir: testInstallDir,
    });
    await fsPromises.mkdir(agentDir, { recursive: true });

    // Create config
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fsPromises.writeFile(
      configPath,
      JSON.stringify({
        activeSkillset: "test-skillset",
        installDir: testInstallDir,
      }),
    );

    const config = {
      installDir: testInstallDir,
      activeSkillset: "test-skillset",
    };

    await installSkillset({ agentConfig: cursorConfig, config });

    // Marker file should exist
    const markerPath = path.join(agentDir, ".nori-managed");
    await expect(fsPromises.access(markerPath)).resolves.not.toThrow();

    // Manifest should exist
    const { getManifestPath } = await import("@/cli/features/manifest.js");
    const manifestPath = getManifestPath({ agentName: cursorConfig.name });
    await expect(fsPromises.access(manifestPath)).resolves.not.toThrow();
  });

  it("should produce AGENTS.md inside .cursor/rules/ with skillset instructions", async () => {
    // Create a skillset at the mocked profiles path
    const skillsetDir = path.join(TEST_NORI_DIR, "profiles", "test-skillset");
    await fsPromises.mkdir(skillsetDir, { recursive: true });
    await fsPromises.writeFile(
      path.join(skillsetDir, "CLAUDE.md"),
      "# My coding instructions\n\nBe helpful.",
    );
    await fsPromises.writeFile(
      path.join(skillsetDir, "nori.json"),
      JSON.stringify({ name: "test-skillset", version: "1.0.0" }),
    );

    // Create agent dir
    const agentDir = getAgentDir({
      agentConfig: cursorConfig,
      installDir: testInstallDir,
    });
    await fsPromises.mkdir(agentDir, { recursive: true });

    // Create config
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fsPromises.writeFile(
      configPath,
      JSON.stringify({
        activeSkillset: "test-skillset",
        installDir: testInstallDir,
      }),
    );

    const config = {
      installDir: testInstallDir,
      activeSkillset: "test-skillset",
    };

    await installSkillset({ agentConfig: cursorConfig, config });

    // AGENTS.md should be inside .cursor/rules/
    const agentsMdPath = path.join(agentDir, "rules", "AGENTS.md");
    const content = await fsPromises.readFile(agentsMdPath, "utf-8");
    expect(content).toContain("BEGIN NORI-AI MANAGED BLOCK");
    expect(content).toContain("My coding instructions");
    expect(content).toContain("END NORI-AI MANAGED BLOCK");

    // Verify it's NOT at the project root
    await expect(
      fsPromises.access(path.join(testInstallDir, "AGENTS.md")),
    ).rejects.toThrow();
  });
});
