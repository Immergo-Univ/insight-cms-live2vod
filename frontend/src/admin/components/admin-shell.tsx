import { useMemo, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { Avatar, Dropdown, Layout, Menu, Select, Typography } from "antd";
import type { MenuProps } from "antd";
import {
  AppstoreOutlined,
  TeamOutlined,
  SafetyOutlined,
  UserOutlined,
  VideoCameraOutlined,
  ApartmentOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useAdminAuth } from "@/admin/admin-auth-context";
import { setStoredAdminLang } from "@/admin/admin-i18n";

const { Header, Sider, Content } = Layout;
const adminBrandLogoSrc = "/immergo-admin-logo.png";

export function AdminShell() {
  const { t, i18n } = useTranslation("admin");
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, can } = useAdminAuth();

  const menuItems = useMemo(() => {
    const items: NonNullable<MenuProps["items"]> = [];
    if (can("clips", "view_item")) {
      items.push({
        key: "/admin/clips",
        label: <Link to="/admin/clips">{t("nav.clips")}</Link>,
        icon: <VideoCameraOutlined />,
      });
    }
    if (can("tenants", "view")) {
      items.push({
        key: "/admin/tenants",
        label: <Link to="/admin/tenants">{t("nav.tenants")}</Link>,
        icon: <ApartmentOutlined />,
      });
    }
    if (can("settings", "view")) {
      items.push({
        key: "/admin/settings",
        label: <Link to="/admin/settings">{t("nav.settings")}</Link>,
        icon: <ToolOutlined />,
      });
    }

    const configItems: NonNullable<MenuProps["items"]> = [];
    configItems.push({
      key: "/admin/profile",
      label: <Link to="/admin/profile">{t("nav.profile")}</Link>,
      icon: <UserOutlined />,
    });
    if (can("users", "view_item")) {
      configItems.push({
        key: "/admin/users",
        label: <Link to="/admin/users">{t("nav.users")}</Link>,
        icon: <TeamOutlined />,
      });
    }
    if (can("roles", "view_item")) {
      configItems.push({
        key: "/admin/roles",
        label: <Link to="/admin/roles">{t("nav.roles")}</Link>,
        icon: <AppstoreOutlined />,
      });
    }
    if (can("permissions", "view_item")) {
      configItems.push({
        key: "/admin/permissions",
        label: <Link to="/admin/permissions">{t("nav.permissions")}</Link>,
        icon: <SafetyOutlined />,
      });
    }
    if (configItems.length) {
      items.push({ type: "divider" as const });
      items.push({
        key: "__config_group",
        type: "group" as const,
        label: <span className="admin-nav-group-title">{t("nav.configuration")}</span>,
        children: configItems,
      });
    }
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
    <Layout className="admin-layout">
      <Sider width={240} className="admin-sider">
        <div className="admin-brand">
          <Link to="/admin/clips" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
            <img src={adminBrandLogoSrc} alt="Immergo" width={34} height={34} />
          </Link>
        </div>
        <Menu theme="dark" mode="inline" selectedKeys={selected} items={menuItems} className="admin-nav-menu" />
        <div className="admin-sider-footer">
          <div className="admin-sider-footer-email">{user?.email || "-"}</div>
          <div className="admin-sider-footer-role">{user?.displayName || "Admin"}</div>
        </div>
      </Sider>
      <Layout className="admin-main-layout">
        <Header className="admin-header">
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
            <button type="button" className="admin-user-menu-trigger">
              <Avatar src={user?.avatarUrl || undefined}>{user?.email?.[0]?.toUpperCase()}</Avatar>
              <Typography.Text>{user?.displayName || user?.email}</Typography.Text>
            </button>
          </Dropdown>
        </Header>
        <Content className="admin-content">
          <div className="admin-page-container">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
