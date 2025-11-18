/**
 * Integration test for configurable installation directory feature
 *
 * Tests the complete flow of installing to custom directories, saving to config,
 * and reinstalling during autoupdate scenarios.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { main as installMain } from '@/installer/install.js';
import { runUninstall } from '@/installer/uninstall.js';
import { loadDiskConfig, getConfigPath } from '@/installer/config.js';
import { getClaudeDir } from '@/installer/env.js';

describe('Configurable Installation Directory', () => {
  let originalHome: string | undefined;
  let tempDir: string;
  let customInstallDir: string;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'install-dir-test-'));
    process.env.HOME = tempDir;

    // Create a custom installation directory
    customInstallDir = path.join(tempDir, 'custom-claude');
    await fs.mkdir(customInstallDir, { recursive: true });
  });

  afterEach(async () => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should install to custom directory and save to config', async () => {
    // Install to custom directory
    await installMain({
      nonInteractive: true,
      installDir: customInstallDir
    });

    // Verify config was saved with custom directory
    const config = await loadDiskConfig();
    expect(config).not.toBeNull();
    expect(config?.installDirs).toBeDefined();
    expect(config?.installDirs).toContain(customInstallDir);

    // Verify files were installed to custom directory
    const settingsPath = path.join(customInstallDir, 'settings.json');
    await expect(fs.access(settingsPath)).resolves.not.toThrow();
  });

  it('should reinstall to configured directory in non-interactive mode', async () => {
    // First install to custom directory
    await installMain({
      nonInteractive: true,
      installDir: customInstallDir
    });

    // Remove the installed files but keep config
    await fs.rm(customInstallDir, { recursive: true, force: true });
    await fs.mkdir(customInstallDir, { recursive: true });

    // Reinstall in non-interactive mode (simulates autoupdate)
    await installMain({
      nonInteractive: true
    });

    // Verify it reinstalled to the custom directory from config
    const settingsPath = path.join(customInstallDir, 'settings.json');
    await expect(fs.access(settingsPath)).resolves.not.toThrow();
  });

  it('should use CLI arg over config directory', async () => {
    // Install to first directory
    const firstDir = path.join(tempDir, 'first-claude');
    await fs.mkdir(firstDir, { recursive: true });
    await installMain({
      nonInteractive: true,
      installDir: firstDir
    });

    // Install to second directory via CLI arg
    const secondDir = path.join(tempDir, 'second-claude');
    await fs.mkdir(secondDir, { recursive: true });
    await installMain({
      nonInteractive: true,
      installDir: secondDir
    });

    // Verify config contains the second directory
    const config = await loadDiskConfig();
    expect(config?.installDirs).toContain(secondDir);

    // Verify files exist in second directory
    const settingsPath = path.join(secondDir, 'settings.json');
    await expect(fs.access(settingsPath)).resolves.not.toThrow();
  });

  it('should uninstall from all configured directories', async () => {
    // Install to two different directories
    const dir1 = path.join(tempDir, 'dir1-claude');
    const dir2 = path.join(tempDir, 'dir2-claude');
    await fs.mkdir(dir1, { recursive: true });
    await fs.mkdir(dir2, { recursive: true });

    await installMain({ nonInteractive: true, installDir: dir1 });

    // Manually update config to include both directories (simulating multiple installs)
    const configPath = getConfigPath();
    const configContent = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(configContent);
    config.installDirs = [dir1, dir2];
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    // Create settings files in both directories
    await fs.writeFile(path.join(dir1, 'settings.json'), '{}');
    await fs.writeFile(path.join(dir2, 'settings.json'), '{}');

    // Uninstall
    await runUninstall({ removeConfig: false });

    // Verify both directories were cleaned (settings.json removed)
    await expect(fs.access(path.join(dir1, 'settings.json'))).rejects.toThrow();
    await expect(fs.access(path.join(dir2, 'settings.json'))).rejects.toThrow();
  });

  it('should uninstall from specific directory when installDir is provided', async () => {
    // Install to two different directories
    const dir1 = path.join(tempDir, 'dir1-claude');
    const dir2 = path.join(tempDir, 'dir2-claude');
    await fs.mkdir(dir1, { recursive: true });
    await fs.mkdir(dir2, { recursive: true });

    // Manually update config to include both directories
    const configPath = getConfigPath();
    await fs.writeFile(configPath, JSON.stringify({
      installDirs: [dir1, dir2]
    }, null, 2));

    // Create settings files in both directories
    await fs.writeFile(path.join(dir1, 'settings.json'), '{"test": "dir1"}');
    await fs.writeFile(path.join(dir2, 'settings.json'), '{"test": "dir2"}');

    // Uninstall only from dir1
    await runUninstall({ removeConfig: false, installDir: dir1 });

    // Verify dir1 was cleaned
    await expect(fs.access(path.join(dir1, 'settings.json'))).rejects.toThrow();

    // Verify dir2 was NOT cleaned
    const dir2Settings = await fs.readFile(path.join(dir2, 'settings.json'), 'utf-8');
    expect(dir2Settings).toContain('dir2');
  });

  it('should remove directory from config after targeted uninstall', async () => {
    const dir1 = path.join(tempDir, 'dir1-claude');
    const dir2 = path.join(tempDir, 'dir2-claude');
    await fs.mkdir(dir1, { recursive: true });
    await fs.mkdir(dir2, { recursive: true });

    // Set up config with both directories
    const configPath = getConfigPath();
    await fs.writeFile(configPath, JSON.stringify({
      installDirs: [dir1, dir2]
    }, null, 2));

    // Create settings files
    await fs.writeFile(path.join(dir1, 'settings.json'), '{}');
    await fs.writeFile(path.join(dir2, 'settings.json'), '{}');

    // Uninstall from dir1
    await runUninstall({ removeConfig: false, installDir: dir1 });

    // Verify config only contains dir2
    const updatedConfig = await loadDiskConfig();
    expect(updatedConfig?.installDirs).toEqual([dir2]);
  });

  it('should leave empty array when last directory is uninstalled', async () => {
    const dir1 = path.join(tempDir, 'only-claude');
    await fs.mkdir(dir1, { recursive: true });

    // Set up config with one directory
    const configPath = getConfigPath();
    await fs.writeFile(configPath, JSON.stringify({
      installDirs: [dir1]
    }, null, 2));

    await fs.writeFile(path.join(dir1, 'settings.json'), '{}');

    // Uninstall from the only directory
    await runUninstall({ removeConfig: false, installDir: dir1 });

    // Verify config has empty array
    const updatedConfig = await loadDiskConfig();
    expect(updatedConfig?.installDirs).toEqual([]);
  });

  it('should normalize paths with tilde expansion', async () => {
    // Use tilde in install dir
    const tildeDir = '~/.custom-claude';
    await installMain({
      nonInteractive: true,
      installDir: tildeDir
    });

    // Verify config has absolute path (tilde expanded)
    const config = await loadDiskConfig();
    expect(config?.installDirs?.[0]).toBe(path.join(tempDir, '.custom-claude'));
  });

  it('should use getClaudeDir with dynamic installDir', () => {
    const customDir = '/custom/path/.claude';
    const result = getClaudeDir({ installDir: customDir });
    expect(result).toBe(customDir);
  });

  it('should fall back to default when no installDir specified', () => {
    const result = getClaudeDir();
    expect(result).toBe(path.join(tempDir, '.claude'));
  });

  it('should use environment variable over default', () => {
    process.env.CLAUDE_DIR = '/env/claude';
    const result = getClaudeDir();
    expect(result).toBe('/env/claude');
    delete process.env.CLAUDE_DIR;
  });

  it('should prioritize function arg over environment variable', () => {
    process.env.CLAUDE_DIR = '/env/claude';
    const result = getClaudeDir({ installDir: '/arg/claude' });
    expect(result).toBe('/arg/claude');
    delete process.env.CLAUDE_DIR;
  });
});
