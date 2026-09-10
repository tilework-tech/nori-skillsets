import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as FsPromises from "fs/promises";

import { readJsonObjectFile, writeJsonFileAtomic } from "./jsonFile.js";

// Records the mode of the atomic-write temp file at the instant it is created,
// so a test can assert the temp is opened with the restricted mode rather than
// being widened during writing. Recording is opt-in per test via `record`.
const openObservations = vi.hoisted(() => ({
  record: false,
  modes: [] as Array<number>,
}));

// Wrap only `open` from fs/promises; every other operation stays real so the
// rest of the suite exercises the true filesystem.
vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  const open: typeof actual.open = async (...openArgs) => {
    const handle = await actual.open(...openArgs);
    const target = openArgs[0];
    if (
      openObservations.record &&
      typeof target === "string" &&
      target.includes("secret.json.tmp-")
    ) {
      const stat = await actual.stat(target);
      openObservations.modes.push(stat.mode & 0o777);
    }
    return handle;
  };
  return { ...actual, default: { ...actual, open }, open };
});

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

  it("creates the temporary file with the existing restricted mode from the moment it exists", async () => {
    const filePath = path.join(tempDir, "secret.json");
    await fs.writeFile(filePath, JSON.stringify({ a: 1 }));
    await fs.chmod(filePath, 0o600);

    // Observe the temp file's mode at its earliest possible moment — right after
    // it is created — rather than racing an in-flight write. Under a permissive
    // umask, a naive implementation that created the temp at the default mode
    // and only chmod'd it afterward would expose a world-readable window; this
    // captures the mode before any bytes are written, deterministically.
    const originalUmask = process.umask(0o000);
    openObservations.record = true;
    openObservations.modes = [];

    try {
      await writeJsonFileAtomic({ filePath, value: { secret: "value" } });
    } finally {
      openObservations.record = false;
      process.umask(originalUmask);
    }

    expect(openObservations.modes.length).toBeGreaterThan(0);
    expect([...new Set(openObservations.modes)]).toEqual([0o600]);

    // And the published file carries the restricted mode too.
    expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
  });
});
