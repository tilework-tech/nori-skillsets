/**
 * Tests for nori-skill-search intercepted slash command
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the skill search command
vi.mock("@/cli/commands/skill-search/skillSearch.js", () => ({
  skillSearchMain: vi.fn(),
}));

import { skillSearchMain } from "@/cli/commands/skill-search/skillSearch.js";
import { stripAnsi } from "@/cli/features/test-utils/index.js";

import type { HookInput } from "./types.js";

import { noriSkillSearch } from "./nori-skill-search.js";

describe("nori-skill-search", () => {
  let testDir: string;
  let configPath: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    testDir = await fs.mkdtemp(path.join(tmpdir(), "nori-skill-search-test-"));
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
      expect(noriSkillSearch.matchers).toBeInstanceOf(Array);
      expect(noriSkillSearch.matchers.length).toBeGreaterThan(0);

      for (const matcher of noriSkillSearch.matchers) {
        expect(() => new RegExp(matcher)).not.toThrow();
      }
    });

    it("should match /nori-skill-search query", () => {
      const hasMatch = noriSkillSearch.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-skill-search test");
      });
      expect(hasMatch).toBe(true);
    });

    it("should match /nori-skill-search with multi-word query", () => {
      const hasMatch = noriSkillSearch.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-skill-search typescript debugging");
      });
      expect(hasMatch).toBe(true);
    });

    it("should match bare /nori-skill-search command", () => {
      const hasMatch = noriSkillSearch.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-skill-search");
      });
      expect(hasMatch).toBe(true);
    });
  });

  describe("help message", () => {
    it("should show help when no query provided", async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        }),
      );

      const result = await noriSkillSearch.run({
        input: createInput({ prompt: "/nori-skill-search" }),
      });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Usage:");
      expect(plainReason).toContain("/nori-skill-search");
    });
  });

  describe("search execution", () => {
    it("should call skillSearchMain with correct arguments", async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        }),
      );

      vi.mocked(skillSearchMain).mockResolvedValue();

      const result = await noriSkillSearch.run({
        input: createInput({ prompt: "/nori-skill-search debugging" }),
      });

      expect(skillSearchMain).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "debugging",
          cwd: testDir,
          installDir: testDir,
        }),
      );

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
    });

    it("should pass multi-word query correctly", async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        }),
      );

      vi.mocked(skillSearchMain).mockResolvedValue();

      await noriSkillSearch.run({
        input: createInput({
          prompt: "/nori-skill-search typescript development",
        }),
      });

      expect(skillSearchMain).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "typescript development",
        }),
      );
    });

    it("should handle search errors gracefully", async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        }),
      );

      vi.mocked(skillSearchMain).mockRejectedValue(new Error("Search failed"));

      const result = await noriSkillSearch.run({
        input: createInput({ prompt: "/nori-skill-search test" }),
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

      const result = await noriSkillSearch.run({
        input: createInput({
          prompt: "/nori-skill-search test",
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
