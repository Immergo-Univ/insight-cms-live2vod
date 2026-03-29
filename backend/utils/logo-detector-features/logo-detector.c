/*
 * HLS (m3u8) logo region detector — OpenCV + FFmpeg (libav).
 * Built as C++ from this .c file (see Makefile: -x c++).
 *
 * Usage:
 *   ./logo-detector <m3u8_url_or_path> <channel_id>
 *
 * HLS: parse m3u8, parallel segment fetch + keyframes (unchanged).
 * Logo detection: temporal mean/variance on a 32×32 grid at ~1280×704, stable mask,
 * connected components, scored with edge / color / sharpness / position (no SSIM),
 * then multi-sample Sobel + low temporal-variance mask to tighten the bbox.
 *
 * Outputs:
 *   ./samples/<channel_id>_sample_<n>.jpg (written then deleted after a successful run)
 *   ./output/<channel_id>_logo.jpg
 *   ./output/<channel_id>_debug.jpg (same full-frame sample as logo crop)
 *   ./output/<channel_id>.json
 */

#include <algorithm>
#include <atomic>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include <opencv2/core.hpp>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include <opencv2/features2d.hpp>

#include <climits>
#include <sys/stat.h>
#include <sys/types.h>

#include <curl/curl.h>

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/imgutils.h>
#include <libswscale/swscale.h>
}

namespace {

constexpr int kSamples = 100;

/* Detection pipeline (post-sampling): fixed “720p-class” grid + 32×32 temporal stats cells. */
constexpr int kProcW = 1280;
constexpr int kProcCell = 32;
constexpr int kProcH = (720 / kProcCell) * kProcCell; /* 704, multiple of cell */
constexpr double kPreBlurSigma = 1.0;
constexpr double kStableVarPercentile = 0.20;
constexpr double kMinLogoAreaPx = 500.0;
constexpr double kMaxLogoAreaFrac = 0.15;
constexpr int kBboxPadPx = 10;

/* Reject stable blobs with no structure (e.g. flat track/grass): must fail ALL three to skip. */
constexpr double kFlatEdgeDensityMax = 0.0045;
constexpr double kFlatColorStdMax = 9.0;
constexpr double kFlatLapVarMax = 120.0;

/* Sharper corner prior: exp(-alpha * dist^2) in normalized [0,1]^2 toward TR/BR corners. */
constexpr double kCornerPriorAlpha = 18.0;

/* Final region score weights (tuned: stability must not beat real logos over flat fields). */
constexpr double kW_stability = 1.15;
constexpr double kW_edge = 2.0;
constexpr double kW_color = 1.6;
constexpr double kW_sharp = 1.35;
constexpr double kW_pos = 2.35;
constexpr double kW_area = 1.0;
constexpr double kW_texture_gate = 2.8; /* subtract (1-texture)*this; texture = mean(edge_n,col_n,sharp_n) */

/* Tight bbox inside coarse ROI: mean Sobel over subsampled frames × temporal-low-var mask. */
constexpr int kRefineMaxSamples = 28;
constexpr double kRefineStaticVarPercentile = 0.42;
constexpr double kRefineMinCcAreaFrac = 0.0035;
constexpr double kRefineMaxCcAreaFrac = 0.93;
constexpr int kRefinePadPx = 2;

struct HlsSegment {
  double duration_sec = 0.0;
  std::string uri_rel;
};

static void trim_in_place(std::string& s) {
  while (!s.empty() && (s.back() == '\r' || s.back() == '\n' || s.back() == ' ' || s.back() == '\t')) {
    s.pop_back();
  }
  size_t i = 0;
  while (i < s.size() && (s[i] == ' ' || s[i] == '\t')) {
    ++i;
  }
  if (i > 0) {
    s.erase(0, i);
  }
}

static bool uri_has_scheme(const std::string& s) {
  return s.find("://") != std::string::npos;
}

static std::string parent_url_dir(const std::string& url) {
  size_t q = url.find_last_of('/');
  if (q == std::string::npos) {
    return url + "/";
  }
  return url.substr(0, q + 1);
}

static std::string resolve_hls_reference(const std::string& base_url, const std::string& ref) {
  if (ref.empty()) {
    return {};
  }
  if (uri_has_scheme(ref)) {
    return ref;
  }
  const std::string base = parent_url_dir(base_url);
  if (!ref.empty() && ref[0] == '/') {
    const size_t scheme = base.find("://");
    if (scheme == std::string::npos) {
      return ref;
    }
    const size_t host0 = scheme + 3;
    const size_t path0 = base.find('/', host0);
    if (path0 == std::string::npos) {
      return base + ref;
    }
    return base.substr(0, path0) + ref;
  }
  return base + ref;
}

static size_t curl_write_vector_cb(char* ptr, size_t size, size_t nmemb, void* userdata) {
  auto* out = static_cast<std::vector<uint8_t>*>(userdata);
  const size_t n = size * nmemb;
  out->insert(out->end(), reinterpret_cast<const uint8_t*>(ptr), reinterpret_cast<const uint8_t*>(ptr) + n);
  return n;
}

static bool read_file_all(const char* path, std::vector<uint8_t>& out) {
  out.clear();
  FILE* fp = std::fopen(path, "rb");
  if (!fp) {
    return false;
  }
  std::fseek(fp, 0, SEEK_END);
  const long len = std::ftell(fp);
  std::rewind(fp);
  if (len <= 0 || len > 512 * 1024 * 1024) {
    std::fclose(fp);
    return false;
  }
  out.resize(static_cast<size_t>(len));
  const size_t r = std::fread(out.data(), 1, out.size(), fp);
  std::fclose(fp);
  return r == out.size();
}

static bool http_fetch_bytes(const std::string& url, std::vector<uint8_t>& out, long* http_code) {
  out.clear();
  CURL* curl = curl_easy_init();
  if (!curl) {
    return false;
  }
  curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
  curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, curl_write_vector_cb);
  curl_easy_setopt(curl, CURLOPT_WRITEDATA, &out);
  curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
  curl_easy_setopt(curl, CURLOPT_MAXREDIRS, 20L);
  curl_easy_setopt(curl, CURLOPT_TIMEOUT, 180L);
  curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 25L);
  curl_easy_setopt(curl, CURLOPT_USERAGENT, "logo-detector/1.0");
  const CURLcode res = curl_easy_perform(curl);
  long code = 0;
  curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &code);
  curl_easy_cleanup(curl);
  if (http_code) {
    *http_code = code;
  }
  return res == CURLE_OK && code >= 200 && code < 300;
}

static bool load_uri_bytes(const char* uri, std::vector<uint8_t>& out, long* http_code) {
  const std::string s(uri);
  if (s.compare(0, 7, "file://") == 0) {
    return read_file_all(s.c_str() + 7, out);
  }
  if (!uri_has_scheme(s)) {
    return read_file_all(uri, out);
  }
  return http_fetch_bytes(s, out, http_code);
}

static bool parse_bandwidth_value(const std::string& line, int64_t* bw) {
  const size_t p = line.find("BANDWIDTH=");
  if (p == std::string::npos) {
    return false;
  }
  size_t q = p + 10;
  int64_t v = 0;
  while (q < line.size() && std::isdigit(static_cast<unsigned char>(line[q]))) {
    v = v * 10 + static_cast<int64_t>(line[q] - '0');
    ++q;
  }
  *bw = v;
  return true;
}

static bool stream_inf_uri_inline(const std::string& line, std::string* uri_out) {
  const size_t u = line.find("URI=\"");
  if (u == std::string::npos) {
    return false;
  }
  size_t a = u + 5;
  const size_t b = line.find('"', a);
  if (b == std::string::npos) {
    return false;
  }
  *uri_out = line.substr(a, b - a);
  return true;
}

