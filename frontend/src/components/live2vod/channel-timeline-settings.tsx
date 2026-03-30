import { useCallback, useEffect, useRef, useState } from "react";
import { Settings01, Trash02 } from "@untitledui/icons";
import { DialogTrigger, ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { Button } from "@/components/base/buttons/button";
import { httpClient } from "@/services/http-client";
import {
  deleteChannelLogo,
  fetchChannelSettings,
  uploadChannelLogos,
  type ChannelLogoRow,
} from "@/services/channel-settings.service";

interface ChannelTimelineSettingsProps {
  channelId: string;
}

function ChannelSettingsModalBody({ channelId }: { channelId: string }) {
  const [logos, setLogos] = useState<ChannelLogoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchChannelSettings(channelId);
      setLogos(data.logos);
    } catch (e) {
      setError(httpClient.getErrorMessage(e));
      setLogos([]);
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onPickFiles = () => inputRef.current?.click();

  const onFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list?.length) return;
    const files = Array.from(list).filter((f) => /image\/(png|jpeg)/i.test(f.type) || /\.(png|jpe?g)$/i.test(f.name));
    e.target.value = "";
    if (!files.length) {
      setError("Only PNG or JPEG files are allowed.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const data = await uploadChannelLogos(channelId, files);
      setLogos(data.logos);
    } catch (err) {
      setError(httpClient.getErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (logoId: string) => {
    setError(null);
    try {
      await deleteChannelLogo(channelId, logoId);
      setLogos((prev) => prev.filter((x) => x.id !== logoId));
    } catch (err) {
      setError(httpClient.getErrorMessage(err));
    }
  };

  return (
    <div className="flex max-h-[min(80vh,640px)] w-full max-w-2xl flex-col gap-4 outline-hidden">
      <div className="shrink-0 border-b border-secondary pb-3">
        <h2 id="channel-settings-title" className="text-lg font-semibold text-primary">
          Channel settings
        </h2>
        <p className="mt-1 text-sm text-tertiary">
          Upload one or more channel logo images (PNG or JPEG). The backend uses them for live AD detection
          (template matching on the stream).
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,.jpg,.jpeg,.png"
          multiple
          className="hidden"
          onChange={onFilesSelected}
        />
        <Button
          type="button"
          size="sm"
          color="secondary"
          isLoading={uploading}
          onClick={onPickFiles}
        >
          Upload logos
        </Button>
        <Button type="button" size="sm" color="tertiary" isDisabled={loading} onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {error && (
        <p className="rounded-lg border border-error_subtle bg-error-secondary px-3 py-2 text-sm text-error-primary">
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-secondary">
        {loading ? (
          <p className="p-4 text-sm text-tertiary">Loading…</p>
        ) : logos.length === 0 ? (
          <p className="p-4 text-sm text-tertiary">No logos yet. Upload PNG or JPEG files.</p>
        ) : (
          <table className="w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-secondary bg-secondary">
              <tr>
                <th className="px-3 py-2 font-medium text-secondary">Preview</th>
                <th className="px-3 py-2 font-medium text-secondary">File</th>
                <th className="px-3 py-2 font-medium text-secondary">Uploaded</th>
                <th className="w-24 px-3 py-2 font-medium text-secondary"> </th>
              </tr>
            </thead>
            <tbody>
              {logos.map((row) => (
                <tr key={row.id} className="border-b border-secondary last:border-b-0">
                  <td className="px-3 py-2 align-middle">
                    <img
                      src={row.previewUrl}
                      alt=""
                      className="h-10 w-auto max-w-[120px] rounded border border-secondary object-contain"
                    />
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-2 align-middle text-primary" title={row.originalName}>
                    {row.originalName}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 align-middle text-tertiary">
                    {formatUploaded(row.uploadedAt)}
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <Button
                      type="button"
                      size="sm"
                      color="tertiary-destructive"
                      iconLeading={Trash02}
                      aria-label={`Remove ${row.originalName}`}
                      onClick={() => void onDelete(row.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function formatUploaded(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function ChannelTimelineSettings({ channelId }: ChannelTimelineSettingsProps) {
  return (
    <div className="pointer-events-none absolute right-0 bottom-0 z-20 p-3">
      <DialogTrigger>
        <Button
          type="button"
          size="sm"
          color="secondary"
          iconLeading={Settings01}
          className="pointer-events-auto shadow-md"
          aria-label="Channel settings"
        />
      <ModalOverlay isDismissable className="z-[60]">
        <Modal className="z-[61]">
          <Dialog
            aria-labelledby="channel-settings-title"
            className="mx-4 flex w-full max-w-2xl justify-center outline-hidden sm:mx-auto"
          >
            <div className="w-full rounded-xl border border-secondary bg-primary p-5 shadow-xl">
              <ChannelSettingsModalBody channelId={channelId} />
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
    </div>
  );
}
