/**
 * Skillset management for Nori Skillsets
 * Handles skillset listing, loading, and switching
 */

import { captureExistingConfigAsProfile } from "@/cli/commands/install/existingConfigCapture.js";
import {
  loadConfig,
  getAgentProfile,
  getInstalledAgents,
  type ConfigAgentName,
} from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { getClaudeDir } from "@/cli/features/claude-code/paths.js";
import {
  readManifest,
  compareManifest,
  hasChanges,
  getManifestPath,
  type ManifestDiff,
} from "@/cli/features/claude-code/profiles/manifest.js";
import { listProfiles } from "@/cli/features/managedFolder.js";
import { error, info, success, newline, warn } from "@/cli/logger.js";
import { promptUser } from "@/cli/prompt.js";
import { normalizeInstallDir, getInstallDirs } from "@/utils/path.js";

import type { Command } from "commander";

/**
 * Determine which agent to use for switch-skillset command when no --agent flag provided
 * @param args - Configuration arguments
 * @param args.nonInteractive - Whether running in non-interactive mode
 *
 * @throws Error if in non-interactive mode with multiple agents installed
 *
 * @returns The agent name to use
 */
const resolveAgent = async (args: {
  nonInteractive: boolean;
}): Promise<string> => {
  const { nonInteractive } = args;

  // Load config to check installed agents
  const config = await loadConfig();
  const installedAgents = config ? getInstalledAgents({ config }) : [];

  // No agents installed - default to claude-code
  if (installedAgents.length === 0) {
    return "claude-code";
  }

  // Single agent installed - use it
  if (installedAgents.length === 1) {
    return installedAgents[0];
  }

  // Multiple agents installed
  if (nonInteractive) {
    throw new Error(
      `Multiple agents installed (${installedAgents.join(", ")}). ` +
        `Please specify which agent to switch with --agent <name>.`,
    );
  }

  // Interactive mode - prompt user to select agent
  info({ message: "\nMultiple agents are installed:" });
  installedAgents.forEach((agent, index) => {
    const agentImpl = AgentRegistry.getInstance().get({ name: agent });
    info({ message: `  ${index + 1}. ${agentImpl.displayName} (${agent})` });
  });

  const selection = await promptUser({
    prompt: `Select agent to switch skillset (1-${installedAgents.length}): `,
  });

  const selectedIndex = parseInt(selection, 10) - 1;
  if (
    isNaN(selectedIndex) ||
    selectedIndex < 0 ||
    selectedIndex >= installedAgents.length
  ) {
    throw new Error("Invalid selection. Skillset switch cancelled.");
  }

  return installedAgents[selectedIndex];
};

/**
 * Detect local changes to installed files
 *
 * Compares the current state of ~/.claude/ against the stored manifest
 * to detect any user modifications.
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Manifest diff if changes detected, null otherwise
 */
const detectLocalChanges = async (args: {
  installDir: string;
}): Promise<ManifestDiff | null> => {
  const { installDir } = args;

  const manifestPath = getManifestPath();
  const manifest = await readManifest({ manifestPath });

  // No manifest means first install or manual setup - no changes detectable
  if (manifest == null) {
    return null;
  }

  const claudeDir = getClaudeDir({ installDir });
  const diff = await compareManifest({ manifest, currentDir: claudeDir });

  return hasChanges(diff) ? diff : null;
};

/**
 * Prompt user to handle detected local changes
 *
 * @param args - Configuration arguments
 * @param args.diff - Detected changes
 * @param args.installDir - Installation directory
 * @param args.nonInteractive - Whether running in non-interactive mode
 *
 * @returns 'proceed' to continue, 'capture' to save first, 'abort' to cancel
 */
