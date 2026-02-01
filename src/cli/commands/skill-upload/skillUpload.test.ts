/**
 * Tests for skill-upload CLI command
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the registrar API
vi.mock("@/api/registrar.js", () => ({
  REGISTRAR_URL: "https://noriskillsets.dev",
  registrarApi: {
    uploadSkill: vi.fn(),
    getSkillPackument: vi.fn(),
  },
}));

// Mock the config module - include getInstalledAgents with real implementation
vi.mock("@/cli/config.js", async () => {
  return {
    loadConfig: vi.fn(),
    getInstalledAgents: (args: {
      config: { agents?: Record<string, unknown> | null };
    }) => {
      const agents = Object.keys(args.config.agents ?? {});
      return agents.length > 0 ? agents : ["claude-code"];
    },
  };
});

// Mock the registry auth module
vi.mock("@/api/registryAuth.js", () => ({
  getRegistryAuthToken: vi.fn(),
}));

// Mock console methods to capture output
const mockConsoleLog = vi
  .spyOn(console, "log")
  .mockImplementation(() => undefined);
const mockConsoleError = vi
  .spyOn(console, "error")
  .mockImplementation(() => undefined);

import { registrarApi } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { loadConfig } from "@/cli/config.js";

import { skillUploadMain } from "./skillUpload.js";

describe("skill-upload", () => {
  let testDir: string;
  let configPath: string;
  let skillsDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test directory structure simulating a Nori installation
    testDir = await fs.mkdtemp(path.join(tmpdir(), "nori-skill-upload-test-"));
    configPath = path.join(testDir, ".nori-config.json");
    // Skills for upload are stored in .claude/skills (Claude native path)
    // NOT in .nori/skills - that global path no longer exists
    skillsDir = path.join(testDir, ".claude", "skills");

    // Create skills directory
    await fs.mkdir(skillsDir, { recursive: true });

    // Create initial config file so getInstallDirs can find it
    await fs.writeFile(
      configPath,
      JSON.stringify({
        profile: { baseProfile: "senior-swe" },
      }),
    );
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  const createTestSkill = async (args: {
    name: string;
    withSkillMd?: boolean | null;
    skillMdContent?: string | null;
  }): Promise<void> => {
    const { name, withSkillMd = true, skillMdContent } = args;
    const skillDir = path.join(skillsDir, name);
    await fs.mkdir(skillDir, { recursive: true });
    if (withSkillMd) {
      const content =
        skillMdContent ??
        `---
name: ${name}
description: A test skill
---

# ${name}

This is a test skill.
`;
      await fs.writeFile(path.join(skillDir, "SKILL.md"), content);
    }
  };

  describe("skillUploadMain", () => {
    it("should upload skill to single configured registry", async () => {
      await createTestSkill({ name: "test-skill" });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        auth: {
          username: "test@example.com",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "mock-refresh-token",
          organizations: ["public"],
        },
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.uploadSkill).mockResolvedValue({
        name: "test-skill",
        version: "1.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      await skillUploadMain({
        skillSpec: "test-skill",
        cwd: testDir,
      });

      // Verify API was called with correct registry
      expect(registrarApi.uploadSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          skillName: "test-skill",
          version: "1.0.0",
          authToken: "mock-auth-token",
          registryUrl: "https://noriskillsets.dev",
        }),
      );

      // Verify success message
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput.toLowerCase()).toContain("upload");
    });

    it("should upload skill with specified version", async () => {
      await createTestSkill({ name: "test-skill" });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        auth: {
          username: "test@example.com",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "mock-refresh-token",
          organizations: ["public"],
        },
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.uploadSkill).mockResolvedValue({
        name: "test-skill",
        version: "2.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      await skillUploadMain({
        skillSpec: "test-skill@2.0.0",
        cwd: testDir,
      });

      // Verify API was called with correct version
      expect(registrarApi.uploadSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          skillName: "test-skill",
          version: "2.0.0",
        }),
      );
    });

    it("should error when skill does not exist", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        auth: {
          username: "test@example.com",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "mock-refresh-token",
          organizations: ["public"],
        },
      });

      await skillUploadMain({
        skillSpec: "nonexistent-skill",
        cwd: testDir,
      });

      // Verify error message about not found
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("not found");
    });

    it("should NOT find skills in deprecated global .nori/skills/ path", async () => {
      // Create skill in the OLD global .nori/skills/ path (deprecated)
      const deprecatedSkillsDir = path.join(testDir, ".nori", "skills");
      const deprecatedSkillDir = path.join(deprecatedSkillsDir, "global-skill");
      await fs.mkdir(deprecatedSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(deprecatedSkillDir, "SKILL.md"),
        `---
name: Global Skill
description: Should not be found
---
# Global Skill
`,
      );

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        auth: {
          username: "test@example.com",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "mock-refresh-token",
          organizations: ["public"],
        },
      });

      await skillUploadMain({
        skillSpec: "global-skill",
        cwd: testDir,
      });

      // Should NOT find the skill - only looks in .claude/skills/
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("not found");

      // Should NOT attempt upload
      expect(registrarApi.uploadSkill).not.toHaveBeenCalled();
    });

    it("should error when skill directory has no SKILL.md", async () => {
      await createTestSkill({ name: "invalid-skill", withSkillMd: false });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        auth: {
          username: "test@example.com",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "mock-refresh-token",
          organizations: ["public"],
        },
      });

      await skillUploadMain({
        skillSpec: "invalid-skill",
        cwd: testDir,
      });

      // Verify error message about missing SKILL.md
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput).toContain("SKILL.md");
    });

    it("should error when no Nori installation found", async () => {
      // Create directory without .nori-config.json
      const noInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "nori-no-install-"),
      );

      try {
        await skillUploadMain({
          skillSpec: "test-skill",
          cwd: noInstallDir,
        });

        // Verify error message about no installation
        const allErrorOutput = mockConsoleError.mock.calls
          .map((call) => call.join(" "))
          .join("\n");
        expect(allErrorOutput.toLowerCase()).toContain("no");
        expect(allErrorOutput.toLowerCase()).toContain("installation");
      } finally {
        await fs.rm(noInstallDir, { recursive: true, force: true });
      }
    });

    it("should error when no registry auth configured", async () => {
      await createTestSkill({ name: "test-skill" });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
      });

      await skillUploadMain({
        skillSpec: "test-skill",
        cwd: testDir,
      });

      // Verify error message about no auth
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("auth");
    });

    it("should handle upload errors gracefully", async () => {
      await createTestSkill({ name: "test-skill" });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        auth: {
          username: "test@example.com",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "mock-refresh-token",
          organizations: ["public"],
        },
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.uploadSkill).mockRejectedValue(
        new Error("Version already exists"),
      );

      await skillUploadMain({
        skillSpec: "test-skill",
        cwd: testDir,
      });

      // Verify error message
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("fail");
      expect(allErrorOutput).toContain("Version already exists");
    });

    it("should extract description from SKILL.md frontmatter", async () => {
      await createTestSkill({
        name: "test-skill",
        skillMdContent: `---
name: Test Skill
description: This is a custom description from frontmatter
---

# Test Skill
`,
      });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        auth: {
          username: "test@example.com",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "mock-refresh-token",
          organizations: ["public"],
        },
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.uploadSkill).mockResolvedValue({
        name: "test-skill",
        version: "1.0.0",
        description: "This is a custom description from frontmatter",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      await skillUploadMain({
        skillSpec: "test-skill",
        cwd: testDir,
      });

      // Verify API was called with description from frontmatter
      expect(registrarApi.uploadSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "This is a custom description from frontmatter",
        }),
      );
    });

    it("should upload without description when SKILL.md has no frontmatter", async () => {
      await createTestSkill({
        name: "test-skill",
        skillMdContent: `# Test Skill

No frontmatter here.
`,
      });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        auth: {
          username: "test@example.com",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "mock-refresh-token",
          organizations: ["public"],
        },
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.uploadSkill).mockResolvedValue({
        name: "test-skill",
        version: "1.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      await skillUploadMain({
        skillSpec: "test-skill",
        cwd: testDir,
      });

      // Verify API was called without description (or with null/undefined)
      expect(registrarApi.uploadSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          skillName: "test-skill",
        }),
      );
      const callArgs = vi.mocked(registrarApi.uploadSkill).mock.calls[0][0];
      expect(callArgs.description).toBeUndefined();
    });
  });

  describe("multi-registry support", () => {
    it("should error when --registry specifies unknown registry", async () => {
      await createTestSkill({ name: "test-skill" });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        auth: {
          username: "test@example.com",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "mock-refresh-token",
          organizations: ["public"],
        },
      });

      await skillUploadMain({
        skillSpec: "test-skill",
        cwd: testDir,
        registryUrl: "https://unknown-registry.example.com",
      });

      // Verify error message about no auth
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("auth");
      expect(allErrorOutput).toContain("https://unknown-registry.example.com");

      // Verify no upload occurred
      expect(registrarApi.uploadSkill).not.toHaveBeenCalled();
    });
  });

  describe("auto-bump version", () => {
    it("should auto-bump patch version when no version specified and skill exists", async () => {
      await createTestSkill({ name: "test-skill" });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        auth: {
          username: "test@example.com",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "mock-refresh-token",
          organizations: ["public"],
        },
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      // Mock existing skill with version 1.2.3
      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "test-skill",
        "dist-tags": { latest: "1.2.3" },
        versions: { "1.2.3": { name: "test-skill", version: "1.2.3" } },
      });

      vi.mocked(registrarApi.uploadSkill).mockResolvedValue({
        name: "test-skill",
        version: "1.2.4",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      await skillUploadMain({
        skillSpec: "test-skill",
        cwd: testDir,
      });

      // Verify API was called with auto-bumped version (1.2.3 -> 1.2.4)
      expect(registrarApi.uploadSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          skillName: "test-skill",
          version: "1.2.4",
        }),
      );
    });

    it("should default to 1.0.0 when no version specified and skill does not exist", async () => {
      await createTestSkill({ name: "test-skill" });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        auth: {
          username: "test@example.com",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "mock-refresh-token",
          organizations: ["public"],
        },
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      // Mock skill not found
      vi.mocked(registrarApi.getSkillPackument).mockRejectedValue(
        new Error("Skill not found"),
      );

      vi.mocked(registrarApi.uploadSkill).mockResolvedValue({
        name: "test-skill",
        version: "1.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      await skillUploadMain({
        skillSpec: "test-skill",
        cwd: testDir,
      });

      // Verify API was called with default version 1.0.0
      expect(registrarApi.uploadSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          skillName: "test-skill",
          version: "1.0.0",
        }),
      );
    });

    it("should use explicit version when specified, not auto-bump", async () => {
      await createTestSkill({ name: "test-skill" });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        auth: {
          username: "test@example.com",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "mock-refresh-token",
          organizations: ["public"],
        },
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.uploadSkill).mockResolvedValue({
        name: "test-skill",
        version: "5.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      await skillUploadMain({
        skillSpec: "test-skill@5.0.0",
        cwd: testDir,
      });

      // getSkillPackument should NOT be called when explicit version provided
      expect(registrarApi.getSkillPackument).not.toHaveBeenCalled();

      // Verify API was called with explicit version
      expect(registrarApi.uploadSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          skillName: "test-skill",
          version: "5.0.0",
        }),
      );
    });
  });

  describe("public registry support", () => {
    it("should include public registry when user has unified auth with refreshToken", async () => {
      await createTestSkill({ name: "test-skill" });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        auth: {
          username: "test@example.com",
          organizationUrl: "https://myorg.tilework.tech",
          refreshToken: "mock-refresh-token",
        },
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.getSkillPackument).mockRejectedValue(
        new Error("Skill not found"),
      );

      vi.mocked(registrarApi.uploadSkill).mockResolvedValue({
        name: "test-skill",
        version: "1.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      await skillUploadMain({
        skillSpec: "test-skill",
        cwd: testDir,
      });

      // Should upload to public registry since it's included as an available registry
      expect(registrarApi.uploadSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          skillName: "test-skill",
          registryUrl: "https://noriskillsets.dev",
        }),
      );
    });

    it("should upload to public registry when --registry specifies it and user has unified auth", async () => {
      await createTestSkill({ name: "test-skill" });

      // User has unified auth with refreshToken
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        auth: {
          username: "test@example.com",
          organizationUrl: "https://myorg.tilework.tech",
          refreshToken: "mock-refresh-token",
        },
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.getSkillPackument).mockRejectedValue(
        new Error("Skill not found"),
      );

      vi.mocked(registrarApi.uploadSkill).mockResolvedValue({
        name: "test-skill",
        version: "1.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      await skillUploadMain({
        skillSpec: "test-skill",
        cwd: testDir,
        registryUrl: "https://noriskillsets.dev",
      });

      // Should successfully upload to public registry
      expect(registrarApi.uploadSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          skillName: "test-skill",
          registryUrl: "https://noriskillsets.dev",
          authToken: "mock-auth-token",
        }),
      );
    });

    it("should still fail for public registry when user has no auth at all", async () => {
      await createTestSkill({ name: "test-skill" });

      // User has NO auth at all
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
      });

      await skillUploadMain({
        skillSpec: "test-skill",
        cwd: testDir,
        registryUrl: "https://noriskillsets.dev",
      });

      // Should fail with auth error
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("auth");

      // Should not attempt upload
      expect(registrarApi.uploadSkill).not.toHaveBeenCalled();
    });
  });

  describe("cursor-agent validation", () => {
    it("should fail when only cursor-agent is installed", async () => {
      await createTestSkill({ name: "test-skill" });

      // Mock config with only cursor-agent installed
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: { "cursor-agent": { profile: { baseProfile: "amol" } } },
        auth: {
          username: "test@example.com",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "mock-refresh-token",
          organizations: ["public"],
        },
      });

      await skillUploadMain({
        skillSpec: "test-skill",
        cwd: testDir,
      });

      // Should not make any API calls
      expect(registrarApi.uploadSkill).not.toHaveBeenCalled();

      // Should display error message about cursor-agent not being supported
      const allOutput = [
        ...mockConsoleLog.mock.calls,
        ...mockConsoleError.mock.calls,
      ]
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput.toLowerCase()).toContain("not supported");
      expect(allOutput.toLowerCase()).toContain("cursor");
      expect(allOutput).toContain("claude-code");
    });

    it("should succeed when only claude-code is installed", async () => {
      await createTestSkill({ name: "test-skill" });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        auth: {
          username: "test@example.com",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "mock-refresh-token",
          organizations: ["public"],
        },
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.getSkillPackument).mockRejectedValue(
        new Error("Skill not found"),
      );

      vi.mocked(registrarApi.uploadSkill).mockResolvedValue({
        name: "test-skill",
        version: "1.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      await skillUploadMain({
        skillSpec: "test-skill",
        cwd: testDir,
      });

      // Should make API call since claude-code is installed
      expect(registrarApi.uploadSkill).toHaveBeenCalled();
    });
  });

  describe("cliName in user-facing messages", () => {
    it("should use nori-skillsets command names in success message when cliName is nori-skillsets", async () => {
      await createTestSkill({ name: "test-skill" });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        auth: {
          username: "test@example.com",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "mock-refresh-token",
          organizations: ["public"],
        },
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.getSkillPackument).mockRejectedValue(
        new Error("Skill not found"),
      );

      vi.mocked(registrarApi.uploadSkill).mockResolvedValue({
        name: "test-skill",
        version: "1.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      await skillUploadMain({
        skillSpec: "test-skill",
        cwd: testDir,
        cliName: "nori-skillsets",
      });

      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput).toContain("nori-skillsets download-skill");
      expect(allOutput).not.toContain("nori-ai skill-download");
    });

    it("should use nori-ai command names in success message when cliName is nori-ai", async () => {
      await createTestSkill({ name: "test-skill" });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        auth: {
          username: "test@example.com",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "mock-refresh-token",
          organizations: ["public"],
        },
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.getSkillPackument).mockRejectedValue(
        new Error("Skill not found"),
      );

      vi.mocked(registrarApi.uploadSkill).mockResolvedValue({
        name: "test-skill",
        version: "1.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      await skillUploadMain({
        skillSpec: "test-skill",
        cwd: testDir,
        cliName: "nori-ai",
      });

      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput).toContain("nori-ai skill-download");
      expect(allOutput).not.toContain("nori-skillsets download-skill");
    });
  });
});
