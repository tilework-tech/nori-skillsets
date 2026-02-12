import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { getConfigPath, saveConfig } from "@/cli/config.js";

import type * as versionModule from "@/cli/version.js";

import { noninteractive } from "./install.js";

// Mock paths module to use test directory
vi.mock("@/cli/features/claude-code/paths.js", () => {
  const testClaudeDir = "/tmp/install-test-claude";
  const testNoriDir = "/tmp/install-test-nori";
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
    getClaudeProfilesDir: (_args: { installDir: string }) =>
      `${testClaudeDir}/profiles`,
    getNoriDir: () => testNoriDir,
    getNoriProfilesDir: () => `${testNoriDir}/profiles`,
    getNoriConfigFile: () => `${testNoriDir}/config.json`,
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
vi.mock("@/cli/features/claude-code/profiles/manifest.js", () => ({
  computeDirectoryManifest: vi.fn().mockResolvedValue({}),
  writeManifest: vi.fn().mockResolvedValue(undefined),
  getManifestPath: vi.fn().mockReturnValue("/mock/manifest.json"),
}));

// Mock installProfile pipeline to avoid file system side effects
vi.mock("@/cli/features/pipeline/installProfile.js", () => ({
  installProfile: vi.fn().mockResolvedValue(undefined),
}));

// Mock logger to suppress output
vi.mock("@/cli/logger.js", () => ({
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  newline: vi.fn(),
  raw: vi.fn(),
  setSilentMode: vi.fn(),
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
    for (const profileName of ["senior-swe", "amol", "product-manager"]) {
      const profileDir = path.join(TEST_NORI_DIR, "profiles", profileName);
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(
        path.join(profileDir, "CLAUDE.md"),
        `# ${profileName}\n`,
      );
      fs.writeFileSync(
        path.join(profileDir, "nori.json"),
        JSON.stringify({ name: profileName, version: "1.0.0" }),
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

  it("should save profile from --profile flag to config", async () => {
    // Create minimal config (as if init was run)
    await saveConfig({
      username: null,
      organizationUrl: null,
      agents: {},
      version: "20.0.0",
      installDir: tempDir,
    });

    await noninteractive({
      installDir: tempDir,
      profile: "senior-swe",
    });

    const configPath = getConfigPath();
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config.agents["claude-code"].profile).toEqual({
      baseProfile: "senior-swe",
    });
  });

  it("should exit with error when no --profile flag and no existing profile", async () => {
    // Create minimal config without a profile
    await saveConfig({
      username: null,
      organizationUrl: null,
      agents: {},
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
    } finally {
      processExitSpy.mockRestore();
    }
  });

  it("should preserve existing profile when no --profile flag is provided", async () => {
    // Create config with an existing profile
    await saveConfig({
      username: null,
      organizationUrl: null,
      agents: { "claude-code": { profile: { baseProfile: "amol" } } },
      version: "20.0.0",
      installDir: tempDir,
    });

    await noninteractive({
      installDir: tempDir,
    });

    const configPath = getConfigPath();
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config.agents["claude-code"].profile).toEqual({
      baseProfile: "amol",
    });
  });

  it("should preserve existing auth credentials through install", async () => {
    // Create config with auth credentials
    await saveConfig({
      username: "test@example.com",
      organizationUrl: "https://myorg.tilework.tech",
      refreshToken: "test-refresh-token",
      agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
      version: "20.0.0",
      installDir: tempDir,
    });

    await noninteractive({
      installDir: tempDir,
      profile: "senior-swe",
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
      agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
      version: "20.0.0",
      transcriptDestination: "myorg",
      installDir: tempDir,
    });

    await noninteractive({
      installDir: tempDir,
      profile: "senior-swe",
    });

    const configPath = getConfigPath();
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config.auth.organizations).toEqual(["org-alpha", "org-beta"]);
    expect(config.auth.isAdmin).toBe(true);
    expect(config.transcriptDestination).toBe("myorg");
  });
});
