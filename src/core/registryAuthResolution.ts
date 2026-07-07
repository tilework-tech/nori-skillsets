/**
 * Org-scoped registry resolution — the one piece shared by the registry-auth
 * ladders in the upload and download commands: derive the org registry URL,
 * check membership against the unified auth's organization list, and build
 * the RegistryAuth used to fetch a token.
 *
 * Surrounding policy (env-token matching, anonymous public downloads,
 * error/not-found semantics) intentionally stays at each call site.
 */

import { toRegistryAuth } from "@/api/authCredentials.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { buildOrganizationRegistryUrl } from "@/utils/url.js";

import type { AuthCredentials, RegistryAuth } from "@/api/authCredentials.js";

export type OrgRegistryAuthResult =
  | {
      ok: true;
      registryUrl: string;
      registryAuth: RegistryAuth;
      getToken: () => Promise<string>;
    }
  | { ok: false; reason: "no-unified-auth"; registryUrl: string }
  | {
      ok: false;
      reason: "not-a-member";
      registryUrl: string;
      organizations: Array<string>;
    };

/**
 * Resolve unified-auth access to an organization's registry.
 *
 * Callers decide unified-auth *availability* themselves (e.g. requiring
 * hasRegistryAuthCredentials before consulting this) — this helper only
 * answers: given this auth's organization list, may `orgId` be used, and
 * with which registry URL and credentials?
 *
 * @param args - Arguments
 * @param args.auth - Unified auth credentials from config, or null
 * @param args.orgId - Org namespace to resolve (not "public")
 *
 * @returns The derived registry URL plus auth on success; otherwise the
 *   failure reason ("no-unified-auth" when no organization list is available,
 *   "not-a-member" with the user's organizations when access is denied). The
 *   derived registry URL is always included.
 */
export const resolveOrgRegistryAuth = (args: {
  auth: AuthCredentials | null;
  orgId: string;
}): OrgRegistryAuthResult => {
  const { auth, orgId } = args;
  const registryUrl = buildOrganizationRegistryUrl({ orgId });

  if (auth?.organizations == null) {
    return { ok: false, reason: "no-unified-auth", registryUrl };
  }
  if (!auth.organizations.includes(orgId)) {
    return {
      ok: false,
      reason: "not-a-member",
      registryUrl,
      organizations: auth.organizations,
    };
  }

  const registryAuth = toRegistryAuth({ auth, registryUrl });
  return {
    ok: true,
    registryUrl,
    registryAuth,
    getToken: () => getRegistryAuthToken({ registryAuth }),
  };
};
