/** AI services shown on the VOD AI Content page. */
export type AiServiceKey = "stt" | "subtitles" | "article" | "dubbing";

/** Services that can be run on an existing VOD today. */
export type AiRunServiceKey = "stt" | "article";

export type AiCreditsPerMinute = Record<AiServiceKey, number>;

export interface TenantCreditState {
  usdPerCredit: number;
  monthlyFreeCredits: number;
  freeUsedThisMonth: number;
  freeRemaining: number;
  purchasedCredits: number;
  totalRemaining: number;
  periodMonth: string;
  /** When false the tenant has no credit pools configured (unlimited). */
  limiterActive: boolean;
}

export interface CreditPack {
  id: string;
  name: string;
  priceUsd: number;
  credits: number;
  badge: "mostPopular" | "bestValue" | null;
  savePercent: number;
}

export interface CreditCatalog {
  packs: CreditPack[];
  custom: { minCredits: number; maxCredits: number; usdPerCredit: number };
  enterpriseFromCredits: number;
  salesEmail: string;
  creditsPerMinute: AiCreditsPerMinute;
}

export type CreditOrderKind = "pack" | "custom" | "enterprise";
export type CreditOrderStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface CreditOrderInvoiceDetails {
  companyName?: string;
  taxId?: string;
  billingEmail?: string;
}

export interface CreditOrderContactDetails {
  monthlyVolume?: string;
  billingPreference?: string;
  needs?: string[];
  message?: string;
  reachBy?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface CreditOrder {
  id: string;
  orderNumber: number;
  tenantId: string;
  kind: CreditOrderKind;
  packId: string | null;
  packName: string | null;
  credits: number;
  priceUsd: number;
  status: CreditOrderStatus;
  vodGuid: string | null;
  invoiceDetails: CreditOrderInvoiceDetails | null;
  contactDetails: CreditOrderContactDetails | null;
  balanceAtRequest: number | null;
  adminNotes: string | null;
  rejectReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiCreditsResponse {
  tenantId: string;
  credits: TenantCreditState | null;
  catalog: CreditCatalog;
  orders: CreditOrder[];
}

export interface CreateCreditOrderBody {
  kind: CreditOrderKind;
  packId?: string;
  credits?: number;
  invoiceDetails?: CreditOrderInvoiceDetails;
  contactDetails?: CreditOrderContactDetails;
  vodGuid?: string;
}

export type AiRunStatus = "queued" | "processing" | "uploading" | "completed" | "failed" | "cancelled" | string;

export interface AiRun {
  id: string;
  service: AiRunServiceKey;
  languages: string[];
  estimatedCredits: number;
  status: AiRunStatus;
  progress: number;
  phase: string | null;
  message: string | null;
  error: string | null;
  synced: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AiRunOptions {
  durationSec: number;
  creditsPerMinute: AiCreditsPerMinute;
  languages: Record<AiRunServiceKey, string[]>;
}

export interface VodAiRunsResponse {
  runs: AiRun[];
  options: AiRunOptions;
}
