/**
 * Tests for skill-upload CLI command
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import * as tar from "tar";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Track the mock homedir value - set in beforeEach to the test's tmp dir
let mockHomedir = "";

// Mock os.homedir so getNoriSkillsetsDir() resolves under the test dir
vi.mock("os", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    homedir: () => mockHomedir,
  };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    homedir: () => mockHomedir,
  };
});

// Mock the registrar API
vi.mock("@/api/registrar.js", () => ({
  REGISTRAR_URL: "https://noriskillsets.dev",
  registrarApi: {
    uploadSkill: vi.fn(),
    getSkillPackument: vi.fn(),
    downloadSkillTarball: vi.fn(),
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
      args.config?.activeSkillset ?? null,
    getDefaultAgents: actual.getDefaultAgents,
  };
});

// Mock the registry auth module
vi.mock("@/api/registryAuth.js", () => ({
  getRegistryAuthToken: vi.fn(),
}));

// Track select/text return values per call
let selectReturnValues: Array<unknown> = [];
let textReturnValues: Array<string> = [];

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  confirm: vi.fn(() => Promise.resolve(false)),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
  })),
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
    step: vi.fn(),
  },
  select: vi.fn(() => {
    const v = selectReturnValues.shift();
    return Promise.resolve(v);
  }),
  text: vi.fn(() => {
    const v = textReturnValues.shift();
    return Promise.resolve(v);
  }),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}));

// Suppress stray console output
vi.spyOn(console, "log").mockImplementation(() => undefined);
vi.spyOn(console, "error").mockImplementation(() => undefined);

import { registrarApi } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { loadConfig, getRegistryAuth } from "@/cli/config.js";

import { skillUploadMain } from "./skillUpload.js";

/**
 * Create a local skill directory inside the simulated ~/.nori/profiles/<skillset>/skills/<skillName>
 *
 * @param args - Arguments
 * @param args.skillsetName - Skillset directory name
 * @param args.skillName - Skill directory name
 * @param args.skillMdContent - Contents for SKILL.md (defaults to a minimal valid skill)
 * @param args.noriJson - Contents for the skill's nori.json; pass null to omit the file
 *
 * @returns The absolute path to the skill directory
 */
const createLocalSkill = async (args: {
  skillsetName: string;
  skillName: string;
  skillMdContent?: string;
  noriJson?: Record<string, unknown> | null;
}): Promise<string> => {
  const { skillsetName, skillName, skillMdContent, noriJson } = args;
  const skillsetDir = path.join(mockHomedir, ".nori", "profiles", skillsetName);
  const skillDir = path.join(skillsetDir, "skills", skillName);
  await fs.mkdir(skillDir, { recursive: true });

  // Create the skillset nori.json marker so parseSkillset resolves the skillset
  const skillsetNoriJsonPath = path.join(skillsetDir, "nori.json");
  try {
    await fs.access(skillsetNoriJsonPath);
  } catch {
    await fs.writeFile(
      skillsetNoriJsonPath,
      JSON.stringify(
        { name: skillsetName, version: "1.0.0", type: "skillset" },
        null,
        2,
      ),
    );
  }

  const md =
    skillMdContent ??
    `---\nname: ${skillName}\ndescription: Test skill description\n---\n\n# ${skillName}\n\nSome content.\n`;
  await fs.writeFile(path.join(skillDir, "SKILL.md"), md);

  if (noriJson !== null) {
    const defaultNoriJson = {
      name: skillName,
      version: "1.0.0",
      type: "skill",
      description: "Test skill description",
    };
    await fs.writeFile(
      path.join(skillDir, "nori.json"),
      JSON.stringify(noriJson ?? defaultNoriJson, null, 2),
    );
  }

  return skillDir;
};

/**
 * Create a gzipped tarball containing a SKILL.md with the given content. Used to
 * simulate an existing remote skill tarball for diffing.
 *
 * @param args - Arguments
 * @param args.skillMdContent - Contents to embed as SKILL.md
 *
 * @returns Tarball as ArrayBuffer
 */
const createMockSkillTarball = async (args: {
  skillMdContent: string;
}): Promise<ArrayBuffer> => {
  const { skillMdContent } = args;
  const tempDir = await fs.mkdtemp(
    path.join(tmpdir(), "skill-upload-remote-tarball-"),
  );
  const tarballPath = path.join(
    tmpdir(),
    `remote-skill-${Date.now()}-${Math.random().toString(36).slice(2)}.tgz`,
  );
  try {
    await fs.writeFile(path.join(tempDir, "SKILL.md"), skillMdContent);
    tar.create({ gzip: true, file: tarballPath, cwd: tempDir, sync: true }, [
      "SKILL.md",
    ]);
    const buffer = await fs.readFile(tarballPath);
    const arrayBuffer = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(arrayBuffer).set(buffer);
    return arrayBuffer;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.unlink(tarballPath).catch(() => undefined);
  }
};

