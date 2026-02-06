/**
 * Factory reset for Claude Code agent
 * Discovers and removes all Claude Code configuration from the ancestor directory tree
 */

import * as fs from "fs/promises";
import * as path from "path";

import { info, warn, success, newline } from "@/cli/logger.js";
import { promptText } from "@/cli/prompts/text.js";

export type ClaudeCodeArtifact = {
  path: string;
  type: "directory" | "file";
};

/**
 * Walk up the ancestor tree from startDir and find all .claude directories
 * and CLAUDE.md files.
 *
 * @param args - Configuration arguments
 * @param args.startDir - Directory to start searching from
 * @param args.stopDir - Directory to stop searching at (inclusive). If null, climbs to filesystem root.
 *
 * @returns Array of artifacts found, ordered from startDir upward
 */
export const findClaudeCodeArtifacts = async (args: {
  startDir: string;
  stopDir?: string | null;
}): Promise<Array<ClaudeCodeArtifact>> => {
  const { startDir, stopDir } = args;
  const artifacts: Array<ClaudeCodeArtifact> = [];

  let currentDir = startDir;
  let previousDir = "";

  while (currentDir !== previousDir) {
    // Check for .claude directory
    const claudeDir = path.join(currentDir, ".claude");
    try {
      const stat = await fs.stat(claudeDir);
      if (stat.isDirectory()) {
        artifacts.push({ path: claudeDir, type: "directory" });
      }
    } catch {
      // Does not exist, continue
    }

    // Check for CLAUDE.md file
    const claudeMd = path.join(currentDir, "CLAUDE.md");
    try {
      const stat = await fs.stat(claudeMd);
      if (stat.isFile()) {
        artifacts.push({ path: claudeMd, type: "file" });
      }
    } catch {
      // Does not exist, continue
    }

    // Stop if we've reached the stop directory
    if (stopDir != null && currentDir === stopDir) {
      break;
    }

    previousDir = currentDir;
    currentDir = path.dirname(currentDir);
  }

  return artifacts;
};

/**
 * Factory reset Claude Code: discover all configuration artifacts in the
 * ancestor tree and delete them after user confirmation.
 *
 * @param args - Configuration arguments
 * @param args.path - Directory to start searching from
 */
export const factoryResetClaudeCode = async (args: {
  path: string;
}): Promise<void> => {
  const artifacts = await findClaudeCodeArtifacts({ startDir: args.path });

  if (artifacts.length === 0) {
    info({ message: "No Claude Code configuration found." });
    return;
  }

  newline();
  warn({ message: "The following Claude Code configuration will be deleted:" });
  newline();

  for (const artifact of artifacts) {
    const label = artifact.type === "directory" ? "[dir] " : "[file]";
    warn({ message: `  ${label} ${artifact.path}` });
  }

  newline();

  const answer = await promptText({
    message: "Type 'confirm' to proceed with factory reset",
  });

  if (answer !== "confirm") {
    info({ message: "Factory reset cancelled." });
    return;
  }

  for (const artifact of artifacts) {
    if (artifact.type === "directory") {
      await fs.rm(artifact.path, { recursive: true, force: true });
    } else {
      await fs.rm(artifact.path, { force: true });
    }
  }

  newline();
  success({
    message:
      "Factory reset complete. All Claude Code configuration has been removed.",
  });
};
