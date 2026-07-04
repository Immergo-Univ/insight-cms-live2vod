import { useState } from "react";
import { Settings01 } from "@untitledui/icons";
import { DialogTrigger, ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { Button } from "@/components/base/buttons/button";
import { CloseButton } from "@/components/base/buttons/close-button";
import { httpClient } from "@/services/http-client";
import { deleteChannelAdsSnapshot } from "@/services/channel-settings.service";

interface ChannelTimelineSettingsProps {
  channelId: string;
}

function ChannelSettingsModalBody({ channelId }: { channelId: string }) {
  const [clearingAds, setClearingAds] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onClearAdsRecords = async () => {
    const ok = window.confirm(
      "Remove all ad detection records for this channel? This deletes the local timeline JSON and the S3 backup (if configured).",
    );
    if (!ok) return;
    setClearingAds(true);
    setError(null);
    setDone(false);
    try {
      await deleteChannelAdsSnapshot(channelId);
      setDone(true);
    } catch (err) {
      setError(httpClient.getErrorMessage(err));
    } finally {
      setClearingAds(false);
    }
  };

  return (
    <div className="flex w-full max-w-lg flex-col gap-4 outline-hidden">
      <div className="shrink-0 border-b border-secondary pb-3 pr-12 sm:pr-14">
        <h2 id="channel-settings-title" className="text-lg font-semibold text-primary">
          Channel settings
        </h2>
        <p className="mt-1 text-sm text-tertiary">
          Ad windows are detected automatically by the AD recognition service. Use the action below to
          reset the stored detection records for this channel.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-error_subtle bg-error-secondary px-3 py-2 text-sm text-error-primary">
          {error}
        </p>
      )}
      {done && (
        <p className="rounded-lg border border-success_subtle bg-success-secondary px-3 py-2 text-sm text-success-primary">
          Ad detection records cleared.
        </p>
      )}

      <div className="shrink-0 rounded-lg border border-secondary bg-secondary_alt p-4">
        <p className="text-sm font-medium text-primary">Ad detection data</p>
        <p className="mt-1 text-sm text-tertiary">
          Clear precalculated ad segments and live probe fields stored in JSON (disk and S3 backup).
        </p>
        <Button
          type="button"
          size="sm"
          color="primary-destructive"
          className="mt-3"
          isLoading={clearingAds}
          onClick={() => void onClearAdsRecords()}
        >
          Clear ad records
        </Button>
      </div>
    </div>
  );
}

/** Channel settings trigger (place inside a fixed toolbar next to other actions). */
export function ChannelTimelineSettings({ channelId }: ChannelTimelineSettingsProps) {
  return (
    <div className="inline-flex items-center gap-1">
      <DialogTrigger>
        <Button
          type="button"
          size="sm"
          color="secondary"
          iconLeading={Settings01}
          className="shadow-md"
          aria-label="Channel settings"
        />
        <ModalOverlay isDismissable isKeyboardDismissDisabled={false}>
          <Modal>
            <Dialog
              aria-labelledby="channel-settings-title"
              className="mx-4 flex w-full max-w-lg justify-center outline-hidden sm:mx-auto"
            >
              <div className="relative w-full rounded-xl border border-secondary bg-primary p-5 shadow-xl">
                <CloseButton slot="close" size="xs" label="Close" className="absolute top-3 right-3 z-10" />
                <ChannelSettingsModalBody channelId={channelId} />
              </div>
            </Dialog>
          </Modal>
        </ModalOverlay>
      </DialogTrigger>
    </div>
  );
}
