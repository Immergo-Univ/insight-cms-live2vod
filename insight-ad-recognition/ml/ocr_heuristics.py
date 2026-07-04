"""Keyword / regex heuristics that turn raw OCR text and boxes into the `ocr_*` profile fields.

These are intentionally simple and transparent so behavior is predictable and easy to tune.
"""

import re

# --- Keyword lexicons (lowercased) -----------------------------------------------------------
_CTA = [
    "call now", "buy now", "buy", "order", "subscribe", "visit", "shop", "sale", "save",
    "discount", "offer", "limited time", "today only", "free", "www.", "http", ".com", ".net",
    "download", "sign up", "learn more", "get yours", "hurry", "don't miss", "click",
    # Spanish
    "compre", "compra", "llame", "oferta", "descuento", "gratis", "ahora", "aprovecha",
    "suscrib", "visita", "promo",
]
_LEGAL = [
    "terms", "conditions", "apply", "restrictions", "warning", "disclaimer", "rights reserved",
    "see store", "may vary", "while supplies last", "*", "©", "™", "®",
    # Spanish
    "términos", "condiciones", "aplican", "consulte", "reservados",
]
_NEWS = [
    "breaking", "news", "live", "report", "update", "headlines", "weather", "forecast",
    "noticias", "última hora", "en vivo", "titulares",
]
_SPORTS = [
    "goal", "match", "final", "quarter", "half", "penalty", "score", "vs", "fc", "league",
    "cup", "gol", "partido", "tiempo", "marcador", "liga", "copa",
]
_CREDITS = [
    "directed by", "produced by", "written by", "starring", "cast", "executive producer",
    "screenplay", "music by", "edited by",
    "dirigida por", "producida por", "reparto", "guion",
]

_PRICE_RE = re.compile(r"(?:[$€£₪¥]\s?\d|(?:\d[\d.,]*)\s?(?:%|usd|eur|ils|nis))", re.IGNORECASE)
_BRAND_RE = re.compile(r"\b[A-Z][A-Z0-9&'.-]{2,}\b")  # ALL-CAPS token, brand-like


def _contains_any(text: str, words) -> bool:
    return any(w in text for w in words)


def analyze_text(joined_text: str) -> dict:
    """Return the boolean ocr_* cue fields from the aggregated OCR text of the window."""
    lower = joined_text.lower()
    return {
        "ocr_price": bool(_PRICE_RE.search(joined_text)),
        "ocr_brand": bool(_BRAND_RE.search(joined_text)) or _contains_any(lower, ["®", "™"]),
        "ocr_cta": _contains_any(lower, _CTA),
        "ocr_legal": _contains_any(lower, _LEGAL),
        "ocr_news": _contains_any(lower, _NEWS),
        "ocr_sports": _contains_any(lower, _SPORTS),
        "ocr_credits": _contains_any(lower, _CREDITS),
    }


def layout_flags(boxes_per_frame, img_w: int, img_h: int) -> dict:
    """Detect ticker / lower-third / corner-logo presence from OCR box geometry.

    boxes_per_frame: list of frames, each a list of boxes with keys x0,y0,x1,y1.
    """
    if img_w <= 0 or img_h <= 0:
        return {"ticker_present": False, "lower_third_present": False, "channel_logo_present": None}

    ticker_frames = 0
    lower_third_frames = 0
    corner_logo_frames = 0
    total_frames = max(1, len(boxes_per_frame))

    for boxes in boxes_per_frame:
        has_ticker = False
        has_lower_third = False
        has_corner = False
        for b in boxes:
            bw = (b["x1"] - b["x0"]) / img_w
            bh = (b["y1"] - b["y0"]) / img_h
            cy = ((b["y0"] + b["y1"]) / 2) / img_h
            cx = ((b["x0"] + b["x1"]) / 2) / img_w
            area = bw * bh

            # Ticker: wide, short band near the bottom.
            if bw >= 0.55 and bh <= 0.14 and cy >= 0.72:
                has_ticker = True
            # Lower third: text block in the lower third, not full width.
            if 0.6 <= cy <= 0.95 and 0.1 <= bw < 0.6:
                has_lower_third = True
            # Corner graphic/logo: small box in a corner region.
            if area <= 0.05 and (cx <= 0.2 or cx >= 0.8) and (cy <= 0.2 or cy >= 0.85):
                has_corner = True

        ticker_frames += 1 if has_ticker else 0
        lower_third_frames += 1 if has_lower_third else 0
        corner_logo_frames += 1 if has_corner else 0

    return {
        "ticker_present": ticker_frames / total_frames >= 0.5,
        "lower_third_present": lower_third_frames / total_frames >= 0.5,
        # Logo detection from OCR alone is weak; report True only if a corner mark is persistent.
        "channel_logo_present": (corner_logo_frames / total_frames >= 0.6)
        if corner_logo_frames > 0
        else None,
    }
