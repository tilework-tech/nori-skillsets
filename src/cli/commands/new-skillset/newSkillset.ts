/**
 * New skillset command
 *
 * Creates a new empty skillset folder under ~/.nori/profiles/ with nori.json.
 */

import * as fs from "fs/promises";
import { execFileSync } from "node:child_process";
import * as path from "path";

import { log, note } from "@clack/prompts";

import { loadConfig } from "@/cli/config.js";
import { bold } from "@/cli/logger.js";
import { newSkillsetFlow } from "@/cli/prompts/flows/newSkillset.js";
import { validateNamespacedSkillsetName } from "@/cli/prompts/validators.js";
import { namespaceCreateSkillsetName } from "@/cli/skillsetResolution.js";
import { writeSkillsetMetadata, type NoriJson } from "@/norijson/nori.js";
import {
  resolveSkillsetDir,
  skillsetCreateDir,
  skillsetIdentity,
} from "@/norijson/skillset.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";
import type { NewSkillsetFlowResult } from "@/cli/prompts/flows/newSkillset.js";

const GITIGNORE_CONTENT = `# Nori-local state
.nori-version
.nori-managed
.nori/
.nori-config.json
.nori-installed-version
`;

const GIT_ROUTING_ENVIRONMENT_VARIABLES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_INDEX_FILE",
] as const;

const gitEnvironment = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  for (const variable of GIT_ROUTING_ENVIRONMENT_VARIABLES) {
    delete env[variable];
  }
  return env;
};

const initializeGitRepository = (args: { dir: string }): void => {
  const { dir } = args;
  try {
    execFileSync("git", ["init", "--quiet", "--template="], {
      cwd: dir,
      env: gitEnvironment(),
      stdio: "pipe",
    });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new Error("Git is not installed or is not available on PATH");
    }

    const stderr =
      error instanceof Error && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr ?? "").trim()
        : "";
    const detail =
      stderr || (error instanceof Error ? error.message : String(error));
    throw new Error(`Failed to initialize Git repository: ${detail}`);
  }
};

/**
 * Create the directory and nori.json for a new skillset.
 *
 * This is the manifest-only creation logic used by the `--new` flag on
 * `nori-skillsets external`. Callers are responsible for validation (e.g.
 * checking the directory does not already exist) and any user-facing
 * messaging beyond what this function does. The `new` command uses its own
 * transactional path because it also initializes Git.
 *
 * @param args - The function arguments
 * @param args.destPath - Absolute path to the new skillset directory
 * @param args.name - Skillset name (used as the `name` field in nori.json)
 */
export const createEmptySkillset = async (args: {
  destPath: string;
  name: string;
}): Promise<void> => {
  const { destPath, name } = args;

  // Create parent directory if needed (for namespaced profiles like org/name)
  const parentDir = path.dirname(destPath);
  await fs.mkdir(parentDir, { recursive: true });

  // Create the skillset directory
  await fs.mkdir(destPath);

  // Write nori.json (serves as the skillset marker for list-skillsets)
  await writeSkillsetMetadata({
    skillsetDir: destPath,
    metadata: {
      name: path.basename(name),
      version: "1.0.0",
      type: "skillset",
    },
  });
};

export const newSkillsetMain = async (
  args: { skillsetName?: string | null } = {},
): Promise<CommandStatus> => {
  const { skillsetName = null } = args;

  let flowResult: NewSkillsetFlowResult | null;
  if (skillsetName == null) {
    flowResult = await newSkillsetFlow();
  } else {
    const validationError = validateNamespacedSkillsetName({
      value: skillsetName,
    });
    if (validationError != null) {
      log.error(validationError);
      return {
        success: false,
        cancelled: false,
        message: validationError,
      };
    }
    flowResult = {
      name: skillsetName.trim(),
      description: null,
      license: null,
      keywords: null,
      version: null,
      repository: null,
      statusMessage: "Skillset metadata collected",
    };
  }

  if (flowResult == null) {
    // User cancelled
    return { success: false, cancelled: true, message: "" };
  }

  const { name, description, license, keywords, version, repository } =
    flowResult;

  // A bare name lands under the configured default org.
  const config = await loadConfig();
  const localName = namespaceCreateSkillsetName({
    name,
    defaultOrg: config?.defaultOrg,
  });
  const destPath = skillsetCreateDir({ name: localName });

  // Validate the name does not already resolve to an existing skillset
  // (in any bucket or the legacy flat location).
  if ((await resolveSkillsetDir({ name: localName })) != null) {
    log.error(
      `Skillset '${localName}' already exists. Choose a different name.`,
    );
    return {
      success: false,
      cancelled: false,
      message: `Skillset "${localName}" already exists`,
    };
  }

  // Build metadata object
  const metadata: NoriJson = {
    name: path.basename(localName),
    version: version ?? "1.0.0",
    type: "skillset",
  };

  if (description != null) {
    metadata.description = description;
  }

  if (license != null) {
    metadata.license = license;
  }

  if (keywords != null) {
    metadata.keywords = keywords;
  }

  if (repository != null) {
    metadata.repository = repository;
  }

  // Create parent directory if needed (for namespaced profiles like org/name)
  const parentDir = path.dirname(destPath);
  await fs.mkdir(parentDir, { recursive: true });

  // Create the skillset directory
  await fs.mkdir(destPath);

  try {
    await writeSkillsetMetadata({
      skillsetDir: destPath,
      metadata,
    });
    await fs.writeFile(path.join(destPath, ".gitignore"), GITIGNORE_CONTENT);
    initializeGitRepository({ dir: destPath });
  } catch (error) {
    await fs.rm(destPath, { recursive: true, force: true }).catch(() => {
      // Best-effort rollback; preserve the original creation error.
    });
    throw error;
  }

  const relLocation = skillsetIdentity({ dir: destPath });
  const nextSteps = [
    `To switch:  nori-skillsets switch ${relLocation}`,
    `To edit:    ~/.nori/profiles/${relLocation}/`,
  ].join("\n");
  note(nextSteps, "Next Steps");

  return {
    success: true,
    cancelled: false,
    message: `Created new skillset "${bold({ text: localName })}"`,
  };
};
