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
  outputUrl?: string | null;
}
