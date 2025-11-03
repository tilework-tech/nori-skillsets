import { apiRequest } from '@/api/base.js';

export type User = {
  uid: string;
  email: string | null;
  displayName?: string | null;
  emailVerified: boolean;
  customClaims?: Record<string, any> | null;
};

export type ListUsersResponse = {
  users: Array<User>;
  nextPageToken?: string;
};

export type CreateUserRequest = {
  email: string;
  password: string;
  organizationId?: string | null;
};

export type CreateUserResponse = {
  success: boolean;
  user: User;
};

export type DeleteUserResponse = {
  success: boolean;
  email: string;
};

export const usersApi = {
  /**
   * List users in an organization
   * @param args - Function arguments
   * @param args.organizationId - Organization ID to list users from (superadmin only)
   * @param args.pageToken - Pagination token for fetching next page
   *
   * @returns Promise with users list and next page token
   */
  list: async (args: {
    organizationId?: string | null;
    pageToken?: string | null;
  }): Promise<ListUsersResponse> => {
    const { organizationId, pageToken } = args;

    const queryParams: Record<string, string> = {};
    if (organizationId != null) {
      queryParams.organizationId = organizationId;
    }
    if (pageToken != null) {
      queryParams.pageToken = pageToken;
    }

    return apiRequest<ListUsersResponse>({
      path: '/users',
      method: 'GET',
      queryParams:
        Object.keys(queryParams).length > 0 ? queryParams : undefined,
    });
  },

  /**
   * Create a new user
   * @param args - User creation parameters
   *
   * @returns Promise with created user details
   */
  create: async (args: CreateUserRequest): Promise<CreateUserResponse> => {
    const { email, password, organizationId } = args;

    return apiRequest<CreateUserResponse>({
      path: '/users',
      method: 'POST',
      body: {
        email,
        password,
        ...(organizationId != null && { organizationId }),
      },
    });
  },

  /**
   * Delete a user
   * @param args - Function arguments
   * @param args.email - Email of user to delete
   * @param args.organizationId - Organization ID to delete from (superadmin only)
   *
   * @returns Promise with deletion confirmation
   */
  delete: async (args: {
    email: string;
    organizationId?: string | null;
  }): Promise<DeleteUserResponse> => {
    const { email, organizationId } = args;

    const queryParams: Record<string, string> = {};
    if (organizationId != null) {
      queryParams.organizationId = organizationId;
    }

    return apiRequest<DeleteUserResponse>({
      path: `/users/${encodeURIComponent(email)}`,
      method: 'DELETE',
      queryParams:
        Object.keys(queryParams).length > 0 ? queryParams : undefined,
    });
  },
};
