import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  backupSettingsFile,
  restoreSettingsFile,
  getBackupPath,
} from "./settingsBackup.js";

describe("settingsBackup", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "settings-backup-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("getBackupPath", () => {
    it("should append .pre-nori to the file path", () => {
      const result = getBackupPath({
        file: "/home/user/.claude/settings.json",
      });
      expect(result).toBe("/home/user/.claude/settings.json.pre-nori");
    });
  });

  describe("backupSettingsFile", () => {
    it("should create a backup when file exists and no backup exists", async () => {
      const settingsFile = path.join(tempDir, "settings.json");
      const originalContent = JSON.stringify(
        { statusLine: { command: "/usr/bin/my-status" }, userPref: true },
        null,
        2,
      );
      await fs.writeFile(settingsFile, originalContent);

      await backupSettingsFile({ file: settingsFile });

      const backupPath = settingsFile + ".pre-nori";
      const backupContent = await fs.readFile(backupPath, "utf-8");
      expect(backupContent).toBe(originalContent);
    });

    it("should not overwrite existing backup (idempotent)", async () => {
      const settingsFile = path.join(tempDir, "settings.json");
      const originalContent = '{"original": true}';
      const modifiedContent = '{"modified": true}';
      const backupPath = settingsFile + ".pre-nori";

      await fs.writeFile(settingsFile, modifiedContent);
      await fs.writeFile(backupPath, originalContent);

      await backupSettingsFile({ file: settingsFile });

      const backupContent = await fs.readFile(backupPath, "utf-8");
      expect(backupContent).toBe(originalContent);
    });

    it("should be a no-op when source file does not exist", async () => {
      const settingsFile = path.join(tempDir, "nonexistent.json");

      await backupSettingsFile({ file: settingsFile });

      const backupPath = settingsFile + ".pre-nori";
      const exists = await fs
        .access(backupPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });
  });

  describe("restoreSettingsFile", () => {
    it("should overwrite file from backup and delete backup", async () => {
      const settingsFile = path.join(tempDir, "settings.json");
      const backupPath = settingsFile + ".pre-nori";
      const originalContent = '{"userPref": true}';
      const noriContent = '{"userPref": true, "hooks": {}, "statusLine": {}}';

      await fs.writeFile(settingsFile, noriContent);
      await fs.writeFile(backupPath, originalContent);

      await restoreSettingsFile({ file: settingsFile });

      const restoredContent = await fs.readFile(settingsFile, "utf-8");
      expect(restoredContent).toBe(originalContent);

      const backupExists = await fs
        .access(backupPath)
        .then(() => true)
        .catch(() => false);
      expect(backupExists).toBe(false);
    });

    it("should be a no-op when no backup exists (safe for repeated calls)", async () => {
      const settingsFile = path.join(tempDir, "settings.json");
      const content = '{"hooks": {}}';
      await fs.writeFile(settingsFile, content);

      await restoreSettingsFile({ file: settingsFile });

      const result = await fs.readFile(settingsFile, "utf-8");
      expect(result).toBe(content);
    });

    it("should be a no-op when neither file nor backup exists", async () => {
      const settingsFile = path.join(tempDir, "nonexistent.json");

      await expect(
        restoreSettingsFile({ file: settingsFile }),
      ).resolves.not.toThrow();
    });
  });
});
