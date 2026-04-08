/**
 * Tests for registry-upload CLI command
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import * as clack from "@clack/prompts";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Track the mock homedir value - will be set in beforeEach
let mockHomedir = "";

// Mock the os module to control homedir() return value
vi.mock("node:os", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = (await importOriginal()) as typeof import("os");
  return {
    ...actual,
    homedir: () => mockHomedir,
  };
});

// Mock the registrar API
vi.mock("@/api/registrar.js", () => ({
  REGISTRAR_URL: "https://noriskillsets.dev",
  registrarApi: {
    getPackument: vi.fn(),
    uploadSkillset: vi.fn(),
  },
  NetworkError: class NetworkError extends Error {
    readonly isNetworkError = true;
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
      this.name = "NetworkError";
    }
  },
  ApiError: class ApiError extends Error {
    readonly isApiError = true;
    constructor(
      message: string,
      readonly statusCode: number,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
}));

// Mock the config module
vi.mock("@/cli/config.js", async () => {
  return {
    loadConfig: vi.fn(),
    getRegistryAuth: vi.fn(),
  };
});

// Mock the registry auth module
vi.mock("@/api/registryAuth.js", () => ({
  getRegistryAuthToken: vi.fn(),
}));

// Mock the fetch utils for skill and subagent collision errors
vi.mock("@/utils/fetch.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    isSkillCollisionError: vi.fn((err: unknown) => {
      return err && typeof err === "object" && "conflicts" in err;
    }),
    isSubagentCollisionError: vi.fn((err: unknown) => {
      return (
        err != null &&
        typeof err === "object" &&
        (("isSubagentCollisionError" in err &&
          (err as Record<string, unknown>).isSubagentCollisionError === true) ||
          ("subagentConflicts" in err &&
            Array.isArray((err as Record<string, unknown>).subagentConflicts)))
      );
    }),
  };
});

// Create a shared spinner mock that tracks all message calls
const createSpinnerMock = () => ({
  start: vi.fn(),
  stop: vi.fn(),
  message: vi.fn(),
  cancel: vi.fn(),
  error: vi.fn(),
  clear: vi.fn(),
  isCancelled: false,
});

// Shared spinner mock instance
let sharedSpinnerMock = createSpinnerMock();

// Mock @clack/prompts for spinner and interactive prompts
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
    step: vi.fn(),
  },
  select: vi.fn(),
  text: vi.fn(),
  spinner: vi.fn(() => sharedSpinnerMock),
  isCancel: vi.fn(() => false),
}));

// Mock console methods to suppress output during tests
const _mockConsoleLog = vi
  .spyOn(console, "log")
  .mockImplementation(() => undefined);
const _mockConsoleError = vi
  .spyOn(console, "error")
  .mockImplementation(() => undefined);

import { registrarApi } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { loadConfig, getRegistryAuth } from "@/cli/config.js";
import {
  isSkillCollisionError,
  isSubagentCollisionError,
} from "@/utils/fetch.js";

import { registryUploadMain } from "./registryUpload.js";

const createManagedBlockMarker = async (dir: string): Promise<void> => {
  const claudeDir = path.join(dir, ".claude");
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.writeFile(
    path.join(claudeDir, "CLAUDE.md"),
    "# BEGIN NORI-AI MANAGED BLOCK\n# END NORI-AI MANAGED BLOCK\n",
  );
};

/**
 * Helper to get all text output from clack prompts mocks
 * Combines outro, note, intro, log calls into a searchable string
 *
 * @returns Combined output string from all clack prompt mocks
 */
const getClackOutput = (): string => {
  const introMock = vi.mocked(clack.intro);
  const outroMock = vi.mocked(clack.outro);
  const noteMock = vi.mocked(clack.note);
  const logInfoMock = vi.mocked(clack.log.info);
  const logErrorMock = vi.mocked(clack.log.error);

  const introTexts = introMock.mock.calls.map((call) => String(call[0] ?? ""));
  const outroTexts = outroMock.mock.calls.map((call) => String(call[0] ?? ""));
  const noteTexts = noteMock.mock.calls.map(
    (call) => `${call[0] ?? ""} ${call[1] ?? ""}`,
  );
  const logInfoTexts = logInfoMock.mock.calls.map((call) =>
    String(call[0] ?? ""),
  );
  const logErrorTexts = logErrorMock.mock.calls.map((call) =>
    String(call[0] ?? ""),
  );

  return [
    ...introTexts,
    ...outroTexts,
    ...noteTexts,
    ...logInfoTexts,
    ...logErrorTexts,
  ].join("\n");
};

/**
 * Helper to get spinner message calls from the shared spinner mock
 *
 * @returns Array of spinner message strings
 */
const getSpinnerMessages = (): Array<string> => {
  return sharedSpinnerMock.message.mock.calls.map((call) =>
    String(call[0] ?? ""),
  );
};

