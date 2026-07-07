/**
 * Atomic directory replacement for package installs and updates.
 *
 * The single owner of the extract-to-temp / backup / swap / restore dance.
 * Every install or update path must go through one of these so a failure
 * mid-operation never leaves a package directory partially destroyed.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { extractArchive } from "./archive.js";
import { VERSION_FILE } from "./provenance.js";

/**
 * Extract an archive into a directory that does not exist yet.
 * On extraction failure the created directory is removed.
 *
 * @param args - Arguments
 * @param args.tarballData - The tarball data
 * @param args.targetDir - Directory to create and extract into
 */
export const extractArchiveToNewDir = async (args: {
  tarballData: ArrayBuffer;
  targetDir: string;
}): Promise<void> => {
  const { tarballData, targetDir } = args;
  await fs.mkdir(targetDir, { recursive: true });
  try {
    await extractArchive({ tarballData, targetDir });
  } catch (extractErr) {
    await fs.rm(targetDir, { recursive: true, force: true });
    throw extractErr;
  }
};

/**
 * Atomically replace an existing directory with an archive's contents.
 *
 * Extracts to a temp sibling, renames the target to a backup, renames the
 * temp into place, then removes the backup. On any failure the original
 * directory is restored and temp state is cleaned up.
 *
 * @param args - Arguments
 * @param args.tarballData - The tarball data
 * @param args.targetDir - Existing directory to replace
 * @param args.preserveVersionFile - Copy the old dir's .nori-version into the new contents
 */
export const atomicReplaceDirWithArchive = async (args: {
  tarballData: ArrayBuffer;
  targetDir: string;
  preserveVersionFile?: boolean | null;
}): Promise<void> => {
  const { tarballData, targetDir, preserveVersionFile } = args;
  const parentDir = path.dirname(targetDir);
  const baseName = path.basename(targetDir);
  const tempDir = path.join(parentDir, `.${baseName}-download-temp`);
  const backupDir = path.join(parentDir, `.${baseName}-backup`);

  await fs.mkdir(tempDir, { recursive: true });
  try {
    await extractArchive({ tarballData, targetDir: tempDir });
  } catch (extractErr) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw extractErr;
  }

  try {
    await fs.rename(targetDir, backupDir);
    await fs.rename(tempDir, targetDir);

    if (preserveVersionFile) {
      const backupVersionFile = path.join(backupDir, VERSION_FILE);
      try {
        await fs.access(backupVersionFile);
        await fs.copyFile(
          backupVersionFile,
          path.join(targetDir, VERSION_FILE),
        );
      } catch {
        // No .nori-version in backup
      }
    }

    await fs.rm(backupDir, { recursive: true, force: true });
  } catch (swapErr) {
    try {
      await fs.access(backupDir);
      await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {
        // Target may not exist
      });
      await fs.rename(backupDir, targetDir);
    } catch {
      // Restore failed — backup was never created
    }
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {
      // Temp may not exist
    });
    throw swapErr;
  }
};

/**
 * Atomically replace a directory's contents with an archive while keeping
 * selected top-level entries from the existing directory (and discarding
 * those same entries if the archive carries them).
 *
 * Used for skillset updates, which must keep locally-managed skills/,
 * subagents/, and .nori-version.
 *
 * @param args - Arguments
 * @param args.tarballData - The tarball data
 * @param args.targetDir - Existing directory to update
 * @param args.preserveEntries - Top-level entry names to keep from the old dir
 */
export const replaceDirContentsWithArchive = async (args: {
  tarballData: ArrayBuffer;
  targetDir: string;
  preserveEntries: ReadonlyArray<string>;
}): Promise<void> => {
  const { tarballData, targetDir, preserveEntries } = args;
  const parentDir = path.dirname(targetDir);
  const baseName = path.basename(targetDir);
  const tempDir = path.join(parentDir, `.${baseName}-download-temp`);
  const backupDir = path.join(parentDir, `.${baseName}-backup`);

  await fs.mkdir(tempDir, { recursive: true });
  try {
    await extractArchive({ tarballData, targetDir: tempDir });

    // Discard the archive's copies of preserved entries, then carry over the
    // existing directory's versions of them.
    for (const entry of preserveEntries) {
      await fs.rm(path.join(tempDir, entry), { recursive: true, force: true });
      const existingPath = path.join(targetDir, entry);
      try {
        await fs.access(existingPath);
        await fs.cp(existingPath, path.join(tempDir, entry), {
          recursive: true,
        });
      } catch {
        // Entry not present in the existing dir
      }
    }
  } catch (extractErr) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw extractErr;
  }

  try {
    await fs.rename(targetDir, backupDir);
    await fs.rename(tempDir, targetDir);
    await fs.rm(backupDir, { recursive: true, force: true });
  } catch (swapErr) {
    try {
      await fs.access(backupDir);
      await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {
        // Target may not exist
      });
      await fs.rename(backupDir, targetDir);
    } catch {
      // Restore failed — backup was never created
    }
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {
      // Temp may not exist
    });
    throw swapErr;
  }
};
