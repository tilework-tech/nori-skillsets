/**
 * Transactional activation.
 *
 * Wraps a multi-agent activation so that a failure partway through restores the
 * previous usable state instead of leaving a half-activated installation. It
 * takes a dpkg-style selective backup of exactly the managed paths activation
 * may overwrite (per agent) plus the global active-skillset pointer, runs the
 * activation, and on any throw restores every backed-up path (deleting paths
 * that did not exist before) before re-raising the original error. On success
 * the backup is discarded.
 *
 * This never acquires a lock of its own; callers run it inside
 * `withInstallLock`, which provides the serialization boundary.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { getConfigPath } from "@/cli/config.js";
import {
  getManagedDirs,
  getManagedFiles,
} from "@/cli/features/agentOperations.js";
import { getHomeDir } from "@/utils/home.js";

import type { AgentConfig } from "@/cli/features/agentRegistry.js";

type SnapshotEntry = {
  /** Absolute path in the live tree that this entry protects. */
  targetPath: string;
  /** Absolute path of the backup copy, or null when the target was absent. */
  backupPath: string | null;
};

// The exact set of absolute paths one agent's activation may overwrite in the
// install directory: its declared managed files and directories, its
// instructions file, and its `.nori-managed` marker.
const managedPathsForAgent = (args: {
  agent: AgentConfig;
  installDir: string;
}): Array<string> => {
  const { agent, installDir } = args;
  const agentDir = agent.getAgentDir({ installDir });
  const paths = new Set<string>();
  for (const file of getManagedFiles({ agent })) {
    paths.add(path.join(agentDir, file));
  }
  for (const dir of getManagedDirs({ agent })) {
    paths.add(path.join(agentDir, dir));
  }
  paths.add(agent.getInstructionsFilePath({ installDir }));
  paths.add(path.join(agentDir, ".nori-managed"));
  return Array.from(paths);
};

const snapshotTargetPaths = (args: {
  agents: ReadonlyArray<AgentConfig>;
  installDir: string;
}): Array<string> => {
  const { agents, installDir } = args;
  const paths = new Set<string>();
  for (const agent of agents) {
    for (const p of managedPathsForAgent({ agent, installDir })) {
      paths.add(p);
    }
  }
  paths.add(getConfigPath());
  return Array.from(paths);
};

const pathExists = async (target: string): Promise<boolean> => {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
};

const captureEntry = async (args: {
  targetPath: string;
  backupDir: string;
  index: number;
}): Promise<SnapshotEntry> => {
  const { targetPath, backupDir, index } = args;
  if (!(await pathExists(targetPath))) {
    return { targetPath, backupPath: null };
  }
  const backupPath = path.join(backupDir, String(index));
  await fs.cp(targetPath, backupPath, { recursive: true });
  return { targetPath, backupPath };
};

const restoreEntry = async (entry: SnapshotEntry): Promise<void> => {
  await fs.rm(entry.targetPath, { recursive: true, force: true });
  if (entry.backupPath == null) return;
  await fs.mkdir(path.dirname(entry.targetPath), { recursive: true });
  await fs.cp(entry.backupPath, entry.targetPath, { recursive: true });
};

export const withActivationTransaction = async <T>(args: {
  installDir: string;
  agents: ReadonlyArray<AgentConfig>;
  operation: () => Promise<T>;
}): Promise<T> => {
  const { installDir, agents, operation } = args;

  const txnRoot = path.join(getHomeDir(), ".nori", ".txn");
  const backupDir = path.join(txnRoot, randomUUID());
  await fs.mkdir(backupDir, { recursive: true });

  const targets = snapshotTargetPaths({ agents, installDir });
  const entries: Array<SnapshotEntry> = [];
  for (let i = 0; i < targets.length; i++) {
    entries.push(
      await captureEntry({ targetPath: targets[i], backupDir, index: i }),
    );
  }

  try {
    const result = await operation();
    return result;
  } catch (error) {
    for (const entry of entries) {
      await restoreEntry(entry);
    }
    throw error;
  } finally {
    await fs.rm(backupDir, { recursive: true, force: true });
    await fs.rmdir(txnRoot).catch(() => undefined);
  }
};
