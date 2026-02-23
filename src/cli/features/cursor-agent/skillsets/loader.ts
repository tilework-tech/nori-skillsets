/**
 * Profiles feature loader for Cursor
 * Installs profile templates to ~/.nori/profiles/ and runs profile sub-loaders
 */

import * as fs from "fs/promises";

import { getActiveSkillset, type Config } from "@/cli/config.js";
import { CursorProfileLoaderRegistry } from "@/cli/features/cursor-agent/skillsets/skillsetLoaderRegistry.js";
import { getNoriSkillsetsDir } from "@/cli/features/paths.js";
import { parseSkillset } from "@/cli/features/skillset.js";

import type { Loader } from "@/cli/features/agentRegistry.js";

/**
 * Install profiles directory and run profile sub-loaders
 *
 * @param _args - Configuration arguments
 * @param _args.config - Runtime configuration (unused, kept for interface consistency)
 */
const installProfiles = async (_args: { config: Config }): Promise<void> => {
  const noriProfilesDir = getNoriSkillsetsDir();

  // Create profiles directory if it doesn't exist
  await fs.mkdir(noriProfilesDir, { recursive: true });
};

/**
 * Cursor profiles feature loader
 */
export const cursorProfilesLoader: Loader = {
  name: "cursor-profiles",
  description: "Skillset templates in ~/.nori/profiles/ (Cursor)",
  run: async (args: { config: Config }) => {
    const { config } = args;
    await installProfiles({ config });

    // Parse the active skillset
    const skillsetName = getActiveSkillset({ config });
    if (skillsetName == null) {
      throw new Error(
        "No skillset configured. Run 'nori-skillsets init' to configure a skillset.",
      );
    }
    const skillset = await parseSkillset({
      skillsetName,
      configFileName: "CLAUDE.md",
    });

    // Install all profile-dependent features with the parsed skillset
    const registry = CursorProfileLoaderRegistry.getInstance();
    const loaders = registry.getAll();
    for (const loader of loaders) {
      await loader.install({ config, skillset });
    }
  },
};
