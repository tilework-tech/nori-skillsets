/**
 * Intercepted slash command for pruning accumulated permissions
 * Handles /nori-prune-context command
 *
 * Clears the permissions.allow array from settings.local.json files
 * to reduce context token usage. Preserves deny/ask permissions.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import type {
  HookInput,
  HookOutput,
  InterceptedSlashCommand,
} from "./types.js";

import { formatError, formatSuccess } from "./format.js";

/**
 * Get the Claude home directory
 * @returns The path to ~/.claude
 */
const getClaudeHomeDir = (): string => {
  return path.join(os.homedir(), ".claude");
};

/**
 * Result of pruning a single settings file
 */
type PruneResult = {
  path: string;
  prunedCount: number;
  backupPath: string | null;
  error: string | null;
};

/**
 * Prune permissions.allow from a settings.local.json file
 * @param args - Configuration arguments
 * @param args.filePath - Path to the settings.local.json file
 *
 * @returns Result of the prune operation
 */
const pruneSettingsFile = async (args: {
  filePath: string;
}): Promise<PruneResult> => {
  const { filePath } = args;
  const result: PruneResult = {
    path: filePath,
    prunedCount: 0,
    backupPath: null,
    error: null,
  };

  try {
    // Check if file exists
    await fs.access(filePath);

    // Read and parse settings
    const content = await fs.readFile(filePath, "utf-8");
    let settings: Record<string, unknown>;

    try {
      settings = JSON.parse(content);
    } catch {
      result.error = "Invalid JSON";
      return result;
    }

    // Check if there are permissions to prune
    const permissions = settings.permissions as
      | Record<string, unknown>
      | undefined;
    if (permissions == null) {
      return result;
    }

    const allowList = permissions.allow as Array<string> | undefined;
    if (allowList == null || allowList.length === 0) {
      return result;
    }

    // Create backup
    const backupPath = `${filePath}.backup`;
    await fs.writeFile(backupPath, content);
    result.backupPath = backupPath;

    // Record count and clear allow list
    result.prunedCount = allowList.length;
    permissions.allow = [];

    // Write updated settings
    await fs.writeFile(filePath, JSON.stringify(settings, null, 2));

    return result;
  } catch (err) {
    // File doesn't exist or other error
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      result.error = String(err);
    }
    return result;
  }
};

/**
 * Run the nori-prune-context command
 * @param args - The function arguments
 * @param args.input - The hook input containing prompt and cwd
 *
 * @returns The hook output with prune result
 */
const run = async (args: { input: HookInput }): Promise<HookOutput | null> => {
  const { input } = args;
  const { cwd } = input;

  // Paths to prune
  const homeSettingsLocal = path.join(
    getClaudeHomeDir(),
    "settings.local.json",
  );
  const projectSettingsLocal = path.join(cwd, ".claude", "settings.local.json");

  // Prune both files
  const results = await Promise.all([
    pruneSettingsFile({ filePath: homeSettingsLocal }),
    pruneSettingsFile({ filePath: projectSettingsLocal }),
  ]);

  // Calculate totals
  const totalPruned = results.reduce((sum, r) => sum + r.prunedCount, 0);
  const backupPaths = results
    .filter((r) => r.backupPath != null)
    .map((r) => r.backupPath);
  const errors = results.filter((r) => r.error != null);

  // Handle errors
  if (errors.length > 0 && totalPruned === 0) {
    return {
      decision: "block",
      reason: formatError({
        message: `Error pruning permissions: ${errors.map((e) => e.error).join(", ")}`,
      }),
    };
  }

  // Nothing to prune
  if (totalPruned === 0) {
    return {
      decision: "block",
      reason: formatSuccess({
        message: `Nothing to prune - no accumulated permissions found in settings.local.json files.`,
      }),
    };
  }

  // Success message
  let message = `✅ Pruned ${totalPruned} permission${totalPruned === 1 ? "" : "s"} from settings.local.json.\n\n`;

  if (backupPaths.length > 0) {
    message += `Backup${backupPaths.length === 1 ? "" : "s"} created:\n`;
    for (const bp of backupPaths) {
      message += `  • ${bp}\n`;
    }
  }

  message += `\nYour context window is now lighter. ✨`;

  return {
    decision: "block",
    reason: formatSuccess({ message }),
  };
};

/**
 * nori-prune-context intercepted slash command
 */
export const noriPruneContext: InterceptedSlashCommand = {
  matchers: ["^\\/nori-prune-context\\s*$"],
  run,
};
