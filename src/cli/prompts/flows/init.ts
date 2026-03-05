/**
 * Init flow module
 *
 * Provides the complete interactive init experience using @clack/prompts.
 * This flow handles:
 * - Persistence warning confirmation
 * - Ancestor installation detection and warning
 * - Existing config detection and capture
 * - Skillset name collection with validation
 */

import { confirm, text, spinner, note, cancel } from "@clack/prompts";

import { validateSkillsetName } from "@/cli/prompts/validators.js";

import type { ExistingConfig } from "@/cli/features/agentRegistry.js";

import { unwrapPrompt } from "./utils.js";

/**
 * Callbacks for the init flow
 */
export type InitFlowCallbacks = {
  onCheckAncestors: (args: { installDir: string }) => Promise<Array<string>>;
  onDetectExistingConfig: (args: {
    installDir: string;
  }) => Promise<ExistingConfig | null>;
  onCaptureConfig: (args: {
    installDir: string;
    skillsetName: string;
  }) => Promise<void>;
  onInit: (args: {
    installDir: string;
    capturedSkillsetName: string | null;
  }) => Promise<void>;
};

/**
 * Result of the init flow
 */
export type InitFlowResult = {
  capturedSkillsetName: string | null;
  statusMessage: string;
};

/**
 * Build a summary of detected existing configuration for display in a note
 *
 * @param args - Configuration arguments
 * @param args.config - The detected existing configuration
 *
 * @returns Formatted string summarizing what was found
 */
const buildExistingConfigSummary = (args: {
  config: ExistingConfig;
}): string => {
  const { config } = args;
  const lines: Array<string> = [];

  if (config.hasConfigFile) {
    lines.push(`${config.configFileName} found`);
  }
  if (config.hasSkills) {
    lines.push(
      `${config.skillCount} skill${config.skillCount === 1 ? "" : "s"} found`,
    );
  }
  if (config.hasAgents) {
    lines.push(
      `${config.agentCount} subagent${config.agentCount === 1 ? "" : "s"} found`,
    );
  }
  if (config.hasCommands) {
    lines.push(
      `${config.commandCount} slash command${config.commandCount === 1 ? "" : "s"} found`,
    );
  }

  if (config.hasManagedBlock) {
    lines.push("");
    lines.push(
      `Your ${config.configFileName} contains a Nori managed block, which suggests`,
    );
    lines.push(
      "a previous installation. The captured skillset will preserve this content.",
    );
  }

  return lines.join("\n");
};

/**
 * Execute the interactive init flow
 *
 * @param args - Flow configuration
 * @param args.installDir - Installation directory
 * @param args.skipWarning - If true, skip the persistence warning confirmation
 * @param args.callbacks - Callback functions for side-effectful operations
 *
 * @returns Result on success, null on cancel
 */
export const initFlow = async (args: {
  installDir: string;
  skipWarning?: boolean | null;
  callbacks: InitFlowCallbacks;
}): Promise<InitFlowResult | null> => {
  const { installDir, skipWarning, callbacks } = args;
  const cancelMsg = "Initialization cancelled.";

  // Step 1: Persistence warning confirmation
  if (skipWarning !== true) {
    const warningLines = [
      "By running init, Nori will manage your agent config. Any changes to",
      "agent-managed skills, config files, or other configuration",
      "will be OVERWRITTEN the next time you run switch-skillset.",
      "",
      "To persist your customizations across skillset switches:",
      "  Make changes in ~/.nori/profiles/<skillset-name>/",
      "  Or create a new custom skillset",
    ];
    note(warningLines.join("\n"), "Skillset Persistence");

    const confirmed = unwrapPrompt({
      value: await confirm({
        message: "I understand, proceed with initialization",
      }),
      cancelMessage: cancelMsg,
    });

    if (confirmed == null || !confirmed) {
      if (confirmed === false) {
        cancel(cancelMsg);
      }
      return null;
    }
  }

  // Step 2: Check for ancestor managed installations
  const ancestors = await callbacks.onCheckAncestors({ installDir });

  if (ancestors.length > 0) {
    const ancestorLines = [
      "Nori managed installation detected in ancestor directory.",
      "Some AI coding agents load config files from parent directories.",
      "Having multiple managed installations can cause conflicts.",
      "",
      "Existing installations:",
      ...ancestors.map((p) => `  ${p}`),
      "",
      "Please remove the conflicting managed installation before continuing.",
    ];
    note(ancestorLines.join("\n"), "Warning");
  }

  // Step 3: Detect existing configuration
  const existingConfig = await callbacks.onDetectExistingConfig({ installDir });

  let capturedSkillsetName: string | null = null;

  if (existingConfig != null) {
    const summary = buildExistingConfigSummary({ config: existingConfig });
    note(summary, "Existing Configuration Detected");

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
    captureSpinner.start("Saving configuration...");

    await callbacks.onCaptureConfig({ installDir, skillsetName });

    captureSpinner.stop(`Configuration saved as skillset: ${skillsetName}`);

    capturedSkillsetName = skillsetName;
  }

  // Step 4: Initialize
  const s = spinner();
  s.start("Initializing Nori...");

  await callbacks.onInit({ installDir, capturedSkillsetName });

  s.stop("Initialized");

  return {
    capturedSkillsetName,
    statusMessage: "Nori initialized successfully",
  };
};
