/*
 * HLS (m3u8) ad regions by absence of channel logo — single-file C tool.
 *
 * - Resolves master playlist (highest BANDWIDTH) via libcurl.
 * - Loads logo-detector-features output: output/<channel_id>.json + <channel_id>_logo.jpg
 * - One frame every 10 s; ffmpeg uses -i then -ss for accurate timeline (not keyframe-only input seek).
 * - Template match = max( TM_CCOEFF_NORMED on luma , same on Sobel magnitude ) per variant; best over variants.
 * - Use --logo-jpg / --alt-logo-jpg when the on-air bug differs from detector output/<id>_logo.jpg.
 * - Ads = hysteresis on samples where logo is absent.
 * - JSON includes media_timeline_zero_epoch_utc from the first #EXT-X-PROGRAM-DATE-TIME when present,
 *   so wall times = that epoch + start_media_seconds (URL startTime alone can drift vs FFmpeg demuxer t=0).
 *
 * Build:
 *   gcc -O2 -std=c11 -Wall -Wextra logo-template-matching.c -o logo-template-matching -lcurl -lm
 *
 * Usage:
 *   HLS/VOD: ./logo-template-matching <m3u8_url> <channel_id> [--max-seconds N] ...
 *   Single frame (stdout JSON): ./logo-template-matching <image.jpg|https://.../x.png> <channel_id> ...
 *     (not .m3u8); uses same detector JSON + template as HLS mode.
 *
 * Default detector dir: $LOGO_TM_DETECTOR_OUTPUT or <cwd>/../logo-detector-features/output
 * HLS output: ./output/ads/<channel_id>.json
 *
 * Requires: libcurl, ffmpeg, ffprobe in PATH.
 */

#define _GNU_SOURCE
#define _POSIX_C_SOURCE 200809L

#include <ctype.h>
#include <curl/curl.h>
#include <errno.h>
#include <limits.h>
#include <math.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

static const int kSampleIntervalSec = 10;
static const int kMinAbsentToOpen = 5;
static const int kMinPresentToClose = 2;
/* Lower threshold => more samples classified as logo present (fewer false “ad” gaps). */
static const double kDefaultMatchThreshold = 0.40;
/* Extra margin around scaled logo_bbox for sliding-window search (fraction of bbox w/h). */
static const double kDefaultSearchPadFrac = 0.50;
#define FFMPEG_CMD_CAP 16384
#define MAX_LOGO_VARIANTS 4

typedef struct {
  char *data;
  size_t len;
  size_t cap;
} DynBuf;

static void ltm_log(const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  fprintf(stderr, "[logo-template-matching] ");
  vfprintf(stderr, fmt, ap);
  fflush(stderr);
  va_end(ap);
}

static void dyn_init(DynBuf *b) {
  b->data = NULL;
  b->len = b->cap = 0;
}
static void dyn_free(DynBuf *b) {
  free(b->data);
  dyn_init(b);
}
static int dyn_app(DynBuf *b, const void *p, size_t n) {
  if (!n) return 0;
  size_t need = b->len + n;
  while (need > b->cap) {
    size_t nc = b->cap ? b->cap * 2 : 4096;
    if (nc < need) nc = need;
    char *nb = realloc(b->data, nc);
    if (!nb) return -1;
    b->data = nb;
    b->cap = nc;
  }
  memcpy(b->data + b->len, p, n);
  b->len = need;
  b->data[b->len] = '\0';
  return 0;
}

static size_t curl_cb(char *p, size_t sz, size_t n, void *u) {
  return dyn_app((DynBuf *)u, p, sz * n) ? 0 : sz * n;
}

static char *sdup(const char *s) {
  if (!s) return NULL;
  size_t n = strlen(s) + 1;
  char *p = malloc(n);
  if (p) memcpy(p, s, n);
  return p;
}

/* dir + '/' + name (name must not start with '/'); returns malloc'd string or NULL. */
static char *path_join(const char *dir, const char *name) {
  size_t a = strlen(dir);
  while (a && dir[a - 1] == '/') a--;
  size_t b = strlen(name);
  char *o = malloc(a + 1 + b + 1);
  if (!o) return NULL;
  memcpy(o, dir, a);
  o[a] = '/';
  memcpy(o + a + 1, name, b + 1);
  return o;
}

static void trim(char *s) {
  char *a = s;
  while (*a && isspace((unsigned char)*a)) a++;
  char *b = s + strlen(s);
  while (b > a && isspace((unsigned char)b[-1])) *--b = '\0';
  if (a != s) memmove(s, a, strlen(a) + 1);
}

static char *url_join(const char *base, const char *rel) {
  if (!rel || !*rel) return sdup(base);
  if (strncmp(rel, "http://", 7) == 0 || strncmp(rel, "https://", 8) == 0) return sdup(rel);
  size_t lb = strlen(base), lr = strlen(rel);
  int ns = (lb && base[lb - 1] != '/') ? 1 : 0;
  char *o = malloc(lb + ns + lr + 1);
  if (!o) return NULL;
  memcpy(o, base, lb);
  if (ns) o[lb++] = '/';
  memcpy(o + lb, rel, lr + 1);
  return o;
}

static int http_get(const char *url, DynBuf *out, char **err) {
  *err = NULL;
  CURL *c = curl_easy_init();
  if (!c) {
    *err = sdup("curl init");
    return -1;
  }
  curl_easy_setopt(c, CURLOPT_URL, url);
  curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, curl_cb);
  curl_easy_setopt(c, CURLOPT_WRITEDATA, out);
  curl_easy_setopt(c, CURLOPT_FOLLOWLOCATION, 1L);
  curl_easy_setopt(c, CURLOPT_TIMEOUT, 300L);
  CURLcode rc = curl_easy_perform(c);
  if (rc != CURLE_OK) {
    *err = sdup(curl_easy_strerror(rc));
    curl_easy_cleanup(c);
    return -1;
  }
  curl_easy_cleanup(c);
  return 0;
}

static int resolve_playlist(const char *start, DynBuf *text, char **resolved, char **err) {
  *err = NULL;
  *resolved = sdup(start);
  dyn_init(text);
  if (http_get(start, text, err) != 0) return -1;
  int master = 0;
  for (size_t i = 0; i + 17 < text->len; i++)
    if (strncmp(text->data + i, "#EXT-X-STREAM-INF", 17) == 0) {
      master = 1;
      break;
    }
  if (!master) return 0;
  ltm_log("master playlist: picking highest BANDWIDTH variant\n");
  char *base = sdup(start);
  char *sl = strrchr(base, '/');
  if (sl) *(sl + 1) = '\0';
  int best_bw = -1;
  char *best_uri = NULL;
  char *dup = sdup(text->data);
  char *save = NULL;
  for (char *line = strtok_r(dup, "\r\n", &save); line; line = strtok_r(NULL, "\r\n", &save)) {
    trim(line);
    if (strncmp(line, "#EXT-X-STREAM-INF:", 18) != 0) continue;
    int bw = 0;
    char *p = strstr(line, "BANDWIDTH=");
    if (p) bw = atoi(p + 10);
    char *next = strtok_r(NULL, "\r\n", &save);
    while (next && (*next == '#' || *next == '\0')) next = strtok_r(NULL, "\r\n", &save);
    if (!next || next[0] == '#') continue;
    trim(next);
    if (bw >= best_bw) {
      best_bw = bw;
      free(best_uri);
      best_uri = url_join(base, next);
    }
  }
  free(dup);
  free(base);
  if (!best_uri) {
    *err = sdup("master playlist has no variant");
    return -1;
  }
  dyn_free(text);
  if (http_get(best_uri, text, err) != 0) {
    free(best_uri);
    return -1;
  }
  free(*resolved);
  *resolved = best_uri;
  return 0;
}

