/**
 * One-time migration of bare profiles into storage buckets.
 *
 * Historically every non-org skillset lived flat at ~/.nori/profiles/<name>.
 * This migration relocates each bare profile into ~/.nori/profiles/personal/<name>
 * (locally created) or ~/.nori/profiles/public/<name> (associated with the public
 * registrar), classified by the profile's `.nori-version` marker. Organization
 * profiles (already nested under profiles/<orgId>/) are left untouched.
 *
 * The migration is marker-guarded (runs once), idempotent, and safe to resume
 * after an interruption: the completion marker is written last, and each move
 * refuses to clobber an existing destination.
 */

import * as fs from "fs/promises";
import * as path from "path";

import {
  getNoriSkillsetsDir,
  MANIFEST_FILE,
  PERSONAL_BUCKET,
  PUBLIC_BUCKET,
} from "@/norijson/skillset.js";
import { isPublicRegistryUrl } from "@/utils/url.js";

const MIGRATION_MARKER_FILE = ".nori-migrations.json";
const BUCKETS_MIGRATION_ID = "buckets-v1";
const VERSION_MARKER_FILE = ".nori-version";

type MigrationState = { applied: Array<string> };

const getMigrationMarkerPath = (): string => {
  return path.join(getNoriSkillsetsDir(), MIGRATION_MARKER_FILE);
};

const readMigrationState = async (): Promise<MigrationState | null> => {
  try {
    const content = await fs.readFile(getMigrationMarkerPath(), "utf-8");
    return JSON.parse(content) as MigrationState;
  } catch {
    return null;
  }
};

const writeMigrationState = async (args: {
  state: MigrationState;
}): Promise<void> => {
  const { state } = args;
  const markerPath = getMigrationMarkerPath();
  await fs.mkdir(path.dirname(markerPath), { recursive: true });
  await fs.writeFile(markerPath, `${JSON.stringify(state, null, 2)}\n`);
};

const pathExists = async (args: { target: string }): Promise<boolean> => {
  try {
    await fs.lstat(args.target);
    return true;
  } catch {
    return false;
  }
};

const isDirectory = async (args: { target: string }): Promise<boolean> => {
  try {
    // Follows symlinks so a linked bare skillset is still detected.
    return (await fs.stat(args.target)).isDirectory();
  } catch {
    return false;
  }
};

const hasFile = async (args: { file: string }): Promise<boolean> => {
  try {
    await fs.access(args.file);
    return true;
  } catch {
    return false;
  }
};

/**
 * Classify a bare profile as `public` (downloaded from / published to the public
 * registrar) or `personal` (everything else, including locally created profiles
 * and profiles stamped with a non-public registry).
 * @param args - Function arguments
 * @param args.profileDir - Absolute path to the bare profile directory
 *
 * @returns The bucket name the profile belongs in ("public" or "personal")
 */
const classifyBucket = async (args: {
  profileDir: string;
}): Promise<string> => {
  const { profileDir } = args;
  try {
    const content = await fs.readFile(
      path.join(profileDir, VERSION_MARKER_FILE),
      "utf-8",
    );
    const parsed = JSON.parse(content) as { registryUrl?: string | null };
    if (
      parsed.registryUrl != null &&
      isPublicRegistryUrl({ url: parsed.registryUrl })
    ) {
      return PUBLIC_BUCKET;
    }
  } catch {
    // No (or unreadable) .nori-version => locally created => personal.
  }
  return PERSONAL_BUCKET;
};

/**
 * Move a directory into a bucket via a same-filesystem rename (buckets live
 * under the same profiles/ root as the source, so this never crosses devices).
 * Refuses to overwrite an existing destination.
 *
 * @param args - Function arguments
 * @param args.from - Source directory path to move
 * @param args.to - Destination path to move it to
 *
 * @returns True if the source was moved, false if it was absent, the
 *   destination already existed, or a concurrent run handled it.
 */
const safeMoveDir = async (args: {
  from: string;
  to: string;
}): Promise<boolean> => {
  const { from, to } = args;
  if (!(await pathExists({ target: from }))) {
    return false;
  }
  if (await pathExists({ target: to })) {
    process.stderr.write(
      `nori: skipping migration of "${path.basename(from)}" — destination already exists at ${to}\n`,
    );
    return false;
  }

  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.rename(from, to);
  } catch (err) {
    // Concurrent first-run race: another CLI process moved the source or
    // created the destination first. Skip rather than abort the migration.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EEXIST" || code === "ENOTEMPTY") {
      return false;
    }
    throw err;
  }
  return true;
};

/**
 * Run the one-time profiles bucket migration. Best-effort and idempotent.
 *
 * @returns The number of profiles relocated during this run.
 */
export const runProfilesMigration = async (): Promise<{ moved: number }> => {
  const state = await readMigrationState();
  if (state?.applied.includes(BUCKETS_MIGRATION_ID) === true) {
    return { moved: 0 };
  }

  const skillsetsDir = getNoriSkillsetsDir();
  let entries;
  try {
    entries = await fs.readdir(skillsetsDir, { withFileTypes: true });
  } catch {
    // No profiles directory yet — nothing to migrate or mark.
    return { moved: 0 };
  }

  let moved = 0;
  for (const entry of entries) {
    const name = entry.name;
    const profileDir = path.join(skillsetsDir, name);

    if (name === PERSONAL_BUCKET || name === PUBLIC_BUCKET) {
      // A pre-existing real skillset whose name collides with a reserved bucket
      // cannot be represented in the new layout. Warn once so the user can
      // rename it; it is otherwise hidden by the bucket of the same name.
      if (await hasFile({ file: path.join(profileDir, MANIFEST_FILE) })) {
        process.stderr.write(
          `nori: warning — a skillset named "${name}" conflicts with the reserved "${name}/" bucket and will be hidden; rename it to keep using it.\n`,
        );
      }
      continue;
    }

    // Leave symlinked (linked) skillsets flat so `sks link`/`unlink` keep
    // working against the flat path; the resolver still finds them via the
    // legacy fallback.
    if (entry.isSymbolicLink()) {
      continue;
    }

    // Only bare skillsets (a nori.json directly inside) are bucketed. Org
    // namespace directories (no nori.json at this level) and stray files are
    // left untouched.
    if (!(await isDirectory({ target: profileDir }))) {
      continue;
    }
    if (!(await hasFile({ file: path.join(profileDir, MANIFEST_FILE) }))) {
      continue;
    }

    const bucket = await classifyBucket({ profileDir });
    const dest = path.join(skillsetsDir, bucket, name);
    if (await safeMoveDir({ from: profileDir, to: dest })) {
      moved += 1;
    }
  }

  await writeMigrationState({
    state: {
      applied: [...(state?.applied ?? []), BUCKETS_MIGRATION_ID],
    },
  });

  return { moved };
};
