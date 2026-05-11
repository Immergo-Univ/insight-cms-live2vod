import { useCallback, useEffect, useState } from "react";
import { Image01 } from "@untitledui/icons";
import { ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { Tabs } from "@/components/application/tabs/tabs";
import { CloseButton } from "@/components/base/buttons/close-button";
import { Toggle } from "@/components/base/toggle/toggle";
import {
  fetchTenantSyndicationStatus,
  fetchTenantSyndicationYoutubeAuthUrl,
  postTenantSyndicationYoutubeMockAuthorize,
} from "@/services/tenant-syndication.service";
import type {
  EditorClipSyndication,
  EditorClipYoutubeSyndication,
  EditorClipYoutubeSyndicationOptions,
  EditorYoutubePrivacyStatus,
} from "@/types/editor";
import type { EditorSubClip } from "@/types/editor";
import { normalizeEditorClipTagsList } from "@/types/editor";
import { cx } from "@/utils/cx";
import { buildThumbnailUrl } from "./editor-constants";
import { formatTime } from "./editor-timeline";

function defaultYoutubeBranch(clip: EditorSubClip): EditorClipYoutubeSyndication {
  const existing = clip.syndication?.youtube;
  return {
    enabled: existing?.enabled === true,
    options: {
      privacyStatus: (existing?.options?.privacyStatus as EditorYoutubePrivacyStatus) || "private",
      categoryId: existing?.options?.categoryId != null ? String(existing.options.categoryId) : "22",
      embeddable: existing?.options?.embeddable !== false,
      license: existing?.options?.license === "creativeCommon" ? "creativeCommon" : "youtube",
      publicStatsViewable: existing?.options?.publicStatsViewable !== false,
      selfDeclaredMadeForKids: Boolean(existing?.options?.selfDeclaredMadeForKids),
      notifySubscribers: Boolean(existing?.options?.notifySubscribers),
      titleOverride: existing?.options?.titleOverride ?? "",
      descriptionOverride: existing?.options?.descriptionOverride ?? "",
      tagsExtra: existing?.options?.tagsExtra?.length ? [...existing.options.tagsExtra] : [],
      defaultLanguage: existing?.options?.defaultLanguage ?? "",
      defaultAudioLanguage: existing?.options?.defaultAudioLanguage ?? "",
    },
    upload: existing?.upload ? { ...existing.upload } : undefined,
  };
}

interface EditorSyndicationModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  clip: EditorSubClip | null;
  clipUrl: string;
  channelId: string;
  readOnly?: boolean;
  onSave?: (clipId: string, syndication: EditorClipSyndication | undefined) => void;
}

