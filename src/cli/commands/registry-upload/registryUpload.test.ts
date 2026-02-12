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

// Mock the fetch utils for skill collision error
vi.mock("@/utils/fetch.js", () => ({
  isSkillCollisionError: vi.fn((err) => {
    return err && typeof err === "object" && "conflicts" in err;
  }),
  SkillCollisionError: class SkillCollisionError extends Error {
    conflicts: Array<unknown>;
    requiresVersions?: boolean;
    constructor(args: {
      message: string;
      conflicts: Array<unknown>;
      requiresVersions?: boolean;
    }) {
      super(args.message);
      this.conflicts = args.conflicts;
      this.requiresVersions = args.requiresVersions;
    }
  },
}));

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

// Mock console methods to capture output (for early validation errors before flow starts)
const mockConsoleLog = vi
  .spyOn(console, "log")
  .mockImplementation(() => undefined);
const mockConsoleError = vi
  .spyOn(console, "error")
  .mockImplementation(() => undefined);

import { registrarApi } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { loadConfig, getRegistryAuth } from "@/cli/config.js";
import { isSkillCollisionError } from "@/utils/fetch.js";

import { registryUploadMain } from "./registryUpload.js";

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
  let profilesDir: string;

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

    // Create test directory structure simulating a Nori installation
    testDir = await fs.mkdtemp(
      path.join(tmpdir(), "nori-registry-upload-test-"),
    );
    configPath = path.join(testDir, ".nori-config.json");
    profilesDir = path.join(testDir, ".nori", "profiles");

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
    await fs.mkdir(profilesDir, { recursive: true });
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

        const allErrorOutput = mockConsoleError.mock.calls
          .map((call) => call.join(" "))
          .join("\n");
        expect(allErrorOutput.toLowerCase()).toContain("invalid");
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

        const allErrorOutput = mockConsoleError.mock.calls
          .map((call) => call.join(" "))
          .join("\n");
        expect(allErrorOutput).toContain("not found");
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

        const allErrorOutput = mockConsoleError.mock.calls
          .map((call) => call.join(" "))
          .join("\n");
        expect(allErrorOutput).toContain("not found");
      });
    });

    describe("installation detection", () => {
      it("should fail when no installation found", async () => {
        const noInstallDir = await fs.mkdtemp(
          path.join(tmpdir(), "nori-no-install-"),
        );
        mockHomedir = noInstallDir;

        try {
          const result = await registryUploadMain({
            profileSpec: "my-profile",
            cwd: noInstallDir,
          });

          expect(result.success).toBe(false);

          const allErrorOutput = mockConsoleError.mock.calls
            .map((call) => call.join(" "))
            .join("\n");
          expect(allErrorOutput.toLowerCase()).toContain(
            "no nori installation",
          );
        } finally {
          await fs.rm(noInstallDir, { recursive: true, force: true });
        }
      });

      it("should fail when multiple installations found without --install-dir", async () => {
        // Create a nested installation
        const nestedDir = path.join(testDir, "nested");
        await fs.mkdir(nestedDir, { recursive: true });
        await fs.writeFile(
          path.join(nestedDir, ".nori-config.json"),
          JSON.stringify({ profile: { baseProfile: "test" } }),
        );

        // Set mock homedir to a directory without installation so home dir doesn't take precedence
        const emptyHomeDir = await fs.mkdtemp(
          path.join(tmpdir(), "nori-empty-home-"),
        );
        mockHomedir = emptyHomeDir;

        try {
          const result = await registryUploadMain({
            profileSpec: "my-profile",
            cwd: nestedDir,
          });

          expect(result.success).toBe(false);

          const allErrorOutput = mockConsoleError.mock.calls
            .map((call) => call.join(" "))
            .join("\n");
          expect(allErrorOutput.toLowerCase()).toContain("multiple");
        } finally {
          await fs.rm(emptyHomeDir, { recursive: true, force: true });
        }
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

        const allErrorOutput = mockConsoleError.mock.calls
          .map((call) => call.join(" "))
          .join("\n");
        expect(allErrorOutput.toLowerCase()).toContain("authentication");
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

        const allErrorOutput = mockConsoleError.mock.calls
          .map((call) => call.join(" "))
          .join("\n");
        expect(allErrorOutput).toContain("do not have access");
        expect(allErrorOutput).toContain("myorg");
      });

      it("should use unified auth when config.auth.organizations is present", async () => {
        // Create a profile to upload
        const profileDir = path.join(profilesDir, "myorg", "my-profile");
        await fs.mkdir(profileDir, { recursive: true });
        await fs.writeFile(
          path.join(profileDir, "CLAUDE.md"),
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
        const profileDir = path.join(profilesDir, "myorg", "my-profile");
        await fs.mkdir(profileDir, { recursive: true });
        await fs.writeFile(
          path.join(profileDir, "CLAUDE.md"),
          "# My Profile\n",
        );
        await fs.writeFile(
          path.join(profileDir, "package.json"),
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

        // Verify success message from clack prompts
        const clackOutput = getClackOutput();
        expect(clackOutput.toLowerCase()).toContain("uploaded");
        expect(clackOutput).toContain("my-profile@1.0.0");
      });

      it("should auto-bump version when not specified", async () => {
        // Create a profile to upload
        const profileDir = path.join(profilesDir, "myorg", "my-profile");
        await fs.mkdir(profileDir, { recursive: true });
        await fs.writeFile(
          path.join(profileDir, "CLAUDE.md"),
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
        const profileDir = path.join(profilesDir, "myorg", "my-profile");
        await fs.mkdir(profileDir, { recursive: true });
        await fs.writeFile(
          path.join(profileDir, "CLAUDE.md"),
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
        const profileDir = path.join(profilesDir, "myorg", "my-profile");
        await fs.mkdir(profileDir, { recursive: true });
        await fs.writeFile(
          path.join(profileDir, "CLAUDE.md"),
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
        const profileDir = path.join(profilesDir, "myorg", "my-profile");
        await fs.mkdir(profileDir, { recursive: true });
        await fs.writeFile(
          path.join(profileDir, "CLAUDE.md"),
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

        const allErrorOutput = mockConsoleError.mock.calls
          .map((call) => call.join(" "))
          .join("\n");
        expect(allErrorOutput).toContain("not found");
        expect(allErrorOutput).toContain("nonexistent-profile");
      });
    });

    describe("error handling", () => {
      it("should handle authentication failure gracefully", async () => {
        // Create a profile to upload
        const profileDir = path.join(profilesDir, "myorg", "my-profile");
        await fs.mkdir(profileDir, { recursive: true });
        await fs.writeFile(
          path.join(profileDir, "CLAUDE.md"),
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

        const allErrorOutput = mockConsoleError.mock.calls
          .map((call) => call.join(" "))
          .join("\n");
        expect(allErrorOutput.toLowerCase()).toContain("authentication failed");
      });

      it("should handle upload failure gracefully", async () => {
        // Create a profile to upload
        const profileDir = path.join(profilesDir, "myorg", "my-profile");
        await fs.mkdir(profileDir, { recursive: true });
        await fs.writeFile(
          path.join(profileDir, "CLAUDE.md"),
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
        const profileDir = path.join(profilesDir, "my-profile");
        await fs.mkdir(profileDir, { recursive: true });
        await fs.writeFile(
          path.join(profileDir, "CLAUDE.md"),
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

        const allErrorOutput = mockConsoleError.mock.calls
          .map((call) => call.join(" "))
          .join("\n");
        expect(allErrorOutput.toLowerCase()).toContain("no authentication");
      });
    });

    describe("--dry-run flag", () => {
      it("should show target version without uploading", async () => {
        // Create a profile to upload
        const profileDir = path.join(profilesDir, "myorg", "my-profile");
        await fs.mkdir(profileDir, { recursive: true });
        await fs.writeFile(
          path.join(profileDir, "CLAUDE.md"),
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
        const allOutput = mockConsoleLog.mock.calls
          .map((call) => call.join(" "))
          .join("\n");
        expect(allOutput.toLowerCase()).toContain("dry run");
        expect(allOutput).toContain("1.2.4"); // auto-bumped version
      });

      it("should display profile path and registry URL in dry-run", async () => {
        // Create a profile to upload
        const profileDir = path.join(profilesDir, "myorg", "my-profile");
        await fs.mkdir(profileDir, { recursive: true });
        await fs.writeFile(
          path.join(profileDir, "CLAUDE.md"),
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

        const allOutput = mockConsoleLog.mock.calls
          .map((call) => call.join(" "))
          .join("\n");
        expect(allOutput).toContain("myorg/my-profile");
        expect(allOutput).toContain("myorg.noriskillsets.dev");
      });

      it("should show 1.0.0 for new packages in dry-run", async () => {
        // Create a profile to upload
        const profileDir = path.join(profilesDir, "myorg", "new-profile");
        await fs.mkdir(profileDir, { recursive: true });
        await fs.writeFile(
          path.join(profileDir, "CLAUDE.md"),
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

        const allOutput = mockConsoleLog.mock.calls
          .map((call) => call.join(" "))
          .join("\n");
        expect(allOutput).toContain("1.0.0");
      });
    });

    describe("--description option", () => {
      it("should pass description to uploadSkillset API", async () => {
        // Create a profile to upload
        const profileDir = path.join(profilesDir, "myorg", "my-profile");
        await fs.mkdir(profileDir, { recursive: true });
        await fs.writeFile(
          path.join(profileDir, "CLAUDE.md"),
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
        const profileDir = path.join(profilesDir, "myorg", "my-profile");
        await fs.mkdir(profileDir, { recursive: true });
        await fs.writeFile(
          path.join(profileDir, "CLAUDE.md"),
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
        const profileDir = path.join(profilesDir, "myorg", "my-profile");
        await fs.mkdir(profileDir, { recursive: true });
        await fs.writeFile(
          path.join(profileDir, "CLAUDE.md"),
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
        const profileDir = path.join(profilesDir, "myorg", "my-profile");
        await fs.mkdir(profileDir, { recursive: true });
        await fs.writeFile(
          path.join(profileDir, "CLAUDE.md"),
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
        const profileDir = path.join(profilesDir, "myorg", "my-profile");
        await fs.mkdir(profileDir, { recursive: true });
        await fs.writeFile(
          path.join(profileDir, "CLAUDE.md"),
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
        const profileDir = path.join(profilesDir, "myorg", "my-profile");
        await fs.mkdir(profileDir, { recursive: true });
        await fs.writeFile(
          path.join(profileDir, "CLAUDE.md"),
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
        const profileDir = path.join(profilesDir, "myorg", "my-profile");
        await fs.mkdir(profileDir, { recursive: true });
        await fs.writeFile(
          path.join(profileDir, "CLAUDE.md"),
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
        const profileDir = path.join(profilesDir, "myorg", "my-profile");
        await fs.mkdir(profileDir, { recursive: true });
        await fs.writeFile(
          path.join(profileDir, "CLAUDE.md"),
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
        const profileDir = path.join(profilesDir, "myorg", "my-profile");
        await fs.mkdir(profileDir, { recursive: true });
        await fs.writeFile(
          path.join(profileDir, "CLAUDE.md"),
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
        const profileDir = path.join(profilesDir, "myorg", "my-profile");
        await fs.mkdir(profileDir, { recursive: true });
        await fs.writeFile(
          path.join(profileDir, "CLAUDE.md"),
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
  });
});
