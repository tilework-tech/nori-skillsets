/**
 * Predicate used by upload tarball builders to skip editor swap files, OS junk,
 * Nori-local download metadata, and dependency/build "bloat" directories
 * (node_modules, .venv, and Rust target dirs) so that those files do not
 * contribute to the registry's content hash.
 */

import * as path from "path";

const EXACT_EXCLUDED_FILES = new Set([
  ".nori-version",
  ".DS_Store",
  "Thumbs.db",
]);

// Directory names that are excluded at any nesting depth.
const ANY_DEPTH_EXCLUDED_DIRS = new Set(["node_modules", ".venv"]);

// Hidden vim swap files: .<name>.swp / .swo / .swn / etc.
const VIM_SWAP_PATTERN = /^\..+\.sw[a-p]$/;

// macOS AppleDouble resource forks: ._<name>
const APPLEDOUBLE_PATTERN = /^\._.+/;

const splitSegments = (relativePath: string): Array<string> =>
  relativePath.split(/[/\\]/).filter((segment) => segment.length > 0);

/**
 * Collect the set of directories that contain a `Cargo.toml` manifest.
 *
 * The returned directory keys are forward-slash joined relative paths (the
 * empty string represents the repository root). A Rust `target/` directory is
 * only treated as build output when its parent directory is present in this
 * set.
 *
 * @param args - The function arguments
 * @param args.relativePaths - All relative file paths in the package
 *
 * @returns Set of directories (relative, forward-slash joined) holding a Cargo.toml
 */
export const collectCargoManifestDirs = (args: {
  relativePaths: ReadonlyArray<string>;
}): Set<string> => {
  const { relativePaths } = args;
  const dirs = new Set<string>();
  for (const relativePath of relativePaths) {
    const segments = splitSegments(relativePath);
    if (segments.length > 0 && segments[segments.length - 1] === "Cargo.toml") {
      dirs.add(segments.slice(0, -1).join("/"));
    }
  }
  return dirs;
};

/**
 * Whether a file should be excluded from upload tarballs.
 *
 * @param args - The function arguments
 * @param args.relativePath - The file's path relative to the package root.
 *   Both `/` and `\` separators are accepted.
 * @param args.cargoManifestDirs - Directories known to contain a Cargo.toml,
 *   as produced by {@link collectCargoManifestDirs}. Used to decide whether a
 *   `target/` directory is Rust build output. When omitted, no `target/`
 *   directory is excluded.
 *
 * @returns true if the file should be skipped during tarball construction
 */
export const shouldExcludeFromUpload = (args: {
  relativePath: string;
  cargoManifestDirs?: ReadonlySet<string> | null;
}): boolean => {
  const { relativePath } = args;
  const cargoManifestDirs = args.cargoManifestDirs ?? new Set<string>();

  const segments = splitSegments(relativePath);

  // Inspect non-terminal segments: a directory in the path, never the leaf file.
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    if (ANY_DEPTH_EXCLUDED_DIRS.has(segment)) {
      return true;
    }
    if (
      segment === "target" &&
      cargoManifestDirs.has(segments.slice(0, i).join("/"))
    ) {
      return true;
    }
  }

  const baseName = path.basename(relativePath);

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