static bool parse_master_variants(const std::string& text, std::vector<std::pair<int64_t, std::string>>* variants) {
  variants->clear();
  std::istringstream iss(text);
  std::string line;
  std::vector<std::string> lines;
  while (std::getline(iss, line)) {
    trim_in_place(line);
    if (!line.empty()) {
      lines.push_back(line);
    }
  }
  for (size_t i = 0; i < lines.size(); ++i) {
    if (lines[i].find("#EXT-X-STREAM-INF:") != 0) {
      continue;
    }
    int64_t bw = 0;
    (void)parse_bandwidth_value(lines[i], &bw);
    std::string uri;
    if (!stream_inf_uri_inline(lines[i], &uri)) {
      size_t j = i + 1;
      while (j < lines.size() && (lines[j][0] == '#' || lines[j].empty())) {
        ++j;
      }
      if (j >= lines.size() || lines[j][0] == '#') {
        continue;
      }
      uri = lines[j];
    }
    variants->push_back({bw, uri});
  }
  return !variants->empty();
}

static bool media_playlist_encrypted_or_segments(const std::string& text, bool* encrypted,
    std::vector<HlsSegment>* segs) {
  *encrypted = false;
  segs->clear();
  std::istringstream iss(text);
  std::string line;
  double pending_dur = 6.0;
  while (std::getline(iss, line)) {
    trim_in_place(line);
    if (line.empty()) {
      continue;
    }
    if (line.find("#EXT-X-KEY:") == 0) {
      if (line.find("METHOD=NONE") != std::string::npos) {
        continue;
      }
      if (line.find("METHOD=") != std::string::npos) {
        *encrypted = true;
      }
      continue;
    }
    if (line[0] == '#') {
      if (line.find("#EXTINF:") == 0) {
        const size_t colon = line.find(':');
        const size_t comma = line.find(',');
        std::string num = (comma == std::string::npos) ? line.substr(colon + 1)
                                                       : line.substr(colon + 1, comma - colon - 1);
        const double d = std::strtod(num.c_str(), nullptr);
        if (d > 0.0) {
          pending_dur = d;
        }
      }
      continue;
    }
    HlsSegment s;
    s.duration_sec = pending_dur;
    s.uri_rel = line;
    segs->push_back(std::move(s));
    pending_dur = 6.0;
  }
  return !segs->empty();
}

static bool resolve_playlist_to_media(const char* entry_url, std::string* media_text, std::string* media_url) {
  std::vector<uint8_t> raw;
  long code = 0;
  if (!load_uri_bytes(entry_url, raw, &code)) {
    return false;
  }
  std::string text(reinterpret_cast<const char*>(raw.data()), raw.size());
  if (text.find("#EXTM3U") == std::string::npos) {
    return false;
  }
  std::string cur_url = entry_url;
  for (int guard = 0; guard < 8; ++guard) {
    if (text.find("#EXT-X-STREAM-INF:") == std::string::npos) {
      *media_text = std::move(text);
      *media_url = cur_url;
      return true;
    }
    std::vector<std::pair<int64_t, std::string>> vars;
    if (!parse_master_variants(text, &vars)) {
      return false;
    }
    std::sort(vars.begin(), vars.end(),
        [](const std::pair<int64_t, std::string>& a, const std::pair<int64_t, std::string>& b) {
          return a.first > b.first;
        });
    const std::string next_abs = resolve_hls_reference(cur_url, vars[0].second);
    raw.clear();
    if (!load_uri_bytes(next_abs.c_str(), raw, &code)) {
      return false;
    }
    text.assign(reinterpret_cast<const char*>(raw.data()), raw.size());
    cur_url = next_abs;
    if (text.find("#EXTM3U") == std::string::npos) {
      return false;
    }
  }
  return false;
}

struct TsMemReader {
  const uint8_t* cur = nullptr;
  size_t rem = 0;
};

static int ts_mem_read_packet(void* opaque, uint8_t* buf, int buf_size) {
  auto* mr = static_cast<TsMemReader*>(opaque);
  if (buf_size <= 0 || mr->rem == 0) {
    return AVERROR_EOF;
  }
  const size_t n = std::min(static_cast<size_t>(buf_size), mr->rem);
  std::memcpy(buf, mr->cur, n);
  mr->cur += n;
  mr->rem -= n;
  return static_cast<int>(n);
}

static bool frame_is_intra(const AVFrame* fr) {
  if (fr->pict_type == AV_PICTURE_TYPE_I) {
    return true;
  }
#if defined(AV_FRAME_FLAG_KEY)
  if ((fr->flags & AV_FRAME_FLAG_KEY) != 0) {
    return true;
  }
#endif
  return false;
}

/* Convert frame to BGR without VideoDecoder (swscale cache via sws ref). */
static bool frame_to_bgr_standalone(AVFrame* frame, SwsContext*& sws, cv::Mat& out) {
  const int w = frame->width;
  const int h = frame->height;
  const AVPixelFormat src_pf = static_cast<AVPixelFormat>(frame->format);
  sws = sws_getCachedContext(
      sws, w, h, src_pf, w, h, AV_PIX_FMT_BGR24, SWS_BILINEAR, nullptr, nullptr, nullptr);
  if (!sws) {
    return false;
  }
  out.create(h, w, CV_8UC3);
  uint8_t* dst_data[1] = {out.data};
  int dst_linesize[1] = {static_cast<int>(out.step[0])};
  sws_scale(sws, frame->data, frame->linesize, 0, h, dst_data, dst_linesize);
  return true;
}

