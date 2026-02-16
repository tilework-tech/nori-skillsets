/**
 * CLI command for searching profile packages and skills in the Nori registrar
 * Handles: nori-skillsets search <query>
 * Searches both org registry (with auth) and public registry (no auth)
 * Returns both profiles and skills from each registry
 */

import os from "os";

import {
  registrarApi,
  REGISTRAR_URL,
  NetworkError,
  type Package,
} from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import {
  getCommandNames,
  type CliName,
} from "@/cli/commands/cliCommandNames.js";
import { loadConfig } from "@/cli/config.js";
import { error } from "@/cli/logger.js";
import { registrySearchFlow } from "@/cli/prompts/flows/index.js";
import { getInstallDirs } from "@/utils/path.js";
import {
  extractOrgId,
  buildRegistryUrl,
  buildOrganizationRegistryUrl,
} from "@/utils/url.js";

import type { RegistryAuth } from "@/cli/config.js";
import type { SearchFlowResult } from "@/cli/prompts/flows/index.js";
import type { Command } from "commander";

/**
 * Result from searching profiles in a registry
 */
type ProfileSearchResult = {
  registryUrl: string;
  packages: Array<Package>;
  error?: string | null;
  isNetworkError?: boolean | null;
};

/**
 * Result from searching skills in a registry
 */
