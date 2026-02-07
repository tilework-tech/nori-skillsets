#!/usr/bin/env node

/**
 * Hook handler for warning about excessive context usage from permissions
 *
 * This script is called by Claude Code SessionStart hook.
 * It checks the size of settings.local.json files and warns if they
 * are consuming excessive context tokens.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { error } from "@/cli/logger.js";

// Threshold for warning (10KB ≈ 2.5k tokens)
const WARN_THRESHOLD_BYTES = 10 * 1024;

// Approximate bytes per token (derived from 86KB ≈ 21k tokens)
const BYTES_PER_TOKEN = 4;

/**
 * Get the Claude home directory
 * @returns The path to ~/.claude
 */
const getClaudeHomeDir = (): string => {
  return path.join(os.homedir(), ".claude");
};

/**
 * Get file size, returning 0 if file doesn't exist
 * @param args - Configuration arguments
 * @param args.filePath - Path to the file
 *
 * @returns File size in bytes, or 0 if file doesn't exist
 */
const getFileSizeOrZero = async (args: {
  filePath: string;
}): Promise<number> => {
  const { filePath } = args;
  try {
    const stats = await fs.stat(filePath);
    return stats.size;
  } catch {
    return 0;
  }
};

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
 * @param args.cwd - Current working directory
 */
export const main = async (args?: { cwd?: string | null }): Promise<void> => {
  try {
    const cwd = args?.cwd ?? process.cwd();

    // Paths to check
    const homeSettingsLocal = path.join(
      getClaudeHomeDir(),
      "settings.local.json",
    );
    const projectSettingsLocal = path.join(
      cwd,
      ".claude",
      "settings.local.json",
    );

    // Get file sizes using Promise.allSettled for concurrent, fault-tolerant reads
    const [homeSize, projectSize] = await Promise.all([
      getFileSizeOrZero({ filePath: homeSettingsLocal }),
      getFileSizeOrZero({ filePath: projectSettingsLocal }),
    ]);

    const totalSize = homeSize + projectSize;

    // Check if total size exceeds threshold
    if (totalSize > WARN_THRESHOLD_BYTES) {
      const estimatedTokens = Math.round(totalSize / BYTES_PER_TOKEN);

      let message = `⚠️ **High Context Usage from Permissions**\n\n`;
      message += `Your settings.local.json files are consuming ~${estimatedTokens.toLocaleString()} tokens.\n\n`;
      message += `Your \`permissions.allow\` array in settings.local.json has grown large.\n\n`;
      message += `**To fix:** Open \`~/.claude/settings.local.json\` (and \`.claude/settings.local.json\` if present) and clear the \`permissions.allow\` array:\n\n`;
      message += `\`\`\`json\n{\n  "permissions": {\n    "allow": []\n  }\n}\n\`\`\`\n\n`;
      message += `Consider using broader permission patterns in \`settings.json\` instead:\n\n`;
      message += `\`\`\`json\n{\n  "permissions": {\n    "allow": ["Bash(git:*)", "Bash(npm:*)"]\n  }\n}\n\`\`\``;

      logToClaudeSession({ message });
    }
  } catch (err) {
    // Silent failure - don't interrupt session startup
    error({
      message: `Context usage warning: Error (non-fatal): ${err}`,
    });
  }
};

// Export for testing
export { logToClaudeSession };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    error({
      message: `Context usage warning: Unhandled error (non-fatal): ${err}`,
    });
    process.exit(0); // Always exit 0 to not disrupt session
  });
}
