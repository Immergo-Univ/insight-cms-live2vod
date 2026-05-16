import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "@untitledui/icons";
import { useNavigate } from "react-router";
import { ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { CloseButton } from "@/components/base/buttons/close-button";
import { cancelVodJob, fetchVodOutputs } from "@/services/vod.service";
import { useVodProcessing } from "@/providers/vod-processing-provider";
import type { VodJobRecord } from "@/types/vod-job";
import type { VodS3ObjectRow } from "@/services/vod.service";

function shortId(id: string) {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function canCancel(job: VodJobRecord) {
  return (
    job.status === "queued" ||
    job.status === "processing" ||
    job.status === "uploading" ||
    job.status === "cancelling"
  );
}

export function ProcessingClipsPage() {
  const navigate = useNavigate();
  const { tenantId, jobs, connectionState, refreshJobs } = useVodProcessing();
  const [outputs, setOutputs] = useState<VodS3ObjectRow[]>([]);
  const [outputsLoading, setOutputsLoading] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [playerUrl, setPlayerUrl] = useState<string | null>(null);

  const loadOutputs = useCallback(async () => {
    if (!tenantId) return;
    setOutputsLoading(true);
    try {
      const list = await fetchVodOutputs();
      setOutputs(list);
    } catch {
      setOutputs([]);
    } finally {
      setOutputsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadOutputs();
  }, [loadOutputs, jobs.length]);

  const handleCancel = async (jobId: string) => {
    setCancelingId(jobId);
    try {
      await cancelVodJob(jobId);
      await refreshJobs();
    } catch (e) {
      console.error(e);
    } finally {
      setCancelingId(null);
    }
  };

  const goBack = () => {
    navigate(-1);
  };

  return (
    <div className="flex h-full flex-col bg-primary">
      {playerUrl ? (
        <ModalOverlay
          isOpen
          onOpenChange={(open) => {
            if (!open) setPlayerUrl(null);
          }}
          isDismissable
          isKeyboardDismissDisabled={false}
        >
          <Modal>
            <Dialog
              aria-label="Generated video"
              className="mx-4 flex w-full max-w-4xl justify-center outline-hidden sm:mx-auto"
            >
              <div className="relative w-full rounded-xl border border-secondary bg-primary p-4 shadow-xl">
                <CloseButton
                  slot="close"
                  size="xs"
                  label="Close"
                  className="absolute top-3 right-3 z-10"
                />
                <video
                  key={playerUrl}
                  className="mt-2 aspect-video w-full rounded-lg bg-black"
                  src={playerUrl}
                  controls
                  playsInline
                />
              </div>
            </Dialog>
          </Modal>
        </ModalOverlay>
      ) : null}

      <header className="flex shrink-0 items-center gap-3 border-b border-secondary px-4 py-3">
        <button
          type="button"
          onClick={goBack}
          className="flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-secondary"
          aria-label="Go back"
        >
          <ArrowLeft className="size-4 text-fg-quaternary" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-primary">Processing Clips</h1>
          <p className="text-xs text-tertiary">
            Real-time encode progress
            {connectionState === "open"
              ? " · Live"
              : connectionState === "connecting"
                ? " · Connecting…"
                : tenantId
                  ? ""
                  : " · Add ?tenantId= to the URL"}
          </p>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-4">
        {!tenantId ? (
          <p className="text-sm text-secondary">
            Select a tenant by adding <code className="rounded bg-secondary px-1 text-xs">tenantId</code> to the query
            string (same as the main Live2VOD screen).
          </p>
        ) : null}

        <section className="mb-8">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary">
            Jobs in memory
          </h2>
          <div className="overflow-x-auto rounded-lg border border-secondary">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-secondary bg-secondary">
                  <th className="px-3 py-2 font-medium text-secondary">Job</th>
                  <th className="px-3 py-2 font-medium text-secondary">Status</th>
                  <th className="px-3 py-2 font-medium text-secondary">Phase</th>
                  <th className="min-w-[200px] max-w-[320px] px-3 py-2 font-medium text-secondary">Error</th>
                  <th className="min-w-[180px] px-3 py-2 font-medium text-secondary">Progress</th>
                  <th className="px-3 py-2 font-medium text-secondary">Source</th>
                  <th className="px-3 py-2 font-medium text-secondary">Output</th>
                  <th className="px-3 py-2 font-medium text-secondary"> </th>
                </tr>
              </thead>
              <tbody>
                {jobs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-tertiary">
                      No jobs yet. Use Create and Finish in the editor to start encoding.
                    </td>
                  </tr>
                ) : (
                  jobs.map((job) => (
                    <tr key={job.id} className="border-b border-secondary last:border-0">
                      <td className="px-3 py-2 font-mono text-xs text-primary" title={job.id}>
                        {shortId(job.id)}
                      </td>
                      <td className="px-3 py-2 text-primary">{job.status}</td>
                      <td className="px-3 py-2 text-secondary">{job.phase}</td>
                      <td className="max-w-[320px] px-3 py-2 align-top text-xs break-words">
                        {job.error ? (
                          <span className="text-error-primary" title={job.error}>
                            {job.error}
                          </span>
                        ) : job.status === "failed" ? (
                          <span className="text-tertiary">No error text (check server logs)</span>
                        ) : (
                          <span className="text-tertiary">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                            <div
                              className="h-full rounded-full bg-brand-solid transition-[width] duration-300"
                              style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }}
                            />
                          </div>
                          <span className="w-10 text-right text-xs tabular-nums text-tertiary">
                            {job.progress}%
                          </span>
                        </div>
                      </td>
                      <td className="max-w-[200px] truncate px-3 py-2 text-xs text-tertiary" title={job.clipUrl}>
                        {job.clipUrl || "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {job.outputUrls && job.outputUrls.length > 0 ? (
                          <ul className="flex list-none flex-col gap-1.5 p-0">
                            {job.outputUrls.map((url, idx) =>
                              url ? (
                                <li key={`${job.id}-out-${idx}`} className="flex flex-wrap items-center gap-2">
                                  <span className="text-tertiary">Clip {idx + 1}</span>
                                  <button
                                    type="button"
                                    onClick={() => setPlayerUrl(url)}
                                    className="font-medium text-brand-secondary hover:underline"
                                  >
                                    Play
                                  </button>
                                  <a
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-tertiary hover:underline"
                                  >
                                    Open
                                  </a>
                                </li>
                              ) : null,
                            )}
                          </ul>
                        ) : job.outputUrl ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setPlayerUrl(job.outputUrl!)}
                              className="font-medium text-brand-secondary hover:underline"
                            >
                              Play
                            </button>
                            <a
                              href={job.outputUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-tertiary hover:underline"
                            >
                              Open
                            </a>
                          </div>
                        ) : job.error ? (
                          <span className="text-error-primary" title={job.error}>
                            Error
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          disabled={!canCancel(job) || cancelingId === job.id}
                          onClick={() => handleCancel(job.id)}
                          className="rounded-lg border border-secondary px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary">
            Generated MP4s (tenant on S3)
          </h2>
          {outputsLoading ? (
            <p className="text-sm text-tertiary">Loading…</p>
          ) : outputs.length === 0 ? (
            <p className="text-sm text-tertiary">
              No objects found (S3 may be disabled or the folder empty).
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-secondary">
              <table className="w-full min-w-[480px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-secondary bg-secondary">
                    <th className="px-3 py-2 font-medium text-secondary">Key</th>
                    <th className="px-3 py-2 font-medium text-secondary">Size</th>
                    <th className="px-3 py-2 font-medium text-secondary">Modified</th>
                    <th className="px-3 py-2 font-medium text-secondary"> </th>
                  </tr>
                </thead>
                <tbody>
                  {outputs.map((o) => (
                    <tr
                      key={o.key}
                      className={
                        o.publicUrl
                          ? "cursor-pointer border-b border-secondary last:border-0 hover:bg-secondary"
                          : "border-b border-secondary last:border-0"
                      }
                      onClick={() => {
                        if (o.publicUrl) setPlayerUrl(o.publicUrl);
                      }}
                    >
                      <td className="max-w-[320px] truncate px-3 py-2 font-mono text-xs text-primary" title={o.key}>
                        {o.key}
                      </td>
                      <td className="px-3 py-2 text-tertiary">
                        {o.size != null ? `${(o.size / (1024 * 1024)).toFixed(2)} MB` : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-tertiary">
                        {o.lastModified ? new Date(o.lastModified).toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {o.publicUrl ? (
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPlayerUrl(o.publicUrl!);
                              }}
                              className="font-medium text-brand-secondary hover:underline"
                            >
                              Play
                            </button>
                            <a
                              href={o.publicUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-tertiary hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Open
                            </a>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
