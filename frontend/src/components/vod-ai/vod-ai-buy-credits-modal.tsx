import { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { createCreditOrder, readApiError } from "@/services/ai-credits.service";
import type {
  AiServiceKey,
  CreditCatalog,
  CreditOrder,
  CreditOrderContactDetails,
  CreditOrderInvoiceDetails,
} from "@/types/ai-credits";
import { cx } from "@/utils/cx";
import { LockIcon, WarningIcon } from "./vod-ai-icons";

type Step = "choose" | "submitting" | "submitted" | "failed" | "contact" | "contactSent";

const VOLUME_OPTIONS = ["upTo100", "h100to500", "h500to2000", "over2000"] as const;
const BILLING_OPTIONS = ["monthlyInvoice", "annual", "purchaseOrder", "notSure"] as const;
const NEED_KEYS: AiServiceKey[] = ["stt", "subtitles", "article", "dubbing"];
const REACH_OPTIONS = ["email", "phone", "video"] as const;

const inputClass =
  "rounded-md border border-[#d5d9e0] bg-white px-2.5 py-2 text-sm font-normal text-[#2f3237] outline-none focus:border-[#0a3fb8]";
const primaryBtn =
  "inline-flex h-11 items-center justify-center gap-2 rounded-lg border-0 bg-[#0a3fb8] px-5 font-semibold text-white hover:bg-[#1f5ce0] disabled:cursor-not-allowed disabled:opacity-50";
const secondaryBtn =
  "inline-flex h-11 items-center justify-center rounded-lg border border-[#d5d9e0] bg-white px-[18px] font-medium text-[#2f3237] hover:border-[#1f5ce0] hover:bg-[#1f5ce0] hover:text-white";

export interface BuyCreditsModalProps {
  isOpen: boolean;
  onClose: () => void;
  catalog: CreditCatalog | null;
  balance: number;
  vodGuid?: string;
  /** Credits required by the action that triggered the dialog (shows the warning banner). */
  neededCredits?: number;
  neededFor?: string;
  onOrderCreated?: (order: CreditOrder) => void;
}

export function BuyCreditsModal({
  isOpen,
  onClose,
  catalog,
  balance,
  vodGuid,
  neededCredits,
  neededFor,
  onOrderCreated,
}: BuyCreditsModalProps) {
  const { t, i18n } = useTranslation("vodAi");
  const locale = i18n.language === "es" ? "es-AR" : "en-US";
  const fmt = (n: number) => Math.round(n).toLocaleString(locale);
  const money = (n: number) =>
    "$" +
    (Math.round(n * 100) / 100).toLocaleString(locale, {
      minimumFractionDigits: n % 1 ? 2 : 0,
      maximumFractionDigits: 2,
    });

  const packs = useMemo(() => catalog?.packs ?? [], [catalog]);
  const defaultPack = packs.find((p) => p.badge === "mostPopular")?.id ?? packs[0]?.id ?? "custom";
  const minCustom = catalog?.custom.minCredits ?? 0;

  const [step, setStep] = useState<Step>("choose");
  const [pack, setPack] = useState<string>(defaultPack);
  const [custom, setCustom] = useState<string>(String(minCustom || ""));
  const [invoice, setInvoice] = useState<CreditOrderInvoiceDetails>({});
  const [contact, setContact] = useState<CreditOrderContactDetails>({
    monthlyVolume: "upTo100",
    billingPreference: "monthlyInvoice",
    needs: ["stt", "article"],
    reachBy: "email",
  });
  const [order, setOrder] = useState<CreditOrder | null>(null);
  const [failReason, setFailReason] = useState("");
  const [contactSending, setContactSending] = useState(false);
  const [contactError, setContactError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setStep("choose");
    setPack(defaultPack);
    setCustom(String(minCustom || ""));
    setOrder(null);
    setFailReason("");
    setContactError("");
  }, [isOpen, defaultPack, minCustom]);

  const customN = Math.max(0, parseInt(custom.replace(/[^0-9]/g, ""), 10) || 0);
  const usdPerCredit = catalog?.custom.usdPerCredit ?? 0;
  const selectedPack = packs.find((p) => p.id === pack) ?? null;
  const selection =
    pack === "custom" || !selectedPack
      ? { name: t("buy.summary.customAmount"), credits: customN, price: customN * usdPerCredit }
      : { name: t("buy.summary.pack", { name: selectedPack.name }), credits: selectedPack.credits, price: selectedPack.priceUsd };
  const customInvalid = pack === "custom" && customN < minCustom;
  const sttRate = catalog?.creditsPerMinute.stt || 0;
  const dubRate = catalog?.creditsPerMinute.dubbing || 0;

  const errorText = (e: unknown) => {
    const { code, message } = readApiError(e);
    if (code && t(`errors.${code}`, { defaultValue: "" })) return t(`errors.${code}`);
    return message || t("errors.generic");
  };

  const submitOrder = async () => {
    if (customInvalid || selection.credits <= 0) return;
    setStep("submitting");
    try {
      const created = await createCreditOrder({
        kind: pack === "custom" ? "custom" : "pack",
        ...(pack === "custom" ? { credits: customN } : { packId: pack }),
        invoiceDetails: invoice,
        ...(vodGuid ? { vodGuid } : {}),
      });
      setOrder(created);
      setStep("submitted");
      onOrderCreated?.(created);
    } catch (e) {
      setFailReason(errorText(e));
      setStep("failed");
    }
  };

  const sendContact = async () => {
    setContactSending(true);
    setContactError("");
    try {
      const created = await createCreditOrder({
        kind: "enterprise",
        contactDetails: contact,
        invoiceDetails: invoice,
        ...(vodGuid ? { vodGuid } : {}),
      });
      setOrder(created);
      setStep("contactSent");
      onOrderCreated?.(created);
    } catch (e) {
      setContactError(errorText(e));
    } finally {
      setContactSending(false);
    }
  };

  const isContactFlow = step === "contact" || step === "contactSent";
  const stepIndex = step === "choose" ? 0 : step === "submitting" || step === "failed" ? 1 : 2;
  const title =
    step === "submitted"
      ? t("buy.titleSubmitted")
      : step === "failed"
        ? t("buy.titleFailed")
        : step === "contact"
          ? t("buy.titleContact")
          : step === "contactSent"
            ? t("buy.titleContactSent")
            : t("buy.title");
  const stepLabels = [t("buy.steps.choose"), t("buy.steps.approval"), t("buy.steps.done")];
  const toggleNeed = (k: AiServiceKey) =>
    setContact((c) => {
      const cur = c.needs ?? [];
      return { ...c, needs: cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k] };
    });

  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={(open) => !open && onClose()} isDismissable>
      <Modal className="max-w-[900px]">
        <Dialog aria-label={t("buy.title")}>
          <div className="w-full overflow-hidden rounded-xl bg-white text-sm text-[#2f3237] shadow-[0_24px_64px_rgba(10,20,40,.35)]">
            <div className="flex items-center gap-3 border-b border-[#e6e9ee] px-6 py-[18px]">
              <h2 className="m-0 text-lg font-semibold">{title}</h2>
              <span className="ml-auto" />
              {!isContactFlow ? (
                <ol aria-label={t("buy.stepsLabel")} className="m-0 hidden list-none items-center gap-1.5 p-0 text-[12.5px] sm:flex">
                  {stepLabels.map((label, i) => {
                    const done = i < stepIndex || step === "submitted";
                    const current = i === stepIndex && !done;
                    const failed = current && step === "failed";
                    return (
                      <li
                        key={label}
                        className={cx("flex items-center gap-1.5", current ? "font-semibold text-[#2f3237]" : "text-[#6b7079]")}
                      >
                        <span
                          className={cx(
                            "flex size-5 items-center justify-center rounded-full text-[11px] font-bold",
                            done
                              ? "bg-[#ecfaf3] text-[#0b7a47]"
                              : failed
                                ? "bg-[#fdecec] text-[#b42328]"
                                : current
                                  ? "bg-[#0a3fb8] text-white"
                                  : "bg-[#eef0f3] text-[#6b7079]",
                          )}
                        >
                          {done ? "✓" : i + 1}
                        </span>
                        {label}
                        {i < 2 ? <span className="ml-0.5 text-[#c9ced6]">›</span> : null}
                      </li>
                    );
                  })}
                </ol>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                aria-label={t("buy.close")}
                className="px-2 py-1.5 text-2xl leading-none text-[#6b7079] hover:text-[#2f3237]"
              >
                ×
              </button>
            </div>

            {step === "choose" ? (
              <div className="flex flex-col gap-[18px] px-6 py-[22px]">
                {neededCredits && neededCredits > balance ? (
                  <div className="flex items-center gap-3 rounded-lg bg-[#fff4e0] px-3.5 py-3 text-[#7a4a00]">
                    <WarningIcon className="size-5 shrink-0 text-[#b26a00]" />
                    <span className="flex-1">
                      <Trans
                        t={t}
                        i18nKey="buy.needCredits"
                        values={{ needed: fmt(neededCredits), service: neededFor ?? "", balance: fmt(balance) }}
                        components={{ b: <b /> }}
                      />
                    </span>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-3">
                  {packs.map((p) => {
                    const on = pack === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setPack(p.id)}
                        className={cx(
                          "relative flex min-w-0 flex-[1_1_220px] flex-col gap-1.5 rounded-[10px] border-2 p-4 text-left",
                          on ? "border-[#0a3fb8] bg-[#f3f7ff]" : "border-[#e6e9ee] bg-white hover:border-[#a9b4c6]",
                        )}
                      >
                        {p.badge ? (
                          <span className="absolute -top-[11px] right-3 rounded-full bg-[#0a3fb8] px-[9px] py-[3px] text-[11px] font-bold text-white">
                            {t(`buy.badges.${p.badge}`)}
                          </span>
                        ) : null}
                        <span className="font-semibold text-[#555b63]">{p.name}</span>
                        <span className="text-[26px] font-bold">{money(p.priceUsd)}</span>
                        <span className="font-semibold">{t("buy.credits", { credits: fmt(p.credits) })}</span>
                        <span className={cx("text-[12.5px] font-semibold", p.savePercent > 0 ? "text-[#0b7a47]" : "text-[#6b7079]")}>
                          {p.savePercent > 0 ? t("buy.save", { percent: p.savePercent }) : t("buy.standardPrice")}
                        </span>
                        <span className="mt-1 text-[12.5px] leading-normal text-[#6b7079]">
                          {sttRate > 0 ? t("buy.approxStt", { minutes: fmt(Math.floor(p.credits / sttRate)) }) : null}
                          <br />
                          {dubRate > 0 ? t("buy.approxDub", { minutes: fmt(Math.floor(p.credits / dubRate)) }) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-3.5 rounded-[10px] bg-[#0b2a6b] p-4 text-white">
                  <div className="min-w-0 flex-[1_1_320px]">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold">{t("buy.enterprise.title")}</span>
                      <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold">{t("buy.enterprise.badge")}</span>
                    </div>
                    <div className="mt-1 text-[13px] leading-normal text-[#c9d6f0]">
                      {t("buy.enterprise.desc", { credits: fmt(catalog?.enterpriseFromCredits ?? 0) })}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStep("contact")}
                    className="h-11 rounded-lg bg-white px-[18px] font-bold text-[#0b2a6b] hover:bg-[#dde6f7]"
                  >
                    {t("buy.enterprise.cta")}
                  </button>
                </div>

                <div
                  className={cx(
                    "flex flex-wrap items-center gap-3 rounded-[10px] border px-3.5 py-3",
                    pack === "custom" ? "border-[#0a3fb8]" : "border-[#e6e9ee]",
                  )}
                >
                  <label className="flex cursor-pointer items-center gap-2.5 font-semibold">
                    <input
                      type="radio"
                      name="credit-pack"
                      checked={pack === "custom"}
                      onChange={() => setPack("custom")}
                      className="size-[18px] accent-[#0a3fb8]"
                    />
                    {t("buy.custom.label")}
                  </label>
                  <input
                    value={custom}
                    onChange={(e) => {
                      setCustom(e.target.value);
                      setPack("custom");
                    }}
                    onFocus={() => setPack("custom")}
                    inputMode="numeric"
                    aria-label={t("buy.custom.inputLabel")}
                    className={cx(inputClass, "w-[130px]")}
                  />
                  <span className="text-[#6b7079]">
                    {t("buy.custom.equals")} <b className="text-[#2f3237]">{money(customN * usdPerCredit)}</b> ·{" "}
                    {t("buy.custom.hint", { min: fmt(minCustom) })}
                  </span>
                  {customInvalid ? (
                    <span className="w-full text-xs text-[#b42328]">{t("buy.custom.belowMin", { min: fmt(minCustom) })}</span>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-4">
                  <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-3">
                    <InvoiceFields invoice={invoice} onChange={setInvoice} />
                  </div>

                  <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-2.5 rounded-[10px] bg-[#f7f8fa] p-4">
                    <div className="flex justify-between gap-2">
                      <span className="text-[#6b7079]">{selection.name}</span>
                      <b>{t("buy.credits", { credits: fmt(selection.credits) })}</b>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-[#6b7079]">{t("buy.summary.balanceAfter")}</span>
                      <b>{fmt(balance + selection.credits)}</b>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-[#6b7079]">{t("buy.summary.tax")}</span>
                      <span className="text-right text-[#6b7079]">{t("buy.summary.taxValue")}</span>
                    </div>
                    <div className="h-px bg-[#e6e9ee]" />
                    <div className="flex items-baseline justify-between">
                      <span className="font-semibold">{t("buy.summary.total")}</span>
                      <span className="text-[22px] font-bold">{money(selection.price)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void submitOrder()}
                      disabled={customInvalid || selection.credits <= 0}
                      className={cx(primaryBtn, "h-12")}
                    >
                      <LockIcon className="size-4" />
                      {t("buy.submit")}
                    </button>
                    <div className="text-center text-xs leading-normal text-[#6b7079]">{t("buy.approvalNote")}</div>
                  </div>
                </div>
              </div>
            ) : null}

            {step === "submitting" ? (
              <div className="flex flex-col items-center gap-4 px-6 py-7 text-center">
                <div className="size-12 animate-spin rounded-full border-4 border-[#dde6f7] border-t-[#0a3fb8]" />
                <div className="text-[17px] font-semibold">{t("buy.submitting")}</div>
                <div className="max-w-[520px] leading-relaxed text-[#6b7079]">
                  <Trans
                    t={t}
                    i18nKey="buy.submittingBody"
                    values={{ credits: fmt(selection.credits), price: money(selection.price) }}
                    components={{ b: <b className="text-[#2f3237]" /> }}
                  />
                </div>
              </div>
            ) : null}

            {step === "submitted" && order ? (
              <div className="flex flex-col items-center gap-3.5 px-6 py-8 text-center">
                <div className="flex size-14 items-center justify-center rounded-full bg-[#ecfaf3] text-[28px] font-bold text-[#0b7a47]">✓</div>
                <div className="text-xl font-bold">{t("buy.submittedTitle", { number: order.orderNumber })}</div>
                <div className="max-w-[520px] leading-relaxed text-[#6b7079]">
                  {t("buy.submittedBody", { credits: fmt(order.credits), price: money(order.priceUsd) })}
                </div>
                <div className="text-[#6b7079]">
                  <Trans t={t} i18nKey="buy.currentBalance" values={{ balance: fmt(balance) }} components={{ b: <b className="text-[#2f3237]" /> }} />
                </div>
                <div className="mt-1.5 flex flex-wrap justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex h-[46px] items-center rounded-lg bg-[#1d8fc4] px-5 font-semibold text-white hover:bg-[#1f5ce0]"
                  >
                    {t("buy.backToActions")}
                  </button>
                </div>
              </div>
            ) : null}

            {step === "failed" ? (
              <div className="flex flex-col items-center gap-3.5 px-6 py-8 text-center">
                <div className="flex size-14 items-center justify-center rounded-full bg-[#fdecec] text-[28px] font-bold text-[#b42328]">!</div>
                <div className="text-xl font-bold">{t("buy.failedTitle")}</div>
                <div className="max-w-[480px] leading-relaxed text-[#6b7079]">
                  <Trans
                    t={t}
                    i18nKey="buy.failedBody"
                    values={{ reason: failReason, balance: fmt(balance) }}
                    components={{ b: <b className="text-[#2f3237]" /> }}
                  />
                </div>
                <div className="mt-1.5 flex flex-wrap justify-center gap-2.5">
                  <button type="button" onClick={() => void submitOrder()} className={cx(primaryBtn, "h-[46px]")}>
                    {t("buy.tryAgain")}
                  </button>
                  <button type="button" onClick={() => setStep("choose")} className={cx(secondaryBtn, "h-[46px]")}>
                    {t("buy.differentPack")}
                  </button>
                </div>
                {catalog?.salesEmail ? (
                  <a href={`mailto:${catalog.salesEmail}`} className="text-[13px] text-[#1f5ce0] no-underline hover:underline">
                    {t("buy.contactSupport")}
                  </a>
                ) : null}
              </div>
            ) : null}

            {step === "contact" ? (
              <div className="flex flex-wrap">
                <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-3.5 bg-[#f7f8fa] px-6 py-[22px]">
                  <div className="flex items-center gap-3">
                    <span className="flex size-12 flex-none items-center justify-center rounded-full bg-[#0b2a6b] font-bold text-white">CS</span>
                    <div>
                      <div className="font-bold">{t("buy.contact.teamName")}</div>
                      <div className="text-[13px] text-[#6b7079]">{t("buy.contact.teamRole")}</div>
                    </div>
                  </div>
                  <div className="text-[13.5px] leading-relaxed text-[#555b63]">{t("buy.contact.intro")}</div>
                  {catalog?.salesEmail ? (
                    <a href={`mailto:${catalog.salesEmail}`} className="text-[13.5px] font-semibold text-[#1f5ce0] no-underline hover:underline">
                      {catalog.salesEmail}
                    </a>
                  ) : null}
                  <div className="mt-auto rounded-lg border border-[#e6e9ee] bg-white p-3 text-[13px] leading-normal">
                    <div className="text-[#6b7079]">{t("buy.contact.yourAccount")}</div>
                    <div className="text-[#6b7079]">{t("buy.contact.accountBalance", { balance: fmt(balance) })}</div>
                  </div>
                </div>

                <div className="flex min-w-0 flex-[2_1_400px] flex-col gap-3.5 px-6 py-[22px]">
                  <div className="text-[17px] font-semibold">{t("buy.contact.formTitle")}</div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
                      {t("buy.contact.volume")}
                      <select
                        value={contact.monthlyVolume}
                        onChange={(e) => setContact((c) => ({ ...c, monthlyVolume: e.target.value }))}
                        className={cx(inputClass, "rounded-lg py-[9px]")}
                      >
                        {VOLUME_OPTIONS.map((o) => (
                          <option key={o} value={o}>
                            {t(`buy.contact.volumeOptions.${o}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
                      {t("buy.contact.billing")}
                      <select
                        value={contact.billingPreference}
                        onChange={(e) => setContact((c) => ({ ...c, billingPreference: e.target.value }))}
                        className={cx(inputClass, "rounded-lg py-[9px]")}
                      >
                        {BILLING_OPTIONS.map((o) => (
                          <option key={o} value={o}>
                            {t(`buy.contact.billingOptions.${o}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
                      {t("buy.contact.contactName")}
                      <input
                        value={contact.contactName ?? ""}
                        onChange={(e) => setContact((c) => ({ ...c, contactName: e.target.value }))}
                        className={cx(inputClass, "rounded-lg py-[9px]")}
                      />
                    </label>
                    <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
                      {t("buy.contact.contactEmail")}
                      <input
                        type="email"
                        value={contact.contactEmail ?? ""}
                        onChange={(e) => setContact((c) => ({ ...c, contactEmail: e.target.value }))}
                        className={cx(inputClass, "rounded-lg py-[9px]")}
                      />
                    </label>
                  </div>
                  <fieldset className="m-0 border-0 p-0">
                    <legend className="mb-2 text-[13px] font-semibold">{t("buy.contact.needs")}</legend>
                    <div className="flex flex-wrap gap-2">
                      {NEED_KEYS.map((k) => {
                        const on = (contact.needs ?? []).includes(k);
                        return (
                          <button
                            key={k}
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggleNeed(k)}
                            className={cx(
                              "h-[34px] rounded-full border px-3 text-[13px] font-medium",
                              on ? "border-[#0a3fb8] bg-[#dde6f7] text-[#0a3fb8]" : "border-[#d5d9e0] bg-white text-[#555b63]",
                            )}
                          >
                            {on ? "✓ " : ""}
                            {t(`services.${k}.name`)}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                  <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
                    {t("buy.contact.message")}
                    <textarea
                      rows={4}
                      value={contact.message ?? ""}
                      onChange={(e) => setContact((c) => ({ ...c, message: e.target.value }))}
                      placeholder={t("buy.contact.messagePlaceholder")}
                      className={cx(inputClass, "resize-y rounded-lg py-[9px]")}
                    />
                  </label>
                  <fieldset className="m-0 flex flex-wrap items-center gap-4 border-0 p-0">
                    <legend className="mb-2 text-[13px] font-semibold">{t("buy.contact.reachBy")}</legend>
                    {REACH_OPTIONS.map((o) => (
                      <label key={o} className="flex items-center gap-1.5">
                        <input
                          type="radio"
                          name="reach-by"
                          checked={contact.reachBy === o}
                          onChange={() => setContact((c) => ({ ...c, reachBy: o }))}
                          className="accent-[#0a3fb8]"
                        />
                        {t(`buy.contact.reach.${o}`)}
                      </label>
                    ))}
                  </fieldset>
                  {contact.reachBy === "phone" || contact.reachBy === "video" ? (
                    <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
                      {t("buy.contact.contactPhone")}
                      <input
                        type="tel"
                        value={contact.contactPhone ?? ""}
                        onChange={(e) => setContact((c) => ({ ...c, contactPhone: e.target.value }))}
                        className={cx(inputClass, "rounded-lg py-[9px]")}
                      />
                    </label>
                  ) : null}
                  {contactError ? <p className="m-0 text-xs text-[#b42328]">{contactError}</p> : null}
                  <div className="mt-1 flex flex-wrap gap-2.5">
                    <button type="button" onClick={() => setStep("choose")} className={secondaryBtn}>
                      {t("buy.contact.backToPacks")}
                    </button>
                    <button type="button" onClick={() => void sendContact()} disabled={contactSending} className={primaryBtn}>
                      {contactSending ? t("buy.contact.sending") : t("buy.contact.send")}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {step === "contactSent" ? (
              <div className="flex flex-col items-center gap-3.5 px-6 py-8 text-center">
                <div className="flex size-14 items-center justify-center rounded-full bg-[#ecfaf3] text-[28px] font-bold text-[#0b7a47]">✓</div>
                <div className="text-xl font-bold">{t("buy.contactSent.title")}</div>
                <div className="max-w-[480px] leading-relaxed text-[#6b7079]">
                  {t("buy.contactSent.body", { number: order?.orderNumber ?? "" })}
                </div>
                <div className="mt-1.5 flex flex-wrap justify-center gap-2.5">
                  <button type="button" onClick={() => setStep("choose")} className={cx(secondaryBtn, "h-[46px]")}>
                    {t("buy.contactSent.buyPack")}
                  </button>
                  <button type="button" onClick={onClose} className={cx(primaryBtn, "h-[46px]")}>
                    {t("buy.contactSent.backToClip")}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function InvoiceFields({
  invoice,
  onChange,
}: {
  invoice: CreditOrderInvoiceDetails;
  onChange: (next: CreditOrderInvoiceDetails) => void;
}) {
  const { t } = useTranslation("vodAi");
  const set = (k: keyof CreditOrderInvoiceDetails, v: string) => onChange({ ...invoice, [k]: v });
  return (
    <details className="rounded-[10px] border border-[#e6e9ee] px-3.5 py-3" open>
      <summary className="cursor-pointer font-semibold">{t("buy.invoice.title")}</summary>
      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-[13px] font-medium">
          {t("buy.invoice.companyName")}
          <input value={invoice.companyName ?? ""} onChange={(e) => set("companyName", e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium">
          {t("buy.invoice.taxId")}
          <input
            value={invoice.taxId ?? ""}
            placeholder={t("buy.invoice.taxIdPlaceholder")}
            onChange={(e) => set("taxId", e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="col-span-full flex flex-col gap-1.5 text-[13px] font-medium">
          {t("buy.invoice.billingEmail")}
          <input
            type="email"
            value={invoice.billingEmail ?? ""}
            placeholder={t("buy.invoice.billingEmailPlaceholder")}
            onChange={(e) => set("billingEmail", e.target.value)}
            className={inputClass}
          />
        </label>
      </div>
    </details>
  );
}
