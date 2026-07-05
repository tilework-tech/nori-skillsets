/**
 * Safe JSON file mutation primitives.
 *
 * Two disciplines the whole codebase must share when it edits a JSON file it
 * does not exclusively own (Claude Code's settings.json / .claude.json, the
 * Nori config): never silently discard content you failed to parse, and never
 * expose a half-written file to a concurrent reader.
 *
 * - `readJsonObjectFile` distinguishes "absent" (return the caller's default)
 *   from "present but corrupt" (throw). It must never fall back to an empty
 *   object for a file that exists — that is how a stray comment or a partial
 *   write turns into total data loss when the caller writes the result back.
 * - `writeJsonFileAtomic` writes to a unique sibling temp file and renames it
 *   into place. rename(2) is atomic within a filesystem, so a crash or a
 *   concurrent read sees either the old file or the new one, never a truncated
 *   mix, and concurrent writers do not collide on a shared temp name.
 */

import * as fs from "fs/promises";
import { randomBytes } from "node:crypto";
import * as path from "path";

/**
 * Read a JSON object from disk, distinguishing absence from corruption.
 *
 * @param args - Arguments
 * @param args.filePath - Path to the JSON file
 * @param args.ifAbsent - Value to return when the file does not exist
 *
 * @throws When the file exists but is not valid JSON, or parses to something
 *   other than a plain object — so callers abort instead of overwriting it.
 *
 * @returns The parsed object, or `ifAbsent` when the file is missing
 *
 */
export const readJsonObjectFile = async (args: {
  filePath: string;
  ifAbsent: Record<string, unknown>;
}): Promise<Record<string, unknown>> => {
  const { filePath, ifAbsent } = args;

  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return ifAbsent;
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(
      `Refusing to modify ${filePath}: it exists but is not valid JSON. ` +
        `Fix or remove the file, then re-run.`,
    );
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    const found = Array.isArray(parsed)
      ? "an array"
      : `${parsed === null ? "null" : typeof parsed}`;
    throw new Error(
      `Refusing to modify ${filePath}: expected a JSON object but found ${found}. ` +
        `Fix or remove the file, then re-run.`,
    );
  }

  return parsed as Record<string, unknown>;
};

/**
 * Write a value as pretty-printed JSON, atomically.
 *
 * @param args - Arguments
 * @param args.filePath - Destination path (parent dirs are created)
 * @param args.value - The value to serialize
 */
export const writeJsonFileAtomic = async (args: {
  filePath: string;
  value: unknown;
}): Promise<void> => {
  const { filePath, value } = args;

  await fs.mkdir(path.dirname(filePath), { recursive: true });

  // Unique sibling temp file: same directory guarantees the rename stays on one
  // filesystem (so it is atomic), and the pid + random suffix keeps concurrent
  // writers from clobbering each other's temp file.
  const tempPath = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`);
    await fs.rename(tempPath, filePath);
  } catch (err) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw err;
  }
};