const promptForChangeHandling = async (args: {
  diff: ManifestDiff;
  installDir: string;
  nonInteractive: boolean;
}): Promise<"proceed" | "capture" | "abort"> => {
  const { diff, nonInteractive } = args;

  // In non-interactive mode, error out (safe default)
  if (nonInteractive) {
    throw new Error(
      `Local changes detected in installed skillset files. ` +
        `Cannot proceed in non-interactive mode. ` +
        `Modified: ${diff.modified.length}, Added: ${diff.added.length}, Deleted: ${diff.deleted.length}. ` +
        `Run interactively to choose how to handle these changes.`,
    );
  }

  // Display detected changes
  warn({ message: "\n⚠️  Local changes detected in your installed skillset:" });
  newline();

  if (diff.modified.length > 0) {
    info({ message: `  Modified files (${diff.modified.length}):` });
    for (const file of diff.modified.slice(0, 5)) {
      info({ message: `    - ${file}` });
    }
    if (diff.modified.length > 5) {
      info({ message: `    ... and ${diff.modified.length - 5} more` });
    }
  }

  if (diff.added.length > 0) {
    info({ message: `  Added files (${diff.added.length}):` });
    for (const file of diff.added.slice(0, 5)) {
      info({ message: `    - ${file}` });
    }
    if (diff.added.length > 5) {
      info({ message: `    ... and ${diff.added.length - 5} more` });
    }
  }

  if (diff.deleted.length > 0) {
    info({ message: `  Deleted files (${diff.deleted.length}):` });
    for (const file of diff.deleted.slice(0, 5)) {
      info({ message: `    - ${file}` });
    }
    if (diff.deleted.length > 5) {
      info({ message: `    ... and ${diff.deleted.length - 5} more` });
    }
  }

  newline();
  info({ message: "Switching skillsets will overwrite these changes." });
  info({ message: "How would you like to proceed?" });
  newline();
  info({ message: "  1. Proceed anyway (changes will be lost)" });
  info({ message: "  2. Save current config as new skillset first" });
  info({ message: "  3. Abort" });
  newline();

  const selection = await promptUser({
    prompt: "Select option (1-3): ",
  });

  switch (selection.trim()) {
    case "1":
      return "proceed";
    case "2":
      return "capture";
    case "3":
    default:
      return "abort";
  }
};

/**
 * Prompt user to confirm skillset switch
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 * @param args.profileName - New skillset name to switch to
 * @param args.agentName - Agent name
 * @param args.nonInteractive - Whether running in non-interactive mode
 *
 * @returns True if user confirms, false otherwise
 */
const confirmSwitchProfile = async (args: {
  installDir: string;
  profileName: string;
  agentName: string;
  nonInteractive: boolean;
}): Promise<boolean> => {
  const { installDir, profileName, agentName, nonInteractive } = args;

  // Skip confirmation in non-interactive mode
  if (nonInteractive) {
    return true;
  }

  // Load config to get current skillset
  const config = await loadConfig();
  const agentProfile =
    config != null
      ? getAgentProfile({ config, agentName: agentName as ConfigAgentName })
      : null;
  const currentProfile = agentProfile?.baseProfile ?? "(none)";

  // Get agent display info
  const agent = AgentRegistry.getInstance().get({ name: agentName });

  // Display confirmation info
  info({ message: "\nSwitching skillset configuration:" });
  info({ message: `  Install directory: ${installDir}` });
  info({ message: `  Agent: ${agent.displayName} (${agentName})` });
  info({ message: `  Current skillset: ${currentProfile}` });
  info({ message: `  New skillset: ${profileName}` });
  newline();

  const proceed = await promptUser({
    prompt: "Proceed with skillset switch? (y/n): ",
  });

  return proceed.match(/^[Yy]$/) != null;
};

/**
 * Shared action handler for switch-skillset and switch-profile commands
 * @param args - Configuration arguments
 * @param args.name - The skillset name to switch to
 * @param args.options - Command options
 * @param args.options.agent - Optional agent name override
 * @param args.program - Commander program instance
 */