static bool ts_bytes_first_keyframe_bgr(const std::vector<uint8_t>& ts_data, cv::Mat& bgr) {
  bgr.release();
  if (ts_data.size() < 2048u) {
    return false;
  }
  TsMemReader mr;
  mr.cur = ts_data.data();
  mr.rem = ts_data.size();

  constexpr int kIoBuf = 64 * 1024;
  unsigned char* avio_buf =
      static_cast<unsigned char*>(av_malloc(kIoBuf + AV_INPUT_BUFFER_PADDING_SIZE));
  if (!avio_buf) {
    return false;
  }
  AVIOContext* avio =
      avio_alloc_context(avio_buf, kIoBuf, 0, &mr, &ts_mem_read_packet, nullptr, nullptr);
  if (!avio) {
    av_free(avio_buf);
    return false;
  }
  AVFormatContext* fmt = avformat_alloc_context();
  if (!fmt) {
    avio_context_free(&avio);
    return false;
  }
  fmt->pb = avio;
  fmt->flags |= AVFMT_FLAG_CUSTOM_IO;
  if (avformat_open_input(&fmt, "segment.ts", nullptr, nullptr) < 0) {
    avformat_close_input(&fmt);
    avio_context_free(&avio);
    return false;
  }
  fmt->probesize = static_cast<int64_t>(std::min<size_t>(ts_data.size(), 4u * 1024u * 1024u));
  fmt->max_analyze_duration = 1 * AV_TIME_BASE;
  if (avformat_find_stream_info(fmt, nullptr) < 0) {
    avformat_close_input(&fmt);
    avio_context_free(&avio);
    return false;
  }
  const int vindex = av_find_best_stream(fmt, AVMEDIA_TYPE_VIDEO, -1, -1, nullptr, 0);
  if (vindex < 0) {
    avformat_close_input(&fmt);
    avio_context_free(&avio);
    return false;
  }
  AVStream* vst = fmt->streams[vindex];
  const AVCodec* codec = avcodec_find_decoder(vst->codecpar->codec_id);
  if (!codec) {
    avformat_close_input(&fmt);
    avio_context_free(&avio);
    return false;
  }
  AVCodecContext* dec = avcodec_alloc_context3(codec);
  if (!dec) {
    avformat_close_input(&fmt);
    avio_context_free(&avio);
    return false;
  }
  if (avcodec_parameters_to_context(dec, vst->codecpar) < 0) {
    avcodec_free_context(&dec);
    avformat_close_input(&fmt);
    avio_context_free(&avio);
    return false;
  }
  dec->flags |= AV_CODEC_FLAG_LOW_DELAY;
  if (avcodec_open2(dec, codec, nullptr) < 0) {
    avcodec_free_context(&dec);
    avformat_close_input(&fmt);
    avio_context_free(&avio);
    return false;
  }
  SwsContext* sws = nullptr;
  AVPacket* pkt = av_packet_alloc();
  AVFrame* frame = av_frame_alloc();
  bool got_key = false;
  cv::Mat first_bgr;
  bool have_first = false;

  while (av_read_frame(fmt, pkt) >= 0) {
    if (pkt->stream_index != vindex) {
      av_packet_unref(pkt);
      continue;
    }
    if (avcodec_send_packet(dec, pkt) < 0) {
      av_packet_unref(pkt);
      break;
    }
    av_packet_unref(pkt);
    for (;;) {
      const int gr = avcodec_receive_frame(dec, frame);
      if (gr == AVERROR(EAGAIN) || gr == AVERROR_EOF) {
        break;
      }
      if (gr < 0) {
        break;
      }
      if (!have_first) {
        if (frame_to_bgr_standalone(frame, sws, first_bgr)) {
          have_first = true;
        }
      }
      if (frame_is_intra(frame)) {
        if (frame_to_bgr_standalone(frame, sws, bgr)) {
          got_key = true;
        }
        av_frame_unref(frame);
        goto done_decode;
      }
      av_frame_unref(frame);
    }
  }
  avcodec_send_packet(dec, nullptr);
  for (;;) {
    const int gr = avcodec_receive_frame(dec, frame);
    if (gr != 0) {
      break;
    }
    if (!have_first) {
      if (frame_to_bgr_standalone(frame, sws, first_bgr)) {
        have_first = true;
      }
    }
    if (frame_is_intra(frame)) {
      if (frame_to_bgr_standalone(frame, sws, bgr)) {
        got_key = true;
      }
      av_frame_unref(frame);
      goto done_decode;
    }
    av_frame_unref(frame);
  }

done_decode:
  av_frame_free(&frame);
  av_packet_free(&pkt);
  sws_freeContext(sws);
  avcodec_free_context(&dec);
  avformat_close_input(&fmt);
  avio_context_free(&avio);

  if (got_key && !bgr.empty()) {
    return true;
  }
  if (have_first && !first_bgr.empty()) {
    bgr = std::move(first_bgr);
    return true;
  }
  return false;
}

static std::vector<int> pick_spread_segment_indices(int n_seg, int want) {
  std::vector<int> idx;
  if (n_seg <= 0 || want <= 0) {
    return idx;
  }
  idx.reserve(static_cast<size_t>(want));
  for (int k = 0; k < want; ++k) {
    if (n_seg == 1) {
      idx.push_back(0);
      continue;
    }
    const double t = (static_cast<double>(k) + 0.5) / static_cast<double>(want);
    int i = static_cast<int>(t * static_cast<double>(n_seg));
    if (i >= n_seg) {
      i = n_seg - 1;
    }
    idx.push_back(i);
  }
  return idx;
}

/*
 * Playlist-driven sampling: only kSamples .ts downloads, parallel HTTP, first keyframe decode each.
 */
static bool try_hls_segment_parallel_samples(const char* m3u8_url, unsigned workers,
    std::vector<cv::Mat>& out) {
  std::string media_text;
  std::string media_url;
  if (!resolve_playlist_to_media(m3u8_url, &media_text, &media_url)) {
    return false;
  }
  bool encrypted = false;
  std::vector<HlsSegment> segs;
  if (!media_playlist_encrypted_or_segments(media_text, &encrypted, &segs)) {
    return false;
  }
  if (encrypted) {
    return false;
  }
  for (auto& s : segs) {
    s.uri_rel = resolve_hls_reference(media_url, s.uri_rel);
  }
  const int n_seg = static_cast<int>(segs.size());
  const std::vector<int> pick = pick_spread_segment_indices(n_seg, kSamples);
  if (static_cast<int>(pick.size()) != kSamples) {
    return false;
  }

  out.assign(static_cast<size_t>(kSamples), cv::Mat());
  std::vector<uint8_t> ok(static_cast<size_t>(kSamples), 0);
  std::atomic<int> next_k{0};

  auto worker_fn = [&]() {
    for (;;) {
      const int k = next_k.fetch_add(1, std::memory_order_relaxed);
      if (k >= kSamples) {
        break;
      }
      const int seg_i = pick[static_cast<size_t>(k)];
      const std::string& seg_url = segs[static_cast<size_t>(seg_i)].uri_rel;
      std::vector<uint8_t> ts_bytes;
      long http = 0;
      if (!load_uri_bytes(seg_url.c_str(), ts_bytes, &http) || ts_bytes.size() < 2048u) {
        continue;
      }
      cv::Mat bgr;
      if (ts_bytes_first_keyframe_bgr(ts_bytes, bgr) && !bgr.empty()) {
        out[static_cast<size_t>(k)] = std::move(bgr);
        ok[static_cast<size_t>(k)] = 1;
      }
    }
  };

  std::vector<std::thread> threads;
  threads.reserve(workers);
  for (unsigned i = 0; i < workers; ++i) {
    threads.emplace_back(worker_fn);
  }
  for (auto& th : threads) {
    th.join();
  }

  for (int k = 0; k < kSamples; ++k) {
    if (!ok[static_cast<size_t>(k)]) {
      return false;
    }
  }
  return true;
}

struct VideoDecoder {
  AVFormatContext* fmt = nullptr;
  AVCodecContext* dec = nullptr;
  int vindex = -1;
  AVStream* vst = nullptr;
  SwsContext* sws = nullptr;
};

static void decoder_close(VideoDecoder& d) {
  sws_freeContext(d.sws);
  d.sws = nullptr;
  if (d.dec) {
    avcodec_free_context(&d.dec);
  }
  if (d.fmt) {
    avformat_close_input(&d.fmt);
  }
  d.fmt = nullptr;
  d.vst = nullptr;
  d.vindex = -1;
}

static bool decoder_open(const char* url, VideoDecoder& d) {
  if (avformat_open_input(&d.fmt, url, nullptr, nullptr) < 0) {
    return false;
  }
  if (avformat_find_stream_info(d.fmt, nullptr) < 0) {
    return false;
  }
  d.vindex = av_find_best_stream(d.fmt, AVMEDIA_TYPE_VIDEO, -1, -1, nullptr, 0);
  if (d.vindex < 0) {
    return false;
  }
  d.vst = d.fmt->streams[d.vindex];
  const AVCodec* codec = avcodec_find_decoder(d.vst->codecpar->codec_id);
  if (!codec) {
    return false;
  }
  d.dec = avcodec_alloc_context3(codec);
  if (!d.dec) {
    return false;
  }
  if (avcodec_parameters_to_context(d.dec, d.vst->codecpar) < 0) {
    return false;
  }
  if (avcodec_open2(d.dec, codec, nullptr) < 0) {
    return false;
  }
  return true;
}

static bool frame_to_bgr(AVFrame* frame, VideoDecoder& d, cv::Mat& out) {
  const int w = frame->width;
  const int h = frame->height;
  const AVPixelFormat src_pf = static_cast<AVPixelFormat>(frame->format);
  d.sws = sws_getCachedContext(
      d.sws, w, h, src_pf, w, h, AV_PIX_FMT_BGR24, SWS_BILINEAR, nullptr, nullptr, nullptr);
  if (!d.sws) {
    return false;
  }
  out.create(h, w, CV_8UC3);
  uint8_t* dst_data[1] = {out.data};
  int dst_linesize[1] = {static_cast<int>(out.step[0])};
  sws_scale(d.sws, frame->data, frame->linesize, 0, h, dst_data, dst_linesize);
  return true;
}

