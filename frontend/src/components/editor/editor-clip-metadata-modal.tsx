import { useCallback, useEffect, useRef, useState } from "react";
import { ConfigProvider, Select, Tag, theme } from "antd";
import { Image01, Upload01 } from "@untitledui/icons";
import { ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { CloseButton } from "@/components/base/buttons/close-button";
import {
  deleteEditorPoster,
  uploadEditorPosters,
} from "@/services/editor-posters.service";
import { httpClient } from "@/services/http-client";
import { normalizeEditorClipTagsList, type EditorClipPoster, type EditorSubClip } from "@/types/editor";
import { cx } from "@/utils/cx";
import { buildThumbnailUrl } from "./editor-constants";
import { formatTime } from "./editor-timeline";

const TITLE_MAX = 255;
const DESCRIPTION_MAX = 255;

function clonePosters(list: EditorClipPoster[] | undefined): EditorClipPoster[] {
  return list ? list.map((p) => ({ ...p })) : [];
}

interface EditorClipMetadataModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  clip: EditorSubClip | null;
  /** VOD clip URL for capture-poster thumbnails (same as timeline). */
  clipUrl: string;
  channelId: string;
  onSave: (
    clipId: string,
    patch: Pick<EditorSubClip, "title" | "description" | "posters" | "tags">,
  ) => void;
  onSeek?: (timeSeconds: number) => void;
  /** When true, all fields are read-only (e.g. clip is encoding). Only Close is available. */
  readOnly?: boolean;
}

