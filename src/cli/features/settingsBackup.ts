import * as fs from "fs/promises";

import { log } from "@clack/prompts";

import { isSilentMode } from "@/cli/logger.js";

export const getBackupPath = (args: { file: string }): string => {
  return args.file + ".pre-nori";
};

export const backupSettingsFile = async (args: {
  file: string;
}): Promise<void> => {
  const { file } = args;
  const backupPath = getBackupPath({ file });

  try {
    await fs.access(backupPath);
    return;
  } catch {
    // No backup exists yet — proceed
  }

  try {
    await fs.copyFile(file, backupPath);
    if (!isSilentMode()) {
      log.info(`Backed up ${file} → ${backupPath}`);
    }
  } catch {
    // Source file doesn't exist — nothing to back up
  }
};

export const restoreSettingsFile = async (args: {
  file: string;
}): Promise<void> => {
  const { file } = args;
  const backupPath = getBackupPath({ file });

  try {
    await fs.access(backupPath);
  } catch {
    return;
  }

  await fs.copyFile(backupPath, file);
  await fs.rm(backupPath, { force: true });
  if (!isSilentMode()) {
    log.info(`Restored ${file} from backup`);
  }
};