export const switchSkillsetAction = async (args: {
  name: string;
  options: { agent?: string };
  program: Command;
}): Promise<void> => {
  const { name, options, program } = args;

  // Get global options from parent
  const globalOpts = program.opts();
  const nonInteractive = globalOpts.nonInteractive ?? false;

  // Determine installation directory
  let installDir: string;

  if (globalOpts.installDir != null && globalOpts.installDir !== "") {
    // Explicit install dir provided - use it directly
    installDir = normalizeInstallDir({ installDir: globalOpts.installDir });
  } else {
    // Auto-detect installation
    const installations = getInstallDirs({ currentDir: process.cwd() });
    if (installations.length === 0) {
      throw new Error(
        "No Nori installations found in current directory or parent directories. " +
          "Run 'nori-skillsets init' to create a new installation, or use --install-dir to specify a location.",
      );
    }
    installDir = installations[0]; // Use closest installation
  }

  // Use local --agent option if provided, otherwise auto-detect
  // We don't use globalOpts.agent because it has a default value ("claude-code")
  // which would prevent auto-detection from working
  const agentName = options.agent ?? (await resolveAgent({ nonInteractive }));

  const agent = AgentRegistry.getInstance().get({ name: agentName });

  // Check for local changes before proceeding
  const localChanges = await detectLocalChanges({ installDir });

  if (localChanges != null) {
    const changeAction = await promptForChangeHandling({
      diff: localChanges,
      installDir,
      nonInteractive,
    });

    if (changeAction === "abort") {
      info({ message: "Skillset switch cancelled." });
      return;
    }

    if (changeAction === "capture") {
      // Prompt for profile name and capture
      info({ message: "\nSaving current configuration as a new skillset..." });
      const profileName = await promptUser({
        prompt:
          "Enter a name for this skillset (lowercase letters, numbers, hyphens): ",
      });

      if (!/^[a-z0-9-]+$/.test(profileName)) {
        error({ message: "Invalid skillset name. Skillset switch cancelled." });
        return;
      }

      await captureExistingConfigAsProfile({ installDir, profileName });
      success({
        message: `Saved current configuration as skillset: ${profileName}`,
      });
      newline();
    }
    // If 'proceed', continue with the switch
  }

  // Confirm before proceeding
  const confirmed = await confirmSwitchProfile({
    installDir,
    profileName: name,
    agentName,
    nonInteractive,
  });

  if (!confirmed) {
    info({ message: "Skillset switch cancelled." });
    return;
  }

  try {
    // Delegate to agent's switchProfile method
    await agent.switchProfile({ installDir, profileName: name });
  } catch (err) {
    // On failure, show available skillsets
    const profiles = await listProfiles();
    if (profiles.length > 0) {
      error({ message: `Available skillsets: ${profiles.join(", ")}` });
    }
    throw err;
  }

  // Run install in silent mode to regenerate files with new skillset
  const { main: installMain } =
    await import("@/cli/commands/install/install.js");
  await installMain({
    nonInteractive: true,
    installDir,
    agent: agentName,
    silent: true,
  });

  success({ message: `Switched to skillset: ${name}` });
};

/**
 * Register the 'switch-skillset' and 'switch-profile' (alias) commands with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerSwitchProfileCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  // Primary command: switch-skillset
  program
    .command("switch-skillset <name>")
    .description("Switch to a different skillset and reinstall")
    .option("-a, --agent <name>", "AI agent to switch skillset for")
    .action(async (name: string, options: { agent?: string }) => {
      await switchSkillsetAction({ name, options, program });
    });

  // Alias command: switch-profile (for backward compatibility)
  program
    .command("switch-profile <name>")
    .description(
      "Alias for switch-skillset - Switch to a different skillset and reinstall",
    )
    .option("-a, --agent <name>", "AI agent to switch skillset for")
    .action(async (name: string, options: { agent?: string }) => {
      await switchSkillsetAction({ name, options, program });
    });
};
