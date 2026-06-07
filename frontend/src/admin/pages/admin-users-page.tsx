import { useCallback, useEffect, useState } from "react";
import { App, Button, Drawer, Dropdown, Form, Input, Modal, Table, Typography } from "antd";
import { AppSelect } from "@/components/base/select/app-select";
import { MoreOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";
import { getAdminClient } from "@/admin/admin-api";
import { useAdminAuth } from "@/admin/admin-auth-context";

type RoleOpt = { id: string; name: string; slug: string };
type UserRow = {
  id: string;
  email: string;
  displayName?: string | null;
  roles?: RoleOpt[];
};

export function AdminUsersPage() {
  const { t } = useTranslation("admin");
  const { message } = App.useApp();
  const { can } = useAdminAuth();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleOpt[]>([]);
  const [viewUser, setViewUser] = useState<UserRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();

  const loadRoles = useCallback(async () => {
    try {
      const { data } = await getAdminClient().get<{ roles: RoleOpt[] }>("/roles");
      setRoles(data.roles || []);
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getAdminClient().get<{ users: UserRow[] }>("/users");
      setRows(data.users || []);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || "Error");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
    void loadRoles();
  }, [load, loadRoles]);

  const openEdit = (u: UserRow) => {
    setEditing(u);
    form.setFieldsValue({
      displayName: u.displayName,
      roleIds: (u.roles || []).map((r) => r.id),
      password: "",
    });
    setEditOpen(true);
  };

  const columns: ColumnsType<UserRow> = [
    { title: t("users.email"), dataIndex: "email", key: "email" },
    { title: t("users.displayName"), dataIndex: "displayName", key: "displayName" },
    {
      title: t("users.roles"),
      key: "roles",
      render: (_, u) => (u.roles || []).map((r) => r.name).join(", ") || "—",
    },
    {
      title: t("users.actions"),
      key: "actions",
      width: 90,
      render: (_, u) => (
        <Dropdown
          trigger={["click"]}
          menu={{
            items: [
              { key: "view", label: t("users.view"), onClick: () => setViewUser(u) },
              ...(can("users", "edit") ? [{ key: "edit", label: t("users.edit"), onClick: () => openEdit(u) }] : []),
              ...(can("users", "delete")
                ? [
                    {
                      key: "del",
                      label: t("users.delete"),
                      onClick: () => {
                        Modal.confirm({
                          title: t("common.confirmDelete"),
                          onOk: () => handleDelete(u.id),
                        });
                      },
                    },
                  ]
                : []),
            ],
          }}
        >
          <Button type="text" icon={<MoreOutlined style={{ transform: "rotate(90deg)" }} />} />
        </Dropdown>
      ),
    },
  ];

  const handleDelete = async (id: string) => {
    try {
      await getAdminClient().delete(`/users/${encodeURIComponent(id)}`);
      message.success("OK");
      void load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || "Error");
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t("users.title")}
        </Typography.Title>
        {can("users", "create") ? (
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            {t("users.create")}
          </Button>
        ) : null}
      </div>
      <Table<UserRow> rowKey="id" loading={loading} columns={columns} dataSource={rows} pagination={false} />

      <Drawer title={t("users.view")} open={Boolean(viewUser)} onClose={() => setViewUser(null)} width={480}>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{viewUser ? JSON.stringify(viewUser, null, 2) : ""}</pre>
      </Drawer>

      <Modal
        title={editing ? t("users.edit") : ""}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (v: { displayName?: string; password?: string; roleIds?: string[] }) => {
            if (!editing) return;
            try {
              await getAdminClient().patch(`/users/${encodeURIComponent(editing.id)}`, {
                displayName: v.displayName,
                password: v.password || undefined,
                roleIds: v.roleIds,
              });
              message.success("OK");
              setEditOpen(false);
              void load();
            } catch (e: unknown) {
              const err = e as { response?: { data?: { error?: string } } };
              message.error(err.response?.data?.error || "Error");
            }
          }}
        >
          <Form.Item name="displayName" label={t("users.displayName")}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label={t("users.password")}>
            <Input.Password placeholder="(optional)" />
          </Form.Item>
          <Form.Item name="roleIds" label={t("users.roles")}>
            <AppSelect skipThemeProvider mode="multiple" options={roles.map((r) => ({ value: r.id, label: r.name }))} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("users.create")}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Form
          layout="vertical"
          onFinish={async (v: { email: string; password: string; displayName?: string; roleIds?: string[] }) => {
            try {
              await getAdminClient().post("/users", v);
              message.success("OK");
              setCreateOpen(false);
              void load();
            } catch (e: unknown) {
              const err = e as { response?: { data?: { error?: string } } };
              message.error(err.response?.data?.error || "Error");
            }
          }}
        >
          <Form.Item name="email" label={t("users.email")} rules={[{ required: true, type: "email" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label={t("users.password")} rules={[{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="displayName" label={t("users.displayName")}>
            <Input />
          </Form.Item>
          <Form.Item name="roleIds" label={t("users.roles")}>
            <AppSelect skipThemeProvider mode="multiple" options={roles.map((r) => ({ value: r.id, label: r.name }))} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            {t("common.save")}
          </Button>
        </Form>
      </Modal>
    </div>
  );
}
