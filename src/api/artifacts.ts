import { apiRequest } from '@/api/base.js';

export type ArtifactType =
  | 'transcript'
  | 'summary'
  | 'recipe'
  | 'webhook'
  | 'memory'
  | 'noridoc'
  | 'premortem'
  | 'no-type';

export type Artifact = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  content: string;
  sourceUrl?: string | null;
  userEmail?: string | null;
  type: ArtifactType;
  repository: string;
};

export type CreateArtifactRequest = {
  name: string;
  content: string;
  summary?: string | null;
  sourceUrl?: string | null;
  type?: ArtifactType | null;
};

export type ReplaceInArtifactRequest = {
  id: string;
  old_string: string;
  new_string: string;
};

export const artifactsApi = {
  create: async (args: CreateArtifactRequest): Promise<Artifact> => {
    const { name, content, sourceUrl, type } = args;

    return apiRequest<Artifact>({
      path: '/artifacts',
      method: 'POST',
      body: {
        name,
        content,
        sourceUrl,
        type,
        actor: 'claude-code', // MCP always acts as claude-code
      },
    });
  },

  replace: async (args: ReplaceInArtifactRequest): Promise<Artifact> => {
    const { id, old_string, new_string } = args;

    return apiRequest<Artifact>({
      path: `/artifacts/${id}/replace`,
      method: 'POST',
      body: {
        old_string,
        new_string,
        actor: 'claude-code', // MCP always acts as claude-code
      },
    });
  },

  getDistinctColumnValues: async (args: {
    columnName: string;
  }): Promise<Array<string>> => {
    const { columnName } = args;
    const response = await apiRequest<{ values: Array<string> }>({
      path: '/artifacts/distinct-column-values',
      method: 'GET',
      queryParams: { column: columnName },
    });
    return response.values;
  },

  // Convenience method for backward compatibility
  getDistinctUserEmails: async (): Promise<Array<string>> => {
    return artifactsApi.getDistinctColumnValues({ columnName: 'userEmail' });
  },
};
