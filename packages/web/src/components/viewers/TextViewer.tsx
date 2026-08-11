import { useEffect, useState } from "react";
import Markdown from "react-markdown";

/**
 * Renders text lessons fetched as text: markdown through react-markdown
 * (which never injects raw HTML), everything else in a <pre>. PDFs and
 * HTML never go through here — they are iframed (spec §6.5).
 */
export function TextViewer({
  src,
  markdown,
}: {
  src: string;
  markdown: boolean;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setContent(null);
    fetch(src)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.text();
      })
      .then(setContent)
      .catch(() => setError("failed to load file"));
  }, [src]);

  if (error) return <p className="form-error">{error}</p>;
  if (content === null) return null;
  return markdown ? (
    <div className="text-viewer markdown">
      <Markdown>{content}</Markdown>
    </div>
  ) : (
    <pre className="text-viewer">{content}</pre>
  );
}
