export type VodJobStatus =
  | "queued"
  | "processing"
  | "uploading"
  | "cancelling"
  | "completed"
  | "cancelled"
  | "failed";

export interface VodJobRecord {
  id: string;
  tenantId: string;
  status: VodJobStatus;
  progress: number;
  phase: string;
  message?: string;
  error?: string;
  createdAt: string;
  updatedAt?: string;
  clipUrl?: string;
  s3Key?: string;
  s3Keys?: string[];
  outputUrl?: string | null;
  /** One public URL per encoded clip (same order as spec.clips by order). */
  outputUrls?: (string | null)[];
}
