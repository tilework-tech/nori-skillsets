/**
 * CLI command for searching profile packages in the Nori registrar
 * Handles: nori-ai registry-search <query>
 * Searches both org registry (with auth) and public registry (no auth)
 */

import { registrarApi, REGISTRAR_URL, type Package } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import {
  checkRegistryAgentSupport,
  showCursorAgentNotSupportedError,
} from "@/cli/commands/registryAgentCheck.js";
import { loadConfig } from "@/cli/config.js";
import { error, info, newline, raw } from "@/cli/logger.js";
import { getInstallDirs, normalizeInstallDir } from "@/utils/path.js";
import { extractOrgId, buildRegistryUrl } from "@/utils/url.js";

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
 * Search for profiles in your org's registry
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

  // Load config to check for org auth
  const config = await loadConfig({ installDir: effectiveInstallDir });

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
    error({
      message: `Failed to search profiles:\n\n${formatSearchResults({ results })}`,
    });
    return;
  }

  if (!hasResults) {
    // No results from any registry
    info({ message: `No profiles found matching "${query}".` });
    return;
  }

  // Display results (errors from individual registries are shown inline)
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
    .description("Search for profile packages in the Nori registries")
    .action(async (query: string) => {
      // Get global options from parent
      const globalOpts = program.opts();
      await registrySearchMain({
        query,
        installDir: globalOpts.installDir || null,
      });
    });
};
