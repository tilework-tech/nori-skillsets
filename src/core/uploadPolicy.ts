/**
 * Upload policy module
 *
 * Pure policy for skillset uploads: which conflict-resolution actions are
 * offered, which one is the default, how versions are suggested and bumped,
 * how conflicts are auto-resolved or resolved via a `--resolve` strategy, and
 * how the `--resolve` CLI value is validated.
 *
 * This module contains no prompting, no CLI parsing, and no process control.
 * It must never import from `src/cli/`.
 */

import * as semver from "semver";

import { registrarApi } from "@/api/registrar.js";

import type {
  ExtractedSkillsSummary,
  ExtractedSubagentsSummary,
  FileChange,
  SkillConflict,
  SkillResolutionAction,
  SkillResolutionStrategy,
  SubagentConflict,
} from "@/api/registrar.js";

/**
 * Result of an upload attempt
 */
export type UploadResult =
  | {
      success: true;
      version: string;
      extractedSkills?: ExtractedSkillsSummary | null;
      extractedSubagents?: ExtractedSubagentsSummary | null;
    }
  | {
      success: false;
      error: string;
    }
  | {
      success: false;
      conflicts: Array<SkillConflict>;
    }
  | {
      success: false;
      subagentConflicts: Array<SubagentConflict>;
    };

/**
 * Union type for resolution actions and the local-only "viewDiff" pseudo-action
 */
export type ConflictSelectAction = SkillResolutionAction | "viewDiff";

/**
 * Minimal conflict shape shared by skill and subagent conflicts, as needed by
 * the resolve-strategy application policy.
 */
type ResolvableConflict = {
  latestVersion?: string | null;
  availableActions: Array<SkillResolutionAction>;
};

/**
 * Count the number of entries in an optional fileChanges list.
 *
 * Returns 0 when the list is null, undefined, or empty. Used to pluralize the
 * "Use Existing" discard-count hint and to decide whether to render a note.
 *
 * @param args - The function arguments
 * @param args.fileChanges - Optional per-file change entries
 *
 * @returns The number of changed files (0 when absent or empty)
 */
export const countFileChanges = (args: {
  fileChanges?: ReadonlyArray<FileChange> | null;
}): number => {
  const { fileChanges } = args;
  if (fileChanges == null) return 0;
  return fileChanges.length;
};

/**
 * Build the "Use Existing" discard-clause hint. When `count` is > 0 the clause
 * is pluralized against the count; otherwise falls back to generic messaging
 * used for older registrars that did not return `fileChanges`.
 *
 * @param args - The function arguments
 * @param args.count - Number of file changes that would be discarded
 *
 * @returns Discard hint string
 */
export const formatDiscardHint = (args: { count: number }): string => {
  const { count } = args;
  if (count <= 0) {
    return "Note that this will discard any local changes.";
  }
  const noun = count === 1 ? "file change" : "file changes";
  return `Note that this will discard ${count} ${noun}.`;
};

/**
 * Build resolution options based on available actions for a conflict
 *
 * When content is unchanged, all three options are available (if the API allows them).
 * When content has changed, only "updateVersion" (if canPublish) and "namespace" are allowed.
 *
 * @param args - The function arguments
 * @param args.conflict - The skill conflict to build options for
 * @param args.skillsetName - The skillset name for namespace preview
 * @param args.hasDiffCallback - Whether a local-content reader is available for "View Diff"
 *
 * @returns Array of resolution options for the select prompt
 */
export const buildResolutionOptions = (args: {
  conflict: SkillConflict;
  skillsetName: string;
  hasDiffCallback?: boolean | null;
}): Array<{ value: ConflictSelectAction; label: string; hint?: string }> => {
  const { conflict, skillsetName, hasDiffCallback } = args;
  const options: Array<{
    value: ConflictSelectAction;
    label: string;
    hint?: string;
  }> = [];

  const contentUnchanged = conflict.contentUnchanged === true;

  if (conflict.availableActions.includes("updateVersion")) {
    options.push({
      value: "updateVersion",
      label: "Update Version",
      hint: "Publish as new version of existing skill",
    });
  }

  if (conflict.availableActions.includes("namespace")) {
    options.push({
      value: "namespace",
      label: "Namespace",
      hint: `Rename to ${skillsetName}-${conflict.skillId}`,
    });
  }

  // "link" action has two presentations depending on content status
  if (conflict.availableActions.includes("link")) {
    if (contentUnchanged) {
      options.push({
        value: "link",
        label: "Use Existing",
        hint: `Link to existing v${conflict.latestVersion ?? "?"}`,
      });
    } else {
      const fileCount = countFileChanges({ fileChanges: conflict.fileChanges });
      options.push({
        value: "link",
        label: "Use Existing",
        hint: `Use existing version already on registry. ${formatDiscardHint({ count: fileCount })}`,
      });
    }
  }

  // Add "View Diff" when server provided existingSkillMd and content has changed
  if (
    hasDiffCallback &&
    !contentUnchanged &&
    conflict.existingSkillMd != null
  ) {
    options.push({
      value: "viewDiff",
      label: "View Diff",
      hint: "Show differences between local and registry SKILL.md",
    });
  }

  return options;
};

