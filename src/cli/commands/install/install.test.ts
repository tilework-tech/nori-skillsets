import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";

import * as clack from "@clack/prompts";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { getConfigPath, saveConfig } from "@/cli/config.js";

import type * as versionModule from "@/cli/version.js";

import { noninteractive } from "./install.js";

// Mock paths module to use test directory
vi.mock("@/cli/features/claude-code/paths.js", () => {
  const testClaudeDir = "/tmp/install-test-claude";
  return {
    getClaudeDir: (_args: { installDir: string }) => testClaudeDir,
    getClaudeSettingsFile: (_args: { installDir: string }) =>
      `${testClaudeDir}/settings.json`,
    getClaudeHomeDir: () => testClaudeDir,
    getClaudeHomeSettingsFile: () => `${testClaudeDir}/settings.json`,
    getClaudeHomeCommandsDir: () => `${testClaudeDir}/commands`,
    getClaudeAgentsDir: (_args: { installDir: string }) =>
      `${testClaudeDir}/agents`,
    getClaudeCommandsDir: (_args: { installDir: string }) =>
      `${testClaudeDir}/commands`,
    getClaudeMdFile: (_args: { installDir: string }) =>
      `${testClaudeDir}/CLAUDE.md`,
    getClaudeSkillsDir: (_args: { installDir: string }) =>
      `${testClaudeDir}/skills`,
    getClaudeSkillsetsDir: (_args: { installDir: string }) =>
      `${testClaudeDir}/profiles`,
  };
});

// Mock getCurrentPackageVersion to return a controlled version for tests
vi.mock("@/cli/version.js", async (importOriginal) => {
  const actual = await importOriginal<typeof versionModule>();
  return {
    ...actual,
    getCurrentPackageVersion: vi.fn().mockReturnValue("20.0.0"),
  };
});

// Mock analytics to prevent tracking during tests
vi.mock("@/cli/analytics.js", () => ({
  initializeAnalytics: vi.fn(),
  trackEvent: vi.fn(),
}));

// Mock install tracking to prevent analytics during tests
vi.mock("@/cli/installTracking.js", () => ({
  buildCLIEventParams: vi.fn().mockResolvedValue({}),
  getUserId: vi.fn().mockResolvedValue(null),
  sendAnalyticsEvent: vi.fn(),
}));

// Mock init to avoid side effects
vi.mock("@/cli/commands/init/init.js", () => ({
  initMain: vi.fn().mockResolvedValue(undefined),
}));

// Mock ASCII art banners
vi.mock("@/cli/commands/install/asciiArt.js", () => ({
  displayWelcomeBanner: vi.fn(),
  displaySeaweedBed: vi.fn(),
}));

// Mock manifest writing
vi.mock("@/cli/features/manifest.js", () => ({
  computeDirectoryManifest: vi.fn().mockResolvedValue({}),
  writeManifest: vi.fn().mockResolvedValue(undefined),
  getManifestPath: vi.fn().mockReturnValue("/mock/manifest.json"),
}));

// Mock agentOperations - shared functions that replaced agent methods
vi.mock("@/cli/features/agentOperations.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    installSkillset: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock @clack/prompts for UI output assertions
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
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: "",
  })),
  confirm: vi.fn(),
  text: vi.fn(),
  select: vi.fn(),
  isCancel: vi.fn(),
}));

// Mock logger - non-UI utilities plus UI functions still used by transitive
// dependencies (feature loaders) that haven't been migrated yet
vi.mock("@/cli/logger.js", () => ({
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  newline: vi.fn(),
  raw: vi.fn(),
  setSilentMode: vi.fn(),
  isSilentMode: vi.fn(),
  debug: vi.fn(),
  brightCyan: vi.fn(({ text }: { text: string }) => text),
  boldWhite: vi.fn(({ text }: { text: string }) => text),
  gray: vi.fn(({ text }: { text: string }) => text),
  wrapText: vi.fn(({ text }: { text: string }) => text),
}));

