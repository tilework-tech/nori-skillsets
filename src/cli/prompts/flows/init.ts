/**
 * Init flow module
 *
 * Provides interactive init experiences using @clack/prompts.
 * This flow handles:
 * - Profile persistence warning with confirmation
 * - Existing config detection and capture with profile name collection
 */

import { confirm, text, note, log, isCancel } from "@clack/prompts";

import { handleCancel } from "@/cli/prompts/utils.js";
import { validateProfileName } from "@/cli/prompts/validators.js";

import type { ExistingConfig } from "@/cli/commands/install/existingConfigCapture.js";

/**
 * Display the profile persistence warning and prompt for confirmation
 *
 * Shows a note explaining that nori will manage config files and that
 * changes to ~/.claude/ will be overwritten on switch-skillset.
 * Then prompts for yes/no confirmation.
 *
 * @returns True if user confirms, false if user declines
 */
export const confirmPersistenceWarning = async (): Promise<boolean> => {
  const warningText = [
    "By running init, nori will manage your config.",
    "Any changes to ~/.claude/skills/, ~/.claude/CLAUDE.md,",
    "or other configuration files will be OVERWRITTEN the",
    "next time you run switch-skillset.",
    "",
    "To persist your customizations across skillset switches:",
    "  - Make changes in ~/.nori/profiles/<skillset-name>/",
    "  - Or create a new custom skillset",
  ].join("\n");

  note(warningText, "Skillset Persistence");

  const result = await confirm({
    message: "Do you understand and want to proceed?",
  });

  if (isCancel(result)) {
    handleCancel();
  }

  return result as boolean;
};

/**
 * Build a summary string of detected existing configuration
 *
 * @param args - Configuration arguments
 * @param args.existingConfig - Detected existing configuration
 *
 * @returns Summary string for display in a note
 */
const buildConfigSummary = (args: {
  existingConfig: ExistingConfig;
}): string => {
  const { existingConfig } = args;
  const lines: Array<string> = [];

  if (existingConfig.hasClaudeMd) {
    lines.push("  - CLAUDE.md found");
  }
  if (existingConfig.hasSkills) {
    const plural = existingConfig.skillCount === 1 ? "" : "s";
    lines.push(`  - ${existingConfig.skillCount} skill${plural} found`);
  }
  if (existingConfig.hasAgents) {
    const plural = existingConfig.agentCount === 1 ? "" : "s";
    lines.push(`  - ${existingConfig.agentCount} subagent${plural} found`);
  }
  if (existingConfig.hasCommands) {
    const plural = existingConfig.commandCount === 1 ? "" : "s";
    lines.push(
      `  - ${existingConfig.commandCount} slash command${plural} found`,
    );
  }

  return lines.join("\n");
};

/**
 * Interactive flow for capturing existing Claude Code configuration as a profile
 *
 * Displays what was detected and prompts for a profile name.
 *
 * @param args - Configuration arguments
 * @param args.existingConfig - Detected existing configuration
 *
 * @returns Profile name entered by the user
 */
export const existingConfigCaptureFlow = async (args: {
  existingConfig: ExistingConfig;
}): Promise<string> => {
  const { existingConfig } = args;

  const summary = buildConfigSummary({ existingConfig });
  note(summary, "Existing Configuration Detected");

  if (existingConfig.hasManagedBlock) {
    log.warn(
      "Your CLAUDE.md contains a Nori managed block, which suggests a previous installation. The captured profile will preserve this content.",
    );
  }

  const result = await text({
    message: "Enter a name for this skillset",
    placeholder: "my-skillset",
    validate: (value) => validateProfileName({ value: value ?? "" }),
  });

  if (isCancel(result)) {
    handleCancel();
  }

  return result as string;
};
