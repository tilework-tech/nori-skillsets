import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Publish a lock owned by the current live process.
 *
 * This exercises public command contention against the real filesystem lock
 * implementation without relying on lock-module mocks.
 *
 * @param args - Lock fixture options
 * @param args.homeDir - Temporary home directory where the lock is published
 */
export const createHeldInstallLock = async (args: {
  homeDir: string;
}): Promise<void> => {
  const lockPath = path.join(args.homeDir, ".nori-install.lock");
  await fs.mkdir(lockPath, { recursive: true });
  await fs.writeFile(
    path.join(
      lockPath,
      `owner-${process.pid}-00000000-0000-4000-8000-000000000000`,
    ),
    "",
  );
};