/* First EXT-X-PROGRAM-DATE-TIME in media playlist → Unix UTC (demuxer t=0 aligns with this instant). */
static int parse_iso8601_utc_unix(const char *s, int64_t *out) {
  struct tm tmv;
  memset(&tmv, 0, sizeof tmv);
  const char *rest = strptime(s, "%Y-%m-%dT%H:%M:%S", &tmv);
  if (!rest) return -1;
  if (*rest == '.') {
    rest++;
    while (isdigit((unsigned char)*rest)) rest++;
  }
  if (*rest == 'Z')
    rest++;
  else if (strncmp(rest, "+00:00", 6) == 0)
    rest += 6;
  else
    return -1;
  if (*rest != '\0' && *rest != '\r' && *rest != '\n') return -1;
  tmv.tm_isdst = 0;
  time_t t = timegm(&tmv);
  if (t == (time_t)-1) return -1;
  *out = (int64_t)t;
  return 0;
}

static int m3u8_first_program_date_time_unix(const DynBuf *pl, int64_t *unix_out) {
  if (!pl || !pl->data || !unix_out) return -1;
  const char *tag = "#EXT-X-PROGRAM-DATE-TIME:";
  for (const char *p = pl->data; (p = strstr(p, tag)) != NULL;) {
    p += strlen(tag);
    const char *eol = strchr(p, '\n');
    size_t n = eol ? (size_t)(eol - p) : strlen(p);
    char buf[128];
    if (n >= sizeof buf) n = sizeof buf - 1;
    memcpy(buf, p, n);
    buf[n] = '\0';
    trim(buf);
    if (parse_iso8601_utc_unix(buf, unix_out) == 0) return 0;
    p = eol ? eol + 1 : p + strlen(p);
  }
  return -1;
}

/* Parse ?key= or &key= integer (e.g. startTime on streamPlaylist URL). */
static int url_query_param_int64(const char *url, const char *key, int64_t *out) {
  if (!url || !key || !out) return -1;
  char needle[80];
  int n = snprintf(needle, sizeof needle, "%s=", key);
  if (n <= 0 || n >= (int)sizeof needle) return -1;
  const char *p = url - 1;
  while ((p = strstr(p + 1, needle)) != NULL) {
    if (!(p == url || p[-1] == '?' || p[-1] == '&')) continue;
    const char *q = p + strlen(needle);
    char *end = NULL;
    long long v = strtoll(q, &end, 10);
    if (end == q) continue;
    *out = (int64_t)v;
    return 0;
  }
  return -1;
}

static int ffprobe_json_int(const char *j, const char *needle, int *v) {
  const char *p = strstr(j, needle);
  if (!p) return -1;
  p = strchr(p, ':');
  if (!p) return -1;
  p++;
  while (*p && (*p == ' ' || *p == '"')) p++;
  *v = atoi(p);
  return 0;
}

static int ffprobe_wh(const char *url, int *w, int *h, char **err) {
  *err = NULL;
  char cmd[PATH_MAX + 512];
  snprintf(cmd, sizeof cmd,
           "ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of json '%s' 2>/dev/null",
           url);
  FILE *fp = popen(cmd, "r");
  if (!fp) {
    *err = sdup("popen ffprobe");
    return -1;
  }
  DynBuf b;
  dyn_init(&b);
  char ln[400];
  while (fgets(ln, sizeof ln, fp)) dyn_app(&b, ln, strlen(ln));
  int st = pclose(fp);
  if (st != 0 || !b.data) {
    dyn_free(&b);
    *err = sdup("ffprobe failed");
    return -1;
  }
  int ok = ffprobe_json_int(b.data, "width", w) == 0 && ffprobe_json_int(b.data, "height", h) == 0;
  dyn_free(&b);
  if (!ok) {
    *err = sdup("ffprobe missing width/height");
    return -1;
  }
  return 0;
}

/* Returns 0 and *dur > 0 on success; -1 if unknown. */
static int ffprobe_duration_sec(const char *url, double *dur, char **err) {
  *err = NULL;
  *dur = 0;
  char cmd[PATH_MAX + 512];
  snprintf(cmd, sizeof cmd,
           "ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 '%s' "
           "2>/dev/null",
           url);
  FILE *fp = popen(cmd, "r");
  if (!fp) {
    *err = sdup("popen ffprobe duration");
    return -1;
  }
  char line[128];
  if (!fgets(line, sizeof line, fp)) {
    pclose(fp);
    *err = sdup("empty ffprobe duration");
    return -1;
  }
  pclose(fp);
  char *end = NULL;
  double v = strtod(line, &end);
  if (end == line || v <= 0 || v != v) /* NaN */ return -1;
  *dur = v;
  return 0;
}

static void scale_bbox(int x, int y, int w, int h, int ref_w, int ref_h, int frame_w, int frame_h, int *ox,
                       int *oy, int *ow, int *oh) {
  double sx = frame_w / (double)ref_w;
  double sy = frame_h / (double)ref_h;
  *ox = (int)llround(x * sx);
  *oy = (int)llround(y * sy);
  *ow = (int)llround(w * sx);
  *oh = (int)llround(h * sy);
  if (*ow < 1) *ow = 1;
  if (*oh < 1) *oh = 1;
  if (*ox < 0) *ox = 0;
  if (*oy < 0) *oy = 0;
  if (*ox >= frame_w) *ox = frame_w - 1;
  if (*oy >= frame_h) *oy = frame_h - 1;
  if (*ox + *ow > frame_w) *ow = frame_w - *ox;
  if (*oy + *oh > frame_h) *oh = frame_h - *oy;
}

static void expand_roi(int x, int y, int w, int h, int fw, int fh, double pad, int *sx, int *sy, int *sw,
                       int *sh) {
  int px = (int)fmax(2, w * pad);
  int py = (int)fmax(2, h * pad);
  int x0 = fmax(0, x - px);
  int y0 = fmax(0, y - py);
  int x1 = fmin(fw, x + w + px);
  int y1 = fmin(fh, y + h + py);
  *sx = x0;
  *sy = y0;
  *sw = fmax(1, x1 - x0);
  *sh = fmax(1, y1 - y0);
}

/* Rec. 601 luma from BGR (OpenCV-style weights). */
static uint8_t bgr_to_gray_u8(uint8_t b, uint8_t g, uint8_t r) {
  return (uint8_t)(0.114 * (double)b + 0.587 * (double)g + 0.299 * (double)r + 0.5);
}

static void tpl_bgr_to_gray(const uint8_t *tpl_bgr, int tw, int th, uint8_t *tpl_gray) {
  for (int ty = 0; ty < th; ty++)
    for (int tx = 0; tx < tw; tx++) {
      int j = (ty * tw + tx) * 3;
      tpl_gray[ty * tw + tx] = bgr_to_gray_u8(tpl_bgr[j], tpl_bgr[j + 1], tpl_bgr[j + 2]);
    }
}

