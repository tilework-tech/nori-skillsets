/**
 * Legacy hooks cleanup
 *
 * Removes stale hook entries from ~/.claude/settings.json that reference
 * nori-skillsets scripts that no longer exist in the package.
 *
 * Runs as:
 * - npm postinstall script (automatic on package upgrade)
 * - Part of the hooks loader during `nori-skillsets install`
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

/**
 * Hook script filenames that have been removed from the package.
 * Add to this list when removing a hook script in the future.
 */
const REMOVED_HOOK_SCRIPTS = [
  "statistics.js",
  "statistics-notification.js",
  "summarize.js",
  "summarize-notification.js",
  "format.js",
  "autoupdate.js",
  "nested-install-warning.js",
  "slash-command-intercept.js",
  "worktree-cleanup.js",
];

type HookEntry = {
  type?: string;
  command?: string;
  description?: string;
};

type MatcherGroup = {
  matcher?: string;
  hooks?: Array<HookEntry>;
};

const isStaleNoriHook = (args: { command: string }): boolean => {
  const { command } = args;
  if (!command.includes("nori-skillsets")) {
    return false;
  }
  return REMOVED_HOOK_SCRIPTS.some((script) => command.endsWith(script));
};

/**
 * Remove stale hook entries from ~/.claude/settings.json.
 * Only removes hooks that reference nori-skillsets AND match a known removed filename.
 * Silently no-ops if settings.json doesn't exist, has no hooks, or is invalid JSON.
 */
export const cleanupLegacyHooks = async (): Promise<void> => {
  const settingsPath = path.join(os.homedir(), ".claude", "settings.json");

  let content: string;
  try {
    content = await fs.readFile(settingsPath, "utf-8");
  } catch {
    return;
  }

  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return;
  }

  const hooks = settings.hooks as
    | Record<string, Array<MatcherGroup>>
    | null
    | undefined;
  if (hooks == null) {
    return;
  }

  let modified = false;

  for (const event of Object.keys(hooks)) {
    const matchers = hooks[event];
    if (!Array.isArray(matchers)) {
      continue;
    }

    for (const matcher of matchers) {
      if (!Array.isArray(matcher.hooks)) {
        continue;
      }

      const originalLength = matcher.hooks.length;
      matcher.hooks = matcher.hooks.filter((hook: HookEntry) => {
        if (hook.command == null) {
          return true;
        }
        return !isStaleNoriHook({ command: hook.command });
      });

      if (matcher.hooks.length !== originalLength) {
        modified = true;
      }
    }

    // Remove empty matcher groups
    hooks[event] = matchers.filter(
      (m: MatcherGroup) => m.hooks != null && m.hooks.length > 0,
    );

    // Remove empty events
    if (hooks[event].length === 0) {
      delete hooks[event];
      modified = true;
    }
  }

  // Remove empty hooks object
  if (Object.keys(hooks).length === 0) {
    delete settings.hooks;
    modified = true;
  }

  if (modified) {
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
  }
};

// Auto-execute when run directly as a script (npm postinstall)
const isDirectExecution =
  process.argv[1] != null &&
  (process.argv[1].endsWith("cleanupLegacyHooks.js") ||
    process.argv[1].endsWith("cleanupLegacyHooks.ts"));

if (isDirectExecution) {
  cleanupLegacyHooks().catch(() => {
    // Silent failure — best-effort cleanup
    process.exit(0);
  });
}
