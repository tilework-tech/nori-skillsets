/**
 * Intercepted slash command for searching profile packages
 * Handles /nori-search-profiles <query> command
 */

import { registrarApi } from "@/api/registrar.js";
import { getInstallDirs } from "@/utils/path.js";

import type {
  HookInput,
  HookOutput,
  InterceptedSlashCommand,
} from "./types.js";

/**
 * Parse search query from prompt
 * @param prompt - The user prompt to parse
 *
 * @returns The search query or null if invalid
 */
const parseQuery = (prompt: string): string | null => {
  const match = prompt.trim().match(/^\/nori-search-profiles\s+(.+)$/i);

  if (!match) {
    return null;
  }

  return match[1].trim();
};

/**
 * Run the nori-search-profiles command
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
      reason: `Invalid search query.\n\nUsage: /nori-search-profiles <query>\n\nExamples:\n  /nori-search-profiles typescript\n  /nori-search-profiles react developer`,
    };
  }

  // Find installation directory (for consistency with other commands)
  const allInstallations = getInstallDirs({ currentDir: cwd });

  if (allInstallations.length === 0) {
    return {
      decision: "block",
      reason: `No Nori installation found.\n\nRun 'npx nori-ai install' to install Nori Profiles.`,
    };
  }

  // Search for packages
  try {
    const packages = await registrarApi.searchPackages({ query });

    if (packages.length === 0) {
      return {
        decision: "block",
        reason: `No profiles found matching "${query}".\n\nTry a different search term or browse the registrar at https://registrar.tilework.tech`,
      };
    }

    // Format results
    const resultLines = packages.map((pkg) => {
      const description = pkg.description ? `\n   ${pkg.description}` : "";
      return `• ${pkg.name}${description}`;
    });

    return {
      decision: "block",
      reason: `Found ${packages.length} profile(s) matching "${query}":\n\n${resultLines.join("\n\n")}\n\nTo install a profile, use: /nori-download-profile <package-name>`,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      decision: "block",
      reason: `Failed to search profiles:\n${errorMessage}`,
    };
  }
};

/**
 * nori-search-profiles intercepted slash command
 */
export const noriSearchProfiles: InterceptedSlashCommand = {
  matchers: ["^\\/nori-search-profiles\\s+.+$"],
  run,
};