static void roi_bgr_to_gray(const uint8_t *frame_bgr, int fw, int fh, int rx, int ry, int rw, int rh,
                            uint8_t *roi_gray) {
  (void)fh;
  for (int y = 0; y < rh; y++)
    for (int x = 0; x < rw; x++) {
      int j = ((ry + y) * fw + (rx + x)) * 3;
      roi_gray[y * rw + x] = bgr_to_gray_u8(frame_bgr[j], frame_bgr[j + 1], frame_bgr[j + 2]);
    }
}

/* TM_CCOEFF_NORMED on single-channel ROI (template tw x th slides inside rw x rh). */
static double match_max_ccoeff_normed_gray(const uint8_t *roi, int rw, int rh, const uint8_t *tpl, int tw,
                                           int th) {
  if (tw >= rw || th >= rh) return 0;
  double best = -1;
  int n = tw * th;
  for (int y = 0; y + th <= rh; y++)
    for (int x = 0; x + tw <= rw; x++) {
      double sum_t = 0, sum_i = 0, sum_t2 = 0, sum_i2 = 0, sum_ti = 0;
      for (int ty = 0; ty < th; ty++)
        for (int tx = 0; tx < tw; tx++) {
          int ii = (y + ty) * rw + (x + tx);
          int ti = ty * tw + tx;
          double T = tpl[ti];
          double I = roi[ii];
          sum_t += T;
          sum_i += I;
          sum_t2 += T * T;
          sum_i2 += I * I;
          sum_ti += T * I;
        }
      double nch = (double)n;
      double mean_t = sum_t / nch;
      double mean_i = sum_i / nch;
      double num = sum_ti - nch * mean_t * mean_i;
      double den_t = sum_t2 - nch * mean_t * mean_t;
      double den_i = sum_i2 - nch * mean_i * mean_i;
      if (den_t <= 1e-9 || den_i <= 1e-9) continue;
      double corr = num / sqrt(den_t * den_i);
      if (corr > best) best = corr;
    }
  return best < 0 ? 0 : best;
}

static int read_file_all(const char *path, char **out, char **err) {
  *err = NULL;
  *out = NULL;
  FILE *fp = fopen(path, "rb");
  if (!fp) {
    *err = sdup("fopen json");
    return -1;
  }
  fseek(fp, 0, SEEK_END);
  long sz = ftell(fp);
  fseek(fp, 0, SEEK_SET);
  if (sz < 0 || sz > 10 * 1024 * 1024) {
    fclose(fp);
    *err = sdup("json size");
    return -1;
  }
  char *buf = malloc((size_t)sz + 1);
  if (!buf) {
    fclose(fp);
    *err = sdup("malloc");
    return -1;
  }
  if (fread(buf, 1, (size_t)sz, fp) != (size_t)sz) {
    fclose(fp);
    free(buf);
    *err = sdup("fread");
    return -1;
  }
  buf[sz] = '\0';
  fclose(fp);
  *out = buf;
  return 0;
}

/* Parse "key": number inside [start, end). */
static int ld_json_key_int_bounded(const char *start, const char *end, const char *key, int *v) {
  char pat[48];
  snprintf(pat, sizeof pat, "\"%s\"", key);
  const char *p = strstr(start, pat);
  if (!p || p >= end) return -1;
  const char *q = strchr(p + strlen(pat), ':');
  if (!q || q >= end) return -1;
  q++;
  *v = atoi(q);
  return 0;
}

static int ld_parse_logo_bbox(const char *j, int *bx, int *by, int *bw, int *bh) {
  const char *p = strstr(j, "\"logo_bbox\"");
  if (!p) return -1;
  p = strchr(p, '{');
  if (!p) return -1;
  p++;
  const char *end = strchr(p, '}');
  if (!end) return -1;
  if (ld_json_key_int_bounded(p, end, "x", bx) != 0) return -1;
  if (ld_json_key_int_bounded(p, end, "y", by) != 0) return -1;
  if (ld_json_key_int_bounded(p, end, "width", bw) != 0) return -1;
  if (ld_json_key_int_bounded(p, end, "height", bh) != 0) return -1;
  return 0;
}

static int ld_parse_reference_frame(const char *j, int *rw, int *rh) {
  const char *p = strstr(j, "\"reference_frame\"");
  if (!p) return -1;
  p = strchr(p, '{');
  if (!p) return -1;
  p++;
  const char *end = strchr(p, '}');
  if (!end) return -1;
  if (ld_json_key_int_bounded(p, end, "width", rw) != 0) return -1;
  if (ld_json_key_int_bounded(p, end, "height", rh) != 0) return -1;
  return 0;
}

static int ld_parse_proc_size(const char *j, int *pw, int *ph) {
  const char *p = strstr(j, "\"proc_size\"");
  if (!p) return -1;
  p = strchr(p, '{');
  if (!p) return -1;
  p++;
  const char *end = strchr(p, '}');
  if (!end) return -1;
  if (ld_json_key_int_bounded(p, end, "width", pw) != 0) return -1;
  if (ld_json_key_int_bounded(p, end, "height", ph) != 0) return -1;
  return 0;
}

static int ld_get_ref_dimensions(const char *j, int bx, int by, int bw, int bh, int *ref_w, int *ref_h) {
  if (ld_parse_reference_frame(j, ref_w, ref_h) == 0) return 0;
  int pw, ph;
  if (ld_parse_proc_size(j, &pw, &ph) != 0) return -1;
  if (bx >= 0 && by >= 0 && bx + bw <= pw && by + bh <= ph) {
    ltm_log("warning: no reference_frame in JSON; using detection.proc_size %dx%d\n", pw, ph);
    *ref_w = pw;
    *ref_h = ph;
    return 0;
  }
  return -1;
}

static int load_image_bgr_via_ffmpeg(const char *path, int *w, int *h, uint8_t **bgr, char **err) {
  *err = NULL;
  char cmd0[PATH_MAX + 256];
  snprintf(cmd0, sizeof cmd0,
           "ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of json '%s' 2>/dev/null",
           path);
  FILE *pf = popen(cmd0, "r");
  if (!pf) {
    *err = sdup("ffprobe image");
    return -1;
  }
  DynBuf jb;
  dyn_init(&jb);
  char ln[300];
  while (fgets(ln, sizeof ln, pf)) dyn_app(&jb, ln, strlen(ln));
  pclose(pf);
  if (ffprobe_json_int(jb.data, "width", w) != 0 || ffprobe_json_int(jb.data, "height", h) != 0) {
    dyn_free(&jb);
    *err = sdup("image dimensions");
    return -1;
  }
  dyn_free(&jb);
  char cmd1[PATH_MAX + 256];
  snprintf(cmd1, sizeof cmd1,
           "ffmpeg -nostdin -hide_banner -loglevel error -i '%s' -f rawvideo -pix_fmt bgr24 -", path);
  FILE *fp = popen(cmd1, "r");
  if (!fp) {
    *err = sdup("ffmpeg image");
    return -1;
  }
  size_t need = (size_t)(*w) * (*h) * 3;
  uint8_t *buf = malloc(need);
  if (!buf) {
    pclose(fp);
    *err = sdup("malloc tpl");
    return -1;
  }
  if (fread(buf, 1, need, fp) != need) {
    free(buf);
    pclose(fp);
    *err = sdup("incomplete image raw");
    return -1;
  }
  pclose(fp);
  *bgr = buf;
  return 0;
}

