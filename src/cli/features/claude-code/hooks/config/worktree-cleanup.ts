#!/usr/bin/env node

/**
 * Hook handler for warning about excessive git worktree disk usage
 *
 * This script is called by Claude Code SessionStart hook.
 * It checks if worktrees are consuming >50GB or if disk space is <10% free,
 * and prompts the user about cleanup.
 */

import { execSync } from "child_process";

import { error } from "@/cli/logger.js";

// Thresholds
const WORKTREE_SIZE_THRESHOLD_GB = 50;
const DISK_SPACE_LOW_PERCENT = 10;

// Convert GB to bytes
const GB_TO_BYTES = 1024 * 1024 * 1024;

/**
 * Output hook result with additionalContext for SessionStart hooks
 * This injects context into the Claude session that the model can see
 * @param args - Configuration arguments
 * @param args.message - Message to add to Claude session context
 */
const logToClaudeSession = (args: { message: string }): void => {
  const { message } = args;

  const output = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: message,
    },
  };

  console.log(JSON.stringify(output));
};

/**
 * Check if a directory is inside a git repository
 * @param args - Configuration arguments
 * @param args.cwd - Current working directory to check
 *
 * @returns True if inside a git repository
 */
const isInsideGitRepo = (args: { cwd: string }): boolean => {
  const { cwd } = args;
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};

/**
 * Get the root directory of the git repository
 * @param args - Configuration arguments
 * @param args.cwd - Current working directory
 *
 * @returns Git root path or null if not in a git repo
 */
const getGitRoot = (args: { cwd: string }): string | null => {
  const { cwd } = args;
  try {
    const root = execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf-8",
    });
    return root.trim();
  } catch {
    return null;
  }
};

/**
 * Worktree information
 */
type WorktreeInfo = {
  path: string;
  branch: string | null;
  sizeBytes: number;
};

/**
 * List all git worktrees (excluding the main worktree)
 * @param args - Configuration arguments
 * @param args.gitRoot - Root directory of the git repository
 *
 * @returns Array of worktree information objects
 */
const listWorktrees = (args: { gitRoot: string }): Array<WorktreeInfo> => {
  const { gitRoot } = args;

  try {
    const output = execSync("git worktree list --porcelain", {
      cwd: gitRoot,
      encoding: "utf-8",
    });

    const worktrees: Array<WorktreeInfo> = [];
    const records = output.trim().split("\n\n");

    // Skip first record (main worktree)
    for (let i = 1; i < records.length; i++) {
      const record = records[i];
      if (!record.trim()) continue;

      const lines = record.split("\n");
      let worktreePath = "";
      let branch: string | null = null;

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          worktreePath = line.substring(9);
        } else if (line.startsWith("branch ")) {
          // Extract branch name from refs/heads/xxx
          const branchRef = line.substring(7);
          branch = branchRef.replace("refs/heads/", "");
        }
      }

      if (worktreePath) {
        worktrees.push({
          path: worktreePath,
          branch,
          sizeBytes: 0, // Will be calculated later
        });
      }
    }

    return worktrees;
  } catch {
    return [];
  }
};

/**
 * Get the size of a directory in bytes using du
 * @param args - Configuration arguments
 * @param args.dirPath - Path to the directory
 *
 * @returns Size in bytes
 */
