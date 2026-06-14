import type { SyndicationAccountSummary } from "@/services/tenant-syndication.service";
import { Tag, TagGroup, TagList } from "@/components/base/tags/tags";
import { cx } from "@/utils/cx";

type SyndicationAccountsPanelProps = {
  accounts: SyndicationAccountSummary[];
  readOnly?: boolean;
  authBusy?: boolean;
  onAddAccount: () => void;
  addAccountLabel?: string;
  canAddAccount?: boolean;
  maxAccounts?: number;
  accountCount?: number;
};

export function SyndicationAccountsPanel({
  accounts,
  readOnly = false,
  authBusy = false,
  onAddAccount,
  addAccountLabel = "Add additional Account",
  canAddAccount = true,
  maxAccounts = 5,
  accountCount,
}: SyndicationAccountsPanelProps) {
  if (accounts.length === 0) return null;

  const occupiedCount = accountCount ?? accounts.length;
  const limitReached = !canAddAccount || occupiedCount >= maxAccounts;

  return (
    <div className="flex flex-col gap-3 border-t border-secondary pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-secondary">Connected accounts</p>
        <p className="text-xs text-tertiary">
          {occupiedCount}/{maxAccounts} accounts
        </p>
      </div>
      <TagGroup label="Connected accounts" size="sm">
        <TagList className="flex flex-wrap gap-2">
          {accounts.map((account) => (
            <Tag
              key={account.id}
              id={account.id}
              dot
              dotClassName={
                account.status === "active" ? "text-fg-success-secondary" : "text-fg-warning-secondary"
              }
            >
              {account.displayName}
            </Tag>
          ))}
        </TagList>
      </TagGroup>
      {limitReached ? (
        <p className="text-xs text-tertiary">
          Account limit reached ({maxAccounts}). Contact your administrator to increase the limit.
        </p>
      ) : (
        <button
          type="button"
          disabled={readOnly || authBusy}
          onClick={onAddAccount}
          className={cx(
            "self-start rounded-lg border border-secondary bg-primary px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-tertiary/40",
            (readOnly || authBusy) && "cursor-not-allowed opacity-50",
          )}
        >
          {authBusy ? "Redirecting…" : addAccountLabel}
        </button>
      )}
    </div>
  );
}

export function SyndicationOAuthBlock({
  description,
  authorizeLabel,
  readOnly,
  authBusy,
  onAuthorize,
  mockAuthAvailable,
  onMockAuthorize,
  mockLabel,
}: {
  description: string;
  authorizeLabel: string;
  readOnly?: boolean;
  authBusy?: boolean;
  onAuthorize: () => void;
  mockAuthAvailable?: boolean;
  onMockAuthorize?: () => void;
  mockLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-secondary bg-secondary/40 p-4">
      <p className="text-sm text-primary">{description}</p>
      <button
        type="button"
        disabled={readOnly || authBusy}
        onClick={onAuthorize}
        className={cx(
          "rounded-lg bg-brand-solid px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-solid-hover",
          (readOnly || authBusy) && "cursor-not-allowed opacity-50",
        )}
      >
        {authBusy ? "Redirecting…" : authorizeLabel}
      </button>
      {mockAuthAvailable && onMockAuthorize ? (
        <button
          type="button"
          disabled={readOnly || authBusy}
          onClick={onMockAuthorize}
          className="rounded-lg border border-secondary bg-primary px-3 py-2 text-xs font-medium text-secondary hover:bg-tertiary/40"
        >
          {mockLabel}
        </button>
      ) : null}
    </div>
  );
}
