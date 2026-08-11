import { useState, type FormEvent } from "react";
import {
  isValidPassword,
  isValidUsername,
  MIN_PASSWORD_LENGTH,
  type User,
} from "@courseo/shared";
import { api, ApiRequestError } from "../api.js";

export function Setup({ onComplete }: { onComplete: (user: User) => void }) {
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!isValidUsername(username)) {
      setError("username may contain letters, numbers, and . _ -");
      return;
    }
    if (!isValidPassword(password)) {
      setError(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (password !== confirm) {
      setError("passwords do not match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onComplete(await api.setup({ username, displayName, password }));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "setup failed");
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="card" onSubmit={handleSubmit}>
        <h1 className="brand">
          Welcome to Course<span className="accent">o</span>
        </h1>
        <p className="tagline">
          Create the admin account for this deployment. You can add more users
          later.
        </p>
        <label>
          Display name
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="name"
            autoFocus
            required
          />
        </label>
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create admin account"}
        </button>
      </form>
    </main>
  );
}
