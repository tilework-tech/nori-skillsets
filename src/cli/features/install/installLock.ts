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
  processIdentity: string | null;
};

const isProcessAlive = (args: { pid: number }): boolean => {
  try {
    process.kill(args.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
};

const readLinuxProcessIdentity = async (args: {
  pid: number;
}): Promise<string | null> => {
  if (process.platform !== "linux") return null;
  try {
    const [bootId, stat] = await Promise.all([
      fs.readFile("/proc/sys/kernel/random/boot_id", "utf8"),
      fs.readFile(`/proc/${args.pid}/stat`, "utf8"),
    ]);
    const commandEnd = stat.lastIndexOf(")");
    if (commandEnd < 0) return null;
    const fieldsAfterCommand = stat
      .slice(commandEnd + 1)
      .trim()
      .split(/\s+/u);
    const processStartTicks = fieldsAfterCommand[19];
    if (processStartTicks == null) return null;
    return `${bootId.trim()}:${processStartTicks}`;
  } catch {
    return null;
  }
};

const readMarkerProcessIdentity = async (args: {
  markerPath: string;
}): Promise<string | null> => {
  try {
    const marker = JSON.parse(await fs.readFile(args.markerPath, "utf8")) as {
      processIdentity?: unknown;
    };
    return typeof marker.processIdentity === "string"
      ? marker.processIdentity
      : null;
  } catch {
    return null;
  }
};

const isLockOwnerAlive = async (args: {
  owner: LockOwner;
}): Promise<boolean> => {
  const { owner } = args;
  if (owner.pid == null || !isProcessAlive({ pid: owner.pid })) return false;
  if (owner.processIdentity == null) return true;
  const currentIdentity = await readLinuxProcessIdentity({ pid: owner.pid });
  return currentIdentity == null || currentIdentity === owner.processIdentity;
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
    return {
      pid,
      markerPath,
      processIdentity: await readMarkerProcessIdentity({ markerPath }),
    };
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
        processIdentity: null,
      };
    }
    return {
      pid: null,
      markerPath: legacyOwnerPath,
      processIdentity: null,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return {
      pid: null,
      markerPath: legacyOwnerPath,
      processIdentity: null,
    };
  }

  return null;
};

type RecoverableLock = {
  markerPath: string | null;
};

const recoverableLock = async (args: {
  lockPath: string;
}): Promise<RecoverableLock | undefined> => {
  const lockStat = await fs.lstat(args.lockPath);
  if (!lockStat.isDirectory()) return undefined;

  const owner = await readLockOwner(args);
  if (owner != null) {
    if (!(await isLockOwnerAlive({ owner }))) {
      return { markerPath: owner.markerPath };
    }
    return undefined;
  }

  const entries = await fs.readdir(args.lockPath);
  if (entries.length === 0) {
    return { markerPath: null };
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
  const processIdentity = await readLinuxProcessIdentity({ pid: process.pid });

  await fs.mkdir(path.dirname(args.lockPath), { recursive: true });
  await fs.mkdir(candidatePath);
  try {
    await fs.writeFile(
      candidateMarkerPath,
      JSON.stringify({ processIdentity }),
      { flag: "wx" },
    );
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

      let recoverable: RecoverableLock | undefined;
      try {
        recoverable = await recoverableLock(args);
      } catch (classificationError) {
        if ((classificationError as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }
        throw classificationError;
      }
      if (recoverable === undefined) {
        throw new Error("Another Nori installation is already in progress");
      }

      try {
        if (recoverable.markerPath != null) {
          await fs.unlink(recoverable.markerPath);
        }
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
    // Under the exclusive lock, first restore any activation transaction left
    // behind by a crashed process so no mutation runs on a half-written tree.
    // Loaded lazily to avoid a static import cycle (activationTransaction reads
    // config, which acquires this lock).
    //
    // Invariant: this must run BEFORE `installLockContext.run` establishes the
    // lock token, i.e. only at the outermost acquisition. Moving it inside the
    // token context would make a nested acquisition recover too, re-clobbering
    // an in-flight transaction.
    const { recoverPendingActivations } =
      await import("@/cli/features/install/activationTransaction.js");
    await recoverPendingActivations();
    return await installLockContext.run(token, args.operation);
  } finally {
    activeLockTokens.delete(token);
    await releaseInstallLock({ markerPath });
  }
};
