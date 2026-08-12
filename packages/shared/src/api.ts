/**
 * API contract types shared by the server (route handlers) and the web UI
 * (api client). Wire format is JSON with camelCase keys; timestamps are
 * ISO 8601 strings.
 */

import type { LessonType } from "./lesson-types.js";

// ---------------------------------------------------------------------------
// Users & auth
// ---------------------------------------------------------------------------

export interface User {
  id: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
  createdAt: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

/** First-run setup: create the initial admin account. */
export interface SetupStatus {
  needsSetup: boolean;
}

export interface SetupRequest {
  username: string;
  displayName: string;
  password: string;
}

export interface CreateUserRequest {
  username: string;
  displayName: string;
  password: string;
  isAdmin?: boolean;
}

/**
 * PATCH /api/users/:id (admin). Setting `password` resets it and signs the
 * user out everywhere. The last remaining admin cannot be demoted.
 */
export interface UpdateUserRequest {
  displayName?: string;
  isAdmin?: boolean;
  password?: string;
}

/**
 * PUT /api/me/password. Verifies the current password, then signs out all
 * other sessions (the current one is re-issued).
 */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

// ---------------------------------------------------------------------------
// Libraries & sharing
// ---------------------------------------------------------------------------

export type ShareRole = "viewer" | "editor";

/** Effective access level of the current user on a library. */
export type LibraryAccess = ShareRole | "owner";

export interface Library {
  id: number;
  name: string;
  /** Subfolder path relative to the configured libraries root (parent mount). */
  rootPath: string;
  ownerUserId: number;
  /** Access level of the requesting user, merged in by the API. */
  access: LibraryAccess;
  createdAt: string;
}

export interface CreateLibraryRequest {
  name: string;
  /** Must be an existing subfolder of the libraries root; validated server-side. */
  rootPath: string;
}

export interface UpdateLibraryRequest {
  name?: string;
}

export interface LibraryShare {
  libraryId: number;
  userId: number;
  username: string;
  displayName: string;
  role: ShareRole;
  createdAt: string;
}

export interface CreateShareRequest {
  userId: number;
  role: ShareRole;
}

// ---------------------------------------------------------------------------
// Courses & scanning
// ---------------------------------------------------------------------------

export interface Course {
  id: number;
  libraryId: number;
  /** Directory path relative to the library root. */
  relPath: string;
  name: string;
  createdAt: string;
  /** Completion stats for the requesting user, merged in by the API. */
  stats?: CourseStats;
  /**
   * Cover image filename in the course root (cover.jpg/png/webp), if one
   * exists; servable via the course files endpoint.
   */
  cover?: string;
}

export interface CourseStats {
  totalLessons: number;
  completedLessons: number;
}

/**
 * Scanned course tree. `path` values are relative to the course directory
 * and double as progress keys.
 */
export type CourseTreeNode = DirectoryNode | LessonNode;

export interface DirectoryNode {
  kind: "dir";
  name: string;
  path: string;
  children: CourseTreeNode[];
}

export interface LessonNode {
  kind: "lesson";
  name: string;
  path: string;
  type: LessonType;
  /** Sidecar subtitle paths (.srt/.vtt) attached to a video lesson. */
  subtitles?: string[];
  progress?: LessonProgress;
}

/** GET /api/courses/:id/tree */
export interface CourseTreeResponse {
  course: Course;
  /** Breadcrumb context. */
  library: { id: number; name: string };
  children: CourseTreeNode[];
  stats: CourseStats;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface LessonProgress {
  completed: boolean;
  positionSeconds: number;
  updatedAt: string;
}

export interface ProgressUpdateRequest {
  courseId: number;
  /** Relative lesson path within the course (a progress key). */
  lessonPath: string;
  completed?: boolean;
  positionSeconds?: number;
}

// ---------------------------------------------------------------------------
// File management (admin only)
// ---------------------------------------------------------------------------

/**
 * Move or rename a file/directory within a course. Paths are relative to
 * the course directory; the server re-validates containment and updates
 * progress keys in the same transaction (spec §6.9–6.10).
 */
export interface MoveRequest {
  from: string;
  to: string;
}

/** POST /api/libraries/:id/authors — create an author/organization folder. */
export interface CreateAuthorRequest {
  name: string;
}

/** PATCH /api/libraries/:id/authors/:author — rename an author folder. */
export interface RenameAuthorRequest {
  name: string;
}

/**
 * POST /api/courses/:id/move — move/rename a course. Omitted fields keep
 * their current value: `name` renames the course folder, `author` moves it
 * under a different (existing) author folder, `libraryId` moves it to
 * another library/group. Progress is keyed by course id and course-relative
 * paths, so none of these touch progress rows.
 */
export interface MoveCourseRequest {
  libraryId?: number;
  author?: string;
  name?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** All non-2xx API responses carry this shape. */
export interface ApiError {
  error: string;
}
