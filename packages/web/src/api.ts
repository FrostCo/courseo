import type {
  ApiError,
  CreateLibraryRequest,
  CreateShareRequest,
  Library,
  LibraryShare,
  LoginRequest,
  SetupRequest,
  SetupStatus,
  User,
} from "@courseo/shared";

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = ((await res.json()) as ApiError).error;
    } catch {
      // Non-JSON error body; keep the status text.
    }
    throw new ApiRequestError(res.status, message);
  }
  return (await res.json()) as T;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function patch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

export const api = {
  setupStatus: () => request<SetupStatus>("/api/setup"),
  setup: (body: SetupRequest) => post<User>("/api/setup", body),
  login: (body: LoginRequest) => post<User>("/api/auth/login", body),
  logout: () => post<{ ok: true }>("/api/auth/logout"),
  me: () => request<User>("/api/me"),
  users: {
    list: () => request<User[]>("/api/users"),
  },
  libraries: {
    list: () => request<Library[]>("/api/libraries"),
    availableRoots: () => request<string[]>("/api/libraries/roots"),
    create: (body: CreateLibraryRequest) => post<Library>("/api/libraries", body),
    rename: (id: number, name: string) =>
      patch<Library>(`/api/libraries/${id}`, { name }),
    remove: (id: number) => del<{ ok: true }>(`/api/libraries/${id}`),
    shares: (id: number) => request<LibraryShare[]>(`/api/libraries/${id}/shares`),
    share: (id: number, body: CreateShareRequest) =>
      post<{ ok: true }>(`/api/libraries/${id}/shares`, body),
    unshare: (id: number, userId: number) =>
      del<{ ok: true }>(`/api/libraries/${id}/shares/${userId}`),
  },
};
