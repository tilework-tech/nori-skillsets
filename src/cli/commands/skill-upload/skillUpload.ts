/**
 * CLI command for uploading skill packages to the Nori registrar
 * Handles: nori-ai skill-upload <skill>[@version] [--registry <url>]
 */

import * as fs from "fs/promises";
import * as path from "path";

import * as semver from "semver";
import * as tar from "tar";

import { registrarApi, REGISTRAR_URL } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import {
  getCommandNames,
  type CliName,
} from "@/cli/commands/cliCommandNames.js";
import {
  checkRegistryAgentSupport,
  showCursorAgentNotSupportedError,
} from "@/cli/commands/registryAgentCheck.js";
import { getRegistryAuth } from "@/cli/config.js";
import { getNoriSkillsDir } from "@/cli/features/claude-code/paths.js";
import { error, success, info, newline } from "@/cli/logger.js";
import { getInstallDirs } from "@/utils/path.js";

import type { RegistryAuth } from "@/cli/config.js";
import type { Command } from "commander";

/**
 * Parse skill name and optional version from skill spec
 * Supports formats: "skill-name" or "skill-name@1.0.0"
 * @param args - The parsing parameters
 * @param args.skillSpec - Skill specification string
 *
 * @returns Parsed skill name and optional version
 */
const parseSkillSpec = (args: {
  skillSpec: string;
}): { skillName: string; version?: string | null } => {
  const { skillSpec } = args;
  const match = skillSpec.match(/^([a-z0-9-]+)(?:@(\d+\.\d+\.\d+.*))?$/i);

  if (!match) {
    return { skillName: skillSpec, version: null };
  }

  return {
    skillName: match[1],
    version: match[2] ?? null,
  };
};

/**
 * Parse SKILL.md frontmatter to extract description
 * @param args - The parsing parameters
 * @param args.content - The SKILL.md file content
 *
 * @returns The description if found, undefined otherwise
 */
const parseSkillMdFrontmatter = (args: {
  content: string;
}): string | undefined => {
  const { content } = args;

  // Check if content starts with frontmatter delimiter
  if (!content.startsWith("---")) {
    return undefined;
  }

  // Find the closing delimiter
  const endIndex = content.indexOf("---", 3);
  if (endIndex === -1) {
    return undefined;
  }

  const frontmatter = content.substring(3, endIndex);

  // Simple YAML parsing for description field
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
  if (descMatch) {
    return descMatch[1].trim();
  }

  return undefined;
};

/**
 * Create a gzipped tarball from a skill directory
 * @param args - The tarball parameters
 * @param args.skillDir - The directory to create tarball from
 *
 * @returns The tarball data as Buffer
 */
const createSkillTarball = async (args: {
  skillDir: string;
}): Promise<Buffer> => {
  const { skillDir } = args;

  // Get list of files in skill directory
  const files = await fs.readdir(skillDir, { recursive: true });
  const filesToPack: Array<string> = [];

  for (const file of files) {
    const filePath = path.join(skillDir, file);
    const stat = await fs.stat(filePath);
    if (stat.isFile()) {
      filesToPack.push(file);
    }
  }

  // Use tar.create with file option then read it
  const tempTarPath = path.join(
    skillDir,
    "..",
    `.${path.basename(skillDir)}-upload.tgz`,
  );

  try {
    await tar.create(
      {
        gzip: true,
        file: tempTarPath,
        cwd: skillDir,
      },
      filesToPack,
    );

    const tarballBuffer = await fs.readFile(tempTarPath);
    return tarballBuffer;
  } finally {
    // Clean up temp file
    await fs.unlink(tempTarPath).catch(() => {
      /* ignore */
    });
  }
};

/**
 * Format error message when multiple registries are available
 * @param args - The function arguments
 * @param args.skillName - The skill name to upload
 * @param args.registries - The available registries
 * @param args.cliName - The CLI name for command hints
 *
 * @returns Formatted error message
 */
const formatMultipleRegistriesError = (args: {
  skillName: string;
  registries: Array<RegistryAuth>;
  cliName?: CliName | null;
}): string => {
  const { skillName, registries, cliName } = args;
  const commandNames = getCommandNames({ cliName });
  const cliPrefix = cliName ?? "nori-ai";

  const lines = [
    "Multiple registries configured. Please specify which registry to upload to.\n",
    "Available registries:",
  ];

  for (const registry of registries) {
    lines.push(`  -> ${registry.registryUrl}`);
  }

  lines.push("\nTo upload, specify the registry with --registry:");
  for (const registry of registries) {
    lines.push(
      `${cliPrefix} ${commandNames.uploadSkill} ${skillName} --registry ${registry.registryUrl}`,
    );
  }

  return lines.join("\n");
};

