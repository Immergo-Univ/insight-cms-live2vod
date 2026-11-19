import { ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";

export type SelectTargetOption = {
  id: string;
  name: string;
  /** Secondary line, e.g. linked Instagram account. */
  detail?: string;
};

type SelectTargetModalProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  banner?: string;
  options: SelectTargetOption[];
  loading?: boolean;
  busy?: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
  onConfirm: () => void;
  confirmLabel?: string;
  emptyLabel?: string;
};

const primaryBtn = {
  height: 42,
  padding: "0 20px",
  border: 0,
  borderRadius: 8,
  background: "#1f5ce0",
  color: "#ffffff",
  font: "inherit",
  fontWeight: 600,
  cursor: "pointer",
} as const;

const secondaryBtn = {
  height: 42,
  padding: "0 18px",
  border: "1px solid #c9d3e6",
  borderRadius: 8,
  background: "#ffffff",
  color: "#1f5ce0",
  font: "inherit",
  fontWeight: 600,
  cursor: "pointer",
} as const;

function initials(name: string): string {
  const letters = name.replace(/[^A-Za-z0-9 ]/g, "").trim().split(/\s+/);
  if (letters.length === 0) return "?";
  if (letters.length === 1) return letters[0].slice(0, 2).toUpperCase();
  return (letters[0][0] + letters[1][0]).toUpperCase();
}

/** Picker used to finish Facebook Page / Instagram account setup (mockup "choose pages"). */
export function SyndicationSelectTargetModal({
  isOpen,
  onOpenChange,
  title,
  description,
  banner,
  options,
  loading = false,
  busy = false,
  selectedId,
  onSelect,
  onConfirm,
  confirmLabel = "Save",
  emptyLabel = "Nothing available to add.",
}: SelectTargetModalProps) {
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable isKeyboardDismissDisabled={false}>
      <Modal>
        <Dialog aria-label={title} className="mx-4 flex w-full max-w-[560px] justify-center outline-hidden sm:mx-auto">
          <div
            style={{
              width: "100%",
              maxWidth: 560,
              maxHeight: "90vh",
              overflowY: "auto",
              background: "#ffffff",
              borderRadius: 14,
              boxShadow: "0 24px 60px rgba(0,0,0,.25)",
              color: "#1f1e1d",
              fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
            }}
          >
            <div
              style={{
                padding: "16px 22px",
                background: "#0a3fb8",
                color: "#ffffff",
                fontWeight: 700,
                letterSpacing: ".03em",
              }}
            >
              {title}
            </div>

            <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
              {banner ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    background: "#e9f7ef",
                    borderRadius: 10,
                    padding: "12px 14px",
                    color: "#155e3b",
                    fontSize: 13,
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1a8a5a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m5 12 5 5 9-10" />
                  </svg>
                  {banner}
                </div>
              ) : null}

              <p style={{ margin: 0, color: "#555b63" }}>{description}</p>

              <div style={{ border: "1px solid #e6e9ee", borderRadius: 10, overflow: "hidden" }}>
                {loading ? (
                  <div style={{ padding: "14px", color: "#6b7079", fontSize: 13 }}>Loading…</div>
                ) : options.length === 0 ? (
                  <div style={{ padding: "14px", color: "#6b7079", fontSize: 13 }}>{emptyLabel}</div>
                ) : (
                  options.map((opt, i) => {
                    const on = opt.id === selectedId;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => onSelect(opt.id)}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "12px 14px",
                          borderTop: i === 0 ? 0 : "1px solid #eef0f3",
                          borderLeft: 0,
                          borderRight: 0,
                          borderBottom: 0,
                          background: on ? "#f2f6fe" : "#ffffff",
                          textAlign: "left",
                          font: "inherit",
                          color: "inherit",
                          cursor: "pointer",
                        }}
                      >
                        <span
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: "50%",
                            background: "#0b2a6b",
                            color: "#ffffff",
                            fontSize: 11,
                            fontWeight: 700,
                            fontStyle: "italic",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flex: "none",
                          }}
                        >
                          {initials(opt.name)}
                        </span>
                        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                          <b style={{ fontSize: 14, fontWeight: 600 }}>{opt.name}</b>
                          {opt.detail ? <span style={{ fontSize: 12, color: "#6b7079" }}>{opt.detail}</span> : null}
                        </span>
                        <span
                          aria-hidden
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: "50%",
                            border: on ? "5px solid #1f5ce0" : "2px solid #c9d3e6",
                            boxSizing: "border-box",
                            flex: "none",
                          }}
                        />
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div
              style={{
                padding: "14px 22px",
                borderTop: "1px solid #eef0f3",
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
              }}
            >
              <button type="button" onClick={() => onOpenChange(false)} style={secondaryBtn}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !selectedId.trim()}
                onClick={onConfirm}
                style={{ ...primaryBtn, opacity: busy || !selectedId.trim() ? 0.5 : 1 }}
              >
                {busy ? "Saving…" : confirmLabel}
              </button>
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
