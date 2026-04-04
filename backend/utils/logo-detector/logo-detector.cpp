/**
 * Multi-template, multi-scale OpenCV matcher against one frame from an HLS (m3u8) URL.
 *
 * Usage:
 *   ./logo-detector [--debug] [--live-probe-interval-ms <ms>] <logo1.png> [logo2.jpg ...] <https://host/master.m3u8>
 *
 * --live-probe-interval-ms is optional metadata from the orchestrator (target ms between live probes);
 * echoed in JSON as live_probe_interval_ms for logging; does not change matching behavior.
 *
 * The last argument must be an http(s) URL. All preceding arguments are local logo image paths.
 * Grabs one frame via ffmpeg, runs TM_CCOEFF_NORMED matchTemplate at multiple template scales.
 * Each logo template is matched in parallel (one thread per file); the first template to reach a
 * positive (score ≥ threshold) sets a cancel flag so other threads stop scaling early. Debug overlay
 * uses that first winner’s bbox (not the highest score among all positives).
 *
 * --debug writes a single JPEG (overwritten each run) with a green rectangle on match, or
 * red "[NO LOGO FOUND]" text when no template exceeds the threshold. Path from env
 * LOGO_DETECTOR_DEBUG_PATH (required for output when debugging).
 *
 * Env (optional):
 *   LOGO_DETECTOR_THRESHOLD        — min score to count as matched (default 0.78)
 *   LOGO_DETECTOR_SCALE_MIN        — default 0.72
 *   LOGO_DETECTOR_SCALE_MAX        — default 1.28
 *   LOGO_DETECTOR_SCALE_STEPS      — default 17
 *   LOGO_DETECTOR_DEBUG            — 1/true enables debug image (also --debug)
 *   LOGO_DETECTOR_DEBUG_PATH       — absolute path to output JPEG (overwrite each run; backend uses per-channel name)
 *   LOGO_DETECTOR_FFMPEG_UA        — User-Agent for ffmpeg when pulling HLS (default: browser-like)
 *   LOGO_DETECTOR_FFMPEG_RW_TIMEOUT_US — ffmpeg -rw_timeout in microseconds (default 20000000)
 *   LOGO_DETECTOR_HLS_FROM_START   — if 1/true, decode from first playlist segment (legacy). Default: use
 *                                    -live_start_index -1 so the single frame matches the live edge / end of
 *                                    the DVR window (must align with m3u8 endTime used for timestamps).
 *
 * Build:
 *   make -C backend/utils/logo-detector
 *
 * Requires: OpenCV 4+, ffmpeg in PATH.
 *
 * If ffmpeg prints "Output file does not contain any stream" / "Invalid argument" on the JPEG output,
 * the muxer received no decoded video frames (empty HLS window, CDN deny, slow segment fetch, etc.).
 * This binary adds HLS-friendly input flags and yuvj420p before MJPEG to reduce spurious muxer failures.
 */

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <mutex>
#include <string>
#include <strings.h>
#include <thread>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>
#include <vector>

#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>