/**
 * Determine the default selection for a conflict
 *
 * When content is unchanged and link is available, default to "link".
 * When content has changed:
 *   - Default to "updateVersion" if user can publish (canPublish === true)
 *   - Otherwise default to "namespace"
 *
 * @param args - The function arguments
 * @param args.conflict - The skill conflict
 *
 * @returns The default action to select
 */
export const getDefaultAction = (args: {
  conflict: SkillConflict;
}): SkillResolutionAction => {
  const { conflict } = args;

  // Content unchanged - default to link if available
  if (
    conflict.contentUnchanged === true &&
    conflict.availableActions.includes("link")
  ) {
    return "link";
  }

  // Content changed - default to updateVersion if user can publish
  if (
    conflict.canPublish === true &&
    conflict.availableActions.includes("updateVersion")
  ) {
    return "updateVersion";
  }

  return "namespace";
};

/**
 * Get the suggested next version for a skill
 * @param args - The function arguments
 * @param args.currentVersion - The current version string
 * @param args.fallback - Suggestion when no next patch version can be derived
 *   (defaults to "1.0.0")
 *
 * @returns The suggested next patch version
 */
export const getSuggestedVersion = (args: {
  currentVersion?: string | null;
  fallback?: string | null;
}): string => {
  const { currentVersion } = args;
  const fallback = args.fallback ?? "1.0.0";

  if (currentVersion == null) {
    return fallback;
  }

  const nextVersion = semver.inc(currentVersion, "patch");
  return nextVersion ?? fallback;
};

/**
 * Check if a conflict can be auto-resolved (unchanged content + link available)
 * @param args - The function arguments
 * @param args.conflict - The skill conflict to check
 *
 * @returns True if the conflict can be auto-resolved
 */
export const canAutoResolveConflict = (args: {
  conflict: SkillConflict;
}): boolean => {
  const { conflict } = args;
  return (
    conflict.contentUnchanged === true &&
    conflict.availableActions.includes("link")
  );
};

/**
 * Build auto-resolution strategy for conflicts that can be auto-resolved
 * @param args - The function arguments
 * @param args.conflicts - Array of skill conflicts
 *
 * @returns Strategy and unresolved conflicts
 */
export const buildAutoResolutionStrategy = (args: {
  conflicts: Array<SkillConflict>;
}): {
  strategy: SkillResolutionStrategy;
  unresolvedConflicts: Array<SkillConflict>;
} => {
  const { conflicts } = args;
  const strategy: SkillResolutionStrategy = {};
  const unresolvedConflicts: Array<SkillConflict> = [];

  for (const conflict of conflicts) {
    if (canAutoResolveConflict({ conflict })) {
      strategy[conflict.skillId] = { action: "link" };
    } else {
      unresolvedConflicts.push(conflict);
    }
  }

  return { strategy, unresolvedConflicts };
};

/**
 * Apply a `--resolve` action to every conflict that supports it.
 *
 * For "updateVersion" each conflict gets its own suggested next patch version.
 * Conflicts whose availableActions do not include the action are left
 * untouched and returned as still unresolved.
 *
 * @param args - The function arguments
 * @param args.conflicts - Conflicts not yet covered by another resolution
 * @param args.resolve - The resolution action to apply
 * @param args.getConflictId - Extracts the strategy key (skillId / subagentId)
 *
 * @returns Per-conflict resolutions and the still-unresolved remainder
 */
export const applyResolveStrategy = <
  TConflict extends ResolvableConflict,
>(args: {
  conflicts: Array<TConflict>;
  resolve: SkillResolutionAction;
  getConflictId: (args: { conflict: TConflict }) => string;
}): {
  resolutions: SkillResolutionStrategy;
  stillUnresolved: Array<TConflict>;
} => {
  const { conflicts, resolve, getConflictId } = args;
  const resolutions: SkillResolutionStrategy = {};

  for (const conflict of conflicts) {
    if (!conflict.availableActions.includes(resolve)) {
      continue;
    }

    if (resolve === "updateVersion") {
      resolutions[getConflictId({ conflict })] = {
        action: "updateVersion",
        version: getSuggestedVersion({
          currentVersion: conflict.latestVersion,
        }),
      };
    } else {
      resolutions[getConflictId({ conflict })] = { action: resolve };
    }
  }

  const stillUnresolved = conflicts.filter(
    (conflict) => resolutions[getConflictId({ conflict })] == null,
  );

  return { resolutions, stillUnresolved };
};

/**
 * Build resolution options common to all unresolved conflicts for batch mode.
 * Only includes actions available across ALL conflicts.
 *
 * @param args - The function arguments
 * @param args.conflicts - Array of unresolved skill conflicts
 * @param args.skillsetName - The skillset name for namespace preview
 *
 * @returns Array of resolution options available for all conflicts
 */
