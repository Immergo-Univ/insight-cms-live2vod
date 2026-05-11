import { useMemo, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { Avatar, Dropdown, Layout, Menu, Select, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useAdminAuth } from "@/admin/admin-auth-context";
import { setStoredAdminLang } from "@/admin/admin-i18n";

const { Header, Sider, Content } = Layout;

export function AdminShell() {
  const { t, i18n } = useTranslation("admin");
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, can } = useAdminAuth();

  const menuItems = useMemo(() => {
    const items: { key: string; label: ReactNode }[] = [];
    if (can("clips", "view_item")) items.push({ key: "/admin/clips", label: <Link to="/admin/clips">{t("nav.clips")}</Link> });
    if (can("tenants", "view")) items.push({ key: "/admin/tenants", label: <Link to="/admin/tenants">{t("nav.tenants")}</Link> });
    if (can("users", "view_item")) items.push({ key: "/admin/users", label: <Link to="/admin/users">{t("nav.users")}</Link> });
    if (can("roles", "view_item")) items.push({ key: "/admin/roles", label: <Link to="/admin/roles">{t("nav.roles")}</Link> });
    if (can("permissions", "view_item"))
      items.push({ key: "/admin/permissions", label: <Link to="/admin/permissions">{t("nav.permissions")}</Link> });
    if (can("settings", "view")) items.push({ key: "/admin/settings", label: <Link to="/admin/settings">{t("nav.settings")}</Link> });
    items.push({ key: "/admin/profile", label: <Link to="/admin/profile">{t("nav.profile")}</Link> });
    return items;
  }, [can, t]);

  const selected = useMemo(() => {
    const p = location.pathname;
    if (p.startsWith("/admin/clips")) return ["/admin/clips"];
    if (p.startsWith("/admin/tenants")) return ["/admin/tenants"];
    if (p.startsWith("/admin/users")) return ["/admin/users"];
    if (p.startsWith("/admin/roles")) return ["/admin/roles"];
    if (p.startsWith("/admin/permissions")) return ["/admin/permissions"];
    if (p.startsWith("/admin/settings")) return ["/admin/settings"];
    if (p.startsWith("/admin/profile")) return ["/admin/profile"];
    return [p];
  }, [location.pathname]);

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider width={220} style={{ background: "#0a0a0a" }}>
        <div style={{ padding: 16, borderBottom: "1px solid #222" }}>
          <Link to="/admin/clips" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
            <img src="/logo.png" alt="" width={28} height={28} />
            <Typography.Text strong style={{ color: "#fff" }}>
              Admin
            </Typography.Text>
          </Link>
        </div>
        <Menu theme="dark" mode="inline" selectedKeys={selected} items={menuItems} style={{ border: "none", background: "transparent" }} />
      </Sider>
      <Layout>
        <Header
          style={{
            background: "#fff",
            borderBottom: "1px solid #e5e5e5",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 16,
            paddingInline: 24,
          }}
        >
          <Select
            value={i18n.language}
            style={{ width: 100 }}
            options={[
              { value: "es", label: "ES" },
              { value: "en", label: "EN" },
            ]}
            onChange={(lng) => setStoredAdminLang(lng)}
          />
          <Dropdown
            menu={{
              items: [
                { key: "profile", label: <Link to="/admin/profile">{t("nav.profile")}</Link> },
                {
                  key: "out",
                  label: t("nav.logout"),
                  onClick: () => {
                    logout();
                    navigate("/admin/login", { replace: true });
                  },
                },
              ],
            }}
          >
            <button type="button" style={{ display: "flex", alignItems: "center", gap: 8, border: "none", background: "none", cursor: "pointer" }}>
              <Avatar src={user?.avatarUrl || undefined}>{user?.email?.[0]?.toUpperCase()}</Avatar>
              <Typography.Text>{user?.displayName || user?.email}</Typography.Text>
            </button>
          </Dropdown>
        </Header>
        <Content style={{ padding: 24, background: "#fafafa" }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