namespace {

double env_double(const char *key, double def) {
  const char *v = std::getenv(key);
  if (!v || !*v) return def;
  char *end = nullptr;
  double x = std::strtod(v, &end);
  if (end == v) return def;
  return x;
}

int env_int(const char *key, int def) {
  const char *v = std::getenv(key);
  if (!v || !*v) return def;
  char *end = nullptr;
  long x = std::strtol(v, &end, 10);
  if (end == v) return def;
  if (x < 1) return 1;
  if (x > 64) return 64;
  return static_cast<int>(x);
}

bool env_truthy(const char *key) {
  const char *v = std::getenv(key);
  if (!v || !*v) return false;
  if (std::strcmp(v, "1") == 0) return true;
  return strcasecmp(v, "true") == 0 || strcasecmp(v, "yes") == 0;
}

bool is_http_url(const char *s) {
  return s && (std::strncmp(s, "http://", 7) == 0 || std::strncmp(s, "https://", 8) == 0);
}

std::string tmp_frame_path() {
  const auto us = std::chrono::duration_cast<std::chrono::microseconds>(
                      std::chrono::system_clock::now().time_since_epoch())
                      .count();
  std::ostringstream oss;
  oss << "/tmp/logo-detector-" << static_cast<long long>(getpid()) << "-" << us << ".jpg";
  return oss.str();
}

int run_ffmpeg_one_frame(const char *input_url, const std::string &out_jpg) {
  const char *ua = std::getenv("LOGO_DETECTOR_FFMPEG_UA");
  if (!ua || !*ua) {
    ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  }
  const char *rw_us = std::getenv("LOGO_DETECTOR_FFMPEG_RW_TIMEOUT_US");
  if (!rw_us || !*rw_us) rw_us = "20000000";  // 20s read/write timeout (many CDNs need this)

  // HLS/CDN: whitelist + genpts reduce empty demux; explicit video map + MJPEG pixel format avoid image2
  // muxer edge cases ("Output file does not contain any stream" / "Invalid argument" when no frames arrive).
  std::vector<std::string> storage;
  storage.emplace_back("ffmpeg");
  storage.emplace_back("-nostdin");
  storage.emplace_back("-hide_banner");
  storage.emplace_back("-loglevel");
  storage.emplace_back("error");
  storage.emplace_back("-user_agent");
  storage.emplace_back(ua);
  storage.emplace_back("-rw_timeout");
  storage.emplace_back(rw_us);
  storage.emplace_back("-protocol_whitelist");
  storage.emplace_back("file,http,https,tcp,tls,crypto,subfile");
  storage.emplace_back("-fflags");
  storage.emplace_back("+discardcorrupt+genpts");
  /**
   * Without this, HLS demux starts at the first listed segment (oldest in the window) while the backend
   * timestamps samples from playlist end / endTime — tens of seconds to minutes of skew vs the player.
   */
  const char *hls_from_start = std::getenv("LOGO_DETECTOR_HLS_FROM_START");
  const bool force_first_segment = hls_from_start && env_truthy(hls_from_start);
  if (is_http_url(input_url) && !force_first_segment) {
    storage.emplace_back("-live_start_index");
    storage.emplace_back("-1");
  }
  storage.emplace_back("-y");
  storage.emplace_back("-i");
  storage.emplace_back(input_url);
  storage.emplace_back("-an");
  storage.emplace_back("-sn");
  storage.emplace_back("-dn");
  // Optional map: some HLS windows / CDN responses expose audio-only briefly; bare 0:v:0 aborts
  // during option parsing ("matches no streams") before any decode attempt.
  storage.emplace_back("-map");
  storage.emplace_back("0:v:0?");
  storage.emplace_back("-frames:v");
  storage.emplace_back("1");
  storage.emplace_back("-pix_fmt");
  storage.emplace_back("yuvj420p");
  storage.emplace_back("-q:v");
  storage.emplace_back("3");
  storage.emplace_back(out_jpg);

  std::vector<char *> argv;
  argv.reserve(storage.size() + 1);
  for (auto &s : storage) argv.push_back(s.data());
  argv.push_back(nullptr);

  pid_t pid = fork();
  if (pid < 0) return -1;
  if (pid == 0) {
    execvp("ffmpeg", argv.data());
    _exit(127);
  }
  int st = 0;
  if (waitpid(pid, &st, 0) < 0) return -1;
  if (!WIFEXITED(st) || WEXITSTATUS(st) != 0) return -1;
  struct stat sb {};
  if (stat(out_jpg.c_str(), &sb) != 0 || sb.st_size < 32) return -1;
  return 0;
}

void json_escape(const std::string &s, std::ostream &os) {
  os << '"';
  for (unsigned char c : s) {
    switch (c) {
      case '"':
        os << "\\\"";
        break;
      case '\\':
        os << "\\\\";
        break;
      case '\b':
        os << "\\b";
        break;
      case '\f':
        os << "\\f";
        break;
      case '\n':
        os << "\\n";
        break;
      case '\r':
        os << "\\r";
        break;
      case '\t':
        os << "\\t";
        break;
      default:
        if (c < 0x20)
          os << "\\u" << std::hex << std::setw(4) << std::setfill('0') << static_cast<int>(c) << std::dec
             << std::setfill(' ');
        else
          os << c;
    }
  }
  os << '"';
}

struct MatchOut {
  std::string path;
  double best_score{};
  bool matched{};
  int bbox_x{-1};
  int bbox_y{-1};
  int bbox_w{0};
  int bbox_h{0};
};

MatchOut match_logo_multiscale(const cv::Mat &frame_gray, const cv::Mat &tpl_bgr, double thr, double smin,
                               double smax, int steps, const std::atomic<bool> *cancel) {
  MatchOut out;
  cv::Mat tpl_gray;
  if (tpl_bgr.channels() == 3)
    cv::cvtColor(tpl_bgr, tpl_gray, cv::COLOR_BGR2GRAY);
  else if (tpl_bgr.channels() == 4)
    cv::cvtColor(tpl_bgr, tpl_gray, cv::COLOR_BGRA2GRAY);
  else
    tpl_gray = tpl_bgr.clone();

  if (tpl_gray.empty() || frame_gray.empty()) return out;

  const int tw0 = tpl_gray.cols;
  const int th0 = tpl_gray.rows;
  if (tw0 < 4 || th0 < 4) return out;

  double best = -1.0;
  int best_x = -1, best_y = -1, best_w = 0, best_h = 0;
  if (steps < 1) steps = 1;
  for (int i = 0; i < steps; i++) {
    if (cancel && cancel->load(std::memory_order_acquire)) {
      out.best_score = best >= 0 ? best : 0.0;
      out.matched = false;
      if (best >= 0 && best_w > 0 && best_h > 0) {
        out.bbox_x = best_x;
        out.bbox_y = best_y;
        out.bbox_w = best_w;
        out.bbox_h = best_h;
      }
      return out;
    }

    double t = steps == 1 ? 0.0 : static_cast<double>(i) / static_cast<double>(steps - 1);
    double scale = smin + t * (smax - smin);
    int tw = std::max(4, static_cast<int>(std::lround(tw0 * scale)));
    int th = std::max(4, static_cast<int>(std::lround(th0 * scale)));
    if (tw > frame_gray.cols || th > frame_gray.rows) continue;

    cv::Mat resized;
    cv::resize(tpl_gray, resized, cv::Size(tw, th), 0, 0, scale < 1.0 ? cv::INTER_AREA : cv::INTER_LINEAR);
    if (resized.cols > frame_gray.cols || resized.rows > frame_gray.rows) continue;

    cv::Mat result;
    cv::matchTemplate(frame_gray, resized, result, cv::TM_CCOEFF_NORMED);
    double minv, maxv;
    cv::Point max_loc;
    cv::minMaxLoc(result, &minv, &maxv, nullptr, &max_loc);
    if (maxv > best) {
      best = maxv;
      best_x = max_loc.x;
      best_y = max_loc.y;
      best_w = tw;
      best_h = th;
    }
    if (maxv >= thr && best_w > 0 && best_h > 0) {
      out.best_score = maxv;
      out.matched = true;
      out.bbox_x = max_loc.x;
      out.bbox_y = max_loc.y;
      out.bbox_w = tw;
      out.bbox_h = th;
      return out;
    }
  }

  out.best_score = best >= 0 ? best : 0.0;
  out.matched = out.best_score >= thr;
  if (best >= 0 && best_w > 0 && best_h > 0) {
    out.bbox_x = best_x;
    out.bbox_y = best_y;
    out.bbox_w = best_w;
    out.bbox_h = best_h;
  }
  return out;
}

void append_bbox_json(std::ostream &json, const MatchOut &r) {
  if (r.matched && r.bbox_w > 0 && r.bbox_h > 0 && r.bbox_x >= 0 && r.bbox_y >= 0) {
    int cx = r.bbox_x + r.bbox_w / 2;
    int cy = r.bbox_y + r.bbox_h / 2;
    json << "\"bbox\":{\"x\":" << r.bbox_x << ",\"y\":" << r.bbox_y << ",\"width\":" << r.bbox_w << ",\"height\":"
         << r.bbox_h << ",\"center\":{\"x\":" << cx << ",\"y\":" << cy << "}}";
  } else {
    json << "\"bbox\":null";
  }
}

/**
 * Overwrites out_path each run. Green rectangle if matched; otherwise large red "[NO LOGO FOUND]".
 */
/** When ffmpeg cannot produce a frame, still refresh the debug JPEG so UIs are not stuck for minutes. */
void write_debug_ffmpeg_failed_stub(const char *out_path) {
  if (!out_path || !*out_path) return;
  cv::Mat stub(360, 640, CV_8UC3, cv::Scalar(32, 32, 32));
  const char *msg = "Frame grab failed (ffmpeg / HLS)";
  int font = cv::FONT_HERSHEY_SIMPLEX;
  const double scale = 0.9;
  const int thick = 2;
  int baseline = 0;
  cv::Size tsize = cv::getTextSize(msg, font, scale, thick, &baseline);
  int tx = std::max(0, (stub.cols - tsize.width) / 2);
  int ty = std::max(tsize.height + 20, stub.rows / 2);
  cv::putText(stub, msg, cv::Point(tx, ty), font, scale, cv::Scalar(80, 180, 255), thick, cv::LINE_AA);
  cv::imwrite(out_path, stub);
}

void write_debug_image(const cv::Mat &frame_bgr, bool matched, int bx, int by, int bw, int bh,
                       const char *out_path) {
  if (!out_path || !*out_path) return;
  cv::Mat out = frame_bgr.clone();
  if (matched && bw > 0 && bh > 0 && bx >= 0 && by >= 0) {
    cv::rectangle(out, cv::Rect(bx, by, bw, bh), cv::Scalar(0, 255, 0), 3, cv::LINE_AA);
  } else {
    const char *msg = "[NO LOGO FOUND]";
    int font = cv::FONT_HERSHEY_SIMPLEX;
    double scale = std::min(3.0, std::max(1.2, static_cast<double>(out.cols) / 640.0 * 2.0));
    int thick = std::max(3, static_cast<int>(scale * 2));
    int baseline = 0;
    cv::Size tsize = cv::getTextSize(msg, font, scale, thick, &baseline);
    int tx = std::max(0, (out.cols - tsize.width) / 2);
    int ty = std::max(tsize.height + 8, (out.rows + tsize.height) / 2);
    cv::putText(out, msg, cv::Point(tx, ty), font, scale, cv::Scalar(0, 0, 255), thick, cv::LINE_AA);
  }
  if (!cv::imwrite(out_path, out)) {
    std::cerr << "logo-detector: failed to write debug image: " << out_path << "\n";
  }
}

void print_usage(const char *argv0) {
  std::cerr << "Usage: " << argv0
            << " [--debug] [--live-probe-interval-ms <ms>] <logo.png> [more logos...] <https://.../stream.m3u8>\n";
}

}  // namespace

