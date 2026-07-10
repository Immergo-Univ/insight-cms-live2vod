import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Divider,
  Empty,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Slider,
  Space,
  Spin,
  Switch,
  Typography,
  Upload,
} from "antd";
import type { UploadProps } from "antd";
import { useTranslation } from "react-i18next";
import { getAdminClient } from "@/admin/admin-api";

// ---- Types (mirror the backend rule-engine config JSON) ---------------------------------------

type TextSource = "original" | "translated";

type Roi = { x: number; y: number; w: number; h: number };

type Sample = {
  id: string;
  s3Key: string;
  url: string;
  phash: string;
  ocrText: string;
  ocrTextEn: string;
};

type OcrOpt = {
  enabled: boolean;
  matchText: string;
  textSource: TextSource;
  similarity: number;
};

type LogoInstance = {
  id: string;
  roi: Roi;
  hashSensitivity: number;
  samples: Sample[];
  ocr: OcrOpt;
};

type LogoStrategy = { enabled: boolean; instances: LogoInstance[] };

type OcrOp =
  | "includes"
  | "startsWith"
  | "endsWith"
  | "similarTo"
  | "regex"
  | "between"
  | "majorTo"
  | "minorTo";

type OcrCondition = {
  id: string;
  op: OcrOp;
  value: string;
  value2: string;
  similarity: number;
  textSource: TextSource;
};

type OcrGroup = { id: string; conditions: OcrCondition[] };

type OcrRulesStrategy = { enabled: boolean; groups: OcrGroup[] };

type AdConfig = {
  threshold: number;
  logoAppearance: LogoStrategy;
  logoDisappearance: LogoStrategy;
  ocrRules: OcrRulesStrategy;
};

type Props = { tenantId: string; channelId: string };

const OPERATORS: OcrOp[] = [
  "includes",
  "startsWith",
  "endsWith",
  "similarTo",
  "regex",
  "between",
  "majorTo",
  "minorTo",
];

function genId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function readErrorMessage(e: unknown, fallback = "Error"): string {
  const err = e as { response?: { data?: { error?: string } }; message?: string };
  return err.response?.data?.error || err.message || fallback;
}

function emptyConfig(): AdConfig {
  return {
    threshold: 0.5,
    logoAppearance: { enabled: false, instances: [] },
    logoDisappearance: { enabled: false, instances: [] },
    ocrRules: { enabled: false, groups: [] },
  };
}

function newLogoInstance(): LogoInstance {
  return {
    id: genId(),
    roi: { x: 0, y: 0, w: 1, h: 1 },
    hashSensitivity: 85,
    samples: [],
    ocr: { enabled: false, matchText: "", textSource: "original", similarity: 80 },
  };
}

function newCondition(): OcrCondition {
  return { id: genId(), op: "includes", value: "", value2: "", similarity: 80, textSource: "original" };
}

function newGroup(): OcrGroup {
  return { id: genId(), conditions: [newCondition()] };
}

