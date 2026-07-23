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

const isGitMetadataEntry = async (args: {
  dir: string;
  entryName: string;
}): Promise<boolean> => {
  const { dir, entryName } = args;
  if (entryName === ".git") return true;
  if (entryName.toLowerCase() !== ".git") return false;

  const [entryRealPath, dotGitRealPath] = await Promise.all([
    fs.realpath(path.join(dir, entryName)).catch(() => null),
    fs.realpath(path.join(dir, ".git")).catch(() => null),
  ]);
  return entryRealPath != null && entryRealPath === dotGitRealPath;
};

const resolveArchiveSource = async (args: {
  sourceDir: string;
}): Promise<string> => {
  let unresolvedPath = path.resolve(args.sourceDir);
  const visitedSymlinks = new Set<string>();

  while (true) {
    const parsedPath = path.parse(unresolvedPath);
    const segments = unresolvedPath
      .slice(parsedPath.root.length)
      .split(path.sep)
      .filter((segment) => segment.length > 0);
    let resolvedPath = parsedPath.root;
    let followedSymlink = false;

    for (let index = 0; index < segments.length; index++) {
      const entryName = segments[index];
      const entryPath = path.join(resolvedPath, entryName);
      if (await isGitMetadataEntry({ dir: resolvedPath, entryName })) {
        throw new Error(
          `Upload archive source cannot be inside Git metadata: ${entryPath}`,
        );
      }

      const stat = await fs.lstat(entryPath);
      if (!stat.isSymbolicLink()) {
        resolvedPath = entryPath;
        continue;
      }

      if (visitedSymlinks.has(entryPath)) {
        throw new Error(
          `Upload archive source contains a symbolic link cycle: ${args.sourceDir}`,
        );
      }
      visitedSymlinks.add(entryPath);
      const linkTarget = await fs.readlink(entryPath);
      unresolvedPath = path.resolve(
        resolvedPath,
        linkTarget,
        ...segments.slice(index + 1),
      );
      followedSymlink = true;
      break;
    }

    if (!followedSymlink) {
      return await fs.realpath(resolvedPath);
    }
  }
};

const collectArchiveFilePaths = async (args: {
  dir: string;
  relativeDir: string;
}): Promise<Array<string>> => {
  const { dir, relativeDir } = args;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const hasCargoManifest = entries.some(
    (entry) => entry.name === "Cargo.toml" && entry.isFile(),
  );
  const files: Array<string> = [];

  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    const relativePath = path.join(relativeDir, entry.name);
    if (await isGitMetadataEntry({ dir, entryName: entry.name })) {
      continue;
    }
    if (shouldExcludeFromUpload({ relativePath })) {
      continue;
    }
    if (hasCargoManifest && entry.name === "target" && entry.isDirectory()) {
      continue;
    }
    const stat = await fs.lstat(absolutePath);
    if (stat.isSymbolicLink()) {
      throw new Error(
        `Upload archives cannot contain symbolic links: ${relativePath}`,
      );
    }
    if (stat.isDirectory()) {
      files.push(
        ...(await collectArchiveFilePaths({
          dir: absolutePath,
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

const inspectArchiveSource = async (args: {
  sourceDir: string;
}): Promise<{ resolvedSourceDir: string; relPaths: Array<string> }> => {
  const resolvedSourceDir = await resolveArchiveSource(args);
  const relPaths = await collectArchiveFilePaths({
    dir: resolvedSourceDir,
    relativeDir: "",
  });
  return { resolvedSourceDir, relPaths };
};

/**
 * Validate that a package source contains no upload-eligible symbolic links.
 * The package root itself may be linked; it is resolved before validation.
 *
 * @param args - The function arguments
 * @param args.sourceDir - The package directory to validate
 */
export const validateArchiveSource = async (args: {
  sourceDir: string;
}): Promise<void> => {
  await inspectArchiveSource(args);
};

/**
 * Create a gzipped tarball of a package source directory.
 *
 * Resolves a linked package root, then packs regular files except paths
 * excluded by the upload filter (Git metadata, build output, etc.).
 * Upload-eligible symbolic links below the package root are rejected.
 * Produces the archive in memory without writing beside the source directory.
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
  const { resolvedSourceDir, relPaths } = await inspectArchiveSource({
    sourceDir,
  });
  const cargoManifestDirs = collectCargoManifestDirs({
    relativePaths: relPaths,
  });

  const filesToPack = relPaths.filter(
    (relativePath) =>
      !shouldExcludeFromUpload({ relativePath, cargoManifestDirs }),
  );

  let packedSymlinkPath: string | null = null;
  const archiveStream = tar.create(
    {
      cwd: resolvedSourceDir,
      filter: (entryPath, stat) => {
        if ("isSymbolicLink" in stat && stat.isSymbolicLink()) {
          packedSymlinkPath = entryPath;
          return false;
        }
        return true;
      },
      follow: false,
      gzip: true,
      noDirRecurse: true,
      strict: true,
    },
    filesToPack.map((relativePath) => `./${relativePath}`),
  );
  const chunks: Array<Buffer> = [];
  for await (const chunk of archiveStream) {
    chunks.push(Buffer.from(chunk));
  }
  if (packedSymlinkPath != null) {
    throw new Error(
      `Upload archives cannot contain symbolic links: ${packedSymlinkPath}`,
    );
  }
  return Buffer.concat(chunks);
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
