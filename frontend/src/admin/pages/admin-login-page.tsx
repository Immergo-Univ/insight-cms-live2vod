import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { App, Button, Form, Input, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useAdminAuth } from "@/admin/admin-auth-context";

const primary = "#0d9488";
const adminBrandLogoSrc = "/immergo-admin-logo.png";

export function AdminLoginPage() {
  const { t } = useTranslation("admin");
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { user, login } = useAdminAuth();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) navigate("/admin/clips", { replace: true });
  }, [user, navigate]);

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <div
        style={{
          flex: 1,
          background: "#000",
          color: "#fff",
          padding: 48,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 24,
        }}
        className="max-lg:hidden"
      >
        <img src={adminBrandLogoSrc} alt="Immergo" style={{ width: 120, height: "auto" }} />
        <Typography.Title level={2} style={{ color: "#fff", margin: 0 }}>
          {t("login.title")}
        </Typography.Title>
        <Typography.Paragraph style={{ color: "#ccc", fontSize: 16, maxWidth: 420 }}>
          Live2VOD administration. Review users, roles, permissions, and generated clips stored in the database.
        </Typography.Paragraph>
        <ul style={{ color: "#aaa", fontSize: 15, lineHeight: 1.8, paddingLeft: 20 }}>
          <li>Users &amp; roles</li>
          <li>Permission matrix</li>
          <li>Clip playback &amp; transcripts</li>
        </ul>
        <div style={{ width: 120, height: 4, background: primary, opacity: 0.6 }} />
      </div>
      <div style={{ flex: 1, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
        <div style={{ width: "100%", maxWidth: 400 }}>
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <img src={adminBrandLogoSrc} alt="Immergo" style={{ width: 72, marginBottom: 16 }} />
            <Typography.Title level={3} style={{ margin: 0 }}>
              {t("login.title")}
            </Typography.Title>
            <Typography.Text type="secondary">{t("login.subtitle")}</Typography.Text>
          </div>
          <Form
            layout="vertical"
            onFinish={async (v: { email: string; password: string }) => {
              setLoading(true);
              try {
                await login(v.email, v.password);
                message.success("OK");
                navigate("/admin/clips", { replace: true });
              } catch (e: unknown) {
                const err = e as { response?: { data?: { error?: string } } };
                message.error(err.response?.data?.error || t("login.error"));
              } finally {
                setLoading(false);
              }
            }}
          >
            <Form.Item name="email" label={t("login.email")} rules={[{ required: true, type: "email" }]}>
              <Input size="large" style={{ borderWidth: 2 }} autoComplete="email" />
            </Form.Item>
            <Form.Item name="password" label={t("login.password")} rules={[{ required: true }]}>
              <Input.Password size="large" style={{ borderWidth: 2 }} autoComplete="current-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block size="large" style={{ height: 52, fontWeight: 700 }}>
              {t("login.submit")}
            </Button>
          </Form>
        </div>
      </div>
    </div>
  );
}
