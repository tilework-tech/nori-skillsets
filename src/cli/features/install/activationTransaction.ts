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
import { getManifestPath } from "@/cli/features/manifest.js";
import { getHomeDir } from "@/utils/home.js";

import type { AgentConfig } from "@/cli/features/agentRegistry.js";

type SnapshotEntry = {
  /** Absolute path in the live tree that this entry protects. */
  targetPath: string;
  /** Absolute path of the backup copy, or null when the target was absent. */
  backupPath: string | null;
};

// The exact set of absolute paths one agent's activation may overwrite: its
// declared managed files and directories, its instructions file, its
// `.nori-managed` marker, its external settings files, its MCP config files,
// and the manifest that records which files it wrote (read by change detection,
// so a stale manifest after rollback would report phantom local changes).
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
  paths.add(getManifestPath({ agentName: agent.name, installDir }));
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

const discardBackup = async (args: {
  backupDir: string;
  txnRoot: string;
}): Promise<void> => {
  await fs.rm(args.backupDir, { recursive: true, force: true });
  await fs.rmdir(args.txnRoot).catch(() => undefined);
};

const readIndexEntries = async (args: {
  txnDir: string;
}): Promise<Array<SnapshotEntry>> => {
  try {
    const raw = await fs.readFile(
      path.join(args.txnDir, "index.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw) as { entries?: Array<SnapshotEntry> };
    return parsed.entries ?? [];
  } catch {
    // A missing or corrupt index cannot be rolled back; recovery discards it.
    return [];
  }
};

const recoverOne = async (args: { txnDir: string }): Promise<void> => {
  const { txnDir } = args;
  // Recovery runs only while holding the exclusive install lock, so any leftover
  // transaction is necessarily from an abandoned process — a live owner would
  // still hold the lock and block acquisition. A committed transaction already
  // applied its new state (clean up only); otherwise restore the previous state.
  if (!(await pathExists(path.join(txnDir, "committed")))) {
    for (const entry of await readIndexEntries({ txnDir })) {
      await restoreEntry(entry);
    }
  }
  await fs.rm(txnDir, { recursive: true, force: true });
};

const quarantineTransaction = async (args: {
  txnRoot: string;
  id: string;
}): Promise<void> => {
  const failedPath = path.join(args.txnRoot, `failed-${args.id}`);
  await fs
    .rename(path.join(args.txnRoot, args.id), failedPath)
    .catch(() => undefined);
  process.emitWarning(
    `Nori could not fully restore an interrupted activation; the previous state ` +
      `may be partially applied. Left for inspection at ${failedPath}`,
  );
};

/**
 * Restore any activation transaction left behind by a crashed process. Invoked
 * at install-lock acquisition, so every locked mutation self-heals to its
 * previous usable state before it runs. Restore is idempotent, so re-running is
 * safe. A transaction that cannot be restored is quarantined (not retried and
 * not allowed to wedge the command that triggered recovery), which both avoids
 * blocking recovery commands like `factory-reset` and prevents its restorable
 * entries from being re-reverted on every subsequent command.
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
    // Quarantined transactions are left for manual inspection, never retried.
    if (id.startsWith("failed-")) continue;
    try {
      await recoverOne({ txnDir: path.join(txnRoot, id) });
    } catch {
      await quarantineTransaction({ txnRoot, id });
    }
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
  // Persist the snapshot so a crash mid-operation can be rolled back later.
  await fs.writeFile(
    path.join(backupDir, "index.json"),
    JSON.stringify({ entries }),
  );

  let result: T;
  try {
    result = await operation();
  } catch (error) {
    // Roll back to the snapshot. If a restore step itself throws, the error
    // propagates WITHOUT discarding the backup below, so the previous state
    // stays recoverable at the next lock acquisition — the backup is the only
    // copy of it. (A hard kill during rollback is likewise safe: the backup is
    // never removed, so recovery re-runs the restore.)
    for (const entry of entries) {
      await restoreEntry(entry);
    }
    await discardBackup({ backupDir, txnRoot });
    throw error;
  }

  // Commit: mark committed before discarding the backup so a crash in the
  // cleanup window keeps — never reverts — the applied activation.
  await fs.writeFile(path.join(backupDir, "committed"), "");
  await discardBackup({ backupDir, txnRoot });
  return result;
};
