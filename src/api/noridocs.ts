import type { Artifact } from '@/api/artifacts.js';

import { apiRequest } from '@/api/base.js';

/**
 * Noridoc is just an artifact with type='noridoc'
 * sourceUrl stores the filePath (e.g., "@/server/src/persistence")
 */
export type Noridoc = Artifact;

/**
 * NoridocVersion represents a version entry in the history
 */
export type NoridocVersion = {
  id: number;
  artifactId: string;
  version: number;
  content: string;
  gitRepoUrl?: string | null;
  createdAt: string;
  createdBy?: string | null;
};

/**
 * Request to create a new noridoc
 */
export type CreateNoridocRequest = {
  filePath: string; // Will be stored as sourceUrl and name
  content: string;
  gitRepoUrl?: string | null;
};

/**
 * Request to update an existing noridoc
 */
export type UpdateNoridocRequest = {
  content: string;
  gitRepoUrl?: string | null;
};

/**
 * List noridocs query parameters
 */
export type ListNoridocsRequest = {
  limit?: number | null;
  offset?: number | null;
  orderBy?: string | null;
  order?: 'ASC' | 'DESC' | null;
  repository?: string | null;
};

/**
 * List versions query parameters
 */
export type ListVersionsRequest = {
  limit?: number | null;
  offset?: number | null;
};

export const noridocsApi = {
  create: async (args: CreateNoridocRequest): Promise<Noridoc> => {
    const { filePath, content, gitRepoUrl } = args;

    return apiRequest<Noridoc>({
      path: '/noridocs',
      method: 'POST',
      body: {
        filePath,
        content,
        gitRepoUrl,
        actor: 'claude-code', // MCP always acts as claude-code
      },
    });
  },

  read: async (args: { id: string }): Promise<Noridoc> => {
    const { id } = args;

    return apiRequest<Noridoc>({
      path: `/noridocs/${id}`,
      method: 'GET',
      queryParams: {
        actor: 'claude-code',
      },
    });
  },

  readByPath: async (args: { filePath: string }): Promise<Noridoc> => {
    const { filePath } = args;

    // List all noridocs and filter by sourceUrl (which stores filePath)
    const noridocs = await apiRequest<Array<Noridoc>>({
      path: '/noridocs',
      method: 'GET',
      queryParams: {
        actor: 'claude-code',
      },
    });

    const match = noridocs.find((n) => n.sourceUrl === filePath);

    if (!match) {
      throw new Error(`No noridoc found at path: "${filePath}"`);
    }

    return match;
  },

  update: async (args: {
    id: string;
    data: UpdateNoridocRequest;
  }): Promise<Noridoc> => {
    const { id, data } = args;

    return apiRequest<Noridoc>({
      path: `/noridocs/${id}`,
      method: 'PUT',
      body: {
        ...data,
        actor: 'claude-code',
      },
    });
  },

  delete: async (args: { id: string }): Promise<void> => {
    const { id } = args;

    await apiRequest<void>({
      path: `/noridocs/${id}`,
      method: 'DELETE',
    });
  },

  list: async (args?: ListNoridocsRequest | null): Promise<Array<Noridoc>> => {
    const queryParams: Record<string, string> = {
      actor: 'claude-code',
    };

    if (args?.limit != null) {
      queryParams.limit = args.limit.toString();
    }
    if (args?.offset != null) {
      queryParams.offset = args.offset.toString();
    }
    if (args?.orderBy != null) {
      queryParams.orderBy = args.orderBy;
    }
    if (args?.order != null) {
      queryParams.order = args.order;
    }
    if (args?.repository != null) {
      queryParams.repository = args.repository;
    }

    return apiRequest<Array<Noridoc>>({
      path: '/noridocs',
      method: 'GET',
      queryParams,
    });
  },

  listVersions: async (args: {
    id: string;
    params?: ListVersionsRequest | null;
  }): Promise<Array<NoridocVersion>> => {
    const { id, params } = args;

    const queryParams: Record<string, string> = {};

    if (params?.limit != null) {
      queryParams.limit = params.limit.toString();
    }
    if (params?.offset != null) {
      queryParams.offset = params.offset.toString();
    }

    return apiRequest<Array<NoridocVersion>>({
      path: `/noridocs/${id}/versions`,
      method: 'GET',
      queryParams,
    });
  },

  readVersion: async (args: {
    id: string;
    version: number;
  }): Promise<NoridocVersion> => {
    const { id, version } = args;

    return apiRequest<NoridocVersion>({
      path: `/noridocs/${id}/versions/${version}`,
      method: 'GET',
    });
  },
};
