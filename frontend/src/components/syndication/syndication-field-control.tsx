import { useState, type CSSProperties, type KeyboardEvent } from "react";
import type { SyndField } from "./syndication-settings-model";

type FieldControlProps = {
  field: SyndField;
  value: unknown;
  disabled?: boolean;
  onChange: (value: unknown) => void;
};

const inputStyle: CSSProperties = {
  width: "100%",
  maxWidth: 380,
  boxSizing: "border-box",
  height: 40,
  border: "1px solid #d5d9e0",
  borderRadius: 8,
  padding: "0 12px",
  font: "inherit",
  fontSize: 14,
  background: "#ffffff",
  color: "#2f3237",
};

/**
 * Renders one settings control (right grid cell) using the exact HTML mockup
 * styling. Field labels/help are rendered by the parent card.
 */
export function SyndicationFieldControl({ field, value, disabled, onChange }: FieldControlProps) {
  if (field.kind === "info") {
    return <span style={{ fontSize: 14, color: "#2f3237" }}>{field.value}</span>;
  }

  if (field.kind === "select") {
    return (
      <select
        disabled={disabled}
        value={(value as string) ?? field.default}
        onChange={(e) => onChange(e.target.value)}
        aria-label={field.label}
        style={{ ...inputStyle, padding: "0 10px" }}
      >
        {field.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  if (field.kind === "segment") {
    const current = (value as string) ?? field.default;
    return (
      <div
        role="radiogroup"
        aria-label={field.label}
        style={{
          display: "inline-flex",
          flexWrap: "wrap",
          gap: 4,
          padding: 3,
          background: "#f1f3f6",
          borderRadius: 9,
        }}
      >
        {field.options.map((opt) => {
          const on = opt === current;
          return (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onChange(opt)}
              style={{
                minHeight: 32,
                padding: "0 12px",
                border: 0,
                borderRadius: 7,
                background: on ? "#ffffff" : "transparent",
                color: on ? "#1f5ce0" : "#555b63",
                boxShadow: on ? "0 1px 3px rgba(16,24,40,.15)" : "none",
                font: "inherit",
                fontSize: 13,
                fontWeight: 500,
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.6 : 1,
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>
    );
  }

  if (field.kind === "toggle") {
    const on = value === true;
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={field.label}
        disabled={disabled}
        onClick={() => onChange(!on)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          border: 0,
          background: "transparent",
          padding: 0,
          font: "inherit",
          fontSize: 13,
          color: "#555b63",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span
          style={{
            width: 40,
            height: 22,
            borderRadius: 11,
            background: on ? "#1f5ce0" : "#c4cad3",
            display: "flex",
            alignItems: "center",
            padding: "0 3px",
            boxSizing: "border-box",
            justifyContent: on ? "flex-end" : "flex-start",
          }}
        >
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: "#ffffff",
              boxShadow: "0 1px 2px rgba(0,0,0,.25)",
            }}
          />
        </span>
        {on ? "On" : "Off"}
      </button>
    );
  }

  if (field.kind === "text") {
    return (
      <input
        type="text"
        disabled={disabled}
        value={(value as string) ?? field.default}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label={field.label}
        style={inputStyle}
      />
    );
  }

  if (field.kind === "textarea") {
    const text = ((value as string) ?? field.default) || "";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <textarea
          disabled={disabled}
          value={text}
          rows={Math.min(8, String(text).split("\n").length + 1)}
          onChange={(e) => onChange(e.target.value)}
          aria-label={field.label}
          style={{
            width: "100%",
            boxSizing: "border-box",
            border: "1px solid #d5d9e0",
            borderRadius: 8,
            padding: "9px 12px",
            font: "inherit",
            fontSize: 14,
            lineHeight: 1.5,
            resize: "vertical",
            background: "#ffffff",
            color: "#2f3237",
          }}
        />
        {field.tokens && field.tokens.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {field.tokens.map((tok) => (
              <button
                key={tok}
                type="button"
                disabled={disabled}
                onClick={() => onChange(`${text}${text && !text.endsWith(" ") ? " " : ""}${tok}`)}
                style={{
                  height: 24,
                  padding: "0 8px",
                  borderRadius: 6,
                  border: 0,
                  background: "#eef3fd",
                  color: "#1f5ce0",
                  fontSize: 12,
                  fontFamily: "ui-monospace, Menlo, monospace",
                  display: "inline-flex",
                  alignItems: "center",
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
              >
                {tok}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  // chips
  return (
    <ChipsControl
      field={field}
      value={Array.isArray(value) ? (value as string[]) : field.default}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

function ChipsControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: Extract<SyndField, { kind: "chips" }>;
  value: string[];
  disabled?: boolean;
  onChange: (value: unknown) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const next = draft.trim();
    if (!next || value.includes(next)) {
      setDraft("");
      return;
    }
    onChange([...value, next]);
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
        minHeight: 40,
        border: "1px solid #d5d9e0",
        borderRadius: 8,
        padding: "4px 8px",
        boxSizing: "border-box",
      }}
    >
      {value.map((chip) => (
        <span
          key={chip}
          style={{
            height: 28,
            padding: "0 6px 0 10px",
            borderRadius: 999,
            background: "#e3e9f5",
            color: "#1f3f86",
            fontSize: 13,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          {chip}
          {!disabled ? (
            <button
              type="button"
              aria-label={`Remove ${chip}`}
              onClick={() => onChange(value.filter((c) => c !== chip))}
              style={{
                width: 20,
                height: 20,
                border: 0,
                borderRadius: "50%",
                background: "transparent",
                color: "#1f3f86",
                font: "inherit",
                fontSize: 14,
                lineHeight: 1,
                padding: 0,
                cursor: "pointer",
              }}
            >
              ×
            </button>
          ) : null}
        </span>
      ))}
      <input
        type="text"
        disabled={disabled}
        value={draft}
        placeholder={field.placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
        aria-label={`Add to ${field.label}`}
        style={{
          flex: 1,
          minWidth: 90,
          height: 28,
          border: 0,
          outline: 0,
          background: "transparent",
          font: "inherit",
          fontSize: 13,
        }}
      />
    </div>
  );
}
