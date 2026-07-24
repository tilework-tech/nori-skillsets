/**
 * Durable Git-source trust store.
 *
 * Persists which `(remote, branch)` pairs the user has trusted to a per-user
 * `~/.nori/trust.json`. Trust is keyed by the canonicalized remote (so trivial
 * URL variants collapse) plus the derived branch. This is source-authorization
 * trust, not content pinning. Callers hold `withInstallLock` around
 * read-modify-write sequences; reads tolerate a missing or corrupt file.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { canonicalizeRemoteForTrust } from "@/cli/features/gitPackage.js";
import { getNoriDir } from "@/norijson/skillset.js";

export type TrustEntry = {
  remote: string;
  branch: string;
  addedAt: string;
};

type TrustStore = {
  version: 1;
  entries: Array<TrustEntry>;
};

const getTrustPath = (): string => path.join(getNoriDir(), "trust.json");

const readStore = async (): Promise<TrustStore> => {
  try {
    const parsed = JSON.parse(
      await fs.readFile(getTrustPath(), "utf-8"),
    ) as Partial<TrustStore>;
    return {
      version: 1,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return { version: 1, entries: [] };
  }
};

const writeStore = async (store: TrustStore): Promise<void> => {
  const trustPath = getTrustPath();
  await fs.mkdir(path.dirname(trustPath), { recursive: true });
  const tempPath = `${trustPath}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(store, null, 2));
  await fs.rename(tempPath, trustPath);
};

const matches = (args: {
  entry: TrustEntry;
  remote: string;
  branch: string;
}): boolean =>
  args.entry.remote === args.remote && args.entry.branch === args.branch;

export const isTrusted = async (args: {
  remote: string;
  branch: string;
}): Promise<boolean> => {
  const remote = canonicalizeRemoteForTrust({ remote: args.remote });
  const store = await readStore();
  return store.entries.some((entry) =>
    matches({ entry, remote, branch: args.branch }),
  );
};

export const recordTrust = async (args: {
  remote: string;
  branch: string;
}): Promise<void> => {
  const remote = canonicalizeRemoteForTrust({ remote: args.remote });
  const store = await readStore();
  if (
    store.entries.some((entry) =>
      matches({ entry, remote, branch: args.branch }),
    )
  ) {
    return;
  }
  store.entries.push({
    remote,
    branch: args.branch,
    addedAt: new Date().toISOString(),
  });
  await writeStore(store);
};

export const listTrust = async (): Promise<Array<TrustEntry>> =>
  (await readStore()).entries;

export const revokeTrust = async (args: {
  remote: string;
  branch: string;
}): Promise<boolean> => {
  const remote = canonicalizeRemoteForTrust({ remote: args.remote });
  const store = await readStore();
  const remaining = store.entries.filter(
    (entry) => !matches({ entry, remote, branch: args.branch }),
  );
  if (remaining.length === store.entries.length) return false;
  store.entries = remaining;
  await writeStore(store);
  return true;
};
