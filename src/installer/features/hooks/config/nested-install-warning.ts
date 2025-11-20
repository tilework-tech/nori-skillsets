#!/usr/bin/env node

/**
 * Hook handler for warning about nested Nori installations
 *
 * This script is called by Claude Code SessionStart hook.
 * It checks for Nori installations in ancestor directories and warns the user.
 */

import { loadDiskConfig } from "@/installer/config.js";
import { error } from "@/installer/logger.js";
import {
  normalizeInstallDir,
  findAncestorInstallations,
} from "@/utils/path.js";

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
    let installDir = args?.installDir;

    // If no installDir provided, load from config using cwd
    if (installDir == null) {
      const cwd = process.cwd();
      const diskConfig = await loadDiskConfig({ installDir: cwd });
      installDir = diskConfig?.installDir
        ? normalizeInstallDir({ installDir: diskConfig.installDir })
        : null;
    }

    // If still no installDir, use default (cwd)
    if (installDir == null) {
      installDir = normalizeInstallDir({});
    }

    // Check for ancestor installations
    const ancestorInstallations = findAncestorInstallations({
      installDir,
    });

    if (ancestorInstallations.length === 0) {
      // No ancestor installations found, nothing to warn about
      return;
    }

    // Build warning message
    let message = "⚠️ **Nested Nori Installation Detected**\n\n";
    message +=
      "Claude Code loads CLAUDE.md files from all parent directories. ";
    message +=
      "Having multiple Nori installations can cause duplicate or conflicting configurations.\n\n";
    message += "**Existing Nori installations found at:**\n";

    for (const ancestorPath of ancestorInstallations) {
      message += `- ${ancestorPath}\n`;
    }

    message += "\n**To remove an existing installation, run:**\n";
    for (const ancestorPath of ancestorInstallations) {
      message += `\`cd ${ancestorPath} && npx nori-ai@latest uninstall\`\n`;
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
