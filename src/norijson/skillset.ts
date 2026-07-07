/**
 * Skillset path utilities, type, parser, and discovery
 *
 * Provides agent-agnostic path helpers, the Skillset type describing a parsed
 * skillset directory, the parseSkillset parser, and listSkillsets for discovery.
 */

import * as fs from "fs/promises";
import * as path from "path";

import {
  ensureNoriJson,
  looksLikeSkillset,
  readSkillsetMetadata,
  type NoriJson,
} from "@/norijson/nori.js";
import { isDirentDirectory } from "@/utils/dirent.js";
import { getHomeDir } from "@/utils/home.js";

/**
 * Get the Nori directory path
 * Always returns ~/.nori (centralized location)
 *
 * @returns Absolute path to the .nori directory
 */
export const getNoriDir = (): string => {
  return path.join(getHomeDir(), ".nori");
};

/**
 * Get the Nori skillsets directory path
 * This is where all skillset templates are stored
 *
 * @returns Absolute path to the skillsets directory (~/.nori/profiles/)
 */
export const getNoriSkillsetsDir = (): string => {
  return path.join(getNoriDir(), "profiles");
};

/** Manifest file name used to identify valid skillsets */
export const MANIFEST_FILE = "nori.json";

/**
 * Storage bucket directories under profiles/. Bare skillset names are stored in
 * one of these buckets on disk while remaining bare in the user-facing identity:
 * locally created skillsets live in `personal/`, public-registrar skillsets live
 * in `public/`. Organization skillsets keep their visible `<orgId>/<name>`
 * namespace and are not bucketed. These names are reserved.
 */
export const PERSONAL_BUCKET = "personal";
export const PUBLIC_BUCKET = "public";

/**
 * Represents a parsed skillset directory structure.
 * Content-agnostic: maps to filesystem paths, not file contents.
 */
export type Skillset = {
  /** Skillset name (from nori.json or directory basename) */
  name: string;
  /** Absolute path to the skillset directory */
  dir: string;
  /** Parsed nori.json contents */
  metadata: NoriJson;
  /** Path to skills/ subdirectory, or null if it doesn't exist */
  skillsDir: string | null;
  /** Path to the root config file (e.g. AGENTS.md), or null if it doesn't exist */
  configFilePath: string | null;
  /** Path to slashcommands/ subdirectory, or null if it doesn't exist */
  slashcommandsDir: string | null;
  /** Path to subagents/ subdirectory, or null if it doesn't exist */
  subagentsDir: string | null;
  /** Path to mcp/ subdirectory, or null if it doesn't exist */
  mcpDir: string | null;
};

/**
 * Check if a path exists and is a directory
 * @param args - Function arguments
 * @param args.dirPath - The path to check
 *
 * @returns True if the path exists and is a directory
 */
const dirExists = async (args: { dirPath: string }): Promise<boolean> => {
  const { dirPath } = args;
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
};

/**
 * Check if a file exists
 * @param args - Function arguments
 * @param args.filePath - The path to check
 *
 * @returns True if the file exists
 */
