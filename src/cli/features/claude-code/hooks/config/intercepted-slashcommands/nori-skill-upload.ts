/**
 * Intercepted slash command for uploading skills to the registry
 * Handles /nori-skill-upload <skill-name> [version] [registry-url] command
 */

import { skillUploadMain } from "@/cli/commands/skill-upload/skillUpload.js";
import { getInstallDirs } from "@/utils/path.js";

import type {
  HookInput,
  HookOutput,
  InterceptedSlashCommand,
} from "./types.js";

import { formatError, formatSuccess } from "./format.js";

/**
 * Parse skill name, optional version, and optional registry URL from prompt
 * Supports formats:
 *   - "skill-name"
 *   - "skill-name version"
 *   - "skill-name registry-url"
 *   - "skill-name version registry-url"
 * @param prompt - The user prompt to parse
 *
 * @returns Parsed upload args or null if invalid
 */
const parseUploadArgs = (
  prompt: string,
): {
  skillName: string;
  version?: string | null;
  registryUrl?: string | null;
} | null => {
  const match = prompt
    .trim()
    .match(
      /^\/nori-skill-upload\s+([a-z0-9-]+)(?:\s+(\d+\.\d+\.\d+[^\s]*))?(?:\s+(https?:\/\/\S+))?$/i,
    );

  if (!match) {
    return null;
  }

  return {
    skillName: match[1],
    version: match[2] ?? null,
    registryUrl: match[3] ?? null,
  };
};

/**
 * Run the nori-skill-upload command
 * @param args - The function arguments
 * @param args.input - The hook input containing prompt and cwd
 *
 * @returns The hook output with upload result, or null if not handled
 */
const run = async (args: { input: HookInput }): Promise<HookOutput | null> => {
  const { input } = args;
  const { prompt, cwd } = input;

  // Parse upload args from prompt
  const uploadArgs = parseUploadArgs(prompt);
  if (uploadArgs == null) {
    return {
      decision: "block",
      reason: formatSuccess({
        message: `Upload a skill to the Nori registry.\n\nUsage: /nori-skill-upload <skill-name> [version] [registry-url]\n\nExamples:\n  /nori-skill-upload my-skill\n  /nori-skill-upload my-skill 1.0.0\n  /nori-skill-upload my-skill https://registry.example.com\n  /nori-skill-upload my-skill 1.0.0 https://registry.example.com\n\nRequires registry authentication in .nori-config.json`,
      }),
    };
  }

  const { skillName, version, registryUrl } = uploadArgs;

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

  // Build skill spec (name@version if version provided)
  const skillSpec = version != null ? `${skillName}@${version}` : skillName;

  // Run the skill upload command
  try {
    await skillUploadMain({
      skillSpec,
      cwd,
      installDir,
      registryUrl,
    });

    return {
      decision: "block",
      reason: formatSuccess({
        message: `Skill upload command completed. Check the output above for details.`,
      }),
    };
  } catch (err) {
    return {
      decision: "block",
      reason: formatError({
        message: `Upload failed: ${err instanceof Error ? err.message : String(err)}`,
      }),
    };
  }
};

/**
 * nori-skill-upload intercepted slash command
 */
export const noriSkillUpload: InterceptedSlashCommand = {
  matchers: [
    "^\\/nori-skill-upload\\s*$", // Bare command - shows help
    "^\\/nori-skill-upload\\s+[a-z0-9-]+(?:\\s+\\d+\\.\\d+\\.\\d+[^\\s]*)?(?:\\s+https?:\\/\\/\\S+)?\\s*$", // With args (skill, optional version, optional registry)
    "^\\/nori-skill-upload\\s+[a-z0-9-]+\\s+https?:\\/\\/\\S+\\s*$", // With skill and registry URL (no version)
  ],
  run,
};
