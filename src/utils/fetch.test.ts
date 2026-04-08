import { describe, expect, it } from "vitest";

import {
  SubagentCollisionError,
  isSubagentCollisionError,
  SkillCollisionError,
} from "@/utils/fetch.js";

import type { SubagentConflictInfo } from "@/utils/fetch.js";

describe("SubagentCollisionError", () => {
  const makeConflict = (
    overrides?: Partial<SubagentConflictInfo>,
  ): SubagentConflictInfo => ({
    subagentId: "my-subagent",
    exists: true,
    canPublish: false,
    availableActions: ["cancel", "namespace"],
    ...overrides,
  });

  it("should store conflicts array", () => {
    const conflicts = [makeConflict(), makeConflict({ subagentId: "other" })];
    const error = new SubagentCollisionError({
      message: "conflict detected",
      conflicts,
    });

    expect(error.conflicts).toEqual(conflicts);
    expect(error.conflicts).toHaveLength(2);
  });

  it("should default requiresVersions to false when not provided", () => {
    const error = new SubagentCollisionError({
      message: "conflict detected",
      conflicts: [makeConflict()],
    });

    expect(error.requiresVersions).toBe(false);
  });

  it("should store requiresVersions as true when provided", () => {
    const error = new SubagentCollisionError({
      message: "conflict detected",
      conflicts: [makeConflict()],
      requiresVersions: true,
    });

    expect(error.requiresVersions).toBe(true);
  });

  it("should set the error message", () => {
    const error = new SubagentCollisionError({
      message: "subagent conflict detected",
      conflicts: [makeConflict()],
    });

    expect(error.message).toBe("subagent conflict detected");
  });

  it("should set the error name to SubagentCollisionError", () => {
    const error = new SubagentCollisionError({
      message: "conflict",
      conflicts: [makeConflict()],
    });

    expect(error.name).toBe("SubagentCollisionError");
  });

  it("should be an instance of Error", () => {
    const error = new SubagentCollisionError({
      message: "conflict",
      conflicts: [makeConflict()],
    });

    expect(error).toBeInstanceOf(Error);
  });

  it("should have isSubagentCollisionError flag set to true", () => {
    const error = new SubagentCollisionError({
      message: "conflict",
      conflicts: [makeConflict()],
    });

    expect(error.isSubagentCollisionError).toBe(true);
  });

  it("should store optional conflict fields", () => {
    const conflict = makeConflict({
      latestVersion: "2.0.0",
      owner: "some-org",
      contentUnchanged: true,
      existingSubagentMd: "# My Subagent",
    });

    const error = new SubagentCollisionError({
      message: "conflict",
      conflicts: [conflict],
    });

    expect(error.conflicts[0].latestVersion).toBe("2.0.0");
    expect(error.conflicts[0].owner).toBe("some-org");
    expect(error.conflicts[0].contentUnchanged).toBe(true);
    expect(error.conflicts[0].existingSubagentMd).toBe("# My Subagent");
  });
});

describe("isSubagentCollisionError", () => {
  const makeConflict = (): SubagentConflictInfo => ({
    subagentId: "my-subagent",
    exists: true,
    canPublish: false,
    availableActions: ["cancel"],
  });

  it("should return true for SubagentCollisionError instances", () => {
    const error = new SubagentCollisionError({
      message: "conflict",
      conflicts: [makeConflict()],
    });

    expect(isSubagentCollisionError(error)).toBe(true);
  });

  it("should return false for SkillCollisionError instances", () => {
    const error = new SkillCollisionError({
      message: "skill conflict",
      conflicts: [
        {
          skillId: "my-skill",
          exists: true,
          canPublish: false,
          availableActions: ["cancel"],
        },
      ],
    });

    expect(isSubagentCollisionError(error)).toBe(false);
  });

  it("should return false for plain Error instances", () => {
    const error = new Error("some error");

    expect(isSubagentCollisionError(error)).toBe(false);
  });

  it("should return false for null", () => {
    expect(isSubagentCollisionError(null)).toBe(false);
  });

  it("should return false for undefined", () => {
    expect(isSubagentCollisionError(undefined)).toBe(false);
  });

  it("should return false for non-error objects", () => {
    expect(isSubagentCollisionError({ message: "not an error" })).toBe(false);
  });
});
