/**
 * Update Command
 *
 * `sks update <slug>` advances a following Git-backed skillset to its branch
 * tip (fast-forward only) and re-activates it transactionally. Two composed
 * rollback layers protect a failed run: the Git update adapter's `undo()`
 * resets the checkout, and `withActivationTransaction` restores the rendered
 * output. Never touches the Registrar.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { getDefaultAgents, loadConfig, updateConfig } from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { updateFollowingCheckout } from "@/cli/features/gitPackage.js";
import { withActivationTransaction } from "@/cli/features/install/activationTransaction.js";
import { noninteractive as activateSkillset } from "@/cli/features/install/install.js";
import { withInstallLock } from "@/cli/features/install/installLock.js";
import { isSilentMode, setSilentMode } from "@/cli/logger.js";
import { getNoriSkillsetsDir } from "@/norijson/skillset.js";
import { resolveInstallDir } from "@/utils/path.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";

const isGitWorkingTree = async (dir: string): Promise<boolean> => {
  try {
    await fs.stat(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
};

const updateSkillsetMainImpl = async (args: {
  slug: string;
  installDir?: string | null;
  nonInteractive?: boolean | null;
  silent?: boolean | null;
}): Promise<CommandStatus> => {
  const { slug, installDir, silent } = args;
  const nonInteractive = args.nonInteractive === true || silent === true;

  const identity = `personal/${slug}`;
  const checkoutDir = path.join(getNoriSkillsetsDir(), identity);

  if (!(await isGitWorkingTree(checkoutDir))) {
    return {
      success: false,
      cancelled: false,
      message: `"${slug}" is not a Git-backed skillset; only skillsets installed with 'install <slug> --from <remote>' can be updated.`,
    };
  }

  const config = await loadConfig();
  const resolved = resolveInstallDir({
    cliInstallDir: installDir,
    configInstallDir: config?.installDir,
    agentDirNames: AgentRegistry.getInstance().getAgentDirNames(),
  });
  const agentNames = getDefaultAgents({ config });
  const agentConfigs = agentNames.map((name) =>
    AgentRegistry.getInstance().get({ name }),
  );

  let updateResult;
  try {
    updateResult = await updateFollowingCheckout({
      checkoutDir,
      slug,
      nonInteractive,
    });
  } catch (error) {
    return {
      success: false,
      cancelled: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (updateResult.outcome === "up-to-date") {
    return {
      success: true,
      cancelled: false,
      message: `"${slug}" is already up to date.`,
    };
  }

  const wasSilent = isSilentMode();
  if (silent === true) setSilentMode({ silent: true });
  try {
    await withActivationTransaction({
      installDir: resolved.path,
      agents: agentConfigs,
      operation: async () => {
        // The skillset content is already the updated tip; re-render it into the
        // install dir for every configured agent.
        for (const agentName of agentNames) {
          await activateSkillset({
            installDir: resolved.path,
            agent: agentName,
            skillset: identity,
            // The transaction owns the single active-pointer commit.
            persistActiveSkillset: false,
          });
        }
        // Commit the active pointer once, unless this is a transient
        // --install-dir override.
        if (resolved.source !== "cli") {
          await updateConfig({ activeSkillset: identity });
        }
      },
    });
  } catch (error) {
    // Activation failed: the transaction restored the rendered output; also reset
    // the checkout so the Git source rolls back to the pre-update commit.
    await updateResult.undo();
    return {
      success: false,
      cancelled: false,
      message: `Failed to activate updated "${slug}"; restored the previous version. ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    if (silent === true) setSilentMode({ silent: wasSilent });
  }

  return {
    success: true,
    cancelled: false,
    message: `Updated "${slug}" to ${updateResult.newSha.slice(0, 12)}.`,
  };
};

export const updateSkillsetMain = async (args: {
  slug: string;
  installDir?: string | null;
  nonInteractive?: boolean | null;
  silent?: boolean | null;
}): Promise<CommandStatus> =>
  withInstallLock({ operation: () => updateSkillsetMainImpl(args) });