/*
 * Read next decoded video frame as BGR. Handles decoder flush at EOF.
 */
static bool read_next_bgr(VideoDecoder& d, AVPacket* pkt, AVFrame* fr, cv::Mat& bgr) {
  for (;;) {
    int ret = avcodec_receive_frame(d.dec, fr);
    if (ret == 0) {
      if (!frame_to_bgr(fr, d, bgr)) {
        av_frame_unref(fr);
        return false;
      }
      av_frame_unref(fr);
      return true;
    }
    if (ret != AVERROR(EAGAIN)) {
      return false;
    }
    ret = av_read_frame(d.fmt, pkt);
    if (ret < 0) {
      if (ret == AVERROR_EOF) {
        ret = avcodec_send_packet(d.dec, nullptr);
        if (ret < 0) {
          return false;
        }
        continue;
      }
      return false;
    }
    if (pkt->stream_index != d.vindex) {
      av_packet_unref(pkt);
      continue;
    }
    ret = avcodec_send_packet(d.dec, pkt);
    av_packet_unref(pkt);
    if (ret < 0 && ret != AVERROR(EAGAIN)) {
      return false;
    }
  }
}

static long long count_video_frames(const char* url) {
  VideoDecoder d;
  if (!decoder_open(url, d)) {
    return -1;
  }
  AVPacket* pkt = av_packet_alloc();
  AVFrame* fr = av_frame_alloc();
  long long n = 0;
  cv::Mat discard;
  while (read_next_bgr(d, pkt, fr, discard)) {
    ++n;
  }
  av_frame_free(&fr);
  av_packet_free(&pkt);
  decoder_close(d);
  return n;
}

static bool seek_to_start(VideoDecoder& d) {
  avcodec_flush_buffers(d.dec);
  if (av_seek_frame(d.fmt, d.vindex, 0, AVSEEK_FLAG_BACKWARD) < 0) {
    if (avformat_seek_file(d.fmt, d.vindex, INT64_MIN, 0, 0, 0) < 0) {
      return false;
    }
  }
  avcodec_flush_buffers(d.dec);
  return true;
}

static bool extract_frame_by_index(const char* url, long long target_idx, cv::Mat& out) {
  VideoDecoder d;
  if (!decoder_open(url, d)) {
    return false;
  }
  if (!seek_to_start(d)) {
    decoder_close(d);
    return false;
  }
  AVPacket* pkt = av_packet_alloc();
  AVFrame* fr = av_frame_alloc();
  long long idx = 0;
  bool ok = false;
  while (read_next_bgr(d, pkt, fr, out)) {
    if (idx == target_idx) {
      ok = true;
      break;
    }
    ++idx;
  }
  av_frame_free(&fr);
  av_packet_free(&pkt);
  decoder_close(d);
  return ok;
}

static double stream_duration_sec(const VideoDecoder& d) {
  if (d.vst->duration != AV_NOPTS_VALUE && d.vst->time_base.den != 0) {
    return d.vst->duration * av_q2d(d.vst->time_base);
  }
  if (d.fmt->duration != AV_NOPTS_VALUE && d.fmt->duration > 0) {
    return static_cast<double>(d.fmt->duration) / AV_TIME_BASE;
  }
  return 0.0;
}

static bool extract_frame_near_time(const char* url, double t_sec, cv::Mat& out) {
  VideoDecoder d;
  if (!decoder_open(url, d)) {
    return false;
  }
  const AVRational tb = d.vst->time_base;
  const double tb_sec = av_q2d(tb);
  if (tb_sec <= 0.0) {
    decoder_close(d);
    return false;
  }
  int64_t ts = static_cast<int64_t>(t_sec / tb_sec);
  avcodec_flush_buffers(d.dec);
  if (av_seek_frame(d.fmt, d.vindex, ts, AVSEEK_FLAG_BACKWARD) < 0) {
    decoder_close(d);
    return false;
  }
  avcodec_flush_buffers(d.dec);
  AVPacket* pkt = av_packet_alloc();
  AVFrame* fr = av_frame_alloc();
  bool ok = read_next_bgr(d, pkt, fr, out);
  av_frame_free(&fr);
  av_packet_free(&pkt);
  decoder_close(d);
  return ok;
}

/*
 * Parallel sample extraction: each worker opens its own FFmpeg context (thread-safe).
 * Worker count: min(available hardware threads, kSamples), capped at 10 via kSamples.
 */
static unsigned sample_parallel_workers() {
  unsigned c = std::thread::hardware_concurrency();
  if (c == 0) {
    c = 4;
  }
  return std::min(static_cast<unsigned>(kSamples), c);
}

static bool parallel_extract_by_time(const char* url, double dur_sec, unsigned workers,
    std::vector<cv::Mat>& out) {
  out.assign(static_cast<size_t>(kSamples), cv::Mat());
  std::vector<uint8_t> ok(static_cast<size_t>(kSamples), 0);
  std::atomic<int> next_k{0};

  auto worker_fn = [&]() {
    for (;;) {
      const int k = next_k.fetch_add(1, std::memory_order_relaxed);
      if (k >= kSamples) {
        break;
      }
      cv::Mat f;
      const double t =
          dur_sec * (static_cast<double>(k) + 0.5) / static_cast<double>(kSamples);
      if (extract_frame_near_time(url, t, f) && !f.empty()) {
        out[static_cast<size_t>(k)] = std::move(f);
        ok[static_cast<size_t>(k)] = 1;
      }
    }
  };

  std::vector<std::thread> threads;
  threads.reserve(workers);
  for (unsigned i = 0; i < workers; ++i) {
    threads.emplace_back(worker_fn);
  }
  for (auto& th : threads) {
    th.join();
  }

  for (int k = 0; k < kSamples; ++k) {
    if (!ok[static_cast<size_t>(k)]) {
      return false;
    }
  }
  return true;
}

static bool parallel_extract_by_index(const char* url, long long nframes, unsigned workers,
    std::vector<cv::Mat>& out) {
  out.assign(static_cast<size_t>(kSamples), cv::Mat());
  std::vector<uint8_t> ok(static_cast<size_t>(kSamples), 0);
  std::atomic<int> next_k{0};

  auto worker_fn = [&]() {
    for (;;) {
      const int k = next_k.fetch_add(1, std::memory_order_relaxed);
      if (k >= kSamples) {
        break;
      }
      const long long idx =
          static_cast<long long>((static_cast<double>(k) + 0.5) * static_cast<double>(nframes - 1) /
                                 static_cast<double>(kSamples));
      cv::Mat f;
      if (extract_frame_by_index(url, idx, f) && !f.empty()) {
        out[static_cast<size_t>(k)] = std::move(f);
        ok[static_cast<size_t>(k)] = 1;
      }
    }
  };

  std::vector<std::thread> threads;
  threads.reserve(workers);
  for (unsigned i = 0; i < workers; ++i) {
    threads.emplace_back(worker_fn);
  }
  for (auto& th : threads) {
    th.join();
  }

  for (int k = 0; k < kSamples; ++k) {
    if (!ok[static_cast<size_t>(k)]) {
      return false;
    }
  }
  return true;
}

static int mkdir_p(const char* path) {
  char tmp[1024];
  std::snprintf(tmp, sizeof(tmp), "%s", path);
  const size_t len = std::strlen(tmp);
  if (len == 0) {
    return -1;
  }
  for (size_t i = 1; i < len; ++i) {
    if (tmp[i] == '/') {
      tmp[i] = '\0';
      if (tmp[0] != '\0') {
        (void)mkdir(tmp, 0755);
      }
      tmp[i] = '/';
    }
  }
  return mkdir(tmp, 0755);
}

