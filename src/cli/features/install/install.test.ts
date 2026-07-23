import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";

import * as clack from "@clack/prompts";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { getConfigPath } from "@/cli/config.js";
import { installSkillset } from "@/cli/features/agentOperations.js";
import { saveTestingConfig } from "@/cli/test-utils/config.js";
import { getHomeDir } from "@/utils/home.js";

import type * as versionModule from "@/cli/version.js";

import { noninteractive } from "./install.js";
import { withInstallLock } from "./installLock.js";

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
vi.mock("@/cli/features/install/asciiArt.js", () => ({
  displayWelcomeBanner: vi.fn(),
  displaySeaweedBed: vi.fn(),
}));

// Mock manifest writing
vi.mock("@/cli/features/manifest.js", () => ({
  computeDirectoryManifest: vi.fn().mockResolvedValue({}),
  writeManifest: vi.fn().mockResolvedValue(undefined),
  getManifestPath: vi.fn().mockReturnValue("/mock/manifest.json"),
  getLegacyManifestPath: vi.fn().mockReturnValue("/mock/legacy-manifest.json"),
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
    await saveTestingConfig({
      username: null,
      organizationUrl: null,
      activeSkillset: null,
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
    await saveTestingConfig({
      username: null,
      organizationUrl: null,
      activeSkillset: null,
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
    await saveTestingConfig({
      username: null,
      organizationUrl: null,
      activeSkillset: "amol",
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
    await saveTestingConfig({
      username: "test@example.com",
      organizationUrl: "https://myorg.tilework.tech",
      refreshToken: "test-refresh-token",
      activeSkillset: "senior-swe",
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
    await saveTestingConfig({
      username: "test@example.com",
      organizationUrl: "https://myorg.tilework.tech",
      refreshToken: "test-refresh-token",
      organizations: ["org-alpha", "org-beta"],
      isAdmin: true,
      activeSkillset: "senior-swe",
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
    await saveTestingConfig({
      username: null,
      organizationUrl: null,
      activeSkillset: "senior-swe",
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

  it("should not overwrite global activeSkillset for a transient install (persistActiveSkillset: false)", async () => {
    // A per-worktree switch drives install with an explicit --install-dir override.
    // That install is transient and must not clobber the user's global active skillset.
    await saveTestingConfig({
      username: null,
      organizationUrl: null,
      activeSkillset: "senior-swe",
      installDir: tempDir,
    });

    // Install a DIFFERENT skillset transiently (as a --install-dir switch does).
    await noninteractive({
      installDir: tempDir,
      skillset: "amol",
      persistActiveSkillset: false,
    });

    const configPath = getConfigPath();
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config.activeSkillset).toBe("senior-swe");
  });

  it("removes the progress marker when activation fails", async () => {
    await saveTestingConfig({
      username: null,
      organizationUrl: null,
      activeSkillset: "senior-swe",
      installDir: tempDir,
    });
    vi.mocked(installSkillset).mockRejectedValueOnce(
      new Error("loader failed"),
    );

    await expect(
      noninteractive({
        installDir: tempDir,
        skillset: "senior-swe",
      }),
    ).rejects.toThrow("loader failed");

    await expect(
      fsPromises.access(path.join(getHomeDir(), ".nori-install-in-progress")),
    ).rejects.toThrow();
  });

  it("rejects an overlapping install without disturbing the active install", async () => {
    await saveTestingConfig({
      username: null,
      organizationUrl: null,
      activeSkillset: "senior-swe",
      installDir: tempDir,
    });
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const firstStartedPromise = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    vi.mocked(installSkillset).mockImplementationOnce(async () => {
      firstStarted();
      await firstCanFinish;
    });
    const originalConsoleLog = console.log;
    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;

    const first = noninteractive({
      installDir: tempDir,
      skillset: "senior-swe",
      silent: true,
    });
    await firstStartedPromise;

    try {
      const secondError = await noninteractive({
        installDir: path.join(tempDir, "other-install-dir"),
        skillset: "amol",
        silent: true,
      }).then(
        () => null,
        (error: unknown) => error,
      );

      expect(secondError).toBeInstanceOf(Error);
      expect((secondError as Error).message).toMatch(
        /another Nori installation is already in progress/i,
      );
      expect(installSkillset).toHaveBeenCalledTimes(1);
      const config = JSON.parse(fs.readFileSync(getConfigPath(), "utf8")) as {
        activeSkillset?: string;
      };
      expect(config.activeSkillset).toBe("senior-swe");
      await expect(
        fsPromises.access(path.join(getHomeDir(), ".nori-install-in-progress")),
      ).resolves.toBeUndefined();
    } finally {
      releaseFirst();
      await first;
    }

    expect(console.log).toBe(originalConsoleLog);
    expect(process.stdout.write).toBe(originalStdoutWrite);
    expect(process.stderr.write).toBe(originalStderrWrite);
    await expect(
      fsPromises.access(path.join(getHomeDir(), ".nori-install-in-progress")),
    ).rejects.toThrow();
  });

  it("recovers an installation lock owned by a terminated process", async () => {
    await saveTestingConfig({
      username: null,
      organizationUrl: null,
      activeSkillset: "senior-swe",
      installDir: tempDir,
    });
    const lockPath = path.join(getHomeDir(), ".nori-install.lock");
    await fsPromises.mkdir(lockPath);
    await fsPromises.writeFile(
      path.join(lockPath, "owner.json"),
      JSON.stringify({
        pid: 2_147_483_647,
        createdAt: "2000-01-01T00:00:00.000Z",
      }),
    );

    try {
      await noninteractive({
        installDir: tempDir,
        skillset: "senior-swe",
      });

      expect(installSkillset).toHaveBeenCalledTimes(1);
      await expect(fsPromises.access(lockPath)).rejects.toThrow();
    } finally {
      await fsPromises.rm(lockPath, { recursive: true, force: true });
    }
  });

  it("allows a nested installation operation to reuse its active lock", async () => {
    let nestedOperationCompleted = false;

    await withInstallLock({
      operation: async () => {
        await withInstallLock({
          operation: async () => {
            nestedOperationCompleted = true;
          },
        });
      },
    });

    expect(nestedOperationCompleted).toBe(true);
  });

  it("does not let an expired predecessor remove its replacement lock", async () => {
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let releaseSecond!: () => void;
    let markSecondStarted!: () => void;
    const secondStarted = new Promise<void>((resolve) => {
      markSecondStarted = resolve;
    });
    const secondCanFinish = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const lockPath = path.join(getHomeDir(), ".nori-install.lock");

    const first = withInstallLock({
      operation: async () => {
        markFirstStarted();
        await firstCanFinish;
      },
    });
    await firstStarted;
    const [ownerMarker] = (await fsPromises.readdir(lockPath)).filter((name) =>
      name.startsWith("owner-"),
    );
    expect(ownerMarker).toBeDefined();
    const expiredAt = new Date("2000-01-01T00:00:00.000Z");
    await fsPromises.utimes(
      path.join(lockPath, ownerMarker),
      expiredAt,
      expiredAt,
    );

    const second = withInstallLock({
      operation: async () => {
        markSecondStarted();
        await secondCanFinish;
      },
    });
    await secondStarted;

    try {
      releaseFirst();
      await first;
      await expect(
        withInstallLock({ operation: async () => undefined }),
      ).rejects.toThrow(/another Nori installation is already in progress/i);
    } finally {
      releaseFirst();
      releaseSecond();
      await Promise.allSettled([first, second]);
      await fsPromises.rm(lockPath, { recursive: true, force: true });
    }
  });

  it("recovers an expired installation lock even when its PID has been reused", async () => {
    await saveTestingConfig({
      username: null,
      organizationUrl: null,
      activeSkillset: "senior-swe",
      installDir: tempDir,
    });
    const lockPath = path.join(getHomeDir(), ".nori-install.lock");
    await fsPromises.mkdir(lockPath);
    await fsPromises.writeFile(
      path.join(lockPath, "owner.json"),
      JSON.stringify({
        pid: process.pid,
        createdAt: "2000-01-01T00:00:00.000Z",
      }),
    );

    try {
      await noninteractive({
        installDir: tempDir,
        skillset: "senior-swe",
      });

      expect(installSkillset).toHaveBeenCalledTimes(1);
      await expect(fsPromises.access(lockPath)).rejects.toThrow();
    } finally {
      await fsPromises.rm(lockPath, { recursive: true, force: true });
    }
  });

  it("releases the installation lock after failure so a retry can succeed", async () => {
    await saveTestingConfig({
      username: null,
      organizationUrl: null,
      activeSkillset: "senior-swe",
      installDir: tempDir,
    });
    vi.mocked(installSkillset).mockRejectedValueOnce(
      new Error("loader failed"),
    );
    const lockPath = path.join(getHomeDir(), ".nori-install.lock");

    await expect(
      noninteractive({
        installDir: tempDir,
        skillset: "senior-swe",
      }),
    ).rejects.toThrow("loader failed");
    await expect(fsPromises.access(lockPath)).rejects.toThrow();

    await noninteractive({
      installDir: tempDir,
      skillset: "senior-swe",
    });

    expect(installSkillset).toHaveBeenCalledTimes(2);
    await expect(fsPromises.access(lockPath)).rejects.toThrow();
  });
});
