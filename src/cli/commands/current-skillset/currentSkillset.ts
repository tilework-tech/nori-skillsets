/**
 * Current skillset command for Nori Skillsets CLI
 * Displays the currently active skillset name
 */

import * as path from "path";

import { log } from "@clack/prompts";

import { loadConfig, getActiveSkillset } from "@/cli/config.js";
import { getInstalledSkillsetName } from "@/cli/features/agentOperations.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { resolveSkillsetDir, skillsetIdentity } from "@/norijson/skillset.js";

/**
 * Skillset identity installed at an exact install directory, read from
 * `.nori-managed` markers for registered agents. Does not walk parents (see
 * `list-active` for the hierarchy view) and does not read global
 * `activeSkillset` — that is what bare `current` does.
 *
 * When multiple agents have markers at the directory they must agree; a
 * conflict is an inconsistent install. Returns null when no marker is present.
 */
export const getSkillsetAtInstallDir = (args: {
  installDir: string;
  agent?: string | null;
}): string | null => {
  const dir = path.resolve(args.installDir);
  const registry = AgentRegistry.getInstance();
  const agents =
    args.agent != null && args.agent !== ""
      ? [registry.get({ name: args.agent })]
      : registry.getAll();

  const names = new Set<string>();
  for (const agent of agents) {
    const name = getInstalledSkillsetName({ agent, path: dir });
    if (name != null && name.length > 0) {
      names.add(name);
    }
  }

  if (names.size === 0) {
    return null;
  }
  if (names.size > 1) {
    throw new Error(
      `Conflicting skillset markers at ${dir}: ${Array.from(names).sort().join(", ")}`,
    );
  }
  return Array.from(names)[0]!;
};

/**
 * Main function for current-skillset command
 * @param args - Command arguments
 * @param args.agent - Optional agent name; with `--install-dir`, limits the
 *   marker read to that agent. Without `--install-dir`, kept for CLI
 *   compatibility (global active skillset is shared across agents).
 * @param args.installDir - When set (global `-d` / `--install-dir`), report
 *   the skillset installed at that directory via `.nori-managed` markers
 *   instead of global `activeSkillset`. Needed after switch `-d` no longer
 *   persists global config (nori-skillsets#538).
 */
export const currentSkillsetMain = async (args: {
  agent?: string | null;
  installDir?: string | null;
}): Promise<void> => {
  if (args.installDir != null && args.installDir !== "") {
    let skillset: string | null;
    try {
      skillset = getSkillsetAtInstallDir({
        installDir: args.installDir,
        agent: args.agent,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(message);
      process.exit(1);
      return;
    }

    if (skillset == null) {
      log.error(
        `No skillset installed at ${path.resolve(args.installDir)}. Use 'nori-skillsets switch -d <dir> <name>' to install one.`,
      );
      process.exit(1);
      return;
    }

    process.stdout.write(skillset + "\n");
    return;
  }

  // Load config from home directory (centralized config location)
  const config = await loadConfig();

  if (config == null) {
    log.error(
      "No active skillset configured. Use 'nori-skillsets switch <name>' to set one.",
    );
    process.exit(1);
    return;
  }

  const skillset = getActiveSkillset({ config });

  if (skillset == null) {
    log.error(
      "No active skillset configured. Use 'nori-skillsets switch <name>' to set one.",
    );
    process.exit(1);
    return;
  }

  // Display the namespaced identity (e.g. personal/foo) even if the stored
  // active skillset is a legacy bare name that resolves into a bucket.
  const resolvedDir = await resolveSkillsetDir({ name: skillset });
  const display =
    resolvedDir != null ? skillsetIdentity({ dir: resolvedDir }) : skillset;

  // Output the skillset name (plain stdout for scripting use)
  process.stdout.write(display + "\n");
};
