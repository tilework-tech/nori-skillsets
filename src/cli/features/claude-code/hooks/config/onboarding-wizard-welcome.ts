#!/usr/bin/env node

/**
 * Hook handler for welcoming users to the onboarding wizard
 *
 * This script is called by Claude Code SessionStart hook.
 * It detects if the current profile is an onboarding wizard and displays a welcome message.
 */

import { getAgentProfile, loadConfig } from "@/cli/config.js";
import { error } from "@/cli/logger.js";
import { getInstallDirs } from "@/utils/path.js";

/**
 * Output hook result with systemMessage
 * @param args - Configuration arguments
 * @param args.message - Message to output
 */
const logToClaudeSession = (args: { message: string }): void => {
  const { message } = args;

  const output = {
    systemMessage: message,
  };

  console.log(JSON.stringify(output));
};

/**
 * Main entry point
 * @param args - Configuration arguments
 * @param args.installDir - Custom installation directory (optional, for testing)
 */
export const main = async (args?: {
  installDir?: string | null;
}): Promise<void> => {
  try {
    // Find installation directory
    const installDirs = getInstallDirs({
      currentDir: args?.installDir ?? process.cwd(),
    });

    if (installDirs.length === 0) {
      // No Nori installation found
      return;
    }

    // Use the first (closest) installation
    const installDir = installDirs[0];

    // Load config
    const config = await loadConfig({ installDir });

    if (config == null) {
      // No config found
      return;
    }

    // Get the current profile for claude-code agent
    const profile = getAgentProfile({ config, agentName: "claude-code" });

    if (profile?.baseProfile !== "onboarding-wizard-questionnaire") {
      // Not using an onboarding wizard profile
      return;
    }

    // Output welcome message
    const message =
      "🎉 **Welcome to the Nori Profile Setup Wizard!**\n\n" +
      "I'll help you create a personalized workflow profile based on your preferences.\n\n" +
      "**Just type anything** (like 'hi' or 'let's go') to start the wizard.";

    logToClaudeSession({ message });
  } catch (err) {
    // Silent failure - don't interrupt session startup
    error({
      message: `Onboarding wizard welcome: Error (non-fatal): ${err}`,
    });
  }
};

// Export for testing
export { logToClaudeSession };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    error({
      message: `Onboarding wizard welcome: Unhandled error (non-fatal): ${err}`,
    });
    process.exit(0); // Always exit 0 to not disrupt session
  });
}
