/**
 * CLI command for searching skill packages in the Nori registrar
 * Handles: nori-ai skill-search <query>
 * Searches the user's org registry (requires config.auth)
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
import { extractOrgId, buildRegistryUrl } from "@/utils/url.js";

import type { RegistryAuth } from "@/cli/config.js";
import type { Command } from "commander";

/**
 * Result from searching a single registry
 */
type RegistrySearchResult = {
  registryUrl: string;
  skills: Array<Package>;
  error?: string | null;
};

/**
 * Search the org registry for skills
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
    const skills = await registrarApi.searchSkills({
      query,
      registryUrl,
      authToken,
    });
    return { registryUrl, skills };
  } catch (err) {
    return {
      registryUrl,
      skills: [],
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
    if (result.skills.length === 0) {
      continue;
    }

    lines.push(result.registryUrl);
    for (const skill of result.skills) {
      const description = skill.description ? `: ${skill.description}` : "";
      lines.push(`  -> ${skill.name}${description}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
};

/**
 * Search for skills in your org's registry
 * @param args - The search parameters
 * @param args.query - The search query
 * @param args.cwd - Current working directory (defaults to process.cwd())
 * @param args.installDir - Optional installation directory (detected if not provided)
 */
export const skillSearchMain = async (args: {
  query: string;
  cwd?: string | null;
  installDir?: string | null;
}): Promise<void> => {
  const { query, installDir } = args;
  const cwd = args.cwd ?? process.cwd();

  // Determine effective install directory
  let effectiveInstallDir: string;
  if (installDir != null) {
    // Use provided installDir (normalized)
    effectiveInstallDir = normalizeInstallDir({ installDir });
  } else {
    // Auto-detect from current directory
    const allInstallations = getInstallDirs({ currentDir: cwd });
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

  // Load config and check for org auth
  const config = await loadConfig({ installDir: effectiveInstallDir });

  if (config?.auth == null || config.auth.organizationUrl == null) {
    error({
      message:
        "No organization configured.\n\nRun 'nori-ai install' to set up your organization credentials.",
    });
    return;
  }

  // Extract org ID and build registry URL
  const orgId = extractOrgId({ url: config.auth.organizationUrl });
  if (orgId == null) {
    error({
      message:
        "Invalid organization URL in config.\n\nRun 'nori-ai install' to reconfigure your credentials.",
    });
    return;
  }

  const registryUrl = buildRegistryUrl({ orgId });
  const registryAuth: RegistryAuth = {
    registryUrl,
    username: config.auth.username,
    password: config.auth.password ?? null,
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
    error({
      message: `Failed to search skills:\n\n${result.registryUrl}\n  -> Error: ${result.error}`,
    });
    return;
  }

  // Handle no results
  if (result.skills.length === 0) {
    info({ message: `No skills found matching "${query}".` });
    return;
  }

  // Display results
  const formattedResults = formatSearchResults({ results: [result] });

  newline();
  raw({ message: formattedResults });
  newline();
  info({
    message: "To install a skill, run: nori-ai skill-download <skill-name>",
  });
};

/**
 * Register the 'skill-search' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerSkillSearchCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("skill-search <query>")
    .description("Search for skill packages in your org's registry")
    .action(async (query: string) => {
      // Get global options from parent
      const globalOpts = program.opts();
      await skillSearchMain({
        query,
        installDir: globalOpts.installDir || null,
      });
    });
};
