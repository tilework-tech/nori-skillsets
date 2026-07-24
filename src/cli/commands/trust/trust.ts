/**
 * `sks trust list` / `sks trust revoke <remote> <slug>` — manage the durable
 * Git-source trust store (`~/.nori/trust.json`). Trust is keyed by canonicalized
 * remote + derived branch `skillsets/<slug>`.
 */

import { redactRemote } from "@/cli/features/gitPackage.js";
import { withInstallLock } from "@/cli/features/install/installLock.js";
import { listTrust, revokeTrust } from "@/cli/features/trustStore.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";

export const trustListMain = async (): Promise<CommandStatus> => {
  const entries = await listTrust();
  if (entries.length === 0) {
    return {
      success: true,
      cancelled: false,
      message: "No trusted Git sources.",
    };
  }
  const lines = entries.map((entry) => `  ${entry.remote}  ${entry.branch}`);
  return {
    success: true,
    cancelled: false,
    message: `Trusted Git sources:\n${lines.join("\n")}`,
  };
};

export const trustRevokeMain = async (args: {
  remote: string;
  slug: string;
}): Promise<CommandStatus> =>
  withInstallLock({
    operation: async () => {
      const branch = `skillsets/${args.slug}`;
      const removed = await revokeTrust({ remote: args.remote, branch });
      const displayRemote = redactRemote({ remote: args.remote });
      return removed
        ? {
            success: true,
            cancelled: false,
            message: `Revoked trust for ${branch} from ${displayRemote}.`,
          }
        : {
            success: false,
            cancelled: false,
            message: `No trust entry found for ${branch} from ${displayRemote}.`,
          };
    },
  });
