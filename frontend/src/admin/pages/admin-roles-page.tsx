import { useCallback, useEffect, useState } from "react";
import { App, Button, Dropdown, Form, Input, Modal, Table, Typography } from "antd";
import { MoreOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";
import { getAdminClient } from "@/admin/admin-api";
import { useAdminAuth } from "@/admin/admin-auth-context";

type RoleRow = { id: string; name: string; slug: string; description?: string | null };

export function AdminRolesPage() {
  const { t } = useTranslation("admin");
  const { message } = App.useApp();
  const { can } = useAdminAuth();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<RoleRow[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getAdminClient().get<{ roles: RoleRow[] }>("/roles");
      setRows(data.roles || []);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || "Error");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: ColumnsType<RoleRow> = [
    { title: t("roles.name"), dataIndex: "name", key: "name" },
    { title: t("roles.slug"), dataIndex: "slug", key: "slug" },
    {
      title: t("roles.actions"),
      key: "a",
      width: 90,
      render: (_, r) => (
        <Dropdown
          trigger={["click"]}
          menu={{
            items: [
              ...(can("roles", "edit")
                ? [
                    {
                      key: "e",
                      label: t("roles.edit"),
                      onClick: () => {
                        setEditing(r);
                        form.setFieldsValue(r);
                        setModalOpen(true);
                      },
                    },
                  ]
                : []),
              ...(can("roles", "delete") && r.slug !== "superadmin"
                ? [
                    {
                      key: "d",
                      label: t("roles.delete"),
                      onClick: () => {
                        Modal.confirm({
                          title: t("common.confirmDelete"),
                          onOk: async () => {
                            try {
                              await getAdminClient().delete(`/roles/${encodeURIComponent(r.id)}`);
                              message.success("OK");
                              void load();
                            } catch (e2: unknown) {
                              const err2 = e2 as { response?: { data?: { error?: string } } };
                              message.error(err2.response?.data?.error || "Error");
                            }
                          },
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

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t("roles.title")}
        </Typography.Title>
        {can("roles", "create") ? (
          <Button
            type="primary"
            onClick={() => {
              setEditing(null);
              form.resetFields();
              setModalOpen(true);
            }}
          >
            {t("roles.create")}
          </Button>
        ) : null}
      </div>
      <Table<RoleRow> rowKey="id" loading={loading} columns={columns} dataSource={rows} pagination={false} />

      <Modal
        title={editing ? t("roles.edit") : t("roles.create")}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (v: RoleRow) => {
            try {
              if (editing) {
                await getAdminClient().patch(`/roles/${encodeURIComponent(editing.id)}`, v);
              } else {
                await getAdminClient().post("/roles", v);
              }
              message.success("OK");
              setModalOpen(false);
              void load();
            } catch (e: unknown) {
              const err = e as { response?: { data?: { error?: string } } };
              message.error(err.response?.data?.error || "Error");
            }
          }}
        >
          <Form.Item name="name" label={t("roles.name")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="slug" label={t("roles.slug")} rules={[{ required: true }]}>
            <Input disabled={Boolean(editing?.slug === "superadmin")} />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
