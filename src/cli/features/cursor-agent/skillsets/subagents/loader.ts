/**
 * Subagents feature loader for Cursor
 * Registers all Nori subagents with Cursor
 */

import * as fs from "fs/promises";
import * as path from "path";

import { log, note } from "@clack/prompts";

import { type Config } from "@/cli/config.js";
import {
  getCursorDir,
  getCursorAgentsDir,
} from "@/cli/features/cursor-agent/paths.js";
import { substituteTemplatePaths } from "@/cli/features/template.js";
import { bold } from "@/cli/logger.js";

import type { CursorProfileLoader } from "@/cli/features/cursor-agent/skillsets/skillsetLoaderRegistry.js";
import type { Skillset } from "@/cli/features/skillset.js";

/**
 * Register all subagents for Cursor
 *
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 * @param args.skillset - Parsed skillset
 */
const registerSubagents = async (args: {
  config: Config;
  skillset: Skillset;
}): Promise<void> => {
  const { config, skillset } = args;

  const configDir = skillset.subagentsDir;
  const cursorAgentsDir = getCursorAgentsDir({
    installDir: config.installDir,
  });

  // Remove existing agents directory if it exists, then recreate
  await fs.rm(cursorAgentsDir, { recursive: true, force: true });
  await fs.mkdir(cursorAgentsDir, { recursive: true });

  const registered: Array<string> = [];
  const skipped: Array<string> = [];

  if (configDir == null) {
    log.warn("Skillset subagents directory not found, skipping");
    return;
  }
  let files: Array<string>;
  try {
    files = await fs.readdir(configDir);
  } catch {
    log.warn("Skillset subagents directory not found, skipping");
    return;
  }
  const mdFiles = files.filter(
    (file) => file.endsWith(".md") && file !== "docs.md",
  );

  for (const file of mdFiles) {
    const subagentSrc = path.join(configDir, file);
    const subagentDest = path.join(cursorAgentsDir, file);
    const subagentName = file.replace(/\.md$/, "");

    try {
      await fs.access(subagentSrc);
      const content = await fs.readFile(subagentSrc, "utf-8");
      const cursorDir = getCursorDir({ installDir: config.installDir });
      const substituted = substituteTemplatePaths({
        content,
        installDir: cursorDir,
      });
      await fs.writeFile(subagentDest, substituted);
      registered.push(subagentName);
    } catch {
      skipped.push(subagentName);
    }
  }

  if (registered.length > 0) {
    const lines = registered.map((name) => `✓ ${name}`);
    const summary = bold({
      text: `Registered ${registered.length} subagent${registered.length === 1 ? "" : "s"}`,
    });
    lines.push("", summary);
    note(lines.join("\n"), "Cursor Subagents");
  }
  if (skipped.length > 0) {
    log.warn(
      `Skipped ${skipped.length} subagent${
        skipped.length === 1 ? "" : "s"
      } (not found): ${skipped.join(", ")}`,
    );
  }
};

/**
 * Subagents feature loader for Cursor
 */
export const subagentsLoader: CursorProfileLoader = {
  name: "subagents",
  description: "Register all Nori subagents with Cursor",
  install: async (args: { config: Config; skillset: Skillset }) => {
    const { config, skillset } = args;
    await registerSubagents({ config, skillset });
  },
};
