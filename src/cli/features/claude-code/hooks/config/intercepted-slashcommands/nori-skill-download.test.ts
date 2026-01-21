/**
 * Tests for nori-skill-download intercepted slash command
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the skill download command
vi.mock("@/cli/commands/skill-download/skillDownload.js", () => ({
  skillDownloadMain: vi.fn(),
}));

import { skillDownloadMain } from "@/cli/commands/skill-download/skillDownload.js";
import { stripAnsi } from "@/cli/features/test-utils/index.js";

import type { HookInput } from "./types.js";

import { noriSkillDownload } from "./nori-skill-download.js";

describe("nori-skill-download", () => {
  let testDir: string;
  let configPath: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    testDir = await fs.mkdtemp(
      path.join(tmpdir(), "nori-skill-download-test-"),
    );
    configPath = path.join(testDir, ".nori-config.json");
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  const createInput = (args: {
    prompt: string;
    cwd?: string | null;
  }): HookInput => {
    const { prompt, cwd } = args;
    return {
      prompt,
      cwd: cwd ?? testDir,
      session_id: "test-session",
      transcript_path: "",
      permission_mode: "default",
      hook_event_name: "UserPromptSubmit",
    };
  };

  describe("matchers", () => {
    it("should have valid regex matchers", () => {
      expect(noriSkillDownload.matchers).toBeInstanceOf(Array);
      expect(noriSkillDownload.matchers.length).toBeGreaterThan(0);

      for (const matcher of noriSkillDownload.matchers) {
        expect(() => new RegExp(matcher)).not.toThrow();
      }
    });

    it("should match /nori-skill-download skill-name", () => {
      const hasMatch = noriSkillDownload.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-skill-download my-skill");
      });
      expect(hasMatch).toBe(true);
    });

    it("should match /nori-skill-download skill-name@version", () => {
      const hasMatch = noriSkillDownload.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-skill-download my-skill@1.0.0");
      });
      expect(hasMatch).toBe(true);
    });

    it("should match /nori-skill-download skill-name --list-versions", () => {
      const hasMatch = noriSkillDownload.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-skill-download my-skill --list-versions");
      });
      expect(hasMatch).toBe(true);
    });

    it("should match /nori-skill-download skill-name --registry url", () => {
      const hasMatch = noriSkillDownload.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test(
          "/nori-skill-download my-skill --registry https://registry.example.com",
        );
      });
      expect(hasMatch).toBe(true);
    });

    it("should match bare /nori-skill-download command", () => {
      const hasMatch = noriSkillDownload.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-skill-download");
      });
      expect(hasMatch).toBe(true);
    });
  });

  describe("help message", () => {
    it("should show help when no arguments provided", async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        }),
      );

      const result = await noriSkillDownload.run({
        input: createInput({ prompt: "/nori-skill-download" }),
      });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Usage:");
      expect(plainReason).toContain("/nori-skill-download");
    });
  });

  describe("download execution", () => {
    it("should call skillDownloadMain with correct arguments", async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        }),
      );

      vi.mocked(skillDownloadMain).mockResolvedValue();

      const result = await noriSkillDownload.run({
        input: createInput({ prompt: "/nori-skill-download my-skill" }),
      });

      expect(skillDownloadMain).toHaveBeenCalledWith(
        expect.objectContaining({
          skillSpec: "my-skill",
          cwd: testDir,
          installDir: testDir,
        }),
      );

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
    });

    it("should include version in skillSpec when provided", async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        }),
      );

      vi.mocked(skillDownloadMain).mockResolvedValue();

      await noriSkillDownload.run({
        input: createInput({ prompt: "/nori-skill-download my-skill@1.2.3" }),
      });

      expect(skillDownloadMain).toHaveBeenCalledWith(
        expect.objectContaining({
          skillSpec: "my-skill@1.2.3",
        }),
      );
    });

    it("should pass registry URL when provided", async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        }),
      );

      vi.mocked(skillDownloadMain).mockResolvedValue();

      await noriSkillDownload.run({
        input: createInput({
          prompt:
            "/nori-skill-download my-skill --registry https://custom.registry.com",
        }),
      });

      expect(skillDownloadMain).toHaveBeenCalledWith(
        expect.objectContaining({
          skillSpec: "my-skill",
          registryUrl: "https://custom.registry.com",
        }),
      );
    });

    it("should pass listVersions flag when provided", async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        }),
      );

      vi.mocked(skillDownloadMain).mockResolvedValue();

      await noriSkillDownload.run({
        input: createInput({
          prompt: "/nori-skill-download my-skill --list-versions",
        }),
      });

      expect(skillDownloadMain).toHaveBeenCalledWith(
        expect.objectContaining({
          skillSpec: "my-skill",
          listVersions: true,
        }),
      );
    });

    it("should handle download errors gracefully", async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        }),
      );

      vi.mocked(skillDownloadMain).mockRejectedValue(
        new Error("Download failed"),
      );

      const result = await noriSkillDownload.run({
        input: createInput({ prompt: "/nori-skill-download my-skill" }),
      });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason.toLowerCase()).toContain("failed");
    });
  });

  describe("installation detection", () => {
    it("should use cwd when no installation found", async () => {
      const nonInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "non-install-"),
      );

      vi.mocked(skillDownloadMain).mockResolvedValue();

      const result = await noriSkillDownload.run({
        input: createInput({
          prompt: "/nori-skill-download my-skill",
          cwd: nonInstallDir,
        }),
      });

      // Should call skillDownloadMain with cwd as installDir
      expect(skillDownloadMain).toHaveBeenCalledWith(
        expect.objectContaining({
          skillSpec: "my-skill",
          cwd: nonInstallDir,
          installDir: nonInstallDir,
        }),
      );

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason.toLowerCase()).toContain("completed");

      await fs.rm(nonInstallDir, { recursive: true, force: true });
    });
  });
});
