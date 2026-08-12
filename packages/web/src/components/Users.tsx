import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  MIN_PASSWORD_LENGTH,
  type UpdateUserRequest,
  type User,
} from "@courseo/shared";
import { api, ApiRequestError } from "../api.js";

/** Admin page: create, edit, and delete accounts. */
export function Users({ user: currentUser }: { user: User }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    try {
      setUsers(await api.users.list());
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "failed to load users",
      );
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (error) return <p className="form-error">{error}</p>;
  if (!users) return null;

  return (
    <div className="page">
      <div className="page-heading">
        <h2>Users</h2>
        {!adding && (
          <button className="primary-button" onClick={() => setAdding(true)}>
            Add user
          </button>
        )}
      </div>

      {adding && (
        <AddUser
          onDone={(created) => {
            setAdding(false);
            if (created) void reload();
          }}
        />
      )}

      <ul className="library-list">
        {users.map((user) => (
          <li key={user.id} className="library-card">
            <div className="library-card-main">
              <span className="library-name">{user.displayName}</span>
              <span className="library-path">@{user.username}</span>
              {user.isAdmin && <span className="badge badge--owner">admin</span>}
              {user.id === currentUser.id && (
                <span className="tree-subtle">you</span>
              )}
              <button
                className="link-button"
                onClick={() =>
                  setEditingId(editingId === user.id ? null : user.id)
                }
              >
                {editingId === user.id ? "Close" : "Edit"}
              </button>
            </div>
            {editingId === user.id && (
              <UserEditor
                user={user}
                isSelf={user.id === currentUser.id}
                onChanged={() => {
                  setEditingId(null);
                  void reload();
                }}
              />
            )}
          </li>
        ))}
      </ul>

      <section className="backup-section">
        <h3 className="course-group-title">Backup</h3>
        <p className="tagline">
          Download a consistent snapshot of the database — accounts, shares,
          and everyone&apos;s progress. Course files aren&apos;t included;
          they&apos;re plain files you back up separately.
        </p>
        <a className="primary-button backup-link" href="/api/backup">
          Download backup
        </a>
      </section>
    </div>
  );
}

function AddUser({ onDone }: { onDone: (created: boolean) => void }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.users.create({
        username,
        displayName: displayName || username,
        password,
        isAdmin,
      });
      onDone(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "creation failed");
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <label>
        Username
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="off"
          autoFocus
          required
        />
      </label>
      <label>
        Display name
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={username || "Display name"}
        />
      </label>
      <label>
        Password ({MIN_PASSWORD_LENGTH}+ characters)
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </label>
      <label className="panel-check">
        <input
          type="checkbox"
          checked={isAdmin}
          onChange={(e) => setIsAdmin(e.target.checked)}
        />
        Administrator
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="panel-actions">
        <button className="link-button" type="button" onClick={() => onDone(false)}>
          Cancel
        </button>
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create user"}
        </button>
      </div>
    </form>
  );
}

function UserEditor({
  user,
  isSelf,
  onChanged,
}: {
  user: User;
  isSelf: boolean;
  onChanged: () => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [isAdmin, setIsAdmin] = useState(user.isAdmin);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const body: UpdateUserRequest = {};
    if (displayName.trim() !== user.displayName) body.displayName = displayName;
    if (isAdmin !== user.isAdmin) body.isAdmin = isAdmin;
    if (password !== "") body.password = password;
    if (Object.keys(body).length === 0) {
      onChanged();
      return;
    }
    try {
      await api.users.update(user.id, body);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "update failed");
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      await api.users.remove(user.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "deletion failed");
      setBusy(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <label>
        Display name
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />
      </label>
      <label className="panel-check">
        <input
          type="checkbox"
          checked={isAdmin}
          onChange={(e) => setIsAdmin(e.target.checked)}
          disabled={isSelf}
        />
        Administrator{isSelf && " (you cannot change your own role)"}
      </label>
      <label>
        Reset password{" "}
        {isSelf ? "(this signs you out everywhere)" : "(signs them out everywhere)"}
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Leave empty to keep the current password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
        />
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="panel-actions">
        {!isSelf &&
          (confirmingDelete ? (
            <>
              <span className="tagline">
                Delete @{user.username}? Their progress is removed too.
              </span>
              <button
                className="link-button link-button--danger"
                type="button"
                onClick={handleDelete}
                disabled={busy}
              >
                Confirm delete
              </button>
              <button
                className="link-button"
                type="button"
                onClick={() => setConfirmingDelete(false)}
              >
                Keep
              </button>
            </>
          ) : (
            <button
              className="link-button link-button--danger"
              type="button"
              onClick={() => setConfirmingDelete(true)}
            >
              Delete user
            </button>
          ))}
        <span className="panel-spacer" />
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
