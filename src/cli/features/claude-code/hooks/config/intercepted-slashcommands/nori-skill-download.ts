/**
 * Intercepted slash command for downloading skills from the registry
 * Handles /nori-skill-download <skill-name>[@version] [--registry <url>] [--list-versions] command
 */

import { skillDownloadMain } from "@/cli/commands/skill-download/skillDownload.js";
import { getInstallDirs } from "@/utils/path.js";

import type {
  HookInput,
  HookOutput,
  InterceptedSlashCommand,
} from "./types.js";

import { formatError, formatSuccess } from "./format.js";

/**
 * Parse skill spec and options from prompt
 * Supports formats:
 *   - "skill-name"
 *   - "skill-name@version"
 *   - "skill-name --list-versions"
 *   - "skill-name --registry <url>"
 * @param prompt - The user prompt to parse
 *
 * @returns Parsed download args or null if invalid
 */
const parseDownloadArgs = (
  prompt: string,
): {
  skillSpec: string;
  registryUrl?: string | null;
  listVersions?: boolean | null;
} | null => {
  // Match: /nori-skill-download skill[@version] [--registry url] [--list-versions]
  const match = prompt
    .trim()
    .match(
      /^\/nori-skill-download\s+([a-z0-9-]+(?:@\d+\.\d+\.\d+[^\s]*)?)(?:\s+--registry\s+(https?:\/\/\S+))?(?:\s+--list-versions)?$/i,
    );

  if (!match) {
    // Try alternate pattern: --list-versions before --registry
    const altMatch = prompt
      .trim()
      .match(
        /^\/nori-skill-download\s+([a-z0-9-]+(?:@\d+\.\d+\.\d+[^\s]*)?)(?:\s+--list-versions)?(?:\s+--registry\s+(https?:\/\/\S+))?$/i,
      );
    if (!altMatch) {
      return null;
    }
    return {
      skillSpec: altMatch[1],
      registryUrl: altMatch[2] ?? null,
      listVersions: prompt.includes("--list-versions"),
    };
  }

  return {
    skillSpec: match[1],
    registryUrl: match[2] ?? null,
    listVersions: prompt.includes("--list-versions"),
  };
};

/**
 * Run the nori-skill-download command
 * @param args - The function arguments
 * @param args.input - The hook input containing prompt and cwd
 *
 * @returns The hook output with download result, or null if not handled
 */
const run = async (args: { input: HookInput }): Promise<HookOutput | null> => {
  const { input } = args;
  const { prompt, cwd } = input;

  // Parse download args from prompt
  const downloadArgs = parseDownloadArgs(prompt);
  if (downloadArgs == null) {
    return {
      decision: "block",
      reason: formatSuccess({
        message: `Download a skill from the Nori registry.\n\nUsage: /nori-skill-download <skill-name>[@version] [--registry <url>] [--list-versions]\n\nExamples:\n  /nori-skill-download my-skill\n  /nori-skill-download my-skill@1.0.0\n  /nori-skill-download my-skill --list-versions\n  /nori-skill-download my-skill --registry https://registry.example.com`,
      }),
    };
  }

  const { skillSpec, registryUrl, listVersions } = downloadArgs;

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

  if (allInstallations.length > 1) {
    const installList = allInstallations
      .map((dir, index) => `${index + 1}. ${dir}`)
      .join("\n");

    return {
      decision: "block",
      reason: formatError({
        message: `Found multiple Nori installations. Cannot determine which one to use.\n\nInstallations found:\n${installList}\n\nPlease navigate to the specific installation directory and try again.`,
      }),
    };
  }

  const installDir = allInstallations[0];

  // Run the skill download command
  try {
    await skillDownloadMain({
      skillSpec,
      cwd,
      installDir,
      registryUrl,
      listVersions,
    });

    return {
      decision: "block",
      reason: formatSuccess({
        message: `Skill download command completed. Check the output above for details.`,
      }),
    };
  } catch (err) {
    return {
      decision: "block",
      reason: formatError({
        message: `Download failed: ${err instanceof Error ? err.message : String(err)}`,
      }),
    };
  }
};

/**
 * nori-skill-download intercepted slash command
 */
export const noriSkillDownload: InterceptedSlashCommand = {
  matchers: [
    "^\\/nori-skill-download\\s*$", // Bare command - shows help
    "^\\/nori-skill-download\\s+[a-z0-9-]+(?:@\\d+\\.\\d+\\.\\d+[^\\s]*)?(?:\\s+--registry\\s+https?:\\/\\/\\S+)?(?:\\s+--list-versions)?\\s*$",
    "^\\/nori-skill-download\\s+[a-z0-9-]+(?:@\\d+\\.\\d+\\.\\d+[^\\s]*)?(?:\\s+--list-versions)?(?:\\s+--registry\\s+https?:\\/\\/\\S+)?\\s*$",
  ],
  run,
};
