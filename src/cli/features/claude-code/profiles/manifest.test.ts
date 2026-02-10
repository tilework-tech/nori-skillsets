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
  MANAGED_FILES,
  MANAGED_DIRS,
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
      // Create nested structure using managed paths
      const skillDir = path.join(tempDir, "skills", "my-skill");
      await fs.mkdir(skillDir, { recursive: true });

      await fs.writeFile(path.join(tempDir, "CLAUDE.md"), "root content");
      await fs.writeFile(path.join(skillDir, "SKILL.md"), "nested content");

      const manifest = await computeDirectoryManifest({
        dir: tempDir,
        profileName: "test-profile",
      });

      expect(manifest.files["CLAUDE.md"]).toBeDefined();
      expect(manifest.files["skills/my-skill/SKILL.md"]).toBeDefined();
      expect(Object.keys(manifest.files)).toHaveLength(2);
    });

    it("should use relative paths from base directory", async () => {
      const agentsDir = path.join(tempDir, "agents");
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.writeFile(path.join(agentsDir, "my-agent.md"), "content");

      const manifest = await computeDirectoryManifest({
        dir: tempDir,
        profileName: "test-profile",
      });

      // Should be relative to tempDir
      expect(manifest.files["agents/my-agent.md"]).toBeDefined();
    });

    it("should include profile name and version in manifest", async () => {
      await fs.writeFile(path.join(tempDir, "CLAUDE.md"), "content");

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
      const commandsDir = path.join(tempDir, "commands");
      await fs.mkdir(commandsDir, { recursive: true });
      await fs.writeFile(path.join(commandsDir, "test.md"), "content");

      const manifest = await computeDirectoryManifest({
        dir: tempDir,
        profileName: "test-profile",
      });

      // Should only have the file, not the directory itself
      expect(manifest.files["commands"]).toBeUndefined();
      expect(manifest.files["commands/test.md"]).toBeDefined();
    });

    it("should only include files in Nori-managed paths", async () => {
      // Create Nori-managed files
      await fs.writeFile(path.join(tempDir, "CLAUDE.md"), "managed block");
      await fs.writeFile(path.join(tempDir, "settings.json"), '{"hooks":{}}');
      await fs.writeFile(
        path.join(tempDir, "nori-statusline.sh"),
        "#!/bin/bash",
      );
      const skillsDir = path.join(tempDir, "skills", "my-skill");
      await fs.mkdir(skillsDir, { recursive: true });
      await fs.writeFile(path.join(skillsDir, "SKILL.md"), "skill content");

      // Create non-Nori files (Claude Code runtime)
      const debugDir = path.join(tempDir, "debug");
      await fs.mkdir(debugDir, { recursive: true });
      await fs.writeFile(path.join(debugDir, "uuid.txt"), "debug log");
      const todosDir = path.join(tempDir, "todos");
      await fs.mkdir(todosDir, { recursive: true });
      await fs.writeFile(path.join(todosDir, "bar.json"), '{"todo":true}');
      const projectsDir = path.join(tempDir, "projects");
      await fs.mkdir(projectsDir, { recursive: true });
      await fs.writeFile(path.join(projectsDir, "proj.json"), "{}");

      const manifest = await computeDirectoryManifest({
        dir: tempDir,
        profileName: "test-profile",
      });

      // Nori-managed files should be present
      expect(manifest.files["CLAUDE.md"]).toBeDefined();
      expect(manifest.files["settings.json"]).toBeDefined();
      expect(manifest.files["nori-statusline.sh"]).toBeDefined();
      expect(manifest.files["skills/my-skill/SKILL.md"]).toBeDefined();

      // Non-Nori files should be excluded
      expect(manifest.files["debug/uuid.txt"]).toBeUndefined();
      expect(manifest.files["todos/bar.json"]).toBeUndefined();
      expect(manifest.files["projects/proj.json"]).toBeUndefined();
    });

    it("should include all files recursively under whitelisted directories", async () => {
      const skillA = path.join(tempDir, "skills", "a");
      const skillB = path.join(tempDir, "skills", "b");
      const agentsDir = path.join(tempDir, "agents");
      const commandsDir = path.join(tempDir, "commands");
      await fs.mkdir(skillA, { recursive: true });
      await fs.mkdir(skillB, { recursive: true });
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.mkdir(commandsDir, { recursive: true });

      await fs.writeFile(path.join(skillA, "SKILL.md"), "skill a");
      await fs.writeFile(path.join(skillB, "SKILL.md"), "skill b");
      await fs.writeFile(path.join(agentsDir, "foo.md"), "agent foo");
      await fs.writeFile(path.join(commandsDir, "bar.md"), "command bar");

      const manifest = await computeDirectoryManifest({
        dir: tempDir,
        profileName: "test-profile",
      });

      expect(manifest.files["skills/a/SKILL.md"]).toBeDefined();
      expect(manifest.files["skills/b/SKILL.md"]).toBeDefined();
      expect(manifest.files["agents/foo.md"]).toBeDefined();
      expect(manifest.files["commands/bar.md"]).toBeDefined();
      expect(Object.keys(manifest.files)).toHaveLength(4);
    });

    it("should exclude unknown root-level files", async () => {
      await fs.writeFile(path.join(tempDir, "CLAUDE.md"), "managed");
      await fs.writeFile(path.join(tempDir, "some-random-file.txt"), "random");
      await fs.writeFile(path.join(tempDir, "keybindings.json"), "{}");

      const manifest = await computeDirectoryManifest({
        dir: tempDir,
        profileName: "test-profile",
      });

      expect(manifest.files["CLAUDE.md"]).toBeDefined();
      expect(manifest.files["some-random-file.txt"]).toBeUndefined();
      expect(manifest.files["keybindings.json"]).toBeUndefined();
      expect(Object.keys(manifest.files)).toHaveLength(1);
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
      // Create original file and manifest using a managed file
      await fs.writeFile(path.join(tempDir, "CLAUDE.md"), "original content");
      const manifest: FileManifest = {
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        profileName: "test-profile",
        files: {
          "CLAUDE.md": await computeFileHash({
            filePath: path.join(tempDir, "CLAUDE.md"),
          }),
        },
      };

      // Modify the file
      await fs.writeFile(path.join(tempDir, "CLAUDE.md"), "modified content");

      const diff = await compareManifest({ manifest, currentDir: tempDir });

      expect(diff.modified).toContain("CLAUDE.md");
      expect(diff.added).toHaveLength(0);
      expect(diff.deleted).toHaveLength(0);
    });

    it("should detect added files", async () => {
      // Create manifest with one managed file
      await fs.writeFile(path.join(tempDir, "CLAUDE.md"), "original");
      const manifest: FileManifest = {
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        profileName: "test-profile",
        files: {
          "CLAUDE.md": await computeFileHash({
            filePath: path.join(tempDir, "CLAUDE.md"),
          }),
        },
      };

      // Add a new managed file
      await fs.writeFile(path.join(tempDir, "settings.json"), '{"new": true}');

      const diff = await compareManifest({ manifest, currentDir: tempDir });

      expect(diff.added).toContain("settings.json");
      expect(diff.modified).toHaveLength(0);
      expect(diff.deleted).toHaveLength(0);
    });

    it("should detect deleted files", async () => {
      // Create manifest with a managed file that no longer exists
      const manifest: FileManifest = {
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        profileName: "test-profile",
        files: {
          "settings.json": "somehash123",
        },
      };

      const diff = await compareManifest({ manifest, currentDir: tempDir });

      expect(diff.deleted).toContain("settings.json");
      expect(diff.modified).toHaveLength(0);
      expect(diff.added).toHaveLength(0);
    });

    it("should return empty diff when no changes", async () => {
      await fs.writeFile(path.join(tempDir, "CLAUDE.md"), "content");
      const hash = await computeFileHash({
        filePath: path.join(tempDir, "CLAUDE.md"),
      });

      const manifest: FileManifest = {
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        profileName: "test-profile",
        files: {
          "CLAUDE.md": hash,
        },
      };

      const diff = await compareManifest({ manifest, currentDir: tempDir });

      expect(diff.modified).toHaveLength(0);
      expect(diff.added).toHaveLength(0);
      expect(diff.deleted).toHaveLength(0);
    });

    it("should detect multiple changes at once", async () => {
      // Set up initial state with managed paths
      await fs.writeFile(path.join(tempDir, "CLAUDE.md"), "unchanged");
      await fs.writeFile(
        path.join(tempDir, "settings.json"),
        '{"original": true}',
      );

      const manifest: FileManifest = {
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        profileName: "test-profile",
        files: {
          "CLAUDE.md": await computeFileHash({
            filePath: path.join(tempDir, "CLAUDE.md"),
          }),
          "settings.json": await computeFileHash({
            filePath: path.join(tempDir, "settings.json"),
          }),
          "nori-statusline.sh": "somehash",
        },
      };

      // Make changes
      await fs.writeFile(
        path.join(tempDir, "settings.json"),
        '{"changed": true}',
      );
      const agentsDir = path.join(tempDir, "agents");
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.writeFile(path.join(agentsDir, "new.md"), "new agent");

      const diff = await compareManifest({ manifest, currentDir: tempDir });

      expect(diff.modified).toContain("settings.json");
      expect(diff.added).toContain("agents/new.md");
      expect(diff.deleted).toContain("nori-statusline.sh");
      expect(diff.modified).not.toContain("CLAUDE.md");
    });

    it("should handle nested directory changes", async () => {
      const skillDir = path.join(tempDir, "skills", "my-skill");
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, "SKILL.md"), "original");

      const manifest: FileManifest = {
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        profileName: "test-profile",
        files: {
          "skills/my-skill/SKILL.md": await computeFileHash({
            filePath: path.join(skillDir, "SKILL.md"),
          }),
        },
      };

      // Modify nested file
      await fs.writeFile(path.join(skillDir, "SKILL.md"), "modified");

      const diff = await compareManifest({ manifest, currentDir: tempDir });

      expect(diff.modified).toContain("skills/my-skill/SKILL.md");
    });

    it("should not report non-whitelisted files as added", async () => {
      // Manifest tracks only CLAUDE.md
      await fs.writeFile(path.join(tempDir, "CLAUDE.md"), "content");
      const manifest: FileManifest = {
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        profileName: "test-profile",
        files: {
          "CLAUDE.md": await computeFileHash({
            filePath: path.join(tempDir, "CLAUDE.md"),
          }),
        },
      };

      // Claude Code creates runtime files on disk
      const debugDir = path.join(tempDir, "debug");
      await fs.mkdir(debugDir, { recursive: true });
      await fs.writeFile(path.join(debugDir, "foo.txt"), "debug log");
      await fs.writeFile(path.join(tempDir, "keybindings.json"), "{}");

      const diff = await compareManifest({ manifest, currentDir: tempDir });

      // Non-whitelisted files should not appear as added
      expect(diff.added).toHaveLength(0);
      expect(diff.modified).toHaveLength(0);
      expect(diff.deleted).toHaveLength(0);
    });

    it("should ignore old manifest entries for non-whitelisted paths", async () => {
      // Old manifest that tracked everything (before whitelist fix)
      await fs.writeFile(path.join(tempDir, "CLAUDE.md"), "content");
      const manifest: FileManifest = {
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        profileName: "test-profile",
        files: {
          "CLAUDE.md": await computeFileHash({
            filePath: path.join(tempDir, "CLAUDE.md"),
          }),
          "debug/old-session.txt": "somehash",
          "todos/old-todo.json": "somehash",
          "projects/old-project.json": "somehash",
        },
      };

      const diff = await compareManifest({ manifest, currentDir: tempDir });

      // Old non-whitelisted entries should NOT appear as deleted
      expect(diff.deleted).toHaveLength(0);
      expect(diff.modified).toHaveLength(0);
      expect(diff.added).toHaveLength(0);
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

describe("manifest managed paths", () => {
  it("should define the Nori-managed root files", () => {
    expect(MANAGED_FILES).toContain("CLAUDE.md");
    expect(MANAGED_FILES).toContain("settings.json");
    expect(MANAGED_FILES).toContain("nori-statusline.sh");
  });

  it("should define the Nori-managed directories", () => {
    expect(MANAGED_DIRS).toContain("skills");
    expect(MANAGED_DIRS).toContain("commands");
    expect(MANAGED_DIRS).toContain("agents");
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