export function EditorSyndicationModal({
  isOpen,
  onOpenChange,
  tenantId,
  clip,
  clipUrl,
  channelId,
  readOnly = false,
  onSave,
}: EditorSyndicationModalProps) {
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [youtubeConnected, setYoutubeConnected] = useState(false);
  const [mockAuthAvailable, setMockAuthAvailable] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [ytDraft, setYtDraft] = useState<EditorClipYoutubeSyndication>(() =>
    clip ? defaultYoutubeBranch(clip) : { enabled: false, options: {} },
  );

  const loadStatus = useCallback(async () => {
    const id = tenantId.trim();
    if (!id) return;
    setStatusLoading(true);
    setStatusError(null);
    try {
      const s = await fetchTenantSyndicationStatus(id);
      setYoutubeConnected(s.youtube.connected);
      setMockAuthAvailable(!!s.youtube.mockAuthAvailable);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Failed to load syndication status");
      setYoutubeConnected(false);
      setMockAuthAvailable(false);
    } finally {
      setStatusLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (!isOpen || !tenantId.trim()) return;
    void loadStatus();
  }, [isOpen, tenantId, loadStatus]);

  useEffect(() => {
    if (isOpen && clip) setYtDraft(defaultYoutubeBranch(clip));
  }, [isOpen, clip?.id, clip?.syndication]);

  const handleStartOAuth = useCallback(async () => {
    if (readOnly || !tenantId.trim()) return;
    setAuthBusy(true);
    setStatusError(null);
    try {
      const url = await fetchTenantSyndicationYoutubeAuthUrl(tenantId.trim());
      window.location.href = url;
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Could not start Google sign-in");
    } finally {
      setAuthBusy(false);
    }
  }, [tenantId, readOnly]);

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

  const setOpt = useCallback((patch: Partial<EditorClipYoutubeSyndicationOptions>) => {
    setYtDraft((d) => ({ ...d, options: { ...d.options, ...patch } }));
  }, []);

  const handleSave = useCallback(() => {
    if (!clip || readOnly || !onSave) return;
    const next: EditorClipSyndication = {
      youtube: {
        enabled: ytDraft.enabled,
        options: {
          ...ytDraft.options,
          titleOverride: ytDraft.options.titleOverride?.trim() || undefined,
          descriptionOverride: ytDraft.options.descriptionOverride?.trim() || undefined,
          tagsExtra: ytDraft.options.tagsExtra?.length
            ? normalizeEditorClipTagsList(ytDraft.options.tagsExtra)
            : undefined,
          categoryId: ytDraft.options.categoryId?.trim() || "22",
          defaultLanguage: ytDraft.options.defaultLanguage?.trim() || undefined,
          defaultAudioLanguage: ytDraft.options.defaultAudioLanguage?.trim() || undefined,
        },
        upload: ytDraft.upload,
      },
    };
    if (!next.youtube?.enabled) {
      onSave(clip.id, undefined);
    } else {
      onSave(clip.id, next);
    }
    onOpenChange(false);
  }, [clip, readOnly, onSave, ytDraft, onOpenChange]);

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
          className="mx-4 flex w-full max-w-xl justify-center outline-hidden sm:mx-auto"
        >
          <div className="relative max-h-[90vh] w-full overflow-y-auto rounded-xl border border-secondary bg-primary p-5 shadow-xl">
            <CloseButton slot="close" size="xs" label="Close" className="absolute top-3 right-3 z-10" />
            <h2 className="pr-10 text-lg font-semibold text-primary">Syndication</h2>
            <p className="mt-1 text-xs text-tertiary">
              Configure YouTube publishing for this clip. Settings are stored on the clip and sent with the encode job.
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
                      Sign in with Google to allow Immergo to upload finished encodes to your YouTube channel.
                    </p>
                    <button
                      type="button"
                      disabled={readOnly || authBusy}
                      onClick={() => void handleStartOAuth()}
                      className={cx(
                        "rounded-lg bg-brand-solid px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-solid-hover",
                        (readOnly || authBusy) && "cursor-not-allowed opacity-50",
                      )}
                    >
                      {authBusy ? "Redirecting…" : "Authorize with Google"}
                    </button>
                    {mockAuthAvailable ? (
                      <button
                        type="button"
                        disabled={readOnly || authBusy}
                        onClick={() => void handleMockAuthorize()}
                        className="rounded-lg border border-secondary bg-primary px-3 py-2 text-xs font-medium text-secondary hover:bg-tertiary/40"
                      >
                        Dev: mock connected (no Google)
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <Toggle
                      isSelected={ytDraft.enabled}
                      onChange={(v) => setYtDraft((d) => ({ ...d, enabled: v }))}
                      isDisabled={readOnly}
                      label="Syndicate this clip to YouTube after encode"
                      hint="When the VOD job completes, the backend uploads the MP4 using the options below."
                      size="sm"
                    />

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                        Privacy
                        <select
                          disabled={readOnly || !ytDraft.enabled}
                          value={ytDraft.options.privacyStatus || "private"}
                          onChange={(e) =>
                            setOpt({ privacyStatus: e.target.value as EditorYoutubePrivacyStatus })
                          }
                          className="rounded-lg border border-secondary bg-primary px-2 py-2 text-sm text-primary"
                        >
                          <option value="private">Private</option>
                          <option value="unlisted">Unlisted</option>
                          <option value="public">Public</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                        Category ID
                        <input
                          type="text"
                          disabled={readOnly || !ytDraft.enabled}
                          value={ytDraft.options.categoryId || "22"}
                          onChange={(e) => setOpt({ categoryId: e.target.value })}
                          className="rounded-lg border border-secondary bg-primary px-2 py-2 text-sm text-primary"
                          placeholder="22"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                        License
                        <select
                          disabled={readOnly || !ytDraft.enabled}
                          value={ytDraft.options.license || "youtube"}
                          onChange={(e) => setOpt({ license: e.target.value as "youtube" | "creativeCommon" })}
                          className="rounded-lg border border-secondary bg-primary px-2 py-2 text-sm text-primary"
                        >
                          <option value="youtube">Standard YouTube</option>
                          <option value="creativeCommon">Creative Commons</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                        Default language (BCP-47, optional)
                        <input
                          type="text"
                          disabled={readOnly || !ytDraft.enabled}
                          value={ytDraft.options.defaultLanguage || ""}
                          onChange={(e) => setOpt({ defaultLanguage: e.target.value })}
                          className="rounded-lg border border-secondary bg-primary px-2 py-2 text-sm text-primary"
                          placeholder="en"
                        />
                      </label>
                    </div>

                    <div className="flex flex-col gap-2">
                      <Toggle
                        isSelected={ytDraft.options.embeddable !== false}
                        onChange={(v) => setOpt({ embeddable: v })}
                        isDisabled={readOnly || !ytDraft.enabled}
                        label="Allow embedding"
                        size="sm"
                      />
                      <Toggle
                        isSelected={ytDraft.options.publicStatsViewable !== false}
                        onChange={(v) => setOpt({ publicStatsViewable: v })}
                        isDisabled={readOnly || !ytDraft.enabled}
                        label="Public statistics viewable"
                        size="sm"
                      />
                      <Toggle
                        isSelected={!!ytDraft.options.selfDeclaredMadeForKids}
                        onChange={(v) => setOpt({ selfDeclaredMadeForKids: v })}
                        isDisabled={readOnly || !ytDraft.enabled}
                        label="Made for kids (self-declared)"
                        size="sm"
                      />
                      <Toggle
                        isSelected={!!ytDraft.options.notifySubscribers}
                        onChange={(v) => setOpt({ notifySubscribers: v })}
                        isDisabled={readOnly || !ytDraft.enabled}
                        label="Notify subscribers when published"
                        size="sm"
                      />
                    </div>

                    <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                      Title override (optional)
                      <input
                        type="text"
                        disabled={readOnly || !ytDraft.enabled}
                        value={ytDraft.options.titleOverride || ""}
                        onChange={(e) => setOpt({ titleOverride: e.target.value })}
                        placeholder={title}
                        className="rounded-lg border border-secondary bg-primary px-2 py-2 text-sm text-primary"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                      Description override (optional)
                      <textarea
                        disabled={readOnly || !ytDraft.enabled}
                        value={ytDraft.options.descriptionOverride || ""}
                        onChange={(e) => setOpt({ descriptionOverride: e.target.value })}
                        placeholder={description || "Uses clip description when empty"}
                        rows={3}
                        className="rounded-lg border border-secondary bg-primary px-2 py-2 text-sm text-primary"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                      Extra tags (comma-separated, optional)
                      <input
                        type="text"
                        disabled={readOnly || !ytDraft.enabled}
                        value={(ytDraft.options.tagsExtra || []).join(", ")}
                        onChange={(e) =>
                          setOpt({
                            tagsExtra: e.target.value
                              .split(/[,;]+/)
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                        className="rounded-lg border border-secondary bg-primary px-2 py-2 text-sm text-primary"
                      />
                    </label>

                    <div className="rounded-lg border border-secondary bg-secondary/30 p-3">
                      <p className="text-xs font-medium text-secondary">Mapped clip metadata (defaults)</p>
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
                                <span className="text-xs italic">No posters</span>
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

                    {ytDraft.upload?.state ? (
                      <p className="rounded-md border border-secondary bg-secondary px-2 py-2 text-xs text-secondary">
                        Upload status: <strong className="text-primary">{ytDraft.upload.state}</strong>
                        {ytDraft.upload.message ? ` — ${ytDraft.upload.message}` : ""}
                        {ytDraft.upload.watchUrl ? (
                          <>
                            {" "}
                            <a
                              href={ytDraft.upload.watchUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-brand-secondary underline"
                            >
                              Open video
                            </a>
                          </>
                        ) : null}
                        {ytDraft.upload.error ? (
                          <span className="mt-1 block text-error-primary">{ytDraft.upload.error}</span>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                )}
              </Tabs.Panel>
              <Tabs.Panel id="instagram" className="pt-2">
                <p className="rounded-lg border border-dashed border-secondary bg-secondary/20 px-3 py-4 text-sm text-tertiary">
                  Instagram syndication is not available yet.
                </p>
              </Tabs.Panel>
            </Tabs>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-lg border border-secondary bg-primary px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-secondary"
              >
                Cancel
              </button>
              {readOnly || !youtubeConnected || !onSave ? null : (
                <button
                  type="button"
                  onClick={() => void handleSave()}
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
