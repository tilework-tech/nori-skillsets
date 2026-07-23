import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { getHomeDir } from "@/utils/home.js";

const installLockContext = new AsyncLocalStorage<symbol>();
const activeLockTokens = new Set<symbol>();

const getInstallLockPath = (): string =>
  path.join(getHomeDir(), ".nori-install.lock");

type LockOwner = {
  markerPath: string;
  pid: number | null;
};

const isProcessAlive = (args: { pid: number }): boolean => {
  try {
    process.kill(args.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
};

const readLockOwner = async (args: {
  lockPath: string;
}): Promise<LockOwner | null> => {
  const lockStat = await fs.lstat(args.lockPath);
  if (!lockStat.isDirectory()) return null;

  const entries = await fs.readdir(args.lockPath);
  for (const entry of entries) {
    const match = entry.match(/^owner-(\d+)-[0-9a-f-]+$/u);
    if (match == null) continue;
    const pid = Number.parseInt(match[1], 10);
    if (!Number.isSafeInteger(pid) || pid <= 0) continue;
    const markerPath = path.join(args.lockPath, entry);
    return { pid, markerPath };
  }

  const legacyOwnerPath = path.join(args.lockPath, "owner.json");
  try {
    const owner = JSON.parse(await fs.readFile(legacyOwnerPath, "utf8")) as {
      pid?: unknown;
    };
    if (
      typeof owner.pid === "number" &&
      Number.isSafeInteger(owner.pid) &&
      owner.pid > 0
    ) {
      return {
        pid: owner.pid,
        markerPath: legacyOwnerPath,
      };
    }
    return {
      pid: null,
      markerPath: legacyOwnerPath,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return {
      pid: null,
      markerPath: legacyOwnerPath,
    };
  }

  return null;
};

const staleOwnerMarker = async (args: {
  lockPath: string;
}): Promise<string | undefined> => {
  const owner = await readLockOwner(args);
  if (owner != null) {
    if (owner.pid != null && !isProcessAlive({ pid: owner.pid })) {
      return owner.markerPath;
    }
    return undefined;
  }
  return undefined;
};

const acquireInstallLock = async (args: {
  lockPath: string;
}): Promise<string> => {
  const ownerId = randomUUID();
  const markerName = `owner-${process.pid}-${ownerId}`;
  const candidatePath = `${args.lockPath}.candidate-${process.pid}-${ownerId}`;
  const candidateMarkerPath = path.join(candidatePath, markerName);

  await fs.mkdir(path.dirname(args.lockPath), { recursive: true });
  await fs.mkdir(candidatePath);
  try {
    await fs.writeFile(candidateMarkerPath, "", { flag: "wx" });
    for (;;) {
      try {
        await fs.lstat(args.lockPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        try {
          await fs.rename(candidatePath, args.lockPath);
          return path.join(args.lockPath, markerName);
        } catch (publishError) {
          const code = (publishError as NodeJS.ErrnoException).code;
          if (code === "EEXIST" || code === "ENOTEMPTY") continue;
          throw publishError;
        }
      }

      let staleMarker: string | undefined;
      try {
        staleMarker = await staleOwnerMarker(args);
      } catch (classificationError) {
        if ((classificationError as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }
        throw classificationError;
      }
      if (staleMarker === undefined) {
        throw new Error("Another Nori installation is already in progress");
      }

      try {
        await fs.unlink(staleMarker);
        await fs.rmdir(args.lockPath);
      } catch (recoveryError) {
        const code = (recoveryError as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTEMPTY" || code === "EEXIST") {
          continue;
        }
        throw recoveryError;
      }
    }
  } finally {
    try {
      await fs.rm(candidatePath, { recursive: true, force: true });
    } catch {
      // The candidate was renamed into place or is already gone.
    }
  }
};

const releaseInstallLock = async (args: {
  markerPath: string;
}): Promise<void> => {
  try {
    await fs.unlink(args.markerPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  try {
    await fs.rmdir(path.dirname(args.markerPath));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTEMPTY" && code !== "EEXIST") {
      throw error;
    }
  }
};

export const withInstallLock = async <T>(args: {
  operation: () => Promise<T>;
}): Promise<T> => {
  const inheritedToken = installLockContext.getStore();
  if (inheritedToken != null && activeLockTokens.has(inheritedToken)) {
    return args.operation();
  }

  const lockPath = getInstallLockPath();
  const markerPath = await acquireInstallLock({ lockPath });
  const token = Symbol("install-lock");
  activeLockTokens.add(token);

  try {
    return await installLockContext.run(token, args.operation);
  } finally {
    activeLockTokens.delete(token);
    await releaseInstallLock({ markerPath });
  }
};
