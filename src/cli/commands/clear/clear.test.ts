/**
 * Tests for the clear command
 *
 * Verifies that `clearMain` removes Nori-managed files from the installDir
 * and clears the activeSkillset from config.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerNoriSkillsetsClearCommand } from "@/cli/commands/noriSkillsetsCommands.js";
import { loadConfig } from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import {
  getLegacyAgentManifestPath,
  getLegacyManifestPath,
  getManifestPath,
  writeManifest,
} from "@/cli/features/manifest.js";
import { saveTestingConfig } from "@/cli/test-utils/config.js";

// Mock os.homedir so config paths resolve to temp directory
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

// Mock @clack/prompts for output capture
vi.mock("@clack/prompts", () => ({
  log: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    step: vi.fn(),
    message: vi.fn(),
  },
  outro: vi.fn(),
}));

// Mock logger
vi.mock("@/cli/logger.js", () => ({
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  newline: vi.fn(),
  raw: vi.fn(),
}));

import { clearMain } from "./clear.js";

const pathExists = async (filePath: string): Promise<boolean> => {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
};

const readFileOrNull = async (filePath: string): Promise<string | null> => {
  return fs.readFile(filePath, "utf-8").catch(() => null);
};

const SKILLSET_NAME = "demo/high-autonomy";
const managedInstructions = (skillsetName = SKILLSET_NAME) =>
  [
    "# User notes",
    "# BEGIN NORI-AI MANAGED BLOCK",
    skillsetName,
    "# END NORI-AI MANAGED BLOCK",
  ].join("\n");

type SeededInstallation = {
  instructionsPath: string;
  markerPath: string;
  skillPath: string;
  manifestPath: string;
};

const seedAgentInstallation = async (args: {
  agentName?: string | null;
  installDir: string;
  skillsetName: string;
}): Promise<SeededInstallation> => {
  const agentName = args.agentName ?? "claude-code";
  const agent = AgentRegistry.getInstance().get({ name: agentName });
  const agentDir = agent.getAgentDir({ installDir: args.installDir });
  const instructionsPath = agent.getInstructionsFilePath({
    installDir: args.installDir,
  });
  const markerPath = path.join(agentDir, ".nori-managed");
  const skillPath = path.join(agentDir, "skills", "personality", "SKILL.md");
  const manifestPath = getManifestPath({
    agentName,
    installDir: args.installDir,
  });

  await fs.mkdir(path.dirname(instructionsPath), { recursive: true });
  await fs.mkdir(path.dirname(skillPath), { recursive: true });
  await fs.writeFile(markerPath, args.skillsetName);
  await fs.writeFile(instructionsPath, managedInstructions(args.skillsetName));
  await fs.writeFile(skillPath, `# ${args.skillsetName}`);
  await writeManifest({
    manifestPath,
    manifest: {
      version: 1,
      createdAt: new Date().toISOString(),
      skillsetName: args.skillsetName,
      installDir: args.installDir,
      files: {
        "skills/personality/SKILL.md": "skill-hash",
      },
    },
  });

  return { instructionsPath, markerPath, skillPath, manifestPath };
};

const installationState = async (installation: SeededInstallation) => ({
  instructions: await readFileOrNull(installation.instructionsPath),
  marker: await pathExists(installation.markerPath),
  skill: await pathExists(installation.skillPath),
  manifest: await pathExists(installation.manifestPath),
});

const installedState = (skillsetName = SKILLSET_NAME) => ({
  instructions: managedInstructions(skillsetName),
  marker: true,
  skill: true,
  manifest: true,
});

const clearedState = {
  instructions: "# User notes",
  marker: false,
  skill: false,
  manifest: false,
};

describe("clearMain", () => {
  let tempDir: string;

  const workspaceDir = () => path.join(tempDir, "org", "workspace");
  const seedWorkspaceAgent = (agentName = "claude-code") =>
    seedAgentInstallation({
      agentName,
      installDir: workspaceDir(),
      skillsetName: SKILLSET_NAME,
    });
  const saveExactConfig = async (defaultAgents?: Array<string>) =>
    saveTestingConfig({
      username: null,
      organizationUrl: null,
      activeSkillset: null,
      installDir: tempDir,
      ...(defaultAgents != null ? { defaultAgents } : {}),
    });
  const clearExact = async (installDir = workspaceDir()) =>
    clearMain({ installDir, exactInstallDir: true });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clear-test-"));
    vi.mocked(os.homedir).mockReturnValue(tempDir);

    const claudeDir = path.join(tempDir, ".claude");
    const noriDir = path.join(tempDir, ".nori");
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(noriDir, { recursive: true });

    AgentRegistry.resetInstance();
    vi.clearAllMocks();
    vi.mocked(os.homedir).mockReturnValue(tempDir);
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
    AgentRegistry.resetInstance();
  });

  it("should remove managed files and clear activeSkillset from config", async () => {
    // Set up config with an active skillset
    await saveTestingConfig({
      username: "user@example.com",
      refreshToken: "mock-token",
      organizationUrl: "https://noriskillsets.dev",
      activeSkillset: "senior-swe",
      installDir: tempDir,
    });

    // Create the .nori-managed marker file
    await fs.writeFile(
      path.join(tempDir, ".claude", ".nori-managed"),
      "senior-swe",
    );

    // Create a managed file (CLAUDE.md)
    await fs.writeFile(
      path.join(tempDir, ".claude", "CLAUDE.md"),
      "# BEGIN NORI-AI MANAGED BLOCK\ntest\n# END NORI-AI MANAGED BLOCK",
    );

    // Write a manifest so removeSkillset knows what to remove
    const manifestDir = path.join(tempDir, ".nori", "manifests");
    await fs.mkdir(manifestDir, { recursive: true });
    await fs.writeFile(
      path.join(manifestDir, "claude-code.json"),
      JSON.stringify({
        skillsetName: "senior-swe",
        files: {
          "CLAUDE.md": "somehash",
        },
      }),
    );

    await clearMain({ installDir: tempDir });

    // Verify activeSkillset was cleared
    const config = await loadConfig();
    expect(config?.activeSkillset).toBeUndefined();

    // Verify auth was preserved
    expect(config?.auth?.username).toBe("user@example.com");
  });

  it("should handle case when no config exists", async () => {
    const { log } = await import("@clack/prompts");

    await clearMain({ installDir: tempDir });

    // Should log that there's nothing to clear
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining("No Nori configuration found"),
    );
  });

  it("should restore home-level settings.json from backup when installDir differs from home", async () => {
    // Create a separate installDir that is different from home (tempDir)
    const installDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "clear-install-"),
    );

    try {
      // Set up config with a custom installDir
      await saveTestingConfig({
        username: null,
        organizationUrl: null,
        activeSkillset: "test-skillset",
        installDir,
      });

      // Create the install-dir-level agent files
      const installClaudeDir = path.join(installDir, ".claude");
      await fs.mkdir(installClaudeDir, { recursive: true });
      await fs.writeFile(
        path.join(installClaudeDir, ".nori-managed"),
        "test-skillset",
      );
      await fs.writeFile(
        path.join(installClaudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\ntest\n# END NORI-AI MANAGED BLOCK",
      );

      // Write manifest for the install dir
      const manifestDir = path.join(tempDir, ".nori", "manifests");
      await fs.mkdir(manifestDir, { recursive: true });
      await fs.writeFile(
        path.join(manifestDir, "claude-code.json"),
        JSON.stringify({
          skillsetName: "test-skillset",
          files: {
            "CLAUDE.md": "somehash",
          },
        }),
      );

      // Simulate home-level settings.json with nori keys added
      const homeClaudeDir = path.join(tempDir, ".claude");
      await fs.mkdir(homeClaudeDir, { recursive: true });
      const homeSettings = {
        $schema: "https://json.schemastore.org/claude-code-settings.json",
        hooks: { SessionStart: [{ matcher: "", hooks: [] }] },
        statusLine: { type: "command", command: "test", padding: 0 },
        companyAnnouncements: ["test"],
        includeCoAuthoredBy: false,
        userSetting: "preserved",
      };
      await fs.writeFile(
        path.join(homeClaudeDir, "settings.json"),
        JSON.stringify(homeSettings, null, 2),
      );

      // Simulate the backup that would have been created during install
      const originalSettings = {
        $schema: "https://json.schemastore.org/claude-code-settings.json",
        userSetting: "preserved",
      };
      await fs.writeFile(
        path.join(homeClaudeDir, "settings.json.pre-nori"),
        JSON.stringify(originalSettings, null, 2),
      );

      // Create nori-statusline.sh at home level
      await fs.writeFile(
        path.join(homeClaudeDir, "nori-statusline.sh"),
        "#!/bin/bash\necho test",
      );

      await clearMain({ installDir });

      // Verify home-level settings.json was restored from backup
      const content = await fs.readFile(
        path.join(homeClaudeDir, "settings.json"),
        "utf-8",
      );
      const settings = JSON.parse(content);
      expect(settings.hooks).toBeUndefined();
      expect(settings.statusLine).toBeUndefined();
      expect(settings.companyAnnouncements).toBeUndefined();
      expect(settings.includeCoAuthoredBy).toBeUndefined();
      expect(settings.userSetting).toBe("preserved");

      // Verify backup was cleaned up
      const backupExists = await fs
        .access(path.join(homeClaudeDir, "settings.json.pre-nori"))
        .then(() => true)
        .catch(() => false);
      expect(backupExists).toBe(false);

      // Verify nori-statusline.sh was deleted
      const statuslineExists = await fs
        .access(path.join(homeClaudeDir, "nori-statusline.sh"))
        .then(() => true)
        .catch(() => false);
      expect(statuslineExists).toBe(false);
    } finally {
      await fs.rm(installDir, { recursive: true, force: true });
    }
  });

  it("clears only the exact install directory without changing global or neighboring installations", async () => {
    const siblingDir = path.join(tempDir, "org", "sibling");
    const parent = await seedAgentInstallation({
      installDir: tempDir,
      skillsetName: "public/sessions-platform",
    });
    const workspace = await seedAgentInstallation({
      installDir: workspaceDir(),
      skillsetName: SKILLSET_NAME,
    });
    const sibling = await seedAgentInstallation({
      installDir: siblingDir,
      skillsetName: "demo/other",
    });
    await saveTestingConfig({
      username: "user@example.com",
      organizationUrl: "https://demo.noriskillsets.dev",
      activeSkillset: "demo/global-default",
      installDir: tempDir,
    });

    await clearMain({
      installDir: workspaceDir(),
      exactInstallDir: true,
    });

    expect(await installationState(workspace)).toEqual(clearedState);
    expect(await installationState(parent)).toEqual(
      installedState("public/sessions-platform"),
    );
    expect(await installationState(sibling)).toEqual(
      installedState("demo/other"),
    );
    expect((await loadConfig())?.activeSkillset).toBe("demo/global-default");
  });

  it("works with a null global skillset while leaving legacy manifests and home-level Claude settings untouched", async () => {
    await seedWorkspaceAgent();
    await saveTestingConfig({
      username: null,
      organizationUrl: null,
      activeSkillset: null,
      installDir: tempDir,
    });

    const legacyAgentManifest = getLegacyAgentManifestPath({
      agentName: "claude-code",
    });
    const legacyManifest = getLegacyManifestPath();
    for (const manifestPath of [legacyAgentManifest, legacyManifest]) {
      await writeManifest({
        manifestPath,
        manifest: {
          version: 1,
          createdAt: new Date().toISOString(),
          skillsetName: "legacy-global",
          files: {},
        },
      });
    }

    const homeSettingsPath = path.join(tempDir, ".claude", "settings.json");
    const homeSettingsBackupPath = `${homeSettingsPath}.pre-nori`;
    const statuslinePath = path.join(tempDir, ".claude", "nori-statusline.sh");
    const currentSettings = JSON.stringify({ source: "current" });
    const backupSettings = JSON.stringify({ source: "backup" });
    await fs.writeFile(homeSettingsPath, currentSettings);
    await fs.writeFile(homeSettingsBackupPath, backupSettings);
    await fs.writeFile(statuslinePath, "#!/bin/sh\nexit 0\n");

    await clearMain({
      installDir: workspaceDir(),
      exactInstallDir: true,
    });

    expect({
      activeSkillset: (await loadConfig())?.activeSkillset ?? null,
      legacyAgentManifest: await pathExists(legacyAgentManifest),
      legacyManifest: await pathExists(legacyManifest),
      homeSettings: await readFileOrNull(homeSettingsPath),
      homeSettingsBackup: await readFileOrNull(homeSettingsBackupPath),
      statusline: await pathExists(statuslinePath),
    }).toEqual({
      activeSkillset: null,
      legacyAgentManifest: true,
      legacyManifest: true,
      homeSettings: currentSettings,
      homeSettingsBackup: backupSettings,
      statusline: true,
    });
  });

  it("rejects exact-install-dir mode without an explicit install directory before mutation", async () => {
    const homeInstallation = await seedAgentInstallation({
      installDir: tempDir,
      skillsetName: "demo/global-default",
    });
    await saveTestingConfig({
      username: null,
      organizationUrl: null,
      activeSkillset: "demo/global-default",
      installDir: tempDir,
    });

    await expect(clearMain({ exactInstallDir: true })).rejects.toThrow();
    expect(await installationState(homeInstallation)).toEqual(
      installedState("demo/global-default"),
    );
    expect((await loadConfig())?.activeSkillset).toBe("demo/global-default");
  });

  it.each(["missing", "corrupt"])(
    "fails closed before mutation when the exact manifest is %s",
    async (manifestState) => {
      const installation = await seedWorkspaceAgent();
      await saveExactConfig();
      if (manifestState === "missing") {
        await fs.rm(installation.manifestPath);
      } else {
        await fs.writeFile(installation.manifestPath, "not json");
      }

      await expect(clearExact()).rejects.toThrow();
      expect(await installationState(installation)).toEqual({
        ...installedState(),
        manifest: manifestState === "corrupt",
      });
    },
  );

  it("discovers every installed agent in exact mode when global config is missing", async () => {
    const installations = await Promise.all(
      ["claude-code", "codex", "gemini-cli"].map(seedWorkspaceAgent),
    );

    await clearExact();

    for (const installation of installations) {
      expect(await installationState(installation)).toEqual(clearedState);
    }
  });

  it("preflights every configured agent before mutating any exact installation", async () => {
    const [claude, codex] = await Promise.all([
      seedWorkspaceAgent(),
      seedWorkspaceAgent("codex"),
    ]);
    await fs.rm(codex.manifestPath);
    await saveExactConfig(["claude-code", "codex"]);

    await expect(clearExact()).rejects.toThrow();
    expect(await installationState(claude)).toEqual(installedState());
    expect(await installationState(codex)).toEqual({
      ...installedState(),
      manifest: false,
    });
  });

  it("rejects an exact manifest path that escapes the agent directory", async () => {
    const installation = await seedWorkspaceAgent();
    const agent = AgentRegistry.getInstance().get({ name: "claude-code" });
    const agentDir = agent.getAgentDir({ installDir: workspaceDir() });
    const outsidePath = path.join(tempDir, "outside.txt");
    await fs.writeFile(outsidePath, "keep me");
    await writeManifest({
      manifestPath: installation.manifestPath,
      manifest: {
        version: 1,
        createdAt: new Date().toISOString(),
        skillsetName: SKILLSET_NAME,
        installDir: workspaceDir(),
        files: {
          [path.relative(agentDir, outsidePath)]: "outside-hash",
          "skills/personality/SKILL.md": "skill-hash",
        },
      },
    });
    await saveExactConfig();

    await expect(clearExact()).rejects.toThrow();
    expect(await readFileOrNull(outsidePath)).toBe("keep me");
    expect(await installationState(installation)).toEqual(installedState());
  });

  it("rejects an exact manifest path whose parent is a symlink outside the agent directory", async () => {
    const installation = await seedWorkspaceAgent();
    const outsideDir = path.join(tempDir, "outside-personality");
    const outsideSkillPath = path.join(outsideDir, "SKILL.md");
    await fs.mkdir(outsideDir);
    await fs.writeFile(outsideSkillPath, "keep me");
    await fs.rm(path.dirname(installation.skillPath), {
      recursive: true,
      force: true,
    });
    await fs.symlink(outsideDir, path.dirname(installation.skillPath), "dir");
    await saveExactConfig();

    await expect(clearExact()).rejects.toThrow();
    expect(await readFileOrNull(outsideSkillPath)).toBe("keep me");
    expect(await installationState(installation)).toEqual(installedState());
  });

  it("fails exact preflight on an unreadable instructions path before mutation", async () => {
    const installation = await seedWorkspaceAgent();
    await fs.rm(installation.instructionsPath);
    await fs.mkdir(installation.instructionsPath);
    await saveExactConfig();

    await expect(clearExact()).rejects.toThrow();
    expect((await fs.stat(installation.instructionsPath)).isDirectory()).toBe(
      true,
    );
    expect(await installationState(installation)).toEqual({
      ...installedState(),
      instructions: null,
    });
  });

  it("allows a missing instructions file during exact preflight", async () => {
    const installation = await seedWorkspaceAgent();
    await fs.rm(installation.instructionsPath);
    await saveExactConfig();

    await clearExact();

    expect(await installationState(installation)).toEqual({
      ...clearedState,
      instructions: null,
    });
  });

  it("routes the CLI exact-clear flag and global install directory to the filesystem behavior", async () => {
    const installation = await seedWorkspaceAgent();
    await saveExactConfig();
    const program = new Command()
      .exitOverride()
      .option("-d, --install-dir <path>");
    registerNoriSkillsetsClearCommand({ program });

    await program.parseAsync([
      "node",
      "sks",
      "--install-dir",
      workspaceDir(),
      "clear",
      "--exact-install-dir",
    ]);

    expect(await installationState(installation)).toEqual(clearedState);
    expect((await loadConfig())?.activeSkillset ?? null).toBe(null);
  });
});
