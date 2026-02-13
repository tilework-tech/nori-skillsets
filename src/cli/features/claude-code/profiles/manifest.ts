/**
 * Manifest module for tracking installed files
 *
 * Provides functionality to:
 * - Hash files for change detection
 * - Create manifests of installed directories
 * - Compare current state against stored manifests
 */

import * as fs from "fs/promises";
import { createHash } from "node:crypto";
import * as path from "path";

import { getNoriDir } from "@/cli/features/claude-code/paths.js";

/**
 * Manifest file structure storing hashes of all installed files
 */
export type FileManifest = {
  version: 1;
  createdAt: string;
  profileName: string;
  files: Record<string, string>; // relative path -> SHA-256 hash
};

/**
 * Result of comparing a manifest against current directory state
 */
export type ManifestDiff = {
  modified: Array<string>; // files with different hashes
  added: Array<string>; // files in current dir but not in manifest
  deleted: Array<string>; // files in manifest but not on disk
};

const MANIFEST_FILENAME = "installed-manifest.json";

/**
 * Root-level files within ~/.claude/ that Nori manages.
 * Only these files are tracked in the manifest.
 */
export const MANAGED_FILES: ReadonlyArray<string> = [
  "CLAUDE.md",
  "settings.json",
  "nori-statusline.sh",
];

/**
 * Top-level directories within ~/.claude/ that Nori manages.
 * All files recursively within these directories are tracked in the manifest.
 */
export const MANAGED_DIRS: ReadonlyArray<string> = [
  "skills",
  "commands",
  "agents",
];

/**
 * Files to exclude from manifest tracking regardless of location.
 * These are metadata files that should not trigger "local changes detected" warnings.
 */
export const EXCLUDED_FILES: ReadonlyArray<string> = [
  ".nori-version",
  "nori.json",
];

const managedFileSet = new Set(MANAGED_FILES);
const managedDirSet = new Set(MANAGED_DIRS);
const excludedFileSet = new Set(EXCLUDED_FILES);

/**
 * Check if a relative path is within the Nori-managed whitelist
 *
 * @param args - Configuration arguments
 * @param args.relativePath - Relative path from the base directory
 *
 * @returns True if the path is managed by Nori
 */
const isManagedPath = (args: { relativePath: string }): boolean => {
  const { relativePath } = args;

  // Check if it's a managed root file
  if (managedFileSet.has(relativePath)) {
    return true;
  }

  // Check if it's under a managed directory
  const topDir = relativePath.split(path.sep)[0];
  return managedDirSet.has(topDir);
};

/**
 * Get the path to the manifest file
 *
 * @returns Absolute path to the manifest file
 */
export const getManifestPath = (): string => {
  const noriDir = getNoriDir();
  return path.join(noriDir, MANIFEST_FILENAME);
};

/**
 * Compute SHA-256 hash of a file
 *
 * @param args - Configuration arguments
 * @param args.filePath - Absolute path to the file
 *
 * @returns SHA-256 hash as hex string
 */
export const computeFileHash = async (args: {
  filePath: string;
}): Promise<string> => {
  const { filePath } = args;
  const content = await fs.readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
};

/**
 * Recursively collect all files in a directory
 *
 * When called at the top level (dir === baseDir), only includes files and
 * directories that are in the Nori-managed whitelist. Within whitelisted
 * directories, all files are collected recursively.
 *
 * @param args - Configuration arguments
 * @param args.dir - Directory to scan
 * @param args.baseDir - Base directory for relative paths
 *
 * @returns Array of relative file paths
 */
const collectFiles = async (args: {
  dir: string;
  baseDir: string;
}): Promise<Array<string>> => {
  const { dir, baseDir } = args;
  const files: Array<string> = [];
  const isTopLevel = dir === baseDir;

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      if (isTopLevel && !managedDirSet.has(entry.name)) {
        continue;
      }
      const subFiles = await collectFiles({ dir: fullPath, baseDir });
      files.push(...subFiles);
    } else if (entry.isFile()) {
      if (isTopLevel && !managedFileSet.has(entry.name)) {
        continue;
      }
      // Skip excluded files (like .nori-version and nori.json)
      if (excludedFileSet.has(entry.name)) {
        continue;
      }
      files.push(relativePath);
    }
  }

  return files;
};