static int resize_tpl_to(uint8_t **bgr, int *w, int *h, int tw, int th, char **err) {
  *err = NULL;
  if (*w == tw && *h == th) return 0;
  uint8_t *out = malloc((size_t)tw * th * 3);
  if (!out) {
    *err = sdup("malloc resize");
    return -1;
  }
  for (int y = 0; y < th; y++)
    for (int x = 0; x < tw; x++) {
      int sx = x * (*w) / tw;
      int sy = y * (*h) / th;
      int si = (sy * (*w) + sx) * 3, di = (y * tw + x) * 3;
      out[di] = (*bgr)[si];
      out[di + 1] = (*bgr)[si + 1];
      out[di + 2] = (*bgr)[si + 2];
    }
  free(*bgr);
  *bgr = out;
  *w = tw;
  *h = th;
  return 0;
}

/* Sobel gradient magnitude (8-bit), borders zeroed. */
static void gray_to_sobel_mag_u8(const uint8_t *in, int w, int h, uint8_t *out) {
  memset(out, 0, (size_t)w * h);
  for (int y = 1; y < h - 1; y++) {
    for (int x = 1; x < w - 1; x++) {
      int gx = -1 * (int)in[(y - 1) * w + x - 1] + 1 * (int)in[(y - 1) * w + x + 1] + -2 * (int)in[y * w + x - 1] +
               2 * (int)in[y * w + x + 1] + -1 * (int)in[(y + 1) * w + x - 1] + 1 * (int)in[(y + 1) * w + x + 1];
      int gy = -1 * (int)in[(y - 1) * w + x - 1] + -2 * (int)in[(y - 1) * w + x] + -1 * (int)in[(y - 1) * w + x + 1] +
               1 * (int)in[(y + 1) * w + x - 1] + 2 * (int)in[(y + 1) * w + x] + 1 * (int)in[(y + 1) * w + x + 1];
      int m = (int)(sqrt((double)gx * gx + (double)gy * gy) + 0.5);
      if (m > 255) m = 255;
      out[y * w + x] = (uint8_t)m;
    }
  }
}

typedef struct {
  uint8_t *gray;
  uint8_t *edge;
} LogoVariant;

static void logo_variant_free(LogoVariant *v) {
  free(v->gray);
  free(v->edge);
  v->gray = v->edge = NULL;
}

static int load_logo_variant(const char *path, int ow, int oh, LogoVariant *dst, char **err) {
  *err = NULL;
  memset(dst, 0, sizeof(*dst));
  int tw = 0, th = 0;
  uint8_t *bgr = NULL;
  if (load_image_bgr_via_ffmpeg(path, &tw, &th, &bgr, err) != 0) return -1;
  if (resize_tpl_to(&bgr, &tw, &th, ow, oh, err) != 0) {
    free(bgr);
    return -1;
  }
  dst->gray = malloc((size_t)ow * oh);
  dst->edge = malloc((size_t)ow * oh);
  if (!dst->gray || !dst->edge) {
    logo_variant_free(dst);
    free(bgr);
    *err = sdup("malloc logo variant");
    return -1;
  }
  tpl_bgr_to_gray(bgr, ow, oh, dst->gray);
  free(bgr);
  gray_to_sobel_mag_u8(dst->gray, ow, oh, dst->edge);
  return 0;
}

static void find_ad_windows(const uint8_t *present, int n, int min_a, int min_p, int *nwin, int **starts,
                            int **ends) {
  *nwin = 0;
  *starts = *ends = NULL;
  int ad_on = 0;
  int ws = 0;
  int false_streak = 0, true_streak = 0;
  for (int k = 0; k < n; k++) {
    if (present[k]) {
      true_streak++;
      false_streak = 0;
      if (ad_on && true_streak >= min_p) {
        int end_idx = k - min_p;
        if (end_idx >= ws) {
          int *ns = realloc(*starts, (size_t)(*nwin + 1) * sizeof(int));
          int *ne = realloc(*ends, (size_t)(*nwin + 1) * sizeof(int));
          if (ns && ne) {
            *starts = ns;
            *ends = ne;
            (*starts)[*nwin] = ws;
            (*ends)[*nwin] = end_idx;
            (*nwin)++;
          }
        }
        ad_on = 0;
        true_streak = 0;
      }
    } else {
      false_streak++;
      true_streak = 0;
      if (!ad_on && false_streak >= min_a) {
        ws = k - min_a + 1;
        ad_on = 1;
        false_streak = 0;
      }
    }
  }
  if (ad_on) {
    int *ns = realloc(*starts, (size_t)(*nwin + 1) * sizeof(int));
    int *ne = realloc(*ends, (size_t)(*nwin + 1) * sizeof(int));
    if (ns && ne) {
      *starts = ns;
      *ends = ne;
      (*starts)[*nwin] = ws;
      (*ends)[*nwin] = n - 1;
      (*nwin)++;
    }
  }
}

static void jesc(const char *s, FILE *fp) {
  fputc('"', fp);
  for (; s && *s; s++) {
    if (*s == '"' || *s == '\\') fputc('\\', fp);
    fputc(*s, fp);
  }
  fputc('"', fp);
}

static int ascii_tolower_c(int c) {
  return (c >= 'A' && c <= 'Z') ? c + 32 : c;
}

static int ends_with_ignore_case(const char *s, const char *suffix) {
  size_t ls = strlen(s), lf = strlen(suffix);
  if (lf > ls) return 0;
  const char *a = s + ls - lf;
  for (; *suffix; a++, suffix++)
    if (ascii_tolower_c((unsigned char)*a) != ascii_tolower_c((unsigned char)*suffix)) return 0;
  return 1;
}

/* Copy s into out up to '?' for extension checks on URLs. */
static void path_before_query(const char *s, char *out, size_t nout) {
  size_t i = 0;
  for (; s[i] && s[i] != '?' && i + 1 < nout; i++) out[i] = s[i];
  out[i] = '\0';
}

static int path_looks_like_image_ext(const char *path_no_query) {
  return ends_with_ignore_case(path_no_query, ".jpg") ||
         ends_with_ignore_case(path_no_query, ".jpeg") ||
         ends_with_ignore_case(path_no_query, ".jpe") ||
         ends_with_ignore_case(path_no_query, ".png") ||
         ends_with_ignore_case(path_no_query, ".webp") ||
         ends_with_ignore_case(path_no_query, ".bmp");
}

/* True => first positional is an image file/URL, not an HLS playlist. */
static int input_is_single_frame_probe(const char *s) {
  if (strcasestr(s, ".m3u8") != NULL) return 0;
  if (strncmp(s, "http://", 7) == 0 || strncmp(s, "https://", 8) == 0) {
    char tmp[512];
    path_before_query(s, tmp, sizeof tmp);
    return path_looks_like_image_ext(tmp);
  }
  struct stat st;
  if (stat(s, &st) == 0 && S_ISREG(st.st_mode)) return 1;
  char tmp[PATH_MAX];
  path_before_query(s, tmp, sizeof tmp);
  return path_looks_like_image_ext(tmp);
}

/**
 * One image (local path or http(s) image URL): print one JSON object to stdout, stderr for logs.
 * Frees nothing on json_path_heap / logo_path_heap (caller frees).
 */
