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
import { AdminSettingsPage } from "@/admin/pages/admin-settings-page";

export function AdminApp() {
  return (
    <I18nextProvider i18n={adminI18n}>
      <ConfigProvider
        theme={{
          token: {
            borderRadius: 0,
            colorPrimary: "#0d9488",
            colorInfo: "#0d9488",
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
  );
}
