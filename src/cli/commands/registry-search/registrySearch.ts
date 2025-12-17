/**
 * CLI command for searching profile packages in the Nori registrar
 * Handles: nori-ai registry-search <query>
 * Searches across all configured registries (public + org)
 */

import { registrarApi, type Package } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import {
  checkRegistryAgentSupport,
  showCursorAgentNotSupportedError,
} from "@/cli/commands/registryAgentCheck.js";
import { loadConfig } from "@/cli/config.js";
import { error, info, newline, raw } from "@/cli/logger.js";
import { getInstallDirs, normalizeInstallDir } from "@/utils/path.js";
import { normalizeUrl, extractOrgId, buildRegistryUrl } from "@/utils/url.js";

import type { RegistryAuth } from "@/cli/config.js";
import type { Command } from "commander";

/**
 * Result from searching a single registry
 */
type RegistrySearchResult = {
  registryUrl: string;
  packages: Array<Package>;
  error?: string | null;
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
 * Search for profiles in the registrar across all configured registries
 * @param args - The search parameters
 * @param args.query - The search query
 * @param args.installDir - Optional installation directory (detected if not provided)
 */
export const registrySearchMain = async (args: {
  query: string;
  installDir?: string | null;
}): Promise<void> => {
  const { query, installDir } = args;

  // Determine effective install directory
  let effectiveInstallDir: string;
  if (installDir != null) {
    // Use provided installDir (normalized)
    effectiveInstallDir = normalizeInstallDir({ installDir });
  } else {
    // Auto-detect from current directory
    const allInstallations = getInstallDirs({ currentDir: process.cwd() });
    if (allInstallations.length === 0) {
      error({
        message:
          "No Nori installation found.\n\nRun 'npx nori-ai install' to install Nori Profiles.",
      });
      return;
    }
    effectiveInstallDir = allInstallations[0];
  }

  // Check if cursor-agent-only installation (not supported for registry commands)
  const agentCheck = await checkRegistryAgentSupport({
    installDir: effectiveInstallDir,
  });
  if (!agentCheck.supported) {
    showCursorAgentNotSupportedError();
    return;
  }

  // Search all registries
  const results = await searchAllRegistries({
    query,
    installDir: effectiveInstallDir,
  });

  // Check if we have any packages
  const hasPackages = results.some((r) => r.packages.length > 0);

  if (!hasPackages) {
    // Check if all results are errors
    const allErrors = results.every((r) => r.error != null);
    if (allErrors) {
      const formattedResults = formatSearchResults({ results });
      error({
        message: `Failed to search profiles:\n\n${formattedResults}`,
      });
      return;
    }

    info({ message: `No profiles found matching "${query}".` });
    return;
  }

  const formattedResults = formatSearchResults({ results });

  newline();
  raw({ message: formattedResults });
  newline();
  info({
    message:
      "To install a profile, run: nori-ai registry-download <package-name>",
  });
};

/**
 * Register the 'registry-search' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerRegistrySearchCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("registry-search <query>")
    .description("Search for profile packages in your org's registry")
    .action(async (query: string) => {
      // Get global options from parent
      const globalOpts = program.opts();
      await registrySearchMain({
        query,
        installDir: globalOpts.installDir || null,
      });
    });
};