static int run_single_frame_probe(const char *frame_input, const char *channel_id, const char *json_path,
                                  const char *logo_path_default, double match_threshold, double search_pad_frac,
                                  const char *logo_jpg_override, const char **alt_logo_jpg, int n_alt_logo) {
  char *err = NULL;
  char *jtext = NULL;
  if (read_file_all(json_path, &jtext, &err) != 0) {
    fprintf(stderr, "JSON %s: %s\n", json_path, err ? err : "?");
    free(err);
    return 1;
  }
  free(err);
  err = NULL;

  int bx, by, bw, bh;
  if (ld_parse_logo_bbox(jtext, &bx, &by, &bw, &bh) != 0) {
    fprintf(stderr, "Invalid or missing logo_bbox in %s\n", json_path);
    free(jtext);
    return 1;
  }

  int ref_w, ref_h;
  if (ld_get_ref_dimensions(jtext, bx, by, bw, bh, &ref_w, &ref_h) != 0) {
    fprintf(stderr,
            "Add reference_frame to detector JSON or ensure logo_bbox fits detection.proc_size.\n");
    free(jtext);
    return 1;
  }

  uint8_t *frame = NULL;
  int fw = 0, fh = 0;
  if (load_image_bgr_via_ffmpeg(frame_input, &fw, &fh, &frame, &err) != 0) {
    fprintf(stderr, "Frame %s: %s\n", frame_input, err ? err : "?");
    free(err);
    free(jtext);
    return 1;
  }
  free(err);
  err = NULL;

  int ox, oy, ow, oh;
  scale_bbox(bx, by, bw, bh, ref_w, ref_h, fw, fh, &ox, &oy, &ow, &oh);
  int sx, sy, sw, sh;
  expand_roi(ox, oy, ow, oh, fw, fh, search_pad_frac, &sx, &sy, &sw, &sh);

  const char *primary_logo_path = logo_jpg_override ? logo_jpg_override : logo_path_default;
  const char *tpl_src[MAX_LOGO_VARIANTS];
  int n_tpl_src = 0;
  tpl_src[n_tpl_src++] = primary_logo_path;
  for (int a = 0; a < n_alt_logo; a++) {
    int dup = 0;
    for (int j = 0; j < n_tpl_src; j++)
      if (strcmp(alt_logo_jpg[a], tpl_src[j]) == 0) {
        dup = 1;
        break;
      }
    if (!dup && n_tpl_src < MAX_LOGO_VARIANTS) tpl_src[n_tpl_src++] = alt_logo_jpg[a];
  }

  LogoVariant variants[MAX_LOGO_VARIANTS];
  int n_variants = 0;
  for (int ti = 0; ti < n_tpl_src; ti++) {
    if (load_logo_variant(tpl_src[ti], ow, oh, &variants[n_variants], &err) != 0) {
      fprintf(stderr, "Logo image %s: %s\n", tpl_src[ti], err ? err : "?");
      free(err);
      for (int j = 0; j < n_variants; j++) logo_variant_free(&variants[j]);
      free(frame);
      free(jtext);
      return 1;
    }
    n_variants++;
    ltm_log("probe: loaded template variant %d/%d: %s\n", n_variants, n_tpl_src, tpl_src[ti]);
  }

  int tw0 = ow;
  int th0 = oh;
  uint8_t *roi_gray = malloc((size_t)sw * sh);
  uint8_t *roi_edge = malloc((size_t)sw * sh);
  if (!roi_gray || !roi_edge) {
    fprintf(stderr, "malloc roi\n");
    free(roi_gray);
    free(roi_edge);
    for (int j = 0; j < n_variants; j++) logo_variant_free(&variants[j]);
    free(frame);
    free(jtext);
    return 1;
  }

  roi_bgr_to_gray(frame, fw, fh, sx, sy, sw, sh, roi_gray);
  gray_to_sobel_mag_u8(roi_gray, sw, sh, roi_edge);

  double best = 0;
  int best_vi = 0;
  double best_luma = 0, best_sobel = 0;
  int skipped = (tw0 >= sw || th0 >= sh);
  if (!skipped) {
    for (int vi = 0; vi < n_variants; vi++) {
      double vg = match_max_ccoeff_normed_gray(roi_gray, sw, sh, variants[vi].gray, tw0, th0);
      double ve = match_max_ccoeff_normed_gray(roi_edge, sw, sh, variants[vi].edge, tw0, th0);
      double v = vg > ve ? vg : ve;
      if (v > best) {
        best = v;
        best_vi = vi;
        best_luma = vg;
        best_sobel = ve;
      }
    }
  }

  int logo_present = (!skipped && best >= match_threshold) ? 1 : 0;
  double conf_pct = best * 100.0;

  ltm_log("probe: match=%.4f threshold=%.2f logo_present=%d ROI %dx%d tpl %dx%d\n", best, match_threshold,
          logo_present, sw, sh, tw0, th0);

  FILE *out = stdout;
  fprintf(out, "{\n");
  fprintf(out, "  \"mode\": \"single_frame\",\n");
  fprintf(out, "  \"channel_id\": ");
  jesc(channel_id, out);
  fprintf(out, ",\n  \"source\": ");
  jesc(frame_input, out);
  fprintf(out, ",\n  \"logo\": %s,\n", logo_present ? "true" : "false");
  fprintf(out, "  \"logo_present\": %s,\n", logo_present ? "true" : "false");
  fprintf(out, "  \"match_score\": %.6f,\n", best);
  fprintf(out, "  \"confidence_percent\": %.4f,\n", conf_pct);
  fprintf(out, "  \"match_threshold\": %.6f,\n", match_threshold);
  fprintf(out, "  \"best_variant_index\": %d,\n", best_vi);
  fprintf(out, "  \"luma_score\": %.6f,\n", best_luma);
  fprintf(out, "  \"sobel_score\": %.6f,\n", best_sobel);
  fprintf(out, "  \"match_skipped\": %s,\n", skipped ? "true" : "false");
  fprintf(out, "  \"frame_width\": %d,\n  \"frame_height\": %d,\n", fw, fh);
  fprintf(out, "  \"search_roi_xywh\": [ %d, %d, %d, %d ],\n", sx, sy, sw, sh);
  fprintf(out, "  \"logo_bbox_on_stream_xywh\": [ %d, %d, %d, %d ],\n", ox, oy, ow, oh);
  fprintf(out, "  \"match_method\": \"max_variant_max_luma_or_Sobel_TM_CCOEFF_NORMED\"\n");
  fprintf(out, "}\n");
  fflush(out);

  free(roi_gray);
  free(roi_edge);
  for (int j = 0; j < n_variants; j++) logo_variant_free(&variants[j]);
  free(frame);
  free(jtext);
  return 0;
}

/* HH:MM:SS from media seconds (floored). For large timelines hours are not limited to two digits. */
static void fmt_hhmmss(double sec, char *buf, size_t nbuf) {
  if (nbuf < 12) {
    if (nbuf) buf[0] = '\0';
    return;
  }
  if (sec < 0) sec = 0;
  int64_t s = (int64_t)floor(sec + 1e-9);
  int64_t h = s / 3600;
  s %= 3600;
  int m = (int)(s / 60);
  int ss = (int)(s % 60);
  snprintf(buf, nbuf, "%02lld:%02d:%02d", (long long)h, m, ss);
}

