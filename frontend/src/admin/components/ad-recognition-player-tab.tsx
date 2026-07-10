import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Empty, Space, Tag, Typography } from "antd";
import videojs from "video.js";
import type Player from "video.js/dist/types/player";
import "video.js/dist/video-js.css";
import { useTranslation } from "react-i18next";
import type { StreamInfo } from "./ad-recognition-setup-tab";

type Props = {
  playerUrl: string | null;
  streamInfo?: StreamInfo | null;
};

/** Selection rectangle in NATIVE (base-resolution) pixels. */
type NativeRect = { x: number; y: number; w: number; h: number };

/**
 * "Player" tab: plays the channel archive so the operator can pause on a frame, drag-select a
 * region and download that crop at 1:1 with the base resolution. Those crops are the ideal template
 * samples to upload in the "Ad Recognition Setup" tab (they match the analyzed ROI pixel-for-pixel).
 */
export function AdRecognitionPlayerTab({ playerUrl, streamInfo }: Props) {
  const { t } = useTranslation("admin");
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);

  // Captured still (native resolution) kept off-screen, plus its data URL for display.
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  // Drag selection (in displayed CSS pixels over the captured image).
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [selDisplay, setSelDisplay] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current || !playerUrl) return;

    const videoEl = document.createElement("video-js");
    videoEl.classList.add("vjs-fluid");
    // crossorigin is required so we can read pixels from the <video> into a canvas.
    videoEl.setAttribute("crossorigin", "anonymous");
    containerRef.current.appendChild(videoEl);

    const player = videojs(videoEl, {
      controls: true,
      autoplay: false,
      preload: "auto",
      fluid: true,
      sources: [{ src: playerUrl, type: "application/x-mpegURL" }],
    });
    playerRef.current = player;

    return () => {
      player.dispose();
      playerRef.current = null;
    };
  }, [playerUrl]);

  const captureFrame = useCallback(() => {
    setCaptureError(null);
    const video = containerRef.current?.querySelector("video") as HTMLVideoElement | null;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCaptureError(t("player.captureNoFrame"));
      return;
    }
    try {
      // Pause so the still matches what's on screen.
      playerRef.current?.pause();
      const canvas = frameCanvasRef.current || document.createElement("canvas");
      frameCanvasRef.current = canvas;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setCaptureError(t("player.captureFailed"));
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      // toDataURL throws if the canvas is tainted (CDN without CORS headers).
      const url = canvas.toDataURL("image/png");
      setCapturedUrl(url);
      setSelDisplay(null);
    } catch {
      setCaptureError(t("player.captureCors"));
    }
  }, [t]);

  // ---- drag selection over the captured image -------------------------------------------------

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!capturedUrl) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setDragStart({ x, y });
    setSelDisplay({ x, y, w: 0, h: 0 });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const cy = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    setSelDisplay({
      x: Math.min(dragStart.x, cx),
      y: Math.min(dragStart.y, cy),
      w: Math.abs(cx - dragStart.x),
      h: Math.abs(cy - dragStart.y),
    });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setDragStart(null);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  /** Convert the displayed selection to native (base-resolution) pixels. */
  const nativeRect = (): NativeRect | null => {
    const img = imgRef.current;
    const canvas = frameCanvasRef.current;
    if (!img || !canvas || !selDisplay || selDisplay.w < 2 || selDisplay.h < 2) return null;
    const scaleX = canvas.width / img.clientWidth;
    const scaleY = canvas.height / img.clientHeight;
    return {
      x: Math.round(selDisplay.x * scaleX),
      y: Math.round(selDisplay.y * scaleY),
      w: Math.round(selDisplay.w * scaleX),
      h: Math.round(selDisplay.h * scaleY),
    };
  };

  const downloadCrop = () => {
    const src = frameCanvasRef.current;
    const r = nativeRect();
    if (!src || !r) return;
    const out = document.createElement("canvas");
    out.width = r.w;
    out.height = r.h;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    out.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `template_${r.w}x${r.h}_${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }, "image/png");
  };

  const sel = nativeRect();

  if (!playerUrl) {
    return <Empty description={t("player.noStream")} />;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
        <Space wrap>
          {streamInfo?.width && streamInfo?.height ? (
            <Tag color="geekblue">
              {streamInfo.width}×{streamInfo.height}
              {streamInfo.fps ? ` @ ${streamInfo.fps} fps` : ""}
            </Tag>
          ) : null}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("player.hint")}
          </Typography.Text>
        </Space>
        <Space>
          <Button type="primary" onClick={captureFrame}>
            {t("player.capture")}
          </Button>
          <Button disabled={!sel} onClick={downloadCrop}>
            {t("player.download")}
          </Button>
        </Space>
      </div>

      {captureError && (
        <Alert type="warning" showIcon style={{ marginBottom: 8 }} message={captureError} />
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {/* Live player */}
        <div>
          <Typography.Text strong style={{ fontSize: 12 }}>
            {t("player.livePlayer")}
          </Typography.Text>
          <div ref={containerRef} className="video-js-container" style={{ marginTop: 4 }} />
        </div>

        {/* Captured still + selection */}
        <div>
          <Typography.Text strong style={{ fontSize: 12 }}>
            {t("player.capturedFrame")}
            {sel ? ` — ${sel.w}×${sel.h}px` : ""}
          </Typography.Text>
          {capturedUrl ? (
            <div
              style={{ position: "relative", marginTop: 4, userSelect: "none", cursor: "crosshair", lineHeight: 0 }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              <img
                ref={imgRef}
                src={capturedUrl}
                alt="captured frame"
                draggable={false}
                style={{ width: "100%", display: "block", borderRadius: 4 }}
              />
              {selDisplay && selDisplay.w > 0 && selDisplay.h > 0 && (
                <div
                  style={{
                    position: "absolute",
                    left: selDisplay.x,
                    top: selDisplay.y,
                    width: selDisplay.w,
                    height: selDisplay.h,
                    border: "2px solid #d4380d",
                    background: "rgba(212,56,13,0.15)",
                    pointerEvents: "none",
                  }}
                />
              )}
            </div>
          ) : (
            <div
              style={{
                marginTop: 4,
                border: "1px dashed rgba(0,0,0,0.2)",
                borderRadius: 4,
                minHeight: 160,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t("player.capturePrompt")}
              </Typography.Text>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AdRecognitionPlayerTab;
