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
  for (const settingsFile of agent.getExternalSettingsFiles?.() ?? []) {
    paths.add(settingsFile);
  }
  for (const mcpFile of agent.getMcpManagedPaths?.({ installDir }) ?? []) {
    paths.add(mcpFile);
  }
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

const getTxnRoot = (): string => path.join(getHomeDir(), ".nori", ".txn");

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
};

type TxnIndex = { ownerPid: number | null; entries: Array<SnapshotEntry> };

const readIndex = async (args: { txnDir: string }): Promise<TxnIndex> => {
  try {
    const raw = await fs.readFile(
      path.join(args.txnDir, "index.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw) as Partial<TxnIndex>;
    return {
      ownerPid: typeof parsed.ownerPid === "number" ? parsed.ownerPid : null,
      entries: parsed.entries ?? [],
    };
  } catch {
    // A missing or corrupt index cannot be rolled back; recovery discards it.
    return { ownerPid: null, entries: [] };
  }
};

const recoverOne = async (args: { txnDir: string }): Promise<void> => {
  const { txnDir } = args;
  const index = await readIndex({ txnDir });
  // Never touch a transaction whose owning process is still running — that is an
  // in-flight activation (including this process's own), not a crashed one.
  if (index.ownerPid != null && isProcessAlive(index.ownerPid)) return;
  // A committed transaction already applied its new state; only clean up.
  if (!(await pathExists(path.join(txnDir, "committed")))) {
    for (const entry of index.entries) {
      await restoreEntry(entry);
    }
  }
  await fs.rm(txnDir, { recursive: true, force: true });
};

/**
 * Restore any activation transaction left behind by a crashed process. Runs at
 * the start of the next activation so a killed install/switch/update self-heals
 * to its previous usable state. Restore is idempotent, so re-running is safe.
 */
export const recoverPendingActivations = async (): Promise<void> => {
  const txnRoot = getTxnRoot();
  let ids: Array<string>;
  try {
    ids = await fs.readdir(txnRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const id of ids) {
    await recoverOne({ txnDir: path.join(txnRoot, id) });
  }
  await fs.rmdir(txnRoot).catch(() => undefined);
};

export const withActivationTransaction = async <T>(args: {
  installDir: string;
  agents: ReadonlyArray<AgentConfig>;
  operation: () => Promise<T>;
}): Promise<T> => {
  const { installDir, agents, operation } = args;

  // Recovery of any crashed transaction runs at install-lock acquisition, which
  // wraps every activation caller, so it is not repeated here.
  const txnRoot = getTxnRoot();
  const backupDir = path.join(txnRoot, randomUUID());
  await fs.mkdir(backupDir, { recursive: true });

  const targets = snapshotTargetPaths({ agents, installDir });
  const entries: Array<SnapshotEntry> = [];
  for (let i = 0; i < targets.length; i++) {
    entries.push(
      await captureEntry({ targetPath: targets[i], backupDir, index: i }),
    );
  }
  // Persist the snapshot so a crash mid-operation can be rolled back later. The
  // owner pid lets recovery skip this transaction while this process is alive.
  await fs.writeFile(
    path.join(backupDir, "index.json"),
    JSON.stringify({ ownerPid: process.pid, entries }),
  );

  try {
    const result = await operation();
    // Mark committed before cleanup so a crash in the cleanup window does not
    // roll back an already-applied activation.
    await fs.writeFile(path.join(backupDir, "committed"), "");
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
