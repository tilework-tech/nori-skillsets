#!/usr/bin/env node

/**
 * Hook handler for warning about nested Nori installations
 *
 * This script is called by Claude Code SessionStart hook.
 * It checks for Nori installations in ancestor directories and warns the user.
 */

import { error } from "@/cli/logger.js";
import { normalizeInstallDir, getInstallDirs } from "@/utils/path.js";

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
    // Check for all installations in directory tree
    const allInstallations = getInstallDirs({
      currentDir: normalizeInstallDir({ installDir: args?.installDir }),
    });

    if (allInstallations.length < 2) {
      // Less than 2 total installations - no nested scenario
      return;
    }

    // Build warning message
    let message = "⚠️ **Nested Nori Installation Detected**\n\n";
    message +=
      "Claude Code loads CLAUDE.md files from all parent directories. ";
    message +=
      "Having multiple Nori installations can cause duplicate or conflicting configurations.\n\n";
    message += "**All Nori installations found:**\n";

    for (const installPath of allInstallations) {
      message += `- ${installPath}\n`;
    }

    message += "\n**To remove an installation, run:**\n";
    for (const installPath of allInstallations) {
      message += `\`cd ${installPath} && nori-ai uninstall\`\n`;
    }

    // Output to Claude session
    logToClaudeSession({ message });
  } catch (err) {
    // Silent failure - don't interrupt session startup
    error({
      message: `Nested install warning: Error (non-fatal): ${err}`,
    });
  }
};

// Export for testing
export { logToClaudeSession };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    error({
      message: `Nested install warning: Unhandled error (non-fatal): ${err}`,
    });
    process.exit(0); // Always exit 0 to not disrupt session
  });
}
