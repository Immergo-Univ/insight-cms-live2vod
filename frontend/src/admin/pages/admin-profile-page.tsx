import { App, Button, Form, Input, Typography } from "antd";
import { AppSelect } from "@/components/base/select/app-select";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getAdminClient } from "@/admin/admin-api";
import { useAdminAuth } from "@/admin/admin-auth-context";
import { setStoredAdminLang } from "@/admin/admin-i18n";

export function AdminProfilePage() {
  const { t, i18n } = useTranslation("admin");
  const { message } = App.useApp();
  const { user, refresh } = useAdminAuth();
  const [form] = Form.useForm();

  useEffect(() => {
    if (user) {
      form.setFieldsValue({
        displayName: user.displayName,
        language: user.language || "es",
        avatarUrl: user.avatarUrl,
        password: "",
      });
    }
  }, [user, form]);

  return (
    <div style={{ maxWidth: 480 }}>
      <Typography.Title level={4}>{t("profile.title")}</Typography.Title>
      <Form
        layout="vertical"
        form={form}
        onFinish={async (v: { displayName?: string; language?: string; avatarUrl?: string; password?: string }) => {
          try {
            await getAdminClient().patch("/auth/profile", {
              displayName: v.displayName,
              language: v.language,
              avatarUrl: v.avatarUrl,
              password: v.password || undefined,
            });
            if (v.language) setStoredAdminLang(v.language);
            message.success("OK");
            await refresh();
          } catch (e: unknown) {
            const err = e as { response?: { data?: { error?: string } } };
            message.error(err.response?.data?.error || "Error");
          }
        }}
      >
        <Form.Item name="displayName" label={t("profile.displayName")}>
          <Input />
        </Form.Item>
        <Form.Item name="language" label={t("profile.language")}>
          <AppSelect
            skipThemeProvider
            options={[
              { value: "es", label: "ES" },
              { value: "en", label: "EN" },
            ]}
            onChange={(lng) => void i18n.changeLanguage(lng)}
          />
        </Form.Item>
        <Form.Item name="avatarUrl" label={t("profile.avatarUrl")}>
          <Input />
        </Form.Item>
        <Form.Item name="password" label={t("profile.password")}>
          <Input.Password placeholder="(optional)" />
        </Form.Item>
        <Button type="primary" htmlType="submit">
          {t("profile.save")}
        </Button>
      </Form>
    </div>
  );
}