describe("install noninteractive", () => {
  let tempDir: string;
  let originalCwd: () => string;

  const TEST_CLAUDE_DIR = "/tmp/install-test-claude";
  const TEST_NORI_DIR = "/tmp/install-test-nori";

  beforeEach(async () => {
    tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "install-test-"));

    originalCwd = process.cwd;
    process.cwd = () => tempDir;

    // Clean up test directories
    try {
      fs.rmSync(TEST_CLAUDE_DIR, { recursive: true, force: true });
    } catch {}
    try {
      fs.rmSync(TEST_NORI_DIR, { recursive: true, force: true });
    } catch {}

    // Create fresh test directories
    fs.mkdirSync(TEST_CLAUDE_DIR, { recursive: true });
    fs.mkdirSync(TEST_NORI_DIR, { recursive: true });
    fs.mkdirSync(path.join(TEST_NORI_DIR, "profiles"), { recursive: true });

    // Create stub profiles
    for (const skillsetName of ["senior-swe", "amol", "product-manager"]) {
      const skillsetDir = path.join(TEST_NORI_DIR, "profiles", skillsetName);
      fs.mkdirSync(skillsetDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillsetDir, "AGENTS.md"),
        `# ${skillsetName}\n`,
      );
      fs.writeFileSync(
        path.join(skillsetDir, "nori.json"),
        JSON.stringify({ name: skillsetName, version: "1.0.0" }),
      );
    }

    vi.clearAllMocks();
  });

  afterEach(async () => {
    process.cwd = originalCwd;

    try {
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    } catch {}
    try {
      fs.rmSync(TEST_CLAUDE_DIR, { recursive: true, force: true });
    } catch {}
    try {
      fs.rmSync(TEST_NORI_DIR, { recursive: true, force: true });
    } catch {}
  });

  it("should save skillset from --skillset flag to config", async () => {
    // Create minimal config (as if init was run)
    await saveConfig({
      username: null,
      organizationUrl: null,
      activeSkillset: null,
      version: "20.0.0",
      installDir: tempDir,
    });

    await noninteractive({
      installDir: tempDir,
      skillset: "senior-swe",
    });

    const configPath = getConfigPath();
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config.activeSkillset).toBe("senior-swe");
  });

  it("should exit with error when no skillset provided and no existing skillset", async () => {
    // Create minimal config without a skillset
    await saveConfig({
      username: null,
      organizationUrl: null,
      activeSkillset: null,
      version: "20.0.0",
      installDir: tempDir,
    });

    const processExitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((code?: string | number | null) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

    try {
      await expect(
        noninteractive({
          installDir: tempDir,
        }),
      ).rejects.toThrow("process.exit(1)");

      // Error messages should go through @clack/prompts, not legacy logger
      expect(clack.log.error).toHaveBeenCalledWith(
        expect.stringContaining("requires a skillset"),
      );
      // Error message should NOT reference non-existent --skillset CLI flag
      expect(clack.log.error).not.toHaveBeenCalledWith(
        expect.stringContaining("--skillset"),
      );
      // Usage example should show correct CLI syntax
      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("nori-skillsets install"),
        expect.any(String),
      );
      // Usage example should NOT reference non-existent --skillset flag
      expect(clack.note).not.toHaveBeenCalledWith(
        expect.stringContaining("--skillset"),
        expect.any(String),
      );
    } finally {
      processExitSpy.mockRestore();
    }
  });

  it("should preserve existing skillset when no --skillset flag is provided", async () => {
    // Create config with an existing skillset
    await saveConfig({
      username: null,
      organizationUrl: null,
      activeSkillset: "amol",
      version: "20.0.0",
      installDir: tempDir,
    });

    await noninteractive({
      installDir: tempDir,
    });

    const configPath = getConfigPath();
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config.activeSkillset).toBe("amol");
  });

  it("should preserve existing auth credentials through install", async () => {
    // Create config with auth credentials
    await saveConfig({
      username: "test@example.com",
      organizationUrl: "https://myorg.tilework.tech",
      refreshToken: "test-refresh-token",
      activeSkillset: "senior-swe",
      version: "20.0.0",
      installDir: tempDir,
    });

    await noninteractive({
      installDir: tempDir,
      skillset: "senior-swe",
    });

    const configPath = getConfigPath();
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config.auth.username).toBe("test@example.com");
    expect(config.auth.organizationUrl).toBe("https://myorg.tilework.tech");
    expect(config.auth.refreshToken).toBe("test-refresh-token");
  });

  it("should preserve organizations, isAdmin, and transcriptDestination through install", async () => {
    // Create config with organizations, isAdmin, and transcriptDestination
    await saveConfig({
      username: "test@example.com",
      organizationUrl: "https://myorg.tilework.tech",
      refreshToken: "test-refresh-token",
      organizations: ["org-alpha", "org-beta"],
      isAdmin: true,
      activeSkillset: "senior-swe",
      version: "20.0.0",
      transcriptDestination: "myorg",
      installDir: tempDir,
    });

    await noninteractive({
      installDir: tempDir,
      skillset: "senior-swe",
    });

    const configPath = getConfigPath();
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config.auth.organizations).toEqual(["org-alpha", "org-beta"]);
    expect(config.auth.isAdmin).toBe(true);
    expect(config.transcriptDestination).toBe("myorg");
  });

  it("should not overwrite config installDir when called with a different installDir", async () => {
    const originalInstallDir = "/original/install/path";

    // Create config with a specific installDir
    await saveConfig({
      username: null,
      organizationUrl: null,
      activeSkillset: "senior-swe",
      version: "20.0.0",
      installDir: originalInstallDir,
    });

    // Call noninteractive with a DIFFERENT installDir (simulating --install-dir override)
    await noninteractive({
      installDir: tempDir,
      skillset: "senior-swe",
    });

    // The config's installDir should remain unchanged
    const configPath = getConfigPath();
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config.installDir).toBe(originalInstallDir);
  });

  it("should pass skipManifest to installSkillset when provided", async () => {
    const { installSkillset } =
      await import("@/cli/features/agentOperations.js");

    await saveConfig({
      username: null,
      organizationUrl: null,
      activeSkillset: "senior-swe",
      version: "20.0.0",
      installDir: tempDir,
    });

    await noninteractive({
      installDir: tempDir,
      skillset: "senior-swe",
      skipManifest: true,
    });

    expect(vi.mocked(installSkillset)).toHaveBeenCalledWith(
      expect.objectContaining({
        skipManifest: true,
      }),
    );
  });

  it("should NOT pass skipManifest to installSkillset when not provided", async () => {
    const { installSkillset } =
      await import("@/cli/features/agentOperations.js");

    await saveConfig({
      username: null,
      organizationUrl: null,
      activeSkillset: "senior-swe",
      version: "20.0.0",
      installDir: tempDir,
    });

    await noninteractive({
      installDir: tempDir,
      skillset: "senior-swe",
    });

    expect(vi.mocked(installSkillset)).toHaveBeenCalledWith(
      expect.not.objectContaining({
        skipManifest: true,
      }),
    );
  });
});