const getDirectorySize = (args: { dirPath: string }): number => {
  const { dirPath } = args;

  try {
    // du -sk gives size in kilobytes, summarized
    const output = execSync(`du -sk "${dirPath}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"], // suppress stderr
    });

    const sizeKb = parseInt(output.split("\t")[0], 10);
    return sizeKb * 1024; // Convert to bytes
  } catch {
    return 0;
  }
};

/**
 * Disk space information
 */
type DiskSpaceInfo = {
  totalBytes: number;
  availableBytes: number;
  usedPercent: number;
};

/**
 * Get disk space information for a path
 * @param args - Configuration arguments
 * @param args.dirPath - Path to check disk space for
 *
 * @returns Disk space info or null on error
 */
const getDiskSpace = (args: { dirPath: string }): DiskSpaceInfo | null => {
  const { dirPath } = args;

  try {
    // df -Pk gives POSIX format in kilobytes
    const output = execSync(`df -Pk "${dirPath}"`, {
      encoding: "utf-8",
    });

    const lines = output.trim().split("\n");
    if (lines.length < 2) return null;

    // Parse the output (skip header)
    // Format: Filesystem 1K-blocks Used Available Use% Mounted
    const parts = lines[1].split(/\s+/);

    const totalKb = parseInt(parts[1], 10);
    const availableKb = parseInt(parts[3], 10);
    const usedPercent = parseInt(parts[4].replace("%", ""), 10);

    return {
      totalBytes: totalKb * 1024,
      availableBytes: availableKb * 1024,
      usedPercent,
    };
  } catch {
    return null;
  }
};

/**
 * Format bytes to human readable string
 * @param args - Configuration arguments
 * @param args.bytes - Number of bytes to format
 *
 * @returns Human readable string (e.g., "1.5 GB")
 */
const formatBytes = (args: { bytes: number }): string => {
  const { bytes } = args;

  if (bytes >= GB_TO_BYTES) {
    return `${(bytes / GB_TO_BYTES).toFixed(1)} GB`;
  } else if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  } else if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} bytes`;
};

/**
 * Main entry point
 * @param args - Configuration arguments
 * @param args.cwd - Current working directory (optional)
 */
export const main = async (args?: { cwd?: string | null }): Promise<void> => {
  try {
    const cwd = args?.cwd ?? process.cwd();

    // Check if we're in a git repo
    if (!isInsideGitRepo({ cwd })) {
      return;
    }

    // Get git root
    const gitRoot = getGitRoot({ cwd });
    if (gitRoot == null) {
      return;
    }

    // List worktrees (excluding main)
    const worktrees = listWorktrees({ gitRoot });

    // No additional worktrees - nothing to warn about
    if (worktrees.length === 0) {
      return;
    }

    // Calculate sizes for each worktree
    let totalWorktreeSize = 0;
    for (const worktree of worktrees) {
      worktree.sizeBytes = getDirectorySize({ dirPath: worktree.path });
      totalWorktreeSize += worktree.sizeBytes;
    }

    // Get disk space info
    const diskSpace = getDiskSpace({ dirPath: gitRoot });
    const freePercent = diskSpace ? 100 - diskSpace.usedPercent : 100;
    const availableBytes = diskSpace?.availableBytes ?? 0;

    // Check thresholds
    const worktreeSizeExceeded =
      totalWorktreeSize > WORKTREE_SIZE_THRESHOLD_GB * GB_TO_BYTES;
    const diskSpaceLow = freePercent < DISK_SPACE_LOW_PERCENT;

    // No warning needed
    if (!worktreeSizeExceeded && !diskSpaceLow) {
      return;
    }

    // Build instructions for Claude
    let message =
      "⚠️ **Git Worktree Disk Usage Warning** - You MUST ask the user about this before proceeding with their request.\n\n";

    if (worktreeSizeExceeded) {
      message += `The user's git worktrees are using **${formatBytes({ bytes: totalWorktreeSize })}** of disk space (threshold: ${WORKTREE_SIZE_THRESHOLD_GB} GB).\n\n`;
    }

    if (diskSpaceLow) {
      message += `The user's disk space is running low: **${freePercent}%** remaining (${formatBytes({ bytes: availableBytes })} available).\n\n`;
    }

    message += "**Worktrees detected:**\n";
    for (const worktree of worktrees) {
      const branchInfo = worktree.branch ? ` (${worktree.branch})` : "";
      message += `- ${worktree.path}${branchInfo}: ${formatBytes({ bytes: worktree.sizeBytes })}\n`;
    }

    message +=
      "\n**ACTION REQUIRED:** Before proceeding with any other task, ask the user if they would like you to help clean up some of these worktrees to free up disk space. Use `git worktree remove <path>` to remove worktrees after confirming with the user.";

    // Output to Claude session
    logToClaudeSession({ message });
  } catch (err) {
    // Silent failure - don't interrupt session startup
    error({
      message: `Worktree cleanup warning: Error (non-fatal): ${err}`,
    });
  }
};

// Export for testing
export { logToClaudeSession };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    error({
      message: `Worktree cleanup warning: Unhandled error (non-fatal): ${err}`,
    });
    process.exit(0); // Always exit 0 to not disrupt session
  });
}
