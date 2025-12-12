#!/usr/bin/env node

/**
 * Hook handler for migration instructions
 *
 * This script is called by Claude Code SessionStart hook.
 * It checks for pending migrations and instructs users how to complete them.
 */

import { error } from "@/cli/logger.js";
import { getInstallDirs } from "@/utils/path.js";

import { formatError } from "./intercepted-slashcommands/format.js";
import { migrationInstructions } from "./migration-instructions/registry.js";

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
 * @param args.installDir - Installation directory (optional, for testing)
 */
export const main = async (args?: {
  installDir?: string | null;
}): Promise<void> => {
  try {
    // Find installation directory - use provided value (for testing) or discover from cwd
    let installDir = args?.installDir;

    if (installDir == null) {
      const allInstallations = getInstallDirs({ currentDir: process.cwd() });
      if (allInstallations.length === 0) {
        return; // No installation found
      }
      installDir = allInstallations[0];
    }

    // Collect all triggered migration messages
    const messages: Array<string> = [];

    for (const [_name, instruction] of Object.entries(migrationInstructions)) {
      const message = instruction.trigger({ installDir });
      if (message != null) {
        messages.push(message);
      }
    }

    // Output combined message if any migrations are needed
    if (messages.length > 0) {
      const combinedMessage = messages.join("\n\n---\n\n");
      logToClaudeSession({
        message: formatError({ message: combinedMessage }),
      });
    }
  } catch (err) {
    // Silent failure - don't interrupt session startup
    error({
      message: `Migration instructions: Error (non-fatal): ${err}`,
    });
  }
};

// Export for testing
export { logToClaudeSession };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    error({
      message: `Migration instructions: Unhandled error (non-fatal): ${err}`,
    });
    process.exit(0); // Always exit 0 to not disrupt session
  });
}
