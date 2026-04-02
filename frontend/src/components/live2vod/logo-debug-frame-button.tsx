import { useCallback, useEffect, useState } from "react";
import { Image01 } from "@untitledui/icons";
import { DialogTrigger, ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { Button } from "@/components/base/buttons/button";
import { CloseButton } from "@/components/base/buttons/close-button";
import { fetchChannelSettings } from "@/services/channel-settings.service";

interface LogoDebugFrameButtonProps {
  channelId: string;
}

function LiveDebugImage({ channelId, active }: { channelId: string; active: boolean }) {
  const [burst, setBurst] = useState(() => Date.now());
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!active) return;
    setLoadError(false);
    setBurst(Date.now());
    const id = window.setInterval(() => setBurst(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  const src = `/api/channels/${encodeURIComponent(channelId)}/logo-detector-debug?_=${burst}`;

  if (!active) return null;

  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-3">
      {loadError ? (
        <p className="text-center text-sm text-tertiary">
          No debug frame yet. It appears after the logo-detector runs on this channel (live matching or archive
          scan).
        </p>
      ) : (
        <img
          src={src}
          alt="Last logo-detector frame"
          className="max-h-[min(70vh,720px)] w-auto max-w-full rounded-lg border border-secondary object-contain shadow-sm"
          onLoad={() => setLoadError(false)}
          onError={() => setLoadError(true)}
        />
      )}
    </div>
  );
}

export function LogoDebugFrameButton({ channelId }: LogoDebugFrameButtonProps) {
  const [hasLogos, setHasLogos] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchChannelSettings(channelId);
      setHasLogos(data.logos.length > 0);
    } catch {
      setHasLogos(false);
    }
  }, [channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (hasLogos) return;
    const id = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(id);
  }, [hasLogos, load]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  if (!hasLogos) return null;

  return (
    <DialogTrigger isOpen={modalOpen} onOpenChange={setModalOpen}>
      <Button
        type="button"
        size="sm"
        color="secondary"
        iconLeading={Image01}
        className="shadow-md"
        aria-label="Logo detector debug frame"
        title="Logo detector debug frame"
      />
      <ModalOverlay isDismissable isKeyboardDismissDisabled={false} className="z-[60]">
        <Modal className="z-[61]">
          <Dialog
            aria-labelledby="logo-debug-frame-title"
            className="mx-4 flex w-full max-w-4xl justify-center outline-hidden sm:mx-auto"
          >
            <div className="relative w-full rounded-xl border border-secondary bg-primary p-5 shadow-xl">
              <CloseButton slot="close" size="xs" label="Close" className="absolute top-3 right-3 z-10" />
              <div className="pr-10">
                <h2 id="logo-debug-frame-title" className="text-lg font-semibold text-primary">
                  Logo detector frame
                </h2>
                <p className="mt-1 text-sm text-tertiary">
                  Last captured frame used for template matching (refreshes every second).
                </p>
              </div>
              <div className="mt-4 flex justify-center overflow-auto">
                <LiveDebugImage channelId={channelId} active={modalOpen} />
              </div>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}