/**
 * Standard logged-in config used by tests that expect upload to succeed.
 *
 * @param activeSkillset - Name of the active skillset, or null for none
 *
 * @returns A Config-shaped object with fake auth credentials
 */
const authenticatedConfig = (activeSkillset: string | null) => ({
  activeSkillset,
  auth: {
    username: "tester",
    refreshToken: "rt-test",
    apiToken: null,
    organizations: [],
  },
});

describe("skill-upload", () => {
  let testDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    selectReturnValues = [];
    textReturnValues = [];

    testDir = await fs.mkdtemp(path.join(tmpdir(), "nori-skill-upload-test-"));
    mockHomedir = testDir;

    // Default auth mocks — individual tests can override
    vi.mocked(getRegistryAuth).mockReturnValue(null as never);
    vi.mocked(getRegistryAuthToken).mockResolvedValue("token-xyz" as never);
  });

  afterEach(async () => {
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  describe("skillUploadMain", () => {
    it("uploads a new skill (no remote collision) with version 1.0.0", async () => {
      await createLocalSkill({
        skillsetName: "my-profile",
        skillName: "my-skill",
      });

      vi.mocked(loadConfig).mockResolvedValue(
        authenticatedConfig("my-profile") as never,
      );

      // Remote skill does not exist (404)
      vi.mocked(registrarApi.getSkillPackument).mockRejectedValue(
        Object.assign(new Error("Not found"), { statusCode: 404 }),
      );

      vi.mocked(registrarApi.uploadSkill).mockResolvedValue({
        name: "my-skill",
        version: "1.0.0",
        tarballSha: "sha512-xyz",
        createdAt: "2026-04-16T00:00:00.000Z",
      } as never);

      const result = await skillUploadMain({ skillSpec: "my-skill" });

      expect(result.success).toBe(true);
      expect(registrarApi.uploadSkill).toHaveBeenCalledTimes(1);
      const uploadCall = vi.mocked(registrarApi.uploadSkill).mock.calls[0][0];
      expect(uploadCall.skillName).toBe("my-skill");
      expect(uploadCall.version).toBe("1.0.0");

      expect(result.message).toContain("my-skill");
      expect(result.message).toContain("1.0.0");
    });

    it("resolves skill from --skillset flag instead of active skillset", async () => {
      await createLocalSkill({
        skillsetName: "other-profile",
        skillName: "other-skill",
      });

      vi.mocked(loadConfig).mockResolvedValue(
        authenticatedConfig("my-profile") as never,
      );

      vi.mocked(registrarApi.getSkillPackument).mockRejectedValue(
        Object.assign(new Error("Not found"), { statusCode: 404 }),
      );
      vi.mocked(registrarApi.uploadSkill).mockResolvedValue({
        name: "other-skill",
        version: "1.0.0",
        tarballSha: "sha",
        createdAt: "2026-04-16T00:00:00.000Z",
      } as never);

      const result = await skillUploadMain({
        skillSpec: "other-skill",
        skillset: "other-profile",
      });

      expect(result.success).toBe(true);
      expect(registrarApi.uploadSkill).toHaveBeenCalledTimes(1);
    });

    it("treats identical remote content as already up to date (no upload)", async () => {
      const skillMd = `---\nname: stable-skill\ndescription: d\n---\n\n# stable-skill\nSame content.\n`;
      await createLocalSkill({
        skillsetName: "my-profile",
        skillName: "stable-skill",
        skillMdContent: skillMd,
      });

      vi.mocked(loadConfig).mockResolvedValue(
        authenticatedConfig("my-profile") as never,
      );

      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "stable-skill",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "stable-skill", version: "1.0.0" } },
      } as never);
      vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(
        await createMockSkillTarball({ skillMdContent: skillMd }),
      );

      const result = await skillUploadMain({ skillSpec: "stable-skill" });

      expect(result.success).toBe(true);
      expect(registrarApi.uploadSkill).not.toHaveBeenCalled();
      expect(result.message.toLowerCase()).toContain("up to date");
    });

    it("on content-differs collision, prompts user and uploads with bumped version when accepted", async () => {
      await createLocalSkill({
        skillsetName: "my-profile",
        skillName: "conflicted-skill",
        skillMdContent: `---\nname: conflicted-skill\n---\n\nLOCAL content\n`,
      });

      vi.mocked(loadConfig).mockResolvedValue(
        authenticatedConfig("my-profile") as never,
      );

      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "conflicted-skill",
        "dist-tags": { latest: "1.2.3" },
        versions: { "1.2.3": { name: "conflicted-skill", version: "1.2.3" } },
      } as never);
      vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(
        await createMockSkillTarball({
          skillMdContent: `---\nname: conflicted-skill\n---\n\nREMOTE content\n`,
        }),
      );
      vi.mocked(registrarApi.uploadSkill).mockResolvedValue({
        name: "conflicted-skill",
        version: "1.2.4",
        tarballSha: "sha",
        createdAt: "2026-04-16T00:00:00.000Z",
      } as never);

      // User picks "bump" then accepts default next version
      selectReturnValues = ["bump"];
      textReturnValues = ["1.2.4"];

      const result = await skillUploadMain({ skillSpec: "conflicted-skill" });

      expect(result.success).toBe(true);
      expect(registrarApi.uploadSkill).toHaveBeenCalledTimes(1);
      const uploadCall = vi.mocked(registrarApi.uploadSkill).mock.calls[0][0];
      expect(uploadCall.version).toBe("1.2.4");
    });

    it("on content-differs collision, cancelling leaves skill un-uploaded", async () => {
      await createLocalSkill({
        skillsetName: "my-profile",
        skillName: "conflicted-skill",
        skillMdContent: `---\nname: conflicted-skill\n---\n\nLOCAL content\n`,
      });

      vi.mocked(loadConfig).mockResolvedValue(
        authenticatedConfig("my-profile") as never,
      );

      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "conflicted-skill",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "conflicted-skill", version: "1.0.0" } },
      } as never);
      vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(
        await createMockSkillTarball({
          skillMdContent: `---\nname: conflicted-skill\n---\n\nREMOTE content\n`,
        }),
      );

      selectReturnValues = ["cancel"];

      const result = await skillUploadMain({ skillSpec: "conflicted-skill" });

      expect(result.success).toBe(false);
      expect(result.cancelled).toBe(true);
      expect(registrarApi.uploadSkill).not.toHaveBeenCalled();
    });

    it("on content-differs collision, user can view diff then resolve", async () => {
      await createLocalSkill({
        skillsetName: "my-profile",
        skillName: "diffable-skill",
        skillMdContent: `---\nname: diffable-skill\n---\n\nLOCAL content\n`,
      });

      vi.mocked(loadConfig).mockResolvedValue(
        authenticatedConfig("my-profile") as never,
      );

      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "diffable-skill",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "diffable-skill", version: "1.0.0" } },
      } as never);
      vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(
        await createMockSkillTarball({
          skillMdContent: `---\nname: diffable-skill\n---\n\nREMOTE content\n`,
        }),
      );
      vi.mocked(registrarApi.uploadSkill).mockResolvedValue({
        name: "diffable-skill",
        version: "1.0.1",
        tarballSha: "sha",
        createdAt: "2026-04-16T00:00:00.000Z",
      } as never);

      // User picks "viewDiff" first, then "bump", then accepts default version
      selectReturnValues = ["viewDiff", "bump"];
      textReturnValues = ["1.0.1"];

      const result = await skillUploadMain({ skillSpec: "diffable-skill" });

      // The user chose viewDiff first, then bump. Successful resolution proves
      // the flow accepted the diff action and looped back to the select prompt.
      expect(result.success).toBe(true);
      const uploadCall = vi.mocked(registrarApi.uploadSkill).mock.calls[0][0];
      expect(uploadCall.version).toBe("1.0.1");
    });

    it("errors when the local skill is not found", async () => {
      vi.mocked(loadConfig).mockResolvedValue(
        authenticatedConfig("my-profile") as never,
      );

      // Create skillset dir but no skill subdirectory
      await fs.mkdir(
        path.join(mockHomedir, ".nori", "profiles", "my-profile"),
        { recursive: true },
      );
      await fs.writeFile(
        path.join(mockHomedir, ".nori", "profiles", "my-profile", "nori.json"),
        JSON.stringify({
          name: "my-profile",
          version: "1.0.0",
          type: "skillset",
        }),
      );

      const result = await skillUploadMain({ skillSpec: "missing-skill" });

      expect(result.success).toBe(false);
      expect(registrarApi.uploadSkill).not.toHaveBeenCalled();
      expect(result.message.toLowerCase()).toContain("not found");
    });

    it("errors when no active skillset is set and --skillset is omitted", async () => {
      vi.mocked(loadConfig).mockResolvedValue({} as never);

      const result = await skillUploadMain({ skillSpec: "any-skill" });

      expect(result.success).toBe(false);
      expect(registrarApi.uploadSkill).not.toHaveBeenCalled();
      expect(result.message.toLowerCase()).toMatch(
        /active skillset|--skillset/,
      );
    });

    it("blocks uploading a skill marked as type=inlined-skill", async () => {
      await createLocalSkill({
        skillsetName: "my-profile",
        skillName: "inline-skill",
        noriJson: {
          name: "inline-skill",
          version: "1.0.0",
          type: "inlined-skill",
        },
      });

      vi.mocked(loadConfig).mockResolvedValue(
        authenticatedConfig("my-profile") as never,
      );

      const result = await skillUploadMain({ skillSpec: "inline-skill" });

      expect(result.success).toBe(false);
      expect(registrarApi.uploadSkill).not.toHaveBeenCalled();
      expect(result.message.toLowerCase()).toContain("inline");
    });

    it("uses default description from skill nori.json when --description is not passed", async () => {
      await createLocalSkill({
        skillsetName: "my-profile",
        skillName: "described-skill",
        noriJson: {
          name: "described-skill",
          version: "1.0.0",
          type: "skill",
          description: "A lovely skill from nori.json",
        },
      });

      vi.mocked(loadConfig).mockResolvedValue(
        authenticatedConfig("my-profile") as never,
      );

      vi.mocked(registrarApi.getSkillPackument).mockRejectedValue(
        Object.assign(new Error("not found"), { statusCode: 404 }),
      );
      vi.mocked(registrarApi.uploadSkill).mockResolvedValue({
        name: "described-skill",
        version: "1.0.0",
        tarballSha: "sha",
        createdAt: "2026-04-16T00:00:00.000Z",
      } as never);

      await skillUploadMain({ skillSpec: "described-skill" });

      const uploadCall = vi.mocked(registrarApi.uploadSkill).mock.calls[0][0];
      expect(uploadCall.description).toBe("A lovely skill from nori.json");
    });

    it("uploads a namespaced skill when authenticated via API token (no refreshToken)", async () => {
      await createLocalSkill({
        skillsetName: "my-profile",
        skillName: "my-skill",
      });

      // API-token login: refreshToken null, apiToken set, organizations populated.
      vi.mocked(loadConfig).mockResolvedValue({
        activeSkillset: "my-profile",
        auth: {
          username: null,
          organizationUrl: "https://myorg.noriskillsets.dev",
          refreshToken: null,
          apiToken:
            "nori_myorg_0000000000000000000000000000000000000000000000000000000000000000",
          organizations: ["myorg"],
        },
      } as never);

      vi.mocked(getRegistryAuthToken).mockResolvedValue(
        "api-token-auth" as never,
      );

      vi.mocked(registrarApi.getSkillPackument).mockRejectedValue(
        Object.assign(new Error("Not found"), { statusCode: 404 }),
      );
      vi.mocked(registrarApi.uploadSkill).mockResolvedValue({
        name: "my-skill",
        version: "1.0.0",
        tarballSha: "sha",
        createdAt: "2026-04-16T00:00:00.000Z",
      } as never);

      const result = await skillUploadMain({ skillSpec: "myorg/my-skill" });

      expect(result.success).toBe(true);
      // Upload hit the org registry with API-token-derived auth.
      expect(registrarApi.uploadSkill).toHaveBeenCalledTimes(1);
      const uploadCall = vi.mocked(registrarApi.uploadSkill).mock.calls[0][0];
      expect(uploadCall.registryUrl).toBe("https://myorg.noriskillsets.dev");
      expect(uploadCall.authToken).toBe("api-token-auth");
    });

    it("syncs the local skill nori.json version after a successful upload", async () => {
      const skillDir = await createLocalSkill({
        skillsetName: "my-profile",
        skillName: "synced-skill",
        noriJson: {
          name: "synced-skill",
          version: "1.0.0",
          type: "skill",
          description: "desc",
        },
      });

      vi.mocked(loadConfig).mockResolvedValue(
        authenticatedConfig("my-profile") as never,
      );

      vi.mocked(registrarApi.getSkillPackument).mockRejectedValue(
        Object.assign(new Error("not found"), { statusCode: 404 }),
      );
      vi.mocked(registrarApi.uploadSkill).mockResolvedValue({
        name: "synced-skill",
        version: "1.0.0",
        tarballSha: "sha",
        createdAt: "2026-04-16T00:00:00.000Z",
      } as never);

      await skillUploadMain({
        skillSpec: "synced-skill",
        version: "2.0.0",
      });

      const updatedNoriJson = JSON.parse(
        await fs.readFile(path.join(skillDir, "nori.json"), "utf-8"),
      );
      expect(updatedNoriJson.version).toBe("2.0.0");
    });
  });
});
