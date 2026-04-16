/**
 * Tests for subagent-download CLI command
 */

import * as fs from "fs/promises";
import * as os from "os";
import { tmpdir } from "os";
import * as path from "path";

import * as clack from "@clack/prompts";
import * as tar from "tar";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock os.homedir so getNoriSkillsetsDir resolves to the test directory
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

// Mock the registrar API
vi.mock("@/api/registrar.js", () => ({
  REGISTRAR_URL: "https://registrar.tilework.tech",
  registrarApi: {
    getSubagentPackument: vi.fn(),
    downloadSubagentTarball: vi.fn(),
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
vi.mock("@/cli/config.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    loadConfig: vi.fn(),
    getRegistryAuth: vi.fn(),
    getActiveSkillset: (args: { config: { activeSkillset?: string | null } }) =>
      args.config.activeSkillset ?? null,
    getDefaultAgents: actual.getDefaultAgents,
  };
});

// Mock the registry auth module
vi.mock("@/api/registryAuth.js", () => ({
  getRegistryAuthToken: vi.fn(),
}));

// Mock @clack/prompts to capture flow output
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  confirm: vi.fn(() => false),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
  })),
  note: vi.fn(),
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}));

// Suppress direct console output from logger
vi.spyOn(console, "log").mockImplementation(() => undefined);
vi.spyOn(console, "error").mockImplementation(() => undefined);

import { registrarApi, REGISTRAR_URL } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { loadConfig } from "@/cli/config.js";

import { subagentDownloadMain } from "./subagentDownload.js";

const getClackLogOutput = (): string => {
  const parts: Array<string> = [];
  for (const call of vi.mocked(clack.outro).mock.calls) {
    parts.push(String(call[0]));
  }
  for (const call of vi.mocked(clack.note).mock.calls) {
    parts.push(String(call[0]));
    if (call[1] != null) parts.push(String(call[1]));
  }
  for (const call of vi.mocked(clack.log.success).mock.calls) {
    parts.push(String(call[0]));
  }
  for (const call of vi.mocked(clack.log.info).mock.calls) {
    parts.push(String(call[0]));
  }
  for (const call of vi.mocked(clack.log.message).mock.calls) {
    parts.push(String(call[0]));
  }
  return parts.join("\n");
};

const getClackErrorOutput = (): string => {
  const parts: Array<string> = [];
  for (const call of vi.mocked(clack.log.error).mock.calls) {
    parts.push(String(call[0]));
  }
  for (const call of vi.mocked(clack.note).mock.calls) {
    if (call[1] === "Hint") {
      parts.push(String(call[0]));
    }
  }
  return parts.join("\n");
};

const createManagedBlockMarker = async (dir: string): Promise<void> => {
  const claudeDir = path.join(dir, ".claude");
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.writeFile(
    path.join(claudeDir, "CLAUDE.md"),
    "# BEGIN NORI-AI MANAGED BLOCK\n# END NORI-AI MANAGED BLOCK\n",
  );
};

