/**
 * Tests for registerSkillsetFlow
 */

import * as clack from "@clack/prompts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerSkillsetFlow } from "./registerSkillset.js";

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

describe("registerSkillsetFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clack.isCancel).mockReturnValue(false);
  });

  describe("happy path: all fields provided", () => {
    it("should collect all metadata fields except name and return them", async () => {
      queueText([
        "My awesome skillset",
        "MIT",
        "testing, automation, cli",
        "2.0.0",
        "https://github.com/user/repo",
      ]);

      const result = await registerSkillsetFlow();

      expect(result).toEqual({
        description: "My awesome skillset",
        license: "MIT",
        keywords: ["testing", "automation", "cli"],
        version: "2.0.0",
        repository: "https://github.com/user/repo",
        statusMessage: "Skillset metadata collected",
      });
    });

    it("should parse keywords from comma-separated string to array", async () => {
      queueText(["Test", "MIT", "  foo  ,  bar  , baz  ", "1.0.0", ""]);

      const result = await registerSkillsetFlow();

      expect(result?.keywords).toEqual(["foo", "bar", "baz"]);
    });
  });

  describe("happy path: only required fields", () => {
    it("should handle empty optional fields", async () => {
      queueText(["", "", "", "", ""]);

      const result = await registerSkillsetFlow();

      expect(result).toEqual({
        description: null,
        license: null,
        keywords: null,
        version: null,
        repository: null,
        statusMessage: "Skillset metadata collected",
      });
    });

    it("should filter empty keywords when splitting", async () => {
      queueText(["", "", "  , , foo,  ,bar,  ", "", ""]);

      const result = await registerSkillsetFlow();

      expect(result?.keywords).toEqual(["foo", "bar"]);
    });

    it("should return null keywords when empty string provided", async () => {
      queueText(["", "", "   ", "", ""]);

      const result = await registerSkillsetFlow();

      expect(result?.keywords).toBeNull();
    });
  });

  describe("cancellation", () => {
    it("should return null when user cancels at the first prompt", async () => {
      const cancelSymbol = Symbol.for("cancel");
      vi.mocked(clack.text).mockResolvedValueOnce(cancelSymbol as never);
      vi.mocked(clack.isCancel).mockImplementation(
        (value) => value === cancelSymbol,
      );

      const result = await registerSkillsetFlow();

      expect(result).toBeNull();
    });

    it("should not invoke later prompts when user cancels at the first prompt", async () => {
      const cancelSymbol = Symbol.for("cancel");
      vi.mocked(clack.text).mockResolvedValueOnce(cancelSymbol as never);
      vi.mocked(clack.isCancel).mockImplementation(
        (value) => value === cancelSymbol,
      );

      await registerSkillsetFlow();

      expect(clack.text).toHaveBeenCalledTimes(1);
    });

    it("should return null when user cancels at a later prompt", async () => {
      const cancelSymbol = Symbol.for("cancel");
      vi.mocked(clack.text)
        .mockResolvedValueOnce("A description")
        .mockResolvedValueOnce(cancelSymbol as never);
      vi.mocked(clack.isCancel).mockImplementation(
        (value) => value === cancelSymbol,
      );

      const result = await registerSkillsetFlow();

      expect(result).toBeNull();
    });
  });
});
