import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import type { User } from "@courseo/shared";
import { api, ApiRequestError } from "./api.js";
import { CourseBrowser } from "./components/CourseBrowser.js";
import { CourseView } from "./components/CourseView.js";
import { LessonView } from "./components/LessonView.js";
import { Libraries } from "./components/Libraries.js";
import { Login } from "./components/Login.js";
import { Setup } from "./components/Setup.js";

type AuthState =
  | { phase: "loading" }
  | { phase: "setup" }
  | { phase: "login" }
  | { phase: "ready"; user: User }
  | { phase: "error"; message: string };

export function App() {
  const [auth, setAuth] = useState<AuthState>({ phase: "loading" });

  useEffect(() => {
    (async () => {
      try {
        setAuth({ phase: "ready", user: await api.me() });
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 401) {
          const { needsSetup } = await api.setupStatus().catch(() => ({
            needsSetup: false,
          }));
          setAuth({ phase: needsSetup ? "setup" : "login" });
        } else {
          setAuth({ phase: "error", message: "API unreachable" });
        }
      }
    })();
  }, []);

  async function handleLogout() {
    await api.logout().catch(() => undefined);
    setAuth({ phase: "login" });
  }

  switch (auth.phase) {
    case "loading":
      return <main className="auth-page" />;
    case "error":
      return (
        <main className="auth-page">
          <p className="form-error">{auth.message}</p>
        </main>
      );
    case "setup":
      return <Setup onComplete={(user) => setAuth({ phase: "ready", user })} />;
    case "login":
      return <Login onLogin={(user) => setAuth({ phase: "ready", user })} />;
    case "ready":
      return (
        <>
          <header className="topbar">
            <Link className="brand brand-link" to="/libraries">
              Course<span className="accent">o</span>
            </Link>
            <span className="topbar-user">
              {auth.user.displayName}
              <button className="link-button" onClick={handleLogout}>
                Sign out
              </button>
            </span>
          </header>
          <main className="content">
            <Routes>
              <Route path="/libraries" element={<Libraries user={auth.user} />} />
              <Route
                path="/libraries/:libraryId"
                element={<CourseBrowser user={auth.user} />}
              />
              <Route
                path="/courses/:courseId"
                element={<CourseView user={auth.user} />}
              />
              <Route path="/courses/:courseId/lessons/*" element={<LessonView />} />
              <Route path="*" element={<Navigate to="/libraries" replace />} />
            </Routes>
          </main>
        </>
      );
  }
}
