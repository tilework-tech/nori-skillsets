/**
 * Tests for newSkillsetFlow
 */

import * as clack from "@clack/prompts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { newSkillsetFlow } from "./newSkillset.js";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  text: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}));

const queueText = (values: Array<unknown>): void => {
  for (const value of values) {
    vi.mocked(clack.text).mockResolvedValueOnce(value as never);
  }
};

describe("newSkillsetFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clack.isCancel).mockReturnValue(false);
  });

  describe("happy path: all fields provided", () => {
    it("should collect all metadata fields and return them", async () => {
      queueText([
        "my-skillset",
        "My awesome skillset",
        "MIT",
        "testing, automation, cli",
        "2.0.0",
        "https://github.com/user/repo",
      ]);

      const result = await newSkillsetFlow();

      expect(result).toEqual({
        name: "my-skillset",
        description: "My awesome skillset",
        license: "MIT",
        keywords: ["testing", "automation", "cli"],
        version: "2.0.0",
        repository: "https://github.com/user/repo",
        statusMessage: "Skillset metadata collected",
      });
    });

    it("should parse keywords from comma-separated string to array", async () => {
      queueText([
        "test-skillset",
        "Test",
        "MIT",
        "  foo  ,  bar  , baz  ",
        "1.0.0",
        "",
      ]);

      const result = await newSkillsetFlow();

      expect(result?.keywords).toEqual(["foo", "bar", "baz"]);
    });

    it("should handle namespaced skillset names", async () => {
      queueText(["myorg/my-skillset", "Test", "MIT", "", "1.0.0", ""]);

      const result = await newSkillsetFlow();

      expect(result?.name).toBe("myorg/my-skillset");
    });
  });

  describe("happy path: only required fields", () => {
    it("should handle empty optional fields", async () => {
      queueText(["minimal-skillset", "", "", "", "", ""]);

      const result = await newSkillsetFlow();

      expect(result).toEqual({
        name: "minimal-skillset",
        description: null,
        license: null,
        keywords: null,
        version: null,
        repository: null,
        statusMessage: "Skillset metadata collected",
      });
    });

    it("should filter empty keywords when splitting", async () => {
      queueText(["test-skillset", "", "", "  , , foo,  ,bar,  ", "", ""]);

      const result = await newSkillsetFlow();

      expect(result?.keywords).toEqual(["foo", "bar"]);
    });

    it("should return null keywords when empty string provided", async () => {
      queueText(["test-skillset", "", "", "   ", "", ""]);

      const result = await newSkillsetFlow();

      expect(result?.keywords).toBeNull();
    });
  });

  describe("cancellation", () => {
    it("should return null when user cancels at the name prompt", async () => {
      const cancelSymbol = Symbol.for("cancel");
      vi.mocked(clack.text).mockResolvedValueOnce(cancelSymbol as never);
      vi.mocked(clack.isCancel).mockImplementation(
        (value) => value === cancelSymbol,
      );

      const result = await newSkillsetFlow();

      expect(result).toBeNull();
    });

    it("should not invoke later prompts when user cancels at the name prompt", async () => {
      const cancelSymbol = Symbol.for("cancel");
      vi.mocked(clack.text).mockResolvedValueOnce(cancelSymbol as never);
      vi.mocked(clack.isCancel).mockImplementation(
        (value) => value === cancelSymbol,
      );

      await newSkillsetFlow();

      expect(clack.text).toHaveBeenCalledTimes(1);
    });

    it("should return null when user cancels at a later prompt", async () => {
      const cancelSymbol = Symbol.for("cancel");
      vi.mocked(clack.text)
        .mockResolvedValueOnce("my-skillset")
        .mockResolvedValueOnce("A description")
        .mockResolvedValueOnce(cancelSymbol as never);
      vi.mocked(clack.isCancel).mockImplementation(
        (value) => value === cancelSymbol,
      );

      const result = await newSkillsetFlow();

      expect(result).toBeNull();
    });

    it("should not invoke prompts after the cancellation point", async () => {
      const cancelSymbol = Symbol.for("cancel");
      vi.mocked(clack.text)
        .mockResolvedValueOnce("my-skillset")
        .mockResolvedValueOnce("A description")
        .mockResolvedValueOnce(cancelSymbol as never);
      vi.mocked(clack.isCancel).mockImplementation(
        (value) => value === cancelSymbol,
      );

      await newSkillsetFlow();

      expect(clack.text).toHaveBeenCalledTimes(3);
    });
  });
});
