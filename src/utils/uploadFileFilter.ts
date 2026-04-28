/**
 * Filename predicate used by upload tarball builders to skip editor swap files,
 * OS junk, and Nori-local download metadata so that those files do not
 * contribute to the registry's content hash.
 */

import * as path from "path";

const EXACT_EXCLUDED_FILES = new Set([
  ".nori-version",
  ".DS_Store",
  "Thumbs.db",
]);

// Hidden vim swap files: .<name>.swp / .swo / .swn / etc.
const VIM_SWAP_PATTERN = /^\..+\.sw[a-p]$/;

// macOS AppleDouble resource forks: ._<name>
const APPLEDOUBLE_PATTERN = /^\._.+/;

/**
 * Whether a file should be excluded from upload tarballs.
 *
 * @param args - The function arguments
 * @param args.fileName - The file name. A full path is accepted; only the
 *   basename is matched against the exclusion patterns.
 *
 * @returns true if the file should be skipped during tarball construction
 */
export const shouldExcludeFromUpload = (args: {
  fileName: string;
}): boolean => {
  const baseName = path.basename(args.fileName);

  if (EXACT_EXCLUDED_FILES.has(baseName)) {
    return true;
  }

  if (VIM_SWAP_PATTERN.test(baseName)) {
    return true;
  }

  if (APPLEDOUBLE_PATTERN.test(baseName)) {
    return true;
  }

  if (baseName.length > 1 && baseName.endsWith("~")) {
    return true;
  }

  return false;
};
