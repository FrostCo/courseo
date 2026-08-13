import {
  encodePathForUrl,
  type ApiError,
  type BulkProgressRequest,
  type BulkProgressResponse,
  type ChangePasswordRequest,
  type Course,
  type CourseTreeResponse,
  type CreateLibraryRequest,
  type CreateShareRequest,
  type CreateUserRequest,
  type LessonProgress,
  type Library,
  type LibraryShare,
  type LoginRequest,
  type MoveCourseRequest,
  type MoveRequest,
  type ProgressUpdateRequest,
  type SetupRequest,
  type SetupStatus,
  type UpdateUserRequest,
  type User,
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
    create: (body: CreateUserRequest) => post<User>("/api/users", body),
    update: (id: number, body: UpdateUserRequest) =>
      patch<User>(`/api/users/${id}`, body),
    remove: (id: number) => del<{ ok: true }>(`/api/users/${id}`),
  },
  changePassword: (body: ChangePasswordRequest) =>
    request<{ ok: true }>("/api/me/password", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  libraries: {
    list: () => request<Library[]>("/api/libraries"),
    get: (id: number) => request<Library>(`/api/libraries/${id}`),
    courses: (id: number) => request<Course[]>(`/api/libraries/${id}/courses`),
    rescan: (id: number) => post<Course[]>(`/api/libraries/${id}/rescan`),
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
    authors: (id: number) => request<string[]>(`/api/libraries/${id}/authors`),
    createAuthor: (id: number, name: string) =>
      post<{ ok: true }>(`/api/libraries/${id}/authors`, { name }),
    renameAuthor: (id: number, from: string, to: string) =>
      patch<{ ok: true }>(
        `/api/libraries/${id}/authors/${encodeURIComponent(from)}`,
        { name: to },
      ),
  },
  courses: {
    tree: (id: number) => request<CourseTreeResponse>(`/api/courses/${id}/tree`),
    move: (id: number, body: MoveCourseRequest) =>
      post<Course>(`/api/courses/${id}/move`, body),
    moveFile: (id: number, body: MoveRequest) =>
      post<{ ok: true }>(`/api/courses/${id}/files/move`, body),
  },
  progress: {
    update: (body: ProgressUpdateRequest) =>
      request<LessonProgress>("/api/progress", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    bulk: (body: BulkProgressRequest) =>
      request<BulkProgressResponse>("/api/progress/bulk", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
  },
};

/** URL for streaming a course file; real slashes between encoded segments. */
export function fileUrl(courseId: number, relPath: string): string {
  return `/api/courses/${courseId}/files/${encodePathForUrl(relPath)}`;
}