type SkillSearchResult = {
  registryUrl: string;
  skills: Array<Package>;
  error?: string | null;
  isNetworkError?: boolean | null;
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
    const isNetworkError = err instanceof NetworkError;
    return {
      registryUrl,
      packages: [],
      error: err instanceof Error ? err.message : String(err),
      isNetworkError,
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
    const isNetworkError = err instanceof NetworkError;
    return {
      registryUrl,
      skills: [],
      error: err instanceof Error ? err.message : String(err),
      isNetworkError,
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
    const isNetworkError = err instanceof NetworkError;
    return {
      registryUrl: REGISTRAR_URL,
      packages: [],
      error: err instanceof Error ? err.message : String(err),
      isNetworkError,
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
    const isNetworkError = err instanceof NetworkError;
    return {
      registryUrl: REGISTRAR_URL,
      skills: [],
      error: err instanceof Error ? err.message : String(err),
      isNetworkError,
    };
  }
};

/**
 * Get the namespaced package name for display
 * @param args - The arguments
 * @param args.packageName - The base package name
 * @param args.registryUrl - The registry URL to derive namespace from
 *
 * @returns Namespaced package name (e.g., "myorg/package" or "package" for public)
 */
const getNamespacedPackageName = (args: {
  packageName: string;
  registryUrl: string;
}): string => {
  const { packageName, registryUrl } = args;
  const orgId = extractOrgId({ url: registryUrl });

  // Public registry packages don't need namespace prefix
  if (orgId == null || orgId === "public") {
    return packageName;
  }

  return `${orgId}/${packageName}`;
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
  const orgId = extractOrgId({ url: registryUrl });
  const orgLabel = orgId === "public" || orgId == null ? "public" : orgId;

  lines.push(`${orgLabel}:`);
  for (const item of items) {
    const namespacedName = getNamespacedPackageName({
      packageName: item.name,
      registryUrl,
    });
    const description = item.description ? ` - ${item.description}` : "";
    lines.push(`  ${namespacedName}${description}`);
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
  const errorSections: Array<string> = [];

  for (const result of results) {
    const { profileResult, skillResult } = result;

    // Collect profile results (skip errors - just noise for unavailable registries)
    if (profileResult.error == null && profileResult.packages.length > 0) {
      profileSections.push(
        formatItems({
          registryUrl: profileResult.registryUrl,
          items: profileResult.packages,
        }),
      );
    }

    // Collect skill results (skip errors - just noise for unavailable registries)
    if (skillResult.error == null && skillResult.skills.length > 0) {
      skillSections.push(
        formatItems({
          registryUrl: skillResult.registryUrl,
          items: skillResult.skills,
        }),
      );
    }

    // Collect network errors (these are important to show to the user)
    if (profileResult.isNetworkError && profileResult.error != null) {
      errorSections.push(profileResult.error);
    }
    if (
      skillResult.isNetworkError &&
      skillResult.error != null &&
      skillResult.error !== profileResult.error
    ) {
      errorSections.push(skillResult.error);
    }
  }

  const sections: Array<string> = [];

  // Show network errors first
  if (errorSections.length > 0) {
    sections.push(`Network Errors:\n${errorSections.join("\n")}`);
  }

  if (profileSections.length > 0) {
    sections.push(`Skillsets:\n${profileSections.join("\n\n")}`);
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
 * @param args.cliName - The CLI name for command hints
 *
 * @returns Hint message
 */
const buildDownloadHints = (args: {
  hasProfiles: boolean;
  hasSkills: boolean;
  cliName?: CliName | null;
}): string => {
  const { hasProfiles, hasSkills, cliName } = args;
  const commandNames = getCommandNames({ cliName });
  const cliPrefix = cliName ?? "nori-skillsets";
  const hints: Array<string> = [];

  if (hasProfiles) {
    hints.push(
      `To install a skillset, run: ${cliPrefix} ${commandNames.download} <package-name>`,
    );
  }
  if (hasSkills) {
    hints.push(
      `To install a skill, run: ${cliPrefix} ${commandNames.downloadSkill} <skill-name>`,
    );
  }

  return hints.join("\n");
};

/**
 * Perform the actual search across registries and return a flow-compatible result
 * @param args - The search parameters
 * @param args.query - The search query
 * @param args.config - The loaded Nori config
 * @param args.cliName - CLI name for command hints
 *
 * @returns Search result for the flow
 */
const performSearch = async (args: {
  query: string;
  config: Awaited<ReturnType<typeof loadConfig>>;
  cliName?: CliName | null;
}): Promise<SearchFlowResult> => {
  const { query, config, cliName } = args;

  // Collect results from all registries
  const results: Array<RegistrySearchResult> = [];

  // Check for unified auth with organizations (new multi-org flow)
  const hasUnifiedAuthWithOrgs =
    config?.auth != null &&
    config.auth.refreshToken != null &&
    config.auth.organizations != null;

  if (hasUnifiedAuthWithOrgs) {
    const userOrgs = config.auth!.organizations!;
    const orgSearchPromises: Array<Promise<RegistrySearchResult>> = [];

    for (const orgId of userOrgs) {
      if (orgId === "public") {
        continue;
      }

      const registryUrl = buildOrganizationRegistryUrl({ orgId });
      const registryAuth: RegistryAuth = {
        registryUrl,
        username: config.auth!.username,
        refreshToken: config.auth!.refreshToken,
      };

      const orgSearchPromise = (async (): Promise<RegistrySearchResult> => {
        const [profileResult, skillResult] = await Promise.all([
          searchOrgRegistryProfiles({ query, registryUrl, registryAuth }),
          searchOrgRegistrySkills({ query, registryUrl, registryAuth }),
        ]);
        return { registryUrl, profileResult, skillResult };
      })();

      orgSearchPromises.push(orgSearchPromise);
    }

    const orgResults = await Promise.all(orgSearchPromises);
    results.push(...orgResults);
  } else if (
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

      const [profileResult, skillResult] = await Promise.all([
        searchOrgRegistryProfiles({ query, registryUrl, registryAuth }),
        searchOrgRegistrySkills({ query, registryUrl, registryAuth }),
      ]);

      results.push({ registryUrl, profileResult, skillResult });
    }
  }

  // Always search public registry
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

  const hasAnyProfileError = results.some((r) => r.profileResult.error != null);
  const hasAnySkillError = results.some((r) => r.skillResult.error != null);
  const hasNetworkError = results.some(
    (r) => r.profileResult.isNetworkError || r.skillResult.isNetworkError,
  );

  if (
    allProfileErrors &&
    allSkillErrors &&
    hasAnyProfileError &&
    hasAnySkillError
  ) {
    const errorPrefix = hasNetworkError
      ? "Failed to search due to network connectivity issues:\n\n"
      : "Failed to search:\n\n";
    return {
      success: false,
      error: `${errorPrefix}${formatUnifiedSearchResults({ results })}`,
    };
  }

  if (
    !hasProfileResults &&
    !hasSkillResults &&
    !hasAnyProfileError &&
    !hasAnySkillError
  ) {
    return { success: true, hasResults: false, query };
  }

  const formattedResults = formatUnifiedSearchResults({ results });
  const downloadHints = buildDownloadHints({
    hasProfiles: hasProfileResults,
    hasSkills: hasSkillResults,
    cliName,
  });

  const skillsetCount = results.reduce(
    (sum, r) =>
      sum +
      (r.profileResult.error == null ? r.profileResult.packages.length : 0),
    0,
  );
  const skillCount = results.reduce(
    (sum, r) =>
      sum + (r.skillResult.error == null ? r.skillResult.skills.length : 0),
    0,
  );

  return {
    success: true,
    hasResults: true,
    formattedResults,
    downloadHints,
    skillsetCount,
    skillCount,
  };
};

/**
 * Search for profiles and skills in registries (org + public)
 * @param args - The search parameters
 * @param args.query - The search query
 * @param args.installDir - Optional installation directory (detected if not provided)
 * @param args.cliName - CLI name for user-facing messages (defaults to nori-skillsets)
 */
export const registrySearchMain = async (args: {
  query: string;
  installDir?: string | null;
  cliName?: CliName | null;
}): Promise<void> => {
  const { query, installDir, cliName } = args;

  // Verify an installation exists (needed for registry auth discovery)
  if (installDir == null) {
    const allInstallations = getInstallDirs({ currentDir: process.cwd() });
    const homeDir = os.homedir();
    const homeInstallations = getInstallDirs({ currentDir: homeDir });

    if (!homeInstallations.includes(homeDir) && allInstallations.length === 0) {
      error({
        message:
          "No Nori installation found.\n\nRun 'npx nori-skillsets init' to install Nori Skillsets.",
      });
      return;
    }
  }

  // Load config to check for org auth - use os.homedir() since registry needs global auth
  const config = await loadConfig({ startDir: os.homedir() });

  await registrySearchFlow({
    callbacks: {
      onSearch: async (): Promise<SearchFlowResult> => {
        const searchResults = await performSearch({ query, config, cliName });
        return searchResults;
      },
    },
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
    .description("Search for skillsets and skills in Nori registries")
    .action(async (query: string) => {
      // Get global options from parent
      const globalOpts = program.opts();
      await registrySearchMain({
        query,
        installDir: globalOpts.installDir || null,
      });
    });
};
