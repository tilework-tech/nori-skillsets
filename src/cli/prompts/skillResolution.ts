/**
 * Skill resolution prompt
 *
 * Provides an interactive prompt for resolving skill conflicts during profile upload.
 * Allows users to choose how to handle each conflicting skill: namespace, update version, or link.
 */

import { select, text, isCancel } from "@clack/prompts";
import * as semver from "semver";

import type {
  SkillConflict,
  SkillResolutionStrategy,
  SkillResolutionAction,
} from "@/api/registrar.js";

import { handleCancel } from "./utils.js";

/**
 * Option for the resolution select prompt
 */
type ResolutionOption = {
  value: SkillResolutionAction;
  label: string;
  hint?: string;
};

/**
 * Build resolution options based on available actions for a conflict
 *
 * When content is unchanged, all three options are available (if the API allows them).
 * When content has changed, only "updateVersion" (if canPublish) and "namespace" are allowed.
 *
 * @param args - The function arguments
 * @param args.conflict - The skill conflict
 * @param args.profileName - The profile name (used for namespace preview)
 *
 * @returns Array of resolution options for the select prompt
 */
const buildResolutionOptions = (args: {
  conflict: SkillConflict;
  profileName: string;
}): Array<ResolutionOption> => {
  const { conflict, profileName } = args;
  const options: Array<ResolutionOption> = [];

  const contentUnchanged = conflict.contentUnchanged === true;

  // Add options based on availableActions (excluding 'cancel' which is handled via Ctrl+C)
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
      hint: `Rename to ${profileName}-${conflict.skillId}`,
    });
  }

  // "link" is only available when content is unchanged
  if (contentUnchanged && conflict.availableActions.includes("link")) {
    options.push({
      value: "link",
      label: "Use Existing",
      hint: `Link to existing v${conflict.latestVersion ?? "?"}`,
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
const getDefaultAction = (args: {
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
 *
 * @returns The suggested next patch version
 */
const getSuggestedVersion = (args: {
  currentVersion?: string | null;
}): string => {
  const { currentVersion } = args;

  if (currentVersion == null) {
    return "1.0.0";
  }

  const nextVersion = semver.inc(currentVersion, "patch");
  return nextVersion ?? "1.0.0";
};

/**
 * Format the conflict message for the select prompt
 * @param args - The function arguments
 * @param args.conflict - The skill conflict
 * @param args.index - The current conflict index (1-based)
 * @param args.total - The total number of conflicts
 *
 * @returns Formatted message string
 */
const formatConflictMessage = (args: {
  conflict: SkillConflict;
  index: number;
  total: number;
}): string => {
  const { conflict, index, total } = args;

  const parts: Array<string> = [];

  if (total > 1) {
    parts.push(`[${index}/${total}]`);
  }

  parts.push(`Resolve conflict for "${conflict.skillId}"`);

  if (conflict.latestVersion != null) {
    parts.push(`(current: v${conflict.latestVersion})`);
  }

  return parts.join(" ");
};

/**
 * Prompt user to select resolution for each skill conflict
 *
 * For each conflict, presents available resolution options:
 * - Namespace: Rename the skill to profileName-skillId
 * - Update Version: Publish as a new version (if user can publish)
 * - Link: Use the existing version (if content is unchanged)
 *
 * @param args - The function arguments
 * @param args.conflicts - Array of skill conflicts to resolve
 * @param args.profileName - The profile name (used for namespace preview)
 *
 * @returns Resolution strategy mapping skill IDs to resolution decisions
 */
export const selectSkillResolution = async (args: {
  conflicts: Array<SkillConflict>;
  profileName: string;
}): Promise<SkillResolutionStrategy> => {
  const { conflicts, profileName } = args;

  if (conflicts.length === 0) {
    return {};
  }

  const strategy: SkillResolutionStrategy = {};

  for (let i = 0; i < conflicts.length; i++) {
    const conflict = conflicts[i];
    const options = buildResolutionOptions({ conflict, profileName });
    const defaultAction = getDefaultAction({ conflict });

    const message = formatConflictMessage({
      conflict,
      index: i + 1,
      total: conflicts.length,
    });

    const action = await select({
      message,
      options,
      initialValue: defaultAction,
    });

    if (isCancel(action)) {
      handleCancel();
      // handleCancel exits the process, but TypeScript doesn't know that
      // Return empty strategy to satisfy type checker
      return {};
    }

    const selectedAction = action as SkillResolutionAction;

    // If updateVersion is selected, prompt for the version
    if (selectedAction === "updateVersion") {
      const suggestedVersion = getSuggestedVersion({
        currentVersion: conflict.latestVersion,
      });

      const version = await text({
        message: `Enter new version for "${conflict.skillId}"`,
        defaultValue: suggestedVersion,
        validate: (value) => {
          if (!semver.valid(value)) {
            return "Please enter a valid semver version (e.g., 1.0.0)";
          }
          return undefined;
        },
      });

      if (isCancel(version)) {
        handleCancel();
        return {};
      }

      strategy[conflict.skillId] = {
        action: "updateVersion",
        version: version as string,
      };
    } else {
      strategy[conflict.skillId] = { action: selectedAction };
    }
  }

  return strategy;
};
