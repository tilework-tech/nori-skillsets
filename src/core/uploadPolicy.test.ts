/**
 * Tests for the pure upload policy module.
 *
 * Covers conflict resolution option building, default action selection,
 * version suggestion/bumping, auto-resolution partitioning, `--resolve`
 * strategy application and parsing, and upload-result type guards.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { registrarApi } from "@/api/registrar.js";

import type { UploadResult } from "./uploadPolicy.js";
import type {
  SkillConflict,
  SkillResolutionAction,
  SubagentConflict,
} from "@/api/registrar.js";

import {
  applyResolveStrategy,
  buildAutoResolutionStrategy,
  buildCommonResolutionOptions,
  buildResolutionOptions,
  canAutoResolveConflict,
  countFileChanges,
  determineUploadVersion,
  formatDiscardHint,
  getDefaultAction,
  getSuggestedVersion,
  hasConflicts,
  hasSubagentConflicts,
  parseResolveStrategy,
  VALID_RESOLVE_ACTIONS,
} from "./uploadPolicy.js";

// Mock the registrar API (only determineUploadVersion touches it)
vi.mock("@/api/registrar.js", () => ({
  registrarApi: {
    getPackument: vi.fn(),
  },
}));

const makeConflict = (args: Partial<SkillConflict>): SkillConflict => ({
  skillId: "my-skill",
  exists: true,
  canPublish: true,
  latestVersion: "1.2.3",
  availableActions: ["updateVersion", "namespace", "link"],
  contentUnchanged: false,
  ...args,
});

const makeSubagentConflict = (
  args: Partial<SubagentConflict>,
): SubagentConflict => ({
  subagentId: "my-subagent",
  exists: true,
  canPublish: true,
  latestVersion: "2.0.0",
  availableActions: ["updateVersion", "namespace", "link"],
  contentUnchanged: false,
  ...args,
});

describe("buildResolutionOptions", () => {
  it("offers only the actions present in availableActions, in fixed order", () => {
    const cases: Array<{
      availableActions: Array<SkillResolutionAction>;
      expected: Array<string>;
    }> = [
      {
        availableActions: ["updateVersion", "namespace", "link"],
        expected: ["updateVersion", "namespace", "link"],
      },
      { availableActions: ["namespace"], expected: ["namespace"] },
      {
        availableActions: ["link", "updateVersion"],
        expected: ["updateVersion", "link"],
      },
      { availableActions: [], expected: [] },
    ];

    for (const { availableActions, expected } of cases) {
      const options = buildResolutionOptions({
        conflict: makeConflict({ availableActions, contentUnchanged: true }),
        skillsetName: "my-skillset",
      });
      expect(options.map((o) => o.value)).toEqual(expected);
    }
  });

  it("previews the namespaced name in the namespace hint", () => {
    const options = buildResolutionOptions({
      conflict: makeConflict({ availableActions: ["namespace"] }),
      skillsetName: "my-skillset",
    });
    expect(options[0].hint).toContain("my-skillset-my-skill");
  });

  it("presents link as a version link when content is unchanged", () => {
    const options = buildResolutionOptions({
      conflict: makeConflict({
        availableActions: ["link"],
        contentUnchanged: true,
        latestVersion: "3.1.0",
      }),
      skillsetName: "my-skillset",
    });
    expect(options).toHaveLength(1);
    expect(options[0].hint).toContain("v3.1.0");
  });

  it("presents link with a discard-count hint when content changed", () => {
    const options = buildResolutionOptions({
      conflict: makeConflict({
        availableActions: ["link"],
        contentUnchanged: false,
        fileChanges: [
          { path: "a", status: "added", isBinary: false },
          { path: "b", status: "modified", isBinary: false },
        ],
      }),
      skillsetName: "my-skillset",
    });
    expect(options[0].hint).toContain("discard 2 file changes");
  });

  it("adds viewDiff only for changed content with existingSkillMd and a diff callback", () => {
    const cases: Array<{
      contentUnchanged: boolean;
      existingSkillMd: string | null;
      hasDiffCallback: boolean;
      expectViewDiff: boolean;
    }> = [
      {
        contentUnchanged: false,
        existingSkillMd: "# remote",
        hasDiffCallback: true,
        expectViewDiff: true,
      },
      {
        contentUnchanged: true,
        existingSkillMd: "# remote",
        hasDiffCallback: true,
        expectViewDiff: false,
      },
      {
        contentUnchanged: false,
        existingSkillMd: null,
        hasDiffCallback: true,
        expectViewDiff: false,
      },
      {
        contentUnchanged: false,
        existingSkillMd: "# remote",
        hasDiffCallback: false,
        expectViewDiff: false,
      },
    ];

    for (const {
      contentUnchanged,
      existingSkillMd,
      hasDiffCallback,
      expectViewDiff,
    } of cases) {
      const options = buildResolutionOptions({
        conflict: makeConflict({ contentUnchanged, existingSkillMd }),
        skillsetName: "my-skillset",
        hasDiffCallback,
      });
      expect(options.some((o) => o.value === "viewDiff")).toBe(expectViewDiff);
    }
  });
});

describe("getDefaultAction", () => {
  it("applies the default action rules per conflict state", () => {
    const cases: Array<{
      conflict: SkillConflict;
      expected: SkillResolutionAction;
    }> = [
      // Unchanged content with link available defaults to link
      {
        conflict: makeConflict({ contentUnchanged: true }),
        expected: "link",
      },
      // Unchanged content without link falls through to updateVersion
      {
        conflict: makeConflict({
          contentUnchanged: true,
          availableActions: ["updateVersion", "namespace"],
        }),
        expected: "updateVersion",
      },
      // Changed content with publish rights defaults to updateVersion
      {
        conflict: makeConflict({ contentUnchanged: false, canPublish: true }),
        expected: "updateVersion",
      },
      // Changed content without publish rights defaults to namespace
      {
        conflict: makeConflict({ contentUnchanged: false, canPublish: false }),
        expected: "namespace",
      },
      // canPublish without updateVersion available falls back to namespace
      {
        conflict: makeConflict({
          contentUnchanged: false,
          canPublish: true,
          availableActions: ["namespace", "link"],
        }),
        expected: "namespace",
      },
    ];

    for (const { conflict, expected } of cases) {
      expect(getDefaultAction({ conflict })).toBe(expected);
    }
  });
});

describe("getSuggestedVersion", () => {
  it("suggests the next patch version", () => {
    expect(getSuggestedVersion({ currentVersion: "1.2.3" })).toBe("1.2.4");
    expect(getSuggestedVersion({ currentVersion: "0.0.9" })).toBe("0.0.10");
  });

  it("returns 1.0.0 when there is no current version", () => {
    expect(getSuggestedVersion({ currentVersion: null })).toBe("1.0.0");
    expect(getSuggestedVersion({})).toBe("1.0.0");
  });

  it("returns 1.0.0 when the current version is not valid semver", () => {
    expect(getSuggestedVersion({ currentVersion: "not-a-version" })).toBe(
      "1.0.0",
    );
  });

  it("uses the provided fallback when no bump can be derived", () => {
    expect(
      getSuggestedVersion({ currentVersion: null, fallback: "2.5.0" }),
    ).toBe("2.5.0");
    expect(
      getSuggestedVersion({ currentVersion: "garbage", fallback: "2.5.0" }),
    ).toBe("2.5.0");
    // Fallback does not override a derivable bump
    expect(
      getSuggestedVersion({ currentVersion: "1.2.3", fallback: "2.5.0" }),
    ).toBe("1.2.4");
  });
});

describe("canAutoResolveConflict", () => {
  it("is true only for unchanged content with link available", () => {
    expect(
      canAutoResolveConflict({
        conflict: makeConflict({ contentUnchanged: true }),
      }),
    ).toBe(true);
    expect(
      canAutoResolveConflict({
        conflict: makeConflict({ contentUnchanged: false }),
      }),
    ).toBe(false);
    expect(
      canAutoResolveConflict({
        conflict: makeConflict({
          contentUnchanged: true,
          availableActions: ["updateVersion", "namespace"],
        }),
      }),
    ).toBe(false);
  });
});

describe("buildAutoResolutionStrategy", () => {
  it("links auto-resolvable conflicts and passes the rest through", () => {
    const autoResolvable = makeConflict({
      skillId: "unchanged-skill",
      contentUnchanged: true,
    });
    const changed = makeConflict({
      skillId: "changed-skill",
      contentUnchanged: false,
    });
    const noLink = makeConflict({
      skillId: "no-link-skill",
      contentUnchanged: true,
      availableActions: ["updateVersion", "namespace"],
    });

    const { strategy, unresolvedConflicts } = buildAutoResolutionStrategy({
      conflicts: [autoResolvable, changed, noLink],
    });

    expect(strategy).toEqual({ "unchanged-skill": { action: "link" } });
    expect(unresolvedConflicts).toEqual([changed, noLink]);
  });
});

describe("buildCommonResolutionOptions", () => {
  it("returns empty for no conflicts", () => {
    expect(
      buildCommonResolutionOptions({ conflicts: [], skillsetName: "s" }),
    ).toEqual([]);
  });

  it("only offers actions available on every conflict", () => {
    const options = buildCommonResolutionOptions({
      conflicts: [
        makeConflict({ availableActions: ["updateVersion", "link"] }),
        makeConflict({ availableActions: ["namespace", "link"] }),
      ],
      skillsetName: "my-skillset",
    });
    expect(options.map((o) => o.value)).toEqual(["link"]);
  });

  it("sums file changes into the link hint when all conflicts carry them", () => {
    const options = buildCommonResolutionOptions({
      conflicts: [
        makeConflict({
          availableActions: ["link"],
          fileChanges: [{ path: "a", status: "added", isBinary: false }],
        }),
        makeConflict({
          availableActions: ["link"],
          fileChanges: [
            { path: "b", status: "modified", isBinary: false },
            { path: "c", status: "removed", isBinary: false },
          ],
        }),
      ],
      skillsetName: "my-skillset",
    });
    expect(options[0].hint).toContain("discard 3 file changes");
  });

  it("falls back to the generic discard hint for mixed fileChanges payloads", () => {
    const options = buildCommonResolutionOptions({
      conflicts: [
        makeConflict({
          availableActions: ["link"],
          fileChanges: [{ path: "a", status: "added", isBinary: false }],
        }),
        makeConflict({ availableActions: ["link"], fileChanges: null }),
      ],
      skillsetName: "my-skillset",
    });
    expect(options[0].hint).toContain("any local changes");
  });
});

describe("applyResolveStrategy", () => {
  const getSkillId = (args: { conflict: SkillConflict }): string =>
    args.conflict.skillId;

  it("applies link, namespace, and cancel to conflicts that support them", () => {
    const actions: Array<SkillResolutionAction> = [
      "link",
      "namespace",
      "cancel",
    ];

    for (const resolve of actions) {
      const conflict = makeConflict({
        availableActions: ["updateVersion", "namespace", "link", "cancel"],
      });
      const { resolutions, stillUnresolved } = applyResolveStrategy({
        conflicts: [conflict],
        resolve,
        getConflictId: getSkillId,
      });
      expect(resolutions).toEqual({ "my-skill": { action: resolve } });
      expect(stillUnresolved).toEqual([]);
    }
  });

  it("suggests a bumped version per conflict for updateVersion", () => {
    const { resolutions, stillUnresolved } = applyResolveStrategy({
      conflicts: [
        makeConflict({ skillId: "a", latestVersion: "1.2.3" }),
        makeConflict({ skillId: "b", latestVersion: null }),
      ],
      resolve: "updateVersion",
      getConflictId: getSkillId,
    });

    expect(resolutions).toEqual({
      a: { action: "updateVersion", version: "1.2.4" },
      b: { action: "updateVersion", version: "1.0.0" },
    });
    expect(stillUnresolved).toEqual([]);
  });

  it("leaves conflicts unresolved when the action is not available", () => {
    const supported = makeConflict({ skillId: "supported" });
    const unsupported = makeConflict({
      skillId: "unsupported",
      availableActions: ["updateVersion", "namespace"],
    });

    const { resolutions, stillUnresolved } = applyResolveStrategy({
      conflicts: [supported, unsupported],
      resolve: "link",
      getConflictId: getSkillId,
    });

    expect(resolutions).toEqual({ supported: { action: "link" } });
    expect(stillUnresolved).toEqual([unsupported]);
  });

  it("works for subagent conflicts keyed by subagentId", () => {
    const conflict = makeSubagentConflict({ latestVersion: "2.0.0" });

    const { resolutions, stillUnresolved } = applyResolveStrategy({
      conflicts: [conflict],
      resolve: "updateVersion",
      getConflictId: ({ conflict: c }) => c.subagentId,
    });

    expect(resolutions).toEqual({
      "my-subagent": { action: "updateVersion", version: "2.0.1" },
    });
    expect(stillUnresolved).toEqual([]);
  });
});

describe("parseResolveStrategy", () => {
  it("returns a null action when the flag is absent", () => {
    expect(parseResolveStrategy({ resolve: null })).toEqual({ action: null });
    expect(parseResolveStrategy({})).toEqual({ action: null });
  });

  it("returns the typed action for every valid value", () => {
    for (const action of VALID_RESOLVE_ACTIONS) {
      expect(parseResolveStrategy({ resolve: action })).toEqual({ action });
    }
  });

  it("returns an error message listing valid options for invalid values", () => {
    const result = parseResolveStrategy({ resolve: "banana" });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain('Invalid --resolve value: "banana"');
      expect(result.error).toContain("updateVersion, link, namespace, cancel");
    }
  });
});

describe("hasConflicts / hasSubagentConflicts", () => {
  it("discriminates upload result variants", () => {
    const success: UploadResult = { success: true, version: "1.0.0" };
    const failure: UploadResult = { success: false, error: "boom" };
    const skillConflicts: UploadResult = {
      success: false,
      conflicts: [makeConflict({})],
    };
    const subagentConflicts: UploadResult = {
      success: false,
      subagentConflicts: [makeSubagentConflict({})],
    };

    expect(hasConflicts(success)).toBe(false);
    expect(hasConflicts(failure)).toBe(false);
    expect(hasConflicts(skillConflicts)).toBe(true);
    expect(hasConflicts(subagentConflicts)).toBe(false);

    expect(hasSubagentConflicts(success)).toBe(false);
    expect(hasSubagentConflicts(failure)).toBe(false);
    expect(hasSubagentConflicts(skillConflicts)).toBe(false);
    expect(hasSubagentConflicts(subagentConflicts)).toBe(true);
  });
});

describe("countFileChanges", () => {
  it("returns the entry count, treating null/undefined/empty as 0", () => {
    expect(
      countFileChanges({
        fileChanges: [
          { path: "a", status: "added", isBinary: false },
          { path: "b", status: "modified", isBinary: false },
        ],
      }),
    ).toBe(2);
    expect(countFileChanges({ fileChanges: null })).toBe(0);
    expect(countFileChanges({})).toBe(0);
    expect(countFileChanges({ fileChanges: [] })).toBe(0);
  });
});

describe("formatDiscardHint", () => {
  it("returns a pluralized clause for counts greater than 1", () => {
    expect(formatDiscardHint({ count: 3 })).toContain("3 file changes");
    expect(formatDiscardHint({ count: 3 })).not.toContain("3 file change.");
  });

  it("returns a singular clause for count of exactly 1", () => {
    const hint = formatDiscardHint({ count: 1 });
    expect(hint).toContain("1 file change");
    expect(hint).not.toContain("1 file changes");
  });

  it("returns the generic fallback for zero or negative counts", () => {
    expect(formatDiscardHint({ count: 0 })).toContain("any local changes");
    expect(formatDiscardHint({ count: 0 })).not.toMatch(/\d/);
  });
});

describe("determineUploadVersion", () => {
  beforeEach(() => {
    vi.mocked(registrarApi.getPackument).mockReset();
  });

  it("uses the explicit version without querying the registry", async () => {
    const result = await determineUploadVersion({
      skillsetName: "my-skillset",
      explicitVersion: "3.2.1",
      registryUrl: "https://registry.example",
    });

    expect(result).toEqual({ version: "3.2.1", isNewPackage: false });
    expect(registrarApi.getPackument).not.toHaveBeenCalled();
  });

  it("bumps the latest published patch version", async () => {
    vi.mocked(registrarApi.getPackument).mockResolvedValue({
      name: "my-skillset",
      "dist-tags": { latest: "1.2.3" },
      versions: { "1.2.3": { name: "my-skillset", version: "1.2.3" } },
    });

    const result = await determineUploadVersion({
      skillsetName: "my-skillset",
      registryUrl: "https://registry.example",
    });

    expect(result).toEqual({ version: "1.2.4", isNewPackage: false });
  });

  it("defaults to 1.0.0 for a new package when the packument lookup fails", async () => {
    vi.mocked(registrarApi.getPackument).mockRejectedValue(
      new Error("404 not found"),
    );

    const result = await determineUploadVersion({
      skillsetName: "brand-new",
      registryUrl: "https://registry.example",
    });

    expect(result).toEqual({ version: "1.0.0", isNewPackage: true });
  });

  it("defaults to 1.0.0 when the latest dist-tag is not valid semver", async () => {
    vi.mocked(registrarApi.getPackument).mockResolvedValue({
      name: "my-skillset",
      "dist-tags": { latest: "not-semver" },
      versions: {},
    });

    const result = await determineUploadVersion({
      skillsetName: "my-skillset",
      registryUrl: "https://registry.example",
    });

    expect(result).toEqual({ version: "1.0.0", isNewPackage: true });
  });
});
