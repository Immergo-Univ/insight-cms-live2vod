import { Navigate, Route, Routes } from "react-router";
import { App as AntdApp, ConfigProvider } from "antd";
import { I18nextProvider } from "react-i18next";
import adminI18n from "@/admin/admin-i18n";
import { AdminAuthProvider } from "@/admin/admin-auth-context";
import { AdminLoginPage } from "@/admin/pages/admin-login-page";
import { AdminRequireUser } from "@/admin/components/admin-require-user";
import { AdminShell } from "@/admin/components/admin-shell";
import { AdminClipsPage } from "@/admin/pages/admin-clips-page";
import { AdminUsersPage } from "@/admin/pages/admin-users-page";
import { AdminRolesPage } from "@/admin/pages/admin-roles-page";
import { AdminPermissionsPage } from "@/admin/pages/admin-permissions-page";
import { AdminProfilePage } from "@/admin/pages/admin-profile-page";
import { AdminTenantsPage } from "@/admin/pages/admin-tenants-page";
import { AdminTenantSettingsPage } from "@/admin/pages/admin-tenant-settings-page";
import { AdminSettingsPage } from "@/admin/pages/admin-settings-page";
import "@/admin/admin-theme.css";

export function AdminApp() {
  return (
    <div className="admin-root">
      <I18nextProvider i18n={adminI18n}>
        <ConfigProvider
          theme={{
            token: {
              borderRadius: 10,
              colorPrimary: "#3d9f6f",
              colorInfo: "#3d9f6f",
              colorBgLayout: "#eef2f7",
              colorBgContainer: "#ffffff",
              colorTextBase: "#1f2937",
              colorBorderSecondary: "#e2e8f0",
              fontSize: 14,
            },
          }}
        >
          <AntdApp>
            <AdminAuthProvider>
              <Routes>
                <Route path="login" element={<AdminLoginPage />} />
                <Route element={<AdminRequireUser />}>
                  <Route element={<AdminShell />}>
                    <Route index element={<Navigate to="clips" replace />} />
                    <Route path="clips" element={<AdminClipsPage />} />
                    <Route path="tenants" element={<AdminTenantsPage />} />
                    <Route path="tenants/:tenantId" element={<AdminTenantSettingsPage />} />
                    <Route path="users" element={<AdminUsersPage />} />
                    <Route path="roles" element={<AdminRolesPage />} />
                    <Route path="permissions" element={<AdminPermissionsPage />} />
                    <Route path="settings" element={<AdminSettingsPage />} />
                    <Route path="profile" element={<AdminProfilePage />} />
                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="login" replace />} />
              </Routes>
            </AdminAuthProvider>
          </AntdApp>
        </ConfigProvider>
      </I18nextProvider>
    </div>
  );
}
