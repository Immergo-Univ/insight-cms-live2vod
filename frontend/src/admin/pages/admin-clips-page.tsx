import { useCallback, useEffect, useState } from "react";
import { App, Button, Dropdown, Table, Tag, Typography } from "antd";
import { MoreOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";
import { getAdminClient } from "@/admin/admin-api";
import { ClipDetailModal, type AdminClipDetail } from "@/admin/components/clip-detail-modal";

type ClipRow = {
  id: string;
  tenantId: string;
  status: string;
  phase: string;
  jobKind?: string;
  editorClipId?: string;
  createdAt?: string;
};

export function AdminClipsPage() {
  const { t } = useTranslation("admin");
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ClipRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<AdminClipDetail | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getAdminClient().get<{ items: ClipRow[]; total: number }>("/clips", { params: { page, pageSize } });
      setRows(data.items || []);
      setTotal(data.total || 0);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || "Error");
    } finally {
      setLoading(false);
    }
  }, [message, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  const openView = async (id: string) => {
    setModalOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      const { data } = await getAdminClient().get<AdminClipDetail>(`/clips/${encodeURIComponent(id)}`);
      setDetail(data);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || "Error");
      setModalOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const columns: ColumnsType<ClipRow> = [
    { title: t("clips.tenant"), dataIndex: "tenantId", key: "tenantId" },
    { title: t("clips.status"), dataIndex: "status", key: "status", render: (s: string) => <Tag>{s}</Tag> },
    { title: t("clips.phase"), dataIndex: "phase", key: "phase", ellipsis: true },
    { title: t("clips.kind"), dataIndex: "jobKind", key: "jobKind" },
    { title: "Editor clip", dataIndex: "editorClipId", key: "editorClipId", ellipsis: true },
    { title: t("clips.created"), dataIndex: "createdAt", key: "createdAt", width: 200 },
    {
      title: t("clips.actions"),
      key: "actions",
      width: 100,
      render: (_, record) => (
        <Dropdown
          trigger={["click"]}
          menu={{
            items: [{ key: "view", label: t("clips.view"), onClick: () => void openView(record.id) }],
          }}
        >
          <Button type="text" icon={<MoreOutlined style={{ transform: "rotate(90deg)" }} />} aria-label="actions" />
        </Dropdown>
      ),
    },
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {t("clips.title")}
      </Typography.Title>
      <Table<ClipRow>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: false,
          onChange: (p) => setPage(p),
        }}
      />
      <ClipDetailModal open={modalOpen} onClose={() => setModalOpen(false)} clip={detail} loading={detailLoading} />
    </div>
  );
}
