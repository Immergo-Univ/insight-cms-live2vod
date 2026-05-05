import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getAdminClient, getAdminToken, setAdminToken } from "./admin-api";

export type AdminUser = {
  id: string;
  email: string;
  displayName?: string | null;
  language?: string;
  avatarUrl?: string | null;
  roles: Array<{ id: string; name: string; slug: string }>;
};

type AdminAuthContextValue = {
  user: AdminUser | null;
  permissions: Record<string, boolean>;
  loading: boolean;
  can: (entity: string, action: string) => boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(Boolean(getAdminToken()));

  const refresh = useCallback(async () => {
    const token = getAdminToken();
    if (!token) {
      setUser(null);
      setPermissions({});
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const api = getAdminClient();
      const [meRes, permRes] = await Promise.all([api.get<AdminUser>("/auth/me"), api.get<{ permissions: Record<string, boolean> }>("/auth/permissions")]);
      setUser(meRes.data);
      setPermissions(permRes.data.permissions || {});
    } catch {
      setAdminToken(null);
      setUser(null);
      setPermissions({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const api = getAdminClient();
    const { data } = await api.post<{ token: string; user: AdminUser }>("/auth/login", { email, password });
    setAdminToken(data.token);
    setUser(data.user);
    await refresh();
  }, [refresh]);

  const logout = useCallback(() => {
    setAdminToken(null);
    setUser(null);
    setPermissions({});
  }, []);

  const can = useCallback(
    (entity: string, action: string) => {
      return Boolean(permissions[`${entity}.${action}`]);
    },
    [permissions],
  );

  const value = useMemo(
    () => ({ user, permissions, loading, can, refresh, login, logout }),
    [user, permissions, loading, can, refresh, login, logout],
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used within AdminAuthProvider");
  return ctx;
}
