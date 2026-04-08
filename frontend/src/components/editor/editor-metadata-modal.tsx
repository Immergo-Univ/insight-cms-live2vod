import { useEffect, useState } from "react";
import { ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { CloseButton } from "@/components/base/buttons/close-button";
import type { EditorVodMetadata } from "@/types/editor";

const TITLE_MAX = 255;
const DESCRIPTION_MAX = 255;
const TAGS_MAX = 200;

interface EditorMetadataModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  metadata: EditorVodMetadata;
  onSave: (next: EditorVodMetadata) => void;
}

export function EditorMetadataModal({
  isOpen,
  onOpenChange,
  metadata,
  onSave,
}: EditorMetadataModalProps) {
  const [draft, setDraft] = useState<EditorVodMetadata>(metadata);

  useEffect(() => {
    if (isOpen) setDraft(metadata);
  }, [isOpen, metadata]);

  const apply = () => {
    onSave({
      title: draft.title.slice(0, TITLE_MAX),
      description: draft.description.slice(0, DESCRIPTION_MAX),
      tags: draft.tags.slice(0, TAGS_MAX),
    });
    onOpenChange(false);
  };

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
          aria-label="VOD metadata"
          className="mx-4 flex w-full max-w-md justify-center outline-hidden sm:mx-auto"
        >
          <div className="relative w-full rounded-xl border border-secondary bg-primary p-5 shadow-xl">
            <CloseButton slot="close" size="xs" label="Close" className="absolute top-3 right-3 z-10" />
            <h2 className="pr-10 text-lg font-semibold text-primary">VOD details</h2>
            <p className="mt-1 text-xs text-tertiary">Title, description, and tags for this output.</p>

            <div className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-secondary">
                  Title <span className="text-error-primary">*</span>
                </span>
                <input
                  type="text"
                  value={draft.title}
                  onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                  maxLength={TITLE_MAX}
                  placeholder="Clip title"
                  className="rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary placeholder:text-placeholder"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-secondary">
                  Description <span className="text-error-primary">*</span>
                </span>
                <textarea
                  value={draft.description}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  maxLength={DESCRIPTION_MAX}
                  placeholder="Clip description"
                  rows={3}
                  className="rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary placeholder:text-placeholder"
                />
                <span className="text-[10px] text-tertiary">Max {DESCRIPTION_MAX} characters</span>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-secondary">Tags</span>
                <input
                  type="text"
                  value={draft.tags}
                  onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))}
                  maxLength={TAGS_MAX}
                  placeholder="Comma-separated tags"
                  className="rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary placeholder:text-placeholder"
                />
                <span className="text-[10px] text-tertiary">Max {TAGS_MAX} characters</span>
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-lg border border-secondary bg-primary px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                className="rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-solid-hover"
              >
                Save
              </button>
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
