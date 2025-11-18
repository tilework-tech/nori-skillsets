import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { normalizeInstallDir, validateInstallDirExists } from './path';

describe('normalizeInstallDir', () => {
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it('expands tilde to HOME directory', () => {
    process.env.HOME = '/home/testuser';
    const result = normalizeInstallDir({ path: '~/.claude' });
    expect(result).toBe('/home/testuser/.claude');
  });

  it('removes trailing slash', () => {
    const result = normalizeInstallDir({ path: '/path/to/dir/' });
    expect(result).toBe('/path/to/dir');
  });

  it('removes multiple trailing slashes', () => {
    const result = normalizeInstallDir({ path: '/path/to/dir///' });
    expect(result).toBe('/path/to/dir');
  });

  it('resolves relative paths to absolute paths', () => {
    const result = normalizeInstallDir({ path: './foo' });
    const expected = path.resolve('./foo');
    expect(result).toBe(expected);
  });

  it('passes through absolute paths unchanged (except trailing slashes)', () => {
    const result = normalizeInstallDir({ path: '/absolute/path' });
    expect(result).toBe('/absolute/path');
  });

  it('does not expand tilde in middle of path', () => {
    const result = normalizeInstallDir({ path: '/foo/~/bar' });
    expect(result).toBe('/foo/~/bar');
  });

  it('handles tilde expansion combined with trailing slash removal', () => {
    process.env.HOME = '/home/testuser';
    const result = normalizeInstallDir({ path: '~/.claude/' });
    expect(result).toBe('/home/testuser/.claude');
  });

  it('handles relative path with parent directory references', () => {
    const result = normalizeInstallDir({ path: '../foo' });
    const expected = path.resolve('../foo');
    expect(result).toBe(expected);
  });

  it('uses fallback when HOME is not set', () => {
    delete process.env.HOME;
    const result = normalizeInstallDir({ path: '~/.claude' });
    const expected = path.resolve('~/.claude');
    expect(result).toBe(expected);
  });

  it('handles root path with trailing slash', () => {
    const result = normalizeInstallDir({ path: '/' });
    expect(result).toBe('/');
  });
});

describe('validateInstallDirExists', () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'path-test-'));
    tempFile = path.join(tempDir, 'testfile.txt');
    await fs.writeFile(tempFile, 'test content');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns true for existing directories', async () => {
    const result = await validateInstallDirExists({ path: tempDir });
    expect(result).toBe(true);
  });

  it('returns false for non-existent paths', async () => {
    const nonExistentPath = path.join(tempDir, 'does-not-exist');
    const result = await validateInstallDirExists({ path: nonExistentPath });
    expect(result).toBe(false);
  });

  it('returns false for files (not directories)', async () => {
    const result = await validateInstallDirExists({ path: tempFile });
    expect(result).toBe(false);
  });

  it('returns true for system directories', async () => {
    const result = await validateInstallDirExists({ path: os.tmpdir() });
    expect(result).toBe(true);
  });
});
