import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  computeArchiveShasum,
  createArchive,
  extractArchive,
  extractFileFromArchive,
  isGzipped,
  verifyArchiveChecksum,
} from "./archive.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "packaging-archive-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

const toArrayBuffer = (args: { buf: Buffer }): ArrayBuffer => {
  const { buf } = args;
  const out = new ArrayBuffer(buf.byteLength);
  new Uint8Array(out).set(buf);
  return out;
};

const seedSourceDir = async (): Promise<string> => {
  const sourceDir = path.join(tempDir, "source");
  await fs.mkdir(path.join(sourceDir, "skills", "demo"), { recursive: true });
  await fs.writeFile(path.join(sourceDir, "nori.json"), '{"name":"x"}');
  await fs.writeFile(
    path.join(sourceDir, "skills", "demo", "SKILL.md"),
    "# demo",
  );
  // Excluded-by-filter content must not be packed
  await fs.mkdir(path.join(sourceDir, "node_modules", "dep"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(sourceDir, "node_modules", "dep", "index.js"),
    "x",
  );
  return sourceDir;
};

const archiveAndExtract = async (args: {
  destinationName: string;
  sourceDir: string;
}): Promise<string> => {
  const archive = await createArchive({ sourceDir: args.sourceDir });
  const destDir = path.join(tempDir, args.destinationName);
  await fs.mkdir(destDir, { recursive: true });
  await extractArchive({
    tarballData: toArrayBuffer({ buf: archive }),
    targetDir: destDir,
  });
  return destDir;
};

describe("isGzipped", () => {
  it("detects gzip magic bytes", () => {
    expect(isGzipped({ buffer: Buffer.from([0x1f, 0x8b, 0x00]) })).toBe(true);
    expect(isGzipped({ buffer: Buffer.from([0x50, 0x4b]) })).toBe(false);
    expect(isGzipped({ buffer: Buffer.from([]) })).toBe(false);
  });
});

describe("createArchive + extractArchive roundtrip", () => {
  it("packs files, excludes upload-filtered paths, and extracts them back", async () => {
    const sourceDir = await seedSourceDir();
    await fs.mkdir(path.join(sourceDir, ".git", "objects"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(sourceDir, ".git", "config"),
      '[remote "origin"]\nurl = git@example.test:private/repo.git\n',
    );
    await fs.writeFile(path.join(sourceDir, ".git", "objects", "secret"), "x");
    await fs.writeFile(path.join(sourceDir, ".gitignore"), ".nori/\n");
    const archive = await createArchive({ sourceDir });
    expect(isGzipped({ buffer: archive })).toBe(true);

    // No temp tarball left behind next to the source dir
    const parentEntries = await fs.readdir(tempDir);
    expect(parentEntries.filter((e) => e.endsWith(".tgz"))).toHaveLength(0);

    const destDir = path.join(tempDir, "dest");
    await fs.mkdir(destDir, { recursive: true });
    await extractArchive({
      tarballData: toArrayBuffer({ buf: archive }),
      targetDir: destDir,
    });

    expect(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    ).toContain('"name":"x"');
    expect(
      await fs.readFile(
        path.join(destDir, "skills", "demo", "SKILL.md"),
        "utf-8",
      ),
    ).toBe("# demo");
    await expect(
      fs.access(path.join(destDir, "node_modules")),
    ).rejects.toThrow();
    await expect(fs.access(path.join(destDir, ".git"))).rejects.toThrow();
    await expect(
      fs.readFile(path.join(destDir, ".gitignore"), "utf-8"),
    ).resolves.toBe(".nori/\n");
  });

  it("resolves a symlinked top-level source directory", async () => {
    const sourceDir = await seedSourceDir();
    const linkedSourceDir = path.join(tempDir, "linked-source");
    await fs.symlink(sourceDir, linkedSourceDir, "dir");

    const destDir = await archiveAndExtract({
      destinationName: "dest-linked-source",
      sourceDir: linkedSourceDir,
    });

    await expect(
      fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    ).resolves.toContain('"name":"x"');
  });

  it("does not overwrite a sibling matching the former temp archive name", async () => {
    const sourceDir = await seedSourceDir();
    const siblingPath = path.join(tempDir, ".source-upload.tgz");
    await fs.writeFile(siblingPath, "keep me");

    await createArchive({ sourceDir });

    await expect(fs.readFile(siblingPath, "utf-8")).resolves.toBe("keep me");
  });

  it.each([
    { linkName: "linked-file", targetName: "nori.json", type: "file" },
    { linkName: "linked-directory", targetName: "skills", type: "directory" },
    { linkName: "broken-link", targetName: "missing", type: "broken" },
  ])("rejects an interior $type symlink", async ({ linkName, targetName }) => {
    const sourceDir = await seedSourceDir();
    await fs.symlink(targetName, path.join(sourceDir, linkName));

    await expect(createArchive({ sourceDir })).rejects.toThrow(
      new RegExp(`symbolic links?.*${linkName}`, "i"),
    );
    await expect(
      fs
        .readdir(tempDir)
        .then((entries) => entries.filter((entry) => entry.endsWith(".tgz"))),
    ).resolves.toEqual([]);
  });

  it("preserves authored .GIT directories on case-sensitive filesystems", async () => {
    const sourceDir = await seedSourceDir();
    await fs.mkdir(path.join(sourceDir, ".GIT"));
    await fs.writeFile(
      path.join(sourceDir, ".GIT", "README.md"),
      "authored content",
    );
    const aliasesLowercaseGit = await fs
      .realpath(path.join(sourceDir, ".git"))
      .then(() => true)
      .catch(() => false);

    const destDir = await archiveAndExtract({
      destinationName: "dest-uppercase-git",
      sourceDir,
    });

    if (aliasesLowercaseGit) {
      await expect(fs.access(path.join(destDir, ".GIT"))).rejects.toThrow();
    } else {
      await expect(
        fs.readFile(path.join(destDir, ".GIT", "README.md"), "utf-8"),
      ).resolves.toBe("authored content");
    }
  });

  it("excludes a case-variant symlink alias to .git", async () => {
    const sourceDir = await seedSourceDir();
    await fs.mkdir(path.join(sourceDir, ".git"));
    await fs.symlink(".git", path.join(sourceDir, ".GIT"), "dir");

    const destDir = await archiveAndExtract({
      destinationName: "dest-git-case-alias",
      sourceDir,
    });

    await expect(fs.access(path.join(destDir, ".git"))).rejects.toThrow();
    await expect(fs.access(path.join(destDir, ".GIT"))).rejects.toThrow();
  });

  it("ignores symlinks inside Cargo target output", async () => {
    const sourceDir = await seedSourceDir();
    await fs.writeFile(path.join(sourceDir, "Cargo.toml"), "[package]\n");
    await fs.mkdir(path.join(sourceDir, "target"));
    await fs.symlink("missing", path.join(sourceDir, "target", "ignored"));

    const destDir = await archiveAndExtract({
      destinationName: "dest-cargo-target",
      sourceDir,
    });

    await expect(fs.access(path.join(destDir, "target"))).rejects.toThrow();
  });

  it("round-trips an authored filename beginning with @", async () => {
    const tar = await import("tar");
    const sourceDir = await seedSourceDir();
    const payloadDir = path.join(tempDir, "payload");
    const payloadTar = path.join(sourceDir, "@payload.tar");
    await fs.mkdir(payloadDir);
    await fs.writeFile(path.join(payloadDir, "injected.txt"), "not authored");
    await tar.create({ cwd: payloadDir, file: payloadTar }, ["injected.txt"]);
    const expected = await fs.readFile(payloadTar);

    const destDir = await archiveAndExtract({
      destinationName: "dest-at-filename",
      sourceDir,
    });

    await expect(
      fs.readFile(path.join(destDir, "@payload.tar")),
    ).resolves.toEqual(expected);
    await expect(
      fs.access(path.join(destDir, "injected.txt")),
    ).rejects.toThrow();
  });

  it("extracts plain (non-gzipped) tarballs too", async () => {
    const tar = await import("tar");
    const sourceDir = await seedSourceDir();
    const plainTarPath = path.join(tempDir, "plain.tar");
    await tar.create({ file: plainTarPath, cwd: sourceDir, gzip: false }, [
      "nori.json",
    ]);
    const data = await fs.readFile(plainTarPath);
    const destDir = path.join(tempDir, "dest-plain");
    await fs.mkdir(destDir, { recursive: true });
    await extractArchive({
      tarballData: toArrayBuffer({ buf: data }),
      targetDir: destDir,
    });
    await expect(
      fs.access(path.join(destDir, "nori.json")),
    ).resolves.toBeUndefined();
  });
});

describe("extractFileFromArchive", () => {
  it("returns the named file's contents or null", async () => {
    const sourceDir = await seedSourceDir();
    const archive = await createArchive({ sourceDir });
    const data = toArrayBuffer({ buf: archive });

    expect(
      await extractFileFromArchive({
        tarballData: data,
        fileName: "nori.json",
      }),
    ).toContain('"name":"x"');
    expect(
      await extractFileFromArchive({
        tarballData: data,
        fileName: "missing.md",
      }),
    ).toBeNull();
  });
});

describe("computeArchiveShasum / verifyArchiveChecksum", () => {
  it("computes the registry's sha512-base64 format", () => {
    const data = new TextEncoder().encode("hello tarball")
      .buffer as ArrayBuffer;
    const shasum = computeArchiveShasum({ tarballData: data });
    expect(shasum).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
    // Deterministic
    expect(computeArchiveShasum({ tarballData: data })).toBe(shasum);
  });

  it("passes verification when the checksum matches", () => {
    const data = new TextEncoder().encode("content").buffer as ArrayBuffer;
    const shasum = computeArchiveShasum({ tarballData: data });
    expect(() =>
      verifyArchiveChecksum({ tarballData: data, expectedShasum: shasum }),
    ).not.toThrow();
  });

  it("fails loudly when the checksum does not match", () => {
    const data = new TextEncoder().encode("content").buffer as ArrayBuffer;
    expect(() =>
      verifyArchiveChecksum({
        tarballData: data,
        expectedShasum: "sha512-bogus",
      }),
    ).toThrow(/checksum mismatch/i);
  });

  it("skips verification when the registry recorded no checksum", () => {
    const data = new TextEncoder().encode("content").buffer as ArrayBuffer;
    expect(() =>
      verifyArchiveChecksum({ tarballData: data, expectedShasum: null }),
    ).not.toThrow();
    expect(() => verifyArchiveChecksum({ tarballData: data })).not.toThrow();
  });
});