static float percentile_from_mat(const cv::Mat& var_f32, double p) {
  std::vector<float> vals;
  vals.reserve(static_cast<size_t>(var_f32.rows * var_f32.cols));
  for (int y = 0; y < var_f32.rows; ++y) {
    const float* row = var_f32.ptr<float>(y);
    for (int x = 0; x < var_f32.cols; ++x) {
      vals.push_back(row[x]);
    }
  }
  if (vals.empty()) {
    return 0.f;
  }
  const size_t k = static_cast<size_t>(p * static_cast<double>(vals.size() - 1));
  std::nth_element(vals.begin(), vals.begin() + static_cast<std::ptrdiff_t>(k), vals.end());
  return vals[k];
}

static double mean_var_for_label(const cv::Mat& labels, const cv::Mat& var_map, int lab) {
  double s = 0.0;
  int n = 0;
  for (int y = 0; y < labels.rows; ++y) {
    const int* lr = labels.ptr<int>(y);
    const float* vr = var_map.ptr<float>(y);
    for (int x = 0; x < labels.cols; ++x) {
      if (lr[x] == lab) {
        s += static_cast<double>(vr[x]);
        ++n;
      }
    }
  }
  return n > 0 ? s / static_cast<double>(n) : 1e12;
}

static double persistence_in_roi(const std::vector<cv::Mat>& work_gray, const cv::Mat& mean_gray_u8,
    cv::Rect roi, uint8_t tau_diff) {
  roi &= cv::Rect(0, 0, mean_gray_u8.cols, mean_gray_u8.rows);
  if (roi.width < 2 || roi.height < 2) {
    return 0.0;
  }
  cv::Mat acc = cv::Mat::zeros(roi.height, roi.width, CV_32F);
  const int n = static_cast<int>(work_gray.size());
  for (const cv::Mat& g : work_gray) {
    cv::Mat diff;
    cv::absdiff(g(roi), mean_gray_u8(roi), diff);
    cv::Mat st;
    cv::compare(diff, cv::Scalar(static_cast<double>(tau_diff)), st, cv::CMP_LT);
    cv::Mat f;
    st.convertTo(f, CV_32F, 1.0 / 255.0);
    acc += f;
  }
  acc /= static_cast<float>(std::max(1, n));
  return cv::mean(acc)[0];
}

/**
 * Index of the sample whose logo ROI (proc resolution) is closest to the temporal mean gray.
 * Avoids exporting a logo crop from a frame where the ROI is an outlier (e.g. logo occluded).
 */
static int best_sample_idx_near_temporal_mean(const std::vector<cv::Mat>& work_gray,
    const cv::Mat& mean_gray_u8, cv::Rect roi_proc) {
  roi_proc &= cv::Rect(0, 0, mean_gray_u8.cols, mean_gray_u8.rows);
  if (work_gray.empty() || roi_proc.width < 1 || roi_proc.height < 1) {
    return 0;
  }
  const cv::Mat mean_patch = mean_gray_u8(roi_proc);
  int best_i = 0;
  double best_l1 = 1e300;
  for (int i = 0; i < static_cast<int>(work_gray.size()); ++i) {
    cv::Mat diff;
    cv::absdiff(work_gray[static_cast<size_t>(i)](roi_proc), mean_patch, diff);
    const double l1 = cv::sum(diff)[0];
    if (l1 < best_l1) {
      best_l1 = l1;
      best_i = i;
    }
  }
  return best_i;
}

static double edge_density_canny(const cv::Mat& gray_roi_u8) {
  if (gray_roi_u8.empty()) {
    return 0.0;
  }
  cv::Mat edges;
  cv::Canny(gray_roi_u8, edges, 52, 148);
  const double area = static_cast<double>(gray_roi_u8.rows * gray_roi_u8.cols);
  return static_cast<double>(cv::countNonZero(edges)) / (area + 1e-6);
}

static double spatial_color_std_mean(const cv::Mat& bgr_roi) {
  if (bgr_roi.empty()) {
    return 0.0;
  }
  std::vector<cv::Mat> ch;
  cv::split(bgr_roi, ch);
  double sum_std = 0.0;
  for (int i = 0; i < 3; ++i) {
    cv::Scalar m;
    cv::Scalar s;
    cv::meanStdDev(ch[static_cast<size_t>(i)], m, s);
    sum_std += s[0];
  }
  return sum_std / 3.0;
}

static double laplacian_sharpness_var(const cv::Mat& gray_roi_u8) {
  if (gray_roi_u8.empty()) {
    return 0.0;
  }
  cv::Mat lap;
  cv::Laplacian(gray_roi_u8, lap, CV_32F, 3);
  cv::Scalar m;
  cv::Scalar s;
  cv::meanStdDev(lap, m, s);
  return s[0] * s[0];
}

static double position_prior_rect(cv::Rect roi, int pw, int ph) {
  const double cx = (roi.x + 0.5 * roi.width) / static_cast<double>(pw);
  const double cy = (roi.y + 0.5 * roi.height) / static_cast<double>(ph);
  /* Tight exponential toward top-right and bottom-right (typical bug / channel logos). */
  const double dx_tr = 1.0 - cx;
  const double dy_tr = cy;
  const double dx_br = 1.0 - cx;
  const double dy_br = 1.0 - cy;
  const double tr = std::exp(-kCornerPriorAlpha * (dx_tr * dx_tr + dy_tr * dy_tr));
  const double br = std::exp(-kCornerPriorAlpha * (dx_br * dx_br + dy_br * dy_br));
  const double m = std::max(tr, br);
  /* Slight floor so mid-frame candidates can still win if texture is overwhelming. */
  return std::max(0.0, std::min(1.0, 0.08 + 0.92 * m));
}

static double area_penalty_score(int area_px, int frame_px) {
  const double f = static_cast<double>(area_px) / static_cast<double>(frame_px + 1);
  if (f <= kMaxLogoAreaFrac) {
    return f / kMaxLogoAreaFrac;
  }
  return 1.0 + 5.0 * (f - kMaxLogoAreaFrac);
}

static double norm01(double x, double cap) {
  if (cap <= 1e-9) {
    return 0.0;
  }
  return std::max(0.0, std::min(1.0, x / cap));
}

/**
 * Shrink coarse logo_proc to a tight bbox using several gray frames at proc resolution.
 * Static pixels (low temporal variance) with consistent edge energy across frames win;
 * moving scene inside the coarse box is suppressed.
 */
