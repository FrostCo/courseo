import { useCallback, useEffect, useState } from "react";
import type { Library, LibraryShare, ShareRole, User } from "@courseo/shared";
import { api, ApiRequestError } from "../api.js";

export function ShareManager({
  library,
  currentUser,
  onChanged,
  onDeleted,
}: {
  library: Library;
  currentUser: User;
  onChanged: () => Promise<void> | void;
  onDeleted: () => void;
}) {
  const [shares, setShares] = useState<LibraryShare[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<ShareRole>("viewer");
  const [name, setName] = useState(library.name);
  const [error, setError] = useState<string | null>(null);

  const reloadShares = useCallback(async () => {
    try {
      setShares(await api.libraries.shares(library.id));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "failed to load shares");
    }
  }, [library.id]);

  useEffect(() => {
    void reloadShares();
    api.users.list().then(setUsers).catch(() => undefined);
  }, [reloadShares]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "operation failed");
    }
  }

  const shareable = users.filter(
    (u) =>
      u.id !== library.ownerUserId &&
      !shares?.some((s) => s.userId === u.id),
  );

  return (
    <div className="panel">
      <div className="panel-row">
        <label className="grow">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button
          className="primary-button"
          disabled={name.trim() === "" || name === library.name}
          onClick={() =>
            run(async () => {
              await api.libraries.rename(library.id, name.trim());
              await onChanged();
            })
          }
        >
          Rename
        </button>
      </div>

      <h3>Sharing</h3>
      {shares && shares.length === 0 && (
        <p className="tagline">Not shared with anyone yet.</p>
      )}
      <ul className="share-list">
        {shares?.map((share) => (
          <li key={share.userId} className="panel-row">
            <span className="grow">
              {share.displayName}
              <span className="library-path"> @{share.username}</span>
            </span>
            <select
              value={share.role}
              onChange={(e) =>
                run(async () => {
                  await api.libraries.share(library.id, {
                    userId: share.userId,
                    role: e.target.value as ShareRole,
                  });
                  await reloadShares();
                })
              }
            >
              <option value="viewer">viewer</option>
              <option value="editor">editor</option>
            </select>
            <button
              className="link-button"
              onClick={() =>
                run(async () => {
                  await api.libraries.unshare(library.id, share.userId);
                  await reloadShares();
                })
              }
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      {shareable.length > 0 && (
        <div className="panel-row">
          <select
            className="grow"
            value={addUserId}
            onChange={(e) => setAddUserId(e.target.value)}
          >
            <option value="" disabled>
              Share with…
            </option>
            {shareable.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName} (@{u.username})
              </option>
            ))}
          </select>
          <select
            value={addRole}
            onChange={(e) => setAddRole(e.target.value as ShareRole)}
          >
            <option value="viewer">viewer</option>
            <option value="editor">editor</option>
          </select>
          <button
            className="primary-button"
            disabled={addUserId === ""}
            onClick={() =>
              run(async () => {
                await api.libraries.share(library.id, {
                  userId: Number(addUserId),
                  role: addRole,
                });
                setAddUserId("");
                await reloadShares();
              })
            }
          >
            Share
          </button>
        </div>
      )}

      {error && <p className="form-error">{error}</p>}

      <div className="panel-danger">
        <button
          className="link-button link-button--danger"
          onClick={() => {
            if (
              window.confirm(
                `Remove "${library.name}" from Courseo? Files on disk are not touched; ` +
                  "progress records for its courses will be lost.",
              )
            ) {
              void run(async () => {
                await api.libraries.remove(library.id);
                onDeleted();
              });
            }
          }}
        >
          Remove library
        </button>
        {currentUser.id !== library.ownerUserId && (
          <span className="library-path">owned by user #{library.ownerUserId}</span>
        )}
      </div>
    </div>
  );
}
