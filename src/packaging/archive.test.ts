import * as fs from "fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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

const execFileAsync = promisify(execFile);

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

  it("packs files from symlinked directories", async () => {
    const sourceDir = await seedSourceDir();
    const linkedSkillDir = path.join(tempDir, "linked-skill");
    await fs.mkdir(linkedSkillDir, { recursive: true });
    await fs.writeFile(path.join(linkedSkillDir, "SKILL.md"), "# linked");
    await fs.symlink(
      linkedSkillDir,
      path.join(sourceDir, "skills", "linked"),
      "dir",
    );

    const archive = await createArchive({ sourceDir });
    const destDir = path.join(tempDir, "dest-linked");
    await fs.mkdir(destDir, { recursive: true });
    await extractArchive({
      tarballData: toArrayBuffer({ buf: archive }),
      targetDir: destDir,
    });

    expect(
      await fs.readFile(
        path.join(destDir, "skills", "linked", "SKILL.md"),
        "utf-8",
      ),
    ).toBe("# linked");
  });

  it("excludes directory and file symlink aliases into Git metadata", async () => {
    const sourceDir = await seedSourceDir();
    await fs.mkdir(path.join(sourceDir, ".git", "objects"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(sourceDir, ".git", "config"),
      '[remote "origin"]\nurl = https://secret@example.test/repo.git\n',
    );
    await fs.writeFile(
      path.join(sourceDir, ".git", "objects", "secret"),
      "object data",
    );
    await fs.symlink(".git", path.join(sourceDir, "metadata"), "dir");
    await fs.symlink(
      path.join(".git", "config"),
      path.join(sourceDir, "metadata-config"),
      "file",
    );

    const archive = await createArchive({ sourceDir });
    const destDir = path.join(tempDir, "dest-git-aliases");
    await fs.mkdir(destDir, { recursive: true });
    await extractArchive({
      tarballData: toArrayBuffer({ buf: archive }),
      targetDir: destDir,
    });

    await expect(fs.access(path.join(destDir, "metadata"))).rejects.toThrow();
    await expect(
      fs.access(path.join(destDir, "metadata-config")),
    ).rejects.toThrow();
  });

  it("excludes aliases into a linked worktree's common Git metadata", async () => {
    const repositoryDir = path.join(tempDir, "repository");
    const commonMetadataDir = path.join(tempDir, "shared-metadata");
    const worktreeDir = path.join(tempDir, "linked-worktree");
    await execFileAsync(
      "git",
      [
        "init",
        "--quiet",
        "--separate-git-dir",
        commonMetadataDir,
        repositoryDir,
      ],
      { cwd: tempDir },
    );
    await fs.writeFile(
      path.join(repositoryDir, "nori.json"),
      '{"name":"linked"}',
    );
    await execFileAsync("git", ["add", "nori.json"], { cwd: repositoryDir });
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=Nori Test",
        "-c",
        "user.email=nori-test@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "initial",
      ],
      { cwd: repositoryDir },
    );
    await execFileAsync(
      "git",
      ["worktree", "add", "--quiet", "--detach", worktreeDir],
      { cwd: repositoryDir },
    );
    await fs.symlink(
      commonMetadataDir,
      path.join(worktreeDir, "metadata"),
      "dir",
    );

    const archive = await createArchive({ sourceDir: worktreeDir });
    const destDir = path.join(tempDir, "dest-linked-worktree");
    await fs.mkdir(destDir);
    await extractArchive({
      tarballData: toArrayBuffer({ buf: archive }),
      targetDir: destDir,
    });

    await expect(
      fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    ).resolves.toContain('"name":"linked"');
    await expect(fs.access(path.join(destDir, "metadata"))).rejects.toThrow();
  });

  it("excludes aliases into ancestor Git metadata for a subdirectory upload", async () => {
    const repositoryDir = path.join(tempDir, "skill-repository");
    const skillDir = path.join(repositoryDir, "skills", "demo");
    await fs.mkdir(skillDir, { recursive: true });
    await execFileAsync("git", ["init", "--quiet"], { cwd: repositoryDir });
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "# demo");
    await fs.symlink(
      path.join(repositoryDir, ".git"),
      path.join(skillDir, "metadata"),
      "dir",
    );

    const archive = await createArchive({ sourceDir: skillDir });
    const destDir = path.join(tempDir, "dest-subdirectory");
    await fs.mkdir(destDir);
    await extractArchive({
      tarballData: toArrayBuffer({ buf: archive }),
      targetDir: destDir,
    });

    await expect(
      fs.readFile(path.join(destDir, "SKILL.md"), "utf-8"),
    ).resolves.toBe("# demo");
    await expect(fs.access(path.join(destDir, "metadata"))).rejects.toThrow();
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
