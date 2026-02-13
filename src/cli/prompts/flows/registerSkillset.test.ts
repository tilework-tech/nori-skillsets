/**
 * Tests for registerSkillsetFlow
 */

import * as clack from "@clack/prompts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerSkillsetFlow } from "./registerSkillset.js";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  group: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}));

describe("registerSkillsetFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clack.isCancel).mockReturnValue(false);
  });

  describe("happy path: all fields provided", () => {
    it("should collect all metadata fields except name and return them", async () => {
      vi.mocked(clack.group).mockResolvedValueOnce({
        description: "My awesome skillset",
        license: "MIT",
        keywords: "testing, automation, cli",
        version: "2.0.0",
        repository: "https://github.com/user/repo",
      });

      const result = await registerSkillsetFlow();

      expect(result).toEqual({
        description: "My awesome skillset",
        license: "MIT",
        keywords: ["testing", "automation", "cli"],
        version: "2.0.0",
        repository: "https://github.com/user/repo",
      });
    });

    it("should parse keywords from comma-separated string to array", async () => {
      vi.mocked(clack.group).mockResolvedValueOnce({
        description: "Test",
        license: "MIT",
        keywords: "  foo  ,  bar  , baz  ",
        version: "1.0.0",
        repository: "",
      });

      const result = await registerSkillsetFlow();

      expect(result?.keywords).toEqual(["foo", "bar", "baz"]);
    });
  });

  describe("happy path: only required fields", () => {
    it("should handle empty optional fields", async () => {
      vi.mocked(clack.group).mockResolvedValueOnce({
        description: "",
        license: "",
        keywords: "",
        version: "",
        repository: "",
      });

      const result = await registerSkillsetFlow();

      expect(result).toEqual({
        description: null,
        license: null,
        keywords: null,
        version: null,
        repository: null,
      });
    });

    it("should filter empty keywords when splitting", async () => {
      vi.mocked(clack.group).mockResolvedValueOnce({
        description: "",
        license: "",
        keywords: "  , , foo,  ,bar,  ",
        version: "",
        repository: "",
      });

      const result = await registerSkillsetFlow();

      expect(result?.keywords).toEqual(["foo", "bar"]);
    });

    it("should return null keywords when empty string provided", async () => {
      vi.mocked(clack.group).mockResolvedValueOnce({
        description: "",
        license: "",
        keywords: "   ",
        version: "",
        repository: "",
      });

      const result = await registerSkillsetFlow();

      expect(result?.keywords).toBeNull();
    });
  });

  describe("cancellation", () => {
    it("should return null when user cancels", async () => {
      const cancelSymbol = Symbol("cancel");
      vi.mocked(clack.group).mockResolvedValueOnce(cancelSymbol);
      vi.mocked(clack.isCancel).mockReturnValue(true);

      const result = await registerSkillsetFlow();

      expect(result).toBeNull();
    });
  });
});
