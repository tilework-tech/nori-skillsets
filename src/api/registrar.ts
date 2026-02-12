/**
 * API client for the Nori registrar
 *
 * The registrar is a package registry for Nori skillsets.
 * Read operations (search, packument, download) are public.
 * Write operations (upload) require authentication.
 *
 * Uses /api/skillsets/ as the primary endpoint path, with silent
 * fallback to /api/profiles/ for older registrar instances.
 */

import { ApiError, SkillCollisionError } from "@/utils/fetch.js";

export {
  NetworkError,
  ApiError,
  SkillCollisionError,
  isSkillCollisionError,
} from "@/utils/fetch.js";

/**
 * Resolution actions for skill collisions
 */
export type SkillResolutionAction =
  | "cancel"
  | "namespace"
  | "updateVersion"
  | "link";

/**
 * Conflict information for a single skill
 */
export type SkillConflict = {
  skillId: string;
  exists: boolean;
  canPublish: boolean;
  latestVersion?: string | null;
  owner?: string | null;
  availableActions: Array<SkillResolutionAction>;
  contentUnchanged?: boolean | null;
};

/**
 * Resolution decision for a single skill
 */
export type SkillResolution = {
  action: SkillResolutionAction;
  version?: string | null;
};

/**
 * Map of skill IDs to resolution decisions
 */
export type SkillResolutionStrategy = Record<string, SkillResolution>;

export const REGISTRAR_URL = "https://noriskillsets.dev";

/**
 * Compute the fallback URL by replacing /api/skillsets/ with /api/profiles/
 * and /skillset sub-resource with /profile for upload endpoints.
 *
 * @param args - The function arguments
 * @param args.url - The primary URL to compute fallback for
 *
 * @returns The fallback URL with /api/profiles/ path
 */
const buildFallbackUrl = (args: { url: string }): string => {
  const { url } = args;
  return url
    .replace("/api/skillsets/", "/api/profiles/")
    .replace(/\/skillset$/, "/profile");
};

/**
 * Execute a fetch with silent fallback to old /api/profiles/ path on 404.
 * Non-404 errors are thrown immediately without retry.
 *
 * @param args - The function arguments
 * @param args.url - The primary URL to fetch
 * @param args.init - The fetch request init options
 *
 * @returns The fetch response from primary or fallback URL
 */
const fetchWithFallback = async (args: {
  url: string;
  init: RequestInit;
}): Promise<Response> => {
  const { url, init } = args;
  const response = await fetch(url, init);

  if (response.status === 404) {
    const fallbackUrl = buildFallbackUrl({ url });
    if (fallbackUrl !== url) {
      return fetch(fallbackUrl, init);
    }
  }

  return response;
};

/**
 * Package metadata from the registrar
 */
