import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createArchive } from "./archive.js";
import {
  atomicReplaceDirWithArchive,
  extractArchiveToNewDir,
  replaceDirContentsWithArchive,
} from "./atomicReplace.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "packaging-swap-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

const makeArchive = async (args: {
  files: Record<string, string>;
}): Promise<ArrayBuffer> => {
  const { files } = args;
  const stageDir = await fs.mkdtemp(path.join(tempDir, "stage-"));
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(stageDir, rel)), {
      recursive: true,
    });
    await fs.writeFile(path.join(stageDir, rel), content);
  }
  const buf = await createArchive({ sourceDir: stageDir });
  const out = new ArrayBuffer(buf.byteLength);
  new Uint8Array(out).set(buf);
  return out;
};

const BAD_TARBALL: ArrayBuffer = new Uint8Array([
  0x1f, 0x8b, 0x01, 0x02, 0x03, 0x04,
]).buffer;

describe("extractArchiveToNewDir", () => {
  it("creates the target dir and extracts into it", async () => {
    const archive = await makeArchive({ files: { "a.md": "A" } });
    const targetDir = path.join(tempDir, "fresh");
    await extractArchiveToNewDir({ tarballData: archive, targetDir });
    expect(await fs.readFile(path.join(targetDir, "a.md"), "utf-8")).toBe("A");
  });

  it("removes the target dir when extraction fails", async () => {
    const targetDir = path.join(tempDir, "fresh-fail");
    await expect(
      extractArchiveToNewDir({ tarballData: BAD_TARBALL, targetDir }),
    ).rejects.toThrow();
    await expect(fs.access(targetDir)).rejects.toThrow();
  });
});

describe("atomicReplaceDirWithArchive", () => {
  it("replaces existing contents and cleans up temp/backup dirs", async () => {
    const targetDir = path.join(tempDir, "pkg");
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, "old.md"), "old");

    const archive = await makeArchive({ files: { "new.md": "new" } });
    await atomicReplaceDirWithArchive({ tarballData: archive, targetDir });

    expect(await fs.readFile(path.join(targetDir, "new.md"), "utf-8")).toBe(
      "new",
    );
    await expect(fs.access(path.join(targetDir, "old.md"))).rejects.toThrow();
    const siblings = await fs.readdir(tempDir);
    expect(siblings.filter((e) => e.includes("-backup"))).toHaveLength(0);
    expect(siblings.filter((e) => e.includes("-download-temp"))).toHaveLength(
      0,
    );
  });

  it("preserves .nori-version from the old dir when asked", async () => {
    const targetDir = path.join(tempDir, "pkg-v");
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(
      path.join(targetDir, ".nori-version"),
      '{"version":"1"}',
    );

    const archive = await makeArchive({ files: { "new.md": "new" } });
    await atomicReplaceDirWithArchive({
      tarballData: archive,
      targetDir,
      preserveVersionFile: true,
    });

    expect(
      await fs.readFile(path.join(targetDir, ".nori-version"), "utf-8"),
    ).toBe('{"version":"1"}');
  });

  it("leaves the original contents intact when extraction fails", async () => {
    const targetDir = path.join(tempDir, "pkg-fail");
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, "keep.md"), "keep");

    await expect(
      atomicReplaceDirWithArchive({ tarballData: BAD_TARBALL, targetDir }),
    ).rejects.toThrow();

    expect(await fs.readFile(path.join(targetDir, "keep.md"), "utf-8")).toBe(
      "keep",
    );
    const siblings = await fs.readdir(tempDir);
    expect(siblings.filter((e) => e.includes("-download-temp"))).toHaveLength(
      0,
    );
  });
});

describe("replaceDirContentsWithArchive", () => {
  it("replaces contents but keeps preserved entries from the old dir", async () => {
    const targetDir = path.join(tempDir, "skillset");
    await fs.mkdir(path.join(targetDir, "skills", "local-skill"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(targetDir, "skills", "local-skill", "SKILL.md"),
      "local",
    );
    await fs.writeFile(
      path.join(targetDir, ".nori-version"),
      '{"version":"1"}',
    );
    await fs.writeFile(path.join(targetDir, "AGENTS.md"), "old agents");

    // Archive carries its own skills/ which must be discarded
    const archive = await makeArchive({
      files: {
        "AGENTS.md": "new agents",
        "skills/remote-skill/SKILL.md": "remote",
      },
    });

    await replaceDirContentsWithArchive({
      tarballData: archive,
      targetDir,
      preserveEntries: [".nori-version", "skills", "subagents"],
    });

    expect(await fs.readFile(path.join(targetDir, "AGENTS.md"), "utf-8")).toBe(
      "new agents",
    );
    expect(
      await fs.readFile(
        path.join(targetDir, "skills", "local-skill", "SKILL.md"),
        "utf-8",
      ),
    ).toBe("local");
    await expect(
      fs.access(path.join(targetDir, "skills", "remote-skill")),
    ).rejects.toThrow();
    expect(
      await fs.readFile(path.join(targetDir, ".nori-version"), "utf-8"),
    ).toBe('{"version":"1"}');
  });

  it("leaves the original dir untouched when extraction fails", async () => {
    const targetDir = path.join(tempDir, "skillset-fail");
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, "AGENTS.md"), "old agents");

    await expect(
      replaceDirContentsWithArchive({
        tarballData: BAD_TARBALL,
        targetDir,
        preserveEntries: [".nori-version", "skills", "subagents"],
      }),
    ).rejects.toThrow();

    expect(await fs.readFile(path.join(targetDir, "AGENTS.md"), "utf-8")).toBe(
      "old agents",
    );
  });
});