static bool refine_logo_bbox_proc(const std::vector<cv::Mat>& work_gray, cv::Rect coarse_proc, int PW, int PH,
    cv::Rect* out_tight_proc) {
  if (!out_tight_proc || work_gray.empty()) {
    return false;
  }
  coarse_proc &= cv::Rect(0, 0, PW, PH);
  if (coarse_proc.width < 20 || coarse_proc.height < 20) {
    return false;
  }

  const int n = static_cast<int>(work_gray.size());
  const int K = std::min(kRefineMaxSamples, std::max(1, n));
  std::vector<int> pick_idx;
  pick_idx.reserve(static_cast<size_t>(K));
  if (K == 1) {
    pick_idx.push_back(0);
  } else {
    for (int j = 0; j < K; ++j) {
      pick_idx.push_back((j * (n - 1)) / (K - 1));
    }
  }

  const int rw = coarse_proc.width;
  const int rh = coarse_proc.height;
  cv::Mat sum_gray = cv::Mat::zeros(rh, rw, CV_32F);
  cv::Mat sumsq_gray = cv::Mat::zeros(rh, rw, CV_32F);
  cv::Mat acc_sobel = cv::Mat::zeros(rh, rw, CV_32F);

  for (int ij : pick_idx) {
    const cv::Mat& g = work_gray[static_cast<size_t>(ij)];
    cv::Mat patch = g(coarse_proc);
    cv::Mat f;
    patch.convertTo(f, CV_32F);
    sum_gray += f;
    sumsq_gray += f.mul(f);
    cv::Mat gx;
    cv::Mat gy;
    cv::Mat mag;
    cv::Sobel(patch, gx, CV_32F, 1, 0, 3);
    cv::Sobel(patch, gy, CV_32F, 0, 1, 3);
    cv::magnitude(gx, gy, mag);
    acc_sobel += mag;
  }

  const float invk = 1.f / static_cast<float>(K);
  sum_gray *= invk;
  sumsq_gray *= invk;
  cv::Mat var_gray = sumsq_gray - sum_gray.mul(sum_gray);
  cv::max(var_gray, 0.f, var_gray);
  cv::Mat std_gray;
  cv::sqrt(var_gray, std_gray);

  acc_sobel *= invk;

  double smax = 0.0;
  cv::minMaxLoc(std_gray, nullptr, &smax);
  cv::Mat static_u8;
  if (smax < 0.5) {
    static_u8 = cv::Mat(rh, rw, CV_8UC1, cv::Scalar(255));
  } else {
    const float thr_stat = percentile_from_mat(std_gray, kRefineStaticVarPercentile);
    cv::compare(std_gray, cv::Scalar(static_cast<double>(thr_stat)), static_u8, cv::CMP_LT);
  }

  cv::Mat acc8;
  cv::normalize(acc_sobel, acc8, 0, 255, cv::NORM_MINMAX, CV_8U);
  cv::bitwise_and(acc8, static_u8, acc8);

  cv::Mat bin;
  cv::threshold(acc8, bin, 0, 255, cv::THRESH_BINARY | cv::THRESH_OTSU);
  if (cv::countNonZero(bin) < 16) {
    const float t = percentile_from_mat(acc_sobel, 0.72);
    cv::compare(acc_sobel, cv::Scalar(static_cast<double>(t)), bin, cv::CMP_GT);
    cv::bitwise_and(bin, static_u8, bin);
  }

  cv::Mat kc = cv::getStructuringElement(cv::MORPH_RECT, cv::Size(5, 5));
  cv::Mat ko = cv::getStructuringElement(cv::MORPH_RECT, cv::Size(3, 3));
  cv::morphologyEx(bin, bin, cv::MORPH_CLOSE, kc);
  cv::morphologyEx(bin, bin, cv::MORPH_OPEN, ko);

  cv::Mat labels;
  cv::Mat stats;
  cv::Mat centroids;
  const int ncc = cv::connectedComponentsWithStats(bin, labels, stats, centroids, 8);
  const int roi_px = rw * rh;
  const int min_area = std::max(24, static_cast<int>(kRefineMinCcAreaFrac * static_cast<double>(roi_px)));
  const int max_area = static_cast<int>(kRefineMaxCcAreaFrac * static_cast<double>(roi_px));

  int best_l = -1;
  int best_a = 0;
  for (int lbl = 1; lbl < ncc; ++lbl) {
    const int a = stats.at<int>(lbl, cv::CC_STAT_AREA);
    if (a < min_area || a > max_area) {
      continue;
    }
    if (a > best_a) {
      best_a = a;
      best_l = lbl;
    }
  }
  if (best_l < 0) {
    return false;
  }

  int bx = stats.at<int>(best_l, cv::CC_STAT_LEFT);
  int by = stats.at<int>(best_l, cv::CC_STAT_TOP);
  int bw = stats.at<int>(best_l, cv::CC_STAT_WIDTH);
  int bh = stats.at<int>(best_l, cv::CC_STAT_HEIGHT);
  bx = std::max(0, bx - kRefinePadPx);
  by = std::max(0, by - kRefinePadPx);
  bw = std::min(rw - bx, bw + 2 * kRefinePadPx);
  bh = std::min(rh - by, bh + 2 * kRefinePadPx);
  if (bw < 8 || bh < 8) {
    return false;
  }

  cv::Rect tight(bx + coarse_proc.x, by + coarse_proc.y, bw, bh);
  tight &= cv::Rect(0, 0, PW, PH);
  if (tight.width < 8 || tight.height < 8) {
    return false;
  }

  /* Require real shrink or similar area (reject nonsense expansion). */
  const int coarse_a = coarse_proc.width * coarse_proc.height;
  const int tight_a = tight.width * tight.height;
  if (tight_a > coarse_a) {
    return false;
  }

  *out_tight_proc = tight;
  return true;
}

static double orb_validate_roi(const cv::Mat& g0, const cv::Mat& g1, cv::Rect roi) {
  roi &= cv::Rect(0, 0, g0.cols, g0.rows);
  if (roi.width < 32 || roi.height < 32) {
    return 0.0;
  }
  cv::Mat r0 = g0(roi);
  cv::Mat r1 = g1(roi);
  auto orb = cv::ORB::create(400, 1.2f, 8, 16, 0, 2, cv::ORB::HARRIS_SCORE, 16, 20);
  std::vector<cv::KeyPoint> k0, k1;
  cv::Mat d0, d1;
  orb->detectAndCompute(r0, cv::noArray(), k0, d0);
  orb->detectAndCompute(r1, cv::noArray(), k1, d1);
  if (k0.size() < 8 || k1.size() < 8 || d0.empty() || d1.empty()) {
    return 0.0;
  }
  cv::BFMatcher matcher(cv::NORM_HAMMING, true);
  std::vector<cv::DMatch> matches;
  matcher.match(d0, d1, matches);
  if (matches.empty()) {
    return 0.0;
  }
  double dist_sum = 0.0;
  for (const auto& m : matches) {
    dist_sum += m.distance;
  }
  const double mean_dist = dist_sum / static_cast<double>(matches.size());
  const double score = std::max(0.0, 1.0 - mean_dist / 50.0);
  return score;
}

static void json_escape(const char* s, std::string& out) {
  out.clear();
  for (const char* p = s; *p; ++p) {
    switch (*p) {
      case '\\':
        out += "\\\\";
        break;
      case '"':
        out += "\\\"";
        break;
      case '\n':
        out += "\\n";
        break;
      default:
        out += *p;
        break;
    }
  }
}

static void remove_channel_sample_jpegs(const char* channel_id) {
  if (!channel_id) {
    return;
  }
  for (int i = 0; i < kSamples; ++i) {
    char path[512];
    std::snprintf(path, sizeof(path), "samples/%s_sample_%d.jpg", channel_id, i);
    (void)::remove(path);
  }
}

}  /* namespace */

static void curl_cleanup_atexit() {
  curl_global_cleanup();
}

