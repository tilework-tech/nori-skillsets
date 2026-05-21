/**
 * Clear-Current Command
 *
 * Walks from the current directory up to the filesystem root and removes
 * all Nori-managed configuration from every directory where a skillset
 * is detected.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { log } from "@clack/prompts";

import { getDefaultAgents, loadConfig } from "@/cli/config.js";
import {
  isInstalledAtDir,
  removeSkillset,
} from "@/cli/features/agentOperations.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";

export const clearCurrentMain = async (args?: {
  dir?: string | null;
}): Promise<void> => {
  const { dir } = args ?? {};
  const startDir = path.resolve(dir ?? process.cwd());

  const config = await loadConfig();
  const agentNames = getDefaultAgents({ config });
  const agents = agentNames.map((name) =>
    AgentRegistry.getInstance().get({ name }),
  );

  const clearedDirs = new Set<string>();
  let currentDir = startDir;

  while (true) {
    for (const agentImpl of agents) {
      if (isInstalledAtDir({ agent: agentImpl, path: currentDir })) {
        await removeSkillset({ agent: agentImpl, installDir: currentDir });
        // removeSkillset relies on a global per-agent manifest to remove the
        // marker. When clearing multiple directories, the manifest is consumed
        // by the first call, so explicitly clean up the marker for subsequent ones.
        const markerPath = path.join(
          agentImpl.getAgentDir({ installDir: currentDir }),
          ".nori-managed",
        );
        await fs.rm(markerPath, { force: true });
        clearedDirs.add(currentDir);
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  if (clearedDirs.size === 0) {
    log.info("No Nori-managed configuration found in current directory tree.");
    return;
  }

  log.success(
    `Cleared Nori-managed configuration from ${clearedDirs.size} location${clearedDirs.size === 1 ? "" : "s"}.`,
  );
};
