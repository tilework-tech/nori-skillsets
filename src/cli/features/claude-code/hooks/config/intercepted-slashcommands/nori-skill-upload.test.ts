/**
 * Tests for nori-skill-upload intercepted slash command
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the skill upload command
vi.mock("@/cli/commands/skill-upload/skillUpload.js", () => ({
  skillUploadMain: vi.fn(),
}));

import { skillUploadMain } from "@/cli/commands/skill-upload/skillUpload.js";
import { stripAnsi } from "@/cli/features/test-utils/index.js";

import type { HookInput } from "./types.js";

import { noriSkillUpload } from "./nori-skill-upload.js";

describe("nori-skill-upload", () => {
  let testDir: string;
  let configPath: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    testDir = await fs.mkdtemp(path.join(tmpdir(), "nori-skill-upload-test-"));
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
      expect(noriSkillUpload.matchers).toBeInstanceOf(Array);
      expect(noriSkillUpload.matchers.length).toBeGreaterThan(0);

      for (const matcher of noriSkillUpload.matchers) {
        expect(() => new RegExp(matcher)).not.toThrow();
      }
    });

    it("should match /nori-skill-upload skill-name", () => {
      const hasMatch = noriSkillUpload.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-skill-upload my-skill");
      });
      expect(hasMatch).toBe(true);
    });

    it("should match /nori-skill-upload skill-name version", () => {
      const hasMatch = noriSkillUpload.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-skill-upload my-skill 1.0.0");
      });
      expect(hasMatch).toBe(true);
    });

    it("should match /nori-skill-upload skill-name registry-url", () => {
      const hasMatch = noriSkillUpload.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test(
          "/nori-skill-upload my-skill https://registry.example.com",
        );
      });
      expect(hasMatch).toBe(true);
    });

    it("should match /nori-skill-upload skill-name version registry-url", () => {
      const hasMatch = noriSkillUpload.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test(
          "/nori-skill-upload my-skill 1.0.0 https://registry.example.com",
        );
      });
      expect(hasMatch).toBe(true);
    });

    it("should match bare /nori-skill-upload command", () => {
      const hasMatch = noriSkillUpload.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-skill-upload");
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

      const result = await noriSkillUpload.run({
        input: createInput({ prompt: "/nori-skill-upload" }),
      });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Usage:");
      expect(plainReason).toContain("/nori-skill-upload");
    });
  });

  describe("upload execution", () => {
    it("should call skillUploadMain with correct arguments", async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        }),
      );

      vi.mocked(skillUploadMain).mockResolvedValue();

      const result = await noriSkillUpload.run({
        input: createInput({ prompt: "/nori-skill-upload my-skill" }),
      });

      expect(skillUploadMain).toHaveBeenCalledWith(
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

      vi.mocked(skillUploadMain).mockResolvedValue();

      await noriSkillUpload.run({
        input: createInput({ prompt: "/nori-skill-upload my-skill 1.2.3" }),
      });

      expect(skillUploadMain).toHaveBeenCalledWith(
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

      vi.mocked(skillUploadMain).mockResolvedValue();

      await noriSkillUpload.run({
        input: createInput({
          prompt: "/nori-skill-upload my-skill https://custom.registry.com",
        }),
      });

      expect(skillUploadMain).toHaveBeenCalledWith(
        expect.objectContaining({
          skillSpec: "my-skill",
          registryUrl: "https://custom.registry.com",
        }),
      );
    });

    it("should handle upload errors gracefully", async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        }),
      );

      vi.mocked(skillUploadMain).mockRejectedValue(new Error("Upload failed"));

      const result = await noriSkillUpload.run({
        input: createInput({ prompt: "/nori-skill-upload my-skill" }),
      });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason.toLowerCase()).toContain("failed");
    });
  });

  describe("installation detection", () => {
    it("should fail when no installation found", async () => {
      const nonInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "non-install-"),
      );

      const result = await noriSkillUpload.run({
        input: createInput({
          prompt: "/nori-skill-upload my-skill",
          cwd: nonInstallDir,
        }),
      });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason.toLowerCase()).toContain("no nori installation");

      await fs.rm(nonInstallDir, { recursive: true, force: true });
    });
  });
});
