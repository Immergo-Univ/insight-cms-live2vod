import { useCallback, useEffect, useState } from "react";
import { getChannels } from "@/services/channels.service";
import type { Channel } from "@/types/channel";

export function useChannels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getChannels();
      setChannels(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load channels";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { channels, loading, error, refetch: fetch };
}
