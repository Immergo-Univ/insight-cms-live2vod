import { useCallback, useEffect, useMemo, useState } from "react";
import {
  App,
  AutoComplete,
  Badge,
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";
import { getAdminClient } from "@/admin/admin-api";
import { useAdminAuth } from "@/admin/admin-auth-context";
import type { CreditCatalog, CreditOrder, CreditOrderKind, CreditOrderStatus, TenantCreditState } from "@/types/ai-credits";

type OrderDetail = CreditOrder & { tenantCredits?: TenantCreditState | null };

type ListResponse = {
  items: CreditOrder[];
  total: number;
  page: number;
  pageSize: number;
  pendingCount: number;
};

type EditFormValues = {
  credits: number;
  priceUsd: number;
  packName?: string;
  adminNotes?: string;
  companyName?: string;
  taxId?: string;
  billingEmail?: string;
};

type CreateFormValues = {
  tenantId: string;
  kind: CreditOrderKind;
  packId?: string;
  credits: number;
  priceUsd: number;
  adminNotes?: string;
};

const STATUS_COLORS: Record<CreditOrderStatus, string> = {
  pending: "gold",
  approved: "green",
  rejected: "red",
  cancelled: "default",
};

const KIND_COLORS: Record<CreditOrderKind, string> = {
  pack: "blue",
  custom: "cyan",
  enterprise: "purple",
};

function apiError(e: unknown): string {
  const err = e as { response?: { data?: { error?: string } }; message?: string };
  return err.response?.data?.error || err.message || "Error";
}

export function AdminCreditOrdersPage() {
  const { t, i18n } = useTranslation("admin");
  const { message } = App.useApp();
  const { can } = useAdminAuth();
  const numLocale = i18n.language === "es" ? "es-AR" : "en-US";
  const fmt = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString(numLocale));
  const money = (n: number | null | undefined) =>
    n == null ? "—" : "$" + Number(n).toLocaleString(numLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const date = (s: string | null | undefined) => (s ? new Date(s).toLocaleString(numLocale) : "—");

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ListResponse>({ items: [], total: 0, page: 1, pageSize: 20, pendingCount: 0 });
  const [status, setStatus] = useState<string>("pending");
  const [kind, setKind] = useState<string>("");
  const [tenantFilter, setTenantFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editing, setEditing] = useState<CreditOrder | null>(null);
  const [rejecting, setRejecting] = useState<CreditOrder | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [catalog, setCatalog] = useState<CreditCatalog | null>(null);
  const [tenantIds, setTenantIds] = useState<string[]>([]);

  const [editForm] = Form.useForm<EditFormValues>();
  const [createForm] = Form.useForm<CreateFormValues>();

  const canEdit = can("credits", "edit");
  const canDelete = can("credits", "delete");
  const canCreate = can("credits", "create");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await getAdminClient().get<ListResponse>("/credit-orders", {
        params: { status: status || undefined, kind: kind || undefined, tenantId: tenantFilter || undefined, page, pageSize },
      });
      setData(res);
    } catch (e) {
      message.error(apiError(e));
    } finally {
      setLoading(false);
    }
  }, [status, kind, tenantFilter, page, pageSize, message]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void getAdminClient()
      .get<CreditCatalog>("/credit-orders/catalog")
      .then(({ data: c }) => setCatalog(c))
      .catch(() => setCatalog(null));
  }, []);

  const refreshDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const { data: row } = await getAdminClient().get<OrderDetail>(`/credit-orders/${encodeURIComponent(id)}`);
      setDetail(row);
    } catch (e) {
      message.error(apiError(e));
    } finally {
      setDetailLoading(false);
    }
  }, [message]);

  const afterChange = useCallback(
    async (id?: string) => {
      await load();
      if (id && detail?.id === id) await refreshDetail(id);
    },
    [load, detail?.id, refreshDetail],
  );

  const approve = useCallback(
    async (order: CreditOrder) => {
      setBusyId(order.id);
      try {
        await getAdminClient().post(`/credit-orders/${encodeURIComponent(order.id)}/approve`, {});
        message.success(
          t("creditOrders.approved", {
            number: order.orderNumber,
            credits: order.credits.toLocaleString(numLocale),
            tenant: order.tenantId,
          }),
        );
        await afterChange(order.id);
      } catch (e) {
        message.error(apiError(e));
      } finally {
        setBusyId(null);
      }
    },
    [afterChange, message, t, numLocale],
  );

  const remove = useCallback(
    async (order: CreditOrder) => {
      setBusyId(order.id);
      try {
        await getAdminClient().delete(`/credit-orders/${encodeURIComponent(order.id)}`);
        message.success(t("creditOrders.deleted", { number: order.orderNumber }));
        if (detail?.id === order.id) setDetail(null);
        await load();
      } catch (e) {
        message.error(apiError(e));
      } finally {
        setBusyId(null);
      }
    },
    [detail?.id, load, message, t],
  );

  const submitReject = useCallback(async () => {
    if (!rejecting) return;
    setSaving(true);
    try {
      await getAdminClient().post(`/credit-orders/${encodeURIComponent(rejecting.id)}/reject`, { reason: rejectReason });
      message.success(t("creditOrders.rejected", { number: rejecting.orderNumber }));
      const id = rejecting.id;
      setRejecting(null);
      setRejectReason("");
      await afterChange(id);
    } catch (e) {
      message.error(apiError(e));
    } finally {
      setSaving(false);
    }
  }, [rejecting, rejectReason, afterChange, message, t]);

  const openEdit = useCallback(
    (order: CreditOrder) => {
      setEditing(order);
      editForm.setFieldsValue({
        credits: order.credits,
        priceUsd: order.priceUsd,
        packName: order.packName ?? "",
        adminNotes: order.adminNotes ?? "",
        companyName: order.invoiceDetails?.companyName ?? "",
        taxId: order.invoiceDetails?.taxId ?? "",
        billingEmail: order.invoiceDetails?.billingEmail ?? "",
      });
    },
    [editForm],
  );

  const submitEdit = useCallback(async () => {
    if (!editing) return;
    const v = await editForm.validateFields();
    setSaving(true);
    try {
      await getAdminClient().patch(`/credit-orders/${encodeURIComponent(editing.id)}`, {
        credits: v.credits,
        priceUsd: v.priceUsd,
        packName: v.packName,
        adminNotes: v.adminNotes,
        invoiceDetails: { companyName: v.companyName, taxId: v.taxId, billingEmail: v.billingEmail },
      });
      message.success(t("creditOrders.saved"));
      const id = editing.id;
      setEditing(null);
      await afterChange(id);
    } catch (e) {
      message.error(apiError(e));
    } finally {
      setSaving(false);
    }
  }, [editing, editForm, afterChange, message, t]);

  const openCreate = useCallback(() => {
    setCreating(true);
    createForm.resetFields();
    createForm.setFieldsValue({ kind: "custom", credits: catalog?.custom.minCredits ?? 0, priceUsd: 0 });
    if (can("tenants", "view")) {
      void getAdminClient()
        .get<{ tenants: { tenantId: string }[] }>("/tenants")
        .then(({ data: res }) => setTenantIds((res.tenants || []).map((x) => x.tenantId)))
        .catch(() => setTenantIds([]));
    }
  }, [createForm, catalog, can]);

  const submitCreate = useCallback(async () => {
    const v = await createForm.validateFields();
    const pack = v.kind === "pack" ? catalog?.packs.find((p) => p.id === v.packId) : undefined;
    setSaving(true);
    try {
      await getAdminClient().post("/credit-orders", {
        tenantId: v.tenantId,
        kind: v.kind,
        packId: pack?.id,
        packName: pack?.name,
        credits: v.credits,
        priceUsd: v.priceUsd,
        adminNotes: v.adminNotes,
      });
      message.success(t("creditOrders.created"));
      setCreating(false);
      setStatus("pending");
      setPage(1);
      await load();
    } catch (e) {
      message.error(apiError(e));
    } finally {
      setSaving(false);
    }
  }, [createForm, catalog, load, message, t]);

  const statusOptions = useMemo(
    () => [
      { value: "", label: t("creditOrders.allStatuses") },
      ...(["pending", "approved", "rejected", "cancelled"] as const).map((s) => ({ value: s, label: t(`creditOrders.status.${s}`) })),
    ],
    [t],
  );
  const kindOptions = useMemo(
    () => [
      { value: "", label: t("creditOrders.allKinds") },
      ...(["pack", "custom", "enterprise"] as const).map((k) => ({ value: k, label: t(`creditOrders.kind.${k}`) })),
    ],
    [t],
  );

  const columns: ColumnsType<CreditOrder> = [
    { title: "#", dataIndex: "orderNumber", key: "orderNumber", width: 70 },
    { title: t("creditOrders.createdAt"), dataIndex: "createdAt", key: "createdAt", width: 170, render: (v: string) => date(v) },
    { title: t("creditOrders.tenant"), dataIndex: "tenantId", key: "tenantId", ellipsis: true },
    {
      title: t("creditOrders.kindLabel"),
      dataIndex: "kind",
      key: "kind",
      width: 120,
      render: (v: CreditOrderKind, r) => (
        <Space size={4}>
          <Tag color={KIND_COLORS[v]}>{t(`creditOrders.kind.${v}`)}</Tag>
          {r.packName ? <Typography.Text type="secondary">{r.packName}</Typography.Text> : null}
        </Space>
      ),
    },
    { title: t("creditOrders.credits"), dataIndex: "credits", key: "credits", width: 120, align: "right", render: (v: number) => fmt(v) },
    { title: t("creditOrders.price"), dataIndex: "priceUsd", key: "priceUsd", width: 110, align: "right", render: (v: number) => money(v) },
    {
      title: t("creditOrders.statusLabel"),
      dataIndex: "status",
      key: "status",
      width: 120,
      render: (v: CreditOrderStatus) => <Tag color={STATUS_COLORS[v]}>{t(`creditOrders.status.${v}`)}</Tag>,
    },
    {
      title: t("creditOrders.actions"),
      key: "actions",
      width: 290,
      render: (_: unknown, r) => {
        const pending = r.status === "pending";
        return (
          <Space size={4} wrap onClick={(e) => e.stopPropagation()}>
            {pending && canEdit ? (
              r.credits > 0 ? (
                <Popconfirm
                  title={t("creditOrders.approveConfirmTitle", { number: r.orderNumber })}
                  description={t("creditOrders.approveConfirmDescription", { credits: fmt(r.credits), tenant: r.tenantId })}
                  okText={t("creditOrders.approve")}
                  cancelText={t("common.cancel")}
                  onConfirm={() => void approve(r)}
                >
                  <Button type="primary" size="small" loading={busyId === r.id}>
                    {t("creditOrders.approve")}
                  </Button>
                </Popconfirm>
              ) : (
                <Tooltip title={t("creditOrders.setCreditsFirst")}>
                  <Button type="primary" size="small" disabled>
                    {t("creditOrders.approve")}
                  </Button>
                </Tooltip>
              )
            ) : null}
            {pending && canEdit ? (
              <Button size="small" onClick={() => openEdit(r)}>
                {t("creditOrders.edit")}
              </Button>
            ) : null}
            {pending && canEdit ? (
              <Button
                size="small"
                danger
                onClick={() => {
                  setRejecting(r);
                  setRejectReason("");
                }}
              >
                {t("creditOrders.reject")}
              </Button>
            ) : null}
            {r.status !== "approved" && canDelete ? (
              <Popconfirm
                title={t("common.confirmDelete")}
                okText={t("common.delete")}
                okButtonProps={{ danger: true }}
                cancelText={t("common.cancel")}
                onConfirm={() => void remove(r)}
              >
                <Button size="small" type="text" danger loading={busyId === r.id}>
                  {t("common.delete")}
                </Button>
              </Popconfirm>
            ) : null}
          </Space>
        );
      },
    },
  ];

  const contact = detail?.contactDetails;
  const invoice = detail?.invoiceDetails;
  const createKind = Form.useWatch("kind", createForm);

  return (
    <div style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 12 }} wrap>
        <Space align="center">
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t("creditOrders.title")}
          </Typography.Title>
          {data.pendingCount > 0 ? <Badge count={data.pendingCount} title={t("creditOrders.pendingCount")} /> : null}
        </Space>
        {canCreate ? (
          <Button type="primary" onClick={openCreate}>
            {t("creditOrders.new")}
          </Button>
        ) : null}
      </Space>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        {t("creditOrders.subtitle")}
      </Typography.Paragraph>

      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          style={{ width: 170 }}
          value={status}
          options={statusOptions}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />
        <Select
          style={{ width: 160 }}
          value={kind}
          options={kindOptions}
          onChange={(v) => {
            setKind(v);
            setPage(1);
          }}
        />
        <Input.Search
          allowClear
          style={{ width: 260 }}
          placeholder={t("creditOrders.searchTenant")}
          onSearch={(v) => {
            setTenantFilter(v.trim());
            setPage(1);
          }}
        />
        <Button onClick={() => void load()}>{t("creditOrders.refresh")}</Button>
      </Space>

      <Table<CreditOrder>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={data.items}
        scroll={{ x: "max-content" }}
        rowClassName="admin-clickable-row"
        onRow={(record) => ({ onClick: () => void refreshDetail(record.id) })}
        pagination={{
          current: page,
          pageSize,
          total: data.total,
          showSizeChanger: true,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
      />

      <Drawer
        width={560}
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? t("creditOrders.detailTitle", { number: detail.orderNumber }) : ""}
        loading={detailLoading}
      >
        {detail ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label={t("creditOrders.statusLabel")}>
                <Tag color={STATUS_COLORS[detail.status]}>{t(`creditOrders.status.${detail.status}`)}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t("creditOrders.tenant")}>{detail.tenantId}</Descriptions.Item>
              <Descriptions.Item label={t("creditOrders.kindLabel")}>
                {t(`creditOrders.kind.${detail.kind}`)}
                {detail.packName ? ` · ${detail.packName}` : ""}
              </Descriptions.Item>
              <Descriptions.Item label={t("creditOrders.credits")}>{fmt(detail.credits)}</Descriptions.Item>
              <Descriptions.Item label={t("creditOrders.price")}>{money(detail.priceUsd)}</Descriptions.Item>
              <Descriptions.Item label={t("creditOrders.balanceAtRequest")}>{fmt(detail.balanceAtRequest)}</Descriptions.Item>
              <Descriptions.Item label={t("creditOrders.currentBalance")}>
                {detail.tenantCredits
                  ? detail.tenantCredits.limiterActive
                    ? fmt(detail.tenantCredits.totalRemaining)
                    : t("creditOrders.unlimited")
                  : "—"}
              </Descriptions.Item>
              <Descriptions.Item label={t("creditOrders.vod")}>{detail.vodGuid || "—"}</Descriptions.Item>
              <Descriptions.Item label={t("creditOrders.createdAt")}>{date(detail.createdAt)}</Descriptions.Item>
              <Descriptions.Item label={t("creditOrders.reviewedAt")}>{date(detail.reviewedAt)}</Descriptions.Item>
              {detail.rejectReason ? (
                <Descriptions.Item label={t("creditOrders.rejectReason")}>{detail.rejectReason}</Descriptions.Item>
              ) : null}
              <Descriptions.Item label={t("creditOrders.adminNotes")}>{detail.adminNotes || "—"}</Descriptions.Item>
            </Descriptions>

            <Descriptions column={1} size="small" bordered title={t("creditOrders.invoiceTitle")}>
              <Descriptions.Item label={t("creditOrders.companyName")}>{invoice?.companyName || "—"}</Descriptions.Item>
              <Descriptions.Item label={t("creditOrders.taxId")}>{invoice?.taxId || "—"}</Descriptions.Item>
              <Descriptions.Item label={t("creditOrders.billingEmail")}>{invoice?.billingEmail || "—"}</Descriptions.Item>
            </Descriptions>

            {contact ? (
              <Descriptions column={1} size="small" bordered title={t("creditOrders.contactTitle")}>
                <Descriptions.Item label={t("creditOrders.contactName")}>{contact.contactName || "—"}</Descriptions.Item>
                <Descriptions.Item label={t("creditOrders.contactEmail")}>{contact.contactEmail || "—"}</Descriptions.Item>
                <Descriptions.Item label={t("creditOrders.contactPhone")}>{contact.contactPhone || "—"}</Descriptions.Item>
                <Descriptions.Item label={t("creditOrders.monthlyVolume")}>{contact.monthlyVolume || "—"}</Descriptions.Item>
                <Descriptions.Item label={t("creditOrders.billingPreference")}>{contact.billingPreference || "—"}</Descriptions.Item>
                <Descriptions.Item label={t("creditOrders.needs")}>{(contact.needs ?? []).join(", ") || "—"}</Descriptions.Item>
                <Descriptions.Item label={t("creditOrders.reachBy")}>{contact.reachBy || "—"}</Descriptions.Item>
                <Descriptions.Item label={t("creditOrders.message")}>
                  <span style={{ whiteSpace: "pre-wrap" }}>{contact.message || "—"}</span>
                </Descriptions.Item>
              </Descriptions>
            ) : null}

            {detail.status === "pending" && canEdit ? (
              <Space wrap>
                {detail.credits > 0 ? (
                  <Popconfirm
                    title={t("creditOrders.approveConfirmTitle", { number: detail.orderNumber })}
                    description={t("creditOrders.approveConfirmDescription", { credits: fmt(detail.credits), tenant: detail.tenantId })}
                    okText={t("creditOrders.approve")}
                    cancelText={t("common.cancel")}
                    onConfirm={() => void approve(detail)}
                  >
                    <Button type="primary" loading={busyId === detail.id}>
                      {t("creditOrders.approve")}
                    </Button>
                  </Popconfirm>
                ) : (
                  <Tooltip title={t("creditOrders.setCreditsFirst")}>
                    <Button type="primary" disabled>
                      {t("creditOrders.approve")}
                    </Button>
                  </Tooltip>
                )}
                <Button onClick={() => openEdit(detail)}>{t("creditOrders.edit")}</Button>
                <Button
                  danger
                  onClick={() => {
                    setRejecting(detail);
                    setRejectReason("");
                  }}
                >
                  {t("creditOrders.reject")}
                </Button>
              </Space>
            ) : null}
          </Space>
        ) : null}
      </Drawer>

      <Modal
        open={editing !== null}
        title={editing ? t("creditOrders.editTitle", { number: editing.orderNumber }) : ""}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        confirmLoading={saving}
        onOk={() => void submitEdit()}
        onCancel={() => setEditing(null)}
        forceRender
      >
        <Form form={editForm} layout="vertical">
          <Space style={{ width: "100%" }} styles={{ item: { flex: 1 } }}>
            <Form.Item name="credits" label={t("creditOrders.credits")} rules={[{ required: true }]}>
              <InputNumber min={0} step={1000} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="priceUsd" label={t("creditOrders.price")} rules={[{ required: true }]}>
              <InputNumber min={0} step={10} prefix="$" style={{ width: "100%" }} />
            </Form.Item>
          </Space>
          <Form.Item name="packName" label={t("creditOrders.packName")}>
            <Input />
          </Form.Item>
          <Form.Item name="companyName" label={t("creditOrders.companyName")}>
            <Input />
          </Form.Item>
          <Space style={{ width: "100%" }} styles={{ item: { flex: 1 } }}>
            <Form.Item name="taxId" label={t("creditOrders.taxId")}>
              <Input />
            </Form.Item>
            <Form.Item name="billingEmail" label={t("creditOrders.billingEmail")} rules={[{ type: "email" }]}>
              <Input />
            </Form.Item>
          </Space>
          <Form.Item name="adminNotes" label={t("creditOrders.adminNotes")}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={rejecting !== null}
        title={rejecting ? t("creditOrders.rejectTitle", { number: rejecting.orderNumber }) : ""}
        okText={t("creditOrders.reject")}
        okButtonProps={{ danger: true }}
        cancelText={t("common.cancel")}
        confirmLoading={saving}
        onOk={() => void submitReject()}
        onCancel={() => setRejecting(null)}
      >
        <Typography.Paragraph type="secondary">{t("creditOrders.rejectHint")}</Typography.Paragraph>
        <Input.TextArea
          rows={3}
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder={t("creditOrders.rejectReason")}
        />
      </Modal>

      <Modal
        open={creating}
        title={t("creditOrders.newTitle")}
        okText={t("creditOrders.create")}
        cancelText={t("common.cancel")}
        confirmLoading={saving}
        onOk={() => void submitCreate()}
        onCancel={() => setCreating(false)}
        forceRender
      >
        <Typography.Paragraph type="secondary">{t("creditOrders.newHint")}</Typography.Paragraph>
        <Form form={createForm} layout="vertical">
          <Form.Item name="tenantId" label={t("creditOrders.tenant")} rules={[{ required: true }]}>
            <AutoComplete
              options={tenantIds.map((id) => ({ value: id }))}
              filterOption={(input, option) => String(option?.value ?? "").toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>
          <Form.Item name="kind" label={t("creditOrders.kindLabel")} rules={[{ required: true }]}>
            <Select
              options={(["pack", "custom", "enterprise"] as const).map((k) => ({ value: k, label: t(`creditOrders.kind.${k}`) }))}
            />
          </Form.Item>
          {createKind === "pack" ? (
            <Form.Item name="packId" label={t("creditOrders.pack")} rules={[{ required: true }]}>
              <Select
                options={(catalog?.packs ?? []).map((p) => ({
                  value: p.id,
                  label: `${p.name} · ${fmt(p.credits)} · ${money(p.priceUsd)}`,
                }))}
                onChange={(id: string) => {
                  const p = catalog?.packs.find((x) => x.id === id);
                  if (p) createForm.setFieldsValue({ credits: p.credits, priceUsd: p.priceUsd });
                }}
              />
            </Form.Item>
          ) : null}
          <Space style={{ width: "100%" }} styles={{ item: { flex: 1 } }}>
            <Form.Item name="credits" label={t("creditOrders.credits")} rules={[{ required: true }]}>
              <InputNumber min={1} step={1000} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="priceUsd" label={t("creditOrders.price")} rules={[{ required: true }]}>
              <InputNumber min={0} step={10} prefix="$" style={{ width: "100%" }} />
            </Form.Item>
          </Space>
          <Form.Item name="adminNotes" label={t("creditOrders.adminNotes")}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
