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
  isCancel,
} from "@clack/prompts";

import { validateProfileName } from "@/cli/prompts/validators.js";

import type { ManifestDiff } from "@/cli/features/claude-code/profiles/manifest.js";

/**
 * Callbacks for the switch skillset flow
 */
export type SwitchSkillsetCallbacks = {
  onResolveAgents: () => Promise<Array<{ name: string; displayName: string }>>;
  onDetectLocalChanges: (args: {
    installDir: string;
  }) => Promise<ManifestDiff | null>;
  onGetCurrentProfile: (args: { agentName: string }) => Promise<string | null>;
  onCaptureConfig: (args: {
    installDir: string;
    profileName: string;
  }) => Promise<void>;
  onSwitchProfile: (args: {
    installDir: string;
    agentName: string;
    profileName: string;
  }) => Promise<void>;
  onReinstall: (args: {
    installDir: string;
    agentName: string;
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

  intro("Switch Skillset");

  // Step 1: Resolve agent
  let agentName: string;

  if (agentOverride != null) {
    agentName = agentOverride;
  } else {
    const agents = await callbacks.onResolveAgents();

    if (agents.length > 1) {
      const selected = await select({
        message: "Select agent to switch skillset",
        options: agents.map((a) => ({
          value: a.name,
          label: `${a.displayName} (${a.name})`,
        })),
      });

      if (isCancel(selected)) {
        cancel("Skillset switch cancelled.");
        return null;
      }

      agentName = selected as string;
    } else if (agents.length === 1) {
      agentName = agents[0].name;
    } else {
      // No agents installed — default to claude-code
      agentName = "claude-code";
    }
  }

  // Step 2: Detect local changes
  const localChanges = await callbacks.onDetectLocalChanges({ installDir });

  if (localChanges != null) {
    const summary = buildChangesSummary({ diff: localChanges });
    note(summary, "Local Changes Detected");

    const changeAction = await select({
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
    });

    if (isCancel(changeAction)) {
      cancel("Skillset switch cancelled.");
      return null;
    }

    if (changeAction === "abort") {
      cancel("Skillset switch cancelled.");
      return null;
    }

    if (changeAction === "capture") {
      const skillsetName = await text({
        message: "Enter a name for this skillset",
        placeholder: "my-skillset",
        validate: (value) => validateProfileName({ value: value ?? "" }),
      });

      if (isCancel(skillsetName)) {
        cancel("Skillset switch cancelled.");
        return null;
      }

      const captureSpinner = spinner();
      captureSpinner.start("Saving current configuration...");

      await callbacks.onCaptureConfig({
        installDir,
        profileName: skillsetName as string,
      });

      captureSpinner.stop(`Saved as skillset: ${skillsetName}`);
    }
  }

  // Step 3: Show switch details and confirm
  const currentProfile = await callbacks.onGetCurrentProfile({ agentName });
  const currentDisplay = currentProfile ?? "(none)";

  const detailLines = [
    `Install directory: ${installDir}`,
    `Agent: ${agentName}`,
    `Current skillset: ${currentDisplay}`,
    `New skillset: ${profileName}`,
  ];
  note(detailLines.join("\n"), "Switching Skillset");

  const confirmed = await confirm({
    message: `Switch to ${profileName}?`,
  });

  if (isCancel(confirmed) || !confirmed) {
    cancel("Skillset switch cancelled.");
    return null;
  }

  // Step 4: Perform the switch
  const s = spinner();
  s.start("Switching skillset...");

  await callbacks.onSwitchProfile({
    installDir,
    agentName,
    profileName,
  });

  await callbacks.onReinstall({
    installDir,
    agentName,
  });

  s.stop("Skillset switched");

  outro(`Switched to skillset: ${profileName}`);

  return {
    agentName,
    profileName,
  };
};
