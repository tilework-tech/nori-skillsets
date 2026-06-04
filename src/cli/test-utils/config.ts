import * as fs from "fs/promises";

import {
  getConfigPath,
  updateConfig,
  type AuthCredentials,
  type Config,
} from "@/cli/config.js";

type SaveConfigForTestArgs = {
  username: string | null;
  password?: string | null;
  refreshToken?: string | null;
  idToken?: string | null;
  idTokenExpiresAt?: number | null;
  apiToken?: string | null;
  organizationUrl: string | null;
  organizations?: Array<string> | null;
  isAdmin?: boolean | null;
  sendSessionTranscript?: "enabled" | "disabled" | null;
  autoupdate?: "enabled" | "disabled" | null;
  activeSkillset?: string | null;
  defaultAgents?: Array<string> | null;
  transcriptDestination?: string | null;
  garbageCollectTranscripts?: "enabled" | "disabled" | null;
  redownloadOnSwitch?: "enabled" | "disabled" | null;
  installDir: string;
};

export const saveTestingConfig = async (
  args: SaveConfigForTestArgs,
): Promise<void> => {
  await fs.rm(getConfigPath(), { force: true });

  const auth = buildAuthForTest(args);

  await updateConfig({
    ...(auth != null ? { auth } : {}),
    ...(args.sendSessionTranscript != null
      ? { sendSessionTranscript: args.sendSessionTranscript }
      : {}),
    ...(args.autoupdate != null ? { autoupdate: args.autoupdate } : {}),
    ...(args.activeSkillset != null
      ? { activeSkillset: args.activeSkillset }
      : {}),
    ...(args.defaultAgents != null
      ? { defaultAgents: args.defaultAgents }
      : {}),
    ...(args.transcriptDestination != null
      ? { transcriptDestination: args.transcriptDestination }
      : {}),
    ...(args.garbageCollectTranscripts != null
      ? { garbageCollectTranscripts: args.garbageCollectTranscripts }
      : {}),
    ...(args.redownloadOnSwitch != null
      ? { redownloadOnSwitch: args.redownloadOnSwitch }
      : {}),
    installDir: args.installDir,
  });
};

const buildAuthForTest = (
  args: SaveConfigForTestArgs,
): Config["auth"] | undefined => {
  const hasUsernameAuth = args.username != null && args.organizationUrl != null;
  const hasIdTokenAuth = args.idToken != null && args.organizationUrl != null;
  const hasApiTokenAuth = args.apiToken != null && args.organizationUrl != null;

  if (!hasUsernameAuth && !hasIdTokenAuth && !hasApiTokenAuth) {
    return undefined;
  }

  return {
    username: args.username,
    organizationUrl: args.organizationUrl!,
    refreshToken: args.refreshToken ?? null,
    idToken: args.idToken ?? null,
    idTokenExpiresAt: args.idTokenExpiresAt ?? null,
    password: args.refreshToken != null ? null : (args.password ?? null),
    apiToken: args.apiToken ?? null,
    organizations: args.organizations ?? null,
    isAdmin: args.isAdmin ?? null,
  } satisfies AuthCredentials;
};
