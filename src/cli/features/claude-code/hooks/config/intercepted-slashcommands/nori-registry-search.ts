/**
 * Intercepted slash command for searching profile packages and skills
 * Handles /nori-registry-search <query> command
 * Searches both org registry (with auth) and public registry (no auth)
 * Returns both profiles and skills from each registry
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
      "To install a profile, use: /nori-registry-download <package-name>",
    );
  }
  if (hasSkills) {
    hints.push("To install a skill, use: /nori-skill-download <skill-name>");
  }

  return hints.join("\n");
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
        message: `Search for profiles and skills in Nori registries.\n\nUsage: /nori-registry-search <query>\n\nExamples:\n  /nori-registry-search typescript\n  /nori-registry-search react developer`,
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
    return {
      decision: "block",
      reason: formatError({
        message: `Failed to search:\n\n${formatUnifiedSearchResults({ results })}`,
      }),
    };
  }

  // Handle no results (and no errors that need displaying)
  if (
    !hasProfileResults &&
    !hasSkillResults &&
    !hasAnyProfileError &&
    !hasAnySkillError
  ) {
    return {
      decision: "block",
      reason: formatSuccess({
        message: `No profiles or skills found matching "${query}".\n\nTry a different search term.`,
      }),
    };
  }

  // Format and display results
  const formattedResults = formatUnifiedSearchResults({ results });

  // Build download hints
  const hints = buildDownloadHints({
    hasProfiles: hasProfileResults,
    hasSkills: hasSkillResults,
  });

  return {
    decision: "block",
    reason: formatSuccess({
      message: `Search results for "${query}":\n\n${formattedResults}${hints ? `\n\n${hints}` : ""}`,
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
