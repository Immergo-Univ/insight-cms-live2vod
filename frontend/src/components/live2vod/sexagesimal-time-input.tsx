import { useCallback, useRef, useState } from "react";
import { cx } from "@/utils/cx";

export interface SexagesimalTimeInputProps {
  /** Exactly four digit characters `0-9` (HHMM, 24h). */
  value: string;
  onChange: (nextFourDigits: string) => void;
  id?: string;
  "aria-labelledby"?: string;
  className?: string;
}

/** Map caret (0..5) in "HH:MM" string to digit slot 0..3 or past end (no extra digits). */
function caretToDigitIndex(caret: number): number | "end" {
  if (caret >= 5) return "end";
  if (caret <= 0) return 0;
  if (caret === 1) return 1;
  if (caret === 2) return 2;
  if (caret === 3) return 2;
  return 3;
}

function caretAfterTypingDigit(digitIndex: number): number {
  if (digitIndex <= 0) return 1;
  if (digitIndex === 1) return 3;
  if (digitIndex === 2) return 4;
  return 5;
}

function arrowLeft(caret: number): number {
  if (caret <= 0) return 0;
  if (caret === 1) return 0;
  if (caret === 2) return 1;
  if (caret === 3) return 1;
  if (caret === 4) return 3;
  if (caret === 5) return 4;
  return Math.max(0, caret - 1);
}

function arrowRight(caret: number): number {
  if (caret >= 5) return 5;
  if (caret === 0) return 1;
  if (caret === 1) return 3;
  if (caret === 2) return 3;
  if (caret === 3) return 4;
  if (caret === 4) return 5;
  return 5;
}

function trySetDigit(four: string, index: number, digitChar: string): string | null {
  if (four.length !== 4 || index < 0 || index > 3) return null;
  const arr = four.split("");
  arr[index] = digitChar;
  const next = arr.join("");
  const hh = parseInt(next.slice(0, 2), 10);
  const mm = parseInt(next.slice(2, 4), 10);
  if (hh > 23 || mm > 59) return null;
  return next;
}

function caretBeforeDigit(d: number): number {
  if (d <= 0) return 0;
  if (d === 1) return 1;
  if (d === 2) return 3;
  return 4;
}

/** Clear the rightmost non-zero digit; repeat backspace walks left (minutes ones → … → hour tens). */
function applyBackspaceRightToLeft(four: string): { next: string; caret: number } | null {
  if (four.length !== 4) return null;
  const arr = four.split("");
  for (let i = 3; i >= 0; i--) {
    if (arr[i] !== "0") {
      arr[i] = "0";
      return { next: arr.join(""), caret: caretBeforeDigit(i) };
    }
  }
  return null;
}

function parsePastedTime(text: string): string | null {
  const digits = text.replace(/\D/g, "").slice(0, 4);
  if (digits.length !== 4) return null;
  const hh = parseInt(digits.slice(0, 2), 10);
  const mm = parseInt(digits.slice(2, 4), 10);
  if (hh > 23 || mm > 59) return null;
  return digits;
}

/** Which digit (0–3) shows the active underline (caret at end uses last digit — no separate vertical bar). */
function caretToUnderlineSlot(caret: number): number {
  if (caret >= 5) return 3;
  if (caret <= 0) return 0;
  if (caret === 1) return 1;
  if (caret === 2 || caret === 3) return 2;
  return 3;
}

/** Caret position when user clicks digit slot `digitIndex` (0–3). */
function caretFromDigitClick(digitIndex: number): number {
  if (digitIndex <= 0) return 0;
  if (digitIndex === 1) return 1;
  if (digitIndex === 2) return 3;
  return 4;
}

const TIME_TEXT = "font-mono text-sm tabular-nums leading-none";

