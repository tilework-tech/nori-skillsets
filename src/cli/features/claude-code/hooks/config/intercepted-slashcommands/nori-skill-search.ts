/**
 * Intercepted slash command for searching skills in the registry
 * Handles /nori-skill-search <query> command
 * Searches the user's org registry (requires config.auth)
 */

import { skillSearchMain } from "@/cli/commands/skill-search/skillSearch.js";
import { getInstallDirs } from "@/utils/path.js";

import type {
  HookInput,
  HookOutput,
  InterceptedSlashCommand,
} from "./types.js";

import { formatError, formatSuccess } from "./format.js";

/**
 * Parse search query from prompt
 * @param prompt - The user prompt to parse
 *
 * @returns The search query or null if invalid
 */
const parseQuery = (prompt: string): string | null => {
  const match = prompt.trim().match(/^\/nori-skill-search\s+(.+)$/i);

  if (!match) {
    return null;
  }

  return match[1].trim();
};

/**
 * Run the nori-skill-search command
 * @param args - The function arguments
 * @param args.input - The hook input containing prompt and cwd
 *
 * @returns The hook output with search results, or null if not handled
 */
const run = async (args: { input: HookInput }): Promise<HookOutput | null> => {
  const { input } = args;
  const { prompt, cwd } = input;

  // Parse query from prompt
  const query = parseQuery(prompt);
  if (query == null) {
    return {
      decision: "block",
      reason: formatSuccess({
        message: `Search for skills in your org's registry.\n\nUsage: /nori-skill-search <query>\n\nExamples:\n  /nori-skill-search typescript\n  /nori-skill-search debugging`,
      }),
    };
  }

  // Find installation directory
  const allInstallations = getInstallDirs({ currentDir: cwd });

  if (allInstallations.length === 0) {
    return {
      decision: "block",
      reason: formatError({
        message: `No Nori installation found.\n\nRun 'npx nori-ai install' to install Nori Profiles.`,
      }),
    };
  }

  if (allInstallations.length > 1) {
    const installList = allInstallations
      .map((dir, index) => `${index + 1}. ${dir}`)
      .join("\n");

    return {
      decision: "block",
      reason: formatError({
        message: `Found multiple Nori installations. Cannot determine which one to use.\n\nInstallations found:\n${installList}\n\nPlease navigate to the specific installation directory and try again.`,
      }),
    };
  }

  const installDir = allInstallations[0];

  // Run the skill search command
  try {
    await skillSearchMain({
      query,
      cwd,
      installDir,
    });

    return {
      decision: "block",
      reason: formatSuccess({
        message: `Skill search completed. Check the output above for details.`,
      }),
    };
  } catch (err) {
    return {
      decision: "block",
      reason: formatError({
        message: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
      }),
    };
  }
};

/**
 * nori-skill-search intercepted slash command
 */
export const noriSkillSearch: InterceptedSlashCommand = {
  matchers: [
    "^\\/nori-skill-search\\s*$", // Bare command (no query) - shows help
    "^\\/nori-skill-search\\s+.+$", // Command with query
  ],
  run,
};
