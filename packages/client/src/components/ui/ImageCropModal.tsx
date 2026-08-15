import { useState, useRef, useEffect, useCallback } from 'react';
import styles from './imageCropModal.module.scss';

export interface ImageCropModalProps {
  /** Data URL (or any browser-loadable URL) of the image to crop. */
  imageSrc: string;
  /** Crop viewport shape. 'circle' is used for avatars, 'rect' for banners. */
  shape: 'circle' | 'rect';
  /** Pixel dimensions of the exported image. Defaults are shape-appropriate. */
  outputWidth?: number;
  outputHeight?: number;
  title?: string;
  onApply: (dataUrl: string) => void;
  onCancel: () => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;

interface NaturalSize {
  w: number;
  h: number;
}

interface Offset {
  x: number;
  y: number;
}

/**
 * Self-contained crop/reposition modal built on plain React + canvas (no npm deps).
 * The chosen image is shown inside a fixed-size crop viewport; the user can drag to
 * reposition it and use the wheel or a slider to zoom. On Apply, the visible region is
 * rendered to an offscreen canvas at `outputWidth`x`outputHeight` and exported as a
 * data URL via `onApply`.
 */
export const ImageCropModal = ({
  imageSrc,
  shape,
  outputWidth = shape === 'circle' ? 256 : 600,
  outputHeight = shape === 'circle' ? 256 : 240,
  title,
  onApply,
  onCancel,
}: ImageCropModalProps) => {
  const viewportWidth = shape === 'circle' ? 260 : 420;
  const viewportHeight =
    shape === 'circle' ? 260 : Math.round(420 * (outputHeight / outputWidth));

  const [naturalSize, setNaturalSize] = useState<NaturalSize | null>(null);
  const [zoomFactor, setZoomFactor] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });

  const imgRef = useRef<HTMLImageElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; startOffX: number; startOffY: number } | null>(null);

  const baseScale = naturalSize
    ? Math.max(viewportWidth / naturalSize.w, viewportHeight / naturalSize.h)
    : 1;
  const scale = baseScale * zoomFactor;
  const displayedW = naturalSize ? naturalSize.w * scale : 0;
  const displayedH = naturalSize ? naturalSize.h * scale : 0;

  const clampOffset = useCallback(
    (off: Offset, dW: number, dH: number): Offset => {
      const minX = Math.min(0, viewportWidth - dW);
      const minY = Math.min(0, viewportHeight - dH);
      return {
        x: Math.min(0, Math.max(minX, off.x)),
        y: Math.min(0, Math.max(minY, off.y)),
      };
    },
    [viewportWidth, viewportHeight],
  );

  // Center the image and reset zoom once its natural size is known.
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const w = img.naturalWidth || 1;
    const h = img.naturalHeight || 1;
    const bs = Math.max(viewportWidth / w, viewportHeight / h);
    const dW = w * bs;
    const dH = h * bs;
    setNaturalSize({ w, h });
    setZoomFactor(MIN_ZOOM);
    setOffset({ x: (viewportWidth - dW) / 2, y: (viewportHeight - dH) / 2 });
  };

  // Re-clamp the offset whenever zoom changes the displayed size, so the image never
  // leaves a gap inside the viewport.
  useEffect(() => {
    if (!naturalSize) return;
    setOffset((prev) => clampOffset(prev, displayedW, displayedH));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomFactor, naturalSize]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    modalRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startOffX: offset.x, startOffY: offset.y };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    setOffset(clampOffset({ x: drag.startOffX + dx, y: drag.startOffY + dy }, displayedW, displayedH));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoomFactor((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + delta)));
  };

  const handleOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onCancel();
  };

  const handleApply = () => {
    const img = imgRef.current;
    if (!img || !naturalSize) return;

    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const sourceX = -offset.x / scale;
    const sourceY = -offset.y / scale;
    const sourceW = viewportWidth / scale;
    const sourceH = viewportHeight / scale;

    ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, 0, outputWidth, outputHeight);
    onApply(canvas.toDataURL('image/png'));
  };

  const previewWidth = shape === 'circle' ? 72 : 108;
  const previewHeight =
    shape === 'circle' ? 72 : Math.round(108 * (outputHeight / outputWidth));
  const previewScale = previewWidth / viewportWidth;

  return (
    <div className={styles.overlay} onMouseDown={handleOverlayMouseDown}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? 'Crop image'}
        tabIndex={-1}
        ref={modalRef}
      >
        <h2 className={styles.title}>{title ?? 'Crop Image'}</h2>

        <div className={styles.cropArea}>
          <div
            className={`${styles.viewport} ${shape === 'circle' ? styles.viewportCircle : styles.viewportRect}`}
            style={{ width: viewportWidth, height: viewportHeight }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onWheel={handleWheel}
          >
            <img
              ref={imgRef}
              src={imageSrc}
              alt=""
              className={styles.cropImage}
              draggable={false}
              onLoad={handleImageLoad}
              style={{
                width: displayedW || undefined,
                height: displayedH || undefined,
                left: offset.x,
                top: offset.y,
                visibility: naturalSize ? 'visible' : 'hidden',
              }}
            />
          </div>

          <div className={styles.previewColumn}>
            <div className={styles.previewLabel}>Preview</div>
            <div
              className={`${styles.previewBox} ${shape === 'circle' ? styles.previewCircle : styles.previewRect}`}
              style={{ width: previewWidth, height: previewHeight }}
            >
              {naturalSize && (
                <img
                  src={imageSrc}
                  alt=""
                  className={styles.cropImage}
                  draggable={false}
                  style={{
                    width: displayedW * previewScale,
                    height: displayedH * previewScale,
                    left: offset.x * previewScale,
                    top: offset.y * previewScale,
                  }}
                />
              )}
            </div>
          </div>
        </div>

        <div className={styles.zoomRow}>
          <span className={styles.zoomLabel}>Zoom</span>
          <input
            type="range"
            className={styles.zoomSlider}
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoomFactor}
            onChange={(e) => setZoomFactor(Number(e.target.value))}
            aria-label="Zoom"
          />
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.applyBtn}
            onClick={handleApply}
            disabled={!naturalSize}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};