describe("subagent-download", () => {
  let testDir: string;
  let agentsDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    vi.mocked(clack.spinner).mockReturnValue({
      start: vi.fn(),
      stop: vi.fn(),
      message: vi.fn(),
    } as any);

    testDir = await fs.mkdtemp(
      path.join(tmpdir(), "nori-subagent-download-test-"),
    );
    // Subagents install to .claude/agents/ (the agents dir)
    agentsDir = path.join(testDir, ".claude", "agents");

    await fs.writeFile(
      path.join(testDir, ".nori-config.json"),
      JSON.stringify({
        profile: {
          activeSkillset: "senior-swe",
        },
      }),
    );

    await createManagedBlockMarker(testDir);
    await fs.mkdir(agentsDir, { recursive: true });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  describe("subagentDownloadMain", () => {
    it("should download subagent and flatten SUBAGENT.md to agents dir", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
      });

      vi.mocked(registrarApi.getSubagentPackument).mockResolvedValue({
        name: "test-subagent",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": { name: "test-subagent", version: "1.0.0" },
        },
      });

      const mockTarball = await createMockSubagentTarball();
      vi.mocked(registrarApi.downloadSubagentTarball).mockResolvedValue(
        mockTarball,
      );

      await subagentDownloadMain({
        subagentSpec: "test-subagent",
        cwd: testDir,
      });

      // Verify API was called
      expect(registrarApi.downloadSubagentTarball).toHaveBeenCalledWith({
        subagentName: "test-subagent",
        version: undefined,
        registryUrl: REGISTRAR_URL,
        authToken: undefined,
      });

      // Verify SUBAGENT.md was flattened to agents/test-subagent.md
      const agentFile = path.join(agentsDir, "test-subagent.md");
      const content = await fs.readFile(agentFile, "utf-8");
      expect(content).toContain("test-subagent");

      // Verify success message
      const allOutput = getClackLogOutput();
      expect(allOutput.toLowerCase()).toContain("download");
      expect(allOutput).toContain("test-subagent");
    });

    it("should extract full directory to skillset profile subagents dir", async () => {
      const skillsetsDir = path.join(testDir, ".nori", "profiles");
      const skillsetDir = path.join(skillsetsDir, "my-skillset");
      await fs.mkdir(skillsetDir, { recursive: true });
      await fs.writeFile(
        path.join(skillsetDir, "nori.json"),
        JSON.stringify({ name: "my-skillset", version: "1.0.0" }),
      );

      vi.mocked(os.homedir).mockReturnValue(testDir);
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        activeSkillset: "my-skillset",
      });

      vi.mocked(registrarApi.getSubagentPackument).mockResolvedValue({
        name: "test-subagent",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": { name: "test-subagent", version: "1.0.0" },
        },
      });

      const mockTarball = await createMockSubagentTarball();
      vi.mocked(registrarApi.downloadSubagentTarball).mockResolvedValue(
        mockTarball,
      );

      await subagentDownloadMain({
        subagentSpec: "test-subagent",
        cwd: testDir,
      });

      // Verify full directory was persisted to profile's subagents dir
      const profileSubagentDir = path.join(
        skillsetDir,
        "subagents",
        "test-subagent",
      );
      const subagentMd = await fs.readFile(
        path.join(profileSubagentDir, "SUBAGENT.md"),
        "utf-8",
      );
      expect(subagentMd).toContain("test-subagent");

      // Verify .nori-version was written
      const versionFilePath = path.join(profileSubagentDir, ".nori-version");
      const versionContent = await fs.readFile(versionFilePath, "utf-8");
      const versionInfo = JSON.parse(versionContent);
      expect(versionInfo.version).toBe("1.0.0");
      expect(versionInfo.registryUrl).toBe(REGISTRAR_URL);
    });

    it("should handle version specification", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
      });

      vi.mocked(registrarApi.getSubagentPackument).mockResolvedValue({
        name: "test-subagent",
        "dist-tags": { latest: "2.0.0" },
        versions: {
          "2.0.0": { name: "test-subagent", version: "2.0.0" },
        },
      });

      const mockTarball = await createMockSubagentTarball();
      vi.mocked(registrarApi.downloadSubagentTarball).mockResolvedValue(
        mockTarball,
      );

      await subagentDownloadMain({
        subagentSpec: "test-subagent@2.0.0",
        cwd: testDir,
      });

      expect(registrarApi.downloadSubagentTarball).toHaveBeenCalledWith({
        subagentName: "test-subagent",
        version: "2.0.0",
        registryUrl: REGISTRAR_URL,
        authToken: undefined,
      });
    });

    it("should handle download errors gracefully", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
      });

      vi.mocked(registrarApi.getSubagentPackument).mockResolvedValue({
        name: "test-subagent",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": { name: "test-subagent", version: "1.0.0" },
        },
      });

      vi.mocked(registrarApi.downloadSubagentTarball).mockRejectedValue(
        new Error("Network error: Failed to fetch"),
      );

      await subagentDownloadMain({
        subagentSpec: "test-subagent",
        cwd: testDir,
      });

      const allErrorOutput = getClackErrorOutput();
      expect(allErrorOutput.toLowerCase()).toContain("error");
      expect(allErrorOutput).toContain("Network error");
    });

    it("should download namespaced subagent when authenticated via API token (no refreshToken)", async () => {
      const orgRegistryUrl = "https://myorg.noriskillsets.dev";

      vi.mocked(os.homedir).mockReturnValue(testDir);

      // API-token login: refreshToken null, apiToken set, organizations populated.
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        auth: {
          username: null,
          organizationUrl: orgRegistryUrl,
          refreshToken: null,
          apiToken:
            "nori_myorg_0000000000000000000000000000000000000000000000000000000000000000",
          organizations: ["myorg"],
        },
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("api-token-auth");

      vi.mocked(registrarApi.getSubagentPackument).mockResolvedValue({
        name: "my-subagent",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "my-subagent", version: "1.0.0" } },
      });

      const mockTarball = await createMockSubagentTarball();
      vi.mocked(registrarApi.downloadSubagentTarball).mockResolvedValue(
        mockTarball,
      );

      await subagentDownloadMain({
        subagentSpec: "myorg/my-subagent",
        cwd: testDir,
      });

      // Verify download hit the org registry with API-token-derived auth.
      expect(registrarApi.downloadSubagentTarball).toHaveBeenCalledWith({
        subagentName: "my-subagent",
        version: undefined,
        registryUrl: orgRegistryUrl,
        authToken: "api-token-auth",
      });
    });

    it("should error when subagent exists without .nori-version", async () => {
      const skillsetsDir = path.join(testDir, ".nori", "profiles");
      const skillsetDir = path.join(skillsetsDir, "my-skillset");
      const subagentDir = path.join(skillsetDir, "subagents", "existing-sub");
      await fs.mkdir(subagentDir, { recursive: true });
      await fs.writeFile(
        path.join(skillsetDir, "nori.json"),
        JSON.stringify({ name: "my-skillset", version: "1.0.0" }),
      );
      await fs.writeFile(
        path.join(subagentDir, "SUBAGENT.md"),
        "# Existing Subagent",
      );

      vi.mocked(os.homedir).mockReturnValue(testDir);
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        activeSkillset: "my-skillset",
      });

      vi.mocked(registrarApi.getSubagentPackument).mockResolvedValue({
        name: "existing-sub",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": { name: "existing-sub", version: "1.0.0" },
        },
      });

      await subagentDownloadMain({
        subagentSpec: "existing-sub",
        cwd: testDir,
      });

      const allErrorOutput = getClackErrorOutput();
      expect(allErrorOutput.toLowerCase()).toContain("already exists");
    });
  });

  describe("nori.json updates on subagent download", () => {
    let skillsetsDir: string;

    beforeEach(async () => {
      skillsetsDir = path.join(testDir, ".nori", "profiles");
      await fs.mkdir(skillsetsDir, { recursive: true });
      vi.mocked(os.homedir).mockReturnValue(testDir);
    });

    it("should update dependencies.subagents in nori.json", async () => {
      const skillsetDir = path.join(skillsetsDir, "my-profile");
      await fs.mkdir(skillsetDir, { recursive: true });
      await fs.writeFile(
        path.join(skillsetDir, "nori.json"),
        JSON.stringify({
          name: "my-profile",
          version: "1.0.0",
          description: "Test profile",
        }),
      );

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        activeSkillset: "my-profile",
      });

      vi.mocked(registrarApi.getSubagentPackument).mockResolvedValue({
        name: "downloaded-sub",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": { name: "downloaded-sub", version: "1.0.0" },
        },
      });

      const mockTarball = await createMockSubagentTarball();
      vi.mocked(registrarApi.downloadSubagentTarball).mockResolvedValue(
        mockTarball,
      );

      await subagentDownloadMain({
        subagentSpec: "downloaded-sub",
        cwd: testDir,
      });

      const noriJsonPath = path.join(skillsetDir, "nori.json");
      const noriJsonContent = await fs.readFile(noriJsonPath, "utf-8");
      const noriJson = JSON.parse(noriJsonContent);
      expect(noriJson.dependencies?.subagents?.["downloaded-sub"]).toBe("*");
    });

    it("should preserve existing dependencies when adding new subagent", async () => {
      const skillsetDir = path.join(skillsetsDir, "deps-profile");
      await fs.mkdir(skillsetDir, { recursive: true });
      await fs.writeFile(
        path.join(skillsetDir, "nori.json"),
        JSON.stringify({
          name: "deps-profile",
          version: "2.0.0",
          dependencies: {
            skills: { "existing-skill": "^1.0.0" },
            subagents: { "existing-sub": "*" },
          },
        }),
      );

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        activeSkillset: "deps-profile",
      });

      vi.mocked(registrarApi.getSubagentPackument).mockResolvedValue({
        name: "new-sub",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "new-sub", version: "1.0.0" } },
      });

      const mockTarball = await createMockSubagentTarball();
      vi.mocked(registrarApi.downloadSubagentTarball).mockResolvedValue(
        mockTarball,
      );

      await subagentDownloadMain({
        subagentSpec: "new-sub",
        cwd: testDir,
      });

      const noriJsonPath = path.join(skillsetDir, "nori.json");
      const noriJsonContent = await fs.readFile(noriJsonPath, "utf-8");
      const noriJson = JSON.parse(noriJsonContent);
      expect(noriJson.dependencies.skills).toEqual({
        "existing-skill": "^1.0.0",
      });
      expect(noriJson.dependencies.subagents).toEqual({
        "existing-sub": "*",
        "new-sub": "*",
      });
    });
  });

  describe("multi-agent broadcasting", () => {
    let skillsetsDir: string;

    beforeEach(async () => {
      skillsetsDir = path.join(testDir, ".nori", "profiles");
      await fs.mkdir(skillsetsDir, { recursive: true });
      vi.mocked(os.homedir).mockReturnValue(testDir);
    });

    it("should install flattened subagent into all configured agents' agents directories", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        defaultAgents: ["claude-code", "cursor-agent"],
      });

      vi.mocked(registrarApi.getSubagentPackument).mockResolvedValue({
        name: "broadcast-sub",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": { name: "broadcast-sub", version: "1.0.0" },
        },
      });

      const mockTarball = await createMockSubagentTarball();
      vi.mocked(registrarApi.downloadSubagentTarball).mockResolvedValue(
        mockTarball,
      );

      await subagentDownloadMain({
        subagentSpec: "broadcast-sub",
        cwd: testDir,
      });

      // Verify subagent was flattened to claude-code's agents dir
      const claudeAgentFile = path.join(
        testDir,
        ".claude",
        "agents",
        "broadcast-sub.md",
      );
      const claudeContent = await fs.readFile(claudeAgentFile, "utf-8");
      expect(claudeContent).toContain("test-subagent");

      // Verify subagent was ALSO installed to cursor-agent's agents dir
      const cursorAgentFile = path.join(
        testDir,
        ".cursor",
        "agents",
        "broadcast-sub.md",
      );
      const cursorContent = await fs.readFile(cursorAgentFile, "utf-8");
      expect(cursorContent).toContain("test-subagent");
    });
  });
});

