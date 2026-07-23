import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { getHomeDir } from "@/utils/home.js";

const installLockContext = new AsyncLocalStorage<symbol>();
const activeLockTokens = new Set<symbol>();
const MAX_INSTALL_LOCK_AGE_MS = 24 * 60 * 60 * 1000;

const getInstallLockPath = (): string =>
  path.join(getHomeDir(), ".nori-install.lock");

type LockOwner = {
  createdAt: number;
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
  const entries = await fs.readdir(args.lockPath);
  for (const entry of entries) {
    const match = entry.match(/^owner-(\d+)-[0-9a-f-]+$/u);
    if (match == null) continue;
    const pid = Number.parseInt(match[1], 10);
    if (!Number.isSafeInteger(pid) || pid <= 0) continue;
    const markerPath = path.join(args.lockPath, entry);
    const stat = await fs.stat(markerPath);
    return { pid, createdAt: stat.mtimeMs, markerPath };
  }

  const legacyOwnerPath = path.join(args.lockPath, "owner.json");
  try {
    const owner = JSON.parse(await fs.readFile(legacyOwnerPath, "utf8")) as {
      pid?: unknown;
      createdAt?: unknown;
    };
    if (
      typeof owner.pid === "number" &&
      Number.isSafeInteger(owner.pid) &&
      owner.pid > 0
    ) {
      const createdAt =
        typeof owner.createdAt === "string"
          ? Date.parse(owner.createdAt)
          : Number.NaN;
      const stat = Number.isFinite(createdAt)
        ? null
        : await fs.stat(legacyOwnerPath);
      return {
        pid: owner.pid,
        createdAt: Number.isFinite(createdAt) ? createdAt : stat!.mtimeMs,
        markerPath: legacyOwnerPath,
      };
    }
    const stat = await fs.stat(legacyOwnerPath);
    return {
      pid: null,
      createdAt: stat.mtimeMs,
      markerPath: legacyOwnerPath,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    const stat = await fs.stat(legacyOwnerPath);
    return {
      pid: null,
      createdAt: stat.mtimeMs,
      markerPath: legacyOwnerPath,
    };
  }

  return null;
};

const staleOwnerMarker = async (args: {
  lockPath: string;
}): Promise<string | null | undefined> => {
  const owner = await readLockOwner(args);
  if (owner != null) {
    const expired = Date.now() - owner.createdAt > MAX_INSTALL_LOCK_AGE_MS;
    if (expired || (owner.pid != null && !isProcessAlive({ pid: owner.pid }))) {
      return owner.markerPath;
    }
    return undefined;
  }

  if ((await fs.readdir(args.lockPath)).length > 0) return undefined;
  const stat = await fs.stat(args.lockPath);
  return Date.now() - stat.mtimeMs > 60_000 ? null : undefined;
};

const acquireInstallLock = async (args: {
  lockPath: string;
}): Promise<void> => {
  for (;;) {
    try {
      await fs.mkdir(args.lockPath);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let staleMarker: string | null | undefined;
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
        if (staleMarker != null) await fs.unlink(staleMarker);
        await fs.rmdir(args.lockPath);
      } catch (recoveryError) {
        const code = (recoveryError as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTEMPTY" || code === "EEXIST") {
          continue;
        }
        throw recoveryError;
      }
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
  await acquireInstallLock({ lockPath });
  const token = Symbol("install-lock");
  const ownerId = randomUUID();
  const markerPath = path.join(lockPath, `owner-${process.pid}-${ownerId}`);
  let ownerWritten = false;
  activeLockTokens.add(token);

  try {
    await fs.writeFile(markerPath, "", { flag: "wx" });
    ownerWritten = true;
    return await installLockContext.run(token, args.operation);
  } finally {
    activeLockTokens.delete(token);
    if (ownerWritten) {
      await releaseInstallLock({ markerPath });
    } else {
      await fs.rmdir(lockPath).catch(() => undefined);
    }
  }
};
