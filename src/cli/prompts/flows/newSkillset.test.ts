/**
 * Tests for newSkillsetFlow
 */

import * as clack from "@clack/prompts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { newSkillsetFlow } from "./newSkillset.js";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  group: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}));

describe("newSkillsetFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clack.isCancel).mockReturnValue(false);
  });

  describe("happy path: all fields provided", () => {
    it("should collect all metadata fields and return them", async () => {
      vi.mocked(clack.group).mockResolvedValueOnce({
        name: "my-skillset",
        description: "My awesome skillset",
        license: "MIT",
        keywords: "testing, automation, cli",
        version: "2.0.0",
        repository: "https://github.com/user/repo",
      });

      const result = await newSkillsetFlow();

      expect(result).toEqual({
        name: "my-skillset",
        description: "My awesome skillset",
        license: "MIT",
        keywords: ["testing", "automation", "cli"],
        version: "2.0.0",
        repository: "https://github.com/user/repo",
      });
    });

    it("should parse keywords from comma-separated string to array", async () => {
      vi.mocked(clack.group).mockResolvedValueOnce({
        name: "test-skillset",
        description: "Test",
        license: "MIT",
        keywords: "  foo  ,  bar  , baz  ",
        version: "1.0.0",
        repository: "",
      });

      const result = await newSkillsetFlow();

      expect(result?.keywords).toEqual(["foo", "bar", "baz"]);
    });

    it("should handle namespaced skillset names", async () => {
      vi.mocked(clack.group).mockResolvedValueOnce({
        name: "myorg/my-skillset",
        description: "Test",
        license: "MIT",
        keywords: "",
        version: "1.0.0",
        repository: "",
      });

      const result = await newSkillsetFlow();

      expect(result?.name).toBe("myorg/my-skillset");
    });
  });

  describe("happy path: only required fields", () => {
    it("should handle empty optional fields", async () => {
      vi.mocked(clack.group).mockResolvedValueOnce({
        name: "minimal-skillset",
        description: "",
        license: "",
        keywords: "",
        version: "",
        repository: "",
      });

      const result = await newSkillsetFlow();

      expect(result).toEqual({
        name: "minimal-skillset",
        description: null,
        license: null,
        keywords: null,
        version: null,
        repository: null,
      });
    });

    it("should filter empty keywords when splitting", async () => {
      vi.mocked(clack.group).mockResolvedValueOnce({
        name: "test-skillset",
        description: "",
        license: "",
        keywords: "  , , foo,  ,bar,  ",
        version: "",
        repository: "",
      });

      const result = await newSkillsetFlow();

      expect(result?.keywords).toEqual(["foo", "bar"]);
    });

    it("should return null keywords when empty string provided", async () => {
      vi.mocked(clack.group).mockResolvedValueOnce({
        name: "test-skillset",
        description: "",
        license: "",
        keywords: "   ",
        version: "",
        repository: "",
      });

      const result = await newSkillsetFlow();

      expect(result?.keywords).toBeNull();
    });
  });

  describe("cancellation", () => {
    it("should return null when user cancels", async () => {
      const cancelSymbol = Symbol("cancel");
      vi.mocked(clack.group).mockResolvedValueOnce(cancelSymbol);
      vi.mocked(clack.isCancel).mockReturnValue(true);

      const result = await newSkillsetFlow();

      expect(result).toBeNull();
    });
  });

  describe("display messages", () => {
    it("should show intro and outro messages", async () => {
      vi.mocked(clack.group).mockResolvedValueOnce({
        name: "test-skillset",
        description: "",
        license: "",
        keywords: "",
        version: "",
        repository: "",
      });

      await newSkillsetFlow();

      expect(clack.intro).toHaveBeenCalledWith("Create New Skillset");
      expect(clack.outro).toHaveBeenCalledWith("Skillset metadata collected");
    });
  });
});
