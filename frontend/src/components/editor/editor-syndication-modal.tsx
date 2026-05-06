import { useCallback, useEffect, useState } from "react";
import { Image01 } from "@untitledui/icons";
import { ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { Tabs } from "@/components/application/tabs/tabs";
import { CloseButton } from "@/components/base/buttons/close-button";
import { Toggle } from "@/components/base/toggle/toggle";
import {
  fetchTenantSyndicationStatus,
  postTenantSyndicationYoutubeMockAuthorize,
} from "@/services/tenant-syndication.service";
import { normalizeEditorClipTagsList, type EditorSubClip } from "@/types/editor";
import { cx } from "@/utils/cx";
import { buildThumbnailUrl } from "./editor-constants";
import { formatTime } from "./editor-timeline";

interface EditorSyndicationModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  clip: EditorSubClip | null;
  clipUrl: string;
  channelId: string;
  readOnly?: boolean;
}

export function EditorSyndicationModal({
  isOpen,
  onOpenChange,
  tenantId,
  clip,
  clipUrl,
  channelId,
  readOnly = false,
}: EditorSyndicationModalProps) {
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [youtubeConnected, setYoutubeConnected] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [syndicateEnabled, setSyndicateEnabled] = useState(false);

  const loadStatus = useCallback(async () => {
    const id = tenantId.trim();
    if (!id) return;
    setStatusLoading(true);
    setStatusError(null);
    try {
      const s = await fetchTenantSyndicationStatus(id);
      setYoutubeConnected(s.youtube.connected);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Failed to load syndication status");
      setYoutubeConnected(false);
    } finally {
      setStatusLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (!isOpen || !tenantId.trim()) return;
    void loadStatus();
  }, [isOpen, tenantId, loadStatus]);

  useEffect(() => {
    if (isOpen && clip) setSyndicateEnabled(false);
  }, [isOpen, clip?.id]);

  const handleMockAuthorize = useCallback(async () => {
    if (readOnly || !tenantId.trim()) return;
    setAuthBusy(true);
    setStatusError(null);
    try {
      const s = await postTenantSyndicationYoutubeMockAuthorize(tenantId.trim());
      setYoutubeConnected(s.youtube.connected);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Authorization failed");
    } finally {
      setAuthBusy(false);
    }
  }, [tenantId, readOnly]);

  if (!clip) return null;

  const title = clip.title?.trim() || `Clip ${clip.order}`;
  const description = clip.description?.trim() || "";
  const tags = normalizeEditorClipTagsList(clip.tags ?? []);
  const posters = clip.posters ?? [];

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      isKeyboardDismissDisabled={false}
      className="z-[80]"
    >
      <Modal className="z-[81]">
        <Dialog
          aria-label="Syndication"
          className="mx-4 flex w-full max-w-lg justify-center outline-hidden sm:mx-auto"
        >
          <div className="relative max-h-[90vh] w-full overflow-y-auto rounded-xl border border-secondary bg-primary p-5 shadow-xl">
            <CloseButton slot="close" size="xs" label="Close" className="absolute top-3 right-3 z-10" />
            <h2 className="pr-10 text-lg font-semibold text-primary">Syndication</h2>
            <p className="mt-1 text-xs text-tertiary">
              Publish this clip to connected social accounts. Metadata below mirrors your clip details by default.
            </p>
            <p className="mt-2 text-xs text-secondary">
              <span className="font-medium text-primary">{title}</span>
            </p>

            {readOnly ? (
              <p className="mt-3 rounded-lg border border-secondary bg-secondary px-3 py-2 text-xs text-secondary">
                This clip is encoding. Syndication controls are unavailable until the job finishes or is cancelled.
              </p>
            ) : null}

            {statusError ? <p className="mt-3 text-xs text-error-primary">{statusError}</p> : null}

            <Tabs defaultSelectedKey="youtube" className="mt-4 min-w-0 gap-3">
              <Tabs.List
                type="underline"
                orientation="horizontal"
                fullWidth
                items={[
                  { id: "youtube", label: "YouTube", children: "YouTube" },
                  { id: "instagram", label: "Instagram", children: "Instagram" },
                ]}
              />
              <Tabs.Panel id="youtube" className="pt-2">
                {statusLoading ? (
                  <p className="text-sm text-tertiary">Loading connection status…</p>
                ) : !youtubeConnected ? (
                  <div className="flex flex-col gap-3 rounded-lg border border-secondary bg-secondary/40 p-4">
                    <p className="text-sm text-primary">
                      Authorize the Immergo app so this workspace can syndicate uploads to YouTube on your behalf.
                    </p>
                    <p className="text-[11px] text-tertiary">
                      Backend integration is not wired yet — this button only simulates a successful OAuth flow.
                    </p>
                    <button
                      type="button"
                      disabled={readOnly || authBusy}
                      onClick={() => void handleMockAuthorize()}
                      className={cx(
                        "rounded-lg bg-brand-solid px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-solid-hover",
                        (readOnly || authBusy) && "cursor-not-allowed opacity-50",
                      )}
                    >
                      {authBusy ? "Authorizing…" : "Authorize Immergo for YouTube"}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <Toggle
                      isSelected={syndicateEnabled}
                      onChange={setSyndicateEnabled}
                      isDisabled={readOnly}
                      label="Syndicate this clip to YouTube"
                      hint="When enabled, the payload will use the metadata shown below (real upload is not implemented yet)."
                      size="sm"
                    />

                    <div className="rounded-lg border border-secondary bg-secondary/30 p-3">
                      <p className="text-xs font-medium text-secondary">Mapped clip metadata</p>
                      <dl className="mt-2 space-y-2 text-sm">
                        <div>
                          <dt className="text-[10px] font-medium uppercase tracking-wide text-tertiary">Title</dt>
                          <dd className="text-primary">{title}</dd>
                        </div>
                        <div>
                          <dt className="text-[10px] font-medium uppercase tracking-wide text-tertiary">Description</dt>
                          <dd className={description ? "text-primary" : "text-tertiary italic"}>
                            {description || "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[10px] font-medium uppercase tracking-wide text-tertiary">Tags</dt>
                          <dd className="flex flex-wrap gap-1">
                            {tags.length === 0 ? (
                              <span className="text-tertiary italic">—</span>
                            ) : (
                              tags.map((t) => (
                                <span
                                  key={t}
                                  className="rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-secondary ring-1 ring-secondary ring-inset"
                                >
                                  {t}
                                </span>
                              ))
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[10px] font-medium uppercase tracking-wide text-tertiary">Posters</dt>
                          <dd className="mt-1">
                            {posters.length === 0 ? (
                              <div className="flex items-center gap-2 text-tertiary">
                                <Image01 className="size-5 shrink-0 opacity-60" aria-hidden />
                                <span className="text-xs italic">No posters on this clip</span>
                              </div>
                            ) : (
                              <ul className="flex flex-wrap gap-2">
                                {posters.map((p) => (
                                  <li
                                    key={p.id}
                                    className="overflow-hidden rounded-md border border-secondary bg-primary"
                                  >
                                    {p.kind === "upload" ? (
                                      <img
                                        src={p.previewUrl}
                                        alt=""
                                        className="size-16 object-cover"
                                        loading="lazy"
                                      />
                                    ) : clipUrl.trim() && channelId.trim() ? (
                                      <img
                                        src={buildThumbnailUrl(clipUrl, p.timeSeconds, channelId)}
                                        alt=""
                                        className="size-16 object-cover"
                                        loading="lazy"
                                      />
                                    ) : (
                                      <div className="flex size-16 items-center justify-center text-[10px] text-tertiary">
                                        —
                                      </div>
                                    )}
                                    <div className="max-w-[4.5rem] truncate px-1 py-0.5 text-[9px] text-tertiary">
                                      {p.kind === "upload" ? p.originalName : formatTime(p.timeSeconds)}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                )}
              </Tabs.Panel>
              <Tabs.Panel id="instagram" className="pt-2">
                <p className="rounded-lg border border-dashed border-secondary bg-secondary/20 px-3 py-4 text-sm text-tertiary">
                  Instagram syndication is not available yet. It will appear here as a separate connection flow.
                </p>
              </Tabs.Panel>
            </Tabs>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-lg border border-secondary bg-primary px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-secondary"
              >
                Close
              </button>
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
