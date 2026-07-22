import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readJsonObjectFile, writeJsonFileAtomic } from "./jsonFile.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jsonfile-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("readJsonObjectFile", () => {
  it("returns the parsed object for a valid JSON file", async () => {
    const filePath = path.join(tempDir, "a.json");
    await fs.writeFile(filePath, JSON.stringify({ hello: "world", n: 1 }));

    const result = await readJsonObjectFile({ filePath, ifAbsent: {} });

    expect(result).toEqual({ hello: "world", n: 1 });
  });

  it("returns the ifAbsent default when the file does not exist", async () => {
    const filePath = path.join(tempDir, "missing.json");
    const fallback = { $schema: "https://example.com/schema.json" };

    const result = await readJsonObjectFile({ filePath, ifAbsent: fallback });

    expect(result).toEqual(fallback);
  });

  it("treats an empty or whitespace-only file as absent", async () => {
    const filePath = path.join(tempDir, "empty.json");
    await fs.writeFile(filePath, "   \n");
    const fallback = { seeded: true };

    const result = await readJsonObjectFile({ filePath, ifAbsent: fallback });

    expect(result).toEqual(fallback);
  });

  it("throws instead of clobbering when the file exists but is not valid JSON", async () => {
    const filePath = path.join(tempDir, "corrupt.json");
    const original = '{ "a": 1, } trailing garbage';
    await fs.writeFile(filePath, original);

    await expect(
      readJsonObjectFile({ filePath, ifAbsent: {} }),
    ).rejects.toThrow();

    // The user's file must be left byte-for-byte intact.
    expect(await fs.readFile(filePath, "utf-8")).toBe(original);
  });

  it("throws and preserves the file when the JSON is valid but not a plain object", async () => {
    for (const bad of ["null", "[1,2,3]", '"a string"', "42"]) {
      const filePath = path.join(tempDir, "bad.json");
      await fs.writeFile(filePath, bad);

      await expect(
        readJsonObjectFile({ filePath, ifAbsent: {} }),
      ).rejects.toThrow();
      expect(await fs.readFile(filePath, "utf-8")).toBe(bad);
    }
  });
});

describe("writeJsonFileAtomic", () => {
  it("writes JSON that round-trips back to the same value", async () => {
    const filePath = path.join(tempDir, "out.json");

    await writeJsonFileAtomic({
      filePath,
      value: { a: 1, nested: { b: [1, 2] } },
    });

    expect(JSON.parse(await fs.readFile(filePath, "utf-8"))).toEqual({
      a: 1,
      nested: { b: [1, 2] },
    });
  });

  it("creates missing parent directories", async () => {
    const filePath = path.join(tempDir, "deep", "nested", "out.json");

    await writeJsonFileAtomic({ filePath, value: { ok: true } });

    expect(JSON.parse(await fs.readFile(filePath, "utf-8"))).toEqual({
      ok: true,
    });
  });

  it("leaves no temporary files beside the target", async () => {
    const filePath = path.join(tempDir, "out.json");

    await writeJsonFileAtomic({ filePath, value: { ok: true } });

    expect(await fs.readdir(tempDir)).toEqual(["out.json"]);
  });

  it("replaces existing content entirely", async () => {
    const filePath = path.join(tempDir, "out.json");
    await fs.writeFile(filePath, JSON.stringify({ old: true, gone: 1 }));

    await writeJsonFileAtomic({ filePath, value: { fresh: true } });

    expect(JSON.parse(await fs.readFile(filePath, "utf-8"))).toEqual({
      fresh: true,
    });
  });

  it("preserves the existing file's permission mode when overwriting", async () => {
    const filePath = path.join(tempDir, "secret.json");
    await fs.writeFile(filePath, JSON.stringify({ a: 1 }));
    await fs.chmod(filePath, 0o600);

    await writeJsonFileAtomic({ filePath, value: { b: 2 } });

    const mode = (await fs.stat(filePath)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("updates a symlink target without replacing the symlink", async () => {
    const targetDir = path.join(tempDir, "target");
    await fs.mkdir(targetDir);
    const targetPath = path.join(targetDir, "settings.json");
    const symlinkPath = path.join(tempDir, "settings.json");
    await fs.writeFile(targetPath, JSON.stringify({ old: true }));
    await fs.symlink(targetPath, symlinkPath);

    await writeJsonFileAtomic({
      filePath: symlinkPath,
      value: { fresh: true },
    });

    expect((await fs.lstat(symlinkPath)).isSymbolicLink()).toBe(true);
    expect(JSON.parse(await fs.readFile(targetPath, "utf-8"))).toEqual({
      fresh: true,
    });
  });

  it("creates the temporary file with the existing restricted mode before writing", async () => {
    const filePath = path.join(tempDir, "secret.json");
    await fs.writeFile(filePath, JSON.stringify({ a: 1 }));
    await fs.chmod(filePath, 0o600);
    const originalUmask = process.umask(0o000);
    const observedModes = new Set<number>();
    let writeFinished = false;

    try {
      const writePromise = writeJsonFileAtomic({
        filePath,
        // Large enough to observe the temp file while the write is in flight,
        // before a post-write chmod could mask the creation mode.
        value: { secret: "x".repeat(128 * 1024 * 1024) },
      }).finally(() => {
        writeFinished = true;
      });

      while (!writeFinished) {
        const entries = await fs.readdir(tempDir);
        for (const entry of entries) {
          if (entry.startsWith("secret.json.tmp-")) {
            try {
              const mode =
                (await fs.stat(path.join(tempDir, entry))).mode & 0o777;
              observedModes.add(mode);
            } catch (err) {
              // The atomic rename can occur between readdir and stat.
              if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
                throw err;
              }
            }
          }
        }
        await new Promise((resolve) => setImmediate(resolve));
      }

      await writePromise;
    } finally {
      process.umask(originalUmask);
    }

    expect(observedModes.size).toBeGreaterThan(0);
    expect([...observedModes]).toEqual([0o600]);
  });
});