/**
 * Compute a manifest for a directory
 *
 * Creates a manifest containing SHA-256 hashes of all files in the directory.
 *
 * @param args - Configuration arguments
 * @param args.dir - Directory to create manifest for
 * @param args.profileName - Name of the profile being installed
 *
 * @returns Manifest object with file hashes
 */
export const computeDirectoryManifest = async (args: {
  dir: string;
  profileName: string;
}): Promise<FileManifest> => {
  const { dir, profileName } = args;

  const files = await collectFiles({ dir, baseDir: dir });
  const fileHashes: Record<string, string> = {};

  for (const relativePath of files) {
    const fullPath = path.join(dir, relativePath);
    const hash = await computeFileHash({ filePath: fullPath });
    fileHashes[relativePath] = hash;
  }

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    profileName,
    files: fileHashes,
  };
};

/**
 * Write a manifest to disk
 *
 * @param args - Configuration arguments
 * @param args.manifestPath - Absolute path to write the manifest
 * @param args.manifest - Manifest to write
 */
export const writeManifest = async (args: {
  manifestPath: string;
  manifest: FileManifest;
}): Promise<void> => {
  const { manifestPath, manifest } = args;

  // Ensure parent directory exists
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
};

/**
 * Read a manifest from disk
 *
 * @param args - Configuration arguments
 * @param args.manifestPath - Absolute path to read the manifest from
 *
 * @returns Manifest object, or null if file doesn't exist
 */
export const readManifest = async (args: {
  manifestPath: string;
}): Promise<FileManifest | null> => {
  const { manifestPath } = args;

  try {
    const content = await fs.readFile(manifestPath, "utf-8");
    return JSON.parse(content) as FileManifest;
  } catch {
    return null;
  }
};

/**
 * Compare a manifest against the current state of a directory
 *
 * @param args - Configuration arguments
 * @param args.manifest - Previously stored manifest
 * @param args.currentDir - Directory to compare against
 *
 * @returns Diff showing modified, added, and deleted files
 */
export const compareManifest = async (args: {
  manifest: FileManifest;
  currentDir: string;
}): Promise<ManifestDiff> => {
  const { manifest, currentDir } = args;

  const modified: Array<string> = [];
  const added: Array<string> = [];
  const deleted: Array<string> = [];

  // Get current files
  const currentFiles = await collectFiles({
    dir: currentDir,
    baseDir: currentDir,
  });
  const currentFileSet = new Set(currentFiles);
  const manifestFileSet = new Set(Object.keys(manifest.files));

  // Check for modified and deleted files (only for managed paths)
  for (const [relativePath, expectedHash] of Object.entries(manifest.files)) {
    if (!isManagedPath({ relativePath })) {
      continue;
    }

    if (!currentFileSet.has(relativePath)) {
      deleted.push(relativePath);
      continue;
    }

    const fullPath = path.join(currentDir, relativePath);
    try {
      const currentHash = await computeFileHash({ filePath: fullPath });
      if (currentHash !== expectedHash) {
        modified.push(relativePath);
      }
    } catch {
      // File exists in set but can't be read - treat as deleted
      deleted.push(relativePath);
    }
  }

  // Check for added files
  for (const relativePath of currentFiles) {
    if (!manifestFileSet.has(relativePath)) {
      added.push(relativePath);
    }
  }

  return { modified, added, deleted };
};

/**
 * Check if a manifest diff indicates any changes
 *
 * @param diff - Manifest diff to check
 *
 * @returns True if there are any changes
 */
export const hasChanges = (diff: ManifestDiff): boolean => {
  return (
    diff.modified.length > 0 || diff.added.length > 0 || diff.deleted.length > 0
  );
};