/**
 * Creates a minimal mock subagent tarball for testing.
 * The tarball contains a SUBAGENT.md file (the canonical subagent file).
 * @param args - The tarball options
 * @param args.gzip - Whether to gzip the tarball (default: false)
 * @param args.subagentContent - Optional custom SUBAGENT.md content
 *
 * @returns A valid tarball as ArrayBuffer
 */
const createMockSubagentTarball = async (args?: {
  gzip?: boolean | null;
  subagentContent?: string | null;
}): Promise<ArrayBuffer> => {
  const gzip = args?.gzip ?? false;
  const subagentContent =
    args?.subagentContent ??
    `---
name: test-subagent
description: A test subagent
---

# test-subagent

This is a test subagent.
`;
  const tempDir = await fs.mkdtemp(
    path.join(tmpdir(), "mock-subagent-tarball-source-"),
  );
  const tarballPath = path.join(
    tmpdir(),
    `mock-subagent-tarball-${Date.now()}.${gzip ? "tgz" : "tar"}`,
  );

  try {
    await fs.writeFile(path.join(tempDir, "SUBAGENT.md"), subagentContent);
    await fs.writeFile(
      path.join(tempDir, "nori.json"),
      JSON.stringify({
        name: "test-subagent",
        version: "1.0.0",
        type: "subagent",
      }),
    );

    tar.create(
      {
        gzip,
        file: tarballPath,
        cwd: tempDir,
        sync: true,
      },
      ["SUBAGENT.md", "nori.json"],
    );

    const tarballBuffer = await fs.readFile(tarballPath);
    const arrayBuffer = new ArrayBuffer(tarballBuffer.byteLength);
    new Uint8Array(arrayBuffer).set(tarballBuffer);
    return arrayBuffer;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    try {
      await fs.unlink(tarballPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }
};
