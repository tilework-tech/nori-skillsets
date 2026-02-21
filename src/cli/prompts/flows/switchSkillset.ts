/**
 * Switch skillset flow module
 *
 * Provides the complete interactive switch-skillset experience using @clack/prompts.
 * This flow handles:
 * - Broadcasting switch to all configured agents
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

import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { bold, brightCyan, green } from "@/cli/logger.js";
import { validateSkillsetName } from "@/cli/prompts/validators.js";

import type { ManifestDiff } from "@/cli/features/manifest.js";

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
    skillsetName: string;
  }) => Promise<void>;
  onExecuteSwitch: (args: {
    installDir: string;
    agentName: string;
    skillsetName: string;
  }) => Promise<void>;
};

/**
 * Result of the switch skillset flow
 */
export type SwitchSkillsetFlowResult = {
  agentName: string;
  skillsetName: string;
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
 * Broadcasts the switch to all resolved agents (no agent selection prompt).
 *
 * @param args - Flow configuration
 * @param args.skillsetName - The skillset name to switch to
 * @param args.installDir - Installation directory
 * @param args.callbacks - Callback functions for side-effectful operations
 *
 * @returns Result on success, null on cancel or abort
 */
export const switchSkillsetFlow = async (args: {
  skillsetName: string;
  installDir: string;
  callbacks: SwitchSkillsetCallbacks;
}): Promise<SwitchSkillsetFlowResult> => {
  const { skillsetName, installDir, callbacks } = args;
  const cancelMsg = "Skillset switch cancelled.";

  intro("Switch Skillset");

  // Step 1: Resolve all agents (broadcast to all, no selection prompt)
  const agents = await callbacks.onResolveAgents();
  const agentNames =
    agents.length > 0
      ? agents.map((a) => a.name)
      : [AgentRegistry.getInstance().getDefaultAgentName()];
  const agentName = agentNames[0];

  // Step 2: Prepare switch info (detect local changes + get current skillset)
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
          validate: (value) => validateSkillsetName({ value: value ?? "" }),
        }),
        cancelMessage: cancelMsg,
      });

      if (skillsetName == null) return null;

      const captureSpinner = spinner();
      captureSpinner.start("Saving current configuration...");

      await callbacks.onCaptureConfig({
        installDir,
        skillsetName: skillsetName,
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
    `New skillset: ${green({ text: bold({ text: skillsetName }) })}`,
  ];
  note(detailLines.join("\n"), "Switching Skillset");

  const confirmed = unwrapPrompt({
    value: await confirm({
      message: `Switch to ${skillsetName}?`,
    }),
    cancelMessage: cancelMsg,
  });

  if (confirmed == null || !confirmed) {
    if (confirmed === false) {
      cancel(cancelMsg);
    }
    return null;
  }

  // Step 4: Perform the switch for all agents
  const s = spinner();
  s.start("Switching skillset...");

  for (const name of agentNames) {
    await callbacks.onExecuteSwitch({
      installDir,
      agentName: name,
      skillsetName,
    });
  }

  s.stop("Skillset switched");

  const agentDisplay =
    agentNames.length === 1 ? agentNames[0] : agentNames.join(", ");
  const successLines = [
    green({
      text: `Switched to ${bold({ text: skillsetName })} skillset for ${agentDisplay}.`,
    }),
    `Restart your agent instances to apply the new configuration.`,
  ];
  note(successLines.join("\n"), "Success");

  outro(brightCyan({ text: "Restart your agents to apply" }));

  return {
    agentName,
    skillsetName,
  };
};
