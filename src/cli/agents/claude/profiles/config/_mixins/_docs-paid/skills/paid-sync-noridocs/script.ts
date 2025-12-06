#!/usr/bin/env node

/**
 * Sync Noridocs script - Sync all local docs.md files to server
 *
 * IMPORTANT: This file is BUNDLED during the build process.
 *
 * @see scripts/bundle-skills.ts - Bundler that creates standalone executables
 * @see src/cli/features/profiles/config/_mixins/_paid/skills/paid-recall/script.ts - Full bundling documentation
 */

import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import minimist from "minimist";

import { apiClient } from "@/api/index.js";
import { loadConfig, getDefaultProfile, isPaidInstall } from "@/cli/config.js";
import { getInstallDirs } from "@/utils/path.js";

/**
 * Interface for a found docs.md file
 */
type DocsFile = {
  absolutePath: string;
  content: string;
  filePath: string | null; // Extracted Path: field
};

/**
 * Interface for sync result
 */
type SyncResult = {
  file: string;
  success: boolean;
  error?: string;
};

/**
 * Show usage information
 */
const showUsage = (): void => {
  console.error(`Usage: node script.js [--delay=500] [--gitRepoUrl="https://..."]

Parameters:
  --delay       (optional) Milliseconds to wait between API calls (default: 500)
  --gitRepoUrl  (optional) Git repository URL to associate with all docs
                          Auto-detected from 'git remote get-url origin' if not provided

Examples:
  # Sync all docs with default settings
  node script.js

  # Sync with custom delay to avoid rate limits
  node script.js --delay=1000

  # Sync with git repository URL
  node script.js --gitRepoUrl="https://github.com/username/repo"

Description:
  Finds all Git-tracked docs.md files in the codebase and syncs them to the
  server-side noridocs system.

  Features:
  - Uses git ls-files to find all Git-tracked docs.md files
  - Automatically excludes untracked and gitignored files
  - Auto-detects Git remote URL from origin remote
  - Extracts Path: field from each file
  - Syncs to server with rate limiting
  - Reports success/failure summary`);
};

/**
 * Sleep for specified milliseconds
 *
 * @param args - Sleep arguments
 * @param args.ms - Milliseconds to sleep
 *
 * @returns Promise that resolves after sleep
 */
const sleep = (args: { ms: number }): Promise<void> => {
  const { ms } = args;
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Extract the Path: field from docs.md content
 *
 * @param args - Extraction arguments
 * @param args.content - File content to extract from
 *
 * @returns Extracted path or null if not found
 */
const extractPath = (args: { content: string }): string | null => {
  const { content } = args;
  const pathMatch = content.match(/^Path:\s*(.+)$/m);
  return pathMatch?.[1]?.trim() ?? null;
};

/**
 * Get the Git remote URL for the current repository
 *
 * @param args - Get remote URL arguments
 * @param args.cwd - Current working directory
 *
 * @returns Git remote URL or null if not found
 */
const getGitRemoteUrl = (args: { cwd: string }): string | null => {
  const { cwd } = args;
  try {
    const output = execSync("git remote get-url origin", {
      cwd,
      encoding: "utf-8",
    });
    return output.trim() || null;
  } catch {
    // No remote or git command failed
    return null;
  }
};

/**
 * Find all Git-tracked docs.md files
 *
 * @param args - Search arguments
 * @param args.cwd - Current working directory
 *
 * @returns Promise resolving to array of found docs.md files
 */
const findDocsFiles = async (args: {
  cwd: string;
}): Promise<Array<DocsFile>> => {
  const { cwd } = args;
  const results: Array<DocsFile> = [];

  try {
    // Use git ls-files to find all tracked docs.md files
    const output = execSync('git ls-files "**/docs.md" "docs.md"', {
      cwd,
      encoding: "utf-8",
    });

    const files = output
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);

    for (const relativePath of files) {
      const absolutePath = join(cwd, relativePath);
      const content = await readFile(absolutePath, "utf-8");
      const filePath = extractPath({ content });

      results.push({
        absolutePath,
        content,
        filePath,
      });
    }
  } catch (error) {
    // If git command fails (e.g., not in a git repo), return empty array
    if (error instanceof Error) {
      throw new Error(
        `Failed to find Git-tracked docs.md files: ${error.message}. ` +
          "Make sure you are in a Git repository.",
      );
    }
    throw error;
  }

  return results;
};

/**
 * Serialize an error to a human-readable string
 *
 * @param args - Serialization arguments
 * @param args.error - Error to serialize
 *
 * @returns Human-readable error string
 */
