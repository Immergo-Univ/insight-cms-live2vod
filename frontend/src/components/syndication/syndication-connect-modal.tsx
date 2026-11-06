import { useEffect, useState } from "react";
import { ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { PlatformBadge } from "./syndication-platform-badge";
import { SYNDICATION_PLATFORM_META, type SyndicationPlatform } from "./syndication-settings-model";

type ConnectModalProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Platforms the admin enabled for this tenant. */
  platforms: SyndicationPlatform[];
  authBusy?: boolean;
  /** Start the real OAuth flow (redirects away). */
  onAuthorize: (platform: SyndicationPlatform) => void;
  /** Dev-only mock connect, available per platform. */
  mockAvailable?: Partial<Record<SyndicationPlatform, boolean>>;
  onMockAuthorize?: (platform: SyndicationPlatform) => void;
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

export function SyndicationConnectModal({
  isOpen,
  onOpenChange,
  platforms,
  authBusy = false,
  onAuthorize,
  mockAvailable = {},
  onMockAuthorize,
}: ConnectModalProps) {
  const [selected, setSelected] = useState<SyndicationPlatform | null>(platforms[0] ?? null);

  useEffect(() => {
    if (isOpen) setSelected(platforms[0] ?? null);
  }, [isOpen, platforms]);

  const current = selected ? SYNDICATION_PLATFORM_META[selected] : null;

  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable isKeyboardDismissDisabled={false}>
      <Modal>
        <Dialog
          aria-label="Connect an account"
          className="mx-4 flex w-full max-w-[780px] justify-center outline-hidden sm:mx-auto"
        >
          <div
            style={{
              width: "100%",
              maxWidth: 780,
              maxHeight: "90vh",
              overflowY: "auto",
              background: "#ffffff",
              borderRadius: 14,
              boxShadow: "0 24px 60px rgba(0,0,0,.25)",
              color: "#1f1e1d",
              fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
            }}
          >
            {/* Header bar */}
            <div
              style={{
                padding: "16px 22px",
                background: "#0a3fb8",
                color: "#ffffff",
                fontWeight: 700,
                letterSpacing: ".03em",
                display: "flex",
                alignItems: "center",
              }}
            >
              CONNECT AN ACCOUNT
              <span style={{ marginLeft: "auto", fontWeight: 500, letterSpacing: 0, fontSize: 13, opacity: 0.85 }}>
                Step 1 of 2
              </span>
            </div>

            {platforms.length === 0 ? (
              <div style={{ padding: 22, color: "#555b63" }}>
                No social networks are enabled for this tenant. Enable at least one in tenant settings.
              </div>
            ) : (
              <>
                <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
                  <p style={{ margin: 0, color: "#555b63" }}>
                    Choose where you want to post. You'll sign in on that platform and allow the CMS to post for you. We
                    never see your password.
                  </p>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
                    {platforms.map((platform) => {
                      const meta = SYNDICATION_PLATFORM_META[platform];
                      const on = platform === selected;
                      return (
                        <button
                          key={platform}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setSelected(platform)}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-start",
                            gap: 8,
                            padding: 14,
                            borderRadius: 10,
                            border: `2px solid ${on ? "#1f5ce0" : "#e6e9ee"}`,
                            background: on ? "#f2f6fe" : "#ffffff",
                            textAlign: "left",
                            font: "inherit",
                            color: "inherit",
                            cursor: "pointer",
                          }}
                        >
                          <span style={{ display: "flex", gap: 4 }}>
                            <PlatformBadge platform={platform} size={28} fontSize={11} radius={7} />
                          </span>
                          <b style={{ fontSize: 14, fontWeight: 600 }}>{meta.label}</b>
                          <span style={{ fontSize: 12, color: "#6b7079", lineHeight: 1.4 }}>
                            {meta.connectDescription}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {current ? (
                    <div
                      style={{
                        background: "#f6f7f9",
                        borderRadius: 10,
                        padding: "14px 16px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <b style={{ fontSize: 13, fontWeight: 600 }}>{current.label} will ask you to allow the CMS to:</b>
                      {current.permissions.map((perm) => (
                        <span
                          key={perm}
                          style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#555b63" }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1a8a5a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="m5 12 5 5 9-10" />
                          </svg>
                          {perm}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                {/* Footer */}
                <div
                  style={{
                    padding: "14px 22px",
                    borderTop: "1px solid #eef0f3",
                    display: "flex",
                    justifyContent: "flex-end",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  {selected && mockAvailable[selected] && onMockAuthorize ? (
                    <button
                      type="button"
                      disabled={authBusy}
                      onClick={() => onMockAuthorize(selected)}
                      style={{ ...secondaryBtn, marginRight: "auto", fontSize: 13, opacity: authBusy ? 0.5 : 1 }}
                    >
                      Dev: mock connect
                    </button>
                  ) : null}
                  <button type="button" onClick={() => onOpenChange(false)} style={secondaryBtn}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={authBusy || !selected}
                    onClick={() => selected && onAuthorize(selected)}
                    style={{ ...primaryBtn, opacity: authBusy || !selected ? 0.5 : 1 }}
                  >
                    {authBusy ? "Redirecting…" : `Continue to ${current?.label.replace(" (Twitter)", "") ?? ""}`}
                  </button>
                </div>
              </>
            )}
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
