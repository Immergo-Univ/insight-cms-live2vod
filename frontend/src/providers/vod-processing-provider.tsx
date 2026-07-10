import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { useLocation } from "react-router";
import { fetchVodJobs } from "@/services/vod.service";
import type { VodJobRecord } from "@/types/vod-job";

function isActiveStatus(status: VodJobRecord["status"]): boolean {
  return (
    status === "queued" ||
    status === "processing" ||
    status === "uploading" ||
    status === "cancelling"
  );
}

function mergeJobMap(prev: Map<string, VodJobRecord>, job: VodJobRecord): Map<string, VodJobRecord> {
  const next = new Map(prev);
  next.set(job.id, job);
  return next;
}

interface VodProcessingContextValue {
  tenantId: string;
  jobs: VodJobRecord[];
  activeCount: number;
  connectionState: "idle" | "connecting" | "open" | "error";
  refreshJobs: () => Promise<void>;
}

const VodProcessingContext = createContext<VodProcessingContextValue | null>(null);

export function VodProcessingProvider({ children }: PropsWithChildren) {
  const location = useLocation();
  const tenantId = useMemo(() => {
    const q = new URLSearchParams(location.search);
    return (q.get("tenantId") || "").trim();
  }, [location.search]);

  const [jobMap, setJobMap] = useState<Map<string, VodJobRecord>>(() => new Map());
  const [connectionState, setConnectionState] = useState<VodProcessingContextValue["connectionState"]>("idle");
  const wsRef = useRef<WebSocket | null>(null);

  const refreshJobs = useCallback(async () => {
    if (!tenantId) {
      setJobMap(new Map());
      return;
    }
    try {
      const list = await fetchVodJobs();
      setJobMap(new Map(list.map((j) => [j.id, j])));
    } catch {
      /* keep existing map */
    }
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) {
      setJobMap(new Map());
      setConnectionState("idle");
      wsRef.current?.close();
      wsRef.current = null;
      return;
    }

    refreshJobs();

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/api/ws/vod?tenantId=${encodeURIComponent(tenantId)}`;
    setConnectionState("connecting");
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnectionState("open");
    ws.onerror = () => setConnectionState("error");
    ws.onclose = () => {
      setConnectionState((s) => (s === "open" ? "idle" : s));
      if (wsRef.current === ws) wsRef.current = null;
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as {
          type?: string;
          jobs?: VodJobRecord[];
          job?: VodJobRecord;
        };
        if (msg.type === "snapshot" && Array.isArray(msg.jobs)) {
          setJobMap(new Map(msg.jobs.map((j) => [j.id, j])));
          return;
        }
        if (msg.type === "job_update" && msg.job) {
          setJobMap((prev) => mergeJobMap(prev, msg.job as VodJobRecord));
        }
      } catch {
        /* ignore */
      }
    };

    return () => {
      ws.close();
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [tenantId, refreshJobs]);

  const jobs = useMemo(() => {
    const list = [...jobMap.values()];
    list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return list;
  }, [jobMap]);

  const activeCount = useMemo(
    () => jobs.filter((j) => isActiveStatus(j.status)).length,
    [jobs],
  );

  useEffect(() => {
    if (!tenantId || activeCount === 0) return;
    const id = window.setInterval(() => {
      void refreshJobs();
    }, 2000);
    return () => window.clearInterval(id);
  }, [tenantId, activeCount, refreshJobs]);

  const value = useMemo<VodProcessingContextValue>(
    () => ({
      tenantId,
      jobs,
      activeCount,
      connectionState,
      refreshJobs,
    }),
    [tenantId, jobs, activeCount, connectionState, refreshJobs],
  );

  return <VodProcessingContext.Provider value={value}>{children}</VodProcessingContext.Provider>;
}

export function useVodProcessing(): VodProcessingContextValue {
  const ctx = useContext(VodProcessingContext);
  if (!ctx) {
    throw new Error("useVodProcessing must be used within VodProcessingProvider");
  }
  return ctx;
}

/** Safe variant when provider may be absent (e.g. tests). */
export function useVodProcessingOptional(): VodProcessingContextValue | null {
  return useContext(VodProcessingContext);
}