/** Normalize whatever the API returns into a fully-populated config (defaults for missing bits). */
function hydrate(raw: unknown): AdConfig {
  const base = emptyConfig();
  if (!raw || typeof raw !== "object") return base;
  const src = raw as Partial<AdConfig>;
  const hydrateLogo = (s: unknown): LogoStrategy => {
    const ls = (s as LogoStrategy) || {};
    return {
      enabled: Boolean(ls.enabled),
      instances: Array.isArray(ls.instances)
        ? ls.instances.map((i) => ({ ...newLogoInstance(), ...i, roi: { ...newLogoInstance().roi, ...i?.roi }, ocr: { ...newLogoInstance().ocr, ...i?.ocr }, samples: Array.isArray(i?.samples) ? i.samples : [] }))
        : [],
    };
  };
  return {
    threshold: typeof src.threshold === "number" ? src.threshold : 0.5,
    logoAppearance: hydrateLogo(src.logoAppearance),
    logoDisappearance: hydrateLogo(src.logoDisappearance),
    ocrRules: {
      enabled: Boolean(src.ocrRules?.enabled),
      groups: Array.isArray(src.ocrRules?.groups)
        ? src.ocrRules.groups.map((g) => ({
            id: g?.id || genId(),
            conditions: Array.isArray(g?.conditions)
              ? g.conditions.map((c) => ({ ...newCondition(), ...c }))
              : [newCondition()],
          }))
        : [],
    },
  };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function AdRecognitionSetupTab({ tenantId, channelId }: Props) {
  const { t } = useTranslation("admin");
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [cfg, setCfg] = useState<AdConfig>(emptyConfig());

  const base = `/tenants/${encodeURIComponent(tenantId)}/streams/${encodeURIComponent(channelId)}`;

  const load = useCallback(async () => {
    if (!tenantId || !channelId) return;
    setLoading(true);
    try {
      const { data } = await getAdminClient().get<{ config: AdConfig }>(`${base}/ad-config`);
      setCfg(hydrate(data?.config));
    } catch (e: unknown) {
      message.error(readErrorMessage(e));
      setCfg(emptyConfig());
    } finally {
      setLoading(false);
    }
  }, [base, channelId, message, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await getAdminClient().put(`${base}/ad-config`, { config: cfg });
      message.success(t("adSetup.saved"));
    } catch (e: unknown) {
      message.error(readErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  // Recompute the pHash/OCR of every uploaded sample (via the microservice) and persist. Backfills
  // samples uploaded while the sidecar wasn't ready (empty pHash).
  const recalcPhash = async () => {
    setRecalculating(true);
    try {
      const { data } = await getAdminClient().post<{
        config: AdConfig;
        stats?: { total: number; ok: number; failed: number };
      }>(`${base}/ad-config/recalc`, { config: cfg });
      setCfg(hydrate(data?.config));
      const s = data?.stats;
      message.success(
        s ? t("adSetup.recalcDone", { ok: s.ok, total: s.total }) : t("adSetup.saved"),
      );
    } catch (e: unknown) {
      message.error(readErrorMessage(e));
    } finally {
      setRecalculating(false);
    }
  };

  // Health of the uploaded samples: how many lack a pHash, and how many enabled logo entries can't
  // match at all (no sample with pHash AND no OCR text match configured).
  const sampleIssues = useMemo(() => {
    let missingPhash = 0;
    let dead = 0;
    (["logoAppearance", "logoDisappearance"] as const).forEach((key) => {
      const strat = cfg[key];
      if (!strat?.enabled) return;
      for (const inst of strat.instances) {
        const withPhash = inst.samples.filter((s) => (s.phash || "").length > 0).length;
        missingPhash += inst.samples.length - withPhash;
        const ocrOk = inst.ocr.enabled && inst.ocr.matchText.trim().length > 0;
        if (withPhash === 0 && !ocrOk) dead += 1;
      }
    });
    return { missingPhash, dead };
  }, [cfg]);

  // ---- mutation helpers -----------------------------------------------------------------------

  const patchLogo = (
    key: "logoAppearance" | "logoDisappearance",
    updater: (s: LogoStrategy) => LogoStrategy,
  ) => setCfg((c) => ({ ...c, [key]: updater(c[key]) }));

  const patchInstance = (
    key: "logoAppearance" | "logoDisappearance",
    instId: string,
    updater: (i: LogoInstance) => LogoInstance,
  ) =>
    patchLogo(key, (s) => ({
      ...s,
      instances: s.instances.map((i) => (i.id === instId ? updater(i) : i)),
    }));

  const uploadSample = async (file: File): Promise<Sample | null> => {
    const dataUrl = await fileToDataUrl(file);
    const { data } = await getAdminClient().post<{ sample: Sample }>(`${base}/ad-samples`, {
      imageBase64: dataUrl,
      contentType: file.type,
    });
    return data?.sample ?? null;
  };

  const deleteSampleObject = async (sample: Sample) => {
    try {
      await getAdminClient().delete(
        `${base}/ad-samples/${encodeURIComponent(sample.id)}?key=${encodeURIComponent(sample.s3Key)}`,
      );
    } catch {
      /* best-effort S3 cleanup; the descriptor is removed from the config regardless */
    }
  };

  const operatorOptions = useMemo(
    () => OPERATORS.map((op) => ({ value: op, label: t(`adSetup.op.${op}`) })),
    [t],
  );
  const textSourceOptions = useMemo(
    () => [
      { value: "original", label: t("adSetup.textOriginal") },
      { value: "translated", label: t("adSetup.textTranslated") },
    ],
    [t],
  );

  // ---- render: logo strategy (shared by appearance + disappearance) ---------------------------

  const renderLogoStrategy = (key: "logoAppearance" | "logoDisappearance") => {
    const strat = cfg[key];
    return (
      <Card
        size="small"
        title={
          <Space>
            <Switch
              checked={strat.enabled}
              onChange={(v) => patchLogo(key, (s) => ({ ...s, enabled: v }))}
            />
            <Typography.Text strong>{t(`adSetup.${key}`)}</Typography.Text>
          </Space>
        }
        extra={
          <Button
            size="small"
            onClick={() => patchLogo(key, (s) => ({ ...s, instances: [...s.instances, newLogoInstance()] }))}
          >
            {t("adSetup.addInstance")}
          </Button>
        }
        style={{ marginBottom: 16, opacity: strat.enabled ? 1 : 0.6 }}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t(`adSetup.${key}Hint`)}
        </Typography.Paragraph>
        {strat.instances.length === 0 ? (
          <Empty description={t("adSetup.noInstances")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          strat.instances.map((inst, idx) => (
            <div key={inst.id}>
              {idx > 0 && <Divider plain>{t("adSetup.or")}</Divider>}
              {renderLogoInstance(key, inst, idx)}
            </div>
          ))
        )}
      </Card>
    );
  };

  const renderLogoInstance = (
    key: "logoAppearance" | "logoDisappearance",
    inst: LogoInstance,
    idx: number,
  ) => {
    const uploadProps: UploadProps = {
      accept: "image/*",
      multiple: true,
      showUploadList: false,
      customRequest: async (opts) => {
        const { file, onSuccess, onError } = opts;
        try {
          const sample = await uploadSample(file as File);
          if (sample) {
            patchInstance(key, inst.id, (i) => ({ ...i, samples: [...i.samples, sample] }));
          }
          onSuccess?.({}, new XMLHttpRequest());
        } catch (e) {
          message.error(readErrorMessage(e));
          onError?.(e as Error);
        }
      },
    };

    const roiField = (label: string, field: keyof Roi) => (
      <Col xs={12} sm={6}>
        <Typography.Text style={{ fontSize: 12 }}>{label}</Typography.Text>
        <InputNumber
          min={0}
          max={100}
          value={Math.round(inst.roi[field] * 100)}
          onChange={(v) =>
            patchInstance(key, inst.id, (i) => ({
              ...i,
              roi: { ...i.roi, [field]: Math.min(1, Math.max(0, (Number(v) || 0) / 100)) },
            }))
          }
          addonAfter="%"
          style={{ width: "100%" }}
        />
      </Col>
    );

    return (
      <Card size="small" type="inner" title={`#${idx + 1}`} extra={
        <Popconfirm
          title={t("adSetup.removeInstanceConfirm")}
          okText={t("common.delete")}
          okButtonProps={{ danger: true }}
          cancelText={t("common.cancel")}
          onConfirm={() =>
            patchLogo(key, (s) => ({ ...s, instances: s.instances.filter((i) => i.id !== inst.id) }))
          }
        >
          <Button size="small" danger type="text">
            {t("common.delete")}
          </Button>
        </Popconfirm>
      }>
        {/* Sample images */}
        <Typography.Text strong style={{ fontSize: 12 }}>
          {t("adSetup.samples")}
        </Typography.Text>
        <Row gutter={[8, 8]} style={{ marginTop: 6, marginBottom: 12 }}>
          {inst.samples.map((s) => (
            <Col key={s.id} xs={8} sm={6} md={4}>
              <div style={{ border: "1px solid rgba(0,0,0,0.08)", borderRadius: 6, padding: 4 }}>
                <div style={{ background: "#0c0c0c", borderRadius: 4, minHeight: 48, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                  <img src={s.url} alt="sample" style={{ maxWidth: "100%", maxHeight: 90, display: "block" }} />
                </div>
                {s.ocrText ? (
                  <Typography.Text type="secondary" ellipsis style={{ fontSize: 10, display: "block" }} title={`${s.ocrText}${s.ocrTextEn ? ` → ${s.ocrTextEn}` : ""}`}>
                    {s.ocrText}
                  </Typography.Text>
                ) : null}
                <Button
                  size="small"
                  danger
                  type="text"
                  block
                  onClick={() => {
                    void deleteSampleObject(s);
                    patchInstance(key, inst.id, (i) => ({ ...i, samples: i.samples.filter((x) => x.id !== s.id) }));
                  }}
                >
                  {t("common.delete")}
                </Button>
              </div>
            </Col>
          ))}
          <Col xs={8} sm={6} md={4}>
            <Upload {...uploadProps}>
              <Button style={{ height: 90, width: "100%" }}>{t("adSetup.uploadSamples")}</Button>
            </Upload>
          </Col>
        </Row>

        {/* ROI */}
        <Typography.Text strong style={{ fontSize: 12 }}>
          {t("adSetup.roi")}
        </Typography.Text>
        <Row gutter={[8, 8]} style={{ marginTop: 6, marginBottom: 12 }}>
          {roiField(t("adSetup.roiPosX"), "x")}
          {roiField(t("adSetup.roiPosY"), "y")}
          {roiField(t("adSetup.roiWidth"), "w")}
          {roiField(t("adSetup.roiHeight"), "h")}
        </Row>

        {/* Hash sensitivity */}
        <Typography.Text strong style={{ fontSize: 12 }}>
          {t("adSetup.hashSensitivity")}: {inst.hashSensitivity}
        </Typography.Text>
        <Slider
          min={1}
          max={100}
          value={inst.hashSensitivity}
          onChange={(v) => patchInstance(key, inst.id, (i) => ({ ...i, hashSensitivity: v }))}
        />

        {/* OCR sub-option */}
        <Space style={{ marginTop: 8 }}>
          <Switch
            checked={inst.ocr.enabled}
            onChange={(v) => patchInstance(key, inst.id, (i) => ({ ...i, ocr: { ...i.ocr, enabled: v } }))}
          />
          <Typography.Text style={{ fontSize: 12 }}>{t("adSetup.ocrMatch")}</Typography.Text>
        </Space>
        {inst.ocr.enabled && (
          <Row gutter={[8, 8]} style={{ marginTop: 8 }}>
            <Col xs={24} sm={10}>
              <Input
                placeholder={t("adSetup.matchText")}
                value={inst.ocr.matchText}
                onChange={(e) => patchInstance(key, inst.id, (i) => ({ ...i, ocr: { ...i.ocr, matchText: e.target.value } }))}
              />
            </Col>
            <Col xs={12} sm={7}>
              <Select
                style={{ width: "100%" }}
                value={inst.ocr.textSource}
                options={textSourceOptions}
                onChange={(v: TextSource) => patchInstance(key, inst.id, (i) => ({ ...i, ocr: { ...i.ocr, textSource: v } }))}
              />
            </Col>
            <Col xs={12} sm={7}>
              <InputNumber
                min={1}
                max={100}
                value={inst.ocr.similarity}
                onChange={(v) => patchInstance(key, inst.id, (i) => ({ ...i, ocr: { ...i.ocr, similarity: Number(v) || 1 } }))}
                addonBefore={t("adSetup.similarity")}
                style={{ width: "100%" }}
              />
            </Col>
          </Row>
        )}
      </Card>
    );
  };

  // ---- render: OCR rules ----------------------------------------------------------------------

  const patchOcr = (updater: (s: OcrRulesStrategy) => OcrRulesStrategy) =>
    setCfg((c) => ({ ...c, ocrRules: updater(c.ocrRules) }));

  const patchGroup = (groupId: string, updater: (g: OcrGroup) => OcrGroup) =>
    patchOcr((s) => ({ ...s, groups: s.groups.map((g) => (g.id === groupId ? updater(g) : g)) }));

  const renderCondition = (group: OcrGroup, cond: OcrCondition, cIdx: number) => (
    <div key={cond.id}>
      {cIdx > 0 && <Divider plain style={{ margin: "8px 0" }}>{t("adSetup.and")}</Divider>}
      <Row gutter={[8, 8]} align="middle">
        <Col xs={12} sm={5}>
          <Select
            style={{ width: "100%" }}
            value={cond.op}
            options={operatorOptions}
            onChange={(v: OcrOp) =>
              patchGroup(group.id, (g) => ({
                ...g,
                conditions: g.conditions.map((c) => (c.id === cond.id ? { ...c, op: v } : c)),
              }))
            }
          />
        </Col>
        <Col xs={12} sm={cond.op === "between" ? 5 : 8}>
          <Input
            placeholder={t("adSetup.content")}
            value={cond.value}
            onChange={(e) =>
              patchGroup(group.id, (g) => ({
                ...g,
                conditions: g.conditions.map((c) => (c.id === cond.id ? { ...c, value: e.target.value } : c)),
              }))
            }
          />
        </Col>
        {cond.op === "between" && (
          <Col xs={12} sm={4}>
            <Input
              placeholder={t("adSetup.contentTo")}
              value={cond.value2}
              onChange={(e) =>
                patchGroup(group.id, (g) => ({
                  ...g,
                  conditions: g.conditions.map((c) => (c.id === cond.id ? { ...c, value2: e.target.value } : c)),
                }))
              }
            />
          </Col>
        )}
        {cond.op === "similarTo" && (
          <Col xs={12} sm={4}>
            <InputNumber
              min={1}
              max={100}
              value={cond.similarity}
              onChange={(v) =>
                patchGroup(group.id, (g) => ({
                  ...g,
                  conditions: g.conditions.map((c) => (c.id === cond.id ? { ...c, similarity: Number(v) || 1 } : c)),
                }))
              }
              addonBefore={t("adSetup.similarity")}
              style={{ width: "100%" }}
            />
          </Col>
        )}
        <Col xs={12} sm={5}>
          <Select
            style={{ width: "100%" }}
            value={cond.textSource}
            options={textSourceOptions}
            onChange={(v: TextSource) =>
              patchGroup(group.id, (g) => ({
                ...g,
                conditions: g.conditions.map((c) => (c.id === cond.id ? { ...c, textSource: v } : c)),
              }))
            }
          />
        </Col>
        <Col xs={12} sm={2}>
          <Button
            danger
            type="text"
            size="small"
            disabled={group.conditions.length <= 1}
            onClick={() =>
              patchGroup(group.id, (g) => ({ ...g, conditions: g.conditions.filter((c) => c.id !== cond.id) }))
            }
          >
            {t("common.delete")}
          </Button>
        </Col>
      </Row>
    </div>
  );

  const renderOcrRules = () => (
    <Card
      size="small"
      title={
        <Space>
          <Switch checked={cfg.ocrRules.enabled} onChange={(v) => patchOcr((s) => ({ ...s, enabled: v }))} />
          <Typography.Text strong>{t("adSetup.ocrRules")}</Typography.Text>
        </Space>
      }
      extra={
        <Button size="small" onClick={() => patchOcr((s) => ({ ...s, groups: [...s.groups, newGroup()] }))}>
          {t("adSetup.addGroup")}
        </Button>
      }
      style={{ marginBottom: 16, opacity: cfg.ocrRules.enabled ? 1 : 0.6 }}
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t("adSetup.ocrRulesHint")}
      </Typography.Paragraph>
      {cfg.ocrRules.groups.length === 0 ? (
        <Empty description={t("adSetup.noGroups")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        cfg.ocrRules.groups.map((group, gIdx) => (
          <div key={group.id}>
            {gIdx > 0 && <Divider plain>{t("adSetup.or")}</Divider>}
            <Card
              size="small"
              type="inner"
              title={`${t("adSetup.group")} ${gIdx + 1}`}
              extra={
                <Space>
                  <Button size="small" onClick={() => patchGroup(group.id, (g) => ({ ...g, conditions: [...g.conditions, newCondition()] }))}>
                    {t("adSetup.addCondition")}
                  </Button>
                  <Popconfirm
                    title={t("adSetup.removeGroupConfirm")}
                    okText={t("common.delete")}
                    okButtonProps={{ danger: true }}
                    cancelText={t("common.cancel")}
                    onConfirm={() => patchOcr((s) => ({ ...s, groups: s.groups.filter((g) => g.id !== group.id) }))}
                  >
                    <Button size="small" danger type="text">
                      {t("common.delete")}
                    </Button>
                  </Popconfirm>
                </Space>
              }
            >
              {group.conditions.map((cond, cIdx) => renderCondition(group, cond, cIdx))}
            </Card>
          </div>
        ))
      )}
    </Card>
  );

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 24 }}>
        <Spin />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Space>
          <Typography.Text strong>{t("adSetup.threshold")}: {cfg.threshold.toFixed(2)}</Typography.Text>
          <Slider
            min={0}
            max={1}
            step={0.05}
            value={cfg.threshold}
            onChange={(v) => setCfg((c) => ({ ...c, threshold: v }))}
            style={{ width: 220 }}
          />
        </Space>
        <Space>
          <Button onClick={() => void load()}>{t("streams.reload")}</Button>
          <Button loading={recalculating} onClick={() => void recalcPhash()}>
            {t("adSetup.recalcPhash")}
          </Button>
          <Button type="primary" loading={saving} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </Space>
      </div>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t("adSetup.thresholdHint")}
      </Typography.Paragraph>

      {(sampleIssues.missingPhash > 0 || sampleIssues.dead > 0) && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t("adSetup.warnTitle")}
          description={
            <div>
              {sampleIssues.missingPhash > 0 && (
                <div>{t("adSetup.warnMissingPhash", { count: sampleIssues.missingPhash })}</div>
              )}
              {sampleIssues.dead > 0 && (
                <div>{t("adSetup.warnDeadInstance", { count: sampleIssues.dead })}</div>
              )}
            </div>
          }
          action={
            <Button size="small" loading={recalculating} onClick={() => void recalcPhash()}>
              {t("adSetup.recalcPhash")}
            </Button>
          }
        />
      )}

      {renderLogoStrategy("logoAppearance")}
      {renderLogoStrategy("logoDisappearance")}
      {renderOcrRules()}
    </div>
  );
}

export default AdRecognitionSetupTab;
