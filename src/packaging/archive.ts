/**
 * Package archive primitives.
 *
 * The single owner of tarball creation, extraction, and gzip sniffing for
 * skillset/skill/subagent packages. Commands must use these instead of
 * hand-rolling tar pipelines.
 */

import * as fs from "fs/promises";
import { createHash } from "node:crypto";
import * as path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import * as zlib from "zlib";

import * as tar from "tar";

import {
  collectCargoManifestDirs,
  shouldExcludeFromUpload,
} from "@/utils/uploadFileFilter.js";

/**
 * Check if buffer starts with gzip magic bytes (0x1f 0x8b)
 *
 * @param args - The check parameters
 * @param args.buffer - The buffer to check
 *
 * @returns True if the buffer is gzip compressed
 */
export const isGzipped = (args: { buffer: Buffer }): boolean => {
  const { buffer } = args;
  return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
};

/**
 * Extract a tarball (gzipped or plain) into an existing directory.
 *
 * @param args - The extraction parameters
 * @param args.tarballData - The tarball data as ArrayBuffer
 * @param args.targetDir - The directory to extract to
 */
export const extractArchive = async (args: {
  tarballData: ArrayBuffer;
  targetDir: string;
}): Promise<void> => {
  const { tarballData, targetDir } = args;

  const buffer = Buffer.from(tarballData);
  const readable = Readable.from(buffer);

  if (isGzipped({ buffer })) {
    await pipeline(
      readable,
      zlib.createGunzip(),
      tar.extract({ cwd: targetDir }),
    );
  } else {
    await pipeline(readable, tar.extract({ cwd: targetDir }));
  }
};