/**
 * Determine the version to upload
 * If no version is specified, auto-bump from the latest version in the registry
 * If the skill doesn't exist, default to 1.0.0
 * @param args - The function arguments
 * @param args.skillName - The skill name to upload
 * @param args.explicitVersion - The explicit version if provided by user
 * @param args.registryUrl - The registry URL to check
 * @param args.authToken - The auth token for the registry
 *
 * @returns The version to upload
 */
const determineUploadVersion = async (args: {
  skillName: string;
  explicitVersion?: string | null;
  registryUrl: string;
  authToken: string;
}): Promise<string> => {
  const { skillName, explicitVersion, registryUrl, authToken } = args;

  // If user provided explicit version, use it
  if (explicitVersion != null) {
    return explicitVersion;
  }

  // Try to get the current latest version from the registry
  try {
    const packument = await registrarApi.getSkillPackument({
      skillName,
      registryUrl,
      authToken,
    });

    const latestVersion = packument["dist-tags"].latest;
    if (latestVersion != null && semver.valid(latestVersion) != null) {
      // Auto-bump patch version
      const nextVersion = semver.inc(latestVersion, "patch");
      if (nextVersion != null) {
        return nextVersion;
      }
    }
  } catch {
    // Skill doesn't exist or error fetching - default to 1.0.0
  }

  return "1.0.0";
};

/**
 * Upload a skill to the registrar
 * @param args - The upload parameters
 * @param args.skillSpec - Skill name with optional version (e.g., "my-skill" or "my-skill@1.0.0")
 * @param args.cwd - Current working directory (defaults to process.cwd())
 * @param args.installDir - Optional explicit install directory
 * @param args.registryUrl - Optional registry URL to upload to
 * @param args.cliName - CLI name for user-facing messages (nori-ai or seaweed)
 */
