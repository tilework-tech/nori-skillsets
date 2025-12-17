/**
 * Intercepted slash command for searching profile packages
 * Handles /nori-registry-search <query> command
 * Searches the user's org registry
 */

import { registrarApi, type Package } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { loadConfig } from "@/cli/config.js";
import { getInstallDirs } from "@/utils/path.js";
import { normalizeUrl, extractOrgId, buildRegistryUrl } from "@/utils/url.js";

import type {
  HookInput,
  HookOutput,
  InterceptedSlashCommand,
} from "./types.js";
import type { RegistryAuth } from "@/cli/config.js";

import { formatError, formatSuccess } from "./format.js";

/**
 * Result from searching a single registry
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
 * Search across all configured registries
 * @param args - Search parameters
 * @param args.query - The search query string
 * @param args.installDir - The Nori installation directory
 *
 * @returns Array of results per registry
 */
const searchAllRegistries = async (args: {
  query: string;
  installDir: string;
}): Promise<Array<RegistrySearchResult>> => {
  const { query, installDir } = args;
  const results: Array<RegistrySearchResult> = [];

  // Load config to get registry auths
  const config = await loadConfig({ installDir });

  // Track searched registries to avoid duplicates
  const searchedRegistries = new Set<string>();

  // Search org registry first if org-based auth is configured
  if (config?.auth != null && config.auth.organizationUrl != null) {
    const orgId = extractOrgId({ url: config.auth.organizationUrl });
    if (orgId != null) {
      const orgRegistryUrl = buildRegistryUrl({ orgId });
      const normalizedOrgUrl = normalizeUrl({ baseUrl: orgRegistryUrl });

      if (!searchedRegistries.has(normalizedOrgUrl)) {
        searchedRegistries.add(normalizedOrgUrl);

        const registryAuth: RegistryAuth = {
          registryUrl: orgRegistryUrl,
          username: config.auth.username,
          refreshToken: config.auth.refreshToken ?? null,
        };

        try {
          const authToken = await getRegistryAuthToken({ registryAuth });
          const packages = await registrarApi.searchPackagesOnRegistry({
            query,
            registryUrl: orgRegistryUrl,
            authToken,
          });
          results.push({ registryUrl: orgRegistryUrl, packages });
        } catch (err) {
          results.push({
            registryUrl: orgRegistryUrl,
            packages: [],
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  // Also search legacy registryAuths if configured
  if (config?.registryAuths != null) {
    for (const registryAuth of config.registryAuths) {
      const normalizedRegistryUrl = normalizeUrl({
        baseUrl: registryAuth.registryUrl,
      });

      // Skip if already searched
      if (searchedRegistries.has(normalizedRegistryUrl)) {
        continue;
      }
      searchedRegistries.add(normalizedRegistryUrl);

      try {
        // Get auth token for this registry
        const authToken = await getRegistryAuthToken({ registryAuth });

        const packages = await registrarApi.searchPackagesOnRegistry({
          query,
          registryUrl: registryAuth.registryUrl,
          authToken,
        });
        results.push({ registryUrl: registryAuth.registryUrl, packages });
      } catch (err) {
        results.push({
          registryUrl: registryAuth.registryUrl,
          packages: [],
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return results;
};

/**
 * Format multi-registry search results for display
 * @param args - The results to format
 * @param args.results - Array of search results from each registry
 *
 * @returns Formatted string
 */
const formatSearchResults = (args: {
  results: Array<RegistrySearchResult>;
}): string => {
  const { results } = args;
  const lines: Array<string> = [];

  for (const result of results) {
    // Show error for failing registries
    if (result.error != null) {
      lines.push(result.registryUrl);
      lines.push(`  -> Error: ${result.error}`);
      lines.push("");
      continue;
    }

    // Skip registries with no results
    if (result.packages.length === 0) {
      continue;
    }

    lines.push(result.registryUrl);
    for (const pkg of result.packages) {
      const description = pkg.description ? `: ${pkg.description}` : "";
      lines.push(`  -> ${pkg.name}${description}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
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

  // Search all registries
  try {
    const results = await searchAllRegistries({ query, installDir });

    // Check if we have any packages
    const hasPackages = results.some((r) => r.packages.length > 0);

    if (!hasPackages) {
      // Check if all results are errors
      const allErrors = results.every((r) => r.error != null);
      if (allErrors) {
        const formattedResults = formatSearchResults({ results });
        return {
          decision: "block",
          reason: formatError({
            message: `Failed to search profiles:\n\n${formattedResults}`,
          }),
        };
      }

      return {
        decision: "block",
        reason: formatSuccess({
          message: `No profiles found matching "${query}".\n\nTry a different search term.`,
        }),
      };
    }

    const formattedResults = formatSearchResults({ results });

    return {
      decision: "block",
      reason: formatSuccess({
        message: `Search results for "${query}":\n\n${formattedResults}\n\nTo install a profile, use: /nori-registry-download <package-name>`,
      }),
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      decision: "block",
      reason: formatError({
        message: `Failed to search profiles:\n${errorMessage}`,
      }),
    };
  }
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