const collectArchiveFilePaths = async (args: {
  ancestorRealDirs: ReadonlySet<string>;
  dir: string;
  excludedRealPaths: ReadonlyArray<string>;
  relativeDir: string;
}): Promise<Array<string>> => {
  const { ancestorRealDirs, dir, excludedRealPaths, relativeDir } = args;
  const realDir = await fs.realpath(dir);
  if (ancestorRealDirs.has(realDir)) {
    return [];
  }

  const nextAncestorRealDirs = new Set(ancestorRealDirs);
  nextAncestorRealDirs.add(realDir);

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: Array<string> = [];

  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    const relativePath = path.join(relativeDir, entry.name);
    if (shouldExcludeFromUpload({ relativePath })) {
      continue;
    }
    const realPath = await fs.realpath(absolutePath).catch(() => null);
    if (
      realPath == null ||
      realPath
        .split(path.sep)
        .some((segment) => segment.toLowerCase() === ".git") ||
      excludedRealPaths.some((excludedPath) => {
        const relativeToExcluded = path.relative(excludedPath, realPath);
        return (
          relativeToExcluded === "" ||
          (!path.isAbsolute(relativeToExcluded) &&
            relativeToExcluded !== ".." &&
            !relativeToExcluded.startsWith(`..${path.sep}`))
        );
      })
    ) {
      continue;
    }
    const stat = await fs.stat(absolutePath).catch(() => null);
    if (stat == null) {
      continue;
    }
    if (stat.isDirectory()) {
      files.push(
        ...(await collectArchiveFilePaths({
          ancestorRealDirs: nextAncestorRealDirs,
          dir: absolutePath,
          excludedRealPaths,
          relativeDir: relativePath,
        })),
      );
      continue;
    }
    if (stat.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
};

const findNearestGitEntry = async (args: {
  sourceDir: string;
}): Promise<string | null> => {
  let currentDir = await fs.realpath(args.sourceDir);
  while (true) {
    const candidate = path.join(currentDir, ".git");
    if ((await fs.lstat(candidate).catch(() => null)) != null) {
      return candidate;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
};

const resolveGitMetadataRealPaths = async (args: {
  sourceDir: string;
}): Promise<Array<string>> => {
  const dotGitPath = await findNearestGitEntry(args);
  if (dotGitPath == null) {
    return [];
  }
  const dotGitRealPath = await fs.realpath(dotGitPath).catch(() => null);
  if (dotGitRealPath == null) {
    return [];
  }

  const excludedPaths = [dotGitRealPath];
  const stat = await fs.stat(dotGitPath).catch(() => null);
  if (stat?.isFile() !== true) {
    return excludedPaths;
  }

  const pointer = await fs.readFile(dotGitPath, "utf-8").catch(() => null);
  const gitDir = pointer?.match(/^gitdir:\s*(.+?)\s*$/i)?.[1];
  if (gitDir == null) {
    return excludedPaths;
  }

  const gitDirRealPath = await fs
    .realpath(path.resolve(path.dirname(dotGitPath), gitDir))
    .catch(() => null);
  if (gitDirRealPath == null) {
    return excludedPaths;
  }

  excludedPaths.push(gitDirRealPath);
  const commonDir = await fs
    .readFile(path.join(gitDirRealPath, "commondir"), "utf-8")
    .catch(() => null);
  if (commonDir != null && commonDir.trim() !== "") {
    const commonDirRealPath = await fs
      .realpath(path.resolve(gitDirRealPath, commonDir.trim()))
      .catch(() => null);
    if (commonDirRealPath != null) {
      excludedPaths.push(commonDirRealPath);
    }
  }
  return excludedPaths;
};

/**
 * Create a gzipped tarball of a package source directory.
 *
 * Packs every file (following symlinks, so linked skillsets work) except
 * paths excluded by the upload filter (node_modules, build output, etc.).
 * Uses a temporary .tgz next to the source dir and always cleans it up.
 *
 * @param args - The function arguments
 * @param args.sourceDir - The package directory to pack
 *
 * @returns The tarball as a Buffer
 */
export const createArchive = async (args: {
  sourceDir: string;
}): Promise<Buffer> => {
  const { sourceDir } = args;
  const excludedRealPaths = await resolveGitMetadataRealPaths({ sourceDir });

  const relPaths = await collectArchiveFilePaths({
    ancestorRealDirs: new Set(),
    dir: sourceDir,
    excludedRealPaths,
    relativeDir: "",
  });
  const cargoManifestDirs = collectCargoManifestDirs({
    relativePaths: relPaths,
  });

  const filesToPack = relPaths.filter(
    (relativePath) =>
      !shouldExcludeFromUpload({ relativePath, cargoManifestDirs }),
  );

  const tempTarPath = path.join(
    sourceDir,
    "..",
    `.${path.basename(sourceDir)}-upload.tgz`,
  );

  try {
    await tar.create(
      { gzip: true, file: tempTarPath, cwd: sourceDir, follow: true },
      filesToPack,
    );
    return await fs.readFile(tempTarPath);
  } finally {
    await fs.unlink(tempTarPath).catch(() => undefined);
  }
};

/**
 * Compute a tarball checksum in the registry's format
 * (`sha512-<base64 digest>`, matching what the registrar records as
 * `dist.shasum` in packuments).
 *
 * @param args - Arguments
 * @param args.tarballData - The tarball data
 *
 * @returns The prefixed base64 sha512 digest
 */
export const computeArchiveShasum = (args: {
  tarballData: ArrayBuffer;
}): string => {
  const { tarballData } = args;
  const digest = createHash("sha512")
    .update(Buffer.from(tarballData))
    .digest("base64");
  return `sha512-${digest}`;
};

/**
 * Verify a downloaded tarball against the checksum the registry recorded.
 * Fails loudly on mismatch; skips silently when the registry recorded none.
 *
 * @param args - Arguments
 * @param args.tarballData - The downloaded tarball data
 * @param args.expectedShasum - The packument's dist.shasum, when present
 *
 * @throws Error when the tarball does not hash to the expected checksum
 */
export const verifyArchiveChecksum = (args: {
  tarballData: ArrayBuffer;
  expectedShasum?: string | null;
}): void => {
  const { tarballData, expectedShasum } = args;
  if (expectedShasum == null || expectedShasum === "") {
    return;
  }
  const actual = computeArchiveShasum({ tarballData });
  if (actual !== expectedShasum) {
    throw new Error(
      `Checksum mismatch: registry recorded ${expectedShasum} but the downloaded archive hashes to ${actual}. ` +
        `The download may be corrupt — retry, and if it persists report it to the registry operator.`,
    );
  }
};

/**
 * Extract a named file from an in-memory tarball (optionally gzipped).
 *
 * @param args - Arguments
 * @param args.tarballData - Raw tarball data (gzipped or plain tar)
 * @param args.fileName - File name to extract (matches both `SKILL.md` and `./SKILL.md`)
 *
 * @returns File contents as string, or null if the file is not in the tarball
 */
export const extractFileFromArchive = async (args: {
  tarballData: ArrayBuffer;
  fileName: string;
}): Promise<string | null> => {
  const { tarballData, fileName } = args;
  const buffer = Buffer.from(tarballData);
  const readable = Readable.from(buffer);

  let foundContent: string | null = null;

  const parser = new tar.Parser();
  parser.on("entry", (entry) => {
    const entryPath = entry.path.replace(/^\.\//, "");
    if (entryPath === fileName) {
      const chunks: Array<Buffer> = [];
      entry.on("data", (chunk: Buffer) => chunks.push(chunk));
      entry.on("end", () => {
        foundContent = Buffer.concat(chunks).toString("utf-8");
      });
    } else {
      entry.resume();
    }
  });

  if (isGzipped({ buffer })) {
    await pipeline(readable, zlib.createGunzip(), parser);
  } else {
    await pipeline(readable, parser);
  }

  return foundContent;
};