int main(int argc, char** argv) {
  if (argc != 3) {
    std::fprintf(stderr, "usage: %s <m3u8_url_or_path> <channel_id>\n", argv[0]);
    return 1;
  }
  const char* m3u8 = argv[1];
  const char* channel_id = argv[2];

  avformat_network_init();
  curl_global_init(CURL_GLOBAL_DEFAULT);
  std::atexit(curl_cleanup_atexit);
  av_log_set_level(AV_LOG_ERROR);

  (void)mkdir_p("samples");
  (void)mkdir_p("output");

  std::vector<cv::Mat> bgr_frames;
  bgr_frames.reserve(kSamples);

  const unsigned sample_workers = sample_parallel_workers();

  /* Fast path: parse m3u8, fetch only kSamples .ts in parallel, decode first keyframe each. */
  bool got_samples = try_hls_segment_parallel_samples(m3u8, sample_workers, bgr_frames);
  if (!got_samples) {
    bgr_frames.clear();
  }

  /* Slow fallback: full HLS demux (many segment reads per worker). */
  VideoDecoder probe;
  double dur_sec = 0.0;
  if (!got_samples && decoder_open(m3u8, probe)) {
    dur_sec = stream_duration_sec(probe);
    decoder_close(probe);
  }

  if (!got_samples && dur_sec > 0.5) {
    got_samples = parallel_extract_by_time(m3u8, dur_sec, sample_workers, bgr_frames);
    if (!got_samples) {
      bgr_frames.clear();
    }
  }

  if (!got_samples) {
    const long long nframes = count_video_frames(m3u8);
    if (nframes < kSamples) {
      std::fprintf(stderr, "error: need at least %d frames (got %lld)\n", kSamples,
          static_cast<long long>(nframes));
      return 2;
    }
    if (!parallel_extract_by_index(m3u8, nframes, sample_workers, bgr_frames)) {
      std::fprintf(stderr, "error: parallel sample extraction failed (by frame index)\n");
      return 3;
    }
  }

  /* Save raw samples before resize (as requested paths). */
  for (int i = 0; i < kSamples; ++i) {
    char path[512];
    std::snprintf(path, sizeof(path), "samples/%s_sample_%d.jpg", channel_id, i);
    if (!cv::imwrite(path, bgr_frames[static_cast<size_t>(i)])) {
      std::fprintf(stderr, "error: imwrite %s failed\n", path);
      return 4;
    }
  }

  const int ref_w = bgr_frames[0].cols;
  const int ref_h = bgr_frames[0].rows;
  const int ns = static_cast<int>(bgr_frames.size());

  /* --- Logo detection: global temporal mean/var on 32×32 grid @ kProcW×kProcH (no SSIM) --- */
  const int PW = kProcW;
  const int PH = kProcH;
  const int Wg = PW / kProcCell;
  const int Hg = PH / kProcCell;

  std::vector<cv::Mat> work_gray;
  std::vector<cv::Mat> work_bgr;
  work_gray.reserve(static_cast<size_t>(ns));
  work_bgr.reserve(static_cast<size_t>(ns));

  cv::Mat sum_bgr_acc = cv::Mat::zeros(PH, PW, CV_64FC3);
  cv::Ptr<cv::CLAHE> clahe = cv::createCLAHE(2.0, cv::Size(8, 8));

  for (int i = 0; i < ns; ++i) {
    cv::Mat b = bgr_frames[static_cast<size_t>(i)];
    if (b.cols != ref_w || b.rows != ref_h) {
      cv::resize(b, b, cv::Size(ref_w, ref_h), 0, 0, cv::INTER_AREA);
    }
    cv::Mat w;
    cv::resize(b, w, cv::Size(PW, PH), 0, 0, cv::INTER_AREA);
    work_bgr.push_back(w.clone());
    cv::Mat g;
    cv::cvtColor(w, g, cv::COLOR_BGR2GRAY);
    cv::GaussianBlur(g, g, cv::Size(0, 0), kPreBlurSigma, kPreBlurSigma);
    clahe->apply(g, g);
    work_gray.push_back(g);
    cv::Mat wf;
    w.convertTo(wf, CV_64FC3);
    sum_bgr_acc += wf;
  }
  bgr_frames.clear();

  sum_bgr_acc /= static_cast<double>(std::max(1, ns));
  cv::Mat mean_bgr_work;
  sum_bgr_acc.convertTo(mean_bgr_work, CV_8UC3);

  cv::Mat sum_small = cv::Mat::zeros(Hg, Wg, CV_32F);
  cv::Mat sumsq_small = cv::Mat::zeros(Hg, Wg, CV_32F);
  for (const cv::Mat& g : work_gray) {
    cv::Mat sm;
    cv::resize(g, sm, cv::Size(Wg, Hg), 0, 0, cv::INTER_AREA);
    cv::Mat f;
    sm.convertTo(f, CV_32F);
    sum_small += f;
    sumsq_small += f.mul(f);
  }
  const float invn = 1.f / static_cast<float>(std::max(1, ns));
  sum_small *= invn;
  sumsq_small *= invn;
  cv::Mat var_map = sumsq_small - sum_small.mul(sum_small);
  cv::max(var_map, 0.f, var_map);

  const float p20 = percentile_from_mat(var_map, kStableVarPercentile);
  double min_v = 0.0;
  double max_v = 0.0;
  cv::minMaxLoc(var_map, &min_v, &max_v);
  const float T_var = std::max(p20, static_cast<float>(min_v + 0.02 * (max_v - min_v)));

  cv::Mat stable_u8;
  cv::compare(var_map, cv::Scalar(static_cast<double>(T_var)), stable_u8, cv::CMP_LT);
  cv::Mat kernel = cv::getStructuringElement(cv::MORPH_RECT, cv::Size(3, 3));
  cv::morphologyEx(stable_u8, stable_u8, cv::MORPH_OPEN, kernel);
  cv::morphologyEx(stable_u8, stable_u8, cv::MORPH_CLOSE, kernel);

  cv::Mat labels;
  cv::Mat stats;
  cv::Mat centroids;
  const int ncc = cv::connectedComponentsWithStats(stable_u8, labels, stats, centroids, 8);

  cv::Mat mean_gray_acc = cv::Mat::zeros(PH, PW, CV_32F);
  for (const cv::Mat& g : work_gray) {
    cv::Mat f;
    g.convertTo(f, CV_32F);
    mean_gray_acc += f;
  }
  mean_gray_acc *= (1.f / static_cast<float>(std::max(1, ns)));
  cv::Mat mean_gray_u8;
  mean_gray_acc.convertTo(mean_gray_u8, CV_8UC1);

  const int frame_px = PW * PH;
  const double v95_cap = std::max(1e-6, static_cast<double>(percentile_from_mat(var_map, 0.95)));

  int best_lbl = -1;
  double best_raw = -1e18;
  int cand_regions = 0;

  for (int lbl = 1; lbl < ncc; ++lbl) {
    const int area_cells = stats.at<int>(lbl, cv::CC_STAT_AREA);
    const int bw_cells = stats.at<int>(lbl, cv::CC_STAT_WIDTH);
    const int bh_cells = stats.at<int>(lbl, cv::CC_STAT_HEIGHT);
    const int area_px = area_cells * kProcCell * kProcCell;
    if (area_px < static_cast<int>(kMinLogoAreaPx)) {
      continue;
    }
    if (area_px > static_cast<int>(kMaxLogoAreaFrac * static_cast<double>(frame_px))) {
      continue;
    }

    const int x0 = stats.at<int>(lbl, cv::CC_STAT_LEFT) * kProcCell;
    const int y0 = stats.at<int>(lbl, cv::CC_STAT_TOP) * kProcCell;
    const int bw = bw_cells * kProcCell;
    const int bh = bh_cells * kProcCell;
    cv::Rect roi(x0, y0, bw, bh);
    roi &= cv::Rect(0, 0, PW, PH);
    if (roi.width < 8 || roi.height < 8) {
      continue;
    }

    const cv::Mat gray_roi = mean_gray_u8(roi);
    const cv::Mat bgr_roi = mean_bgr_work(roi);
    const double edge_d = edge_density_canny(gray_roi);
    const double col_var = spatial_color_std_mean(bgr_roi);
    const double sharp = laplacian_sharpness_var(gray_roi);
    if (edge_d <= kFlatEdgeDensityMax && col_var <= kFlatColorStdMax && sharp <= kFlatLapVarMax) {
      continue;
    }

    ++cand_regions;

    const double mvar = mean_var_for_label(labels, var_map, lbl);
    const double stab = 1.0 - norm01(mvar, v95_cap);
    const double persist = persistence_in_roi(work_gray, mean_gray_u8, roi, 18);

    const double pos = position_prior_rect(roi, PW, PH);
    const double apen = area_penalty_score(area_px, frame_px);

    const double edge_n = norm01(edge_d, 0.085);
    const double col_n = norm01(col_var, 38.0);
    const double sharp_n = norm01(sharp, 320.0);
    const double texture_core = (edge_n + col_n + sharp_n) / 3.0;

    const double score = kW_stability * (0.52 * stab + 0.48 * persist) + kW_edge * edge_n +
        kW_color * col_n + kW_sharp * sharp_n + kW_pos * pos - kW_area * apen -
        kW_texture_gate * (1.0 - texture_core);

    if (score > best_raw) {
      best_raw = score;
      best_lbl = lbl;
    }
  }

  cv::Rect logo_proc(0, 0, 160, 160);
  double conf = 0.0;
  if (best_lbl < 0) {
    logo_proc = cv::Rect(PW - 220, PH - 220, 200, 200);
    logo_proc &= cv::Rect(0, 0, PW, PH);
    conf = 0.12;
  } else {
    logo_proc.x = stats.at<int>(best_lbl, cv::CC_STAT_LEFT) * kProcCell;
    logo_proc.y = stats.at<int>(best_lbl, cv::CC_STAT_TOP) * kProcCell;
    logo_proc.width = stats.at<int>(best_lbl, cv::CC_STAT_WIDTH) * kProcCell;
    logo_proc.height = stats.at<int>(best_lbl, cv::CC_STAT_HEIGHT) * kProcCell;
    logo_proc &= cv::Rect(0, 0, PW, PH);
    logo_proc.x = std::max(0, logo_proc.x - kBboxPadPx);
    logo_proc.y = std::max(0, logo_proc.y - kBboxPadPx);
    logo_proc.width = std::min(PW - logo_proc.x, logo_proc.width + 2 * kBboxPadPx);
    logo_proc.height = std::min(PH - logo_proc.y, logo_proc.height + 2 * kBboxPadPx);
    conf = std::max(0.0, std::min(1.0, best_raw / 7.5));
  }

  bool refine_ok = false;
  cv::Rect logo_proc_tight;
  if (refine_logo_bbox_proc(work_gray, logo_proc, PW, PH, &logo_proc_tight)) {
    logo_proc = logo_proc_tight;
    refine_ok = true;
  }

  const double sx = static_cast<double>(ref_w) / static_cast<double>(PW);
  const double sy = static_cast<double>(ref_h) / static_cast<double>(PH);
  cv::Rect logo_rect_full(static_cast<int>(std::floor(logo_proc.x * sx)),
      static_cast<int>(std::floor(logo_proc.y * sy)), static_cast<int>(std::ceil(logo_proc.width * sx)),
      static_cast<int>(std::ceil(logo_proc.height * sy)));
  logo_rect_full &= cv::Rect(0, 0, ref_w, ref_h);

  double orb_score = 0.0;
  if (ns >= 2 && logo_rect_full.width >= 16 && logo_rect_full.height >= 16) {
    cv::Mat g0full;
    cv::Mat g1full;
    cv::resize(work_gray[0], g0full, cv::Size(ref_w, ref_h), 0, 0, cv::INTER_AREA);
    const int mid = std::min(ns - 1, std::max(1, ns / 2));
    cv::resize(work_gray[static_cast<size_t>(mid)], g1full, cv::Size(ref_w, ref_h), 0, 0, cv::INTER_AREA);
    orb_score = orb_validate_roi(g0full, g1full, logo_rect_full);
    if (orb_score < 0.22) {
      conf *= 0.88;
    }
  }

  /* Reload sample for debug/crop: frame whose logo ROI best matches temporal mean (proc gray). */
  const int dbg_idx = best_sample_idx_near_temporal_mean(work_gray, mean_gray_u8, logo_proc);
  char sample_path[512];
  std::snprintf(sample_path, sizeof(sample_path), "samples/%s_sample_%d.jpg", channel_id, dbg_idx);
  cv::Mat out_bgr = cv::imread(sample_path, cv::IMREAD_COLOR);
  if (out_bgr.empty()) {
    std::fprintf(stderr, "error: cannot read %s for output\n", sample_path);
    return 6;
  }
  if (out_bgr.cols != ref_w || out_bgr.rows != ref_h) {
    cv::resize(out_bgr, out_bgr, cv::Size(ref_w, ref_h), 0, 0, cv::INTER_AREA);
  }
  logo_rect_full &= cv::Rect(0, 0, out_bgr.cols, out_bgr.rows);

  cv::Mat logo_crop = out_bgr(logo_rect_full).clone();
  char out_logo[512];
  std::snprintf(out_logo, sizeof(out_logo), "output/%s_logo.jpg", channel_id);
  if (!cv::imwrite(out_logo, logo_crop)) {
    std::fprintf(stderr, "error: imwrite %s failed\n", out_logo);
    return 7;
  }

  cv::Mat dbg = out_bgr.clone();
  cv::rectangle(dbg, logo_rect_full, cv::Scalar(0, 0, 255), 2, cv::LINE_AA);
  char out_dbg[512];
  std::snprintf(out_dbg, sizeof(out_dbg), "output/%s_debug.jpg", channel_id);
  if (!cv::imwrite(out_dbg, dbg)) {
    std::fprintf(stderr, "error: imwrite %s failed\n", out_dbg);
    return 8;
  }

  std::string esc_id;
  json_escape(channel_id, esc_id);

  char out_json[512];
  std::snprintf(out_json, sizeof(out_json), "output/%s.json", channel_id);
  FILE* fp = std::fopen(out_json, "w");
  if (!fp) {
    std::fprintf(stderr, "error: fopen %s failed\n", out_json);
    return 9;
  }
  std::fprintf(fp, "{\n");
  std::fprintf(fp, "  \"channel_id\": \"%s\",\n", esc_id.c_str());
  std::fprintf(fp, "  \"logo_bbox\": { \"x\": %d, \"y\": %d, \"width\": %d, \"height\": %d },\n",
      logo_rect_full.x, logo_rect_full.y, logo_rect_full.width, logo_rect_full.height);
  std::fprintf(fp, "  \"reference_frame\": { \"width\": %d, \"height\": %d },\n", ref_w, ref_h);
  std::fprintf(fp, "  \"confidence_score\": %.6f,\n", conf);
  std::fprintf(fp, "  \"orb_fallback_score\": %.6f,\n", orb_score);
  std::fprintf(fp, "  \"samples_used\": %d,\n", kSamples);
  std::fprintf(fp, "  \"detection\": {\n");
  std::fprintf(fp, "    \"method\": \"temporal_variance_grid\",\n");
  std::fprintf(fp, "    \"proc_size\": { \"width\": %d, \"height\": %d },\n", PW, PH);
  std::fprintf(fp, "    \"cell_px\": %d,\n", kProcCell);
  std::fprintf(fp, "    \"var_threshold\": %.8f,\n", static_cast<double>(T_var));
  std::fprintf(fp, "    \"stable_components\": %d,\n", ncc - 1);
  std::fprintf(fp, "    \"candidates_scored\": %d,\n", cand_regions);
  std::fprintf(fp, "    \"selected_label\": %d,\n", best_lbl);
  std::fprintf(fp, "    \"bbox_refinement_applied\": %s\n", refine_ok ? "true" : "false");
  std::fprintf(fp, "  }\n");
  std::fprintf(fp, "}\n");
  std::fclose(fp);

  remove_channel_sample_jpegs(channel_id);

  std::printf("ok: %s bbox=(%d,%d,%d,%d) conf=%.4f -> %s\n", channel_id, logo_rect_full.x,
      logo_rect_full.y, logo_rect_full.width, logo_rect_full.height, conf, out_json);
  return 0;
}
