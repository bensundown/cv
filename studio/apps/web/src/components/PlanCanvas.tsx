import type { Pt } from '@sn/core';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useRef, useState, type ReactNode } from 'react';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PageInfo {
  widthPt: number;
  heightPt: number;
  /** CSS pixels per page point at the current render. */
  pxPerPt: number;
}

/**
 * Renders a PDF page (or image) to a canvas and maps clicks to PAGE POINTS
 * (origin top-left, y down). Children are drawn in an SVG overlay in page points.
 */
export function PlanCanvas({ fileId, mime, page = 1, zoom, onClick, onInfo, children }: { fileId: string; mime: string; page?: number; zoom: number; onClick: (p: Pt, ev: React.MouseEvent) => void; onInfo: (i: PageInfo) => void; children?: ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [info, setInfo] = useState<PageInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const buf = await (await fetch(`/api/files/${fileId}`, { credentials: 'same-origin' })).arrayBuffer();
        const c = canvas.current!;
        const ctx = c.getContext('2d')!;
        const dpr = window.devicePixelRatio || 1;
        if (mime === 'application/pdf') {
          const doc = await pdfjs.getDocument({ data: buf }).promise;
          const pg = await doc.getPage(Math.min(page, doc.numPages));
          const base = pg.getViewport({ scale: 1 });
          const vp = pg.getViewport({ scale: zoom * dpr });
          c.width = vp.width;
          c.height = vp.height;
          c.style.width = `${base.width * zoom}px`;
          c.style.height = `${base.height * zoom}px`;
          await pg.render({ canvasContext: ctx, viewport: vp, canvas: c }).promise;
          if (!cancelled) {
            const i = { widthPt: base.width, heightPt: base.height, pxPerPt: zoom };
            setInfo(i);
            onInfo(i);
          }
        } else {
          const img = new Image();
          img.src = URL.createObjectURL(new Blob([buf], { type: mime }));
          await img.decode();
          c.width = img.naturalWidth * zoom * dpr;
          c.height = img.naturalHeight * zoom * dpr;
          c.style.width = `${img.naturalWidth * zoom}px`;
          c.style.height = `${img.naturalHeight * zoom}px`;
          ctx.drawImage(img, 0, 0, c.width, c.height);
          if (!cancelled) {
            const i = { widthPt: img.naturalWidth, heightPt: img.naturalHeight, pxPerPt: zoom };
            setInfo(i);
            onInfo(i);
          }
        }
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, mime, page, zoom]);

  const handle = (ev: React.MouseEvent<SVGSVGElement>) => {
    if (!info) return;
    const r = ev.currentTarget.getBoundingClientRect();
    onClick({ x: (ev.clientX - r.left) / info.pxPerPt, y: (ev.clientY - r.top) / info.pxPerPt }, ev);
  };

  return (
    <div className="calib">
      {err && <div className="alert error">Could not render plan: {err}</div>}
      <canvas ref={canvas} />
      {info && (
        <svg viewBox={`0 0 ${info.widthPt} ${info.heightPt}`} width={info.widthPt * info.pxPerPt} height={info.heightPt * info.pxPerPt} onClick={handle}>
          {children}
        </svg>
      )}
    </div>
  );
}
