import { useEffect, useState } from "react";

type ApiStatus = "checking" | "ok" | "unreachable";

export function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    fetch("/api/health")
      .then((res) => setApiStatus(res.ok ? "ok" : "unreachable"))
      .catch(() => setApiStatus("unreachable"));
  }, []);

  return (
    <main className="shell">
      <h1>
        Course<span className="accent">o</span>
      </h1>
      <p className="tagline">
        Organize, share, and watch your self-hosted courses.
      </p>
      <p className={`api-status api-status--${apiStatus}`}>
        {apiStatus === "checking" && "Checking API…"}
        {apiStatus === "ok" && "API connected"}
        {apiStatus === "unreachable" && "API unreachable"}
      </p>
    </main>
  );
}
