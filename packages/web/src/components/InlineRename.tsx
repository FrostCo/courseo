import { useState, type FormEvent } from "react";
import { ApiRequestError } from "../api.js";

/**
 * A pencil button that swaps into a small inline rename form. The caller
 * performs the actual API call; errors show next to the input.
 */
export function InlineRename({
  name,
  label,
  onRename,
}: {
  name: string;
  label: string;
  onRename: (newName: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <button
        className="icon-button"
        title={label}
        aria-label={label}
        onClick={() => {
          setValue(name);
          setError(null);
          setEditing(true);
        }}
      >
        ✎
      </button>
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const newName = value.trim();
    if (newName === name || newName === "") {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onRename(newName);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "rename failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="rename-form" onSubmit={handleSubmit}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <button className="link-button" type="submit" disabled={busy}>
        Save
      </button>
      <button
        className="link-button"
        type="button"
        onClick={() => setEditing(false)}
      >
        Cancel
      </button>
      {error && <span className="form-error">{error}</span>}
    </form>
  );
}
