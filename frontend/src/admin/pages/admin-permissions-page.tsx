import { useCallback, useEffect, useState } from "react";
import { App, Button, Checkbox, Table, Typography } from "antd";
import { AppSelect } from "@/components/base/select/app-select";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";
import { getAdminClient } from "@/admin/admin-api";
import { useAdminAuth } from "@/admin/admin-auth-context";

type RoleOpt = { id: string; name: string; slug: string };

export function AdminPermissionsPage() {
  const { t } = useTranslation("admin");
  const { message } = App.useApp();
  const { can } = useAdminAuth();
  const [roles, setRoles] = useState<RoleOpt[]>([]);
  const [roleId, setRoleId] = useState<string>("");
  const [entities, setEntities] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [matrix, setMatrix] = useState<Record<string, Record<string, boolean>>>({});
  const [loading, setLoading] = useState(false);

  const loadRolesOnce = useCallback(async () => {
    const { data } = await getAdminClient().get<{ roles: RoleOpt[] }>("/roles");
    const list = data.roles || [];
    setRoles(list);
    setRoleId((prev) => prev || list[0]?.id || "");
  }, []);

  const loadMatrix = useCallback(
    async (rid: string) => {
      if (!rid) return;
      setLoading(true);
      try {
        const { data } = await getAdminClient().get<{ entities: string[]; actions: string[]; matrix: Record<string, Record<string, boolean>> }>(
          "/permissions/matrix",
          { params: { roleId: rid } },
        );
        setEntities(data.entities || []);
        setActions(data.actions || []);
        setMatrix(data.matrix || {});
      } catch (e: unknown) {
        const err = e as { response?: { data?: { error?: string } } };
        message.error(err.response?.data?.error || "Error");
      } finally {
        setLoading(false);
      }
    },
    [message],
  );

  useEffect(() => {
    void loadRolesOnce();
  }, [loadRolesOnce]);

  useEffect(() => {
    if (roleId) void loadMatrix(roleId);
  }, [roleId, loadMatrix]);

  const columns: ColumnsType<{ entity: string }> = [
    { title: "Entity", dataIndex: "entity", key: "entity", fixed: "left", width: 120 },
    ...actions.map((a) => ({
      title: a,
      key: a,
      render: (_: unknown, row: { entity: string }) => (
        <Checkbox
          disabled={!can("permissions", "edit")}
          checked={Boolean(matrix[row.entity]?.[a])}
          onChange={(e) => {
            const next = { ...matrix, [row.entity]: { ...matrix[row.entity], [a]: e.target.checked } };
            setMatrix(next);
          }}
        />
      ),
    })),
  ];

  const dataSource = entities.map((entity) => ({ entity }));

  return (
    <div>
      <Typography.Title level={4}>{t("permissions.title")}</Typography.Title>
      <div style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "center" }}>
        <Typography.Text>{t("permissions.role")}</Typography.Text>
        <AppSelect
          skipThemeProvider
          style={{ minWidth: 220 }}
          value={roleId || undefined}
          options={roles.map((r) => ({ value: r.id, label: r.name }))}
          onChange={setRoleId}
        />
        {can("permissions", "edit") ? (
          <Button
            type="primary"
            onClick={async () => {
              try {
                await getAdminClient().put("/permissions/matrix", { roleId, matrix });
                message.success(t("permissions.saved"));
                void loadMatrix(roleId);
              } catch (e: unknown) {
                const err = e as { response?: { data?: { error?: string } } };
                message.error(err.response?.data?.error || "Error");
              }
            }}
          >
            {t("permissions.save")}
          </Button>
        ) : null}
      </div>
      <Table loading={loading} rowKey="entity" columns={columns} dataSource={dataSource} pagination={false} scroll={{ x: "max-content" }} />
    </div>
  );
}
