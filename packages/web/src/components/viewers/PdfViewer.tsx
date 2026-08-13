import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * pdf.js-based PDF viewer for browsers without a native inline viewer
 * (navigator.pdfViewerEnabled === false — notably Android Chrome, which
 * shows an "Open" download button inside PDF iframes instead of the
 * document). Pages render lazily into canvases at container width.
 * Desktop browsers keep the native iframe viewer; pdf.js and its worker
 * load as a separate chunk only when this component mounts.
 */

type Pdfjs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<Pdfjs> | null = null;
function loadPdfjs(): Promise<Pdfjs> {
  // The legacy build polyfills newer JS builtins the modern build relies
  // on — this fallback exists for the least-capable browsers, so don't
  // assume bleeding-edge JavaScript support.
  pdfjsPromise ??= Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs as Pdfjs;
  });
  return pdfjsPromise;
}

export function PdfViewer({ src }: { src: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    loadPdfjs()
      .then((pdfjs) => pdfjs.getDocument({ url: src }).promise)
      .then((d) => {
        if (cancelled) void d.loadingTask.destroy();
        else {
          loaded = d;
          setDoc(d);
        }
      })
      .catch(() => {
        if (!cancelled) setError("failed to load PDF");
      });
    return () => {
      cancelled = true;
      setDoc(null);
      void loaded?.loadingTask.destroy();
    };
  }, [src]);

  // Re-render pages at the new width when the container resizes
  // (rotation, window resize), debounced a frame at a time.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setWidth(Math.floor(el.clientWidth));
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  if (error) return <p className="form-error">{error}</p>;

  return (
    <div className="pdf-viewer" ref={containerRef}>
      {doc !== null &&
        width > 0 &&
        Array.from({ length: doc.numPages }, (_, i) => (
          <PdfPage key={i + 1} doc={doc} pageNumber={i + 1} width={width} />
        ))}
    </div>
  );
}

function PdfPage({
  doc,
  pageNumber,
  width,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  width: number;
}) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(false);

  // Only render pages near the viewport — a 300-page PDF must not
  // rasterize everything up front.
  useEffect(() => {
    const el = holderRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null =
      null;
    void doc
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const scale = width / base.width;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: scale * dpr });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        renderTask = page.render({
          canvas,
          canvasContext: canvas.getContext("2d") ?? undefined,
          viewport,
        });
        return renderTask.promise;
      })
      .catch(() => {
        // Cancelled renders reject; nothing to do.
      });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [visible, doc, pageNumber, width]);

  return (
    <div
      className="pdf-page"
      ref={holderRef}
      // Letter-ish placeholder height until the page renders, so the
      // scrollbar doesn't jump wildly while paging through.
      style={{ minHeight: `${Math.floor(width * 1.29)}px` }}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
