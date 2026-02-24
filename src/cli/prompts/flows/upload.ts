/**
 * Upload flow module
 *
 * Provides the complete interactive upload experience using @clack/prompts.
 * This flow handles:
 * - Intro message with skillset and registry info
 * - Spinner during version determination
 * - Skill conflict resolution prompts
 * - Spinner during upload
 * - Note display for upload summary
 * - Outro message on success
 */

import { intro, outro, select, text, spinner, note, log } from "@clack/prompts";
import { diffLines } from "diff";
import * as semver from "semver";

import { bold, green, red } from "@/cli/logger.js";

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
    inlineSkillIds?: Array<string> | null;
  }) => Promise<UploadResult>;
  onReadLocalSkillMd?:
    | ((args: { skillId: string }) => Promise<string | null>)
    | null;
};

/**
 * Result of the upload flow
 */
export type UploadFlowResult = {
  version: string;
  extractedSkills?: ExtractedSkillsSummary | null;
  linkedSkillIds: Set<string>;
  namespacedSkillIds: Set<string>;
  skippedSkillIds: Set<string>;
  inlineSkillIds?: Array<string> | null;
} | null;

/**
 * Build resolution options based on available actions for a conflict
 *
 * When content is unchanged, all three options are available (if the API allows them).
 * When content has changed, only "updateVersion" (if canPublish) and "namespace" are allowed.
 *
 * @param args - The function arguments
 * @param args.conflict - The skill conflict to build options for
 * @param args.skillsetName - The skillset name for namespace preview
 *
 * @returns Array of resolution options for the select prompt
 */

/**
 * Union type for resolution actions and the local-only "viewDiff" pseudo-action
 */
type ConflictSelectAction = SkillResolutionAction | "viewDiff";

