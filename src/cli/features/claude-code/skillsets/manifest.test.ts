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
  removeManagedFiles,
  EXCLUDED_FILES,
  type FileManifest,
  type ManifestDiff,
} from "@/cli/features/manifest.js";

// Claude Code managed files/dirs for explicit test parameters
const CLAUDE_MANAGED_FILES = [
  "CLAUDE.md",
  "settings.json",
  "nori-statusline.sh",
];
const CLAUDE_MANAGED_DIRS = ["skills", "commands", "agents"];

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
        skillsetName: "test-profile",
        managedFiles: CLAUDE_MANAGED_FILES,
        managedDirs: CLAUDE_MANAGED_DIRS,
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
        skillsetName: "test-profile",
        managedFiles: CLAUDE_MANAGED_FILES,
        managedDirs: CLAUDE_MANAGED_DIRS,
      });

      // Should be relative to tempDir
      expect(manifest.files["agents/my-agent.md"]).toBeDefined();
    });

    it("should include profile name and version in manifest", async () => {
      await fs.writeFile(path.join(tempDir, "CLAUDE.md"), "content");

      const manifest = await computeDirectoryManifest({
        dir: tempDir,
        skillsetName: "my-profile",
        managedFiles: CLAUDE_MANAGED_FILES,
        managedDirs: CLAUDE_MANAGED_DIRS,
      });

      expect(manifest.version).toBe(1);
      expect(manifest.skillsetName).toBe("my-profile");
      expect(manifest.createdAt).toBeDefined();
    });

    it("should handle empty directory", async () => {
      const emptyDir = path.join(tempDir, "empty");
      await fs.mkdir(emptyDir, { recursive: true });

      const manifest = await computeDirectoryManifest({
        dir: emptyDir,
        skillsetName: "test-profile",
        managedFiles: CLAUDE_MANAGED_FILES,
        managedDirs: CLAUDE_MANAGED_DIRS,
      });

      expect(Object.keys(manifest.files)).toHaveLength(0);
    });

    it("should skip directories and only hash files", async () => {
      const commandsDir = path.join(tempDir, "commands");
      await fs.mkdir(commandsDir, { recursive: true });
      await fs.writeFile(path.join(commandsDir, "test.md"), "content");

      const manifest = await computeDirectoryManifest({
        dir: tempDir,
        skillsetName: "test-profile",
        managedFiles: CLAUDE_MANAGED_FILES,
        managedDirs: CLAUDE_MANAGED_DIRS,
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
        skillsetName: "test-profile",
        managedFiles: CLAUDE_MANAGED_FILES,
        managedDirs: CLAUDE_MANAGED_DIRS,
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
        skillsetName: "test-profile",
        managedFiles: CLAUDE_MANAGED_FILES,
        managedDirs: CLAUDE_MANAGED_DIRS,
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
        skillsetName: "test-profile",
        managedFiles: CLAUDE_MANAGED_FILES,
        managedDirs: CLAUDE_MANAGED_DIRS,
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
        skillsetName: "test-profile",
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
        skillsetName: "test-profile",
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
        skillsetName: "test-profile",
        files: {
          "CLAUDE.md": await computeFileHash({
            filePath: path.join(tempDir, "CLAUDE.md"),
          }),
        },
      };

      // Modify the file
      await fs.writeFile(path.join(tempDir, "CLAUDE.md"), "modified content");

      const diff = await compareManifest({
        manifest,
        currentDir: tempDir,
        managedFiles: CLAUDE_MANAGED_FILES,
        managedDirs: CLAUDE_MANAGED_DIRS,
      });

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
        skillsetName: "test-profile",
        files: {
          "CLAUDE.md": await computeFileHash({
            filePath: path.join(tempDir, "CLAUDE.md"),
          }),
        },
      };

      // Add a new managed file
      await fs.writeFile(path.join(tempDir, "settings.json"), '{"new": true}');

      const diff = await compareManifest({
        manifest,
        currentDir: tempDir,
        managedFiles: CLAUDE_MANAGED_FILES,
        managedDirs: CLAUDE_MANAGED_DIRS,
      });

      expect(diff.added).toContain("settings.json");
      expect(diff.modified).toHaveLength(0);
      expect(diff.deleted).toHaveLength(0);
    });

    it("should detect deleted files", async () => {
      // Create manifest with a managed file that no longer exists
      const manifest: FileManifest = {
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        skillsetName: "test-profile",
        files: {
          "settings.json": "somehash123",
        },
      };

      const diff = await compareManifest({
        manifest,
        currentDir: tempDir,
        managedFiles: CLAUDE_MANAGED_FILES,
        managedDirs: CLAUDE_MANAGED_DIRS,
      });

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
        skillsetName: "test-profile",
        files: {
          "CLAUDE.md": hash,
        },
      };

      const diff = await compareManifest({
        manifest,
        currentDir: tempDir,
        managedFiles: CLAUDE_MANAGED_FILES,
        managedDirs: CLAUDE_MANAGED_DIRS,
      });

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
        skillsetName: "test-profile",
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

      const diff = await compareManifest({
        manifest,
        currentDir: tempDir,
        managedFiles: CLAUDE_MANAGED_FILES,
        managedDirs: CLAUDE_MANAGED_DIRS,
      });

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
        skillsetName: "test-profile",
        files: {
          "skills/my-skill/SKILL.md": await computeFileHash({
            filePath: path.join(skillDir, "SKILL.md"),
          }),
        },
      };

      // Modify nested file
      await fs.writeFile(path.join(skillDir, "SKILL.md"), "modified");

      const diff = await compareManifest({
        manifest,
        currentDir: tempDir,
        managedFiles: CLAUDE_MANAGED_FILES,
        managedDirs: CLAUDE_MANAGED_DIRS,
      });

      expect(diff.modified).toContain("skills/my-skill/SKILL.md");
    });

    it("should not report non-whitelisted files as added", async () => {
      // Manifest tracks only CLAUDE.md
      await fs.writeFile(path.join(tempDir, "CLAUDE.md"), "content");
      const manifest: FileManifest = {
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        skillsetName: "test-profile",
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

      const diff = await compareManifest({
        manifest,
        currentDir: tempDir,
        managedFiles: CLAUDE_MANAGED_FILES,
        managedDirs: CLAUDE_MANAGED_DIRS,
      });

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
        skillsetName: "test-profile",
        files: {
          "CLAUDE.md": await computeFileHash({
            filePath: path.join(tempDir, "CLAUDE.md"),
          }),
          "debug/old-session.txt": "somehash",
          "todos/old-todo.json": "somehash",
          "projects/old-project.json": "somehash",
        },
      };

      const diff = await compareManifest({
        manifest,
        currentDir: tempDir,
        managedFiles: CLAUDE_MANAGED_FILES,
        managedDirs: CLAUDE_MANAGED_DIRS,
      });

      // Old non-whitelisted entries should NOT appear as deleted
      expect(diff.deleted).toHaveLength(0);
      expect(diff.modified).toHaveLength(0);
      expect(diff.added).toHaveLength(0);
    });
  });

  describe("getManifestPath", () => {
    it("should return per-agent path in ~/.nori/manifests directory", () => {
      const manifestPath = getManifestPath({ agentName: "claude-code" });

      expect(manifestPath).toBe(
        path.join(os.homedir(), ".nori", "manifests", "claude-code.json"),
      );
    });

    it("should return different paths for different agent names", () => {
      const claudePath = getManifestPath({ agentName: "claude-code" });
      const otherPath = getManifestPath({ agentName: "other-agent" });

      expect(claudePath).not.toBe(otherPath);
      expect(claudePath).toContain("claude-code.json");
      expect(otherPath).toContain("other-agent.json");
    });
  });

  describe("legacy manifest fallback", () => {
    it("should read legacy manifest when per-agent manifest does not exist", async () => {
      // Write a legacy manifest at the old location
      const legacyPath = path.join(tempDir, "installed-manifest.json");
      const manifest: FileManifest = {
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        skillsetName: "test-profile",
        files: { "CLAUDE.md": "abc123" },
      };
      await writeManifest({ manifestPath: legacyPath, manifest });

      // Per-agent path doesn't exist yet
      const perAgentPath = path.join(tempDir, "manifests", "claude-code.json");

      // readManifest with fallback should find the legacy file
      const result = await readManifest({
        manifestPath: perAgentPath,
        legacyManifestPath: legacyPath,
      });

      expect(result).toEqual(manifest);
    });

    it("should prefer per-agent manifest over legacy when both exist", async () => {
      const legacyManifest: FileManifest = {
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        skillsetName: "legacy-profile",
        files: { "CLAUDE.md": "legacy-hash" },
      };
      const perAgentManifest: FileManifest = {
        version: 1,
        createdAt: "2024-01-02T00:00:00.000Z",
        skillsetName: "current-profile",
        files: { "CLAUDE.md": "current-hash" },
      };

      const legacyPath = path.join(tempDir, "installed-manifest.json");
      const perAgentPath = path.join(tempDir, "manifests", "claude-code.json");

      await writeManifest({
        manifestPath: legacyPath,
        manifest: legacyManifest,
      });
      await writeManifest({
        manifestPath: perAgentPath,
        manifest: perAgentManifest,
      });

      const result = await readManifest({
        manifestPath: perAgentPath,
        legacyManifestPath: legacyPath,
      });

      expect(result).toEqual(perAgentManifest);
    });

    it("should return null when neither per-agent nor legacy manifest exists", async () => {
      const perAgentPath = path.join(tempDir, "manifests", "claude-code.json");
      const legacyPath = path.join(tempDir, "installed-manifest.json");

      const result = await readManifest({
        manifestPath: perAgentPath,
        legacyManifestPath: legacyPath,
      });

      expect(result).toBeNull();
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

describe("removeManagedFiles", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "manifest-remove-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should remove all files listed in the manifest", async () => {
    // Set up a claude dir with managed files
    const claudeDir = path.join(tempDir, ".claude");
    const skillDir = path.join(claudeDir, "skills", "my-skill");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, "CLAUDE.md"), "managed content");
    await fs.writeFile(path.join(claudeDir, "settings.json"), "{}");
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "skill content");

    // Create a manifest matching these files
    const manifest = await computeDirectoryManifest({
      dir: claudeDir,
      skillsetName: "test-skillset",
      managedFiles: CLAUDE_MANAGED_FILES,
      managedDirs: CLAUDE_MANAGED_DIRS,
    });
    const manifestPath = path.join(tempDir, "manifest.json");
    await writeManifest({ manifestPath, manifest });

    await removeManagedFiles({
      agentDir: claudeDir,
      manifestPath,
      managedDirs: CLAUDE_MANAGED_DIRS,
    });

    // All managed files should be gone
    await expect(
      fs.access(path.join(claudeDir, "CLAUDE.md")),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(claudeDir, "settings.json")),
    ).rejects.toThrow();
    await expect(fs.access(path.join(skillDir, "SKILL.md"))).rejects.toThrow();
  });

  it("should remove the .nori-managed marker file", async () => {
    const claudeDir = path.join(tempDir, ".claude");
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, "CLAUDE.md"), "content");
    await fs.writeFile(path.join(claudeDir, ".nori-managed"), "test-skillset");

    const manifest = await computeDirectoryManifest({
      dir: claudeDir,
      skillsetName: "test-skillset",
      managedFiles: CLAUDE_MANAGED_FILES,
      managedDirs: CLAUDE_MANAGED_DIRS,
    });
    const manifestPath = path.join(tempDir, "manifest.json");
    await writeManifest({ manifestPath, manifest });

    await removeManagedFiles({
      agentDir: claudeDir,
      manifestPath,
      managedDirs: CLAUDE_MANAGED_DIRS,
    });

    await expect(
      fs.access(path.join(claudeDir, ".nori-managed")),
    ).rejects.toThrow();
  });

  it("should preserve non-managed files in the .claude directory", async () => {
    const claudeDir = path.join(tempDir, ".claude");
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, "CLAUDE.md"), "managed");
    await fs.writeFile(path.join(claudeDir, "keybindings.json"), "user file");

    const manifest = await computeDirectoryManifest({
      dir: claudeDir,
      skillsetName: "test-skillset",
      managedFiles: CLAUDE_MANAGED_FILES,
      managedDirs: CLAUDE_MANAGED_DIRS,
    });
    const manifestPath = path.join(tempDir, "manifest.json");
    await writeManifest({ manifestPath, manifest });

    await removeManagedFiles({
      agentDir: claudeDir,
      manifestPath,
      managedDirs: CLAUDE_MANAGED_DIRS,
    });

    // Non-managed file should still exist
    const content = await fs.readFile(
      path.join(claudeDir, "keybindings.json"),
      "utf-8",
    );
    expect(content).toBe("user file");
  });

  it("should clean up empty managed directories after file removal", async () => {
    const claudeDir = path.join(tempDir, ".claude");
    const skillDir = path.join(claudeDir, "skills", "my-skill");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "content");

    const manifest = await computeDirectoryManifest({
      dir: claudeDir,
      skillsetName: "test-skillset",
      managedFiles: CLAUDE_MANAGED_FILES,
      managedDirs: CLAUDE_MANAGED_DIRS,
    });
    const manifestPath = path.join(tempDir, "manifest.json");
    await writeManifest({ manifestPath, manifest });

    await removeManagedFiles({
      agentDir: claudeDir,
      manifestPath,
      managedDirs: CLAUDE_MANAGED_DIRS,
    });

    // The empty skills directory tree should be cleaned up
    await expect(fs.access(path.join(claudeDir, "skills"))).rejects.toThrow();
  });

  it("should not fail when manifest does not exist", async () => {
    const claudeDir = path.join(tempDir, ".claude");
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, "CLAUDE.md"), "content");

    const manifestPath = path.join(tempDir, "nonexistent-manifest.json");

    // Should not throw
    await removeManagedFiles({
      agentDir: claudeDir,
      manifestPath,
      managedDirs: CLAUDE_MANAGED_DIRS,
    });

    // File should still exist since there was no manifest to guide removal
    const content = await fs.readFile(
      path.join(claudeDir, "CLAUDE.md"),
      "utf-8",
    );
    expect(content).toBe("content");
  });

  it("should remove excluded files (nori.json, .nori-version) from managed directories", async () => {
    const claudeDir = path.join(tempDir, ".claude");
    const skillDirA = path.join(claudeDir, "skills", "skill-a");
    const skillDirB = path.join(claudeDir, "skills", "skill-b");
    await fs.mkdir(skillDirA, { recursive: true });
    await fs.mkdir(skillDirB, { recursive: true });

    // Create tracked files
    await fs.writeFile(path.join(skillDirA, "SKILL.md"), "skill a content");
    await fs.writeFile(path.join(skillDirB, "SKILL.md"), "skill b content");

    // Create excluded files that would normally be left behind
    await fs.writeFile(
      path.join(skillDirA, "nori.json"),
      JSON.stringify({ name: "skill-a" }),
    );
    await fs.writeFile(
      path.join(skillDirA, ".nori-version"),
      JSON.stringify({ version: "1.0.0" }),
    );
    await fs.writeFile(
      path.join(skillDirB, "nori.json"),
      JSON.stringify({ name: "skill-b" }),
    );

    // Create manifest (excludes nori.json and .nori-version)
    const manifest = await computeDirectoryManifest({
      dir: claudeDir,
      skillsetName: "test-skillset",
      managedFiles: CLAUDE_MANAGED_FILES,
      managedDirs: CLAUDE_MANAGED_DIRS,
    });
    const manifestPath = path.join(tempDir, "manifest.json");
    await writeManifest({ manifestPath, manifest });

    await removeManagedFiles({
      agentDir: claudeDir,
      manifestPath,
      managedDirs: CLAUDE_MANAGED_DIRS,
    });

    // Excluded files should also be removed
    await expect(
      fs.access(path.join(skillDirA, "nori.json")),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(skillDirA, ".nori-version")),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(skillDirB, "nori.json")),
    ).rejects.toThrow();

    // The entire skills directory should be cleaned up since all files removed
    await expect(fs.access(path.join(claudeDir, "skills"))).rejects.toThrow();
  });
});

