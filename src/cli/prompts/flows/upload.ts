/**
 * Upload flow module
 *
 * Provides the complete interactive upload experience using @clack/prompts.
 * This flow handles:
 * - Intro message with profile and registry info
 * - Spinner during version determination
 * - Skill conflict resolution prompts
 * - Spinner during upload
 * - Note display for upload summary
 * - Outro message on success
 */

import { intro, outro, select, text, spinner, note, log } from "@clack/prompts";
import * as semver from "semver";

import { bold, red } from "@/cli/logger.js";

import type {
  SkillConflict,
  SkillResolutionStrategy,
  SkillResolutionAction,
  ExtractedSkillsSummary,
} from "@/api/registrar.js";

import { unwrapPrompt } from "./utils.js";

/**
 * Result of the version determination callback
 */
export type DetermineVersionResult = {
  version: string;
  isNewPackage: boolean;
};

/**
 * Result of the upload callback
 */
export type UploadResult =
  | {
      success: true;
      version: string;
      extractedSkills?: ExtractedSkillsSummary | null;
    }
  | {
      success: false;
      error: string;
    }
  | {
      success: false;
      conflicts: Array<SkillConflict>;
    };

/**
 * Callbacks for the upload flow
 */
export type UploadFlowCallbacks = {
  onDetermineVersion: () => Promise<DetermineVersionResult>;
  onUpload: (args: {
    resolutionStrategy?: SkillResolutionStrategy | null;
  }) => Promise<UploadResult>;
};

/**
 * Result of the upload flow
 */
export type UploadFlowResult = {
  version: string;
  extractedSkills?: ExtractedSkillsSummary | null;
  linkedSkillIds: Set<string>;
  namespacedSkillIds: Set<string>;
} | null;

/**
 * Build resolution options based on available actions for a conflict
 *
 * When content is unchanged, all three options are available (if the API allows them).
 * When content has changed, only "updateVersion" (if canPublish) and "namespace" are allowed.
 *
 * @param args - The function arguments
 * @param args.conflict - The skill conflict to build options for
 * @param args.profileName - The profile name for namespace preview
 *
 * @returns Array of resolution options for the select prompt
 */
