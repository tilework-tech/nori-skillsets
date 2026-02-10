/**
 * Switch skillset flow module
 *
 * Provides the complete interactive switch-skillset experience using @clack/prompts.
 * This flow handles:
 * - Agent selection (when multiple agents installed)
 * - Local change detection and handling (proceed, capture, abort)
 * - Switch confirmation with current/new skillset info
 * - Spinner during switch and reinstall
 * - Intro/outro framing
 */

import {
  intro,
  outro,
  select,
  confirm,
  text,
  spinner,
  note,
  cancel,
} from "@clack/prompts";

import { bold, brightCyan, green } from "@/cli/logger.js";
import { validateProfileName } from "@/cli/prompts/validators.js";

import type { ManifestDiff } from "@/cli/features/claude-code/profiles/manifest.js";

import { unwrapPrompt } from "./utils.js";

/**
 * Callbacks for the switch skillset flow
 */
export type SwitchSkillsetCallbacks = {
  onResolveAgents: () => Promise<Array<{ name: string; displayName: string }>>;
  onPrepareSwitchInfo: (args: {
    installDir: string;
    agentName: string;
  }) => Promise<{
    currentProfile: string | null;
    localChanges: ManifestDiff | null;
  }>;
  onCaptureConfig: (args: {
    installDir: string;
    profileName: string;
  }) => Promise<void>;
  onExecuteSwitch: (args: {
    installDir: string;
    agentName: string;
    profileName: string;
  }) => Promise<void>;
};

/**
 * Result of the switch skillset flow
 */
export type SwitchSkillsetFlowResult = {
  agentName: string;
  profileName: string;
} | null;

/**
 * Build a summary of changed files for display in a note
 *
 * @param args - Configuration arguments
 * @param args.diff - The manifest diff containing modified, added, and deleted files
 *
 * @returns Formatted string summarizing the changes
 */
const buildChangesSummary = (args: { diff: ManifestDiff }): string => {
  const { diff } = args;
  const lines: Array<string> = [];

  if (diff.modified.length > 0) {
    lines.push(`Modified (${diff.modified.length}):`);
    for (const file of diff.modified.slice(0, 5)) {
      lines.push(`  ${file}`);
    }
    if (diff.modified.length > 5) {
      lines.push(`  ... and ${diff.modified.length - 5} more`);
    }
  }

  if (diff.added.length > 0) {
    lines.push(`Added (${diff.added.length}):`);
    for (const file of diff.added.slice(0, 5)) {
      lines.push(`  ${file}`);
    }
    if (diff.added.length > 5) {
      lines.push(`  ... and ${diff.added.length - 5} more`);
    }
  }

  if (diff.deleted.length > 0) {
    lines.push(`Deleted (${diff.deleted.length}):`);
    for (const file of diff.deleted.slice(0, 5)) {
      lines.push(`  ${file}`);
    }
    if (diff.deleted.length > 5) {
      lines.push(`  ... and ${diff.deleted.length - 5} more`);
    }
  }

  return lines.join("\n");
};

/**
 * Execute the interactive switch skillset flow
 *
 * @param args - Flow configuration
 * @param args.profileName - The skillset name to switch to
 * @param args.installDir - Installation directory
 * @param args.agentOverride - Optional agent name override (skips agent selection)
 * @param args.callbacks - Callback functions for side-effectful operations
 *
 * @returns Result on success, null on cancel or abort
 */
export const switchSkillsetFlow = async (args: {
  profileName: string;
  installDir: string;
  agentOverride?: string | null;
  callbacks: SwitchSkillsetCallbacks;
}): Promise<SwitchSkillsetFlowResult> => {
  const { profileName, installDir, agentOverride, callbacks } = args;
  const cancelMsg = "Skillset switch cancelled.";

  intro("Switch Skillset");

  // Step 1: Resolve agent
  let agentName: string;

  if (agentOverride != null) {
    agentName = agentOverride;
  } else {
    const agents = await callbacks.onResolveAgents();

    if (agents.length > 1) {
      const selected = unwrapPrompt({
        value: await select({
          message: "Select agent to switch skillset",
          options: agents.map((a) => ({
            value: a.name,
            label: `${a.displayName} (${a.name})`,
          })),
        }),
        cancelMessage: cancelMsg,
      });

      if (selected == null) return null;

      agentName = selected;
    } else if (agents.length === 1) {
      agentName = agents[0].name;
    } else {
      agentName = "claude-code";
    }
  }

  // Step 2: Prepare switch info (detect local changes + get current profile)
  const { currentProfile, localChanges } = await callbacks.onPrepareSwitchInfo({
    installDir,
    agentName,
  });

  if (localChanges != null) {
    const summary = buildChangesSummary({ diff: localChanges });
    note(summary, "Local Changes Detected");

    const changeAction = unwrapPrompt({
      value: await select({
        message: "How would you like to proceed?",
        options: [
          {
            value: "proceed" as const,
            label: "Proceed anyway",
            hint: "changes will be lost",
          },
          {
            value: "capture" as const,
            label: "Save current config as new skillset first",
          },
          { value: "abort" as const, label: "Abort" },
        ],
      }),
      cancelMessage: cancelMsg,
    });

    if (changeAction == null) return null;

    if (changeAction === "abort") {
      cancel(cancelMsg);
      return null;
    }

    if (changeAction === "capture") {
      const skillsetName = unwrapPrompt({
        value: await text({
          message: "Enter a name for this skillset",
          placeholder: "my-skillset",
          validate: (value) => validateProfileName({ value: value ?? "" }),
        }),
        cancelMessage: cancelMsg,
      });

      if (skillsetName == null) return null;

      const captureSpinner = spinner();
      captureSpinner.start("Saving current configuration...");

      await callbacks.onCaptureConfig({
        installDir,
        profileName: skillsetName,
      });

      captureSpinner.stop(`Saved as skillset: ${skillsetName}`);
    }
  }

  // Step 3: Show switch details and confirm
  const currentDisplay = currentProfile ?? "(none)";

  const detailLines = [
    `Install directory: ${installDir}`,
    `Agent: ${agentName}`,
    `Current skillset: ${brightCyan({ text: bold({ text: currentDisplay }) })}`,
    `New skillset: ${green({ text: bold({ text: profileName }) })}`,
  ];
  note(detailLines.join("\n"), "Switching Skillset");

  const confirmed = unwrapPrompt({
    value: await confirm({
      message: `Switch to ${profileName}?`,
    }),
    cancelMessage: cancelMsg,
  });

  if (confirmed == null || !confirmed) {
    if (confirmed === false) {
      cancel(cancelMsg);
    }
    return null;
  }

  // Step 4: Perform the switch
  const s = spinner();
  s.start("Switching skillset...");

  await callbacks.onExecuteSwitch({
    installDir,
    agentName,
    profileName,
  });

  s.stop("Skillset switched");

  const successLines = [
    green({
      text: `Switched to ${bold({ text: profileName })} skillset for ${agentName}.`,
    }),
    `Restart ${agentName} to apply the new configuration.`,
  ];
  note(successLines.join("\n"), "Success");

  outro(brightCyan({ text: `Restart ${agentName} to apply` }));

  return {
    agentName,
    profileName,
  };
};
