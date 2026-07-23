/**
 * Non-interactive Nori initialization.
 *
 * Creates the profiles directory, captures existing agent configuration when
 * present, persists the active skillset, and marks the install directory for
 * every default agent. This is the shared core behind both the `init` command
 * (non-interactive path) and the install orchestration in
 * features/install/install.ts.
 */

import * as fs from "fs/promises";

import { log } from "@clack/prompts";

import {
  loadConfig,
  updateConfig,
  getDefaultAgents,
  type Config,
} from "@/cli/config.js";
import {
  isInstalledAtDir,
  detectExistingConfig,
  captureExistingConfig,
  markInstall,
} from "@/cli/features/agentOperations.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { isSilentMode } from "@/cli/logger.js";
import { getNoriSkillsetsDir } from "@/norijson/skillset.js";
import { normalizeInstallDir } from "@/utils/path.js";

/**
 * Check if a directory exists
 *
 * @param args - Configuration arguments
 * @param args.dirPath - Path to the directory to check
 *
 * @returns True if the directory exists, false otherwise
 */
const directoryExists = async (args: { dirPath: string }): Promise<boolean> => {
  const { dirPath } = args;
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
};

/**
 * Initialize Nori configuration and directories without prompting.
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 * @param args.persistInstallMarkers - Whether to write .nori-managed markers
 * @param args.skillset - Skillset name to write to .nori-managed markers
 */
export const ensureNoriInitialized = async (args?: {
  installDir?: string | null;
  persistInstallMarkers?: boolean | null;
  skillset?: string | null;
}): Promise<void> => {
  const { installDir, persistInstallMarkers, skillset } = args ?? {};
  const normalizedInstallDir = normalizeInstallDir({
    installDir,
    agentDirNames: AgentRegistry.getInstance().getAgentDirNames(),
  });

  // Resolve all default agents for agent-specific operations
  const existingConfigForAgent = await loadConfig();
  const defaultAgentNames = getDefaultAgents({
    config: existingConfigForAgent,
  });
  const defaultAgent = AgentRegistry.getInstance().get({
    name: defaultAgentNames[0],
  });

  // Create ~/.nori/profiles/ directory
  const skillsetsDir = getNoriSkillsetsDir();
  if (!(await directoryExists({ dirPath: skillsetsDir }))) {
    await fs.mkdir(skillsetsDir, { recursive: true });
  }

  // Load existing config (if any)
  const existingConfig = await loadConfig();

  // Track captured skillset name for setting in config
  let capturedSkillsetName: string | null = null;

  // If no existing config and default agent not already installed, check for
  // existing configuration to capture
  if (
    existingConfig == null &&
    !isInstalledAtDir({ agent: defaultAgent, path: normalizedInstallDir })
  ) {
    const detectedConfig = await detectExistingConfig({
      agent: defaultAgent,
      installDir: normalizedInstallDir,
    });
    if (detectedConfig != null) {
      capturedSkillsetName = "my-profile";
    }
  }

  // Set activeSkillset - if a skillset was captured, set it as the active skillset
  const activeSkillset =
    capturedSkillsetName ?? existingConfig?.activeSkillset ?? null;

  // Save config — do not persist installDir; only `sks config` should change it.
  await updateConfig({
    activeSkillset,
  });

  // If a skillset was captured, capture config and install managed block for all agents
  if (capturedSkillsetName != null) {
    const config: Config = {
      installDir: normalizedInstallDir,
      activeSkillset,
    };
    for (const agentName of defaultAgentNames) {
      const agent = AgentRegistry.getInstance().get({ name: agentName });
      await captureExistingConfig({
        agent,
        installDir: normalizedInstallDir,
        skillsetName: capturedSkillsetName,
        config,
      });
    }
    if (!isSilentMode()) {
      log.success(`Configuration saved as skillset "${capturedSkillsetName}"`);
    }
  }

  if (persistInstallMarkers !== false) {
    // Mark this directory as having all default agents installed
    for (const agentName of defaultAgentNames) {
      const agent = AgentRegistry.getInstance().get({ name: agentName });
      markInstall({
        agent,
        path: normalizedInstallDir,
        skillsetName:
          capturedSkillsetName ??
          skillset ??
          existingConfig?.activeSkillset ??
          null,
      });
    }
  }
};
