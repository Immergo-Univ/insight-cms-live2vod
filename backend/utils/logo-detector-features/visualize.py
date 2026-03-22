"""
UMAP embedding, DBSCAN clustering, scatter plot with thumbnail markers.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime
from pathlib import Path

import cv2
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.offsetbox import AnnotationBbox, OffsetImage
from sklearn.cluster import DBSCAN
from sklearn.preprocessing import StandardScaler
import umap


def embed_umap(X: np.ndarray, random_state: int = 42) -> np.ndarray:
    n = X.shape[0]
    n_neighbors = min(15, max(2, n - 1))
    min_dist = 0.1
    reducer = umap.UMAP(
        n_components=2,
        n_neighbors=n_neighbors,
        min_dist=min_dist,
        metric="euclidean",
        random_state=random_state,
    )
    Xs = StandardScaler().fit_transform(X)
    return reducer.fit_transform(Xs)


def cluster_dbscan(embedding_2d: np.ndarray, eps: float = 0.45, min_samples: int = 5) -> np.ndarray:
    emb = StandardScaler().fit_transform(embedding_2d)
    return DBSCAN(eps=eps, min_samples=min_samples).fit_predict(emb)


def dominant_cluster_label(labels: np.ndarray) -> int | None:
    counts = Counter(int(l) for l in labels if int(l) >= 0)
    if not counts:
        return None
    return counts.most_common(1)[0][0]


# Larger source thumbs + higher plot DPI so exported PNG miniatures stay readable.
DEFAULT_THUMB_MAX_SIDE = 128
DEFAULT_FIGSIZE_INCHES = (22, 16)
DEFAULT_FIG_DPI = 200
DEFAULT_OFFSET_ZOOM = 0.72


def thumbnail_rgb(roi_bgr: np.ndarray, max_side: int = DEFAULT_THUMB_MAX_SIDE) -> np.ndarray:
    rgb = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2RGB)
    h, w = rgb.shape[:2]
    scale = min(max_side / h, max_side / w, 1.0)
    if scale < 1.0:
        rgb = cv2.resize(rgb, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return rgb


def save_scatter_thumbnails(
    xy: np.ndarray,
    thumbnails: list[np.ndarray],
    labels: np.ndarray,
    main_label: int | None,
    output_dir: Path,
    title: str = "Logo detector - UMAP + DBSCAN",
    detail_caption: str | None = None,
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d%H%M%S")
    out_path = output_dir / f"plot{stamp}.png"

    fig, ax = plt.subplots(figsize=DEFAULT_FIGSIZE_INCHES, dpi=DEFAULT_FIG_DPI)
    tab10 = [
        "#1f77b4",
        "#ff7f0e",
        "#2ca02c",
        "#d62728",
        "#9467bd",
        "#8c564b",
        "#e377c2",
        "#7f7f7f",
        "#bcbd22",
        "#17becf",
    ]

    for i, (x, y) in enumerate(xy):
        lab = int(labels[i])
        color = "#c0c0c0" if lab < 0 else tab10[lab % len(tab10)]
        ax.scatter([x], [y], c=[color], s=220, alpha=0.35, edgecolors="none")

    # Draw thumbnails on top (zoom scales raster into data coordinates)
    zoom = DEFAULT_OFFSET_ZOOM
    for i, (x, y) in enumerate(xy):
        thumb = thumbnails[i]
        if thumb.size == 0:
            continue
        oi = OffsetImage(thumb, zoom=zoom)
        ab = AnnotationBbox(
            oi,
            (float(x), float(y)),
            frameon=True,
            pad=0.02,
            bboxprops=dict(edgecolor="black", linewidth=0.3, alpha=0.5),
        )
        ax.add_artist(ab)

    ax.set_title(title)
    ax.set_xlabel("UMAP-1")
    ax.set_ylabel("UMAP-2")
    caption_lines: list[str] = []
    if main_label is not None:
        caption_lines.append(f"Main cluster (estimated logo): label {main_label}")
    if detail_caption:
        caption_lines.append(detail_caption)
    if caption_lines:
        ax.text(
            0.02,
            0.98,
            "\n".join(caption_lines),
            transform=ax.transAxes,
            va="top",
            ha="left",
            fontsize=11,
            bbox=dict(boxstyle="round", facecolor="white", alpha=0.85),
        )

    ax.grid(True, alpha=0.2)
    fig.tight_layout()
    fig.savefig(out_path, bbox_inches="tight", dpi=DEFAULT_FIG_DPI, facecolor="white")
    plt.close(fig)
    return out_path
