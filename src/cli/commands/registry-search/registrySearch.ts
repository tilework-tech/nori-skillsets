/**
 * CLI command for searching profile packages and skills in the Nori registrar
 * Handles: nori-ai registry-search <query>
 * Searches both org registry (with auth) and public registry (no auth)
 * Returns both profiles and skills from each registry
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
 * Result from searching profiles in a registry
 */
type ProfileSearchResult = {
  registryUrl: string;
  packages: Array<Package>;
  error?: string | null;
};

/**
 * Result from searching skills in a registry
 */
type SkillSearchResult = {
  registryUrl: string;
  skills: Array<Package>;
  error?: string | null;
};

/**
 * Combined result from searching a registry
 */
type RegistrySearchResult = {
  registryUrl: string;
  profileResult: ProfileSearchResult;
  skillResult: SkillSearchResult;
};

/**
 * Search the org registry for profiles
 * @param args - Search parameters
 * @param args.query - The search query string
 * @param args.registryUrl - The registry URL to search
 * @param args.registryAuth - The registry authentication credentials
 *
 * @returns Search result for profiles
 */
const searchOrgRegistryProfiles = async (args: {
  query: string;
  registryUrl: string;
  registryAuth: RegistryAuth;
}): Promise<ProfileSearchResult> => {
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
 * Search the org registry for skills
 * @param args - Search parameters
 * @param args.query - The search query string
 * @param args.registryUrl - The registry URL to search
 * @param args.registryAuth - The registry authentication credentials
 *
 * @returns Search result for skills
 */
const searchOrgRegistrySkills = async (args: {
  query: string;
  registryUrl: string;
  registryAuth: RegistryAuth;
}): Promise<SkillSearchResult> => {
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
 * Search the public registry for profiles (no auth required)
 * @param args - Search parameters
 * @param args.query - The search query string
 *
 * @returns Search result for profiles
 */
const searchPublicRegistryProfiles = async (args: {
  query: string;
}): Promise<ProfileSearchResult> => {
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
 * Search the public registry for skills (no auth required)
 * @param args - Search parameters
 * @param args.query - The search query string
 *
 * @returns Search result for skills
 */
const searchPublicRegistrySkills = async (args: {
  query: string;
}): Promise<SkillSearchResult> => {
  const { query } = args;

  try {
    // searchSkills supports optional authToken - omit it for public access
    const skills = await registrarApi.searchSkills({
      query,
    });
    return { registryUrl: REGISTRAR_URL, skills };
  } catch (err) {
    return {
      registryUrl: REGISTRAR_URL,
      skills: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

/**
 * Format a list of packages/skills for display
 * @param args - The items to format
 * @param args.registryUrl - The registry URL
 * @param args.items - Array of packages or skills
 *
 * @returns Formatted string
 */
const formatItems = (args: {
  registryUrl: string;
  items: Array<Package>;
}): string => {
  const { registryUrl, items } = args;
  const lines: Array<string> = [];

  lines.push(registryUrl);
  for (const item of items) {
    const description = item.description ? `: ${item.description}` : "";
    lines.push(`  -> ${item.name}${description}`);
  }

  return lines.join("\n");
};

/**
 * Format unified search results for display with section headers
 * @param args - The results to format
 * @param args.results - Array of registry search results
 *
 * @returns Formatted string
 */
const formatUnifiedSearchResults = (args: {
  results: Array<RegistrySearchResult>;
}): string => {
  const { results } = args;
  const profileSections: Array<string> = [];
  const skillSections: Array<string> = [];

  for (const result of results) {
    const { profileResult, skillResult } = result;

    // Collect profile results
    if (profileResult.error != null) {
      profileSections.push(
        `${profileResult.registryUrl}\n  -> Error: ${profileResult.error}`,
      );
    } else if (profileResult.packages.length > 0) {
      profileSections.push(
        formatItems({
          registryUrl: profileResult.registryUrl,
          items: profileResult.packages,
        }),
      );
    }

    // Collect skill results
    if (skillResult.error != null) {
      skillSections.push(
        `${skillResult.registryUrl}\n  -> Error: ${skillResult.error}`,
      );
    } else if (skillResult.skills.length > 0) {
      skillSections.push(
        formatItems({
          registryUrl: skillResult.registryUrl,
          items: skillResult.skills,
        }),
      );
    }
  }

  const sections: Array<string> = [];

  if (profileSections.length > 0) {
    sections.push(`Profiles:\n${profileSections.join("\n\n")}`);
  }

  if (skillSections.length > 0) {
    sections.push(`Skills:\n${skillSections.join("\n\n")}`);
  }

  return sections.join("\n\n");
};

/**
 * Build the download hints based on what results were found
 * @param args - The results
 * @param args.hasProfiles - Whether profiles were found
 * @param args.hasSkills - Whether skills were found
 *
 * @returns Hint message
 */
const buildDownloadHints = (args: {
  hasProfiles: boolean;
  hasSkills: boolean;
}): string => {
  const { hasProfiles, hasSkills } = args;
  const hints: Array<string> = [];

  if (hasProfiles) {
    hints.push(
      "To install a profile, run: nori-ai registry-download <package-name>",
    );
  }
  if (hasSkills) {
    hints.push("To install a skill, run: nori-ai skill-download <skill-name>");
  }

  return hints.join("\n");
};

/**
 * Search for profiles and skills in registries (org + public)
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

      // Search both profiles and skills in parallel on org registry
      const [profileResult, skillResult] = await Promise.all([
        searchOrgRegistryProfiles({
          query,
          registryUrl,
          registryAuth,
        }),
        searchOrgRegistrySkills({
          query,
          registryUrl,
          registryAuth,
        }),
      ]);

      results.push({ registryUrl, profileResult, skillResult });
    }
  }

  // Always search public registry (no auth required)
  const [publicProfileResult, publicSkillResult] = await Promise.all([
    searchPublicRegistryProfiles({ query }),
    searchPublicRegistrySkills({ query }),
  ]);

  results.push({
    registryUrl: REGISTRAR_URL,
    profileResult: publicProfileResult,
    skillResult: publicSkillResult,
  });

  // Check if we have any results or all errors
  const hasProfileResults = results.some(
    (r) => r.profileResult.error == null && r.profileResult.packages.length > 0,
  );
  const hasSkillResults = results.some(
    (r) => r.skillResult.error == null && r.skillResult.skills.length > 0,
  );
  const allProfileErrors = results.every(
    (r) =>
      r.profileResult.error != null || r.profileResult.packages.length === 0,
  );
  const allSkillErrors = results.every(
    (r) => r.skillResult.error != null || r.skillResult.skills.length === 0,
  );

  // Handle case where everything failed with errors
  const hasAnyProfileError = results.some((r) => r.profileResult.error != null);
  const hasAnySkillError = results.some((r) => r.skillResult.error != null);
  if (
    allProfileErrors &&
    allSkillErrors &&
    hasAnyProfileError &&
    hasAnySkillError
  ) {
    error({
      message: `Failed to search:\n\n${formatUnifiedSearchResults({ results })}`,
    });
    return;
  }

  // Handle no results (and no errors that need displaying)
  if (
    !hasProfileResults &&
    !hasSkillResults &&
    !hasAnyProfileError &&
    !hasAnySkillError
  ) {
    info({ message: `No profiles or skills found matching "${query}".` });
    return;
  }

  // Format and display results
  const formattedResults = formatUnifiedSearchResults({ results });

  newline();
  raw({ message: formattedResults });
  newline();

  // Show appropriate download hints
  const hints = buildDownloadHints({
    hasProfiles: hasProfileResults,
    hasSkills: hasSkillResults,
  });
  if (hints) {
    info({ message: hints });
  }
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
    .description("Search for profiles and skills in Nori registries")
    .action(async (query: string) => {
      // Get global options from parent
      const globalOpts = program.opts();
      await registrySearchMain({
        query,
        installDir: globalOpts.installDir || null,
      });
    });
};
