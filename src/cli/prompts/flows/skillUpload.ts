/**
 * Skill upload flow module
 *
 * Provides a flow for uploading a single skill to the Nori registry.
 * Handles:
 * - Spinner while checking if the skill already exists on the registry
 * - Prompting the user when the remote content differs from local
 * - Showing a unified diff between local and remote SKILL.md on demand
 * - Spinner while uploading
 */

import { spinner, select, text, note, log } from "@clack/prompts";
import * as semver from "semver";

import { formatDiffForNote } from "./diffFormat.js";
import { unwrapPrompt } from "./utils.js";

/**
 * Result from the "check existing" callback
 */
export type CheckExistingResult =
  | { exists: false }
  | {
      exists: true;
      latestVersion: string;
      contentUnchanged: boolean;
      remoteSkillMd: string;
      localSkillMd: string;
    };

/**
 * Result from the "upload" callback
 */
export type SkillUploadActionResult =
  | { success: true; version: string }
  | { success: false; error: string };

/**
 * Callbacks for the skill upload flow
 */
export type SkillUploadFlowCallbacks = {
  onCheckExisting: () => Promise<CheckExistingResult>;
  onUpload: (args: { version: string }) => Promise<SkillUploadActionResult>;
};

/**
 * Result of the skill upload flow
 */
export type SkillUploadFlowResult = {
  version: string;
  uploaded: boolean;
  statusMessage: string;
};

type ConflictAction = "bump" | "viewDiff" | "cancel";

/**
 * Execute the skill upload flow
 *
 * @param args - Flow configuration
 * @param args.skillDisplayName - Display name of the skill being uploaded
 * @param args.defaultVersion - Version to use when no remote exists
 * @param args.explicitVersion - User-supplied version override (bypasses prompts)
 * @param args.nonInteractive - If true, skip interactive prompts
 * @param args.callbacks - Callback functions for checking existence and uploading
 *
 * @returns Upload result on success, null on cancellation
 */
export const skillUploadFlow = async (args: {
  skillDisplayName: string;
  defaultVersion: string;
  explicitVersion?: string | null;
  nonInteractive?: boolean | null;
  callbacks: SkillUploadFlowCallbacks;
}): Promise<SkillUploadFlowResult | null> => {
  const {
    skillDisplayName,
    defaultVersion,
    explicitVersion,
    nonInteractive,
    callbacks,
  } = args;

  const s = spinner();

  // Phase 1: Check for existing skill on the registry
  s.start("Checking registry...");
  const existing = await callbacks.onCheckExisting();
  s.stop(existing.exists ? "Found on registry" : "Not on registry");

  // No remote skill: upload at defaultVersion (or explicit override)
  if (!existing.exists) {
    return runUpload({
      skillDisplayName,
      version: explicitVersion ?? defaultVersion,
      callbacks,
      spin: s,
    });
  }

  // Remote exists and content matches: already up to date
  if (existing.contentUnchanged && explicitVersion == null) {
    log.success(
      `"${skillDisplayName}" is already up to date on the registry at version ${existing.latestVersion}.`,
    );
    return {
      version: existing.latestVersion,
      uploaded: false,
      statusMessage: `Already up to date at ${existing.latestVersion}`,
    };
  }

  // Remote exists, content differs (or version override forces re-upload)
  const suggestedNext =
    semver.inc(existing.latestVersion, "patch") ?? defaultVersion;

  if (explicitVersion != null) {
    return runUpload({
      skillDisplayName,
      version: explicitVersion,
      callbacks,
      spin: s,
    });
  }

  if (nonInteractive) {
    log.error(
      `"${skillDisplayName}" has uncommitted local changes vs. registry version ${existing.latestVersion}. Pass --version to upload non-interactively.`,
    );
    return null;
  }

  // Interactive conflict resolution
  let action: ConflictAction | null = null;
  while (action == null || action === "viewDiff") {
    const selectResult = await select({
      message: `"${skillDisplayName}" already exists at v${existing.latestVersion} with different content`,
      options: [
        {
          value: "bump",
          label: "Bump version",
          hint: `Publish as new version (default: ${suggestedNext})`,
        },
        {
          value: "viewDiff",
          label: "View diff",
          hint: "Show local vs. registry differences",
        },
        {
          value: "cancel",
          label: "Cancel",
          hint: "Do not upload",
        },
      ],
      initialValue: "bump" as const,
    });

    action = unwrapPrompt({
      value: selectResult,
      cancelMessage: "Upload cancelled.",
    }) as ConflictAction | null;

    if (action == null) return null;

    if (action === "viewDiff") {
      const diffBody = formatDiffForNote({
        existingContent: existing.remoteSkillMd,
        localContent: existing.localSkillMd,
      });
      note(diffBody, `Diff for "${skillDisplayName}" (- remote, + local)`);
    }
  }

  if (action === "cancel") {
    return null;
  }

  const versionPrompt = await text({
    message: `Enter new version for "${skillDisplayName}"`,
    defaultValue: suggestedNext,
    placeholder: suggestedNext,
    validate: (value) => {
      if (value == null || value.length === 0) return undefined;
      if (semver.valid(value) == null) {
        return "Please enter a valid semver version (e.g., 1.0.0)";
      }
      if (semver.lte(value, existing.latestVersion)) {
        return `Version must be greater than ${existing.latestVersion}`;
      }
      return undefined;
    },
  });

  const newVersion = unwrapPrompt({
    value: versionPrompt,
    cancelMessage: "Upload cancelled.",
  });

  if (newVersion == null) return null;

  return runUpload({
    skillDisplayName,
    version: newVersion === "" ? suggestedNext : newVersion,
    callbacks,
    spin: s,
  });
};

/**
 * Run the upload callback with a spinner and format the result.
 *
 * @param args - Arguments
 * @param args.skillDisplayName - Skill display name for messages
 * @param args.version - Version to publish
 * @param args.callbacks - Flow callbacks
 * @param args.spin - Spinner to update
 *
 * @returns Flow result on success, null on failure
 */
const runUpload = async (args: {
  skillDisplayName: string;
  version: string;
  callbacks: SkillUploadFlowCallbacks;
  spin: ReturnType<typeof spinner>;
}): Promise<SkillUploadFlowResult | null> => {
  const { skillDisplayName, version, callbacks, spin } = args;

  spin.start(`Uploading "${skillDisplayName}@${version}"...`);
  const result = await callbacks.onUpload({ version });

  if (!result.success) {
    spin.stop("Failed");
    log.error(result.error);
    return null;
  }

  spin.stop("Uploaded");

  return {
    version: result.version,
    uploaded: true,
    statusMessage: `Uploaded "${skillDisplayName}@${result.version}"`,
  };
};