/* RFC3339 UTC for sample log lines (int64_t unix seconds). */
static void format_unix_utc_iso(int64_t unix_sec, char *buf, size_t nbuf) {
  if (nbuf < 22) {
    if (nbuf) buf[0] = '\0';
    return;
  }
  time_t tt = (time_t)unix_sec;
  struct tm g;
  if (gmtime_r(&tt, &g) == NULL) {
    snprintf(buf, nbuf, "?");
    return;
  }
  strftime(buf, nbuf, "%Y-%m-%dT%H:%M:%SZ", &g);
}

static int ensure_dir(const char *path) {
  struct stat st;
  if (stat(path, &st) == 0) return S_ISDIR(st.st_mode) ? 0 : -1;
  if (mkdir(path, 0755) != 0 && errno != EEXIST) return -1;
  return 0;
}

static int ffmpeg_one_frame_bgr(const char *url, int t_sec, int fw, int fh, uint8_t *frame, char **err) {
  *err = NULL;
  char cmd[FFMPEG_CMD_CAP];
  /* -ss AFTER -i: timeline-accurate frame for VOD/HLS. -ss before -i jumps to keyframes and can land
   * before the target (e.g. always pre-logo in a short GOP clip). Slower but correct for ad detection. */
  snprintf(cmd, sizeof cmd,
           "ffmpeg -nostdin -hide_banner -loglevel error -i '%s' -ss %d -frames:v 1 -f rawvideo -pix_fmt "
           "bgr24 -",
           url, t_sec);
  FILE *fp = popen(cmd, "r");
  if (!fp) {
    *err = sdup("popen ffmpeg frame");
    return -1;
  }
  size_t need = (size_t)fw * fh * 3;
  size_t n = fread(frame, 1, need, fp);
  pclose(fp);
  if (n != need) {
    *err = sdup("short frame");
    return -1;
  }
  return 0;
}

static void print_usage(const char *prog) {
  fprintf(stderr,
          "Usage:\n"
          "  %s <m3u8_url> <channel_id> [options]     - HLS/VOD; writes output/ads/<id>.json\n"
          "  %s <image.jpg|image.png|https://.../x.jpg> <channel_id> [options] - one frame; JSON on stdout\n"
          "Options:\n"
          "  --max-seconds N\n"
          "  --detector-output DIR\n",
          prog, prog);
  fprintf(stderr,
          "  --threshold 0..1   (default %.2f; lower = more permissive logo-present)\n"
          "  --search-pad-frac F  ROI padding around bbox as fraction of w/h (default %.2f)\n"
          "  --logo-jpg PATH    (replace output/<id>_logo.jpg; use a crop from the SAME encoder you scan)\n"
          "  --alt-logo-jpg PATH (extra template; repeat up to %d×; score = max over variants × max(luma, Sobel))\n"
          "  Reads ../logo-detector-features/output/<channel_id>.json and <channel_id>_logo.jpg (or DIR).\n"
          "  Writes ./output/ads/<channel_id>.json (HLS only); single-frame mode writes JSON to stdout.\n",
          kDefaultMatchThreshold, kDefaultSearchPadFrac, MAX_LOGO_VARIANTS - 1);
}

