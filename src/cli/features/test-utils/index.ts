/**
 * Shared test utilities for consistent test patterns across the codebase.
 *
 * These utilities reduce code duplication and provide a standardized approach
 * to common test operations like ANSI stripping, file existence checks, and
 * temp directory management.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

/**
 * Strip ANSI escape codes from a string for plain text comparison.
 *
 * Note: This test utility uses a simple string parameter rather than named args
 * for ergonomics, since it's called frequently in test assertions.
 *
 * @param str - The string containing ANSI codes
 *
 * @returns The string with ANSI codes removed
 */
export const stripAnsi = (str: string): string => {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
};

/**
 * Check if a file or directory exists at the given path.
 *
 * @param args - The arguments object
 * @param args.filePath - The path to check
 *
 * @returns Promise resolving to true if the path exists, false otherwise
 */
export const pathExists = async (args: {
  filePath: string;
}): Promise<boolean> => {
  const { filePath } = args;
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
};

/**
 * Context object returned by createTempTestContext for managing test directories.
 */
export type TempTestContext = {
  /** The root temporary directory for this test */
  tempDir: string;
  /** The .claude directory within tempDir */
  claudeDir: string;
  /** Clean up the temporary directory after the test */
  cleanup: () => Promise<void>;
};

/**
 * Create a temporary test context with standardized directory structure.
 *
 * @param args - The arguments object
 * @param args.prefix - Prefix for the temp directory name (e.g., "profiles-test")
 *
 * @returns Promise resolving to a TempTestContext with tempDir, claudeDir, and cleanup function
 *
 * @example
 * ```typescript
 * let ctx: TempTestContext;
 *
 * beforeEach(async () => {
 *   ctx = await createTempTestContext({ prefix: "my-test" });
 * });
 *
 * afterEach(async () => {
 *   await ctx.cleanup();
 * });
 * ```
 */
export const createTempTestContext = async (args: {
  prefix: string;
}): Promise<TempTestContext> => {
  const { prefix } = args;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  const claudeDir = path.join(tempDir, ".claude");
  await fs.mkdir(claudeDir, { recursive: true });

  return {
    tempDir,
    claudeDir,
    cleanup: async () => fs.rm(tempDir, { recursive: true, force: true }),
  };
};