describe("registry-upload", () => {
  let testDir: string;
  let configPath: string;
  let skillsetsDir: string;

  beforeEach(async () => {
    vi.resetAllMocks();

    // Reset the shared spinner mock and re-establish the mock implementation
    sharedSpinnerMock = createSpinnerMock();
    vi.mocked(clack.spinner).mockReturnValue(sharedSpinnerMock);

    // Re-establish isSkillCollisionError mock implementation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(isSkillCollisionError) as any).mockImplementation(
      (err: unknown) => err && typeof err === "object" && "conflicts" in err,
    );

    // Re-establish isSubagentCollisionError mock implementation
    // Detects both the duck-typed flag and the subagentConflicts property
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(isSubagentCollisionError) as any).mockImplementation(
      (err: unknown) =>
        err != null &&
        typeof err === "object" &&
        (("isSubagentCollisionError" in err &&
          (err as Record<string, unknown>).isSubagentCollisionError === true) ||
          ("subagentConflicts" in err &&
            Array.isArray((err as Record<string, unknown>).subagentConflicts))),
    );

    // Create test directory structure simulating a Nori installation
    testDir = await fs.mkdtemp(
      path.join(tmpdir(), "nori-registry-upload-test-"),
    );
    configPath = path.join(testDir, ".nori-config.json");
    skillsetsDir = path.join(testDir, ".nori", "profiles");

    // Set mock homedir to testDir
    mockHomedir = testDir;

    // Create initial config with unified auth
    await fs.writeFile(
      configPath,
      JSON.stringify({
        auth: {
          username: "test@example.com",
          refreshToken: "test-refresh-token",
          organizations: ["myorg"],
          organizationUrl: "https://myorg.tilework.tech",
        },
      }),
    );

    // Create profiles directory
    await fs.mkdir(skillsetsDir, { recursive: true });

    // Create managed block marker so Nori detects this as an installation
    await createManagedBlockMarker(testDir);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  describe("registryUploadMain", () => {
    describe("profile spec parsing", () => {
      it("should reject invalid profile spec", async () => {
        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        const result = await registryUploadMain({
          profileSpec: "Invalid Profile!",
          cwd: testDir,
        });

        expect(result.success).toBe(false);

        expect(getClackOutput().toLowerCase()).toContain("invalid");
      });

      it("should parse simple profile name", async () => {
        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["public"],
            organizationUrl: "https://public.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        // Profile doesn't exist - should fail at profile existence check
        const result = await registryUploadMain({
          profileSpec: "my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(false);

        expect(getClackOutput()).toContain("not found");
      });

      it("should parse namespaced profile with version", async () => {
        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        // Profile doesn't exist - should fail at profile existence check
        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile@1.0.0",
          cwd: testDir,
        });

        expect(result.success).toBe(false);

        expect(getClackOutput()).toContain("not found");
      });
    });

    describe("installation detection", () => {
      it("should fail when config cannot be loaded", async () => {
        // loadConfig returns null when no config exists
        vi.mocked(loadConfig).mockResolvedValue(null);

        const result = await registryUploadMain({
          profileSpec: "my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(false);

        expect(getClackOutput().toLowerCase()).toContain(
          "could not load nori configuration",
        );
      });

      it("should use explicit install-dir when provided", async () => {
        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        await registryUploadMain({
          profileSpec: "myorg/my-profile",
          installDir: testDir,
          cwd: testDir,
        });

        // Should fail because profile doesn't exist, but loadConfig should have been called
        expect(loadConfig).toHaveBeenCalled();
      });
    });

    describe("authentication", () => {
      it("should require authentication for public registry uploads", async () => {
        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          // No auth configured
        });

        const result = await registryUploadMain({
          profileSpec: "my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(false);

        expect(getClackOutput().toLowerCase()).toContain("authentication");
      });

      it("should reject upload to org user does not have access to", async () => {
        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["otherorg"],
            organizationUrl: "https://otherorg.tilework.tech",
          },
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(false);

        const clackOutput = getClackOutput();
        expect(clackOutput).toContain("do not have access");
        expect(clackOutput).toContain("myorg");
      });

      it("should allow any authenticated user to upload to public registry", async () => {
        // User is authenticated but does NOT have "public" in their orgs list
        const skillsetDir = path.join(skillsetsDir, "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["someorg"],
            organizationUrl: "https://someorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);
        expect(registrarApi.uploadSkillset).toHaveBeenCalledWith(
          expect.objectContaining({
            registryUrl: "https://noriskillsets.dev",
          }),
        );
      });

      it("should allow authenticated user with empty orgs to upload to public registry", async () => {
        const skillsetDir = path.join(skillsetsDir, "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: [],
            organizationUrl: "https://noriskillsets.dev",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);
      });

      it("should use unified auth when config.auth.organizations is present", async () => {
        // Create a profile to upload
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        // New package - no existing versions
        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);
        expect(getRegistryAuthToken).toHaveBeenCalledWith({
          registryAuth: {
            registryUrl: "https://myorg.noriskillsets.dev",
            username: "test@example.com",
            refreshToken: "test-token",
          },
        });
      });
    });

    describe("successful upload", () => {
      it("should upload profile to correct registry", async () => {
        // Create a profile to upload
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );
        await fs.writeFile(
          path.join(skillsetDir, "package.json"),
          JSON.stringify({ name: "my-profile", version: "1.0.0" }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        // New package - no existing versions
        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // Verify upload was called with correct params
        expect(registrarApi.uploadSkillset).toHaveBeenCalledWith(
          expect.objectContaining({
            packageName: "my-profile",
            version: "1.0.0",
            authToken: "auth-token",
            registryUrl: "https://myorg.noriskillsets.dev",
          }),
        );

        // Verify success output from clack prompts (install hint in summary note)
        const clackOutput = getClackOutput();
        expect(clackOutput.toLowerCase()).toContain("install");
        expect(clackOutput).toContain("my-profile");
      });

      it("should auto-bump version when not specified", async () => {
        // Create a profile to upload
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        // Existing package at version 1.2.3
        vi.mocked(registrarApi.getPackument).mockResolvedValue({
          name: "my-profile",
          "dist-tags": { latest: "1.2.3" },
          versions: {
            "1.2.3": { name: "my-profile", version: "1.2.3" },
          },
        });

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.2.4",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // Verify version was auto-bumped to 1.2.4
        expect(registrarApi.uploadSkillset).toHaveBeenCalledWith(
          expect.objectContaining({
            version: "1.2.4",
          }),
        );
      });

      it("should use explicit version when specified", async () => {
        // Create a profile to upload
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "2.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile@2.0.0",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // Verify explicit version was used
        expect(registrarApi.uploadSkillset).toHaveBeenCalledWith(
          expect.objectContaining({
            version: "2.0.0",
          }),
        );

        // getPackument should not have been called since version was explicit
        expect(registrarApi.getPackument).not.toHaveBeenCalled();
      });
    });

    describe("--list-versions flag", () => {
      it("should list versions when flag is set", async () => {
        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockResolvedValue({
          name: "my-profile",
          "dist-tags": { latest: "2.0.0", beta: "2.1.0-beta.1" },
          versions: {
            "1.0.0": { name: "my-profile", version: "1.0.0" },
            "2.0.0": { name: "my-profile", version: "2.0.0" },
            "2.1.0-beta.1": { name: "my-profile", version: "2.1.0-beta.1" },
          },
          time: {
            "1.0.0": "2024-01-01T00:00:00.000Z",
            "2.0.0": "2024-02-01T00:00:00.000Z",
            "2.1.0-beta.1": "2024-03-01T00:00:00.000Z",
          },
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
          listVersions: true,
        });

        expect(result.success).toBe(true);

        // Verify no upload occurred
        expect(registrarApi.uploadSkillset).not.toHaveBeenCalled();

        // Verify version list was displayed via clack prompts
        const clackOutput = getClackOutput();
        expect(clackOutput).toContain("my-profile");
        expect(clackOutput).toContain("latest");
        expect(clackOutput).toContain("2.0.0");
      });

      it("should fail gracefully when package not found with --list-versions", async () => {
        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        const result = await registryUploadMain({
          profileSpec: "myorg/nonexistent",
          cwd: testDir,
          listVersions: true,
        });

        expect(result.success).toBe(false);

        // Output now goes through clack prompts
        const clackOutput = getClackOutput();
        expect(clackOutput.toLowerCase()).toContain("not found");
      });
    });

    describe("skill collision handling", () => {
      it("should auto-resolve unchanged skill conflicts", async () => {
        // Create a profile to upload
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        // New package
        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        // First upload attempt fails with skill collision
        const collisionError = {
          message: "Skill conflicts detected",
          conflicts: [
            {
              skillId: "writing-plans",
              exists: true,
              canPublish: false,
              latestVersion: "1.0.0",
              owner: "someone@example.com",
              availableActions: ["link", "cancel"],
              contentUnchanged: true, // Can be auto-resolved
            },
          ],
        };

        vi.mocked(registrarApi.uploadSkillset)
          .mockRejectedValueOnce(collisionError)
          .mockResolvedValueOnce({
            name: "my-profile",
            version: "1.0.0",
            tarballSha: "abc123",
            createdAt: new Date().toISOString(),
          });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // Verify retry was attempted with resolution strategy
        expect(registrarApi.uploadSkillset).toHaveBeenCalledTimes(2);
        expect(registrarApi.uploadSkillset).toHaveBeenLastCalledWith(
          expect.objectContaining({
            resolutionStrategy: {
              "writing-plans": { action: "link" },
            },
          }),
        );

        // Verify auto-resolution message was shown in spinner
        const spinnerMessages = getSpinnerMessages();
        expect(spinnerMessages.join("\n").toLowerCase()).toContain(
          "auto-resolv",
        );
      });

      it("should fail for modified skill conflicts requiring manual resolution", async () => {
        // Create a profile to upload
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        // New package
        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        // Upload fails with skill collision that cannot be auto-resolved
        const collisionError = {
          message: "Skill conflicts detected",
          conflicts: [
            {
              skillId: "writing-plans",
              exists: true,
              canPublish: false,
              latestVersion: "1.0.0",
              owner: "someone@example.com",
              availableActions: ["namespace", "cancel"],
              contentUnchanged: false, // MODIFIED - requires manual resolution
            },
          ],
        };

        vi.mocked(registrarApi.uploadSkillset).mockRejectedValue(
          collisionError,
        );

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
          nonInteractive: true, // Non-interactive mode - should fail with error message
        });

        expect(result.success).toBe(false);

        // Verify error message shows conflict details (now via clack note)
        const clackOutput = getClackOutput();
        expect(clackOutput).toContain("writing-plans");
        expect(clackOutput.toLowerCase()).toContain("modified");
        expect(clackOutput.toLowerCase()).toContain("manual resolution");
      });
    });

    describe("profile existence check", () => {
      it("should fail when profile does not exist", async () => {
        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        const result = await registryUploadMain({
          profileSpec: "myorg/nonexistent-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(false);

        const clackOutput = getClackOutput();
        expect(clackOutput).toContain("not found");
        expect(clackOutput).toContain("nonexistent-profile");
      });
    });

    describe("error handling", () => {
      it("should handle authentication failure gracefully", async () => {
        // Create a profile to upload
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "expired-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockRejectedValue(
          new Error("Token expired"),
        );

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(false);

        expect(getClackOutput().toLowerCase()).toContain(
          "authentication failed",
        );
      });

      it("should handle upload failure gracefully", async () => {
        // Create a profile to upload
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockRejectedValue(
          new Error("Network error: connection refused"),
        );

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(false);

        // Error output now goes through clack prompts
        const clackOutput = getClackOutput();
        expect(clackOutput.toLowerCase()).toContain("upload failed");
        expect(clackOutput).toContain("Network error");
      });
    });

    describe("--registry option", () => {
      it("should use explicit registry URL when provided", async () => {
        const customRegistryUrl = "https://custom.registry.com";

        // Create a profile to upload
        const skillsetDir = path.join(skillsetsDir, "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuth).mockReturnValue({
          registryUrl: customRegistryUrl,
          username: "test@example.com",
          refreshToken: "test-token",
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "my-profile",
          cwd: testDir,
          registryUrl: customRegistryUrl,
        });

        expect(result.success).toBe(true);

        // Verify upload was to custom registry
        expect(registrarApi.uploadSkillset).toHaveBeenCalledWith(
          expect.objectContaining({
            registryUrl: customRegistryUrl,
          }),
        );
      });

      it("should fail when --registry specified but no auth configured", async () => {
        const customRegistryUrl = "https://custom.registry.com";

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        // No auth for custom registry
        vi.mocked(getRegistryAuth).mockReturnValue(null);

        const result = await registryUploadMain({
          profileSpec: "my-profile",
          cwd: testDir,
          registryUrl: customRegistryUrl,
        });

        expect(result.success).toBe(false);

        expect(getClackOutput().toLowerCase()).toContain("no authentication");
      });
    });

    describe("--dry-run flag", () => {
      it("should show target version without uploading", async () => {
        // Create a profile to upload
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        // Existing package at version 1.2.3
        vi.mocked(registrarApi.getPackument).mockResolvedValue({
          name: "my-profile",
          "dist-tags": { latest: "1.2.3" },
          versions: {
            "1.2.3": { name: "my-profile", version: "1.2.3" },
          },
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
          dryRun: true,
        });

        expect(result.success).toBe(true);

        // Verify no upload occurred
        expect(registrarApi.uploadSkillset).not.toHaveBeenCalled();

        // Verify dry-run output shows version
        const clackOutput = getClackOutput();
        expect(clackOutput.toLowerCase()).toContain("dry run");
        expect(clackOutput).toContain("1.2.4"); // auto-bumped version
      });

      it("should display profile path and registry URL in dry-run", async () => {
        // Create a profile to upload
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
          dryRun: true,
        });

        expect(result.success).toBe(true);

        const clackOutput = getClackOutput();
        expect(clackOutput).toContain("myorg/my-profile");
        expect(clackOutput).toContain("myorg.noriskillsets.dev");
      });

      it("should show 1.0.0 for new packages in dry-run", async () => {
        // Create a profile to upload
        const skillsetDir = path.join(skillsetsDir, "myorg", "new-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# New Profile\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        // New package - no existing versions
        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        const result = await registryUploadMain({
          profileSpec: "myorg/new-profile",
          cwd: testDir,
          dryRun: true,
        });

        expect(result.success).toBe(true);

        expect(getClackOutput()).toContain("1.0.0");
      });
    });

    describe("--description option", () => {
      it("should pass description to uploadSkillset API", async () => {
        // Create a profile to upload
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
          description: "A helpful profile for testing",
        });

        expect(result.success).toBe(true);

        expect(registrarApi.uploadSkillset).toHaveBeenCalledWith(
          expect.objectContaining({
            description: "A helpful profile for testing",
          }),
        );
      });

      it("should work without description (undefined)", async () => {
        // Create a profile to upload
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
          // No description
        });

        expect(result.success).toBe(true);

        // Verify description was not included or was undefined
        const uploadCall = vi.mocked(registrarApi.uploadSkillset).mock.calls[0];
        expect(uploadCall[0].description).toBeUndefined();
      });
    });

    describe("spinner progress indication", () => {
      it("should show spinner during upload", async () => {
        const spinnerMock = {
          start: vi.fn(),
          stop: vi.fn(),
          message: vi.fn(),
          cancel: vi.fn(),
          error: vi.fn(),
          clear: vi.fn(),
          isCancelled: false,
        };
        vi.mocked(clack.spinner).mockReturnValue(spinnerMock);

        // Create a profile to upload
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        expect(spinnerMock.start).toHaveBeenCalled();
        expect(spinnerMock.stop).toHaveBeenCalled();
      });

      it("should stop spinner on failure", async () => {
        const spinnerMock = {
          start: vi.fn(),
          stop: vi.fn(),
          message: vi.fn(),
          cancel: vi.fn(),
          error: vi.fn(),
          clear: vi.fn(),
          isCancelled: false,
        };
        vi.mocked(clack.spinner).mockReturnValue(spinnerMock);

        // Create a profile to upload
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockRejectedValue(
          new Error("Upload failed"),
        );

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(false);

        expect(spinnerMock.start).toHaveBeenCalled();
        expect(spinnerMock.stop).toHaveBeenCalled();
      });

      it("should not show spinner in silent mode", async () => {
        const spinnerMock = {
          start: vi.fn(),
          stop: vi.fn(),
          message: vi.fn(),
          cancel: vi.fn(),
          error: vi.fn(),
          clear: vi.fn(),
          isCancelled: false,
        };
        vi.mocked(clack.spinner).mockReturnValue(spinnerMock);

        // Create a profile to upload
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
          silent: true,
        });

        expect(result.success).toBe(true);

        // Spinner should not be used in silent mode
        expect(spinnerMock.start).not.toHaveBeenCalled();
      });
    });

    describe("interactive conflict resolution", () => {
      it("should prompt for resolution on conflicts in interactive mode", async () => {
        // Create a profile to upload
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        // First upload fails with conflict that needs manual resolution
        const collisionError = {
          message: "Skill conflicts detected",
          conflicts: [
            {
              skillId: "my-skill",
              exists: true,
              canPublish: true,
              latestVersion: "1.0.0",
              owner: "me@example.com",
              availableActions: ["namespace", "updateVersion", "cancel"],
              contentUnchanged: false,
            },
          ],
        };

        vi.mocked(registrarApi.uploadSkillset)
          .mockRejectedValueOnce(collisionError)
          .mockResolvedValueOnce({
            name: "my-profile",
            version: "1.0.0",
            tarballSha: "abc123",
            createdAt: new Date().toISOString(),
          });

        // Mock clack.select to return the namespace action
        vi.mocked(clack.select).mockResolvedValue("namespace");

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
          // interactive mode is default (nonInteractive: false)
        });

        expect(result.success).toBe(true);

        // Verify clack.select was called for conflict resolution
        expect(clack.select).toHaveBeenCalled();

        // Verify retry with resolution strategy
        expect(registrarApi.uploadSkillset).toHaveBeenCalledTimes(2);
        expect(registrarApi.uploadSkillset).toHaveBeenLastCalledWith(
          expect.objectContaining({
            resolutionStrategy: {
              "my-skill": { action: "namespace" },
            },
          }),
        );
      });

      it("should not prompt in non-interactive mode", async () => {
        // Create a profile to upload
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        // Upload fails with conflict that needs manual resolution
        const collisionError = {
          message: "Skill conflicts detected",
          conflicts: [
            {
              skillId: "my-skill",
              exists: true,
              canPublish: false,
              latestVersion: "1.0.0",
              availableActions: ["namespace", "cancel"],
              contentUnchanged: false, // Can't auto-resolve
            },
          ],
        };

        vi.mocked(registrarApi.uploadSkillset).mockRejectedValue(
          collisionError,
        );

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
          nonInteractive: true,
        });

        expect(result.success).toBe(false);

        // Verify clack.select was NOT called (no interactive prompt in non-interactive mode)
        expect(clack.select).not.toHaveBeenCalled();
      });
    });

    describe("skill summary on success", () => {
      it("should display uploaded skills summary on success", async () => {
        // Create a profile to upload
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
          extractedSkills: {
            succeeded: [
              { name: "skill-a", version: "1.0.0" },
              { name: "skill-b", version: "2.0.0" },
            ],
            failed: [],
          },
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // Output now goes through clack note
        const clackOutput = getClackOutput();
        expect(clackOutput).toContain("skill-a");
        expect(clackOutput).toContain("skill-b");
      });

      it("should show linked vs uploaded skills separately", async () => {
        // Create a profile to upload
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        // First call fails with conflict, second succeeds with resolution
        const collisionError = {
          message: "Skill conflicts detected",
          conflicts: [
            {
              skillId: "existing-skill",
              exists: true,
              canPublish: false,
              latestVersion: "1.5.0",
              availableActions: ["link", "namespace", "cancel"],
              contentUnchanged: true,
            },
          ],
        };

        vi.mocked(registrarApi.uploadSkillset)
          .mockRejectedValueOnce(collisionError)
          .mockResolvedValueOnce({
            name: "my-profile",
            version: "1.0.0",
            tarballSha: "abc123",
            createdAt: new Date().toISOString(),
            extractedSkills: {
              succeeded: [
                { name: "new-skill", version: "1.0.0" },
                { name: "existing-skill", version: "1.5.0" },
              ],
              failed: [],
            },
          });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // Output now goes through clack note
        const clackOutput = getClackOutput();
        expect(clackOutput).toContain("existing-skill");
        // Should indicate it was linked
        expect(clackOutput.toLowerCase()).toContain("linked");
      });

      it("should show namespaced skills with their new names", async () => {
        // Create a profile to upload
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        // First call fails with conflict, second succeeds with namespace resolution
        const collisionError = {
          message: "Skill conflicts detected",
          conflicts: [
            {
              skillId: "conflicting-skill",
              exists: true,
              canPublish: false,
              latestVersion: "1.0.0",
              availableActions: ["namespace", "cancel"],
              contentUnchanged: false,
            },
          ],
        };

        vi.mocked(registrarApi.uploadSkillset)
          .mockRejectedValueOnce(collisionError)
          .mockResolvedValueOnce({
            name: "my-profile",
            version: "1.0.0",
            tarballSha: "abc123",
            createdAt: new Date().toISOString(),
            extractedSkills: {
              succeeded: [
                { name: "my-profile-conflicting-skill", version: "1.0.0" },
              ],
              failed: [],
            },
          });

        // Mock clack.select to return namespace action
        vi.mocked(clack.select).mockResolvedValue("namespace");

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // Output now goes through clack note
        const clackOutput = getClackOutput();
        // Should show the namespaced name
        expect(clackOutput).toContain("my-profile-conflicting-skill");
      });
    });

    describe("inline skills detection", () => {
      it("should pass inlineSkills to uploadSkillset when profile has skills without nori.json", async () => {
        // Create a profile with mixed skills
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        // Skill without nori.json (inline candidate)
        const inlineSkillDir = path.join(skillsetDir, "skills", "init");
        await fs.mkdir(inlineSkillDir, { recursive: true });
        await fs.writeFile(
          path.join(inlineSkillDir, "SKILL.md"),
          "# Init Skill\n",
        );

        // Skill with nori.json (always extracted)
        const extractedSkillDir = path.join(skillsetDir, "skills", "tdd");
        await fs.mkdir(extractedSkillDir, { recursive: true });
        await fs.writeFile(
          path.join(extractedSkillDir, "SKILL.md"),
          "# TDD Skill\n",
        );
        await fs.writeFile(
          path.join(extractedSkillDir, "nori.json"),
          JSON.stringify({ name: "tdd", version: "1.0.0" }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        // Flow prompts per-skill for inline/extract decision
        vi.mocked(clack.select).mockResolvedValueOnce("inline");

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // Verify inlineSkills was passed to the API
        expect(registrarApi.uploadSkillset).toHaveBeenCalledWith(
          expect.objectContaining({
            inlineSkills: expect.arrayContaining(["init"]),
          }),
        );

        // Verify "tdd" (with nori.json) is NOT in inlineSkills
        const uploadCall = vi.mocked(registrarApi.uploadSkillset).mock
          .calls[0][0];
        expect(uploadCall.inlineSkills).not.toContain("tdd");
      });

      it("should not prompt for inline skills when no skills directory exists", async () => {
        // Create a profile without skills directory
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // No inlineSkills should be sent when there are no candidates
        const uploadCall = vi.mocked(registrarApi.uploadSkillset).mock
          .calls[0][0];
        expect(uploadCall.inlineSkills).toBeUndefined();
      });

      it("should not prompt when all skills have nori.json", async () => {
        // Create a profile where all skills have nori.json
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        const skillDir = path.join(skillsetDir, "skills", "tdd");
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(path.join(skillDir, "SKILL.md"), "# TDD Skill\n");
        await fs.writeFile(
          path.join(skillDir, "nori.json"),
          JSON.stringify({ name: "tdd", version: "1.0.0" }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // No inlineSkills should be sent when there are no candidates
        const uploadCall = vi.mocked(registrarApi.uploadSkillset).mock
          .calls[0][0];
        expect(uploadCall.inlineSkills).toBeUndefined();
      });

      it("should skip inline skills prompt in non-interactive mode and extract all", async () => {
        // Create a profile with skills without nori.json
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        const skillDir = path.join(skillsetDir, "skills", "init");
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(path.join(skillDir, "SKILL.md"), "# Init Skill\n");

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
          nonInteractive: true,
        });

        expect(result.success).toBe(true);

        // In non-interactive mode, no inlineSkills sent (extract all, backward compat)
        const uploadCall = vi.mocked(registrarApi.uploadSkillset).mock
          .calls[0][0];
        expect(uploadCall.inlineSkills).toBeUndefined();
      });

      it("should skip inline skills prompt in silent mode and extract all", async () => {
        // Create a profile with skills without nori.json
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        const skillDir = path.join(skillsetDir, "skills", "init");
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(path.join(skillDir, "SKILL.md"), "# Init Skill\n");

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
          silent: true,
        });

        expect(result.success).toBe(true);

        // In silent mode, no inlineSkills sent (extract all, backward compat)
        const uploadCall = vi.mocked(registrarApi.uploadSkillset).mock
          .calls[0][0];
        expect(uploadCall.inlineSkills).toBeUndefined();
      });

      it("should not pass inlineSkills when user selects extract for each skill", async () => {
        // Create a profile with skills without nori.json
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        const skillDir = path.join(skillsetDir, "skills", "init");
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(path.join(skillDir, "SKILL.md"), "# Init Skill\n");

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        // User selects "extract" in per-skill flow prompt
        vi.mocked(clack.select).mockResolvedValueOnce("extract");

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // inlineSkills should NOT be sent when user chose extract
        const uploadCall = vi.mocked(registrarApi.uploadSkillset).mock
          .calls[0][0];
        expect(uploadCall.inlineSkills).toBeUndefined();
      });
    });

    describe("tarball file exclusion", () => {
      it("should exclude .nori-version files from upload tarball", async () => {
        // Create a profile with .nori-version file (simulating a previously downloaded profile)
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );
        await fs.writeFile(
          path.join(skillsetDir, "nori.json"),
          JSON.stringify({ name: "my-profile", version: "1.0.0" }),
        );
        // This file should NOT be included in the tarball
        await fs.writeFile(
          path.join(skillsetDir, ".nori-version"),
          JSON.stringify({
            version: "0.5.0",
            registryUrl: "https://old.registry.com",
          }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        // Capture the tarball data to verify contents
        let capturedArchiveData: ArrayBuffer | null = null;
        vi.mocked(registrarApi.uploadSkillset).mockImplementation(
          async (args) => {
            capturedArchiveData = args.archiveData;
            return {
              name: "my-profile",
              version: "1.0.0",
              tarballSha: "abc123",
              createdAt: new Date().toISOString(),
            };
          },
        );

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);
        expect(capturedArchiveData).not.toBeNull();

        // Extract the tarball and verify .nori-version is not present
        const tar = await import("tar");
        const extractDir = await fs.mkdtemp(
          path.join(tmpdir(), "tarball-extract-"),
        );

        try {
          const tarballBuffer = Buffer.from(capturedArchiveData!);
          const tarballPath = path.join(extractDir, "upload.tgz");
          await fs.writeFile(tarballPath, tarballBuffer);

          await tar.extract({
            file: tarballPath,
            cwd: extractDir,
          });

          // List extracted files
          const extractedFiles = await fs.readdir(extractDir, {
            recursive: true,
          });

          // AGENTS.md and nori.json should be present
          expect(extractedFiles).toContain("AGENTS.md");
          expect(extractedFiles).toContain("nori.json");

          // .nori-version should NOT be present
          expect(extractedFiles).not.toContain(".nori-version");
        } finally {
          await fs.rm(extractDir, { recursive: true, force: true });
        }
      });
    });

    describe("nori.json type field handling", () => {
      it("should set type to skillset on profile nori.json when type is missing before upload", async () => {
        // Create a profile with nori.json that has no type field
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "nori.json"),
          JSON.stringify({ name: "my-profile", version: "1.0.0" }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // Verify the nori.json on disk now has type: "skillset"
        const noriJson = JSON.parse(
          await fs.readFile(path.join(skillsetDir, "nori.json"), "utf-8"),
        );
        expect(noriJson.type).toBe("skillset");
      });

      it("should set type to skill on skill subdirectory nori.json when type is missing before upload", async () => {
        // Create a profile with a skill that has nori.json without type
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "nori.json"),
          JSON.stringify({
            name: "my-profile",
            version: "1.0.0",
            type: "skillset",
          }),
        );

        const skillDir = path.join(skillsetDir, "skills", "my-skill");
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(
          path.join(skillDir, "SKILL.md"),
          "---\nname: my-skill\ndescription: A skill\n---\n",
        );
        await fs.writeFile(
          path.join(skillDir, "nori.json"),
          JSON.stringify({ name: "my-skill", version: "1.0.0" }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // Verify the skill nori.json on disk now has type: "skill"
        const skillNoriJson = JSON.parse(
          await fs.readFile(path.join(skillDir, "nori.json"), "utf-8"),
        );
        expect(skillNoriJson.type).toBe("skill");
      });

      it("should not overwrite existing type field on nori.json during upload", async () => {
        // Create a profile with nori.json that already has a type field
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "nori.json"),
          JSON.stringify({
            name: "my-profile",
            version: "1.0.0",
            type: "skillset",
          }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // Verify the type field was not changed
        const noriJson = JSON.parse(
          await fs.readFile(path.join(skillsetDir, "nori.json"), "utf-8"),
        );
        expect(noriJson.type).toBe("skillset");
      });

      it("should create nori.json with type inlined-skill for inline candidates", async () => {
        // Create a profile with an inline skill candidate (no nori.json in skill dir)
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "nori.json"),
          JSON.stringify({
            name: "my-profile",
            version: "1.0.0",
            type: "skillset",
          }),
        );

        const skillDir = path.join(skillsetDir, "skills", "my-inline-skill");
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(
          path.join(skillDir, "SKILL.md"),
          "---\nname: my-inline-skill\ndescription: An inline skill\n---\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        // User chooses inline for the skill
        vi.mocked(clack.select).mockResolvedValueOnce("inline");

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // Verify nori.json was created for the inline skill
        const skillNoriJson = JSON.parse(
          await fs.readFile(path.join(skillDir, "nori.json"), "utf-8"),
        );
        expect(skillNoriJson.type).toBe("inlined-skill");
      });

      it("should create nori.json with type skill for extract candidates", async () => {
        // Create a profile with a skill candidate to be extracted (no nori.json)
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "nori.json"),
          JSON.stringify({
            name: "my-profile",
            version: "1.0.0",
            type: "skillset",
          }),
        );

        const skillDir = path.join(skillsetDir, "skills", "my-extract-skill");
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(
          path.join(skillDir, "SKILL.md"),
          "---\nname: my-extract-skill\ndescription: A skill to extract\n---\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        // User chooses extract for the skill
        vi.mocked(clack.select).mockResolvedValueOnce("extract");

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // Verify nori.json was created for the extracted skill
        const skillNoriJson = JSON.parse(
          await fs.readFile(path.join(skillDir, "nori.json"), "utf-8"),
        );
        expect(skillNoriJson.type).toBe("skill");
      });
    });

    describe("post-upload local state sync", () => {
      it("should update local nori.json version after successful upload", async () => {
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "nori.json"),
          JSON.stringify({
            name: "my-profile",
            version: "1.0.0",
            type: "skillset",
          }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockResolvedValue({
          name: "my-profile",
          "dist-tags": { latest: "1.0.0" },
          versions: {
            "1.0.0": { name: "my-profile", version: "1.0.0" },
          },
        });

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.1",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        const noriJson = JSON.parse(
          await fs.readFile(path.join(skillsetDir, "nori.json"), "utf-8"),
        );
        expect(noriJson.version).toBe("1.0.1");
      });

      it("should write .nori-version file after successful upload", async () => {
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "nori.json"),
          JSON.stringify({
            name: "my-profile",
            version: "1.0.0",
            type: "skillset",
          }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        const versionInfo = JSON.parse(
          await fs.readFile(path.join(skillsetDir, ".nori-version"), "utf-8"),
        );
        expect(versionInfo.version).toBe("1.0.0");
        expect(versionInfo.registryUrl).toContain("myorg");

        const noriJson = JSON.parse(
          await fs.readFile(path.join(skillsetDir, "nori.json"), "utf-8"),
        );
        expect(noriJson.registryURL).toContain("myorg");
      });

      it("should update extracted skill versions in local nori.json after upload", async () => {
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "nori.json"),
          JSON.stringify({
            name: "my-profile",
            version: "1.0.0",
            type: "skillset",
          }),
        );

        const skillDir = path.join(skillsetDir, "skills", "my-skill");
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(
          path.join(skillDir, "SKILL.md"),
          "---\nname: my-skill\ndescription: A skill\n---\n",
        );
        await fs.writeFile(
          path.join(skillDir, "nori.json"),
          JSON.stringify({
            name: "my-skill",
            version: "1.0.0",
            type: "skill",
          }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
          extractedSkills: {
            succeeded: [{ name: "my-skill", version: "2.0.0" }],
            failed: [],
          },
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // Skill nori.json should have the version from the server response
        const skillNoriJson = JSON.parse(
          await fs.readFile(path.join(skillDir, "nori.json"), "utf-8"),
        );
        expect(skillNoriJson.version).toBe("2.0.0");

        // Skillset nori.json dependencies should be updated
        const skillsetNoriJson = JSON.parse(
          await fs.readFile(path.join(skillsetDir, "nori.json"), "utf-8"),
        );
        expect(skillsetNoriJson.dependencies?.skills?.["my-skill"]).toBe(
          "2.0.0",
        );
      });

      it("should NOT sync local state during dry-run", async () => {
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "nori.json"),
          JSON.stringify({
            name: "my-profile",
            version: "1.0.0",
            type: "skillset",
          }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
          dryRun: true,
        });

        expect(result.success).toBe(true);

        // nori.json version should be unchanged
        const noriJson = JSON.parse(
          await fs.readFile(path.join(skillsetDir, "nori.json"), "utf-8"),
        );
        expect(noriJson.version).toBe("1.0.0");

        // .nori-version should not exist
        await expect(
          fs.access(path.join(skillsetDir, ".nori-version")),
        ).rejects.toThrow();
      });

      it("should sync local state in silent mode", async () => {
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "nori.json"),
          JSON.stringify({
            name: "my-profile",
            version: "1.0.0",
            type: "skillset",
          }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
          silent: true,
        });

        expect(result.success).toBe(true);

        // nori.json version should be updated
        const noriJson = JSON.parse(
          await fs.readFile(path.join(skillsetDir, "nori.json"), "utf-8"),
        );
        expect(noriJson.version).toBe("1.0.0");

        // .nori-version should exist
        const versionInfo = JSON.parse(
          await fs.readFile(path.join(skillsetDir, ".nori-version"), "utf-8"),
        );
        expect(versionInfo.version).toBe("1.0.0");
      });

      it("should still return success when sync fails but upload succeeded", async () => {
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "nori.json"),
          JSON.stringify({
            name: "my-profile",
            version: "1.0.0",
            type: "skillset",
          }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        // Make the skillset directory read+execute but not writable to force sync failure
        await fs.chmod(skillsetDir, 0o555);

        try {
          const result = await registryUploadMain({
            profileSpec: "myorg/my-profile",
            cwd: testDir,
            silent: true,
          });

          // Upload should still succeed even though sync failed
          expect(result.success).toBe(true);
        } finally {
          // Restore permissions for cleanup
          await fs.chmod(skillsetDir, 0o755);
        }
      });

      it("should update local dependency versions for linked skills after interactive upload", async () => {
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        const skillDir = path.join(skillsetDir, "skills", "my-skill");
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "nori.json"),
          JSON.stringify({
            name: "my-profile",
            version: "1.0.0",
            type: "skillset",
          }),
        );
        await fs.writeFile(path.join(skillDir, "SKILL.md"), "# My Skill\n");
        await fs.writeFile(
          path.join(skillDir, "nori.json"),
          JSON.stringify({
            name: "my-skill",
            version: "1.0.0",
            type: "skill",
          }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        // First upload fails with conflict — skill exists on remote at v3.0.0
        const collisionError = {
          message: "Skill conflicts detected",
          conflicts: [
            {
              skillId: "my-skill",
              exists: true,
              canPublish: true,
              latestVersion: "3.0.0",
              owner: "me@example.com",
              availableActions: [
                "link",
                "namespace",
                "updateVersion",
                "cancel",
              ],
              contentUnchanged: false,
            },
          ],
        };

        vi.mocked(registrarApi.uploadSkillset)
          .mockRejectedValueOnce(collisionError)
          .mockResolvedValueOnce({
            name: "my-profile",
            version: "2.0.0",
            tarballSha: "abc123",
            createdAt: new Date().toISOString(),
          });

        // User chooses "link" (use existing remote version)
        vi.mocked(clack.select).mockResolvedValue("link");

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // Local nori.json should have dependencies.skills with the linked version
        const noriJson = JSON.parse(
          await fs.readFile(path.join(skillsetDir, "nori.json"), "utf-8"),
        );
        expect(noriJson.dependencies?.skills?.["my-skill"]).toBe("3.0.0");
      });

      it("should update local dependency versions for auto-resolved linked skills", async () => {
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        const skillDir = path.join(skillsetDir, "skills", "my-skill");
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "nori.json"),
          JSON.stringify({
            name: "my-profile",
            version: "1.0.0",
            type: "skillset",
          }),
        );
        await fs.writeFile(path.join(skillDir, "SKILL.md"), "# My Skill\n");
        await fs.writeFile(
          path.join(skillDir, "nori.json"),
          JSON.stringify({
            name: "my-skill",
            version: "1.0.0",
            type: "skill",
          }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        // First upload fails with conflict — content unchanged, auto-resolves to link
        const collisionError = {
          message: "Skill conflicts detected",
          conflicts: [
            {
              skillId: "my-skill",
              exists: true,
              canPublish: true,
              latestVersion: "5.0.0",
              owner: "me@example.com",
              availableActions: [
                "link",
                "namespace",
                "updateVersion",
                "cancel",
              ],
              contentUnchanged: true,
            },
          ],
        };

        vi.mocked(registrarApi.uploadSkillset)
          .mockRejectedValueOnce(collisionError)
          .mockResolvedValueOnce({
            name: "my-profile",
            version: "2.0.0",
            tarballSha: "abc123",
            createdAt: new Date().toISOString(),
          });

        // Interactive mode — contentUnchanged: true means auto-resolve to link (no prompt)
        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // Local nori.json should have dependencies.skills with the auto-linked version
        const noriJson = JSON.parse(
          await fs.readFile(path.join(skillsetDir, "nori.json"), "utf-8"),
        );
        expect(noriJson.dependencies?.skills?.["my-skill"]).toBe("5.0.0");
      });

      it("should update extracted subagent versions in local nori.json after upload", async () => {
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "nori.json"),
          JSON.stringify({
            name: "my-profile",
            version: "1.0.0",
            type: "skillset",
          }),
        );

        const subagentDir = path.join(skillsetDir, "subagents", "my-subagent");
        await fs.mkdir(subagentDir, { recursive: true });
        await fs.writeFile(
          path.join(subagentDir, "SUBAGENT.md"),
          "---\nname: My Subagent\ndescription: A test subagent\n---\n# My Subagent\n",
        );
        await fs.writeFile(
          path.join(subagentDir, "nori.json"),
          JSON.stringify({
            name: "my-subagent",
            version: "1.0.0",
            type: "subagent",
          }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
          extractedSubagents: {
            succeeded: [{ name: "my-subagent", version: "2.0.0" }],
            failed: [],
          },
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // Subagent nori.json should have the version from the server response
        const subagentNoriJson = JSON.parse(
          await fs.readFile(path.join(subagentDir, "nori.json"), "utf-8"),
        );
        expect(subagentNoriJson.version).toBe("2.0.0");

        // Skillset nori.json dependencies should include subagent version
        const skillsetNoriJson = JSON.parse(
          await fs.readFile(path.join(skillsetDir, "nori.json"), "utf-8"),
        );
        expect(skillsetNoriJson.dependencies?.subagents?.["my-subagent"]).toBe(
          "2.0.0",
        );
      });

      it("should update local dependency versions for linked subagents after interactive upload", async () => {
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        const subagentDir = path.join(skillsetDir, "subagents", "my-subagent");
        await fs.mkdir(subagentDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "nori.json"),
          JSON.stringify({
            name: "my-profile",
            version: "1.0.0",
            type: "skillset",
          }),
        );
        await fs.writeFile(
          path.join(subagentDir, "SUBAGENT.md"),
          "---\nname: My Subagent\ndescription: A test subagent\n---\n# My Subagent\n",
        );
        await fs.writeFile(
          path.join(subagentDir, "nori.json"),
          JSON.stringify({
            name: "my-subagent",
            version: "1.0.0",
            type: "subagent",
          }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        // First upload fails with subagent collision — subagent exists on remote at v1.5.0
        const subagentCollisionError = {
          message: "Subagent conflicts detected",
          subagentConflicts: [
            {
              subagentId: "my-subagent",
              exists: true,
              canPublish: false,
              latestVersion: "1.5.0",
              owner: "other@example.com",
              availableActions: ["link", "namespace", "cancel"],
              contentUnchanged: true,
            },
          ],
        };

        vi.mocked(registrarApi.uploadSkillset)
          .mockRejectedValueOnce(subagentCollisionError)
          .mockResolvedValueOnce({
            name: "my-profile",
            version: "2.0.0",
            tarballSha: "abc123",
            createdAt: new Date().toISOString(),
          });

        // User chooses "link" (use existing remote version)
        vi.mocked(clack.select).mockResolvedValue("link");

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // Local nori.json should have dependencies.subagents with the linked version
        const noriJson = JSON.parse(
          await fs.readFile(path.join(skillsetDir, "nori.json"), "utf-8"),
        );
        expect(noriJson.dependencies?.subagents?.["my-subagent"]).toBe("1.5.0");
      });
    });

    describe("subagent collision handling", () => {
      it("should return subagentConflicts when SubagentCollisionError is thrown", async () => {
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        const subagentDir = path.join(
          skillsetDir,
          "subagents",
          "conflicting-agent",
        );
        await fs.mkdir(subagentDir, { recursive: true });
        await fs.writeFile(
          path.join(subagentDir, "SUBAGENT.md"),
          "---\nname: Conflicting Agent\ndescription: A conflicting subagent\n---\n# Conflicting Agent\n",
        );
        await fs.writeFile(
          path.join(subagentDir, "nori.json"),
          JSON.stringify({
            name: "conflicting-agent",
            version: "1.0.0",
            type: "subagent",
          }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        // Upload throws SubagentCollisionError
        const subagentCollisionError = {
          message: "Subagent conflicts detected",
          subagentConflicts: [
            {
              subagentId: "conflicting-agent",
              exists: true,
              canPublish: false,
              latestVersion: "2.0.0",
              owner: "other@example.com",
              availableActions: ["link", "namespace", "cancel"],
              contentUnchanged: false,
            },
          ],
          isSubagentCollisionError: true,
        };

        // First call throws subagent collision, second succeeds after resolution
        vi.mocked(registrarApi.uploadSkillset)
          .mockRejectedValueOnce(subagentCollisionError)
          .mockResolvedValueOnce({
            name: "my-profile",
            version: "1.0.0",
            tarballSha: "abc123",
            createdAt: new Date().toISOString(),
          });

        // User chooses "link" to resolve the conflict
        vi.mocked(clack.select).mockResolvedValue("link");

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        // Should recognize the subagent collision and prompt user for resolution,
        // then retry the upload with the resolution strategy and succeed
        expect(result.success).toBe(true);

        // The spinner should have mentioned subagent conflict resolution
        const spinnerMessages = getSpinnerMessages();
        expect(
          spinnerMessages.some((m) => m.toLowerCase().includes("subagent")),
        ).toBe(true);
      });

      it("should include extractedSubagents in upload result on success", async () => {
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        const subagentDir = path.join(skillsetDir, "subagents", "my-subagent");
        await fs.mkdir(subagentDir, { recursive: true });
        await fs.writeFile(
          path.join(subagentDir, "SUBAGENT.md"),
          "---\nname: My Subagent\ndescription: A test subagent\n---\n# My Subagent\n",
        );
        await fs.writeFile(
          path.join(subagentDir, "nori.json"),
          JSON.stringify({
            name: "my-subagent",
            version: "1.0.0",
            type: "subagent",
          }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
          extractedSubagents: {
            succeeded: [{ name: "my-subagent", version: "1.0.0" }],
            failed: [],
          },
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // The upload output should mention the extracted subagent
        const clackOutput = getClackOutput();
        expect(clackOutput).toContain("my-subagent");
      });
    });

    describe("existing inlined skills on re-upload", () => {
      it("should include previously-inlined skills in inlineSkills on re-upload", async () => {
        // Simulate re-upload: skill already has nori.json with type "inlined-skill"
        // (written by first upload's createCandidateNoriJsonFiles)
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        const skillDir = path.join(skillsetDir, "skills", "init");
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(path.join(skillDir, "SKILL.md"), "# Init Skill\n");
        await fs.writeFile(
          path.join(skillDir, "nori.json"),
          JSON.stringify({
            name: "init",
            version: "1.0.0",
            type: "inlined-skill",
          }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockResolvedValue({
          name: "my-profile",
          "dist-tags": { latest: "1.0.0" },
          versions: {
            "1.0.0": {
              name: "my-profile",
              version: "1.0.0",
              dist: {
                tarball: "https://example.com/my-profile-1.0.0.tgz",
                shasum: "abc123",
              },
            },
          },
        });

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.1",
          tarballSha: "def456",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // The previously-inlined skill should be included in inlineSkills
        const uploadCall = vi.mocked(registrarApi.uploadSkillset).mock
          .calls[0][0];
        expect(uploadCall.inlineSkills).toEqual(["init"]);
      });

      it("should not include skills with type 'skill' as inline on re-upload", async () => {
        // Skill has nori.json with type "skill" — should NOT be treated as inline
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        const skillDir = path.join(skillsetDir, "skills", "tdd");
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(path.join(skillDir, "SKILL.md"), "# TDD Skill\n");
        await fs.writeFile(
          path.join(skillDir, "nori.json"),
          JSON.stringify({ name: "tdd", version: "1.0.0", type: "skill" }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // Skills with type "skill" should NOT be in inlineSkills
        const uploadCall = vi.mocked(registrarApi.uploadSkillset).mock
          .calls[0][0];
        expect(uploadCall.inlineSkills).toBeUndefined();
      });

      it("should merge existing inlined skills with new candidates", async () => {
        // One skill already inlined (has nori.json with type "inlined-skill")
        // Another skill is new (no nori.json)
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        // Previously-inlined skill
        const inlinedSkillDir = path.join(skillsetDir, "skills", "init");
        await fs.mkdir(inlinedSkillDir, { recursive: true });
        await fs.writeFile(
          path.join(inlinedSkillDir, "SKILL.md"),
          "# Init Skill\n",
        );
        await fs.writeFile(
          path.join(inlinedSkillDir, "nori.json"),
          JSON.stringify({
            name: "init",
            version: "1.0.0",
            type: "inlined-skill",
          }),
        );

        // New skill without nori.json (candidate)
        const newSkillDir = path.join(skillsetDir, "skills", "debug");
        await fs.mkdir(newSkillDir, { recursive: true });
        await fs.writeFile(
          path.join(newSkillDir, "SKILL.md"),
          "# Debug Skill\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        // User chooses "inline" for the new candidate
        vi.mocked(clack.select).mockResolvedValueOnce("inline");

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // Both the existing inlined skill and the new inline candidate should be in inlineSkills
        const uploadCall = vi.mocked(registrarApi.uploadSkillset).mock
          .calls[0][0];
        expect(uploadCall.inlineSkills).toEqual(
          expect.arrayContaining(["init", "debug"]),
        );
        expect(uploadCall.inlineSkills).toHaveLength(2);
      });

      it("should include existing inlined skills in silent mode re-upload for skills", async () => {
        // Silent mode should also honor existing inlined skills
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# My Profile\n",
        );

        const skillDir = path.join(skillsetDir, "skills", "init");
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(path.join(skillDir, "SKILL.md"), "# Init Skill\n");
        await fs.writeFile(
          path.join(skillDir, "nori.json"),
          JSON.stringify({
            name: "init",
            version: "1.0.0",
            type: "inlined-skill",
          }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
          silent: true,
        });

        expect(result.success).toBe(true);

        // Even in silent mode, existing inlined skills should be sent
        const uploadCall = vi.mocked(registrarApi.uploadSkillset).mock
          .calls[0][0];
        expect(uploadCall.inlineSkills).toEqual(["init"]);
      });
    });

    describe("inline subagents detection", () => {
      it("should pass inlineSubagents to uploadSkillset when profile has directory-based subagents without nori.json", async () => {
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "CLAUDE.md"),
          "# My Profile\n",
        );

        // Directory-based subagent without nori.json (inline candidate)
        const inlineSubagentDir = path.join(
          skillsetDir,
          "subagents",
          "my-agent",
        );
        await fs.mkdir(inlineSubagentDir, { recursive: true });
        await fs.writeFile(
          path.join(inlineSubagentDir, "SUBAGENT.md"),
          "---\nname: My Agent\ndescription: A test agent\n---\n# My Agent\n",
        );

        // Directory-based subagent with nori.json (always extracted)
        const extractedSubagentDir = path.join(
          skillsetDir,
          "subagents",
          "other-agent",
        );
        await fs.mkdir(extractedSubagentDir, { recursive: true });
        await fs.writeFile(
          path.join(extractedSubagentDir, "SUBAGENT.md"),
          "---\nname: Other Agent\ndescription: Another agent\n---\n# Other Agent\n",
        );
        await fs.writeFile(
          path.join(extractedSubagentDir, "nori.json"),
          JSON.stringify({ name: "other-agent", version: "1.0.0" }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");
        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );
        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        // Flow prompts per-subagent for inline/extract decision
        vi.mocked(clack.select).mockResolvedValueOnce("inline");

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        const uploadCall = vi.mocked(registrarApi.uploadSkillset).mock
          .calls[0][0];
        expect(uploadCall.inlineSubagents).toEqual(
          expect.arrayContaining(["my-agent"]),
        );
        expect(uploadCall.inlineSubagents).not.toContain("other-agent");
      });

      it("should not detect flat .md files as inline subagent candidates", async () => {
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "CLAUDE.md"),
          "# My Profile\n",
        );

        // Flat .md subagent (not a candidate)
        const subagentsDir = path.join(skillsetDir, "subagents");
        await fs.mkdir(subagentsDir, { recursive: true });
        await fs.writeFile(
          path.join(subagentsDir, "flat-agent.md"),
          "# Flat Agent\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");
        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );
        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
          silent: true,
        });

        expect(result.success).toBe(true);

        const uploadCall = vi.mocked(registrarApi.uploadSkillset).mock
          .calls[0][0];
        expect(uploadCall.inlineSubagents).toBeUndefined();
      });

      it("should not detect directories without SUBAGENT.md as subagent candidates", async () => {
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "CLAUDE.md"),
          "# My Profile\n",
        );

        // Directory without SUBAGENT.md (not a candidate)
        const randomDir = path.join(skillsetDir, "subagents", "random-dir");
        await fs.mkdir(randomDir, { recursive: true });
        await fs.writeFile(
          path.join(randomDir, "README.md"),
          "# Not a subagent\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");
        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );
        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
          silent: true,
        });

        expect(result.success).toBe(true);

        const uploadCall = vi.mocked(registrarApi.uploadSkillset).mock
          .calls[0][0];
        expect(uploadCall.inlineSubagents).toBeUndefined();
      });

      it("should include previously-inlined subagents on re-upload", async () => {
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "CLAUDE.md"),
          "# My Profile\n",
        );

        // Previously-inlined subagent
        const subagentDir = path.join(skillsetDir, "subagents", "my-agent");
        await fs.mkdir(subagentDir, { recursive: true });
        await fs.writeFile(
          path.join(subagentDir, "SUBAGENT.md"),
          "---\nname: My Agent\ndescription: A test agent\n---\n# My Agent\n",
        );
        await fs.writeFile(
          path.join(subagentDir, "nori.json"),
          JSON.stringify({
            name: "my-agent",
            version: "1.0.0",
            type: "inlined-subagent",
          }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");
        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );
        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
          silent: true,
        });

        expect(result.success).toBe(true);

        const uploadCall = vi.mocked(registrarApi.uploadSkillset).mock
          .calls[0][0];
        expect(uploadCall.inlineSubagents).toEqual(["my-agent"]);
      });

      it("should backfill type on subagent nori.json during upload", async () => {
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "CLAUDE.md"),
          "# My Profile\n",
        );

        // Subagent with nori.json missing type field
        const subagentDir = path.join(skillsetDir, "subagents", "my-agent");
        await fs.mkdir(subagentDir, { recursive: true });
        await fs.writeFile(
          path.join(subagentDir, "SUBAGENT.md"),
          "---\nname: My Agent\ndescription: A test agent\n---\n# My Agent\n",
        );
        await fs.writeFile(
          path.join(subagentDir, "nori.json"),
          JSON.stringify({ name: "my-agent", version: "1.0.0" }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");
        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );
        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
          silent: true,
        });

        // Verify nori.json was backfilled with type "subagent"
        const noriJsonContent = await fs.readFile(
          path.join(subagentDir, "nori.json"),
          "utf-8",
        );
        const metadata = JSON.parse(noriJsonContent);
        expect(metadata.type).toBe("subagent");
      });

      it("should create nori.json with type inlined-subagent for inline subagent candidates", async () => {
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "CLAUDE.md"),
          "# My Profile\n",
        );

        const subagentDir = path.join(skillsetDir, "subagents", "my-agent");
        await fs.mkdir(subagentDir, { recursive: true });
        await fs.writeFile(
          path.join(subagentDir, "SUBAGENT.md"),
          "---\nname: My Agent\ndescription: A test agent\n---\n# My Agent\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");
        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );
        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        // User chooses inline for the subagent
        vi.mocked(clack.select).mockResolvedValueOnce("inline");

        await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        // Verify nori.json was created for the inline subagent
        const noriJsonContent = await fs.readFile(
          path.join(subagentDir, "nori.json"),
          "utf-8",
        );
        const metadata = JSON.parse(noriJsonContent);
        expect(metadata.type).toBe("inlined-subagent");
      });

      it("should not prompt for inline subagents when no subagents directory exists", async () => {
        // Create a profile without subagents directory
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "CLAUDE.md"),
          "# My Profile\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");
        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );
        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // No inlineSubagents should be sent when there are no candidates
        const uploadCall = vi.mocked(registrarApi.uploadSkillset).mock
          .calls[0][0];
        expect(uploadCall.inlineSubagents).toBeUndefined();
      });

      it("should skip inline subagents prompt in non-interactive mode and extract all", async () => {
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "CLAUDE.md"),
          "# My Profile\n",
        );

        // Directory-based subagent without nori.json (inline candidate)
        const subagentDir = path.join(skillsetDir, "subagents", "my-agent");
        await fs.mkdir(subagentDir, { recursive: true });
        await fs.writeFile(
          path.join(subagentDir, "SUBAGENT.md"),
          "---\nname: My Agent\ndescription: A test agent\n---\n# My Agent\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");
        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );
        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
          nonInteractive: true,
        });

        expect(result.success).toBe(true);

        // In non-interactive mode, no inlineSubagents sent (extract all)
        const uploadCall = vi.mocked(registrarApi.uploadSkillset).mock
          .calls[0][0];
        expect(uploadCall.inlineSubagents).toBeUndefined();
      });

      it("should not pass inlineSubagents when user selects extract for each subagent", async () => {
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "CLAUDE.md"),
          "# My Profile\n",
        );

        const subagentDir = path.join(skillsetDir, "subagents", "my-agent");
        await fs.mkdir(subagentDir, { recursive: true });
        await fs.writeFile(
          path.join(subagentDir, "SUBAGENT.md"),
          "---\nname: My Agent\ndescription: A test agent\n---\n# My Agent\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");
        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );
        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        // User chooses "extract" for the subagent
        vi.mocked(clack.select).mockResolvedValueOnce("extract");

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // No inlineSubagents should be sent when all are extracted
        const uploadCall = vi.mocked(registrarApi.uploadSkillset).mock
          .calls[0][0];
        expect(uploadCall.inlineSubagents).toBeUndefined();

        // nori.json should be created with type "subagent" (extract type)
        const noriJsonContent = await fs.readFile(
          path.join(subagentDir, "nori.json"),
          "utf-8",
        );
        const metadata = JSON.parse(noriJsonContent);
        expect(metadata.type).toBe("subagent");
      });

      it("should merge existing inlined subagents with new candidates", async () => {
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "CLAUDE.md"),
          "# My Profile\n",
        );

        // Previously-inlined subagent
        const inlinedSubagentDir = path.join(
          skillsetDir,
          "subagents",
          "existing-agent",
        );
        await fs.mkdir(inlinedSubagentDir, { recursive: true });
        await fs.writeFile(
          path.join(inlinedSubagentDir, "SUBAGENT.md"),
          "---\nname: Existing Agent\ndescription: Previously inlined\n---\n# Existing Agent\n",
        );
        await fs.writeFile(
          path.join(inlinedSubagentDir, "nori.json"),
          JSON.stringify({
            name: "existing-agent",
            version: "1.0.0",
            type: "inlined-subagent",
          }),
        );

        // New subagent without nori.json (candidate)
        const newSubagentDir = path.join(skillsetDir, "subagents", "new-agent");
        await fs.mkdir(newSubagentDir, { recursive: true });
        await fs.writeFile(
          path.join(newSubagentDir, "SUBAGENT.md"),
          "---\nname: New Agent\ndescription: New candidate\n---\n# New Agent\n",
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");
        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );
        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        // User chooses "inline" for the new candidate
        vi.mocked(clack.select).mockResolvedValueOnce("inline");

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
        });

        expect(result.success).toBe(true);

        // Both existing inlined and new inline candidate should be in inlineSubagents
        const uploadCall = vi.mocked(registrarApi.uploadSkillset).mock
          .calls[0][0];
        expect(uploadCall.inlineSubagents).toEqual(
          expect.arrayContaining(["existing-agent", "new-agent"]),
        );
        expect(uploadCall.inlineSubagents).toHaveLength(2);
      });
    });

    describe("CLAUDE.md to AGENTS.md migration on upload", () => {
      it("should rename CLAUDE.md to AGENTS.md before uploading", async () => {
        // Create a profile with legacy CLAUDE.md (no AGENTS.md)
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "CLAUDE.md"),
          "# Legacy config\n",
        );
        await fs.writeFile(
          path.join(skillsetDir, "nori.json"),
          JSON.stringify({
            name: "my-profile",
            version: "1.0.0",
            type: "skillset",
          }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        // Capture the uploaded archive data
        let capturedArchiveData: ArrayBuffer | null = null;
        vi.mocked(registrarApi.uploadSkillset).mockImplementation(
          async (uploadArgs) => {
            capturedArchiveData = uploadArgs.archiveData;
            return {
              name: "my-profile",
              version: "1.0.0",
              tarballSha: "abc123",
              createdAt: new Date().toISOString(),
            };
          },
        );

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
          silent: true,
        });

        expect(result.success).toBe(true);

        // Local directory should now have AGENTS.md, not CLAUDE.md
        const agentsExists = await fs
          .access(path.join(skillsetDir, "AGENTS.md"))
          .then(() => true)
          .catch(() => false);
        const claudeExists = await fs
          .access(path.join(skillsetDir, "CLAUDE.md"))
          .then(() => true)
          .catch(() => false);

        expect(agentsExists).toBe(true);
        expect(claudeExists).toBe(false);

        // Verify the content was preserved
        const content = await fs.readFile(
          path.join(skillsetDir, "AGENTS.md"),
          "utf-8",
        );
        expect(content).toBe("# Legacy config\n");

        // Verify the uploaded tarball contains AGENTS.md, not CLAUDE.md
        expect(capturedArchiveData).not.toBeNull();
        const tar = await import("tar");
        const extractDir = await fs.mkdtemp(
          path.join(tmpdir(), "tarball-extract-"),
        );

        try {
          const tarballBuffer = Buffer.from(capturedArchiveData!);
          const tarballPath = path.join(extractDir, "upload.tgz");
          await fs.writeFile(tarballPath, tarballBuffer);

          await tar.extract({
            file: tarballPath,
            cwd: extractDir,
          });

          const extractedFiles = await fs.readdir(extractDir, {
            recursive: true,
          });

          expect(extractedFiles).toContain("AGENTS.md");
          expect(extractedFiles).not.toContain("CLAUDE.md");
        } finally {
          await fs.rm(extractDir, { recursive: true, force: true });
        }
      });

      it("should not modify files when AGENTS.md already exists alongside CLAUDE.md", async () => {
        // Create a profile with both AGENTS.md and CLAUDE.md
        const skillsetDir = path.join(skillsetsDir, "myorg", "my-profile");
        await fs.mkdir(skillsetDir, { recursive: true });
        await fs.writeFile(
          path.join(skillsetDir, "AGENTS.md"),
          "# New config\n",
        );
        await fs.writeFile(
          path.join(skillsetDir, "CLAUDE.md"),
          "# Old config\n",
        );
        await fs.writeFile(
          path.join(skillsetDir, "nori.json"),
          JSON.stringify({
            name: "my-profile",
            version: "1.0.0",
            type: "skillset",
          }),
        );

        vi.mocked(loadConfig).mockResolvedValue({
          installDir: testDir,
          auth: {
            username: "test@example.com",
            refreshToken: "test-token",
            organizations: ["myorg"],
            organizationUrl: "https://myorg.tilework.tech",
          },
        });

        vi.mocked(getRegistryAuthToken).mockResolvedValue("auth-token");

        vi.mocked(registrarApi.getPackument).mockRejectedValue(
          new Error("Not found"),
        );

        vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
          name: "my-profile",
          version: "1.0.0",
          tarballSha: "abc123",
          createdAt: new Date().toISOString(),
        });

        const result = await registryUploadMain({
          profileSpec: "myorg/my-profile",
          cwd: testDir,
          silent: true,
        });

        expect(result.success).toBe(true);

        // Both files should still exist with original content
        const agentsContent = await fs.readFile(
          path.join(skillsetDir, "AGENTS.md"),
          "utf-8",
        );
        const claudeContent = await fs.readFile(
          path.join(skillsetDir, "CLAUDE.md"),
          "utf-8",
        );

        expect(agentsContent).toBe("# New config\n");
        expect(claudeContent).toBe("# Old config\n");
      });
    });
  });
});
