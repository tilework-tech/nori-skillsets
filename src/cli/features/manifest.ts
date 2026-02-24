/**
 * Manifest module for tracking installed files
 *
 * Agent-agnostic module that provides functionality to:
 * - Hash files for change detection
 * - Create manifests of installed directories
 * - Compare current state against stored manifests
 */

import * as fs from "fs/promises";
import { createHash } from "node:crypto";
import * as path from "path";

import { getNoriDir } from "@/cli/features/paths.js";

/**
 * Manifest file structure storing hashes of all installed files
 */
export type FileManifest = {
  version: 1;
  createdAt: string;
  skillsetName: string;
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

/**
 * Root-level files within the agent config directory that Nori manages.
 * Only these files are tracked in the manifest.
 * Callers MUST pass getManagedFiles({ agentConfig }) explicitly.
 */
const MANAGED_FILES: ReadonlyArray<string> = [];

/**
 * Top-level directories within the agent config directory that Nori manages.
 * All files recursively within these directories are tracked in the manifest.
 * Callers MUST pass getManagedDirs({ agentConfig }) explicitly.
 */
const MANAGED_DIRS: ReadonlyArray<string> = [];

/**
 * Files to exclude from manifest tracking regardless of location.
 * These are metadata files that should not trigger "local changes detected" warnings.
 */
export const EXCLUDED_FILES: ReadonlyArray<string> = [
  ".nori-version",
  "nori.json",
];

const excludedFileSet = new Set(EXCLUDED_FILES);

/**
 * Check if a relative path is within the Nori-managed whitelist
 *
 * @param args - Configuration arguments
 * @param args.relativePath - Relative path from the base directory
 * @param args.managedFiles - Set of managed root files
 * @param args.managedDirs - Set of managed directories
 *
 * @returns True if the path is managed by Nori
 */
const isManagedPath = (args: {
  relativePath: string;
  managedFiles: ReadonlySet<string>;
  managedDirs: ReadonlySet<string>;
}): boolean => {
  const { relativePath, managedFiles, managedDirs } = args;

  // Check if it's a managed root file
  if (managedFiles.has(relativePath)) {
    return true;
  }

  // Check if it's under a managed directory
  const topDir = relativePath.split(path.sep)[0];
  return managedDirs.has(topDir);
};

/**
 * Get the path to the per-agent manifest file
 *
 * @param args - Configuration arguments
 * @param args.agentName - Name of the agent
 *
 * @returns Absolute path to the manifest file
 */
export const getManifestPath = (args: { agentName: string }): string => {
  const { agentName } = args;
  return path.join(getNoriDir(), "manifests", `${agentName}.json`);
};

/**
 * Get the path to the legacy manifest file (for backwards-compatible fallback)
 *
 * @returns Absolute path to the legacy manifest file
 */
export const getLegacyManifestPath = (): string => {
  return path.join(getNoriDir(), "installed-manifest.json");
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
 * @param args.managedFiles - Set of managed root-level filenames
 * @param args.managedDirs - Set of managed directory names
 *
 * @returns Array of relative file paths
 */
const collectFiles = async (args: {
  dir: string;
  baseDir: string;
  managedFiles: ReadonlySet<string>;
  managedDirs: ReadonlySet<string>;
}): Promise<Array<string>> => {
  const { dir, baseDir, managedFiles, managedDirs } = args;
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
      if (isTopLevel && !managedDirs.has(entry.name)) {
        continue;
      }
      const subFiles = await collectFiles({
        dir: fullPath,
        baseDir,
        managedFiles,
        managedDirs,
      });
      files.push(...subFiles);
    } else if (entry.isFile()) {
      if (isTopLevel && !managedFiles.has(entry.name)) {
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
 * @param args.skillsetName - Name of the profile being installed
 * @param args.managedFiles - Optional list of managed root-level filenames (falls back to defaults)
 * @param args.managedDirs - Optional list of managed directory names (falls back to defaults)
 *
 * @returns Manifest object with file hashes
 */
export const computeDirectoryManifest = async (args: {
  dir: string;
  skillsetName: string;
  managedFiles?: ReadonlyArray<string> | null;
  managedDirs?: ReadonlyArray<string> | null;
}): Promise<FileManifest> => {
  const { dir, skillsetName } = args;
  const fileSet = new Set(args.managedFiles ?? MANAGED_FILES);
  const dirSet = new Set(args.managedDirs ?? MANAGED_DIRS);

  const files = await collectFiles({
    dir,
    baseDir: dir,
    managedFiles: fileSet,
    managedDirs: dirSet,
  });
  const fileHashes: Record<string, string> = {};

  for (const relativePath of files) {
    const fullPath = path.join(dir, relativePath);
    const hash = await computeFileHash({ filePath: fullPath });
    fileHashes[relativePath] = hash;
  }

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    skillsetName,
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
 * @param args.legacyManifestPath - Optional path to legacy manifest for fallback
 *
 * @returns Manifest object, or null if file doesn't exist
 */
export const readManifest = async (args: {
  manifestPath: string;
  legacyManifestPath?: string | null;
}): Promise<FileManifest | null> => {
  const { manifestPath, legacyManifestPath } = args;

  try {
    const content = await fs.readFile(manifestPath, "utf-8");
    return JSON.parse(content) as FileManifest;
  } catch {
    // Primary manifest not found, try legacy fallback
  }

  if (legacyManifestPath != null) {
    try {
      const content = await fs.readFile(legacyManifestPath, "utf-8");
      return JSON.parse(content) as FileManifest;
    } catch {
      // Legacy manifest not found either
    }
  }

  return null;
};

/**
 * Compare a manifest against the current state of a directory
 *
 * @param args - Configuration arguments
 * @param args.manifest - Previously stored manifest
 * @param args.currentDir - Directory to compare against
 * @param args.managedFiles - Optional list of managed root-level filenames (falls back to defaults)
 * @param args.managedDirs - Optional list of managed directory names (falls back to defaults)
 *
 * @returns Diff showing modified, added, and deleted files
 */
export const compareManifest = async (args: {
  manifest: FileManifest;
  currentDir: string;
  managedFiles?: ReadonlyArray<string> | null;
  managedDirs?: ReadonlyArray<string> | null;
}): Promise<ManifestDiff> => {
  const { manifest, currentDir } = args;
  const fileSet = new Set(args.managedFiles ?? MANAGED_FILES);
  const dirSet = new Set(args.managedDirs ?? MANAGED_DIRS);

  const modified: Array<string> = [];
  const added: Array<string> = [];
  const deleted: Array<string> = [];

  // Get current files
  const currentFiles = await collectFiles({
    dir: currentDir,
    baseDir: currentDir,
    managedFiles: fileSet,
    managedDirs: dirSet,
  });
  const currentFileSet = new Set(currentFiles);
  const manifestFileSet = new Set(Object.keys(manifest.files));

  // Check for modified and deleted files (only for managed paths)
  for (const [relativePath, expectedHash] of Object.entries(manifest.files)) {
    if (
      !isManagedPath({
        relativePath,
        managedFiles: fileSet,
        managedDirs: dirSet,
      })
    ) {
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
 * Remove all Nori-managed files from a directory using the manifest as a guide
 *
 * Reads the manifest to determine which files were installed, removes them,
 * cleans up empty managed directories, and removes the .nori-managed marker.
 * Files not in the manifest are preserved.
 *
 * @param args - Configuration arguments
 * @param args.agentDir - The agent's config directory to clean up
 * @param args.manifestPath - Path to the manifest file
 * @param args.managedDirs - Optional list of managed directory names (falls back to defaults)
 */
export const removeManagedFiles = async (args: {
  agentDir: string;
  manifestPath: string;
  managedDirs?: ReadonlyArray<string> | null;
}): Promise<void> => {
  const { agentDir, manifestPath } = args;
  const dirList = args.managedDirs ?? MANAGED_DIRS;

  const manifest = await readManifest({ manifestPath });

  if (manifest != null) {
    // Remove all files listed in the manifest
    for (const relativePath of Object.keys(manifest.files)) {
      const fullPath = path.join(agentDir, relativePath);
      await fs.rm(fullPath, { force: true });
    }

    // Remove the .nori-managed marker
    await fs.rm(path.join(agentDir, ".nori-managed"), { force: true });

    // Delete the manifest itself since it no longer reflects reality
    await fs.rm(manifestPath, { force: true });
  }

  // Remove excluded files (e.g. nori.json, .nori-version) from managed directories.
  // These files are not tracked in the manifest but should be cleaned up during removal.
  // This runs even without a manifest to handle orphaned metadata files.
  for (const dir of dirList) {
    const dirPath = path.join(agentDir, dir);
    await removeExcludedFiles({ dir: dirPath });
  }

  // Clean up empty managed directories (deepest first)
  for (const dir of dirList) {
    const dirPath = path.join(agentDir, dir);
    await removeEmptyDirs({ dir: dirPath });
  }
};

/**
 * Recursively remove excluded files from a directory tree
 *
 * Walks the directory and removes any files whose names match EXCLUDED_FILES.
 * This ensures metadata files like nori.json and .nori-version are cleaned up
 * during removal, even though they are not tracked in the manifest.
 *
 * @param args - Configuration arguments
 * @param args.dir - Directory to scan recursively
 */
const removeExcludedFiles = async (args: { dir: string }): Promise<void> => {
  const { dir } = args;

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await removeExcludedFiles({ dir: fullPath });
    } else if (entry.isFile() && excludedFileSet.has(entry.name)) {
      await fs.rm(fullPath, { force: true });
    }
  }
};

/**
 * Recursively remove empty directories from bottom up
 *
 * @param args - Configuration arguments
 * @param args.dir - Directory to check and remove if empty
 */
const removeEmptyDirs = async (args: { dir: string }): Promise<void> => {
  const { dir } = args;

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  // Recurse into subdirectories first
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await removeEmptyDirs({ dir: path.join(dir, entry.name) });
    }
  }

  // Re-read after potential subdirectory removal
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }

  if (entries.length === 0) {
    await fs.rmdir(dir);
  }
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
