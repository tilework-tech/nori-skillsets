/**
 * Intercepted slash command for searching profile packages
 * Handles /nori-registry-search <query> command
 * Searches the user's org registry (requires config.auth)
 */

import { registrarApi, type Package } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { loadConfig } from "@/cli/config.js";
import { getInstallDirs } from "@/utils/path.js";
import { extractOrgId, buildRegistryUrl } from "@/utils/url.js";

import type {
  HookInput,
  HookOutput,
  InterceptedSlashCommand,
} from "./types.js";
import type { RegistryAuth } from "@/cli/config.js";

import { formatError, formatSuccess } from "./format.js";

/**
 * Result from searching a registry
 */
type RegistrySearchResult = {
  registryUrl: string;
  packages: Array<Package>;
  error?: string | null;
};

/**
 * Parse search query from prompt
 * @param prompt - The user prompt to parse
 *
 * @returns The search query or null if invalid
 */
const parseQuery = (prompt: string): string | null => {
  const match = prompt.trim().match(/^\/nori-registry-search\s+(.+)$/i);

  if (!match) {
    return null;
  }

  return match[1].trim();
};

/**
 * Search the org registry
 * @param args - Search parameters
 * @param args.query - The search query string
 * @param args.registryUrl - The registry URL to search
 * @param args.registryAuth - The registry authentication credentials
 *
 * @returns Search result for the registry
 */
const searchOrgRegistry = async (args: {
  query: string;
  registryUrl: string;
  registryAuth: RegistryAuth;
}): Promise<RegistrySearchResult> => {
  const { query, registryUrl, registryAuth } = args;

  try {
    const authToken = await getRegistryAuthToken({ registryAuth });
    const packages = await registrarApi.searchPackagesOnRegistry({
      query,
      registryUrl,
      authToken,
    });
    return { registryUrl, packages };
  } catch (err) {
    return {
      registryUrl,
      packages: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

/**
 * Format search results for display
 * @param args - The results to format
 * @param args.result - Search result from the registry
 *
 * @returns Formatted string
 */
const formatSearchResult = (args: { result: RegistrySearchResult }): string => {
  const { result } = args;
  const lines: Array<string> = [];

  lines.push(result.registryUrl);
  for (const pkg of result.packages) {
    const description = pkg.description ? `: ${pkg.description}` : "";
    lines.push(`  -> ${pkg.name}${description}`);
  }

  return lines.join("\n");
};

/**
 * Run the nori-registry-search command
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
        message: `Search for profile packages in your org's registry.\n\nUsage: /nori-registry-search <query>\n\nExamples:\n  /nori-registry-search typescript\n  /nori-registry-search react developer`,
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

  const installDir = allInstallations[0];

  // Load config and check for org auth
  const config = await loadConfig({ installDir });

  if (config?.auth == null || config.auth.organizationUrl == null) {
    return {
      decision: "block",
      reason: formatError({
        message: `No organization configured.\n\nRun 'nori-ai install' to set up your organization credentials.`,
      }),
    };
  }

  // Extract org ID and build registry URL
  const orgId = extractOrgId({ url: config.auth.organizationUrl });
  if (orgId == null) {
    return {
      decision: "block",
      reason: formatError({
        message: `Invalid organization URL in config.\n\nRun 'nori-ai install' to reconfigure your credentials.`,
      }),
    };
  }

  const registryUrl = buildRegistryUrl({ orgId });
  const registryAuth: RegistryAuth = {
    registryUrl,
    username: config.auth.username,
    refreshToken: config.auth.refreshToken ?? null,
  };

  // Search org registry
  const result = await searchOrgRegistry({
    query,
    registryUrl,
    registryAuth,
  });

  // Handle errors
  if (result.error != null) {
    return {
      decision: "block",
      reason: formatError({
        message: `Failed to search profiles:\n\n${result.registryUrl}\n  -> Error: ${result.error}`,
      }),
    };
  }

  // Handle no results
  if (result.packages.length === 0) {
    return {
      decision: "block",
      reason: formatSuccess({
        message: `No profiles found matching "${query}".\n\nTry a different search term.`,
      }),
    };
  }

  // Display results
  const formattedResults = formatSearchResult({ result });

  return {
    decision: "block",
    reason: formatSuccess({
      message: `Search results for "${query}":\n\n${formattedResults}\n\nTo install a profile, use: /nori-registry-download <package-name>`,
    }),
  };
};

/**
 * nori-registry-search intercepted slash command
 */
export const noriRegistrySearch: InterceptedSlashCommand = {
  matchers: [
    "^\\/nori-registry-search\\s*$", // Bare command (no query) - shows help
    "^\\/nori-registry-search\\s+.+$", // Command with query
  ],
  run,
};