int main(int argc, char **argv) {
  const char *m3u8 = NULL;
  const char *channel_id = NULL;
  const char *detector_dir_opt = NULL;
  double max_seconds = 0;
  int have_max = 0;
  double match_threshold = kDefaultMatchThreshold;
  double search_pad_frac = kDefaultSearchPadFrac;
  const char *logo_jpg_override = NULL;
  const char *alt_logo_jpg[MAX_LOGO_VARIANTS - 1];
  int n_alt_logo = 0;
  char *detector_root_alloc = NULL;
  char *json_path_heap = NULL;
  char *logo_path_heap = NULL;

  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--max-seconds") == 0 && i + 1 < argc) {
      max_seconds = strtod(argv[++i], NULL);
      have_max = 1;
    } else if (strcmp(argv[i], "--detector-output") == 0 && i + 1 < argc) {
      detector_dir_opt = argv[++i];
    } else if (strcmp(argv[i], "--threshold") == 0 && i + 1 < argc) {
      match_threshold = strtod(argv[++i], NULL);
      if (match_threshold < 0 || match_threshold > 1) {
        fprintf(stderr, "--threshold must be between 0 and 1\n");
        return 1;
      }
    } else if (strcmp(argv[i], "--search-pad-frac") == 0 && i + 1 < argc) {
      search_pad_frac = strtod(argv[++i], NULL);
      if (search_pad_frac < 0 || search_pad_frac > 1.5) {
        fprintf(stderr, "--search-pad-frac must be between 0 and 1.5\n");
        return 1;
      }
    } else if (strcmp(argv[i], "--logo-jpg") == 0 && i + 1 < argc) {
      logo_jpg_override = argv[++i];
    } else if (strcmp(argv[i], "--alt-logo-jpg") == 0 && i + 1 < argc) {
      if (n_alt_logo >= (int)(sizeof alt_logo_jpg / sizeof alt_logo_jpg[0])) {
        fprintf(stderr, "too many --alt-logo-jpg (max %zu)\n", sizeof alt_logo_jpg / sizeof alt_logo_jpg[0]);
        return 1;
      }
      alt_logo_jpg[n_alt_logo++] = argv[++i];
    } else if (argv[i][0] == '-') {
      fprintf(stderr, "Unknown option: %s\n", argv[i]);
      print_usage(argv[0]);
      return 1;
    } else if (!m3u8)
      m3u8 = argv[i];
    else if (!channel_id)
      channel_id = argv[i];
    else {
      print_usage(argv[0]);
      return 1;
    }
  }
  if (!m3u8 || !channel_id) {
    print_usage(argv[0]);
    return 1;
  }
  if (strlen(channel_id) > 256) {
    fprintf(stderr, "channel_id too long\n");
    return 1;
  }

  const char *detector_root = detector_dir_opt;
  if (!detector_root) {
    const char *env = getenv("LOGO_TM_DETECTOR_OUTPUT");
    if (env && *env)
      detector_root = env;
    else {
      char cwd[PATH_MAX];
      if (!getcwd(cwd, sizeof cwd)) {
        fprintf(stderr, "getcwd failed\n");
        return 1;
      }
      detector_root_alloc = path_join(cwd, "../logo-detector-features/output");
      if (!detector_root_alloc) {
        fprintf(stderr, "malloc detector path\n");
        return 1;
      }
      detector_root = detector_root_alloc;
    }
  }

  char fname_json[320];
  char fname_logo[320];
  snprintf(fname_json, sizeof fname_json, "%s.json", channel_id);
  snprintf(fname_logo, sizeof fname_logo, "%s_logo.jpg", channel_id);
  json_path_heap = path_join(detector_root, fname_json);
  logo_path_heap = path_join(detector_root, fname_logo);
  if (!json_path_heap || !logo_path_heap) {
    fprintf(stderr, "malloc paths\n");
    free(json_path_heap);
    free(logo_path_heap);
    free(detector_root_alloc);
    return 1;
  }
  const char *json_path = json_path_heap;

  if (input_is_single_frame_probe(m3u8)) {
    int pr = run_single_frame_probe(m3u8, channel_id, json_path, logo_path_heap, match_threshold,
                                    search_pad_frac, logo_jpg_override, alt_logo_jpg, n_alt_logo);
    free(json_path_heap);
    free(logo_path_heap);
    free(detector_root_alloc);
    return pr;
  }

  curl_global_init(CURL_GLOBAL_DEFAULT);

  DynBuf pl;
  char *resolved = NULL;
  char *err = NULL;
  if (resolve_playlist(m3u8, &pl, &resolved, &err) != 0) {
    fprintf(stderr, "Playlist: %s\n", err ? err : "?");
    free(err);
    free(json_path_heap);
    free(logo_path_heap);
    free(detector_root_alloc);
    curl_global_cleanup();
    return 1;
  }
  free(err);
  err = NULL;

  ltm_log("media playlist: %s\n", resolved);

  int64_t media_timeline_zero_epoch_utc = 0;
  int have_pdt_anchor = m3u8_first_program_date_time_unix(&pl, &media_timeline_zero_epoch_utc) == 0;
  if (have_pdt_anchor)
    ltm_log("timeline anchor: first EXT-X-PROGRAM-DATE-TIME → unix_utc=%lld\n",
            (long long)media_timeline_zero_epoch_utc);

  int64_t url_start_unix = 0;
  int have_url_start = url_query_param_int64(m3u8, "startTime", &url_start_unix) == 0;

  int fw, fh;
  if (ffprobe_wh(resolved, &fw, &fh, &err) != 0) {
    fprintf(stderr, "%s\n", err ? err : "ffprobe");
    free(err);
    free(json_path_heap);
    free(logo_path_heap);
    free(detector_root_alloc);
    free(resolved);
    dyn_free(&pl);
    curl_global_cleanup();
    return 1;
  }
  free(err);

  double dur = 0;
  if (ffprobe_duration_sec(resolved, &dur, &err) != 0) {
    free(err);
    err = NULL;
    if (!have_max || max_seconds <= 0) {
      fprintf(stderr,
              "Could not read duration; pass --max-seconds for live/open-ended HLS.\n");
      free(json_path_heap);
      free(logo_path_heap);
      free(detector_root_alloc);
      free(resolved);
      dyn_free(&pl);
      curl_global_cleanup();
      return 1;
    }
    dur = max_seconds;
    ltm_log("using --max-seconds=%.0f (no format duration)\n", dur);
  } else {
    if (have_max && max_seconds > 0 && max_seconds < dur) dur = max_seconds;
  }

  char *jtext = NULL;
  if (read_file_all(json_path, &jtext, &err) != 0) {
    fprintf(stderr, "JSON %s: %s\n", json_path, err ? err : "?");
    free(err);
    free(json_path_heap);
    free(logo_path_heap);
    free(detector_root_alloc);
    free(resolved);
    dyn_free(&pl);
    curl_global_cleanup();
    return 1;
  }
  free(err);

  int bx, by, bw, bh;
  if (ld_parse_logo_bbox(jtext, &bx, &by, &bw, &bh) != 0) {
    fprintf(stderr, "Invalid or missing logo_bbox in %s\n", json_path);
    free(jtext);
    free(json_path_heap);
    free(logo_path_heap);
    free(detector_root_alloc);
    free(resolved);
    dyn_free(&pl);
    curl_global_cleanup();
    return 1;
  }

  int ref_w, ref_h;
  if (ld_get_ref_dimensions(jtext, bx, by, bw, bh, &ref_w, &ref_h) != 0) {
    fprintf(stderr,
            "Add reference_frame to detector JSON or ensure logo_bbox fits detection.proc_size.\n");
    free(jtext);
    free(json_path_heap);
    free(logo_path_heap);
    free(detector_root_alloc);
    free(resolved);
    dyn_free(&pl);
    curl_global_cleanup();
    return 1;
  }

  int ox, oy, ow, oh;
  scale_bbox(bx, by, bw, bh, ref_w, ref_h, fw, fh, &ox, &oy, &ow, &oh);
  int sx, sy, sw, sh;
  expand_roi(ox, oy, ow, oh, fw, fh, search_pad_frac, &sx, &sy, &sw, &sh);

  const char *primary_logo_path = logo_jpg_override ? logo_jpg_override : logo_path_heap;
  const char *tpl_src[MAX_LOGO_VARIANTS];
  int n_tpl_src = 0;
  tpl_src[n_tpl_src++] = primary_logo_path;
  for (int a = 0; a < n_alt_logo; a++) {
    int dup = 0;
    for (int j = 0; j < n_tpl_src; j++)
      if (strcmp(alt_logo_jpg[a], tpl_src[j]) == 0) {
        dup = 1;
        break;
      }
    if (!dup && n_tpl_src < MAX_LOGO_VARIANTS) tpl_src[n_tpl_src++] = alt_logo_jpg[a];
  }

  LogoVariant variants[MAX_LOGO_VARIANTS];
  int n_variants = 0;
  for (int ti = 0; ti < n_tpl_src; ti++) {
    if (load_logo_variant(tpl_src[ti], ow, oh, &variants[n_variants], &err) != 0) {
      fprintf(stderr, "Logo image %s: %s\n", tpl_src[ti], err ? err : "?");
      free(err);
      err = NULL;
      for (int j = 0; j < n_variants; j++) logo_variant_free(&variants[j]);
      free(jtext);
      free(json_path_heap);
      free(logo_path_heap);
      free(detector_root_alloc);
      free(resolved);
      dyn_free(&pl);
      curl_global_cleanup();
      return 1;
    }
    n_variants++;
    ltm_log("loaded template variant %d/%d: %s\n", n_variants, n_tpl_src, tpl_src[ti]);
  }

  int tw0 = ow;
  int th0 = oh;

  int interval = kSampleIntervalSec;
  int num_samples = (int)ceil(dur / (double)interval);
  if (num_samples < 1) num_samples = 1;

  uint8_t *present = calloc((size_t)num_samples, 1);
  uint8_t *frame = malloc((size_t)fw * fh * 3);
  uint8_t *roi_gray = malloc((size_t)sw * sh);
  uint8_t *roi_edge = malloc((size_t)sw * sh);
  if (!present || !frame || !roi_gray || !roi_edge) {
    fprintf(stderr, "malloc\n");
    free(present);
    free(frame);
    free(roi_gray);
    free(roi_edge);
    for (int j = 0; j < n_variants; j++) logo_variant_free(&variants[j]);
    free(jtext);
    free(json_path_heap);
    free(logo_path_heap);
    free(detector_root_alloc);
    free(resolved);
    dyn_free(&pl);
    curl_global_cleanup();
    return 1;
  }
  for (int i = 0; i < num_samples; i++) present[i] = 1;

  ltm_log("video %dx%d ref %dx%d ROI %d,%d %dx%d tpl %dx%d variants=%d samples=%d every %ds threshold=%.2f "
          "(max luma/Sobel per variant, accurate seek)\n",
          fw, fh, ref_w, ref_h, sx, sy, sw, sh, tw0, th0, n_variants, num_samples, interval, match_threshold);

  /* Log wall_utc from playlist URL startTime + media_t only (ingest still may use PDT in JSON). */
  int64_t wall_time_anchor_utc = url_start_unix;
  int have_wall_time_utc = have_url_start;
  if (have_wall_time_utc)
    ltm_log("per-sample wall_utc = url startTime + media_t\n");

  for (int i = 0; i < num_samples; i++) {
    int t = i * interval;
    if (ffmpeg_one_frame_bgr(resolved, t, fw, fh, frame, &err) != 0) {
      ltm_log("t=%ds decode failed: %s — marking absent\n", t, err ? err : "?");
      if (have_wall_time_utc) {
        char wbuf[48];
        int64_t we = wall_time_anchor_utc + (int64_t)t;
        format_unix_utc_iso(we, wbuf, sizeof wbuf);
        ltm_log("       wall_utc=%s epoch=%lld\n", wbuf, (long long)we);
      }
      free(err);
      err = NULL;
      present[i] = 0;
      continue;
    }
    roi_bgr_to_gray(frame, fw, fh, sx, sy, sw, sh, roi_gray);
    gray_to_sobel_mag_u8(roi_gray, sw, sh, roi_edge);
    double best = 0;
    for (int vi = 0; vi < n_variants; vi++) {
      double vg = match_max_ccoeff_normed_gray(roi_gray, sw, sh, variants[vi].gray, tw0, th0);
      double ve = match_max_ccoeff_normed_gray(roi_edge, sw, sh, variants[vi].edge, tw0, th0);
      double v = vg > ve ? vg : ve;
      if (v > best) best = v;
    }
    present[i] = (best >= match_threshold) ? 1 : 0;
    ltm_log("t=%6ds match=%.3f present=%d\n", t, best, (int)present[i]);
    if (have_wall_time_utc) {
      char wbuf[48];
      int64_t we = wall_time_anchor_utc + (int64_t)t;
      format_unix_utc_iso(we, wbuf, sizeof wbuf);
      ltm_log("       wall_utc=%s epoch=%lld\n", wbuf, (long long)we);
    }
  }

  int nwin = 0, *ws = NULL, *we = NULL;
  find_ad_windows(present, num_samples, kMinAbsentToOpen, kMinPresentToClose, &nwin, &ws, &we);

  if (ensure_dir("output") != 0 || ensure_dir("output/ads") != 0) {
    fprintf(stderr, "mkdir output/ads failed\n");
    free(ws);
    free(we);
    free(present);
    free(frame);
    free(roi_gray);
    free(roi_edge);
    for (int j = 0; j < n_variants; j++) logo_variant_free(&variants[j]);
    free(jtext);
    free(json_path_heap);
    free(logo_path_heap);
    free(detector_root_alloc);
    free(resolved);
    dyn_free(&pl);
    curl_global_cleanup();
    return 1;
  }

  char out_path[PATH_MAX];
  snprintf(out_path, sizeof out_path, "output/ads/%s.json", channel_id);
  FILE *fp = fopen(out_path, "w");
  if (!fp) {
    fprintf(stderr, "fopen %s\n", out_path);
    free(ws);
    free(we);
    free(present);
    free(frame);
    free(roi_gray);
    free(roi_edge);
    for (int j = 0; j < n_variants; j++) logo_variant_free(&variants[j]);
    free(jtext);
    free(json_path_heap);
    free(logo_path_heap);
    free(detector_root_alloc);
    free(resolved);
    dyn_free(&pl);
    curl_global_cleanup();
    return 1;
  }

  fprintf(fp, "{\n");
  fprintf(fp, "  \"channel_id\": ");
  jesc(channel_id, fp);
  fprintf(fp, ",\n  \"input_playlist_url\": ");
  jesc(m3u8, fp);
  fprintf(fp, ",\n  \"media_playlist_url\": ");
  jesc(resolved, fp);
  fprintf(fp, ",\n  \"detector_json\": ");
  jesc(json_path, fp);
  fprintf(fp, ",\n  \"logo_template_path\": ");
  jesc(tpl_src[0], fp);
  fprintf(fp, ",\n  \"logo_template_paths\": [\n");
  for (int ti = 0; ti < n_tpl_src; ti++) {
    fprintf(fp, "    ");
    jesc(tpl_src[ti], fp);
    fprintf(fp, "%s\n", ti + 1 < n_tpl_src ? "," : "");
  }
  fprintf(fp, "  ],\n  \"reference_frame_wh\": [ %d, %d ],\n", ref_w, ref_h);
  fprintf(fp, "  \"video_size_wh\": [ %d, %d ],\n", fw, fh);
  fprintf(fp, "  \"search_roi_xywh\": [ %d, %d, %d, %d ],\n", sx, sy, sw, sh);
  fprintf(fp, "  \"logo_bbox_on_stream_xywh\": [ %d, %d, %d, %d ],\n", ox, oy, ow, oh);
  fprintf(fp, "  \"sample_interval_seconds\": %d,\n", interval);
  fprintf(fp, "  \"match_threshold\": %g,\n", match_threshold);
  fprintf(fp,
          "  \"match_method\": \"C_max_variant_max_luma_or_Sobel_TM_CCOEFF_NORMED_accurate_ffmpeg_seek\",\n");
  fprintf(fp, "  \"min_consecutive_absent_samples_to_open_ad\": %d,\n", kMinAbsentToOpen);
  fprintf(fp, "  \"min_consecutive_present_samples_to_close_ad\": %d,\n", kMinPresentToClose);
  fprintf(fp, "  \"scanned_duration_seconds\": %g,\n", dur);
  if (have_pdt_anchor)
    fprintf(fp, "  \"media_timeline_zero_epoch_utc\": %lld,\n", (long long)media_timeline_zero_epoch_utc);
  else
    fprintf(fp, "  \"media_timeline_zero_epoch_utc\": null,\n");
  fprintf(fp, "  \"ad_segments\": [\n");
  for (int i = 0; i < nwin; i++) {
    int a = ws[i], b = we[i];
    double start_s = a * (double)interval;
    double end_inc = b * (double)interval;
    double durs = (b - a + 1) * (double)interval;
    fprintf(fp, "    {\n");
    fprintf(fp, "      \"start_media_seconds\": %g,\n", start_s);
    fprintf(fp, "      \"end_media_seconds_inclusive\": %g,\n", end_inc);
    fprintf(fp, "      \"duration_media_seconds\": %g,\n", durs);
    /* end_hhmmss = exclusive boundary (first instant after this ad block), same as start + duration. */
    char hs[32], he[32];
    fmt_hhmmss(start_s, hs, sizeof hs);
    fmt_hhmmss(start_s + durs, he, sizeof he);
    fprintf(fp, "      \"start_hhmmss\": \"%s\",\n", hs);
    fprintf(fp, "      \"end_hhmmss\": \"%s\",\n", he);
    fprintf(fp, "      \"start_sample_index\": %d,\n", a);
    fprintf(fp, "      \"end_sample_index\": %d\n", b);
    fprintf(fp, "    }%s\n", i + 1 < nwin ? "," : "");
  }
  fprintf(fp, "  ]\n}\n");
  fclose(fp);

  ltm_log("wrote %s (%d ad segment(s))\n", out_path, nwin);

  free(ws);
  free(we);
  free(present);
  free(frame);
  free(roi_gray);
  free(roi_edge);
  for (int j = 0; j < n_variants; j++) logo_variant_free(&variants[j]);
  free(jtext);
  free(json_path_heap);
  free(logo_path_heap);
  free(detector_root_alloc);
  free(resolved);
  dyn_free(&pl);
  curl_global_cleanup();
  return 0;
}