export function EditorClipMetadataModal({
  isOpen,
  onOpenChange,
  clip,
  clipUrl,
  channelId,
  onSave,
  onSeek,
  readOnly = false,
}: EditorClipMetadataModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [draftPosters, setDraftPosters] = useState<EditorClipPoster[]>([]);
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [antdDark, setAntdDark] = useState(false);

  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setAntdDark(el.classList.contains("dark-mode"));
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    if (!isOpen || !clip) return;
    setTitle(clip.title ?? "");
    setDescription(clip.description ?? "");
    setDraftPosters(clonePosters(clip.posters));
    setDraftTags(normalizeEditorClipTagsList(clip.tags ?? []));
    setUploadError(null);
  }, [isOpen, clip]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const handleApply = useCallback(() => {
    if (!clip || readOnly) return;
    onSave(clip.id, {
      title: title.slice(0, TITLE_MAX),
      description: description.slice(0, DESCRIPTION_MAX),
      posters: draftPosters,
      tags: normalizeEditorClipTagsList(draftTags),
    });
    onOpenChange(false);
  }, [clip, readOnly, title, description, draftPosters, draftTags, onSave, onOpenChange]);

  const removePoster = useCallback(
    async (p: EditorClipPoster) => {
      if (readOnly) return;
      if (p.kind === "upload" && channelId) {
        try {
          await deleteEditorPoster(channelId, p.id);
        } catch (e) {
          console.warn("deleteEditorPoster:", e);
        }
      }
      setDraftPosters((prev) => prev.filter((x) => x.id !== p.id));
    },
    [channelId, readOnly],
  );

  const onFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (readOnly) return;
      const files = Array.from(e.target.files || []);
      e.target.value = "";
      if (files.length === 0) return;
      if (!channelId.trim()) {
        setUploadError("Channel ID is required to upload posters.");
        return;
      }
      setUploadError(null);
      setUploading(true);
      try {
        const rows = await uploadEditorPosters(channelId, files);
        setDraftPosters((prev) => [
          ...prev,
          ...rows.map((r) => ({
            kind: "upload" as const,
            id: r.id,
            originalName: r.originalName,
            storedRelative: r.storedRelative,
            previewUrl: r.previewUrl,
            mime: r.mime,
          })),
        ]);
      } catch (err) {
        setUploadError(httpClient.getErrorMessage(err));
      } finally {
        setUploading(false);
      }
    },
    [channelId, readOnly],
  );

  if (!clip) return null;

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      isKeyboardDismissDisabled={false}
    >
      <Modal>
        <Dialog
          aria-label="Clip metadata"
          className="mx-4 flex w-full max-w-lg justify-center outline-hidden sm:mx-auto"
        >
          <div className="relative max-h-[90vh] w-full overflow-y-auto rounded-xl border border-secondary bg-primary p-5 shadow-xl">
            <CloseButton slot="close" size="xs" label="Close" className="absolute top-3 right-3 z-10" />
            <h2 className="pr-10 text-lg font-semibold text-primary">Clip details</h2>
            <p className="mt-1 text-xs text-tertiary">
              Title, description, tags, and posters for this sub-clip (order #{clip.order}).
            </p>

            {readOnly ? (
              <p className="mt-3 rounded-lg border border-secondary bg-secondary px-3 py-2 text-xs text-secondary">
                This clip is encoding. Metadata cannot be changed. Use <strong>Stop</strong> on the clip row
                to cancel the job, then try again.
              </p>
            ) : null}

            <div className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-secondary">Title</span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={TITLE_MAX}
                  readOnly={readOnly}
                  placeholder="Clip title"
                  className={cx(
                    "rounded-lg border border-secondary px-3 py-2 text-sm text-primary placeholder:text-placeholder",
                    readOnly ? "cursor-not-allowed bg-secondary text-secondary" : "bg-primary",
                  )}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-secondary">Description</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={DESCRIPTION_MAX}
                  readOnly={readOnly}
                  placeholder="Clip description"
                  rows={3}
                  className={cx(
                    "rounded-lg border border-secondary px-3 py-2 text-sm text-primary placeholder:text-placeholder",
                    readOnly ? "cursor-not-allowed bg-secondary text-secondary" : "bg-primary",
                  )}
                />
                <span className="text-[10px] text-tertiary">Max {DESCRIPTION_MAX} characters</span>
              </label>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-secondary">Tags</span>
                <p className="text-[10px] text-tertiary">
                  Short labels for search or publishing; each value is stored in the export JSON as a string in{" "}
                  <code className="rounded bg-secondary px-1 py-0.5 text-[10px]">metadata.tags</code>.
                </p>
                {readOnly ? (
                  draftTags.length === 0 ? (
                    <span className="text-xs text-tertiary">No tags</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {draftTags.map((t) => (
                        <Tag key={t}>{t}</Tag>
                      ))}
                    </div>
                  )
                ) : (
                  <ConfigProvider
                    theme={{
                      algorithm: antdDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
                    }}
                  >
                    <Select
                      mode="tags"
                      value={draftTags}
                      onChange={(next) => setDraftTags(normalizeEditorClipTagsList(next))}
                      placeholder="Add tags (Enter or comma)"
                      disabled={readOnly}
                      className="w-full"
                      tokenSeparators={[","]}
                      styles={{
                        popup: {
                          root: { zIndex: 9990 },
                        },
                      }}
                    />
                  </ConfigProvider>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-secondary">Posters</span>
                <p className="text-[10px] text-tertiary">
                  Upload images to the same storage as channel logos (posters folder on the bucket), use the
                  camera button on the clip row to bookmark the current playhead, or remove entries below.
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                  multiple
                  className="hidden"
                  onChange={onFileChange}
                  disabled={readOnly}
                />
                <button
                  type="button"
                  disabled={readOnly || uploading || !channelId.trim()}
                  onClick={() => fileRef.current?.click()}
                  className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-secondary bg-secondary px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-tertiary/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Upload01 className="size-4 text-fg-secondary" aria-hidden />
                  {uploading ? "Uploading…" : "Upload images"}
                </button>
                {uploadError ? <p className="text-xs text-error-primary">{uploadError}</p> : null}

                <div className="mt-1 rounded-lg border border-secondary bg-secondary p-2">
                  {draftPosters.length === 0 ? (
                    <div className="flex flex-col items-center gap-1 py-4 text-center text-tertiary">
                      <Image01 className="size-6 text-fg-quaternary" aria-hidden />
                      <span className="text-[11px]">No posters yet</span>
                    </div>
                  ) : (
                    <ul className="flex max-h-48 flex-col gap-2 overflow-y-auto">
                      {draftPosters.map((p) => (
                        <li
                          key={p.id}
                          className="flex items-center gap-2 rounded-md border border-secondary bg-primary px-2 py-1.5 text-xs"
                        >
                          {p.kind === "upload" ? (
                            <img
                              src={p.previewUrl}
                              alt=""
                              className="size-12 shrink-0 rounded object-cover"
                              loading="lazy"
                            />
                          ) : clipUrl.trim() && channelId.trim() ? (
                            <img
                              src={buildThumbnailUrl(clipUrl, p.timeSeconds, channelId)}
                              alt=""
                              className="size-12 shrink-0 rounded object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex size-12 shrink-0 items-center justify-center rounded bg-quaternary text-[10px] text-tertiary">
                              Cap
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            {p.kind === "upload" ? (
                              <span className="line-clamp-2 text-secondary">{p.originalName}</span>
                            ) : readOnly ? (
                              <span className="font-medium text-secondary">
                                {formatTime(p.timeSeconds)} (capture)
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => onSeek?.(p.timeSeconds)}
                                className="font-medium text-brand-secondary hover:underline"
                              >
                                {formatTime(p.timeSeconds)} (capture)
                              </button>
                            )}
                          </div>
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => void removePoster(p)}
                            className="shrink-0 rounded p-1 text-fg-quaternary hover:bg-tertiary hover:text-fg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                            aria-label="Remove poster"
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-secondary bg-primary px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-secondary"
              >
                {readOnly ? "Close" : "Cancel"}
              </button>
              {readOnly ? null : (
                <button
                  type="button"
                  onClick={handleApply}
                  className="rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-solid-hover"
                >
                  Save
                </button>
              )}
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
