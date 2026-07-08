/**
 * Package provenance: the .nori-version sidecar file.
 *
 * The single owner of the on-disk format recording which version of a
 * package was installed from which registry.
 */

import * as fs from "fs/promises";
import * as path from "path";

export const VERSION_FILE = ".nori-version";

export type VersionInfo = {
  version: string;
  registryUrl: string;
  orgId?: string | null;
};

/**
 * Write the .nori-version file into a package directory.
 *
 * @param args - Arguments
 * @param args.dir - Package directory
 * @param args.versionInfo - Version provenance to record
 */
export const writeVersionInfo = async (args: {
  dir: string;
  versionInfo: VersionInfo;
}): Promise<void> => {
  const { dir, versionInfo } = args;
  const payload = {
    version: versionInfo.version,
    registryUrl: versionInfo.registryUrl,
    ...(versionInfo.orgId != null ? { orgId: versionInfo.orgId } : {}),
  };
  await fs.writeFile(
    path.join(dir, VERSION_FILE),
    JSON.stringify(payload, null, 2),
  );
};

/**
 * Read the .nori-version file from a package directory.
 *
 * @param args - Arguments
 * @param args.dir - Package directory
 *
 * @returns The recorded version info, or null when missing or malformed
 */
export const readVersionInfo = async (args: {
  dir: string;
}): Promise<VersionInfo | null> => {
  const { dir } = args;
  try {
    const raw = await fs.readFile(path.join(dir, VERSION_FILE), "utf-8");
    const parsed = JSON.parse(raw) as VersionInfo;
    if (typeof parsed?.version !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
};
