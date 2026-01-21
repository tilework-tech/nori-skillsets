/**
 * Intercepted slash command for searching profile packages
 * Handles /nori-registry-search <query> command
 * Searches both org registry (with auth) and public registry (no auth)
 */

import { registrarApi, REGISTRAR_URL, type Package } from "@/api/registrar.js";
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
 * Search the public registry (no auth required)
 * @param args - Search parameters
 * @param args.query - The search query string
 *
 * @returns Search result for the public registry
 */
const searchPublicRegistry = async (args: {
  query: string;
}): Promise<RegistrySearchResult> => {
  const { query } = args;

  try {
    const packages = await registrarApi.searchPackages({
      query,
    });
    return { registryUrl: REGISTRAR_URL, packages };
  } catch (err) {
    return {
      registryUrl: REGISTRAR_URL,
      packages: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
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
        message: `Search for profile packages in the Nori registries.\n\nUsage: /nori-registry-search <query>\n\nExamples:\n  /nori-registry-search typescript\n  /nori-registry-search react developer`,
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

  // Load config to check for org auth
  const config = await loadConfig({ installDir });

  // Collect results from all registries
  const results: Array<RegistrySearchResult> = [];

  // Search org registry first if auth is configured (private first, then public)
  if (
    config?.auth != null &&
    config.auth.organizationUrl != null &&
    config.auth.refreshToken != null
  ) {
    const orgId = extractOrgId({ url: config.auth.organizationUrl });
    if (orgId != null) {
      const registryUrl = buildRegistryUrl({ orgId });
      const registryAuth: RegistryAuth = {
        registryUrl,
        username: config.auth.username,
        refreshToken: config.auth.refreshToken,
      };

      const orgResult = await searchOrgRegistry({
        query,
        registryUrl,
        registryAuth,
      });
      results.push(orgResult);
    }
  }

  // Always search public registry (no auth required)
  const publicResult = await searchPublicRegistry({ query });
  results.push(publicResult);

  // Check if all results are errors or empty
  const hasResults = results.some(
    (r) => r.error == null && r.packages.length > 0,
  );
  const allErrors = results.every((r) => r.error != null);

  if (allErrors) {
    // All registries failed - show errors
    return {
      decision: "block",
      reason: formatError({
        message: `Failed to search profiles:\n\n${formatSearchResults({ results })}`,
      }),
    };
  }

  if (!hasResults) {
    // No results from any registry
    return {
      decision: "block",
      reason: formatSuccess({
        message: `No profiles found matching "${query}".\n\nTry a different search term.`,
      }),
    };
  }

  // Display results (errors from individual registries are shown inline)
  const formattedResults = formatSearchResults({ results });

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
