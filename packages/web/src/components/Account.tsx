import { useState, type FormEvent } from "react";
import { MIN_PASSWORD_LENGTH, type User } from "@courseo/shared";
import { api, ApiRequestError } from "../api.js";

/** Self-service page: change your own password. */
export function Account({ user }: { user: User }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirm) {
      setError("new passwords do not match");
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.changePassword({ currentPassword, newPassword });
      setSaved(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "change failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-heading">
        <h2>Account</h2>
        <span className="tagline">
          {user.displayName} (@{user.username})
        </span>
      </div>

      <form className="panel account-panel" onSubmit={handleSubmit}>
        <h3>Change password</h3>
        <p className="tagline">
          Other signed-in sessions are signed out; this one stays.
        </p>
        <label>
          Current password
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <label>
          New password ({MIN_PASSWORD_LENGTH}+ characters)
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </label>
        <label>
          Repeat new password
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        {saved && <p className="form-success">Password changed.</p>}
        <div className="panel-actions">
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Change password"}
          </button>
        </div>
      </form>
    </div>
  );
}