export const serializeError = (args: { error: unknown }): string => {
  const { error } = args;

  // Handle Error instances
  if (error instanceof Error) {
    return error.message;
  }

  // Handle null/undefined
  if (error == null) {
    return "Unknown error (null)";
  }

  // Handle strings
  if (typeof error === "string") {
    return error;
  }

  // Handle objects - try to extract useful info
  if (typeof error === "object") {
    try {
      // Try to format as JSON
      const jsonStr = JSON.stringify(error, null, 2);
      // If it's just "{}", try to be more helpful
      if (jsonStr === "{}") {
        return "Unknown error (empty object)";
      }
      return jsonStr;
    } catch {
      // JSON.stringify can fail on circular refs
      return `Error object (cannot serialize): ${String(error)}`;
    }
  }

  // Fallback for numbers, booleans, etc.
  return String(error);
};

/**
 * Sync a single docs.md file to the server
 *
 * @param args - Sync arguments
 * @param args.file - File to sync
 * @param args.gitRepoUrl - Optional git repository URL
 *
 * @returns Promise resolving to sync result
 */
const syncFile = async (args: {
  file: DocsFile;
  gitRepoUrl: string | null;
}): Promise<SyncResult> => {
  const { file, gitRepoUrl } = args;

  if (file.filePath == null) {
    return {
      file: file.absolutePath,
      success: false,
      error: "Missing Path: field in file header",
    };
  }

  try {
    // Try to update first, fallback to create
    try {
      const existing = await apiClient.noridocs.readByPath({
        filePath: file.filePath,
      });

      await apiClient.noridocs.update({
        id: existing.id,
        data: { content: file.content, gitRepoUrl },
      });
    } catch {
      // Create if doesn't exist
      await apiClient.noridocs.create({
        filePath: file.filePath,
        content: file.content,
        gitRepoUrl,
      });
    }

    return {
      file: file.absolutePath,
      success: true,
    };
  } catch (error) {
    return {
      file: file.absolutePath,
      success: false,
      error: serializeError({ error }),
    };
  }
};

/**
 * Main execution function
 */
export const main = async (): Promise<void> => {
  // 1. Find installation directory
  // ALWAYS use getInstallDirs to find installation directory
  const allInstallations = getInstallDirs({ currentDir: process.cwd() });

  if (allInstallations.length === 0) {
    // Fail loudly - no silent fallback
    console.error("Error: No Nori installation found.");
    process.exit(1);
  }

  const installDir = allInstallations[0]; // Use closest installation

  // 2. Check tier
  const existingConfig = await loadConfig({ installDir });
  const config = existingConfig ?? {
    profile: getDefaultProfile(),
    installDir,
  };

  if (!isPaidInstall({ config })) {
    console.error("Error: This feature requires a paid Nori subscription.");
    console.error("Please configure your credentials in ~/nori-config.json");
    process.exit(1);
  }

  // 3. Parse arguments
  const args = minimist(process.argv.slice(2));

  if (args.help || args.h) {
    showUsage();
    process.exit(0);
  }

  const delay = (args.delay as number | null) ?? 500;
  const cwd = process.cwd();

  // Auto-detect git remote URL if not provided
  const gitRepoUrl =
    (args.gitRepoUrl as string | null) ?? getGitRemoteUrl({ cwd });

  if (gitRepoUrl) {
    console.log(`Using Git repository: ${gitRepoUrl}\n`);
  }

  // 4. Find all Git-tracked docs.md files
  console.log("Searching for Git-tracked docs.md files...");
  const files = await findDocsFiles({ cwd });

  console.log(`Found ${files.length} docs.md file(s)\n`);

  if (files.length === 0) {
    console.log("No docs.md files found to sync");
    return;
  }

  // 5. Sync each file with rate limiting
  const results: Array<SyncResult> = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    console.log(
      `[${i + 1}/${files.length}] Syncing ${
        file.filePath ?? file.absolutePath
      }...`,
    );

    const result = await syncFile({ file, gitRepoUrl });
    results.push(result);

    if (result.success) {
      console.log(`  ✓ Success`);
    } else {
      console.log(`  ✗ Failed: ${result.error}`);
    }

    // Rate limiting: wait between calls (except after last one)
    if (i < files.length - 1) {
      await sleep({ ms: delay });
    }
  }

  // 6. Print summary
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log("\n" + "=".repeat(50));
  console.log("Sync Summary:");
  console.log(`  Total files: ${files.length}`);
  console.log(`  Successful: ${successful}`);
  console.log(`  Failed: ${failed}`);

  if (failed > 0) {
    console.log("\nFailed files:");
    results
      .filter((r) => !r.success)
      .forEach((r) => {
        console.log(`  - ${r.file}`);
        console.log(`    Error: ${r.error}`);
      });
  }

  console.log("=".repeat(50));

  // Exit with error code if any failed
  if (failed > 0) {
    process.exit(1);
  }
};

// Run main function if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: Error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}
