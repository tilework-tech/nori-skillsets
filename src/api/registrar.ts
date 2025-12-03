/**
 * API client for the Nori registrar
 *
 * The registrar is a package registry for Nori profiles.
 * Read operations (search, packument, download) are public.
 * Write operations (upload) require authentication.
 */

export const REGISTRAR_URL = "https://registrar.tilework.tech";

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
};

export type GetPackumentRequest = {
  packageName: string;
};

export type DownloadTarballRequest = {
  packageName: string;
  version?: string | null;
};

export type UploadProfileRequest = {
  packageName: string;
  version: string;
  archiveData: ArrayBuffer;
  description?: string | null;
  authToken: string;
};

export type UploadProfileResponse = {
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
    const { query, limit, offset } = args;

    const params = new URLSearchParams({ q: query });
    if (limit != null) {
      params.set("limit", limit.toString());
    }
    if (offset != null) {
      params.set("offset", offset.toString());
    }

    const url = `${REGISTRAR_URL}/api/packages/search?${params.toString()}`;

    const response = await fetch(url, {
      method: "GET",
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({
        error: `HTTP ${response.status}`,
      }))) as { error?: string };
      throw new Error(errorData.error ?? `HTTP ${response.status}`);
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
    const { packageName } = args;

    const url = `${REGISTRAR_URL}/api/packages/${packageName}`;

    const response = await fetch(url, {
      method: "GET",
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({
        error: `HTTP ${response.status}`,
      }))) as { error?: string };
      throw new Error(errorData.error ?? `HTTP ${response.status}`);
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
    const { packageName } = args;
    let { version } = args;

    // If no version specified, resolve latest from packument
    if (version == null) {
      const packument = await registrarApi.getPackument({ packageName });
      version = packument["dist-tags"].latest;

      if (version == null) {
        throw new Error(`No latest version found for package: ${packageName}`);
      }
    }

    const tarballFilename = `${packageName}-${version}.tgz`;
    const url = `${REGISTRAR_URL}/api/packages/${packageName}/tarball/${tarballFilename}`;

    const response = await fetch(url, {
      method: "GET",
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({
        error: `HTTP ${response.status}`,
      }))) as { error?: string };
      throw new Error(errorData.error ?? `HTTP ${response.status}`);
    }

    return await response.arrayBuffer();
  },

  /**
   * Upload a profile to the registrar
   * @param args - The upload parameters
   *
   * @returns The upload response with package metadata
   */
  uploadProfile: async (
    args: UploadProfileRequest,
  ): Promise<UploadProfileResponse> => {
    const { packageName, version, archiveData, description, authToken } = args;

    const formData = new FormData();
    formData.append("archive", new Blob([archiveData]), `${packageName}.tgz`);
    formData.append("version", version);
    if (description != null) {
      formData.append("description", description);
    }

    const url = `${REGISTRAR_URL}/api/packages/${packageName}/profile`;

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
      throw new Error(errorData.error ?? `HTTP ${response.status}`);
    }

    return (await response.json()) as UploadProfileResponse;
  },
};