int main(int argc, char **argv) {
  if (argc < 3) {
    print_usage(argv[0]);
    return 1;
  }

  bool debug_cli = false;
  int live_probe_interval_ms = -1;
  std::vector<std::string> positionals;
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--debug") == 0) {
      debug_cli = true;
      continue;
    }
    if (std::strcmp(argv[i], "--live-probe-interval-ms") == 0 && i + 1 < argc) {
      char *end = nullptr;
      long v = std::strtol(argv[++i], &end, 10);
      if (end != argv[i] && end && *end == '\0' && v >= 1 && v <= 86400000)
        live_probe_interval_ms = static_cast<int>(v);
      continue;
    }
    positionals.push_back(argv[i]);
  }

  if (positionals.size() < 2) {
    print_usage(argv[0]);
    return 1;
  }

  const std::string &m3u8_str = positionals.back();
  const char *m3u8 = m3u8_str.c_str();
  if (!is_http_url(m3u8)) {
    std::cerr << "Last argument must be an http(s) m3u8 URL.\n";
    print_usage(argv[0]);
    return 1;
  }

  std::vector<std::string> logos;
  logos.reserve(positionals.size() - 1);
  for (size_t i = 0; i + 1 < positionals.size(); ++i) logos.push_back(positionals[i]);

  const bool debug_mode = debug_cli || env_truthy("LOGO_DETECTOR_DEBUG");
  const char *debug_path_env = std::getenv("LOGO_DETECTOR_DEBUG_PATH");
  const std::string debug_path =
      (debug_path_env && *debug_path_env) ? std::string(debug_path_env) : std::string();

  const double thr = env_double("LOGO_DETECTOR_THRESHOLD", 0.78);
  const double smin = env_double("LOGO_DETECTOR_SCALE_MIN", 0.72);
  const double smax = env_double("LOGO_DETECTOR_SCALE_MAX", 1.28);
  const int steps = env_int("LOGO_DETECTOR_SCALE_STEPS", 17);

  std::string frame_path = tmp_frame_path();
  if (run_ffmpeg_one_frame(m3u8, frame_path) != 0) {
    ::unlink(frame_path.c_str());
    if (debug_mode && !debug_path.empty()) {
      write_debug_ffmpeg_failed_stub(debug_path.c_str());
    }
    std::cout << "{\"ok\":false,\"error\":\"ffmpeg_frame_failed\"";
    if (live_probe_interval_ms >= 0) std::cout << ",\"live_probe_interval_ms\":" << live_probe_interval_ms;
    std::cout << "}\n";
    return 1;
  }

  cv::Mat frame = cv::imread(frame_path, cv::IMREAD_COLOR);
  ::unlink(frame_path.c_str());
  if (frame.empty()) {
    std::cout << "{\"ok\":false,\"error\":\"decode_frame_failed\"";
    if (live_probe_interval_ms >= 0) std::cout << ",\"live_probe_interval_ms\":" << live_probe_interval_ms;
    std::cout << "}\n";
    return 1;
  }

  cv::Mat frame_gray;
  cv::cvtColor(frame, frame_gray, cv::COLOR_BGR2GRAY);

  std::vector<MatchOut> results(logos.size());
  std::atomic<bool> cancel{false};
  std::mutex winner_mtx;
  int first_winner = -1;

  std::vector<std::thread> workers;
  workers.reserve(logos.size());
  for (size_t i = 0; i < logos.size(); ++i) {
    workers.emplace_back([&, i]() {
      MatchOut mo;
      mo.path = logos[i];
      cv::Mat tpl = cv::imread(logos[i], cv::IMREAD_COLOR);
      if (tpl.empty()) {
        mo.best_score = 0.0;
        mo.matched = false;
      } else {
        mo = match_logo_multiscale(frame_gray, tpl, thr, smin, smax, steps, &cancel);
      }
      results[i] = std::move(mo);
      if (results[i].matched) {
        std::lock_guard<std::mutex> lock(winner_mtx);
        if (first_winner < 0) {
          first_winner = static_cast<int>(i);
          cancel.store(true, std::memory_order_release);
        }
      }
    });
  }
  for (auto &w : workers) w.join();

  const bool any_matched = first_winner >= 0;
  double best_overall = 0.0;
  for (const auto &r : results) {
    if (r.best_score > best_overall) best_overall = r.best_score;
  }

  const int win_idx = first_winner;
  const double reported_match_score =
      (win_idx >= 0) ? results[static_cast<size_t>(win_idx)].best_score : best_overall;

  if (debug_mode) {
    if (debug_path.empty()) {
      std::cerr << "logo-detector: --debug requires LOGO_DETECTOR_DEBUG_PATH (absolute path to output JPEG)\n";
    } else if (win_idx >= 0) {
      const MatchOut &w = results[static_cast<size_t>(win_idx)];
      write_debug_image(frame, true, w.bbox_x, w.bbox_y, w.bbox_w, w.bbox_h, debug_path.c_str());
    } else {
      write_debug_image(frame, false, 0, 0, 0, 0, debug_path.c_str());
    }
  }

  std::ostringstream json;
  json << std::fixed << std::setprecision(6);
  json << "{";
  json << "\"ok\":true";
  if (live_probe_interval_ms >= 0) json << ",\"live_probe_interval_ms\":" << live_probe_interval_ms;
  json << ",\"threshold\":" << thr;
  json << ",\"frame_width\":" << frame.cols;
  json << ",\"frame_height\":" << frame.rows;
  json << ",\"logo\":" << (any_matched ? "true" : "false");
  json << ",\"logo_present\":" << (any_matched ? "true" : "false");
  json << ",\"match_skipped\":false";
  json << ",\"match_score\":" << reported_match_score;
  json << ",\"any_matched\":" << (any_matched ? "true" : "false");
  json << ",\"debug_image\":";
  if (debug_mode && !debug_path.empty())
    json_escape(debug_path, json);
  else
    json << "null";
  json << ",\"match_bbox\":";
  if (win_idx >= 0) {
    const MatchOut &w = results[static_cast<size_t>(win_idx)];
    int cx = w.bbox_x + w.bbox_w / 2;
    int cy = w.bbox_y + w.bbox_h / 2;
    json << "{\"x\":" << w.bbox_x << ",\"y\":" << w.bbox_y << ",\"width\":" << w.bbox_w << ",\"height\":" << w.bbox_h
         << ",\"center\":{\"x\":" << cx << ",\"y\":" << cy << "},\"template_index\":" << win_idx << "}";
  } else {
    json << "null";
  }
  json << ",\"logos\":[";
  for (size_t i = 0; i < results.size(); i++) {
    if (i) json << ',';
    const MatchOut &r = results[i];
    json << '{';
    json << "\"path\":";
    json_escape(r.path, json);
    json << ",\"matched\":" << (r.matched ? "true" : "false");
    json << ",\"best_score\":" << r.best_score;
    json << ',';
    append_bbox_json(json, r);
    json << '}';
  }
  json << "]}";
  json << "\n";

  std::cout << json.str();
  return 0;
}
