import { Navigate, Outlet } from "react-router";
import { Spin } from "antd";
import { useAdminAuth } from "@/admin/admin-auth-context";

export function AdminRequireUser() {
  const { user, loading } = useAdminAuth();
  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "50vh" }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!user) return <Navigate to="/admin/login" replace />;
  return <Outlet />;
}
