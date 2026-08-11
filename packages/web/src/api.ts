import type {
  ApiError,
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

export const api = {
  setupStatus: () => request<SetupStatus>("/api/setup"),
  setup: (body: SetupRequest) => post<User>("/api/setup", body),
  login: (body: LoginRequest) => post<User>("/api/auth/login", body),
  logout: () => post<{ ok: true }>("/api/auth/logout"),
  me: () => request<User>("/api/me"),
};