const buildResolutionOptions = (args: {
  conflict: SkillConflict;
  profileName: string;
}): Array<{ value: SkillResolutionAction; label: string; hint?: string }> => {
  const { conflict, profileName } = args;
  const options: Array<{
    value: SkillResolutionAction;
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
 * Resolve skill conflicts interactively within the flow
 *
 * @param args - The function arguments
 * @param args.conflicts - Array of skill conflicts to resolve
 * @param args.profileName - The profile name for namespace preview
 * @param args.cancelMessage - Message to display on cancel
 *
 * @returns Resolution strategy or null if cancelled
 */
const resolveConflictsInFlow = async (args: {
  conflicts: Array<SkillConflict>;
  profileName: string;
  cancelMessage: string;
}): Promise<SkillResolutionStrategy | null> => {
  const { conflicts, profileName, cancelMessage } = args;

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

    const action = unwrapPrompt({
      value: await select({
        message,
        options,
        initialValue: defaultAction,
      }),
      cancelMessage,
    });

    if (action == null) return null;

    if (action === "updateVersion") {
      const suggestedVersion = getSuggestedVersion({
        currentVersion: conflict.latestVersion,
      });

      const version = unwrapPrompt({
        value: await text({
          message: `Enter new version for "${conflict.skillId}"`,
          defaultValue: suggestedVersion,
          validate: (value) => {
            if (!semver.valid(value)) {
              return "Please enter a valid semver version (e.g., 1.0.0)";
            }
            return undefined;
          },
        }),
        cancelMessage,
      });

      if (version == null) return null;

      strategy[conflict.skillId] = {
        action: "updateVersion",
        version,
      };
    } else {
      strategy[conflict.skillId] = { action };
    }
  }

  return strategy;
};

/**
 * Check if a conflict can be auto-resolved (unchanged content + link available)
 * @param args - The function arguments
 * @param args.conflict - The skill conflict to check
 *
 * @returns True if the conflict can be auto-resolved
 */
const canAutoResolveConflict = (args: { conflict: SkillConflict }): boolean => {
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
const buildAutoResolutionStrategy = (args: {
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
 * Format skill summary for display in a note
 * @param args - The function arguments
 * @param args.extractedSkills - Skills extracted during upload
 * @param args.linkedSkillIds - Set of skill IDs that were linked
 * @param args.namespacedSkillIds - Set of skill IDs that were namespaced
 *
 * @returns Formatted skill summary string or null if no skills
 */
const formatSkillSummaryForNote = (args: {
  extractedSkills?: ExtractedSkillsSummary | null;
  linkedSkillIds: Set<string>;
  namespacedSkillIds: Set<string>;
}): string | null => {
  const { extractedSkills, linkedSkillIds, namespacedSkillIds } = args;

  if (extractedSkills == null) {
    return null;
  }

  const { succeeded, failed } = extractedSkills;

  if (succeeded.length === 0 && failed.length === 0) {
    return null;
  }

  const lines: Array<string> = ["Skills:"];

  const linkedSkills = succeeded.filter((s) => linkedSkillIds.has(s.name));
  const namespacedSkills = succeeded.filter((s) =>
    namespacedSkillIds.has(s.name),
  );
  const uploadedSkills = succeeded.filter(
    (s) => !linkedSkillIds.has(s.name) && !namespacedSkillIds.has(s.name),
  );

  if (uploadedSkills.length > 0) {
    lines.push("  Uploaded:");
    for (const skill of uploadedSkills) {
      lines.push(`    - ${skill.name}@${skill.version}`);
    }
  }

  if (linkedSkills.length > 0) {
    lines.push("  Linked (existing):");
    for (const skill of linkedSkills) {
      lines.push(`    - ${skill.name}@${skill.version}`);
    }
  }

  if (namespacedSkills.length > 0) {
    lines.push("  Namespaced:");
    for (const skill of namespacedSkills) {
      lines.push(`    - ${skill.name}@${skill.version}`);
    }
  }

  if (failed.length > 0) {
    lines.push("  Failed:");
    for (const skill of failed) {
      lines.push(`    - ${skill.name}: ${skill.error}`);
    }
  }

  return lines.join("\n");
};

/**
 * Format conflicts for non-interactive error display
 * @param args - The function arguments
 * @param args.conflicts - Array of skill conflicts
 *
 * @returns Formatted string for display in a note
 */
const formatConflictsForNote = (args: {
  conflicts: Array<SkillConflict>;
}): string => {
  const { conflicts } = args;
  const lines: Array<string> = [
    red({ text: bold({ text: "Skill conflicts detected" }) }),
    "",
  ];

  for (const conflict of conflicts) {
    const status =
      conflict.contentUnchanged === true
        ? "(unchanged)"
        : red({ text: "(MODIFIED)" });
    lines.push(`  ${conflict.skillId} ${status}`);
    if (conflict.latestVersion != null) {
      lines.push(`    Current: v${conflict.latestVersion}`);
    }
    if (conflict.owner != null) {
      lines.push(`    Owner: ${conflict.owner}`);
    }
    lines.push(
      `    Available actions: ${conflict.availableActions.join(", ")}`,
    );
    lines.push("");
  }

  lines.push("Manual resolution required for modified skills.");
  lines.push("Run without --non-interactive to resolve interactively,");
  lines.push("or rename conflicting skills in your profile.");

  return lines.join("\n");
};

/**
 * Check if an upload result has conflicts
 * @param result - The upload result to check
 *
 * @returns True if the result contains conflicts
 */
const hasConflicts = (
  result: UploadResult,
): result is { success: false; conflicts: Array<SkillConflict> } => {
  return (
    !result.success && "conflicts" in result && Array.isArray(result.conflicts)
  );
};

/**
 * Execute the interactive upload flow
 *
 * This function handles the complete upload UX:
 * 1. Shows intro message with profile and registry
 * 2. Shows spinner while determining version
 * 3. Attempts upload
 * 4. If conflicts detected, auto-resolves where possible and prompts for rest
 * 5. Shows upload summary in a note
 * 6. Shows outro message
 *
 * @param args - Flow configuration
 * @param args.profileDisplayName - Display name for the profile (e.g., "dev/onboarding")
 * @param args.profileName - The package name (e.g., "onboarding")
 * @param args.registryUrl - The target registry URL
 * @param args.callbacks - Callback functions for version determination and upload
 * @param args.nonInteractive - If true, don't prompt for conflict resolution
 *
 * @returns Upload result on success, null on failure or cancellation
 */
export const uploadFlow = async (args: {
  profileDisplayName: string;
  profileName: string;
  registryUrl: string;
  callbacks: UploadFlowCallbacks;
  nonInteractive?: boolean | null;
}): Promise<UploadFlowResult> => {
  const {
    profileDisplayName,
    profileName,
    registryUrl,
    callbacks,
    nonInteractive,
  } = args;
  const cancelMsg = "Upload cancelled.";

  // Track resolution actions for summary
  const linkedSkillIds = new Set<string>();
  const namespacedSkillIds = new Set<string>();

  // Show intro first
  intro(`Upload ${profileDisplayName} to ${registryUrl}`);

  // Determine version and upload with a single spinner
  const uploadSpinner = spinner();
  uploadSpinner.start("Preparing upload...");

  await callbacks.onDetermineVersion();

  uploadSpinner.message("Uploading...");

  let result = await callbacks.onUpload({});

  // Step 3: Handle conflicts if any
  if (hasConflicts(result)) {
    const { strategy: autoStrategy, unresolvedConflicts } =
      buildAutoResolutionStrategy({ conflicts: result.conflicts });

    // Track auto-resolved links
    for (const [skillId, resolution] of Object.entries(autoStrategy)) {
      if (resolution.action === "link") {
        linkedSkillIds.add(skillId);
      }
    }

    // If all can be auto-resolved, retry immediately
    if (unresolvedConflicts.length === 0) {
      uploadSpinner.message(
        `Auto-resolving ${Object.keys(autoStrategy).length} unchanged skill(s)...`,
      );

      result = await callbacks.onUpload({ resolutionStrategy: autoStrategy });
    } else if (nonInteractive) {
      // Non-interactive mode with unresolved conflicts
      uploadSpinner.stop("Upload blocked");

      note(formatConflictsForNote({ conflicts: result.conflicts }), "Error");

      outro(red({ text: "Upload failed: unresolved skill conflicts" }));
      return null;
    } else {
      // Interactive resolution needed
      uploadSpinner.stop("Skill conflicts detected");

      const interactiveStrategy = await resolveConflictsInFlow({
        conflicts: unresolvedConflicts,
        profileName,
        cancelMessage: cancelMsg,
      });

      if (interactiveStrategy == null) {
        return null;
      }

      // Track resolution actions
      for (const [skillId, resolution] of Object.entries(interactiveStrategy)) {
        if (resolution.action === "link") {
          linkedSkillIds.add(skillId);
        } else if (resolution.action === "namespace") {
          namespacedSkillIds.add(skillId);
        }
      }

      // Merge strategies
      const combinedStrategy: SkillResolutionStrategy = {
        ...autoStrategy,
        ...interactiveStrategy,
      };

      // Retry upload with resolution strategy
      uploadSpinner.start("Uploading with resolutions...");
      result = await callbacks.onUpload({
        resolutionStrategy: combinedStrategy,
      });
    }
  }

  // Step 4: Handle final result
  if (!result.success) {
    uploadSpinner.stop("Upload failed");

    if ("error" in result) {
      log.error(result.error);
    }

    outro(red({ text: "Upload failed" }));
    return null;
  }

  uploadSpinner.stop("Uploaded");

  // Step 5: Show summary
  const skillSummary = formatSkillSummaryForNote({
    extractedSkills: result.extractedSkills,
    linkedSkillIds,
    namespacedSkillIds,
  });

  const summaryLines: Array<string> = [];

  if (skillSummary != null) {
    summaryLines.push(skillSummary);
    summaryLines.push("");
  }

  summaryLines.push("Others can install it with:");
  summaryLines.push(`  nori-skillsets download ${profileDisplayName}`);

  note(summaryLines.join("\n"), "Upload Summary");

  // Step 6: Outro
  outro(`Uploaded ${profileDisplayName}@${result.version}`);

  return {
    version: result.version,
    extractedSkills: result.extractedSkills,
    linkedSkillIds,
    namespacedSkillIds,
  };
};
