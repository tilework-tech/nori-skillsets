/**
 * Tests for manifest module
 * Verifies file hashing, manifest creation, and change detection
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  computeFileHash,
  computeDirectoryManifest,
  writeManifest,
  readManifest,
  compareManifest,
  getManifestPath,
  hasChanges,
  type FileManifest,
  type ManifestDiff,
} from "./manifest.js";

describe("manifest", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "manifest-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("computeFileHash", () => {
    it("should return consistent hash for same content", async () => {
      const filePath = path.join(tempDir, "test.txt");
      await fs.writeFile(filePath, "hello world");

      const hash1 = await computeFileHash({ filePath });
      const hash2 = await computeFileHash({ filePath });

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 produces 64 hex chars
    });

    it("should return different hash for different content", async () => {
      const file1 = path.join(tempDir, "file1.txt");
      const file2 = path.join(tempDir, "file2.txt");
      await fs.writeFile(file1, "hello");
      await fs.writeFile(file2, "world");

      const hash1 = await computeFileHash({ filePath: file1 });
      const hash2 = await computeFileHash({ filePath: file2 });

      expect(hash1).not.toBe(hash2);
    });

    it("should handle binary files", async () => {
      const filePath = path.join(tempDir, "binary.bin");
      const buffer = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);
      await fs.writeFile(filePath, buffer);

      const hash = await computeFileHash({ filePath });

      expect(hash).toHaveLength(64);
    });

    it("should handle empty files", async () => {
      const filePath = path.join(tempDir, "empty.txt");
      await fs.writeFile(filePath, "");

      const hash = await computeFileHash({ filePath });

      expect(hash).toHaveLength(64);
      // SHA-256 of empty string is well-known
      expect(hash).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
    });
  });

  describe("computeDirectoryManifest", () => {
    it("should include all files recursively", async () => {
      // Create nested structure
      const subDir = path.join(tempDir, "sub");
      await fs.mkdir(subDir, { recursive: true });

      await fs.writeFile(path.join(tempDir, "root.txt"), "root content");
      await fs.writeFile(path.join(subDir, "nested.txt"), "nested content");

      const manifest = await computeDirectoryManifest({
        dir: tempDir,
        profileName: "test-profile",
      });

      expect(manifest.files["root.txt"]).toBeDefined();
      expect(manifest.files["sub/nested.txt"]).toBeDefined();
      expect(Object.keys(manifest.files)).toHaveLength(2);
    });

    it("should use relative paths from base directory", async () => {
      const skillsDir = path.join(tempDir, "skills");
      const mySkill = path.join(skillsDir, "my-skill");
      await fs.mkdir(mySkill, { recursive: true });
      await fs.writeFile(path.join(mySkill, "SKILL.md"), "content");

      const manifest = await computeDirectoryManifest({
        dir: skillsDir,
        profileName: "test-profile",
      });

      // Should be relative to skillsDir
      expect(manifest.files["my-skill/SKILL.md"]).toBeDefined();
    });

    it("should include profile name and version in manifest", async () => {
      await fs.writeFile(path.join(tempDir, "test.txt"), "content");

      const manifest = await computeDirectoryManifest({
        dir: tempDir,
        profileName: "my-profile",
      });

      expect(manifest.version).toBe(1);
      expect(manifest.profileName).toBe("my-profile");
      expect(manifest.createdAt).toBeDefined();
    });

    it("should handle empty directory", async () => {
      const emptyDir = path.join(tempDir, "empty");
      await fs.mkdir(emptyDir, { recursive: true });

      const manifest = await computeDirectoryManifest({
        dir: emptyDir,
        profileName: "test-profile",
      });

      expect(Object.keys(manifest.files)).toHaveLength(0);
    });

    it("should skip directories and only hash files", async () => {
      const subDir = path.join(tempDir, "subdir");
      await fs.mkdir(subDir, { recursive: true });
      await fs.writeFile(path.join(subDir, "file.txt"), "content");

      const manifest = await computeDirectoryManifest({
        dir: tempDir,
        profileName: "test-profile",
      });

      // Should only have the file, not the directory itself
      expect(manifest.files["subdir"]).toBeUndefined();
      expect(manifest.files["subdir/file.txt"]).toBeDefined();
    });
  });

  describe("writeManifest and readManifest", () => {
    it("should round-trip correctly", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      const manifest: FileManifest = {
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        profileName: "test-profile",
        files: {
          "file1.txt": "abc123",
          "dir/file2.txt": "def456",
        },
      };

      await writeManifest({ manifestPath, manifest });
      const loaded = await readManifest({ manifestPath });

      expect(loaded).toEqual(manifest);
    });

    it("should return null when manifest does not exist", async () => {
      const manifestPath = path.join(tempDir, "nonexistent.json");

      const result = await readManifest({ manifestPath });

      expect(result).toBeNull();
    });

    it("should create parent directories if needed", async () => {
      const manifestPath = path.join(
        tempDir,
        "deep",
        "nested",
        "manifest.json",
      );
      const manifest: FileManifest = {
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        profileName: "test-profile",
        files: {},
      };

      await writeManifest({ manifestPath, manifest });

      const exists = await fs
        .access(manifestPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe("compareManifest", () => {
    it("should detect modified files", async () => {
      // Create original file and manifest
      await fs.writeFile(path.join(tempDir, "file.txt"), "original content");
      const manifest: FileManifest = {
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        profileName: "test-profile",
        files: {
          "file.txt": await computeFileHash({
            filePath: path.join(tempDir, "file.txt"),
          }),
        },
      };

      // Modify the file
      await fs.writeFile(path.join(tempDir, "file.txt"), "modified content");

      const diff = await compareManifest({ manifest, currentDir: tempDir });

      expect(diff.modified).toContain("file.txt");
      expect(diff.added).toHaveLength(0);
      expect(diff.deleted).toHaveLength(0);
    });

    it("should detect added files", async () => {
      // Create manifest with one file
      await fs.writeFile(path.join(tempDir, "original.txt"), "original");
      const manifest: FileManifest = {
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        profileName: "test-profile",
        files: {
          "original.txt": await computeFileHash({
            filePath: path.join(tempDir, "original.txt"),
          }),
        },
      };

      // Add a new file
      await fs.writeFile(path.join(tempDir, "new-file.txt"), "new content");

      const diff = await compareManifest({ manifest, currentDir: tempDir });

      expect(diff.added).toContain("new-file.txt");
      expect(diff.modified).toHaveLength(0);
      expect(diff.deleted).toHaveLength(0);
    });

    it("should detect deleted files", async () => {
      // Create manifest with a file that no longer exists
      const manifest: FileManifest = {
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        profileName: "test-profile",
        files: {
          "deleted-file.txt": "somehash123",
        },
      };

      const diff = await compareManifest({ manifest, currentDir: tempDir });

      expect(diff.deleted).toContain("deleted-file.txt");
      expect(diff.modified).toHaveLength(0);
      expect(diff.added).toHaveLength(0);
    });

    it("should return empty diff when no changes", async () => {
      await fs.writeFile(path.join(tempDir, "file.txt"), "content");
      const hash = await computeFileHash({
        filePath: path.join(tempDir, "file.txt"),
      });

      const manifest: FileManifest = {
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        profileName: "test-profile",
        files: {
          "file.txt": hash,
        },
      };

      const diff = await compareManifest({ manifest, currentDir: tempDir });

      expect(diff.modified).toHaveLength(0);
      expect(diff.added).toHaveLength(0);
      expect(diff.deleted).toHaveLength(0);
    });

    it("should detect multiple changes at once", async () => {
      // Set up initial state
      await fs.writeFile(path.join(tempDir, "keep.txt"), "unchanged");
      await fs.writeFile(path.join(tempDir, "modify.txt"), "original");

      const manifest: FileManifest = {
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        profileName: "test-profile",
        files: {
          "keep.txt": await computeFileHash({
            filePath: path.join(tempDir, "keep.txt"),
          }),
          "modify.txt": await computeFileHash({
            filePath: path.join(tempDir, "modify.txt"),
          }),
          "deleted.txt": "somehash",
        },
      };

      // Make changes
      await fs.writeFile(path.join(tempDir, "modify.txt"), "changed");
      await fs.writeFile(path.join(tempDir, "added.txt"), "new file");

      const diff = await compareManifest({ manifest, currentDir: tempDir });

      expect(diff.modified).toContain("modify.txt");
      expect(diff.added).toContain("added.txt");
      expect(diff.deleted).toContain("deleted.txt");
      expect(diff.modified).not.toContain("keep.txt");
    });

    it("should handle nested directory changes", async () => {
      const subDir = path.join(tempDir, "nested");
      await fs.mkdir(subDir, { recursive: true });
      await fs.writeFile(path.join(subDir, "file.txt"), "original");

      const manifest: FileManifest = {
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        profileName: "test-profile",
        files: {
          "nested/file.txt": await computeFileHash({
            filePath: path.join(subDir, "file.txt"),
          }),
        },
      };

      // Modify nested file
      await fs.writeFile(path.join(subDir, "file.txt"), "modified");

      const diff = await compareManifest({ manifest, currentDir: tempDir });

      expect(diff.modified).toContain("nested/file.txt");
    });
  });

  describe("getManifestPath", () => {
    it("should return path in ~/.nori directory", () => {
      const manifestPath = getManifestPath();

      expect(manifestPath).toBe(
        path.join(os.homedir(), ".nori", "installed-manifest.json"),
      );
    });
  });
});

describe("manifest hasChanges helper", () => {
  it("should report no changes for empty diff", async () => {
    const diff: ManifestDiff = {
      modified: [],
      added: [],
      deleted: [],
    };

    expect(hasChanges(diff)).toBe(false);
  });

  it("should report changes when any array is non-empty", async () => {
    const diffs: Array<ManifestDiff> = [
      { modified: ["file.txt"], added: [], deleted: [] },
      { modified: [], added: ["file.txt"], deleted: [] },
      { modified: [], added: [], deleted: ["file.txt"] },
    ];

    for (const diff of diffs) {
      expect(hasChanges(diff)).toBe(true);
    }
  });
});
