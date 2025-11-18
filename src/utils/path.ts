import * as path from 'path';
import * as fs from 'fs/promises';

export const normalizeInstallDir = (args: { path: string }): string => {
  const { path: rawPath } = args;

  // Expand leading ~ to HOME
  const expanded = rawPath.replace(/^~/, process.env.HOME || '~');

  // Resolve to absolute path
  const absolute = path.resolve(expanded);

  // Remove trailing slashes (but preserve root /)
  const normalized = absolute === '/' ? '/' : absolute.replace(/\/+$/, '');

  return normalized;
};

export const validateInstallDirExists = async (args: {
  path: string;
}): Promise<boolean> => {
  const { path: dirPath } = args;

  try {
    await fs.access(dirPath);
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
};