export const buildCommonResolutionOptions = (args: {
  conflicts: Array<SkillConflict>;
  skillsetName: string;
}): Array<{ value: SkillResolutionAction; label: string; hint?: string }> => {
  const { conflicts, skillsetName } = args;

  if (conflicts.length === 0) {
    return [];
  }

  // Find actions common to ALL conflicts
  const firstActions = new Set(conflicts[0].availableActions);
  const commonActions = conflicts.reduce((common, conflict) => {
    const actionSet = new Set(conflict.availableActions);
    return new Set([...common].filter((a) => actionSet.has(a)));
  }, firstActions);

  const options: Array<{
    value: SkillResolutionAction;
    label: string;
    hint?: string;
  }> = [];

  if (commonActions.has("updateVersion")) {
    options.push({
      value: "updateVersion",
      label: "Update Version",
      hint: "Publish each as new version of existing skill",
    });
  }

  if (commonActions.has("namespace")) {
    options.push({
      value: "namespace",
      label: "Namespace",
      hint: `Rename each to ${skillsetName}-<skillId>`,
    });
  }

  // All unresolved conflicts here have changed content, so "link" = "Use Existing"
  if (commonActions.has("link")) {
    // Only surface a precise file-change count when EVERY conflict in the
    // batch carries fileChanges. Mixed payloads (some with, some without)
    // would under-report the real impact and mislead the user, so fall back
    // to the generic discard message in that case.
    const allHaveFileChanges = conflicts.every((c) => c.fileChanges != null);
    const totalFileChanges = allHaveFileChanges
      ? conflicts.reduce(
          (sum, c) => sum + countFileChanges({ fileChanges: c.fileChanges }),
          0,
        )
      : 0;
    options.push({
      value: "link",
      label: "Use Existing",
      hint: `Use existing version already on registry. ${formatDiscardHint({ count: totalFileChanges })}`,
    });
  }

  return options;
};

/**
 * Check if an upload result has conflicts
 * @param result - The upload result to check
 *
 * @returns True if the result contains conflicts
 */
export const hasConflicts = (
  result: UploadResult,
): result is { success: false; conflicts: Array<SkillConflict> } => {
  return (
    !result.success && "conflicts" in result && Array.isArray(result.conflicts)
  );
};

/**
 * Check if an upload result has subagent conflicts
 * @param result - The upload result to check
 *
 * @returns True if the result contains subagent conflicts
 */
export const hasSubagentConflicts = (
  result: UploadResult,
): result is { success: false; subagentConflicts: Array<SubagentConflict> } => {
  return (
    !result.success &&
    "subagentConflicts" in result &&
    Array.isArray(result.subagentConflicts)
  );
};

/**
 * Determine the version to upload (auto-bump if not specified)
 * @param args - The function arguments
 * @param args.skillsetName - The skillset name
 * @param args.explicitVersion - Explicit version if provided
 * @param args.registryUrl - The registry URL
 * @param args.authToken - Auth token for the registry
 *
 * @returns The version to upload and whether this is a new package
 */
export const determineUploadVersion = async (args: {
  skillsetName: string;
  explicitVersion?: string | null;
  registryUrl: string;
  authToken?: string | null;
}): Promise<{ version: string; isNewPackage: boolean }> => {
  const { skillsetName, explicitVersion, registryUrl, authToken } = args;

  if (explicitVersion != null) {
    return { version: explicitVersion, isNewPackage: false };
  }

  try {
    const packument = await registrarApi.getPackument({
      packageName: skillsetName,
      registryUrl,
      authToken,
    });

    const latestVersion = packument["dist-tags"].latest;
    if (latestVersion != null && semver.valid(latestVersion) != null) {
      const nextVersion = semver.inc(latestVersion, "patch");
      if (nextVersion != null) {
        return { version: nextVersion, isNewPackage: false };
      }
    }
  } catch {
    // Package doesn't exist - default to 1.0.0
  }

  return { version: "1.0.0", isNewPackage: true };
};

/**
 * Actions accepted by the `--resolve` CLI flag
 */
export const VALID_RESOLVE_ACTIONS: ReadonlyArray<string> = [
  "updateVersion",
  "link",
  "namespace",
  "cancel",
];

/**
 * Validate and type a `--resolve` CLI value.
 *
 * @param args - The function arguments
 * @param args.resolve - The raw `--resolve` value (null when the flag is absent)
 *
 * @returns The typed action (null when the flag is absent) or an error message
 */
export const parseResolveStrategy = (args: {
  resolve?: string | null;
}): { action: SkillResolutionAction | null } | { error: string } => {
  const { resolve } = args;

  if (resolve == null) {
    return { action: null };
  }

  if (!VALID_RESOLVE_ACTIONS.includes(resolve)) {
    return {
      error: `Invalid --resolve value: "${resolve}".\nValid options: ${VALID_RESOLVE_ACTIONS.join(", ")}`,
    };
  }

  return { action: resolve as SkillResolutionAction };
};