const fileExists = async (args: { filePath: string }): Promise<boolean> => {
  const { filePath } = args;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Resolve a user-facing skillset name to its on-disk directory, or null if it
 * does not exist anywhere.
 *
 * A name containing a slash (e.g. `myorg/foo`, `public/foo`, `personal/foo`) is
 * treated as an explicit namespace and resolved directly. A bare name is
 * searched across storage buckets with precedence `personal/` -> `public/` ->
 * legacy flat `<name>`, so bare references keep working after the bucket
 * migration.
 *
 * @param args - Function arguments
 * @param args.name - The user-facing skillset name (bare or namespaced)
 *
 * @returns Absolute path to the resolved skillset directory, or null
 */
export const resolveSkillsetDir = async (args: {
  name: string;
}): Promise<string | null> => {
  const { name } = args;
  const root = getNoriSkillsetsDir();

  if (name.includes("/")) {
    const dir = path.join(root, ...name.split("/"));
    return (await dirExists({ dirPath: dir })) ? dir : null;
  }

  for (const bucket of [PERSONAL_BUCKET, PUBLIC_BUCKET]) {
    const candidate = path.join(root, bucket, name);
    if (await dirExists({ dirPath: candidate })) {
      return candidate;
    }
  }

  // The bucket directories themselves are not skillsets: a bare name equal to a
  // reserved bucket name must never resolve to the bucket root.
  if (name === PERSONAL_BUCKET || name === PUBLIC_BUCKET) {
    return null;
  }

  const legacy = path.join(root, name);
  return (await dirExists({ dirPath: legacy })) ? legacy : null;
};

/**
 * Compute the on-disk directory where a newly created local skillset should be
 * written. Bare names are placed in the `personal/` bucket; explicitly
 * namespaced names (containing a slash) are written at that namespace unchanged.
 *
 * @param args - Function arguments
 * @param args.name - The user-facing skillset name (bare or namespaced)
 *
 * @returns Absolute path to the directory to create
 */
export const skillsetCreateDir = (args: { name: string }): string => {
  const { name } = args;
  const root = getNoriSkillsetsDir();
  if (name.includes("/")) {
    return path.join(root, ...name.split("/"));
  }
  return path.join(root, PERSONAL_BUCKET, name);
};

/**
 * The user-facing identity of a skillset directory: its path relative to the
 * profiles root (e.g. `personal/foo`, `public/foo`, `myorg/foo`, or a bare
 * `foo` for a legacy flat profile).
 *
 * @param args - Function arguments
 * @param args.dir - Absolute path to the skillset directory
 *
 * @returns The namespaced identity
 */
export const skillsetIdentity = (args: { dir: string }): string => {
  return path.relative(getNoriSkillsetsDir(), args.dir);
};

// Bare skillset names that have already emitted a deprecation warning this
// process, so the warning fires at most once per name.
const warnedBareNames = new Set<string>();

/**
 * Resolve a user-supplied skillset reference to its on-disk directory and its
 * canonical namespaced identity. Emits a one-time deprecation warning when a
 * bare name was used to reach a bucketed (namespaced) skillset, since bare
 * references are deprecated in favour of the namespaced identity.
 *
 * @param args - Function arguments
 * @param args.name - The user-supplied skillset name (bare or namespaced)
 *
 * @returns The resolved directory and its namespaced identity, or null if the
 *   skillset does not exist
 */
export const resolveUserSkillsetRef = async (args: {
  name: string;
}): Promise<{ dir: string; identity: string } | null> => {
  const { name } = args;
  const dir = await resolveSkillsetDir({ name });
  if (dir == null) {
    return null;
  }
  const identity = skillsetIdentity({ dir });
  if (
    !name.includes("/") &&
    identity.includes("/") &&
    !warnedBareNames.has(name)
  ) {
    warnedBareNames.add(name);
    process.stderr.write(
      `nori: bare skillset name "${name}" is deprecated; use "${identity}".\n`,
    );
  }
  return { dir, identity };
};

/**
 * Parse a skillset directory into a Skillset object.
 *
 * Accepts either a skillsetName (resolved relative to ~/.nori/profiles/)
 * or a direct skillsetDir path.
 *
 * @param args - Either { skillsetName } or { skillsetDir }
 * @param args.skillsetName - Name of the skillset to resolve relative to ~/.nori/profiles/
 * @param args.skillsetDir - Direct absolute path to the skillset directory
 *
 * @throws Error if the directory doesn't exist or has no nori.json
 *
 * @returns Parsed Skillset object
 */
export const parseSkillset = async (args: {
  skillsetName?: string | null;
  skillsetDir?: string | null;
}): Promise<Skillset> => {
  const { skillsetName, skillsetDir: explicitDir } = args;
  const configFileNames = ["AGENTS.md", "CLAUDE.md"];

  let dir: string;
  if (explicitDir != null) {
    dir = explicitDir;
  } else {
    // Resolve across buckets. A null resolution is "not found" — never fall
    // back to a raw path.join, which could land on a bucket root directory.
    const resolved = await resolveSkillsetDir({ name: skillsetName! });
    if (resolved == null) {
      throw new Error(
        `Skillset directory not found: ${path.join(getNoriSkillsetsDir(), skillsetName!)}`,
      );
    }
    dir = resolved;
  }

  // Verify the directory exists
  if (!(await dirExists({ dirPath: dir }))) {
    throw new Error(`Skillset directory not found: ${dir}`);
  }

  // Ensure nori.json exists (backwards compat for legacy skillsets)
  await ensureNoriJson({ skillsetDir: dir });

  // Read metadata — throws if nori.json still doesn't exist
  const metadata = await readSkillsetMetadata({ skillsetDir: dir });

  const name = metadata.name ?? path.basename(dir);

  // Check for optional components
  const skillsDirPath = path.join(dir, "skills");
  const slashcommandsDirPath = path.join(dir, "slashcommands");
  const subagentsDirPath = path.join(dir, "subagents");
  const mcpDirPath = path.join(dir, "mcp");

  // Find config file: prefer AGENTS.md, fall back to CLAUDE.md
  let resolvedConfigFilePath: string | null = null;
  for (const fileName of configFileNames) {
    const candidate = path.join(dir, fileName);
    if (await fileExists({ filePath: candidate })) {
      resolvedConfigFilePath = candidate;
      break;
    }
  }

  const [hasSkills, hasSlashcommands, hasSubagents, hasMcp] = await Promise.all(
    [
      dirExists({ dirPath: skillsDirPath }),
      dirExists({ dirPath: slashcommandsDirPath }),
      dirExists({ dirPath: subagentsDirPath }),
      dirExists({ dirPath: mcpDirPath }),
    ],
  );

  return {
    name,
    dir,
    metadata,
    skillsDir: hasSkills ? skillsDirPath : null,
    configFilePath: resolvedConfigFilePath,
    slashcommandsDir: hasSlashcommands ? slashcommandsDirPath : null,
    subagentsDir: hasSubagents ? subagentsDirPath : null,
    mcpDir: hasMcp ? mcpDirPath : null,
  };
};

/**
 * List installed skillsets from the .nori/profiles/ directory
 *
 * Discovers both flat skillsets (e.g., "senior-swe") and namespaced skillsets
 * (e.g., "myorg/my-skillset"). A directory is considered a valid skillset if it
 * contains a nori.json file.
 *
 * @returns Sorted array of skillset names
 */
export type SkillsetEntry = {
  name: string;
  isLinked: boolean;
};

/**
 * Check whether a directory is a skillset without writing to it: it either
 * carries a nori.json or looks like a legacy skillset (config file or
 * skills/+subagents/). Listing is a read and must never mutate profiles.
 *
 * @param args - Function arguments
 * @param args.skillsetDir - Directory to check
 *
 * @returns True when the directory is a skillset
 */
const isSkillsetDir = async (args: {
  skillsetDir: string;
}): Promise<boolean> => {
  const { skillsetDir } = args;
  try {
    await fs.access(path.join(skillsetDir, MANIFEST_FILE));
    return true;
  } catch {
    return looksLikeSkillset({ skillsetDir });
  }
};

/**
 * List installed skillsets with metadata (linked status).
 *
 * Discovers both flat skillsets and namespaced skillsets.
 * Reports whether each entry is a symlink (linked) or a real directory.
 *
 * @returns Sorted array of skillset entries with metadata
 */
export const listSkillsetsWithMetadata = async (): Promise<
  Array<SkillsetEntry>
> => {
  const skillsetsDir = getNoriSkillsetsDir();
  const skillsets: Array<SkillsetEntry> = [];

  // Collect skillsets nested one level under a namespace directory. Namespace
  // directories are the storage buckets (`personal/`, `public/`) and org
  // namespaces (`<orgId>/`); their children surface under the namespaced
  // identity "<namespace>/<child>".
  const collectNested = async (args: {
    namespace: string;
    parentLinked: boolean;
  }): Promise<void> => {
    const { namespace, parentLinked } = args;
    const nsDir = path.join(skillsetsDir, namespace);
    let subEntries;
    try {
      subEntries = await fs.readdir(nsDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const subEntry of subEntries) {
      if (!(await isDirentDirectory({ parentDir: nsDir, entry: subEntry })))
        continue;
      const nestedDir = path.join(nsDir, subEntry.name);
      if (!(await isSkillsetDir({ skillsetDir: nestedDir }))) {
        continue;
      }
      skillsets.push({
        name: `${namespace}/${subEntry.name}`,
        isLinked: parentLinked || subEntry.isSymbolicLink(),
      });
    }
  };

  try {
    await fs.access(skillsetsDir);
    const entries = await fs.readdir(skillsetsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!(await isDirentDirectory({ parentDir: skillsetsDir, entry })))
        continue;

      const isLinked = entry.isSymbolicLink();
      const entryDir = path.join(skillsetsDir, entry.name);
      if (await isSkillsetDir({ skillsetDir: entryDir })) {
        // A skillset at the top level is a legacy flat (bare) profile.
        skillsets.push({ name: entry.name, isLinked });
      } else {
        // A namespace directory (personal/, public/, or an org): list its
        // children under their namespaced identity.
        await collectNested({ namespace: entry.name, parentLinked: isLinked });
      }
    }
  } catch {
    // Skillsets directory doesn't exist
  }

  return skillsets.sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * List installed skillsets from the .nori/profiles/ directory
 *
 * Discovers both flat skillsets (e.g., "senior-swe") and namespaced skillsets
 * (e.g., "myorg/my-skillset"). A directory is considered a valid skillset if it
 * contains a nori.json file.
 *
 * @returns Sorted array of skillset names
 */
export const listSkillsets = async (): Promise<Array<string>> => {
  const entries = await listSkillsetsWithMetadata();
  return entries.map((e) => e.name);
};
