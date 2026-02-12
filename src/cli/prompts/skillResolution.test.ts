/**
 * Tests for skill resolution prompt
 *
 * Tests the interactive prompt for resolving skill conflicts during profile upload.
 */
import * as clack from "@clack/prompts";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { SkillConflict } from "@/api/registrar.js";

import { selectSkillResolution } from "./skillResolution.js";
import { handleCancel } from "./utils.js";

// Mock @clack/prompts before importing the module under test
vi.mock("@clack/prompts", () => ({
  select: vi.fn(),
  text: vi.fn(),
  isCancel: vi.fn((value) => value === Symbol.for("cancel")),
}));

// Mock the utils module for handleCancel
vi.mock("./utils.js", () => ({
  handleCancel: vi.fn(),
}));

// Symbol used by @clack/prompts to indicate cancellation
const cancelSymbol = Symbol.for("cancel");

describe("selectSkillResolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("single conflict resolution", () => {
    it("should present resolution options for a single conflict", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "my-skill",
          exists: true,
          canPublish: true,
          latestVersion: "1.0.0",
          owner: "owner@example.com",
          availableActions: ["cancel", "namespace", "updateVersion"],
          contentUnchanged: false,
        },
      ];

      vi.mocked(clack.select).mockResolvedValueOnce("namespace");

      const result = await selectSkillResolution({
        conflicts,
        profileName: "my-profile",
      });

      expect(clack.select).toHaveBeenCalledTimes(1);
      expect(clack.select).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("my-skill"),
        }),
      );
      expect(result).toEqual({
        "my-skill": { action: "namespace" },
      });
    });

    it("should filter options based on availableActions", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "unowned-skill",
          exists: true,
          canPublish: false,
          latestVersion: "2.0.0",
          owner: "other@example.com",
          availableActions: ["cancel", "namespace"], // No updateVersion
          contentUnchanged: false,
        },
      ];

      vi.mocked(clack.select).mockResolvedValueOnce("namespace");

      await selectSkillResolution({
        conflicts,
        profileName: "my-profile",
      });

      const selectCall = vi.mocked(clack.select).mock.calls[0][0];
      const options = selectCall.options as Array<{ value: string }>;
      const optionValues = options.map((o) => o.value);

      expect(optionValues).toContain("namespace");
      expect(optionValues).not.toContain("updateVersion");
      expect(optionValues).not.toContain("cancel"); // cancel is handled via Ctrl+C
    });

    it("should show link option only when content is unchanged", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "unchanged-skill",
          exists: true,
          canPublish: false,
          latestVersion: "1.5.0",
          owner: "other@example.com",
          availableActions: ["cancel", "namespace", "link"],
          contentUnchanged: true,
        },
      ];

      vi.mocked(clack.select).mockResolvedValueOnce("link");

      const result = await selectSkillResolution({
        conflicts,
        profileName: "my-profile",
      });

      const selectCall = vi.mocked(clack.select).mock.calls[0][0];
      const options = selectCall.options as Array<{ value: string }>;
      const optionValues = options.map((o) => o.value);

      expect(optionValues).toContain("link");
      expect(result).toEqual({
        "unchanged-skill": { action: "link" },
      });
    });

    it("should NOT show link option when content has changed even if API allows it", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "changed-skill",
          exists: true,
          canPublish: true,
          latestVersion: "1.5.0",
          owner: "other@example.com",
          availableActions: ["cancel", "namespace", "updateVersion", "link"],
          contentUnchanged: false,
        },
      ];

      vi.mocked(clack.select).mockResolvedValueOnce("namespace");

      await selectSkillResolution({
        conflicts,
        profileName: "my-profile",
      });

      const selectCall = vi.mocked(clack.select).mock.calls[0][0];
      const options = selectCall.options as Array<{ value: string }>;
      const optionValues = options.map((o) => o.value);

      expect(optionValues).not.toContain("link");
      expect(optionValues).toContain("namespace");
      expect(optionValues).toContain("updateVersion");
    });
  });

  describe("updateVersion with version prompt", () => {
    it("should prompt for version when updateVersion is selected", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "my-skill",
          exists: true,
          canPublish: true,
          latestVersion: "1.0.0",
          owner: "me@example.com",
          availableActions: ["cancel", "namespace", "updateVersion"],
          contentUnchanged: false,
        },
      ];

      vi.mocked(clack.select).mockResolvedValueOnce("updateVersion");
      vi.mocked(clack.text).mockResolvedValueOnce("1.0.1");

      const result = await selectSkillResolution({
        conflicts,
        profileName: "my-profile",
      });

      expect(clack.text).toHaveBeenCalledTimes(1);
      expect(clack.text).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("version"),
        }),
      );
      expect(result).toEqual({
        "my-skill": { action: "updateVersion", version: "1.0.1" },
      });
    });

    it("should suggest incremented patch version as default", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "my-skill",
          exists: true,
          canPublish: true,
          latestVersion: "2.3.4",
          owner: "me@example.com",
          availableActions: ["cancel", "namespace", "updateVersion"],
          contentUnchanged: false,
        },
      ];

      vi.mocked(clack.select).mockResolvedValueOnce("updateVersion");
      vi.mocked(clack.text).mockResolvedValueOnce("2.3.5");

      await selectSkillResolution({
        conflicts,
        profileName: "my-profile",
      });

      expect(clack.text).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultValue: "2.3.5",
        }),
      );
    });
  });

  describe("multiple conflicts", () => {
    it("should prompt for each conflict sequentially", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "skill-a",
          exists: true,
          canPublish: true,
          latestVersion: "1.0.0",
          availableActions: ["cancel", "namespace", "updateVersion"],
          contentUnchanged: false,
        },
        {
          skillId: "skill-b",
          exists: true,
          canPublish: false,
          latestVersion: "2.0.0",
          availableActions: ["cancel", "namespace", "link"],
          contentUnchanged: true,
        },
      ];

      vi.mocked(clack.select)
        .mockResolvedValueOnce("namespace")
        .mockResolvedValueOnce("link");

      const result = await selectSkillResolution({
        conflicts,
        profileName: "my-profile",
      });

      expect(clack.select).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        "skill-a": { action: "namespace" },
        "skill-b": { action: "link" },
      });
    });

    it("should return complete strategy with all conflicts resolved", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "skill-1",
          exists: true,
          canPublish: true,
          latestVersion: "1.0.0",
          availableActions: ["cancel", "namespace", "updateVersion"],
          contentUnchanged: false,
        },
        {
          skillId: "skill-2",
          exists: true,
          canPublish: true,
          latestVersion: "1.0.0",
          availableActions: ["cancel", "namespace", "updateVersion"],
          contentUnchanged: false,
        },
        {
          skillId: "skill-3",
          exists: true,
          canPublish: false,
          latestVersion: "1.0.0",
          availableActions: ["cancel", "namespace", "link"],
          contentUnchanged: true,
        },
      ];

      vi.mocked(clack.select)
        .mockResolvedValueOnce("updateVersion")
        .mockResolvedValueOnce("namespace")
        .mockResolvedValueOnce("link");
      vi.mocked(clack.text).mockResolvedValueOnce("1.0.1");

      const result = await selectSkillResolution({
        conflicts,
        profileName: "my-profile",
      });

      expect(Object.keys(result)).toHaveLength(3);
      expect(result["skill-1"]).toEqual({
        action: "updateVersion",
        version: "1.0.1",
      });
      expect(result["skill-2"]).toEqual({ action: "namespace" });
      expect(result["skill-3"]).toEqual({ action: "link" });
    });
  });

  describe("cancellation handling", () => {
    it("should handle user cancellation during select", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "my-skill",
          exists: true,
          canPublish: true,
          latestVersion: "1.0.0",
          availableActions: ["cancel", "namespace", "updateVersion"],
          contentUnchanged: false,
        },
      ];

      vi.mocked(clack.select).mockResolvedValueOnce(cancelSymbol);

      await selectSkillResolution({
        conflicts,
        profileName: "my-profile",
      });

      expect(handleCancel).toHaveBeenCalled();
    });

    it("should handle user cancellation during version input", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "my-skill",
          exists: true,
          canPublish: true,
          latestVersion: "1.0.0",
          availableActions: ["cancel", "namespace", "updateVersion"],
          contentUnchanged: false,
        },
      ];

      vi.mocked(clack.select).mockResolvedValueOnce("updateVersion");
      vi.mocked(clack.text).mockResolvedValueOnce(cancelSymbol);

      await selectSkillResolution({
        conflicts,
        profileName: "my-profile",
      });

      expect(handleCancel).toHaveBeenCalled();
    });
  });

  describe("default selection", () => {
    it("should default to link when contentUnchanged is true and link is available", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "unchanged-skill",
          exists: true,
          canPublish: false,
          latestVersion: "1.0.0",
          availableActions: ["cancel", "namespace", "link"],
          contentUnchanged: true,
        },
      ];

      vi.mocked(clack.select).mockResolvedValueOnce("link");

      await selectSkillResolution({
        conflicts,
        profileName: "my-profile",
      });

      expect(clack.select).toHaveBeenCalledWith(
        expect.objectContaining({
          initialValue: "link",
        }),
      );
    });

    it("should default to updateVersion when content has changed and canPublish is true", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "changed-skill",
          exists: true,
          canPublish: true,
          latestVersion: "1.0.0",
          availableActions: ["cancel", "namespace", "updateVersion"],
          contentUnchanged: false,
        },
      ];

      vi.mocked(clack.select).mockResolvedValueOnce("updateVersion");

      await selectSkillResolution({
        conflicts,
        profileName: "my-profile",
      });

      expect(clack.select).toHaveBeenCalledWith(
        expect.objectContaining({
          initialValue: "updateVersion",
        }),
      );
    });

    it("should default to namespace when content has changed and canPublish is false", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "changed-skill",
          exists: true,
          canPublish: false,
          latestVersion: "1.0.0",
          availableActions: ["cancel", "namespace"],
          contentUnchanged: false,
        },
      ];

      vi.mocked(clack.select).mockResolvedValueOnce("namespace");

      await selectSkillResolution({
        conflicts,
        profileName: "my-profile",
      });

      expect(clack.select).toHaveBeenCalledWith(
        expect.objectContaining({
          initialValue: "namespace",
        }),
      );
    });
  });

  describe("conflict info display", () => {
    it("should include skill info in the prompt message", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "my-skill",
          exists: true,
          canPublish: true,
          latestVersion: "3.2.1",
          owner: "author@example.com",
          availableActions: ["cancel", "namespace", "updateVersion"],
          contentUnchanged: false,
        },
      ];

      vi.mocked(clack.select).mockResolvedValueOnce("namespace");

      await selectSkillResolution({
        conflicts,
        profileName: "my-profile",
      });

      const selectCall = vi.mocked(clack.select).mock.calls[0][0];
      expect(selectCall.message).toContain("my-skill");
    });

    it("should show namespace preview in option hint", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "my-skill",
          exists: true,
          canPublish: false,
          latestVersion: "1.0.0",
          availableActions: ["cancel", "namespace"],
          contentUnchanged: false,
        },
      ];

      vi.mocked(clack.select).mockResolvedValueOnce("namespace");

      await selectSkillResolution({
        conflicts,
        profileName: "test-profile",
      });

      const selectCall = vi.mocked(clack.select).mock.calls[0][0];
      const options = selectCall.options as Array<{
        value: string;
        hint?: string;
      }>;
      const namespaceOption = options.find((o) => o.value === "namespace");

      expect(namespaceOption?.hint).toContain("test-profile-my-skill");
    });
  });

  describe("empty conflicts", () => {
    it("should return empty strategy when no conflicts provided", async () => {
      const result = await selectSkillResolution({
        conflicts: [],
        profileName: "my-profile",
      });

      expect(clack.select).not.toHaveBeenCalled();
      expect(result).toEqual({});
    });
  });
});