export type Package = {
  id: string;
  name: string;
  description: string;
  authorEmail: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * npm-compatible packument format
 */
export type Packument = {
  name: string;
  description?: string | null;
  "dist-tags": Record<string, string>;
  versions: Record<
    string,
    {
      name: string;
      version: string;
      dist?: {
        tarball?: string | null;
        shasum?: string | null;
      } | null;
    }
  >;
  time?: Record<string, string> | null;
  readme?: string | null;
};

export type SearchPackagesRequest = {
  query: string;
  limit?: number | null;
  offset?: number | null;
  registryUrl?: string | null;
  authToken?: string | null;
};

export type SearchPackagesOnRegistryRequest = {
  query: string;
  registryUrl: string;
  authToken?: string | null;
  limit?: number | null;
  offset?: number | null;
};

export type GetPackumentRequest = {
  packageName: string;
  registryUrl?: string | null;
  authToken?: string | null;
};

export type DownloadTarballRequest = {
  packageName: string;
  version?: string | null;
  registryUrl?: string | null;
  authToken?: string | null;
};

export type UploadSkillsetRequest = {
  packageName: string;
  version: string;
  archiveData: ArrayBuffer;
  description?: string | null;
  authToken: string;
  registryUrl?: string | null;
  resolutionStrategy?: SkillResolutionStrategy | null;
};

/**
 * Information about an extracted skill from a profile upload
 */
export type ExtractedSkillInfo = {
  name: string;
  version: string;
};

/**
 * Summary of skills extracted during profile upload
 */
export type ExtractedSkillsSummary = {
  succeeded: Array<ExtractedSkillInfo>;
  failed: Array<{ name: string; error: string }>;
};

export type UploadSkillsetResponse = {
  name: string;
  version: string;
  description?: string | null;
  tarballSha: string;
  createdAt: string;
  extractedSkills?: ExtractedSkillsSummary | null;
};

// Skill API types
export type SearchSkillsRequest = {
  query: string;
  limit?: number | null;
  offset?: number | null;
  registryUrl?: string | null;
  authToken?: string | null;
};

export type GetSkillPackumentRequest = {
  skillName: string;
  registryUrl?: string | null;
  authToken?: string | null;
};

export type DownloadSkillTarballRequest = {
  skillName: string;
  version?: string | null;
  registryUrl?: string | null;
  authToken?: string | null;
};

export type UploadSkillRequest = {
  skillName: string;
  version: string;
  archiveData: ArrayBuffer;
  description?: string | null;
  authToken: string;
  registryUrl?: string | null;
};

export type UploadSkillResponse = {
  name: string;
  version: string;
  description?: string | null;
  tarballSha: string;
  createdAt: string;
};

export const registrarApi = {
  /**
   * Search for packages in the registrar
   * @param args - The search parameters
   *
   * @returns Array of matching packages
   */
  searchPackages: async (
    args: SearchPackagesRequest,
  ): Promise<Array<Package>> => {
    const { query, limit, offset, registryUrl, authToken } = args;
    const baseUrl = registryUrl ?? REGISTRAR_URL;

    const params = new URLSearchParams({ q: query });
    if (limit != null) {
      params.set("limit", limit.toString());
    }
    if (offset != null) {
      params.set("offset", offset.toString());
    }

    const url = `${baseUrl}/api/skillsets/search?${params.toString()}`;

    const headers: Record<string, string> = {};
    if (authToken != null) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await fetchWithFallback({
      url,
      init: {
        method: "GET",
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      },
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({
        error: `HTTP ${response.status}`,
      }))) as { error?: string };
      throw new ApiError(
        errorData.error ?? `HTTP ${response.status}`,
        response.status,
      );
    }

    return (await response.json()) as Array<Package>;
  },

  /**
   * Search for packages on a specific registry
   * @param args - The search parameters including registry URL
   *
   * @returns Array of matching packages
   */
  searchPackagesOnRegistry: async (
    args: SearchPackagesOnRegistryRequest,
  ): Promise<Array<Package>> => {
    const { query, registryUrl, authToken, limit, offset } = args;

    const params = new URLSearchParams({ q: query });
    if (limit != null) {
      params.set("limit", limit.toString());
    }
    if (offset != null) {
      params.set("offset", offset.toString());
    }

    const url = `${registryUrl}/api/skillsets/search?${params.toString()}`;

    const headers: Record<string, string> = {};
    if (authToken != null) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }

    const response = await fetchWithFallback({
      url,
      init: {
        method: "GET",
        headers,
      },
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({
        error: `HTTP ${response.status}`,
      }))) as { error?: string };
      throw new ApiError(
        errorData.error ?? `HTTP ${response.status}`,
        response.status,
      );
    }

    return (await response.json()) as Array<Package>;
  },

  /**
   * Get the packument (package metadata) for a package
   * @param args - The request parameters
   *
   * @returns The package packument
   */
  getPackument: async (args: GetPackumentRequest): Promise<Packument> => {
    const { packageName, registryUrl, authToken } = args;
    const baseUrl = registryUrl ?? REGISTRAR_URL;

    const url = `${baseUrl}/api/skillsets/${packageName}`;

    const headers: Record<string, string> = {};
    if (authToken != null) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await fetchWithFallback({
      url,
      init: {
        method: "GET",
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      },
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({
        error: `HTTP ${response.status}`,
      }))) as { error?: string };
      throw new ApiError(
        errorData.error ?? `HTTP ${response.status}`,
        response.status,
      );
    }

    return (await response.json()) as Packument;
  },

  /**
   * Download a tarball for a package
   *
   * If no version is specified, the latest version is downloaded.
   * @param args - The download parameters
   *
   * @returns The tarball data as ArrayBuffer
   */
  downloadTarball: async (
    args: DownloadTarballRequest,
  ): Promise<ArrayBuffer> => {
    const { packageName, registryUrl, authToken } = args;
    const baseUrl = registryUrl ?? REGISTRAR_URL;
    let { version } = args;

    // If no version specified, resolve latest from packument
    if (version == null) {
      const packument = await registrarApi.getPackument({
        packageName,
        registryUrl,
        authToken,
      });
      version = packument["dist-tags"].latest;

      if (version == null) {
        throw new Error(`No latest version found for package: ${packageName}`);
      }
    }

    const tarballFilename = `${packageName}-${version}.tgz`;
    const url = `${baseUrl}/api/skillsets/${packageName}/tarball/${tarballFilename}`;

    const headers: Record<string, string> = {};
    if (authToken != null) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await fetchWithFallback({
      url,
      init: {
        method: "GET",
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      },
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({
        error: `HTTP ${response.status}`,
      }))) as { error?: string };
      throw new ApiError(
        errorData.error ?? `HTTP ${response.status}`,
        response.status,
      );
    }

    return await response.arrayBuffer();
  },

  /**
   * Upload a skillset to the registrar
   * @param args - The upload parameters
   *
   * @returns The upload response with package metadata
   */
  uploadSkillset: async (
    args: UploadSkillsetRequest,
  ): Promise<UploadSkillsetResponse> => {
    const {
      packageName,
      version,
      archiveData,
      description,
      authToken,
      registryUrl,
      resolutionStrategy,
    } = args;
    const baseUrl = registryUrl ?? REGISTRAR_URL;

    const formData = new FormData();
    formData.append("archive", new Blob([archiveData]), `${packageName}.tgz`);
    formData.append("version", version);
    if (description != null) {
      formData.append("description", description);
    }
    if (resolutionStrategy != null) {
      formData.append("resolutionStrategy", JSON.stringify(resolutionStrategy));
    }

    const url = `${baseUrl}/api/skillsets/${packageName}/skillset`;

    const response = await fetchWithFallback({
      url,
      init: {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        body: formData,
      },
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({
        error: `HTTP ${response.status}`,
      }))) as {
        error?: string;
        conflicts?: Array<SkillConflict>;
        requiresVersions?: boolean;
      };

      // Check for skill collision response (409 with conflicts array)
      if (
        response.status === 409 &&
        Array.isArray(errorData.conflicts) &&
        errorData.conflicts.length > 0
      ) {
        throw new SkillCollisionError({
          message: errorData.error ?? "Skill conflicts detected",
          conflicts: errorData.conflicts,
          requiresVersions: errorData.requiresVersions,
        });
      }

      throw new ApiError(
        errorData.error ?? `HTTP ${response.status}`,
        response.status,
      );
    }

    return (await response.json()) as UploadSkillsetResponse;
  },

  // Skill API methods

  /**
   * Search for skills in the registrar
   * @param args - The search parameters
   *
   * @returns Array of matching skills
   */
  searchSkills: async (args: SearchSkillsRequest): Promise<Array<Package>> => {
    const { query, limit, offset, registryUrl, authToken } = args;
    const baseUrl = registryUrl ?? REGISTRAR_URL;

    const params = new URLSearchParams({ q: query });
    if (limit != null) {
      params.set("limit", limit.toString());
    }
    if (offset != null) {
      params.set("offset", offset.toString());
    }

    const url = `${baseUrl}/api/skills/search?${params.toString()}`;

    const headers: Record<string, string> = {};
    if (authToken != null) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await fetch(url, {
      method: "GET",
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({
        error: `HTTP ${response.status}`,
      }))) as { error?: string };
      throw new ApiError(
        errorData.error ?? `HTTP ${response.status}`,
        response.status,
      );
    }

    return (await response.json()) as Array<Package>;
  },

  /**
   * Get the packument (package metadata) for a skill
   * @param args - The request parameters
   *
   * @returns The skill packument
   */
  getSkillPackument: async (
    args: GetSkillPackumentRequest,
  ): Promise<Packument> => {
    const { skillName, registryUrl, authToken } = args;
    const baseUrl = registryUrl ?? REGISTRAR_URL;

    const url = `${baseUrl}/api/skills/${skillName}`;

    const headers: Record<string, string> = {};
    if (authToken != null) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await fetch(url, {
      method: "GET",
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({
        error: `HTTP ${response.status}`,
      }))) as { error?: string };
      throw new ApiError(
        errorData.error ?? `HTTP ${response.status}`,
        response.status,
      );
    }

    return (await response.json()) as Packument;
  },

  /**
   * Download a tarball for a skill
   *
   * If no version is specified, the latest version is downloaded.
   * @param args - The download parameters
   *
   * @returns The tarball data as ArrayBuffer
   */
  downloadSkillTarball: async (
    args: DownloadSkillTarballRequest,
  ): Promise<ArrayBuffer> => {
    const { skillName, registryUrl, authToken } = args;
    const baseUrl = registryUrl ?? REGISTRAR_URL;
    let { version } = args;

    // If no version specified, resolve latest from packument
    if (version == null) {
      const packument = await registrarApi.getSkillPackument({
        skillName,
        registryUrl,
        authToken,
      });
      version = packument["dist-tags"].latest;

      if (version == null) {
        throw new Error(`No latest version found for skill: ${skillName}`);
      }
    }

    const tarballFilename = `${skillName}-${version}.tgz`;
    const url = `${baseUrl}/api/skills/${skillName}/tarball/${tarballFilename}`;

    const headers: Record<string, string> = {};
    if (authToken != null) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await fetch(url, {
      method: "GET",
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({
        error: `HTTP ${response.status}`,
      }))) as { error?: string };
      throw new ApiError(
        errorData.error ?? `HTTP ${response.status}`,
        response.status,
      );
    }

    return await response.arrayBuffer();
  },

  /**
   * Upload a skill to the registrar
   * @param args - The upload parameters
   *
   * @returns The upload response with skill metadata
   */
  uploadSkill: async (
    args: UploadSkillRequest,
  ): Promise<UploadSkillResponse> => {
    const {
      skillName,
      version,
      archiveData,
      description,
      authToken,
      registryUrl,
    } = args;
    const baseUrl = registryUrl ?? REGISTRAR_URL;

    const formData = new FormData();
    formData.append("archive", new Blob([archiveData]), `${skillName}.tgz`);
    formData.append("version", version);
    if (description != null) {
      formData.append("description", description);
    }

    const url = `${baseUrl}/api/skills/${skillName}/skill`;

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({
        error: `HTTP ${response.status}`,
      }))) as { error?: string };
      throw new ApiError(
        errorData.error ?? `HTTP ${response.status}`,
        response.status,
      );
    }

    return (await response.json()) as UploadSkillResponse;
  },
};