export const skillUploadMain = async (args: {
  skillSpec: string;
  cwd?: string | null;
  installDir?: string | null;
  registryUrl?: string | null;
  cliName?: CliName | null;
}): Promise<void> => {
  const { skillSpec, installDir, registryUrl, cliName } = args;
  const cwd = args.cwd ?? process.cwd();
  const commandNames = getCommandNames({ cliName });
  const cliPrefix = cliName ?? "nori-ai";

  const { skillName, version } = parseSkillSpec({ skillSpec });

  // Find installation directory
  let targetInstallDir: string;

  if (installDir != null) {
    targetInstallDir = installDir;
  } else {
    const allInstallations = getInstallDirs({ currentDir: cwd });

    if (allInstallations.length === 0) {
      error({
        message: "No Nori installation found.",
      });
      info({
        message: "Run 'npx nori-ai install' to install Nori Profiles.",
      });
      return;
    }

    if (allInstallations.length > 1) {
      const installList = allInstallations
        .map((dir, index) => `${index + 1}. ${dir}`)
        .join("\n");

      error({
        message: `Found multiple Nori installations. Cannot determine which one to use.\n\nInstallations found:\n${installList}\n\nPlease use --install-dir to specify the target installation.`,
      });
      return;
    }

    targetInstallDir = allInstallations[0];
  }

  // Check if cursor-agent-only installation (not supported for registry commands)
  const agentCheck = await checkRegistryAgentSupport({
    installDir: targetInstallDir,
  });
  if (!agentCheck.supported) {
    showCursorAgentNotSupportedError();
    return;
  }

  // Use config from agentCheck (already loaded during support check)
  const config = agentCheck.config;

  const skillsDir = getNoriSkillsDir({ installDir: targetInstallDir });
  const skillDir = path.join(skillsDir, skillName);

  // Check if skill exists
  try {
    await fs.access(skillDir);
  } catch {
    error({
      message: `Skill "${skillName}" not found at:\n${skillDir}`,
    });
    return;
  }

  // Check if skill has SKILL.md
  const skillMdPath = path.join(skillDir, "SKILL.md");
  let skillMdContent: string;
  try {
    skillMdContent = await fs.readFile(skillMdPath, "utf-8");
  } catch {
    error({
      message: `Skill "${skillName}" is missing SKILL.md file.\n\nA valid skill must have a SKILL.md file at:\n${skillMdPath}`,
    });
    return;
  }

  // Extract description from frontmatter (optional)
  const description = parseSkillMdFrontmatter({ content: skillMdContent });

  // Get available registries - public registry (with unified auth) and legacy registryAuths
  const availableRegistries: Array<RegistryAuth> = [];

  // Add public registry if user has valid unified auth with refreshToken
  // This is the default target for authenticated users
  if (config?.auth != null && config.auth.refreshToken != null) {
    availableRegistries.push({
      registryUrl: REGISTRAR_URL,
      username: config.auth.username,
      refreshToken: config.auth.refreshToken,
    });
  }

  // Add legacy registryAuths entries (for private registries)
  if (config?.registryAuths != null) {
    for (const auth of config.registryAuths) {
      // Avoid duplicates if the same registry URL already exists
      const alreadyExists = availableRegistries.some(
        (existing) => existing.registryUrl === auth.registryUrl,
      );
      if (!alreadyExists) {
        availableRegistries.push(auth);
      }
    }
  }

  if (availableRegistries.length === 0) {
    error({
      message: `No registry authentication configured.\n\nEither log in with 'nori-ai install' or add registry credentials to .nori-config.json:\n{\n  "registryAuths": [{\n    "username": "your-email@example.com",\n    "password": "your-password",\n    "registryUrl": "https://registry.example.com"\n  }]\n}`,
    });
    return;
  }

  // Determine target registry
  let targetRegistryUrl: string;
  let registryAuth: RegistryAuth | null;

  if (registryUrl != null) {
    // User specified a registry URL - check availableRegistries first (includes public registry)
    registryAuth =
      availableRegistries.find((r) => r.registryUrl === registryUrl) ?? null;

    // Fall back to getRegistryAuth for legacy registryAuths
    if (registryAuth == null && config != null) {
      registryAuth = getRegistryAuth({ config, registryUrl });
    }

    if (registryAuth == null) {
      error({
        message: `No registry authentication configured for ${registryUrl}.\n\nAdd credentials to .nori-config.json or use one of the configured registries.`,
      });
      return;
    }
    targetRegistryUrl = registryUrl;
  } else if (availableRegistries.length === 1) {
    // Single registry - use it
    registryAuth = availableRegistries[0];
    targetRegistryUrl = registryAuth.registryUrl;
  } else {
    // Multiple registries - require explicit selection
    error({
      message: formatMultipleRegistriesError({
        skillName,
        registries: availableRegistries,
        cliName,
      }),
    });
    return;
  }

  // Get auth token
  let authToken: string;
  try {
    authToken = await getRegistryAuthToken({ registryAuth });
  } catch (err) {
    error({
      message: `Authentication failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  // Determine version to upload (auto-bump if not specified)
  const uploadVersion = await determineUploadVersion({
    skillName,
    explicitVersion: version,
    registryUrl: targetRegistryUrl,
    authToken,
  });

  // Create tarball and upload
  try {
    info({ message: `Uploading skill "${skillName}@${uploadVersion}"...` });

    const tarballBuffer = await createSkillTarball({ skillDir });
    // Convert Buffer to ArrayBuffer
    const archiveData = new ArrayBuffer(tarballBuffer.byteLength);
    new Uint8Array(archiveData).set(tarballBuffer);

    const result = await registrarApi.uploadSkill({
      skillName,
      version: uploadVersion,
      archiveData,
      description,
      authToken,
      registryUrl: targetRegistryUrl,
    });

    newline();
    success({
      message: `Successfully uploaded "${skillName}@${result.version}" to ${targetRegistryUrl}`,
    });
    newline();
    info({
      message: `Others can install it with '${cliPrefix} ${commandNames.downloadSkill} ${skillName}'.`,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error({
      message: `Failed to upload skill "${skillName}": ${errorMessage}`,
    });
  }
};

/**
 * Register the 'skill-upload' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerSkillUploadCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("skill-upload <skill>")
    .description("Upload a skill package to the Nori registrar")
    .option(
      "--registry <url>",
      "Upload to a specific registry URL instead of the default",
    )
    .action(async (skillSpec: string, options: { registry?: string }) => {
      const globalOpts = program.opts();

      await skillUploadMain({
        skillSpec,
        installDir: globalOpts.installDir || null,
        registryUrl: options.registry || null,
      });
    });
};