describe("manifest excluded files", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "manifest-excluded-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should define .nori-version and nori.json as excluded files", () => {
    expect(EXCLUDED_FILES).toContain(".nori-version");
    expect(EXCLUDED_FILES).toContain("nori.json");
  });

  describe("computeDirectoryManifest", () => {
    it("should exclude .nori-version files from manifest", async () => {
      const skillDir = path.join(tempDir, "skills", "my-skill");
      await fs.mkdir(skillDir, { recursive: true });

      await fs.writeFile(path.join(skillDir, "SKILL.md"), "skill content");
      await fs.writeFile(
        path.join(skillDir, ".nori-version"),
        JSON.stringify({
          version: "1.0.0",
          registryUrl: "https://example.com",
        }),
      );

      const manifest = await computeDirectoryManifest({
        dir: tempDir,
        skillsetName: "test-profile",
        managedFiles: CLAUDE_MANAGED_FILES,
        managedDirs: CLAUDE_MANAGED_DIRS,
      });

      expect(manifest.files["skills/my-skill/SKILL.md"]).toBeDefined();
      expect(manifest.files["skills/my-skill/.nori-version"]).toBeUndefined();
    });

    it("should exclude nori.json files from manifest", async () => {
      const skillDir = path.join(tempDir, "skills", "my-skill");
      await fs.mkdir(skillDir, { recursive: true });

      await fs.writeFile(path.join(skillDir, "SKILL.md"), "skill content");
      await fs.writeFile(
        path.join(skillDir, "nori.json"),
        JSON.stringify({ name: "my-skill", version: "1.0.0" }),
      );

      const manifest = await computeDirectoryManifest({
        dir: tempDir,
        skillsetName: "test-profile",
        managedFiles: CLAUDE_MANAGED_FILES,
        managedDirs: CLAUDE_MANAGED_DIRS,
      });

      expect(manifest.files["skills/my-skill/SKILL.md"]).toBeDefined();
      expect(manifest.files["skills/my-skill/nori.json"]).toBeUndefined();
    });

    it("should exclude .nori-version files in deeply nested skill directories", async () => {
      const nestedSkillDir = path.join(
        tempDir,
        "skills",
        "parent-skill",
        "nested",
      );
      await fs.mkdir(nestedSkillDir, { recursive: true });

      await fs.writeFile(path.join(nestedSkillDir, "SKILL.md"), "nested skill");
      await fs.writeFile(
        path.join(nestedSkillDir, ".nori-version"),
        JSON.stringify({ version: "2.0.0" }),
      );

      const manifest = await computeDirectoryManifest({
        dir: tempDir,
        skillsetName: "test-profile",
        managedFiles: CLAUDE_MANAGED_FILES,
        managedDirs: CLAUDE_MANAGED_DIRS,
      });

      expect(
        manifest.files["skills/parent-skill/nested/SKILL.md"],
      ).toBeDefined();
      expect(
        manifest.files["skills/parent-skill/nested/.nori-version"],
      ).toBeUndefined();
    });
  });

  describe("compareManifest", () => {
    it("should not report .nori-version files as added", async () => {
      const skillDir = path.join(tempDir, "skills", "my-skill");
      await fs.mkdir(skillDir, { recursive: true });

      await fs.writeFile(path.join(skillDir, "SKILL.md"), "skill content");

      const manifest: FileManifest = {
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        skillsetName: "test-profile",
        files: {
          "skills/my-skill/SKILL.md": await computeFileHash({
            filePath: path.join(skillDir, "SKILL.md"),
          }),
        },
      };

      // Add .nori-version file after manifest was created
      await fs.writeFile(
        path.join(skillDir, ".nori-version"),
        JSON.stringify({ version: "1.0.0" }),
      );

      const diff = await compareManifest({
        manifest,
        currentDir: tempDir,
        managedFiles: CLAUDE_MANAGED_FILES,
        managedDirs: CLAUDE_MANAGED_DIRS,
      });

      expect(diff.added).not.toContain("skills/my-skill/.nori-version");
      expect(diff.added).toHaveLength(0);
      expect(diff.modified).toHaveLength(0);
      expect(diff.deleted).toHaveLength(0);
    });

    it("should not report nori.json files as added", async () => {
      const skillDir = path.join(tempDir, "skills", "my-skill");
      await fs.mkdir(skillDir, { recursive: true });

      await fs.writeFile(path.join(skillDir, "SKILL.md"), "skill content");

      const manifest: FileManifest = {
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        skillsetName: "test-profile",
        files: {
          "skills/my-skill/SKILL.md": await computeFileHash({
            filePath: path.join(skillDir, "SKILL.md"),
          }),
        },
      };

      // Add nori.json file after manifest was created
      await fs.writeFile(
        path.join(skillDir, "nori.json"),
        JSON.stringify({ name: "my-skill" }),
      );

      const diff = await compareManifest({
        manifest,
        currentDir: tempDir,
        managedFiles: CLAUDE_MANAGED_FILES,
        managedDirs: CLAUDE_MANAGED_DIRS,
      });

      expect(diff.added).not.toContain("skills/my-skill/nori.json");
      expect(diff.added).toHaveLength(0);
      expect(diff.modified).toHaveLength(0);
      expect(diff.deleted).toHaveLength(0);
    });
  });
});
