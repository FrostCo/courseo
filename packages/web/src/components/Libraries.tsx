import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Library, User } from "@courseo/shared";
import { api, ApiRequestError } from "../api.js";
import { ShareManager } from "./ShareManager.js";

export function Libraries({ user }: { user: User }) {
  const [libraries, setLibraries] = useState<Library[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [managingId, setManagingId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    try {
      setLibraries(await api.libraries.list());
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "failed to load libraries");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (error) return <p className="form-error">{error}</p>;
  if (!libraries) return null;

  return (
    <div className="page">
      <div className="page-heading">
        <h2>Libraries</h2>
        {user.isAdmin && !adding && (
          <button className="primary-button" onClick={() => setAdding(true)}>
            Add library
          </button>
        )}
      </div>

      {adding && (
        <AddLibrary
          onDone={(created) => {
            setAdding(false);
            if (created) void reload();
          }}
        />
      )}

      {libraries.length === 0 && !adding && (
        <p className="tagline">
          No libraries yet.
          {user.isAdmin
            ? " Add one from a folder in your libraries mount."
            : " Ask an owner to share one with you."}
        </p>
      )}

      <ul className="library-list">
        {libraries.map((library) => {
          const canManage = user.isAdmin || library.ownerUserId === user.id;
          return (
            <li key={library.id} className="library-card">
              <div className="library-card-main">
                <Link className="library-name" to={`/libraries/${library.id}`}>
                  {library.name}
                </Link>
                <span className={`badge badge--${library.access}`}>
                  {library.access}
                </span>
                <span className="library-path">/{library.rootPath}</span>
                {canManage && (
                  <button
                    className="link-button"
                    onClick={() =>
                      setManagingId(managingId === library.id ? null : library.id)
                    }
                  >
                    {managingId === library.id ? "Close" : "Manage"}
                  </button>
                )}
              </div>
              {managingId === library.id && (
                <ShareManager
                  library={library}
                  currentUser={user}
                  onChanged={reload}
                  onDeleted={() => {
                    setManagingId(null);
                    void reload();
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AddLibrary({ onDone }: { onDone: (created: boolean) => void }) {
  const [roots, setRoots] = useState<string[] | null>(null);
  const [rootPath, setRootPath] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.libraries
      .availableRoots()
      .then(setRoots)
      .catch(() => setError("could not list library folders"));
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.libraries.create({ name: name || rootPath, rootPath });
      onDone(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "creation failed");
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      {roots && roots.length === 0 ? (
        <p className="tagline">
          No unclaimed folders found in the libraries mount. Add a subfolder
          on disk first.
        </p>
      ) : (
        <>
          <label>
            Folder
            <select
              value={rootPath}
              onChange={(e) => setRootPath(e.target.value)}
              required
            >
              <option value="" disabled>
                {roots ? "Pick a folder…" : "Loading…"}
              </option>
              {roots?.map((root) => (
                <option key={root} value={root}>
                  /{root}
                </option>
              ))}
            </select>
          </label>
          <label>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={rootPath || "Library name"}
            />
          </label>
        </>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="panel-actions">
        <button className="link-button" type="button" onClick={() => onDone(false)}>
          Cancel
        </button>
        {roots && roots.length > 0 && (
          <button className="primary-button" type="submit" disabled={busy || !rootPath}>
            {busy ? "Adding…" : "Add library"}
          </button>
        )}
      </div>
    </form>
  );
}