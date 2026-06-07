import { useCallback, useEffect, useState } from "react";
import { getMainCategories } from "@/services/main-categories.service";
import type { MainCategory } from "@/types/main-category";

export function useMainCategories(enabled = true) {
  const [mainCategories, setMainCategories] = useState<MainCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMainCategories();
      setMainCategories(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load main categories";
      setError(message);
      setMainCategories([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void fetch();
  }, [enabled, fetch]);

  return { mainCategories, loading, error, refetch: fetch };
}
