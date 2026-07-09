"""Perceptual hashing (pHash) helpers built on the `imagehash` library.

Used to compare a frame's ROI crop against the stored logo/brand template samples. pHash is
size-invariant (imagehash resizes internally), so comparing a cropped ROI to a template image is
robust to scaling. Hashes are returned as hex strings; the Node side computes the Hamming distance.
"""

from PIL import Image

import imagehash


def _crop_roi(img: Image.Image, roi: dict | None) -> Image.Image:
    """Crop a normalized ROI ({x, y, w, h} in 0..1). Returns the whole image when roi is empty."""
    if not roi:
        return img
    w_img, h_img = img.size
    try:
        x = float(roi.get("x", 0.0))
        y = float(roi.get("y", 0.0))
        w = float(roi.get("w", 1.0))
        h = float(roi.get("h", 1.0))
    except (TypeError, ValueError):
        return img

    left = max(0, min(w_img, int(round(x * w_img))))
    top = max(0, min(h_img, int(round(y * h_img))))
    right = max(left + 1, min(w_img, int(round((x + w) * w_img))))
    bottom = max(top + 1, min(h_img, int(round((y + h) * h_img))))
    if right - left < 2 or bottom - top < 2:
        return img
    return img.crop((left, top, right, bottom))


def phash_hex(img: Image.Image, hash_size: int = 8) -> str:
    return str(imagehash.phash(img, hash_size=hash_size))


def phash_image(path: str, hash_size: int = 8) -> str:
    try:
        with Image.open(path) as im:
            return phash_hex(im.convert("RGB"), hash_size)
    except Exception:
        return ""


def phash_crop(path: str, roi: dict | None, hash_size: int = 8) -> str:
    try:
        with Image.open(path) as im:
            return phash_hex(_crop_roi(im.convert("RGB"), roi), hash_size)
    except Exception:
        return ""
