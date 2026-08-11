import type { LibraryAccess, User } from "@courseo/shared";
import type { AppDatabase } from "./db.js";

export interface LibraryRow {
  id: number;
  name: string;
  root_path: string;
  owner_user_id: number;
  created_at: string;
}

export function getLibraryRow(
  db: AppDatabase,
  libraryId: number,
): LibraryRow | undefined {
  return db.prepare("SELECT * FROM libraries WHERE id = ?").get(libraryId) as
    | LibraryRow
    | undefined;
}

/**
 * Content access (spec §4.2): a user sees a library if they own it or have
 * a share row. Resolved fresh from the DB on every request — never cached —
 * so revoking a share takes effect on the next request (spec §4.4).
 *
 * Global admins do NOT get implicit content access; is_admin gates
 * deployment management (users, library registration), not other people's
 * content.
 */
export function getLibraryAccess(
  db: AppDatabase,
  user: User,
  library: LibraryRow,
): LibraryAccess | null {
  if (library.owner_user_id === user.id) return "owner";
  const share = db
    .prepare(
      "SELECT role FROM library_shares WHERE library_id = ? AND user_id = ?",
    )
    .get(library.id, user.id) as { role: "viewer" | "editor" } | undefined;
  return share?.role ?? null;
}

/** File operations require write-level access (spec §3). */
export function canEditContent(access: LibraryAccess | null): boolean {
  return access === "owner" || access === "editor";
}

/**
 * Library administration (rename/delete/shares): the owner, or a global
 * admin (who manages the deployment without gaining content access).
 */
export function canManageLibrary(user: User, library: LibraryRow): boolean {
  return library.owner_user_id === user.id || user.isAdmin;
}