function DigitCell({
  digit,
  active,
  onPickCaret,
}: {
  digit: string;
  active: boolean;
  onPickCaret: () => void;
}) {
  return (
    <span
      role="button"
      onPointerDown={(e) => {
        e.preventDefault();
        onPickCaret();
      }}
      className="relative inline-block w-[1.05rem] shrink-0 cursor-text select-none text-center outline-none"
    >
      <span className={cx("text-primary", TIME_TEXT)}>{digit}</span>
      <span
        className={cx(
          "pointer-events-none absolute top-full left-1/2 mt-0.5 h-0.5 w-[0.8rem] -translate-x-1/2 rounded-full",
          active ? "bg-brand-solid" : "bg-transparent",
        )}
        style={
          active
            ? {
                animation: "sexagesimal-caret-blink 1s step-end infinite",
              }
            : undefined
        }
        aria-hidden
      />
    </span>
  );
}

export function SexagesimalTimeInput({
  value,
  onChange,
  id,
  "aria-labelledby": ariaLabelledby,
  className,
}: SexagesimalTimeInputProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const caretRef = useRef(0);
  caretRef.current = caret;

  const four =
    value.length === 4 && /^\d{4}$/.test(value) ? value : "0000";
  const display = `${four.slice(0, 2)}:${four.slice(2, 4)}`;

  const applyDigitAtCaret = useCallback(
    (digitChar: string) => {
      const c = caretRef.current;
      const digitIndex = caretToDigitIndex(c);
      if (digitIndex === "end") return;
      const next = trySetDigit(four, digitIndex, digitChar);
      if (!next) return;
      const nextCaret = caretAfterTypingDigit(digitIndex);
      setCaret(nextCaret);
      onChange(next);
    },
    [four, onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const c = caretRef.current;

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setCaret(arrowLeft(c));
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setCaret(arrowRight(c));
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      setCaret(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      setCaret(5);
      return;
    }

    if (e.key === "Backspace") {
      e.preventDefault();
      const cleared = applyBackspaceRightToLeft(four);
      if (!cleared) return;
      setCaret(cleared.caret);
      onChange(cleared.next);
      return;
    }

    if (e.key >= "0" && e.key <= "9") {
      e.preventDefault();
      applyDigitAtCaret(e.key);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text");
    const parsed = parsePastedTime(text);
    if (!parsed) return;
    onChange(parsed);
    setCaret(5);
  };

  const slot = caretToUnderlineSlot(caret);
  const showCaret = isFocused;

  const pickDigit = (digitIndex: number) => {
    rootRef.current?.focus({ preventScroll: true });
    setCaret(caretFromDigitClick(digitIndex));
  };

  return (
    <>
      <style>{`
        @keyframes sexagesimal-caret-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
      `}</style>
      <div
        ref={rootRef}
        id={id}
        role="textbox"
        tabIndex={0}
        aria-labelledby={ariaLabelledby}
        aria-valuetext={display}
        onFocus={() => setIsFocused(true)}
        onBlur={(e) => {
          const next = e.relatedTarget as Node | null;
          if (!next || !e.currentTarget.contains(next)) {
            setIsFocused(false);
          }
        }}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        className={cx(
          "flex items-baseline gap-x-1 gap-y-0 rounded-lg border border-secondary bg-primary px-2.5 pb-2 pt-1.5 [caret-color:transparent] outline-none focus:border-brand-solid focus:ring-2 focus:ring-brand-solid/30",
          className,
        )}
      >
        <DigitCell
          digit={four[0]}
          active={showCaret && slot === 0}
          onPickCaret={() => pickDigit(0)}
        />
        <DigitCell
          digit={four[1]}
          active={showCaret && slot === 1}
          onPickCaret={() => pickDigit(1)}
        />
        <span
          className={cx("inline-block w-[0.45rem] shrink-0 select-none text-center text-tertiary", TIME_TEXT)}
          aria-hidden
        >
          :
        </span>
        <DigitCell
          digit={four[2]}
          active={showCaret && slot === 2}
          onPickCaret={() => pickDigit(2)}
        />
        <DigitCell
          digit={four[3]}
          active={showCaret && slot === 3}
          onPickCaret={() => pickDigit(3)}
        />
      </div>
    </>
  );
}
