/**
 * List active skillsets command for Nori Skillsets CLI
 * Discovers active skillsets in a directory and all parent directories
 * by reading .nori-managed marker files for all registered agents.
 */

import * as fsSync from "fs";
import * as path from "path";

import { log } from "@clack/prompts";

import { AgentRegistry } from "@/cli/features/agentRegistry.js";

export const findActiveSkillsets = async (args: {
  dir?: string | null;
}): Promise<Array<string>> => {
  const startDir = path.resolve(args.dir ?? process.cwd());
  const agents = AgentRegistry.getInstance().getAll();
  const skillsets = new Set<string>();

  let currentDir = startDir;

  while (true) {
    for (const agent of agents) {
      const agentDir = agent.getAgentDir({ installDir: currentDir });
      const markerPath = path.join(agentDir, ".nori-managed");

      if (fsSync.existsSync(markerPath)) {
        const content = fsSync.readFileSync(markerPath, "utf-8").trim();
        if (content.length > 0) {
          skillsets.add(content);
        }
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return Array.from(skillsets).sort();
};

export const listActiveMain = async (args: {
  dir?: string | null;
}): Promise<void> => {
  const skillsets = await findActiveSkillsets({ dir: args.dir });

  if (skillsets.length === 0) {
    log.error("No active skillsets found.");
    process.exit(1);
  }

  for (const skillset of skillsets) {
    process.stdout.write(skillset + "\n");
  }
};
