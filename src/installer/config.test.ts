/**
 * Tests for configuration management with profile-based system
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  loadDiskConfig,
  saveDiskConfig,
  generateConfig,
  type DiskConfig,
} from './config.js';

describe('config with profile-based system', () => {
  let tempDir: string;
  let mockConfigPath: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-test-'));
    mockConfigPath = path.join(tempDir, 'nori-config.json');

    // Mock HOME environment variable
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    // Restore HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    }

    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe('saveDiskConfig and loadDiskConfig', () => {
    it('should save and load profile along with auth', async () => {
      await saveDiskConfig({
        username: 'test@example.com',
        password: 'password123',
        organizationUrl: 'https://example.com',
        profile: {
          baseProfile: 'senior-swe',
        },
      });

      const loaded = await loadDiskConfig();

      expect(loaded?.auth).toEqual({
        username: 'test@example.com',
        password: 'password123',
        organizationUrl: 'https://example.com',
      });
      expect(loaded?.profile).toEqual({
        baseProfile: 'senior-swe',
      });
    });

    it('should save and load auth without profile', async () => {
      await saveDiskConfig({
        username: 'test@example.com',
        password: 'password123',
        organizationUrl: 'https://example.com',
        profile: null,
      });

      const loaded = await loadDiskConfig();

      expect(loaded?.auth).toEqual({
        username: 'test@example.com',
        password: 'password123',
        organizationUrl: 'https://example.com',
      });
      expect(loaded?.profile).toBeNull();
    });

    it('should save and load profile without auth', async () => {
      await saveDiskConfig({
        username: null,
        password: null,
        organizationUrl: null,
        profile: {
          baseProfile: 'amol',
        },
      });

      const loaded = await loadDiskConfig();

      expect(loaded?.auth).toBeNull();
      expect(loaded?.profile).toEqual({
        baseProfile: 'amol',
      });
    });

    it('should return null when config file does not exist', async () => {
      const loaded = await loadDiskConfig();
      expect(loaded).toBeNull();
    });

    it('should handle malformed config gracefully', async () => {
      await fs.writeFile(mockConfigPath, 'invalid json {');

      const loaded = await loadDiskConfig();
      expect(loaded).toBeNull();
    });

    it('should load sendSessionTranscript when set to enabled', async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({ sendSessionTranscript: 'enabled' }),
      );

      const loaded = await loadDiskConfig();

      expect(loaded?.sendSessionTranscript).toBe('enabled');
    });

    it('should load sendSessionTranscript when set to disabled', async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({ sendSessionTranscript: 'disabled' }),
      );

      const loaded = await loadDiskConfig();

      expect(loaded?.sendSessionTranscript).toBe('disabled');
    });

    it('should default sendSessionTranscript to enabled when field is missing', async () => {
      await fs.writeFile(mockConfigPath, JSON.stringify({}));

      const loaded = await loadDiskConfig();

      expect(loaded?.sendSessionTranscript).toBe('enabled');
    });

    it('should save and load sendSessionTranscript', async () => {
      await saveDiskConfig({
        username: null,
        password: null,
        organizationUrl: null,
        sendSessionTranscript: 'disabled',
      });

      const loaded = await loadDiskConfig();

      expect(loaded?.sendSessionTranscript).toBe('disabled');
    });
  });

  describe('generateConfig', () => {
    it('should generate paid config with profile from diskConfig', () => {
      const diskConfig: DiskConfig = {
        auth: {
          username: 'test@example.com',
          password: 'password123',
          organizationUrl: 'https://example.com',
        },
        profile: {
          baseProfile: 'senior-swe',
        },
      };

      const config = generateConfig({ diskConfig });

      expect(config.installType).toBe('paid');
      expect(config.profile).toEqual({
        baseProfile: 'senior-swe',
      });
    });

    it('should generate free config with profile from diskConfig', () => {
      const diskConfig: DiskConfig = {
        auth: null,
        profile: {
          baseProfile: 'amol',
        },
      };

      const config = generateConfig({ diskConfig });

      expect(config.installType).toBe('free');
      expect(config.profile).toEqual({
        baseProfile: 'amol',
      });
    });

    it('should use default profile (senior-swe) when diskConfig has no profile', () => {
      const diskConfig: DiskConfig = {
        auth: null,
        profile: null,
      };

      const config = generateConfig({ diskConfig });

      expect(config.installType).toBe('free');
      expect(config.profile).toEqual({
        baseProfile: 'senior-swe',
      });
    });

    it('should use default profile (senior-swe) when diskConfig is null', () => {
      const config = generateConfig({ diskConfig: null });

      expect(config.installType).toBe('free');
      expect(config.profile).toEqual({
        baseProfile: 'senior-swe',
      });
    });
  });
});