const buildResolutionOptions = (args: {
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
      options.push({
        value: "link",
        label: "Use Existing",
        hint: "Use existing version already on registry. Note that this will discard any local changes.",
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
 * Format a diff for terminal display with colored +/- lines
 *
 * @param args - The function arguments
 * @param args.existingContent - The existing SKILL.md content from the registry
 * @param args.localContent - The local SKILL.md content
 *
 * @returns Formatted diff string for display in a note
 */
const formatDiffForNote = (args: {
  existingContent: string;
  localContent: string;
}): string => {
  const { existingContent, localContent } = args;
  const changes = diffLines(existingContent, localContent);
  const lines: Array<string> = [];

  for (const change of changes) {
    const changeLines = change.value.replace(/\n$/, "").split("\n");
    for (const line of changeLines) {
      if (change.added) {
        lines.push(green({ text: `+ ${line}` }));
      } else if (change.removed) {
        lines.push(red({ text: `- ${line}` }));
      } else {
        lines.push(`  ${line}`);
      }
    }
  }

  return lines.join("\n");
};

/**
 * Resolve skill conflicts interactively within the flow
 *
 * @param args - The function arguments
 * @param args.conflicts - Array of skill conflicts to resolve
 * @param args.skillsetName - The skillset name for namespace preview
 * @param args.cancelMessage - Message to display on cancel
 * @param args.onReadLocalSkillMd - Optional callback to read local SKILL.md content
 *
 * @returns Resolution strategy or null if cancelled
 */
const resolveConflictsInFlow = async (args: {
  conflicts: Array<SkillConflict>;
  skillsetName: string;
  cancelMessage: string;
  onReadLocalSkillMd?:
    | ((args: { skillId: string }) => Promise<string | null>)
    | null;
}): Promise<SkillResolutionStrategy | null> => {
  const { conflicts, skillsetName, cancelMessage, onReadLocalSkillMd } = args;

  if (conflicts.length === 0) {
    return {};
  }

  const strategy: SkillResolutionStrategy = {};

  for (let i = 0; i < conflicts.length; i++) {
    const conflict = conflicts[i];
    const options = buildResolutionOptions({
      conflict,
      skillsetName,
      hasDiffCallback: onReadLocalSkillMd != null,
    });
    const defaultAction = getDefaultAction({ conflict });

    const message = formatConflictMessage({
      conflict,
      index: i + 1,
      total: conflicts.length,
    });

    let action: ConflictSelectAction | null = null;

    // Loop to allow viewing diff and then re-prompting
    while (action == null || action === "viewDiff") {
      action = unwrapPrompt({
        value: await select({
          message,
          options,
          initialValue: defaultAction,
        }),
        cancelMessage,
      });

      if (action == null) return null;

      if (action === "viewDiff") {
        if (onReadLocalSkillMd != null && conflict.existingSkillMd != null) {
          const localContent = await onReadLocalSkillMd({
            skillId: conflict.skillId,
          });

          if (localContent == null) {
            note(
              "Local SKILL.md not found for this skill.",
              `Diff unavailable for "${conflict.skillId}"`,
            );
          } else {
            const diffContent = formatDiffForNote({
              existingContent: conflict.existingSkillMd,
              localContent,
            });
            note(diffContent, `Diff for "${conflict.skillId}"`);
          }
        }
      }
    }

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
 * Build resolution options common to all unresolved conflicts for batch mode.
 * Only includes actions available across ALL conflicts.
 *
 * @param args - The function arguments
 * @param args.conflicts - Array of unresolved skill conflicts
 * @param args.skillsetName - The skillset name for namespace preview
 *
 * @returns Array of resolution options available for all conflicts
 */
const buildCommonResolutionOptions = (args: {
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
    options.push({
      value: "link",
      label: "Use Existing",
      hint: "Use existing version already on registry. Note that this will discard any local changes.",
    });
  }

  return options;
};

/**
 * Format unresolved conflicts for display in a note before batch prompting
 *
 * @param args - The function arguments
 * @param args.conflicts - Array of unresolved skill conflicts
 *
 * @returns Formatted string listing all unresolved conflicts
 */
const formatUnresolvedConflictsForNote = (args: {
  conflicts: Array<SkillConflict>;
}): string => {
  const { conflicts } = args;
  const lines: Array<string> = [];

  for (const conflict of conflicts) {
    const versionInfo =
      conflict.latestVersion != null ? ` (v${conflict.latestVersion})` : "";
    lines.push(`  ${conflict.skillId}${versionInfo}`);
  }

  return lines.join("\n");
};

/**
 * Resolve all unresolved conflicts with a single action chosen by the user.
 * For "updateVersion", each skill gets its own incremented version.
 *
 * @param args - The function arguments
 * @param args.conflicts - Array of unresolved skill conflicts
 * @param args.skillsetName - The skillset name for namespace preview
 * @param args.cancelMessage - Message to display on cancel
 *
 * @returns Resolution strategy or null if cancelled
 */
const resolveAllConflictsSameWay = async (args: {
  conflicts: Array<SkillConflict>;
  skillsetName: string;
  cancelMessage: string;
}): Promise<SkillResolutionStrategy | null> => {
  const { conflicts, skillsetName, cancelMessage } = args;

  const options = buildCommonResolutionOptions({ conflicts, skillsetName });

  const action = unwrapPrompt({
    value: await select({
      message: "How should all conflicts be resolved?",
      options,
    }),
    cancelMessage,
  });

  if (action == null) return null;

  const strategy: SkillResolutionStrategy = {};

  if (action === "updateVersion") {
    for (const conflict of conflicts) {
      const version = getSuggestedVersion({
        currentVersion: conflict.latestVersion,
      });
      strategy[conflict.skillId] = { action: "updateVersion", version };
    }
  } else {
    for (const conflict of conflicts) {
      strategy[conflict.skillId] = { action };
    }
  }

  return strategy;
};

/**
 * Resolve inline skill candidates one at a time
 *
 * @param args - The function arguments
 * @param args.candidates - Array of skill IDs without nori.json
 * @param args.cancelMessage - Message to display on cancel
 *
 * @returns Array of skill IDs to keep inline, or null if cancelled
 */
const resolveInlineSkillsInFlow = async (args: {
  candidates: Array<string>;
  cancelMessage: string;
}): Promise<Array<string> | null> => {
  const { candidates, cancelMessage } = args;
  const inlineSkillIds: Array<string> = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const parts: Array<string> = [];

    if (candidates.length > 1) {
      parts.push(`[${i + 1}/${candidates.length}]`);
    }

    parts.push(`"${candidate}" has no nori.json. Keep inline?`);

    const action = unwrapPrompt({
      value: await select({
        message: parts.join(" "),
        options: [
          {
            value: "inline" as const,
            label: "Keep inline",
            hint: "Skill stays bundled in the skillset tarball",
          },
          {
            value: "extract" as const,
            label: "Extract as package",
            hint: "Publish as an independent skill package",
          },
        ],
        initialValue: "inline" as const,
      }),
      cancelMessage,
    });

    if (action == null) return null;

    if (action === "inline") {
      inlineSkillIds.push(candidate);
    }
  }

  return inlineSkillIds;
};

/**
 * Resolve all inline skill candidates with a single choice
 *
 * @param args - The function arguments
 * @param args.candidates - Array of skill IDs without nori.json
 * @param args.cancelMessage - Message to display on cancel
 *
 * @returns Array of skill IDs to keep inline, or null if cancelled
 */
const resolveAllInlineSkillsSameWay = async (args: {
  candidates: Array<string>;
  cancelMessage: string;
}): Promise<Array<string> | null> => {
  const { candidates, cancelMessage } = args;

  const action = unwrapPrompt({
    value: await select({
      message: "Keep all skills without nori.json inline?",
      options: [
        {
          value: "inline" as const,
          label: "Keep all inline",
          hint: "Skills stay bundled in the skillset tarball",
        },
        {
          value: "extract" as const,
          label: "Extract all as packages",
          hint: "Publish each as an independent skill package",
        },
      ],
      initialValue: "inline" as const,
    }),
    cancelMessage,
  });

  if (action == null) return null;

  return action === "inline" ? [...candidates] : [];
};

/**
 * Format skill summary for display in a note
 * @param args - The function arguments
 * @param args.extractedSkills - Skills extracted during upload
 * @param args.linkedSkillIds - Set of skill IDs that were linked
 * @param args.namespacedSkillIds - Set of skill IDs that were namespaced
 * @param args.skippedSkillIds - Set of skill IDs that were skipped
 * @param args.inlineSkillIds - Skill IDs kept inline in the tarball
 *
 * @returns Formatted skill summary string or null if no skills
 */
const formatSkillSummaryForNote = (args: {
  extractedSkills?: ExtractedSkillsSummary | null;
  linkedSkillIds: Set<string>;
  namespacedSkillIds: Set<string>;
  skippedSkillIds: Set<string>;
  inlineSkillIds?: Array<string> | null;
}): string | null => {
  const {
    extractedSkills,
    linkedSkillIds,
    namespacedSkillIds,
    skippedSkillIds,
    inlineSkillIds,
  } = args;

  const hasInlineSkills = inlineSkillIds != null && inlineSkillIds.length > 0;

  if (extractedSkills == null && !hasInlineSkills) {
    return null;
  }

  const succeeded = extractedSkills?.succeeded ?? [];
  const failed = extractedSkills?.failed ?? [];

  if (succeeded.length === 0 && failed.length === 0 && !hasInlineSkills) {
    return null;
  }

  const lines: Array<string> = ["Skills:"];

  const skippedSkills = succeeded.filter((s) => skippedSkillIds.has(s.name));
  const linkedSkills = succeeded.filter(
    (s) => linkedSkillIds.has(s.name) && !skippedSkillIds.has(s.name),
  );
  const namespacedSkills = succeeded.filter((s) =>
    namespacedSkillIds.has(s.name),
  );
  const uploadedSkills = succeeded.filter(
    (s) =>
      !linkedSkillIds.has(s.name) &&
      !namespacedSkillIds.has(s.name) &&
      !skippedSkillIds.has(s.name),
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

  if (skippedSkills.length > 0) {
    lines.push("  Skipped:");
    for (const skill of skippedSkills) {
      lines.push(`    - ${skill.name}@${skill.version}`);
    }
  }

  if (hasInlineSkills && inlineSkillIds != null) {
    lines.push("  Inlined:");
    for (const skillId of inlineSkillIds) {
      lines.push(`    - ${skillId}`);
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
  lines.push("or rename conflicting skills in your skillset.");

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
 * 1. Shows intro message with skillset and registry
 * 2. Shows spinner while determining version
 * 3. Attempts upload
 * 4. If conflicts detected, auto-resolves where possible and prompts for rest
 * 5. Shows upload summary in a note
 * 6. Shows outro message
 *
 * @param args - Flow configuration
 * @param args.profileDisplayName - Display name for the skillset (e.g., "dev/onboarding")
 * @param args.skillsetName - The package name (e.g., "onboarding")
 * @param args.registryUrl - The target registry URL
 * @param args.callbacks - Callback functions for version determination and upload
 * @param args.nonInteractive - If true, don't prompt for conflict resolution
 * @param args.inlineCandidates - Skill IDs without nori.json that need inline/extract decision
 *
 * @returns Upload result on success, null on failure or cancellation
 */
export const uploadFlow = async (args: {
  profileDisplayName: string;
  skillsetName: string;
  registryUrl: string;
  callbacks: UploadFlowCallbacks;
  nonInteractive?: boolean | null;
  inlineCandidates?: Array<string> | null;
}): Promise<UploadFlowResult> => {
  const {
    profileDisplayName,
    skillsetName,
    registryUrl,
    callbacks,
    nonInteractive,
    inlineCandidates,
  } = args;
  const cancelMsg = "Upload cancelled.";

  // Track resolution actions for summary
  const linkedSkillIds = new Set<string>();
  const namespacedSkillIds = new Set<string>();
  const skippedSkillIds = new Set<string>();

  // Show intro first
  intro(`Upload ${profileDisplayName} to ${registryUrl}`);

  // Resolve inline skill candidates before upload
  let inlineSkillIds: Array<string> | undefined;
  const hasCandidates = inlineCandidates != null && inlineCandidates.length > 0;

  if (hasCandidates && !nonInteractive) {
    let resolvedInlineSkills: Array<string> | null = null;

    if (inlineCandidates.length > 1) {
      const batchChoice = unwrapPrompt({
        value: await select({
          message: `Found ${inlineCandidates.length} skill(s) without nori.json. How would you like to handle them?`,
          options: [
            {
              value: "all-same" as const,
              label: "Resolve all the same way",
              hint: "Apply a single choice to all skills",
            },
            {
              value: "one-by-one" as const,
              label: "Choose one-by-one",
              hint: "Decide for each skill individually",
            },
          ],
        }),
        cancelMessage: cancelMsg,
      });

      if (batchChoice == null) {
        return null;
      }

      if (batchChoice === "all-same") {
        resolvedInlineSkills = await resolveAllInlineSkillsSameWay({
          candidates: inlineCandidates,
          cancelMessage: cancelMsg,
        });
      } else {
        resolvedInlineSkills = await resolveInlineSkillsInFlow({
          candidates: inlineCandidates,
          cancelMessage: cancelMsg,
        });
      }
    } else {
      resolvedInlineSkills = await resolveInlineSkillsInFlow({
        candidates: inlineCandidates,
        cancelMessage: cancelMsg,
      });
    }

    if (resolvedInlineSkills == null) {
      return null;
    }

    if (resolvedInlineSkills.length > 0) {
      inlineSkillIds = resolvedInlineSkills;
    }
  }

  // Determine version and upload with a single spinner
  const uploadSpinner = spinner();
  uploadSpinner.start("Preparing upload...");

  await callbacks.onDetermineVersion();

  uploadSpinner.message("Uploading...");

  let result = await callbacks.onUpload({
    inlineSkillIds,
  });

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

      result = await callbacks.onUpload({
        resolutionStrategy: autoStrategy,
        inlineSkillIds,
      });
    } else if (nonInteractive) {
      // Non-interactive mode with unresolved conflicts
      uploadSpinner.stop("Upload blocked");

      note(formatConflictsForNote({ conflicts: result.conflicts }), "Error");

      outro(red({ text: "Upload failed: unresolved skill conflicts" }));
      return null;
    } else {
      // Interactive resolution needed
      uploadSpinner.stop("Skill conflicts detected");

      let interactiveStrategy: SkillResolutionStrategy | null = null;

      if (unresolvedConflicts.length > 1) {
        // Show all conflicts in a note, then ask batch vs one-by-one
        note(
          formatUnresolvedConflictsForNote({ conflicts: unresolvedConflicts }),
          `${unresolvedConflicts.length} conflicts require resolution`,
        );

        const batchChoice = unwrapPrompt({
          value: await select({
            message: "How would you like to resolve these conflicts?",
            options: [
              {
                value: "all-same" as const,
                label: "Resolve all the same way",
                hint: "Apply a single resolution to all conflicts",
              },
              {
                value: "one-by-one" as const,
                label: "Choose one-by-one",
                hint: "Resolve each conflict individually",
              },
            ],
          }),
          cancelMessage: cancelMsg,
        });

        if (batchChoice == null) {
          return null;
        }

        if (batchChoice === "all-same") {
          interactiveStrategy = await resolveAllConflictsSameWay({
            conflicts: unresolvedConflicts,
            skillsetName,
            cancelMessage: cancelMsg,
          });
        } else {
          interactiveStrategy = await resolveConflictsInFlow({
            conflicts: unresolvedConflicts,
            skillsetName,
            cancelMessage: cancelMsg,
            onReadLocalSkillMd: callbacks.onReadLocalSkillMd,
          });
        }
      } else {
        // Single unresolved conflict — go straight to individual resolution
        interactiveStrategy = await resolveConflictsInFlow({
          conflicts: unresolvedConflicts,
          skillsetName,
          cancelMessage: cancelMsg,
          onReadLocalSkillMd: callbacks.onReadLocalSkillMd,
        });
      }

      if (interactiveStrategy == null) {
        return null;
      }

      // Track resolution actions
      for (const [skillId, resolution] of Object.entries(interactiveStrategy)) {
        if (resolution.action === "link") {
          // Determine if this is "use existing" with discarded changes or genuine link (unchanged)
          const conflict = unresolvedConflicts.find(
            (c) => c.skillId === skillId,
          );
          if (conflict != null && conflict.contentUnchanged !== true) {
            skippedSkillIds.add(skillId);
          }
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
        inlineSkillIds,
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
    skippedSkillIds,
    inlineSkillIds,
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
    skippedSkillIds,
    inlineSkillIds,
  };
};
