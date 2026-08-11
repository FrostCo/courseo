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
// File management (editor/owner)
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

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** All non-2xx API responses carry this shape. */
export interface ApiError {
  error: string;
}
