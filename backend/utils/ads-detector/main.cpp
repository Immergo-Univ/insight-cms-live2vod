#include "http.h"
#include "json_util.h"
#include "logo_detector.h"
#include "m3u8.h"
#include "time_util.h"

#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc/imgproc.hpp>
#include <opencv2/videoio.hpp>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <memory>
#include <numeric>
#include <optional>
#include <random>
#include <sstream>
#include <thread>
#include <atomic>
#include <mutex>
#include <unordered_map>
#include <unordered_set>
#include <stdexcept>
#include <string>
#include <vector>

namespace fs = std::filesystem;

struct Args {
  std::string m3u8;
  std::string outputPath = "ads.json";
  double sampleEverySec = 5.0;
  double roiWidthPct = 0.15;  // ROI side = roiWidthPct * source width (square)
  int k = 2;
  double minAdSec = 60.0;
  int smoothWindow = 3;          // moving average window over distances (1 = disabled)
  double enterMult = 1.25;       // enter AD if dist >= threshold * enterMult
  double exitMult = 1.00;        // exit AD if dist <= threshold * exitMult (must be <= enterMult)
  int enterConsecutive = 1;      // require N consecutive no-logo samples to enter AD
  int exitConsecutive = 1;       // require N consecutive logo samples to exit AD
  bool outlier = false;          // if true, use DBSCAN on PCA points instead of Bhattacharyya distance
  std::string outlierMode = "dbscan"; // dbscan | lof | knn
  double dbscanEps = 0.0;        // 0 = auto
  int dbscanMinPts = 5;
  int lofK = 10;
  double lofThreshold = 1.60;
  int knnK = 10;
  double knnQuantile = 0.95;
  bool tokayo = false;
  double tokayoTh = 0.5;       // NCC threshold (0 = auto-detect from gap in scores)
  bool debug = false;
  bool quiet = false;
  int cornerIndex = -1;  // 0 TL, 1 TR, 2 BL, 3 BR (required)
  int threads = 0;       // 0 = auto (use available cores)
};

static bool startsWith(const std::string& s, const std::string& prefix) {
  return s.rfind(prefix, 0) == 0;
}

static std::string nowStamp() {
  using namespace std::chrono;
  const auto tp = system_clock::now();
  const auto tt = system_clock::to_time_t(tp);
  std::tm tm{};
  localtime_r(&tt, &tm);
  std::ostringstream out;
  out << std::put_time(&tm, "%Y-%m-%d %H:%M:%S");
  return out.str();
}

static void progress(const Args& args, const std::string& msg) {
  if (args.quiet) return;
  std::cerr << "[" << nowStamp() << "] ads_detector: " << msg << std::endl;
}

static std::string formatHms(double seconds) {
  if (!(seconds >= 0.0)) seconds = 0.0;
  const int total = static_cast<int>(std::llround(seconds));
  const int h = total / 3600;
  const int m = (total % 3600) / 60;
  const int s = total % 60;
  std::ostringstream out;
  out << std::setw(2) << std::setfill('0') << h << ":"
      << std::setw(2) << std::setfill('0') << m << ":"
      << std::setw(2) << std::setfill('0') << s;
  return out.str();
}

static std::string formatSec(double seconds) {
  std::ostringstream out;
  out << std::fixed << std::setprecision(6) << seconds << "s";
  return out.str();
}

static std::string readFile(const std::string& path) {
  std::ifstream in(path);
  if (!in.is_open()) throw std::runtime_error("could not open file: " + path);
  return std::string(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
}

static void ensureParentDirExists(const fs::path& filePath) {
  const fs::path parent = filePath.parent_path();
  if (parent.empty()) return;
  std::error_code ec;
  fs::create_directories(parent, ec);
  if (ec) {
    throw std::runtime_error("could not create output directory: " + parent.string() + " (" + ec.message() + ")");
  }
}

static bool readFrameAt(cv::VideoCapture& cap, double tSec, cv::Mat& outFrame) {
  cap.set(cv::CAP_PROP_POS_MSEC, tSec * 1000.0);
  if (!cap.read(outFrame)) return false;
  return !outFrame.empty();
}

static bool hasLogoAt(cv::VideoCapture& cap,
                      double tSec,
                      const Args& args,
                      const logo_detector::LogoModel& model,
                      double* outDistOrNull = nullptr) {
  cv::Mat frame;
  if (!readFrameAt(cap, tSec, frame)) return false;
  const double dist = logo_detector::distanceToLogo(frame, model.cornerIndex, args.roiWidthPct, model.meanHist);
  if (outDistOrNull) *outDistOrNull = dist;
  return dist <= model.threshold;
}

static int computeThreadCount(int threads) {
  const int detectedCores = static_cast<int>(std::thread::hardware_concurrency());
  const int wanted = (threads <= 0) ? (detectedCores > 0 ? detectedCores : 1) : threads;
  return std::max(1, wanted);
}

struct RefineProbe {
  size_t adIdx = 0;
  bool isStartWindow = true;
  size_t pos = 0;
  double tSec = 0.0;
};

struct TokayoModel {
  cv::Mat logoTemplate;    // grayscale logo sub-region extracted from pixel-wise median
  cv::Rect logoSubRect;    // position of the logo within the corner ROI
  double nccThreshold;     // NCC threshold for logo/no-logo classification
  int cornerIndex;
  double roiWidthPct;
};

static double mahalanobisDistance2D(const cv::Point2f& pt, const cv::Point2d& center,
                                   const cv::Mat& covInv) {
  const double dx = pt.x - center.x;
  const double dy = pt.y - center.y;
  const double d2 = dx * dx * covInv.at<double>(0, 0) +
                    2.0 * dx * dy * covInv.at<double>(0, 1) +
                    dy * dy * covInv.at<double>(1, 1);
  return std::sqrt(std::max(0.0, d2));
}

static bool evaluateHasLogoParallelProbes(const std::string& source,
                                          const Args& args,
                                          const logo_detector::LogoModel& model,
                                          double totalDurationSec,
                                          const std::vector<RefineProbe>& probes,
                                          std::vector<char>& outHasLogo,
                                          const TokayoModel* tokayo = nullptr) {
  outHasLogo.assign(probes.size(), 0);
  if (probes.empty()) return true;

  const int wantedThreads = computeThreadCount(args.threads);
  // Avoid opening more VideoCaptures than work items (HLS open/seek is expensive).
  const int threadCount = std::max(1, std::min(wantedThreads, static_cast<int>(probes.size())));
  std::vector<std::vector<int>> buckets(static_cast<size_t>(threadCount));
  for (int i = 0; i < static_cast<int>(probes.size()); i++) {
    const double t = probes[static_cast<size_t>(i)].tSec;
    const int bucket =
        std::min(threadCount - 1,
                 std::max(0, static_cast<int>(((totalDurationSec > 0.0) ? (t / totalDurationSec) : 0.0) * threadCount)));
    buckets[static_cast<size_t>(bucket)].push_back(i);
  }
  // Critical for performance: keep per-thread timestamps mostly increasing to reduce costly HLS seeks.
  for (auto& b : buckets) {
    std::sort(b.begin(), b.end(), [&](int a, int c) {
      return probes[static_cast<size_t>(a)].tSec < probes[static_cast<size_t>(c)].tSec;
    });
  }

  std::mutex errorMu;
  std::string firstError;

  auto worker = [&](const std::vector<int>& idxs) {
    try {
      if (idxs.empty()) return;
      cv::VideoCapture cap(source);
      if (!cap.isOpened()) throw std::runtime_error("OpenCV could not open m3u8 in refine worker thread");
      cap.set(cv::CAP_PROP_BUFFERSIZE, 1);

      cv::Mat frame;
      for (int idx : idxs) {
        const double t = probes[static_cast<size_t>(idx)].tSec;
        cap.set(cv::CAP_PROP_POS_MSEC, t * 1000.0);
        if (!cap.read(frame) || frame.empty()) {
          outHasLogo[static_cast<size_t>(idx)] = 0;
        } else if (tokayo) {
          const auto rect = cv::Rect(
            (tokayo->cornerIndex == 1 || tokayo->cornerIndex == 3) ? frame.cols - static_cast<int>(std::lround(frame.cols * tokayo->roiWidthPct)) : 0,
            (tokayo->cornerIndex == 2 || tokayo->cornerIndex == 3) ? frame.rows - static_cast<int>(std::lround(frame.cols * tokayo->roiWidthPct)) : 0,
            static_cast<int>(std::lround(frame.cols * tokayo->roiWidthPct)),
            static_cast<int>(std::lround(frame.cols * tokayo->roiWidthPct)));
          cv::Mat roi = frame(rect & cv::Rect(0, 0, frame.cols, frame.rows));
          cv::Mat gray;
          cv::cvtColor(roi, gray, cv::COLOR_BGR2GRAY);
          cv::GaussianBlur(gray, gray, cv::Size(3, 3), 0);
          const cv::Rect subRect = tokayo->logoSubRect & cv::Rect(0, 0, gray.cols, gray.rows);
          if (subRect.width > 0 && subRect.height > 0 &&
              subRect.width == tokayo->logoTemplate.cols && subRect.height == tokayo->logoTemplate.rows) {
            cv::Mat result;
            cv::matchTemplate(gray(subRect), tokayo->logoTemplate, result, cv::TM_CCOEFF_NORMED);
            outHasLogo[static_cast<size_t>(idx)] = (result.at<float>(0, 0) >= tokayo->nccThreshold) ? 1 : 0;
          } else {
            outHasLogo[static_cast<size_t>(idx)] = 0;
          }
        } else {
          const double dist = logo_detector::distanceToLogo(frame, model.cornerIndex, args.roiWidthPct, model.meanHist);
          outHasLogo[static_cast<size_t>(idx)] = (dist <= model.threshold) ? 1 : 0;
        }
      }
    } catch (const std::exception& e) {
      std::lock_guard<std::mutex> lock(errorMu);
      if (firstError.empty()) firstError = e.what();
    }
  };

  std::vector<std::thread> pool;
  pool.reserve(static_cast<size_t>(threadCount));
  for (int t = 0; t < threadCount; t++) pool.emplace_back(worker, std::cref(buckets[static_cast<size_t>(t)]));
  for (auto& th : pool) th.join();

  if (!firstError.empty()) {
    progress(args, std::string("Refine: error: ") + firstError);
    return false;
  }
  return true;
}

template <typename IntervalT>
static void refineIntervalsIterative(const Args& args,
                                     const std::string& source,
                                     double totalDurationSec,
                                     const logo_detector::LogoModel& model,
                                     std::vector<IntervalT>& ads,
                                     const fs::path* debugDirOrNull,
                                     const TokayoModel* tokayo = nullptr) {
  if (ads.empty()) return;

  const double refineStepSec = 5.0;
  progress(args, "Refinando intervalos (-30s, step=" + std::to_string(refineStepSec) + "s, paralelo)");

  struct PerAd {
    std::vector<double> startTimes;
    std::vector<double> endTimes;
    std::vector<size_t> startProbeIdx;
    std::vector<size_t> endProbeIdx;
  };
  std::vector<PerAd> per;
  per.resize(ads.size());

  std::vector<RefineProbe> probes;
  probes.reserve(ads.size() * 32);

  for (size_t idx = 0; idx < ads.size(); idx++) {
    const double coarseStart = ads[idx].startSec;
    const double coarseEnd = ads[idx].endSec;
    const double startWinA = std::max(0.0, coarseStart - 30.0);
    const double startWinB = std::min(totalDurationSec, coarseStart);
    const double endWinA = std::max(0.0, coarseEnd - 30.0);
    const double endWinB = std::min(totalDurationSec, coarseEnd);

    for (double t = startWinA; t <= startWinB + 1e-9; t += refineStepSec) {
      per[idx].startTimes.push_back(t);
      per[idx].startProbeIdx.push_back(probes.size());
      probes.push_back(RefineProbe{idx, true, per[idx].startTimes.size() - 1, t});
    }
    for (double t = endWinA; t <= endWinB + 1e-9; t += refineStepSec) {
      per[idx].endTimes.push_back(t);
      per[idx].endProbeIdx.push_back(probes.size());
      probes.push_back(RefineProbe{idx, false, per[idx].endTimes.size() - 1, t});
    }
  }

  progress(args, "Refine: probes=" + std::to_string(probes.size()) +
                     ", threads=" + std::to_string(computeThreadCount(args.threads)));

  std::vector<char> probeHas;
  if (!evaluateHasLogoParallelProbes(source, args, model, totalDurationSec, probes, probeHas, tokayo)) {
    progress(args, "Refine: fallo paralelismo; manteniendo intervalos sin refinar");
    return;
  }

  std::ofstream debugCsv;
  if (debugDirOrNull) {
    const fs::path p = (*debugDirOrNull) / "refine_intervals.csv";
    debugCsv.open(p);
    if (debugCsv.is_open()) {
      debugCsv << "idx,coarseStart,coarseEnd,refinedStart,refinedEnd\n";
    }
  }

  for (size_t idx = 0; idx < ads.size(); idx++) {
    auto& it = ads[idx];
    const double coarseStart = it.startSec;
    const double coarseEnd = it.endSec;

    const auto& startTimes = per[idx].startTimes;
    const auto& endTimes = per[idx].endTimes;
    std::vector<char> startHas(startTimes.size(), 0);
    std::vector<char> endHas(endTimes.size(), 0);
    for (size_t i = 0; i < startHas.size(); i++) {
      const size_t pIdx = per[idx].startProbeIdx[i];
      if (pIdx < probeHas.size()) startHas[i] = probeHas[pIdx];
    }
    for (size_t i = 0; i < endHas.size(); i++) {
      const size_t pIdx = per[idx].endProbeIdx[i];
      if (pIdx < probeHas.size()) endHas[i] = probeHas[pIdx];
    }

    // Refine start: scan forward, find the first second where logo disappears.
    double refinedStart = coarseStart;
    if (!startHas.empty() && startHas[0] == 0) {
      refinedStart = startTimes[0];
    } else {
      for (size_t i = 1; i < startHas.size(); i++) {
        if (startHas[i - 1] != 0 && startHas[i] == 0) {
          refinedStart = startTimes[i];
          break;
        }
      }
    }

    // Refine end: scan forward, find the first second where logo appears.
    double refinedEnd = coarseEnd;
    {
      // We expect this window to straddle the end boundary; pick the first second where logo is present.
      // If logo is already present at endWinA, refinedEnd becomes endWinA.
      for (size_t i = 0; i < endHas.size(); i++) {
        if (endHas[i] != 0) {
          refinedEnd = endTimes[i];
          break;
        }
      }
    }

    if (refinedEnd < refinedStart) {
      refinedStart = coarseStart;
      refinedEnd = coarseEnd;
    }

    if (debugCsv.is_open()) {
      debugCsv << idx << "," << coarseStart << "," << coarseEnd << "," << refinedStart << "," << refinedEnd << "\n";
    }

    if (refinedStart != coarseStart || refinedEnd != coarseEnd) {
      progress(args,
               "Refine AD#" + std::to_string(idx) + ": " +
                   formatSec(coarseStart) + " (" + formatHms(coarseStart) + ") -> " +
                   formatSec(coarseEnd) + " (" + formatHms(coarseEnd) + ")" +
                   "  =>  " +
                   formatSec(refinedStart) + " (" + formatHms(refinedStart) + ") -> " +
                   formatSec(refinedEnd) + " (" + formatHms(refinedEnd) + ")");
    }

    it.startSec = refinedStart;
    it.endSec = refinedEnd;
  }
}

static std::vector<cv::Point2f> pcaPoints(const logo_detector::TrainingOutput& training) {
  std::vector<cv::Point2f> pts;
  if (training.pca2d.empty() || training.pca2d.cols < 2) return pts;
  pts.reserve(static_cast<size_t>(training.pca2d.rows));
  for (int i = 0; i < training.pca2d.rows; i++) {
    pts.emplace_back(training.pca2d.at<float>(i, 0), training.pca2d.at<float>(i, 1));
  }
  return pts;
}

static double autoDbscanEps(const std::vector<cv::Point2f>& pts, int minPts) {
  const int n = static_cast<int>(pts.size());
  if (n <= 2) return 0.0;
  const int k = std::max(2, std::min(minPts, n - 1));

  std::vector<double> kth;
  kth.reserve(static_cast<size_t>(n));
  std::vector<double> d;
  d.reserve(static_cast<size_t>(n - 1));

  for (int i = 0; i < n; i++) {
    d.clear();
    for (int j = 0; j < n; j++) {
      if (i == j) continue;
      const double dx = static_cast<double>(pts[i].x - pts[j].x);
      const double dy = static_cast<double>(pts[i].y - pts[j].y);
      d.push_back(std::sqrt(dx * dx + dy * dy));
    }
    if (static_cast<int>(d.size()) < (k - 1)) continue;
    std::nth_element(d.begin(), d.begin() + (k - 2), d.end());
    kth.push_back(d[static_cast<size_t>(k - 2)]);
  }

  if (kth.empty()) return 0.0;
  std::nth_element(kth.begin(), kth.begin() + kth.size() / 2, kth.end());
  const double median = kth[kth.size() / 2];
  return median * 1.6;
}

static std::vector<int> dbscanLabels(const std::vector<cv::Point2f>& pts, double eps, int minPts) {
  const int n = static_cast<int>(pts.size());
  std::vector<int> labels(static_cast<size_t>(n), -99);  // -99 = unassigned, -1 = noise
  std::vector<char> visited(static_cast<size_t>(n), 0);
  std::vector<char> inSeed(static_cast<size_t>(n), 0);

  const double epsSq = eps * eps;

  auto regionQuery = [&](int idx, std::vector<int>& out) {
    out.clear();
    const auto& p = pts[static_cast<size_t>(idx)];
    for (int j = 0; j < n; j++) {
      const double dx = static_cast<double>(p.x - pts[static_cast<size_t>(j)].x);
      const double dy = static_cast<double>(p.y - pts[static_cast<size_t>(j)].y);
      if ((dx * dx + dy * dy) <= epsSq) out.push_back(j);
    }
  };

  int clusterId = 0;
  std::vector<int> neighbors;
  std::vector<int> neighbors2;
  std::vector<int> seed;

  for (int i = 0; i < n; i++) {
    if (visited[static_cast<size_t>(i)]) continue;
    visited[static_cast<size_t>(i)] = 1;

    regionQuery(i, neighbors);
    if (static_cast<int>(neighbors.size()) < minPts) {
      labels[static_cast<size_t>(i)] = -1;
      continue;
    }

    for (int j = 0; j < n; j++) inSeed[static_cast<size_t>(j)] = 0;
    seed.clear();
    seed.reserve(neighbors.size());
    for (int idx : neighbors) {
      if (!inSeed[static_cast<size_t>(idx)]) {
        inSeed[static_cast<size_t>(idx)] = 1;
        seed.push_back(idx);
      }
    }

    labels[static_cast<size_t>(i)] = clusterId;
    for (size_t si = 0; si < seed.size(); si++) {
      const int p = seed[si];
      if (!visited[static_cast<size_t>(p)]) {
        visited[static_cast<size_t>(p)] = 1;
        regionQuery(p, neighbors2);
        if (static_cast<int>(neighbors2.size()) >= minPts) {
          for (int q : neighbors2) {
            if (!inSeed[static_cast<size_t>(q)]) {
              inSeed[static_cast<size_t>(q)] = 1;
              seed.push_back(q);
            }
          }
        }
      }
      if (labels[static_cast<size_t>(p)] == -99 || labels[static_cast<size_t>(p)] == -1) {
        labels[static_cast<size_t>(p)] = clusterId;
      }
    }

    clusterId++;
  }

  for (int i = 0; i < n; i++) {
    if (labels[static_cast<size_t>(i)] == -99) labels[static_cast<size_t>(i)] = -1;
  }
  return labels;
}

static std::vector<double> lofScores(const std::vector<cv::Point2f>& pts, int k) {
  const int n = static_cast<int>(pts.size());
  std::vector<double> scores(static_cast<size_t>(n), 1.0);
  if (n <= 2) return scores;

  const int kk = std::max(2, std::min(k, n - 1));

  // For each point, compute its k nearest neighbors and k-distance.
  std::vector<std::vector<int>> knn(static_cast<size_t>(n));
  std::vector<double> kdist(static_cast<size_t>(n), 0.0);
  std::vector<std::pair<double, int>> tmp;
  tmp.reserve(static_cast<size_t>(n - 1));

  for (int i = 0; i < n; i++) {
    tmp.clear();
    for (int j = 0; j < n; j++) {
      if (i == j) continue;
      const double dx = static_cast<double>(pts[i].x - pts[j].x);
      const double dy = static_cast<double>(pts[i].y - pts[j].y);
      const double dist = std::sqrt(dx * dx + dy * dy);
      tmp.emplace_back(dist, j);
    }
    if (tmp.empty()) continue;
    const size_t kth = static_cast<size_t>(kk - 1);
    std::nth_element(tmp.begin(), tmp.begin() + kth, tmp.end(),
                     [](const auto& a, const auto& b) { return a.first < b.first; });
    const double kd = tmp[kth].first;
    kdist[static_cast<size_t>(i)] = kd;

    // Collect k nearest neighbors (not all within k-distance; keep exactly k for stability).
    std::partial_sort(tmp.begin(), tmp.begin() + kth + 1, tmp.end(),
                      [](const auto& a, const auto& b) { return a.first < b.first; });
    knn[static_cast<size_t>(i)].clear();
    knn[static_cast<size_t>(i)].reserve(static_cast<size_t>(kk));
    for (int t = 0; t < kk; t++) knn[static_cast<size_t>(i)].push_back(tmp[static_cast<size_t>(t)].second);
  }

  // Local reachability density (lrd).
  std::vector<double> lrd(static_cast<size_t>(n), 0.0);
  for (int i = 0; i < n; i++) {
    const auto& neigh = knn[static_cast<size_t>(i)];
    if (neigh.empty()) {
      lrd[static_cast<size_t>(i)] = 0.0;
      continue;
    }
    double sumReach = 0.0;
    for (int j : neigh) {
      const double dx = static_cast<double>(pts[i].x - pts[j].x);
      const double dy = static_cast<double>(pts[i].y - pts[j].y);
      const double dij = std::sqrt(dx * dx + dy * dy);
      const double reach = std::max(kdist[static_cast<size_t>(j)], dij);
      sumReach += reach;
    }
    if (sumReach <= 1e-12) lrd[static_cast<size_t>(i)] = 1e12;
    else lrd[static_cast<size_t>(i)] = static_cast<double>(neigh.size()) / sumReach;
  }

  // LOF score.
  for (int i = 0; i < n; i++) {
    const auto& neigh = knn[static_cast<size_t>(i)];
    if (neigh.empty() || lrd[static_cast<size_t>(i)] <= 1e-12) {
      scores[static_cast<size_t>(i)] = 1.0;
      continue;
    }
    double sumRatio = 0.0;
    for (int j : neigh) {
      sumRatio += (lrd[static_cast<size_t>(j)] / lrd[static_cast<size_t>(i)]);
    }
    scores[static_cast<size_t>(i)] = sumRatio / static_cast<double>(neigh.size());
  }
  return scores;
}

static double quantile(std::vector<double> v, double q) {
  if (v.empty()) return 0.0;
  if (q <= 0.0) return *std::min_element(v.begin(), v.end());
  if (q >= 1.0) return *std::max_element(v.begin(), v.end());
  const size_t idx = static_cast<size_t>(std::llround(q * static_cast<double>(v.size() - 1)));
  std::nth_element(v.begin(), v.begin() + static_cast<long>(idx), v.end());
  return v[idx];
}

static double knnAvgDistToSeeds(const std::vector<cv::Point2f>& pts,
                                int i,
                                const std::vector<int>& seeds,
                                int k) {
  if (pts.empty() || seeds.empty()) return 0.0;
  std::vector<double> d;
  d.reserve(seeds.size());
  for (int s : seeds) {
    if (s < 0 || s >= static_cast<int>(pts.size())) continue;
    if (s == i) continue;
    const double dx = static_cast<double>(pts[static_cast<size_t>(i)].x - pts[static_cast<size_t>(s)].x);
    const double dy = static_cast<double>(pts[static_cast<size_t>(i)].y - pts[static_cast<size_t>(s)].y);
    d.push_back(std::sqrt(dx * dx + dy * dy));
  }
  if (d.empty()) return 0.0;
  const int kk = std::max(1, std::min(k, static_cast<int>(d.size())));
  std::nth_element(d.begin(), d.begin() + (kk - 1), d.end());
  std::partial_sort(d.begin(), d.begin() + kk, d.end());
  double sum = 0.0;
  for (int t = 0; t < kk; t++) sum += d[static_cast<size_t>(t)];
  return sum / static_cast<double>(kk);
}

static double knnAvgDistToSeedsHist(const cv::Mat& hists,
                                    int i,
                                    const std::vector<int>& seeds,
                                    int k) {
  if (hists.empty() || seeds.empty()) return 0.0;
  if (i < 0 || i >= hists.rows) return 0.0;

  std::vector<double> d;
  d.reserve(seeds.size());
  const cv::Mat hi = hists.row(i);
  for (int s : seeds) {
    if (s < 0 || s >= hists.rows) continue;
    if (s == i) continue;
    const cv::Mat hs = hists.row(s);
    d.push_back(cv::compareHist(hi, hs, cv::HISTCMP_BHATTACHARYYA));
  }
  if (d.empty()) return 0.0;
  const int kk = std::max(1, std::min(k, static_cast<int>(d.size())));
  std::nth_element(d.begin(), d.begin() + (kk - 1), d.end());
  std::partial_sort(d.begin(), d.begin() + kk, d.end());
  double sum = 0.0;
  for (int t = 0; t < kk; t++) sum += d[static_cast<size_t>(t)];
  return sum / static_cast<double>(kk);
}

// ---------------------------------------------------------------------------
// Tokayo mode: MCD (Minimum Covariance Determinant) + Mahalanobis
// ---------------------------------------------------------------------------

struct McdResult {
  cv::Point2d center;
  cv::Mat cov;      // 2x2
  cv::Mat covInv;   // 2x2
  double det;
  std::vector<int> support;  // indices of h-subset
};

static McdResult computeMCD(const std::vector<cv::Point2f>& pts, double supportFraction) {
  const int n = static_cast<int>(pts.size());
  const int h = std::max(3, static_cast<int>(std::ceil(supportFraction * n)));

  auto computeStats = [&](const std::vector<int>& indices)
      -> std::tuple<double, double, cv::Mat> {
    double mx = 0, my = 0;
    for (int i : indices) { mx += pts[i].x; my += pts[i].y; }
    mx /= static_cast<double>(indices.size());
    my /= static_cast<double>(indices.size());

    double c00 = 0, c01 = 0, c11 = 0;
    for (int i : indices) {
      const double dx = pts[i].x - mx;
      const double dy = pts[i].y - my;
      c00 += dx * dx;
      c01 += dx * dy;
      c11 += dy * dy;
    }
    const double nn = std::max(1.0, static_cast<double>(indices.size() - 1));
    c00 /= nn; c01 /= nn; c11 /= nn;
    cv::Mat cov = (cv::Mat_<double>(2, 2) << c00, c01, c01, c11);
    return {mx, my, cov};
  };

  auto regularize = [](cv::Mat& cov) {
    if (cv::determinant(cov) < 1e-15) {
      cov.at<double>(0, 0) += 1e-10;
      cov.at<double>(1, 1) += 1e-10;
    }
  };

  // C-step: compute mean+cov of subset, then pick h closest by Mahalanobis.
  auto cStep = [&](std::vector<int>& indices) -> double {
    auto [mx, my, cov] = computeStats(indices);
    regularize(cov);
    const cv::Mat inv = cov.inv();
    const cv::Point2d center(mx, my);

    std::vector<std::pair<double, int>> dists;
    dists.reserve(n);
    for (int i = 0; i < n; i++) {
      dists.emplace_back(mahalanobisDistance2D(pts[i], center, inv), i);
    }
    std::partial_sort(dists.begin(), dists.begin() + h, dists.end());

    indices.clear();
    indices.reserve(h);
    for (int i = 0; i < h; i++) indices.push_back(dists[i].second);
    return cv::determinant(cov);
  };

  std::mt19937 rng(42);
  double bestDet = std::numeric_limits<double>::max();
  std::vector<int> bestSubset;

  const int nTrials = 20;
  for (int trial = 0; trial < nTrials; trial++) {
    std::vector<int> all(n);
    std::iota(all.begin(), all.end(), 0);
    std::shuffle(all.begin(), all.end(), rng);
    std::vector<int> subset(all.begin(), all.begin() + h);

    double prevDet = std::numeric_limits<double>::max();
    for (int step = 0; step < 100; step++) {
      const double det = cStep(subset);
      if (std::abs(det - prevDet) < 1e-18) break;
      prevDet = det;
    }

    if (prevDet < bestDet) {
      bestDet = prevDet;
      bestSubset = subset;
    }
  }

  auto [mx, my, cov] = computeStats(bestSubset);
  regularize(cov);

  McdResult result;
  result.center = cv::Point2d(mx, my);
  result.cov = cov;
  result.covInv = cov.inv();
  result.det = cv::determinant(cov);
  result.support = bestSubset;
  return result;
}

static void printHelp() {
  std::cout
      << "Usage:\n"
      << "  ads_detector --m3u8 <url_or_path> [--output ads.json] [--every-sec 5] [--interval 5]\n"
      << "               [--roi 0.15] [--k 2] [--threads 0] [--min-ad-sec 6]\n"
      << "               [--smooth 3] [--enter-mult 1.25] [--exit-mult 1.0]\n"
      << "               [--enter-n 3] [--exit-n 5]\n"
      << "               [--outlier] [--outlier-mode dbscan|lof|knn]\n"
      << "               [--dbscan-eps 0] [--dbscan-minpts 5]\n"
      << "               [--lof-k 10] [--lof-th 1.6]\n"
      << "               [--knn-k 7] [--knn-q 0.95]\n"
      << "               [--tokayo] [--tokayo-th 0.0]\n"
      << "               (--tl|--tr|--bl|--br) [--debug] [--quiet]\n";
}

static Args parseArgs(int argc, char** argv) {
  Args a;
  for (int i = 1; i < argc; i++) {
    const std::string arg(argv[i]);
    if (arg == "--help" || arg == "-h") {
      printHelp();
      std::exit(0);
    }
    if (arg == "--debug") {
      a.debug = true;
      continue;
    }
    if (arg == "--outlier") {
      a.outlier = true;
      continue;
    }
    if (arg == "--tokayo") {
      a.tokayo = true;
      continue;
    }
    if (arg == "--quiet") {
      a.quiet = true;
      continue;
    }
    if (arg == "--tl") {
      if (a.cornerIndex != -1) throw std::runtime_error("only one corner flag allowed");
      a.cornerIndex = 0;
      continue;
    }
    if (arg == "--tr") {
      if (a.cornerIndex != -1) throw std::runtime_error("only one corner flag allowed");
      a.cornerIndex = 1;
      continue;
    }
    if (arg == "--bl") {
      if (a.cornerIndex != -1) throw std::runtime_error("only one corner flag allowed");
      a.cornerIndex = 2;
      continue;
    }
    if (arg == "--br") {
      if (a.cornerIndex != -1) throw std::runtime_error("only one corner flag allowed");
      a.cornerIndex = 3;
      continue;
    }
    auto take = [&](const char* name) -> std::string {
      if (i + 1 >= argc) throw std::runtime_error(std::string("missing value for ") + name);
      return std::string(argv[++i]);
    };
    if (arg == "--m3u8") a.m3u8 = take("--m3u8");
    else if (arg == "--output") a.outputPath = take("--output");
    else if (arg == "--every-sec" || arg == "--interval" || arg == "--scan-step-sec") a.sampleEverySec = std::stod(take(arg.c_str()));
    else if (arg == "--threads" || arg == "--therads") a.threads = std::stoi(take(arg.c_str()));
    else if (arg == "--smooth" || arg == "--smooth-window") a.smoothWindow = std::stoi(take(arg.c_str()));
    else if (arg == "--enter-mult") a.enterMult = std::stod(take("--enter-mult"));
    else if (arg == "--exit-mult") a.exitMult = std::stod(take("--exit-mult"));
    else if (arg == "--enter-n" || arg == "--enter-consecutive") a.enterConsecutive = std::stoi(take(arg.c_str()));
    else if (arg == "--exit-n" || arg == "--exit-consecutive") a.exitConsecutive = std::stoi(take(arg.c_str()));
    else if (arg == "--dbscan-eps") a.dbscanEps = std::stod(take("--dbscan-eps"));
    else if (arg == "--dbscan-minpts") a.dbscanMinPts = std::stoi(take("--dbscan-minpts"));
    else if (arg == "--outlier-mode") a.outlierMode = take("--outlier-mode");
    else if (arg == "--lof-k") a.lofK = std::stoi(take("--lof-k"));
    else if (arg == "--lof-th") a.lofThreshold = std::stod(take("--lof-th"));
    else if (arg == "--knn-k") a.knnK = std::stoi(take("--knn-k"));
    else if (arg == "--knn-q" || arg == "--knn-quantile") a.knnQuantile = std::stod(take(arg.c_str()));
    else if (arg == "--tokayo-th") a.tokayoTh = std::stod(take("--tokayo-th"));
    else if (arg == "--roi" || arg == "--roi-pct") {
      double v = std::stod(take(arg.c_str()));
      if (v > 1.0) v = v / 100.0;  // allow passing 10 for 10%
      a.roiWidthPct = v;
    }
    else if (arg == "--k") a.k = std::stoi(take("--k"));
    else if (arg == "--min-ad-sec") a.minAdSec = std::stod(take("--min-ad-sec"));
    else if (a.m3u8.empty() && arg[0] != '-') a.m3u8 = arg;
    else throw std::runtime_error("unknown arg: " + arg);
  }
  if (a.m3u8.empty()) throw std::runtime_error("--m3u8 is required");
  if (a.cornerIndex == -1) {
    throw std::runtime_error("corner flag required: choose one of --tl --tr --bl --br");
  }
  if (a.roiWidthPct <= 0.0 || a.roiWidthPct > 1.0) {
    throw std::runtime_error("--roi must be in (0,1] or (0,100] as percentage");
  }
  if (a.sampleEverySec <= 0.0) {
    throw std::runtime_error("--every-sec must be > 0");
  }
  if (a.threads < 0) {
    throw std::runtime_error("--threads must be >= 0");
  }
  if (a.smoothWindow < 1) {
    throw std::runtime_error("--smooth must be >= 1");
  }
  if (!(a.enterMult > 0.0) || !(a.exitMult > 0.0)) {
    throw std::runtime_error("--enter-mult and --exit-mult must be > 0");
  }
  if (a.exitMult > a.enterMult) {
    throw std::runtime_error("--exit-mult must be <= --enter-mult");
  }
  if (a.enterConsecutive < 1 || a.exitConsecutive < 1) {
    throw std::runtime_error("--enter-n and --exit-n must be >= 1");
  }
  if (a.dbscanEps < 0.0) {
    throw std::runtime_error("--dbscan-eps must be >= 0");
  }
  if (a.dbscanMinPts < 2) {
    throw std::runtime_error("--dbscan-minpts must be >= 2");
  }
  if (!a.outlierMode.empty() && a.outlierMode != "dbscan" && a.outlierMode != "lof" && a.outlierMode != "knn") {
    throw std::runtime_error("--outlier-mode must be one of: dbscan, lof, knn");
  }
  if (a.lofK < 2) {
    throw std::runtime_error("--lof-k must be >= 2");
  }
  if (!(a.lofThreshold > 0.0)) {
    throw std::runtime_error("--lof-th must be > 0");
  }
  if (a.knnK < 1) {
    throw std::runtime_error("--knn-k must be >= 1");
  }
  if (a.knnQuantile <= 0.0 || a.knnQuantile > 1.0) {
    throw std::runtime_error("--knn-q must be in (0,1]");
  }
  if (a.tokayo && a.outlier) {
    throw std::runtime_error("--tokayo and --outlier are mutually exclusive");
  }
  if (a.tokayoTh < 0.0 || a.tokayoTh > 1.0) {
    throw std::runtime_error("--tokayo-th must be in [0,1] (0 = auto-detect)");
  }
  return a;
}

static std::string cornerName(int idx) {
  switch (idx) {
    case 0: return "top_left";
    case 1: return "top_right";
    case 2: return "bottom_left";
    case 3: return "bottom_right";
    default: return "top_left";
  }
}

static fs::path executableDir() {
  std::error_code ec;
  const auto p = fs::read_symlink("/proc/self/exe", ec);
  if (!ec) return p.parent_path();
  return fs::current_path();
}

static std::optional<std::string> offsetToProgramDateTime(
    const std::vector<m3u8::Segment>& segments,
    const std::vector<std::optional<int64_t>>& segEpochMs,
    double offsetSec) {
  if (segments.empty()) return std::nullopt;
  if (offsetSec < 0) return std::nullopt;
  if (offsetSec > segments.back().endOffsetSec) offsetSec = segments.back().endOffsetSec;

  int lo = 0, hi = static_cast<int>(segments.size()) - 1;
  while (lo < hi) {
    const int mid = (lo + hi) / 2;
    if (offsetSec < segments[mid].endOffsetSec) hi = mid;
    else lo = mid + 1;
  }
  const auto& seg = segments[lo];
  if (!segEpochMs[lo].has_value()) return std::nullopt;
  const double within = offsetSec - seg.startOffsetSec;
  const int64_t ms = segEpochMs[lo].value() + static_cast<int64_t>(within * 1000.0);
  return time_util::epochMsToIso8601Utc(ms);
}

static void exportDebugLogos(const Args& args,
                             const fs::path& outDir,
                             const logo_detector::TrainingOutput& training) {
  fs::create_directories(outDir);
  const fs::path samplesDir = outDir / "samples";
  const fs::path logosDir = outDir / "logos";
  fs::create_directories(samplesDir);
  fs::create_directories(logosDir);

  auto writeAtomic = [&](const fs::path& path, const std::vector<unsigned char>& bytes) {
    const fs::path tmp = path.string() + ".tmp";
    {
      std::ofstream f(tmp, std::ios::binary);
      f.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
      f.flush();
    }
    std::error_code ec;
    fs::rename(tmp, path, ec);
    if (ec) {
      fs::remove(path, ec);
      ec.clear();
      fs::rename(tmp, path, ec);
      if (ec) throw std::runtime_error("could not rename tmp file to final png");
    }
  };

  // Export all sampled ROIs (ordered) using the exact bytes captured at seek time.
  for (size_t i = 0; i < training.sampleRoiPng.size(); i++) {
    const auto& bytes = training.sampleRoiPng[i];
    if (bytes.empty()) continue;
    const int64_t tMs = static_cast<int64_t>(training.sampleTimesSec[i] * 1000.0);
    std::ostringstream name;
    name << "sample_" << std::setw(6) << std::setfill('0') << i << "_t" << tMs << ".png";
    writeAtomic(samplesDir / name.str(), bytes);
  }

  // Export only the logo-cluster samples into logos/
  for (int idx : training.model.logoSampleIndices) {
    if (idx < 0 || idx >= static_cast<int>(training.sampleRoiPng.size())) continue;
    const auto& bytes = training.sampleRoiPng[static_cast<size_t>(idx)];
    if (bytes.empty()) continue;
    const int64_t tMs = static_cast<int64_t>(training.sampleTimesSec[static_cast<size_t>(idx)] * 1000.0);
    std::ostringstream name;
    name << "logo_" << std::setw(6) << std::setfill('0') << idx << "_t" << tMs << ".png";
    writeAtomic(logosDir / name.str(), bytes);
  }
}

static void exportDebugPcaPlot(const fs::path& outDir,
                               const logo_detector::TrainingOutput& training,
                               const std::vector<int>* clusterLabels,
                               int logoClusterLabel,
                               const std::string& baseName) {
  if (training.pca2d.empty() || training.pca2d.rows <= 0) return;

  const fs::path csvPath = outDir / (baseName + ".csv");
  {
    std::ofstream csv(csvPath);
    csv << "index,timeSec,x,y,cluster,isLogo\n";
    for (int i = 0; i < training.pca2d.rows; i++) {
      const float x = training.pca2d.at<float>(i, 0);
      const float y = training.pca2d.at<float>(i, 1);
      const int cluster =
          (clusterLabels && i < static_cast<int>(clusterLabels->size())) ? (*clusterLabels)[static_cast<size_t>(i)]
          : (i < static_cast<int>(training.kmeansLabels.size())) ? training.kmeansLabels[static_cast<size_t>(i)]
          : -1;
      const int isLogo = (cluster == logoClusterLabel) ? 1 : 0;
      const double t = training.sampleTimesSec[static_cast<size_t>(i)];
      csv << i << ',' << t << ',' << x << ',' << y << ',' << cluster << ',' << isLogo << "\n";
    }
  }

  float minX = training.pca2d.at<float>(0, 0), maxX = minX;
  float minY = training.pca2d.at<float>(0, 1), maxY = minY;
  for (int i = 1; i < training.pca2d.rows; i++) {
    minX = std::min(minX, training.pca2d.at<float>(i, 0));
    maxX = std::max(maxX, training.pca2d.at<float>(i, 0));
    minY = std::min(minY, training.pca2d.at<float>(i, 1));
    maxY = std::max(maxY, training.pca2d.at<float>(i, 1));
  }
  if (std::abs(maxX - minX) < 1e-6f) {
    minX -= 1.0f;
    maxX += 1.0f;
  }
  if (std::abs(maxY - minY) < 1e-6f) {
    minY -= 1.0f;
    maxY += 1.0f;
  }

  const int width = 900;
  const int height = 650;
  const int pad = 60;
  cv::Mat img(height, width, CV_8UC3, cv::Scalar(255, 255, 255));

  const auto mapX = [&](float x) -> int {
    const float n = (x - minX) / (maxX - minX);
    return pad + static_cast<int>(n * (width - 2 * pad));
  };
  const auto mapY = [&](float y) -> int {
    const float n = (y - minY) / (maxY - minY);
    return (height - pad) - static_cast<int>(n * (height - 2 * pad));
  };

  cv::line(img, cv::Point(pad, height - pad), cv::Point(width - pad, height - pad), cv::Scalar(0, 0, 0), 1);
  cv::line(img, cv::Point(pad, pad), cv::Point(pad, height - pad), cv::Scalar(0, 0, 0), 1);
  cv::putText(img, "PCA X", cv::Point(width / 2 - 30, height - 20), cv::FONT_HERSHEY_SIMPLEX, 0.6, cv::Scalar(0, 0, 0), 1);
  cv::putText(img, "PCA Y", cv::Point(15, height / 2), cv::FONT_HERSHEY_SIMPLEX, 0.6, cv::Scalar(0, 0, 0), 1);

  for (int i = 0; i < training.pca2d.rows; i++) {
    const float x = training.pca2d.at<float>(i, 0);
    const float y = training.pca2d.at<float>(i, 1);
    const int cluster =
        (clusterLabels && i < static_cast<int>(clusterLabels->size())) ? (*clusterLabels)[static_cast<size_t>(i)]
        : (i < static_cast<int>(training.kmeansLabels.size())) ? training.kmeansLabels[static_cast<size_t>(i)]
        : -1;
    cv::Scalar color(0, 0, 220);
    if (cluster == logoClusterLabel) {
      color = cv::Scalar(0, 180, 0);  // logo cluster
    } else if (clusterLabels && cluster == -1) {
      color = cv::Scalar(40, 40, 40); // DBSCAN noise/outlier
    } else if (clusterLabels && cluster >= 0) {
      // Color non-logo DBSCAN clusters with a small palette.
      static const cv::Scalar palette[] = {
          cv::Scalar(220, 120, 0),  // blue-ish (BGR)
          cv::Scalar(180, 0, 180),  // magenta
          cv::Scalar(0, 160, 220),  // orange
          cv::Scalar(220, 0, 0),    // blue
          cv::Scalar(0, 220, 220),  // yellow
          cv::Scalar(120, 120, 220) // light orange
      };
      const int idx = (cluster % (static_cast<int>(sizeof(palette) / sizeof(palette[0]))));
      color = palette[idx];
    }
    cv::circle(img, cv::Point(mapX(x), mapY(y)), 4, color, cv::FILLED);
  }

  cv::putText(img, "logo cluster", cv::Point(width - pad - 170, pad + 10), cv::FONT_HERSHEY_SIMPLEX, 0.5, cv::Scalar(0, 180, 0), 1);
  if (clusterLabels) {
    cv::putText(img, "dbscan noise (-1)", cv::Point(width - pad - 170, pad + 30), cv::FONT_HERSHEY_SIMPLEX, 0.5, cv::Scalar(40, 40, 40), 1);
    cv::putText(img, "other clusters", cv::Point(width - pad - 170, pad + 50), cv::FONT_HERSHEY_SIMPLEX, 0.5, cv::Scalar(0, 0, 0), 1);
  } else {
    cv::putText(img, "non-logo", cv::Point(width - pad - 170, pad + 30), cv::FONT_HERSHEY_SIMPLEX, 0.5, cv::Scalar(0, 0, 220), 1);
  }

  const fs::path pngPath = outDir / (baseName + ".png");
  cv::imwrite(pngPath.string(), img);
}

static void exportDebugPcaTokayoPlot(const fs::path& outDir,
                                     const logo_detector::TrainingOutput& training,
                                     const std::vector<double>& mahalDists,
                                     double mahalThreshold,
                                     const McdResult& mcd,
                                     const std::string& baseName) {
  if (training.pca2d.empty() || training.pca2d.rows <= 0) return;
  const int n = training.pca2d.rows;

  // CSV
  {
    const fs::path csvPath = outDir / (baseName + ".csv");
    std::ofstream csv(csvPath);
    csv << "index,timeSec,x,y,mahalanobis,isLogo\n";
    for (int i = 0; i < n; i++) {
      const double t = training.sampleTimesSec[static_cast<size_t>(i)];
      csv << i << ',' << t << ','
          << training.pca2d.at<float>(i, 0) << ',' << training.pca2d.at<float>(i, 1) << ','
          << mahalDists[static_cast<size_t>(i)] << ','
          << (mahalDists[static_cast<size_t>(i)] <= mahalThreshold ? 1 : 0) << "\n";
    }
  }

  // Decode ROI thumbnails upfront.
  const int thumbSize = 120;
  const int borderPx = 4;
  std::vector<cv::Mat> thumbs(static_cast<size_t>(n));
  for (int i = 0; i < n; i++) {
    if (static_cast<size_t>(i) < training.sampleRoiPng.size() && !training.sampleRoiPng[static_cast<size_t>(i)].empty()) {
      const auto& bytes = training.sampleRoiPng[static_cast<size_t>(i)];
      cv::Mat decoded = cv::imdecode(cv::Mat(bytes), cv::IMREAD_COLOR);
      if (!decoded.empty()) {
        cv::resize(decoded, thumbs[static_cast<size_t>(i)], cv::Size(thumbSize, thumbSize), 0, 0, cv::INTER_AREA);
      }
    }
  }

  // Compute plot bounds with margin for the ellipse + thumbnails.
  float minX = training.pca2d.at<float>(0, 0), maxX = minX;
  float minY = training.pca2d.at<float>(0, 1), maxY = minY;
  for (int i = 1; i < n; i++) {
    minX = std::min(minX, training.pca2d.at<float>(i, 0));
    maxX = std::max(maxX, training.pca2d.at<float>(i, 0));
    minY = std::min(minY, training.pca2d.at<float>(i, 1));
    maxY = std::max(maxY, training.pca2d.at<float>(i, 1));
  }
  const float marginX = (maxX - minX) * 0.18f;
  const float marginY = (maxY - minY) * 0.18f;
  minX -= marginX; maxX += marginX;
  minY -= marginY; maxY += marginY;
  if (std::abs(maxX - minX) < 1e-6f) { minX -= 1.0f; maxX += 1.0f; }
  if (std::abs(maxY - minY) < 1e-6f) { minY -= 1.0f; maxY += 1.0f; }

  // ~10 MP: 4000 x 2500 = 10,000,000
  const int width = 4000;
  const int height = 2500;
  const int pad = 180;
  cv::Mat img(height, width, CV_8UC3, cv::Scalar(255, 255, 255));

  const auto mapPX = [&](float x) -> int {
    return pad + static_cast<int>(((x - minX) / (maxX - minX)) * (width - 2 * pad));
  };
  const auto mapPY = [&](float y) -> int {
    return (height - pad) - static_cast<int>(((y - minY) / (maxY - minY)) * (height - 2 * pad));
  };

  // Axes
  cv::line(img, cv::Point(pad, height - pad), cv::Point(width - pad, height - pad), cv::Scalar(0, 0, 0), 2);
  cv::line(img, cv::Point(pad, pad), cv::Point(pad, height - pad), cv::Scalar(0, 0, 0), 2);
  cv::putText(img, "PCA X", cv::Point(width / 2 - 60, height - 40), cv::FONT_HERSHEY_SIMPLEX, 1.8, cv::Scalar(0, 0, 0), 2);
  cv::putText(img, "PCA Y", cv::Point(20, height / 2), cv::FONT_HERSHEY_SIMPLEX, 1.8, cv::Scalar(0, 0, 0), 2);

  // Draw the Mahalanobis threshold ellipse.
  {
    cv::Mat eigenvalues, eigenvectors;
    cv::eigen(mcd.cov, eigenvalues, eigenvectors);

    const double ev0 = eigenvalues.at<double>(0, 0);
    const double ev1 = eigenvalues.at<double>(1, 0);
    const double semiA = mahalThreshold * std::sqrt(std::max(0.0, ev0));
    const double semiB = mahalThreshold * std::sqrt(std::max(0.0, ev1));

    const double angle = std::atan2(eigenvectors.at<double>(0, 1), eigenvectors.at<double>(0, 0))
                         * 180.0 / CV_PI;

    const int nPts = 720;
    std::vector<cv::Point> ellipsePx;
    ellipsePx.reserve(nPts);
    for (int t = 0; t < nPts; t++) {
      const double theta = static_cast<double>(t) * 2.0 * CV_PI / nPts;
      const double ex = semiA * std::cos(theta);
      const double ey = semiB * std::sin(theta);
      const double angleRad = angle * CV_PI / 180.0;
      const double rx = mcd.center.x + ex * std::cos(angleRad) - ey * std::sin(angleRad);
      const double ry = mcd.center.y + ex * std::sin(angleRad) + ey * std::cos(angleRad);
      ellipsePx.emplace_back(mapPX(static_cast<float>(rx)), mapPY(static_cast<float>(ry)));
    }
    cv::polylines(img, ellipsePx, true, cv::Scalar(200, 100, 0), 4, cv::LINE_AA);
  }

  // Draw MCD center.
  cv::drawMarker(img,
                 cv::Point(mapPX(static_cast<float>(mcd.center.x)), mapPY(static_cast<float>(mcd.center.y))),
                 cv::Scalar(200, 100, 0), cv::MARKER_CROSS, 30, 3, cv::LINE_AA);

  // Draw each sample as its ROI thumbnail with a colored border.
  const int totalThumb = thumbSize + 2 * borderPx;
  const int halfThumb = totalThumb / 2;
  for (int i = 0; i < n; i++) {
    const float x = training.pca2d.at<float>(i, 0);
    const float y = training.pca2d.at<float>(i, 1);
    const int cx = mapPX(x);
    const int cy = mapPY(y);
    const bool isLogo = (mahalDists[static_cast<size_t>(i)] <= mahalThreshold);
    const cv::Scalar borderColor = isLogo ? cv::Scalar(0, 180, 0) : cv::Scalar(0, 0, 220);

    const int x0 = cx - halfThumb;
    const int y0 = cy - halfThumb;

    // Clamp to image bounds.
    if (x0 < 0 || y0 < 0 || x0 + totalThumb > width || y0 + totalThumb > height) {
      cv::circle(img, cv::Point(cx, cy), 8, borderColor, cv::FILLED, cv::LINE_AA);
      continue;
    }

    // Draw colored border rectangle.
    cv::rectangle(img, cv::Rect(x0, y0, totalThumb, totalThumb), borderColor, borderPx, cv::LINE_AA);

    // Paste thumbnail if available.
    if (!thumbs[static_cast<size_t>(i)].empty()) {
      const cv::Rect roi(x0 + borderPx, y0 + borderPx, thumbSize, thumbSize);
      thumbs[static_cast<size_t>(i)].copyTo(img(roi));
    } else {
      cv::rectangle(img, cv::Rect(x0 + borderPx, y0 + borderPx, thumbSize, thumbSize),
                    cv::Scalar(220, 220, 220), cv::FILLED);
      cv::putText(img, "?", cv::Point(cx - 12, cy + 12), cv::FONT_HERSHEY_SIMPLEX, 1.2, borderColor, 2);
    }
  }

  // Legend
  const int lx = width - pad - 550;
  const int ly = pad + 20;
  cv::rectangle(img, cv::Rect(lx - 15, ly - 15, 540, 160), cv::Scalar(245, 245, 245), cv::FILLED);
  cv::rectangle(img, cv::Rect(lx - 15, ly - 15, 540, 160), cv::Scalar(180, 180, 180), 2);

  cv::rectangle(img, cv::Rect(lx, ly + 2, 20, 20), cv::Scalar(0, 180, 0), cv::FILLED);
  cv::putText(img, "logo (inside ellipse)", cv::Point(lx + 30, ly + 20), cv::FONT_HERSHEY_SIMPLEX, 1.0, cv::Scalar(0, 0, 0), 2);
  cv::rectangle(img, cv::Rect(lx, ly + 42, 20, 20), cv::Scalar(0, 0, 220), cv::FILLED);
  cv::putText(img, "no-logo (outlier)", cv::Point(lx + 30, ly + 60), cv::FONT_HERSHEY_SIMPLEX, 1.0, cv::Scalar(0, 0, 0), 2);
  cv::line(img, cv::Point(lx, ly + 90), cv::Point(lx + 20, ly + 90), cv::Scalar(200, 100, 0), 4, cv::LINE_AA);

  std::ostringstream thLabel;
  thLabel << std::fixed << std::setprecision(2) << "Mahalanobis threshold = " << mahalThreshold;
  cv::putText(img, thLabel.str(), cv::Point(lx + 30, ly + 97), cv::FONT_HERSHEY_SIMPLEX, 0.9, cv::Scalar(200, 100, 0), 2);

  std::ostringstream statsLabel;
  int logoCount = 0, outlierCount = 0;
  for (int i = 0; i < n; i++) {
    if (mahalDists[static_cast<size_t>(i)] <= mahalThreshold) logoCount++; else outlierCount++;
  }
  statsLabel << "samples: " << n << " | logo: " << logoCount << " | outlier: " << outlierCount;
  cv::putText(img, statsLabel.str(), cv::Point(lx + 5, ly + 135), cv::FONT_HERSHEY_SIMPLEX, 0.85, cv::Scalar(80, 80, 80), 2);

  const fs::path pngPath = outDir / (baseName + ".png");
  cv::imwrite(pngPath.string(), img);
}

int main(int argc, char** argv) {
  const auto processStart = std::chrono::steady_clock::now();
  try {
    const Args args = parseArgs(argc, argv);

    progress(args, "Inicio");
    progress(args, "Esquina seleccionada: " + cornerName(args.cornerIndex) +
                       " (roiWidthPct=" + std::to_string(args.roiWidthPct) + ")");
    const bool isHttp = startsWith(args.m3u8, "http://") || startsWith(args.m3u8, "https://");
    progress(args, std::string("Leyendo m3u8 (") + (isHttp ? "HTTP" : "archivo local") + ")");
    const std::string playlistContent = isHttp ? http::get(args.m3u8) : readFile(args.m3u8);
    progress(args, "Parseando playlist m3u8");
    const auto segments = m3u8::parse(playlistContent);
    const double totalDurationSec = m3u8::totalDuration(segments);
    if (segments.empty() || totalDurationSec <= 0.0) {
      throw std::runtime_error("could not parse segments/duration from m3u8");
    }
    progress(args,
             "Segmentos: " + std::to_string(segments.size()) +
                 ", duracion total aprox: " + std::to_string(totalDurationSec) + " sec");

    std::vector<std::optional<int64_t>> segEpochMs;
    segEpochMs.reserve(segments.size());
    progress(args, "Convirtiendo EXT-X-PROGRAM-DATE-TIME a epoch (si existe)");
    for (const auto& s : segments) {
      int64_t ms = 0;
      if (!s.programDateTime.empty() && time_util::parseIso8601LikeToEpochMs(s.programDateTime, &ms))
        segEpochMs.emplace_back(ms);
      else
        segEpochMs.emplace_back(std::nullopt);
    }

    progress(args,
             "Entrenando modelo de logo (cada " + std::to_string(args.sampleEverySec) + " sec)");
    auto training = logo_detector::train(
        args.m3u8,
        totalDurationSec,
        args.roiWidthPct,
        args.k,
        args.cornerIndex,
        args.sampleEverySec,
        args.threads,
        args.debug || args.tokayo,
        [&](int current, int total) {
          if (args.quiet) return;
          progress(args,
                   "Training: muestras leidas = " + std::to_string(current) + "/" + std::to_string(total));
        });
    progress(args,
             "Training: umbral: " + std::to_string(training.model.threshold) +
                 ", logoSamples: " + std::to_string(training.model.logoSampleIndices.size()) +
                 ", totalSamples: " + std::to_string(training.sampleTimesSec.size()));

    fs::path logosOutDir;
    if (args.debug) {
      progress(args, "Debug habilitado: exportando set de logos (ROIs) a logos_output/");
      logosOutDir = executableDir() / "logos_output";
      exportDebugLogos(args, logosOutDir, training);
      exportDebugPcaPlot(logosOutDir, training, nullptr, training.logoClusterLabel, "pca_xy");
    }

    struct Interval {
      double startSec = 0;
      double endSec = 0;
      std::optional<std::string> startPdt;
      std::optional<std::string> endPdt;
    };
    std::vector<Interval> ads;

    const std::string strategyName = args.tokayo ? "tokayo" :
                                     args.outlier ? ("outlier/" + args.outlierMode) : "bhattacharyya";
    progress(args,
             "Detectando ads desde muestras (cada " + std::to_string(training.sampleEverySec) +
                 " sec, min-ad-sec=" + std::to_string(args.minAdSec) +
                 ", strategy=" + strategyName +
                 (args.tokayo ? (", nccTh=" + std::to_string(args.tokayoTh) + " (0=auto)")
                              : (", smooth=" + std::to_string(args.smoothWindow) +
                                 ", enterMult=" + std::to_string(args.enterMult) +
                                 ", exitMult=" + std::to_string(args.exitMult))) +
                 ", enterN=" + std::to_string(args.enterConsecutive) +
                 ", exitN=" + std::to_string(args.exitConsecutive) + ")");

    const int sampleCount = training.sampleHists.rows;
    std::vector<char> hasLogo;
    hasLogo.resize(static_cast<size_t>(std::max(0, sampleCount)), 0);
    std::vector<double> distSmooth;

    double baseTh = training.model.threshold;
    double enterTh = 0.0;
    double exitTh = 0.0;
    double usedDbscanEps = 0.0;
    int usedDbscanMinPts = args.dbscanMinPts;
    int dbscanLogoLabel = -1;
    std::vector<int> dbscan;
    int usedKnnK = 0;
    double usedKnnQ = 0.0;
    double usedKnnThreshold = 0.0;

    std::unique_ptr<TokayoModel> tokayoModelPtr;

    if (args.tokayo) {
      // --- Tokayo: pixel-wise median + stddev logo detection + NCC ---

      // 1. Decode all ROI PNGs to grayscale + slight blur.
      progress(args, "Tokayo: decodificando ROIs a escala de grises + blur");
      std::vector<cv::Mat> grayRois;
      grayRois.reserve(static_cast<size_t>(sampleCount));
      for (int i = 0; i < sampleCount; i++) {
        if (static_cast<size_t>(i) >= training.sampleRoiPng.size() ||
            training.sampleRoiPng[static_cast<size_t>(i)].empty()) {
          throw std::runtime_error("tokayo: missing ROI image for sample " + std::to_string(i));
        }
        cv::Mat decoded = cv::imdecode(training.sampleRoiPng[static_cast<size_t>(i)], cv::IMREAD_COLOR);
        if (decoded.empty()) throw std::runtime_error("tokayo: could not decode ROI PNG for sample " + std::to_string(i));
        cv::Mat gray;
        cv::cvtColor(decoded, gray, cv::COLOR_BGR2GRAY);
        cv::GaussianBlur(gray, gray, cv::Size(3, 3), 0);
        grayRois.push_back(gray);
      }
      const int roiH = grayRois[0].rows;
      const int roiW = grayRois[0].cols;
      progress(args, "Tokayo: ROI size=" + std::to_string(roiW) + "x" + std::to_string(roiH) +
                         ", samples=" + std::to_string(sampleCount));

      // 2. Compute pixel-wise median across all samples.
      progress(args, "Tokayo: calculando mediana pixel a pixel");
      cv::Mat medianImg(roiH, roiW, CV_8UC1);
      {
        std::vector<uint8_t> vals(static_cast<size_t>(sampleCount));
        for (int y = 0; y < roiH; y++) {
          for (int x = 0; x < roiW; x++) {
            for (int i = 0; i < sampleCount; i++) {
              vals[static_cast<size_t>(i)] = grayRois[static_cast<size_t>(i)].at<uint8_t>(y, x);
            }
            std::nth_element(vals.begin(), vals.begin() + sampleCount / 2, vals.end());
            medianImg.at<uint8_t>(y, x) = vals[static_cast<size_t>(sampleCount / 2)];
          }
        }
      }

      // 3. Compute per-pixel stddev to find constant (logo) vs varying (background) pixels.
      progress(args, "Tokayo: calculando stddev pixel a pixel");
      cv::Mat stddevImg(roiH, roiW, CV_32FC1);
      for (int y = 0; y < roiH; y++) {
        for (int x = 0; x < roiW; x++) {
          double sum = 0, sum2 = 0;
          for (int i = 0; i < sampleCount; i++) {
            const double v = grayRois[static_cast<size_t>(i)].at<uint8_t>(y, x);
            sum += v;
            sum2 += v * v;
          }
          const double mean = sum / sampleCount;
          const double var = (sum2 / sampleCount) - mean * mean;
          stddevImg.at<float>(y, x) = static_cast<float>(std::sqrt(std::max(0.0, var)));
        }
      }

      // 4. Threshold stddev to find the logo region (low variance = constant = logo).
      cv::Mat stddevNorm;
      cv::normalize(stddevImg, stddevNorm, 0, 255, cv::NORM_MINMAX);
      stddevNorm.convertTo(stddevNorm, CV_8UC1);

      cv::Mat logoMask;
      cv::threshold(stddevNorm, logoMask, 0, 255, cv::THRESH_BINARY_INV | cv::THRESH_OTSU);

      cv::Mat morphKernel = cv::getStructuringElement(cv::MORPH_RECT, cv::Size(5, 5));
      cv::morphologyEx(logoMask, logoMask, cv::MORPH_CLOSE, morphKernel);
      cv::morphologyEx(logoMask, logoMask, cv::MORPH_OPEN, morphKernel);

      std::vector<std::vector<cv::Point>> contours;
      cv::findContours(logoMask, contours, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_SIMPLE);
      if (contours.empty()) throw std::runtime_error("tokayo: no logo region found in stddev analysis");

      size_t largestIdx = 0;
      double largestArea = 0;
      for (size_t ci = 0; ci < contours.size(); ci++) {
        const double area = cv::contourArea(contours[ci]);
        if (area > largestArea) { largestArea = area; largestIdx = ci; }
      }

      cv::Rect logoSubRect = cv::boundingRect(contours[largestIdx]);
      const int padPx = 2;
      logoSubRect.x = std::max(0, logoSubRect.x - padPx);
      logoSubRect.y = std::max(0, logoSubRect.y - padPx);
      logoSubRect.width = std::min(roiW - logoSubRect.x, logoSubRect.width + 2 * padPx);
      logoSubRect.height = std::min(roiH - logoSubRect.y, logoSubRect.height + 2 * padPx);

      progress(args, "Tokayo: logo sub-ROI=" + std::to_string(logoSubRect.x) + "," +
                         std::to_string(logoSubRect.y) + " " +
                         std::to_string(logoSubRect.width) + "x" + std::to_string(logoSubRect.height));

      // 5. Extract logo template from median image.
      cv::Mat logoTemplate = medianImg(logoSubRect).clone();

      // 6. NCC (normalized cross-correlation) of each sample against the template.
      progress(args, "Tokayo: correlacion cruzada normalizada (NCC)");
      std::vector<double> nccScores;
      nccScores.reserve(static_cast<size_t>(sampleCount));
      for (int i = 0; i < sampleCount; i++) {
        const cv::Mat sampleSub = grayRois[static_cast<size_t>(i)](logoSubRect);
        cv::Mat result;
        cv::matchTemplate(sampleSub, logoTemplate, result, cv::TM_CCOEFF_NORMED);
        nccScores.push_back(static_cast<double>(result.at<float>(0, 0)));
      }

      // 7. Determine NCC threshold: auto-detect via largest gap, or use manual value.
      double nccTh = args.tokayoTh;
      if (nccTh <= 0.0) {
        std::vector<double> sorted = nccScores;
        std::sort(sorted.begin(), sorted.end());
        double bestGap = 0.0;
        for (size_t i = 1; i < sorted.size(); i++) {
          const double gap = sorted[i] - sorted[i - 1];
          if (gap > bestGap) {
            bestGap = gap;
            nccTh = (sorted[i] + sorted[i - 1]) / 2.0;
          }
        }
        if (nccTh <= 0.0) nccTh = 0.5;
        progress(args, "Tokayo: auto-detected NCC threshold=" + std::to_string(nccTh) +
                           " (largest gap=" + std::to_string(bestGap) + ")");
      }

      // 8. Classify.
      int logoCount = 0, noLogoCount = 0;
      for (int i = 0; i < sampleCount; i++) {
        const bool isLogo = (nccScores[static_cast<size_t>(i)] >= nccTh);
        hasLogo[static_cast<size_t>(i)] = isLogo ? 1 : 0;
        if (isLogo) logoCount++; else noLogoCount++;
      }
      progress(args, "Tokayo: logo=" + std::to_string(logoCount) +
                         ", no-logo=" + std::to_string(noLogoCount) +
                         ", nccThreshold=" + std::to_string(nccTh));

      // Build TokayoModel for refinement.
      tokayoModelPtr = std::make_unique<TokayoModel>();
      tokayoModelPtr->logoTemplate = logoTemplate.clone();
      tokayoModelPtr->logoSubRect = logoSubRect;
      tokayoModelPtr->nccThreshold = nccTh;
      tokayoModelPtr->cornerIndex = args.cornerIndex;
      tokayoModelPtr->roiWidthPct = args.roiWidthPct;

      if (args.debug) {
        // Save median image, stddev, mask, and template.
        cv::imwrite((logosOutDir / "tokayo_median.png").string(), medianImg);
        cv::imwrite((logosOutDir / "tokayo_stddev.png").string(), stddevNorm);
        cv::imwrite((logosOutDir / "tokayo_logo_mask.png").string(), logoMask);
        cv::imwrite((logosOutDir / "tokayo_logo_template.png").string(), logoTemplate);

        // Draw the detected sub-ROI on the median.
        cv::Mat medianAnnotated;
        cv::cvtColor(medianImg, medianAnnotated, cv::COLOR_GRAY2BGR);
        cv::rectangle(medianAnnotated, logoSubRect, cv::Scalar(0, 255, 0), 2);
        cv::imwrite((logosOutDir / "tokayo_median_annotated.png").string(), medianAnnotated);

        // Export logos and no-logos as separate folders.
        const fs::path noLogosDir = logosOutDir / "no-logos";
        fs::create_directories(noLogosDir);
        for (int i = 0; i < sampleCount; i++) {
          if (static_cast<size_t>(i) >= training.sampleRoiPng.size()) continue;
          const auto& bytes = training.sampleRoiPng[static_cast<size_t>(i)];
          if (bytes.empty()) continue;
          if (!hasLogo[static_cast<size_t>(i)]) {
            const int64_t tMs = static_cast<int64_t>(training.sampleTimesSec[static_cast<size_t>(i)] * 1000.0);
            std::ostringstream name;
            name << "nologo_" << std::setw(6) << std::setfill('0') << i << "_t" << tMs << ".png";
            const fs::path p = noLogosDir / name.str();
            std::ofstream f(p, std::ios::binary);
            f.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
          }
        }

        // Export NCC scores CSV.
        const fs::path csvPath = logosOutDir / "tokayo_ncc_scores.csv";
        std::ofstream csv(csvPath);
        if (csv.is_open()) {
          csv << "nccThreshold,logoSubRectX,logoSubRectY,logoSubRectW,logoSubRectH\n";
          csv << nccTh << "," << logoSubRect.x << "," << logoSubRect.y << ","
              << logoSubRect.width << "," << logoSubRect.height << "\n";
          csv << "\nindex,timeSec,ncc,isLogo\n";
          for (int i = 0; i < sampleCount; i++) {
            csv << i << "," << training.sampleTimesSec[static_cast<size_t>(i)] << ","
                << nccScores[static_cast<size_t>(i)] << ","
                << (hasLogo[static_cast<size_t>(i)] ? 1 : 0) << "\n";
          }
        }
      }
    } else if (!args.outlier) {
      std::vector<double> distRaw;
      distRaw.reserve(static_cast<size_t>(std::max(0, sampleCount)));
      for (int i = 0; i < sampleCount; i++) {
        const cv::Mat h = training.sampleHists.row(i);
        distRaw.push_back(cv::compareHist(h, training.model.meanHist, cv::HISTCMP_BHATTACHARYYA));
      }

      // Smoothing reduces false positives caused by a single noisy sample.
      std::vector<double> dist;
      dist.resize(distRaw.size());
      const int w = std::max(1, args.smoothWindow);
      const int half = w / 2;
      for (int i = 0; i < static_cast<int>(distRaw.size()); i++) {
        const int from = std::max(0, i - half);
        const int to = std::min(static_cast<int>(distRaw.size()) - 1, i + half);
        double sum = 0.0;
        for (int j = from; j <= to; j++) sum += distRaw[static_cast<size_t>(j)];
        dist[static_cast<size_t>(i)] = sum / static_cast<double>((to - from) + 1);
      }

      const auto clamp01 = [](double v) -> double { return std::max(0.0, std::min(1.0, v)); };
      enterTh = clamp01(baseTh * args.enterMult);
      exitTh = clamp01(baseTh * args.exitMult);

      distSmooth = std::move(dist);

      if (args.debug) {
        const fs::path csvPath = logosOutDir / "distance_scores.csv";
        std::ofstream csv(csvPath);
        if (csv.is_open()) {
          csv << "baseThreshold,enterThreshold,exitThreshold,smoothWindow,enterMult,exitMult,enterN,exitN\n";
          csv << baseTh << "," << enterTh << "," << exitTh << ","
              << args.smoothWindow << "," << args.enterMult << "," << args.exitMult << ","
              << args.enterConsecutive << "," << args.exitConsecutive << "\n";
          csv << "\nindex,timeSec,distRaw,distSmooth\n";
          for (int i = 0; i < sampleCount; i++) {
            csv << i << ","
                << training.sampleTimesSec[static_cast<size_t>(i)] << ","
                << distRaw[static_cast<size_t>(i)] << ","
                << (i < static_cast<int>(distSmooth.size()) ? distSmooth[static_cast<size_t>(i)] : 0.0) << "\n";
          }
        }
      }
    } else {
      const std::vector<cv::Point2f> pts = pcaPoints(training);
      bool outlierHandled = false;

      if (args.outlierMode == "lof") {
        const int kk = std::max(2, std::min(args.lofK, std::max(2, static_cast<int>(pts.size())) - 1));
        const double th = args.lofThreshold;
        const auto scores = lofScores(pts, kk);
        progress(args, "LOF: k=" + std::to_string(kk) + ", th=" + std::to_string(th));

        // In LOF, high score => outlier => no-logo.
        for (int i = 0; i < sampleCount; i++) {
          const double s = (i < static_cast<int>(scores.size())) ? scores[static_cast<size_t>(i)] : 1.0;
          hasLogo[static_cast<size_t>(i)] = (s < th) ? 1 : 0;
        }

        if (args.debug) {
          std::vector<int> labels;
          labels.reserve(static_cast<size_t>(sampleCount));
          for (int i = 0; i < sampleCount; i++) labels.push_back(hasLogo[static_cast<size_t>(i)] ? 0 : -1);
          exportDebugPcaPlot(logosOutDir, training, &labels, 0, "pca_xy_lof");

          const fs::path csvPath = logosOutDir / "lof_scores.csv";
          std::ofstream csv(csvPath);
          if (csv.is_open()) {
            csv << "k,threshold\n";
            csv << kk << "," << th << "\n";
            csv << "\nindex,timeSec,lof,isOutlier\n";
            for (int i = 0; i < sampleCount; i++) {
              const double s = (i < static_cast<int>(scores.size())) ? scores[static_cast<size_t>(i)] : 1.0;
              const int isOut = (s >= th) ? 1 : 0;
              csv << i << "," << training.sampleTimesSec[static_cast<size_t>(i)] << "," << s << "," << isOut << "\n";
            }
          }
        }
        outlierHandled = true;
      } else {
        if (args.outlierMode == "knn") {
          const std::vector<int> seeds = training.model.logoSampleIndices;
          if (seeds.size() < 3) {
            progress(args, "KNN(logo): no hay suficientes semillas de logo; fallback a DBSCAN");
          } else {
            const int kk = std::max(1, std::min(args.knnK, static_cast<int>(seeds.size()) - 1));
            usedKnnK = kk;
            usedKnnQ = args.knnQuantile;
            std::vector<double> seedScores;
            seedScores.reserve(seeds.size());
            for (int s : seeds) {
              if (s < 0 || s >= sampleCount) continue;
              seedScores.push_back(knnAvgDistToSeedsHist(training.sampleHists, s, seeds, kk));
            }
            double th = quantile(seedScores, args.knnQuantile);
            if (!seedScores.empty()) {
              const double maxSeed = *std::max_element(seedScores.begin(), seedScores.end());
              if (th < maxSeed) th = maxSeed * 1.02;  // never reject logo seeds; small margin
            }
            usedKnnThreshold = th;

            progress(args, "KNN(logo): k=" + std::to_string(kk) +
                               ", q=" + std::to_string(args.knnQuantile) +
                               ", threshold=" + std::to_string(th) +
                               ", seeds=" + std::to_string(seeds.size()));

            std::vector<double> scores;
            scores.reserve(static_cast<size_t>(sampleCount));
            for (int i = 0; i < sampleCount; i++) {
              const double s = knnAvgDistToSeedsHist(training.sampleHists, i, seeds, kk);
              scores.push_back(s);
              hasLogo[static_cast<size_t>(i)] = (s <= th) ? 1 : 0;
            }

            if (args.debug) {
              std::vector<int> labels;
              labels.reserve(static_cast<size_t>(sampleCount));
              for (int i = 0; i < sampleCount; i++) labels.push_back(hasLogo[static_cast<size_t>(i)] ? 0 : -1);
              exportDebugPcaPlot(logosOutDir, training, &labels, 0, "pca_xy_knnlogo");

              const fs::path csvPath = logosOutDir / "knn_logo_distance.csv";
              std::ofstream csv(csvPath);
              if (csv.is_open()) {
                csv << "k,quantile,threshold,seedCount\n";
                csv << kk << "," << args.knnQuantile << "," << th << "," << seeds.size() << "\n";
                csv << "\nindex,timeSec,score,isLogo,isSeed\n";
                std::unordered_set<int> seedSet(seeds.begin(), seeds.end());
                for (int i = 0; i < sampleCount; i++) {
                  const int isSeed = seedSet.count(i) ? 1 : 0;
                  csv << i << "," << training.sampleTimesSec[static_cast<size_t>(i)] << ","
                      << scores[static_cast<size_t>(i)] << ","
                      << (hasLogo[static_cast<size_t>(i)] ? 1 : 0) << ","
                      << isSeed << "\n";
                }
              }
            }
            outlierHandled = true;
          }
        }

      }

      if (!outlierHandled) {
        usedDbscanMinPts = std::max(2, std::min(args.dbscanMinPts, std::max(2, static_cast<int>(pts.size()))));
        usedDbscanEps = (args.dbscanEps > 0.0) ? args.dbscanEps : autoDbscanEps(pts, usedDbscanMinPts);
        if (usedDbscanEps <= 0.0) usedDbscanEps = 0.5;

        progress(args, "DBSCAN: eps=" + std::to_string(usedDbscanEps) + ", minPts=" + std::to_string(usedDbscanMinPts));
        dbscan = dbscanLabels(pts, usedDbscanEps, usedDbscanMinPts);

        std::unordered_map<int, int> clusterSizes;
        clusterSizes.reserve(static_cast<size_t>(std::max(0, sampleCount)));
        for (int i = 0; i < sampleCount; i++) {
          const int lab = (i < static_cast<int>(dbscan.size())) ? dbscan[static_cast<size_t>(i)] : -1;
          if (lab >= 0) clusterSizes[lab]++;
        }

        // Pick "logo cluster" by maximum overlap with logo seeds.
        // This is more stable than "largest cluster", and matches the intent: classify by proximity to known-logo samples.
        const std::vector<int>& seeds = training.model.logoSampleIndices;
        std::unordered_set<int> seedSet(seeds.begin(), seeds.end());
        std::unordered_map<int, int> seedOverlap;
        seedOverlap.reserve(clusterSizes.size());
        for (int i = 0; i < sampleCount; i++) {
          if (!seedSet.count(i)) continue;
          const int lab = (i < static_cast<int>(dbscan.size())) ? dbscan[static_cast<size_t>(i)] : -1;
          if (lab >= 0) seedOverlap[lab]++;
        }

        int bestBySeedsLabel = -1;
        int bestBySeedsCount = 0;
        for (const auto& kv : seedOverlap) {
          if (kv.second > bestBySeedsCount) {
            bestBySeedsLabel = kv.first;
            bestBySeedsCount = kv.second;
          }
        }

        if (bestBySeedsLabel >= 0 && bestBySeedsCount > 0) {
          dbscanLogoLabel = bestBySeedsLabel;
          progress(args, "DBSCAN: logoCluster elegido por semillas: label=" + std::to_string(dbscanLogoLabel) +
                             ", seedOverlap=" + std::to_string(bestBySeedsCount) +
                             "/" + std::to_string(seeds.size()) +
                             ", clusterSize=" + std::to_string(clusterSizes[dbscanLogoLabel]));
        } else {
          int bestLabel = -1;
          int bestCount = 0;
          for (const auto& kv : clusterSizes) {
            if (kv.second > bestCount) {
              bestLabel = kv.first;
              bestCount = kv.second;
            }
          }
          dbscanLogoLabel = bestLabel;
          progress(args, "DBSCAN: no hubo overlap con semillas; usando cluster mas grande: label=" +
                             std::to_string(dbscanLogoLabel) + ", size=" + std::to_string(bestCount));
        }

        if (dbscanLogoLabel < 0) {
          progress(args, "DBSCAN: no se encontro cluster denso; asumiendo logo presente en todas las muestras");
          for (int i = 0; i < sampleCount; i++) hasLogo[static_cast<size_t>(i)] = 1;
        } else {
          const int size = clusterSizes.count(dbscanLogoLabel) ? clusterSizes[dbscanLogoLabel] : 0;
          progress(args, "DBSCAN: logoCluster=" + std::to_string(dbscanLogoLabel) +
                             " size=" + std::to_string(size) +
                             " of " + std::to_string(sampleCount));
          for (int i = 0; i < sampleCount; i++) {
            const int lab = (i < static_cast<int>(dbscan.size())) ? dbscan[static_cast<size_t>(i)] : -1;
            hasLogo[static_cast<size_t>(i)] = (lab == dbscanLogoLabel) ? 1 : 0;
          }
        }

        if (args.debug) {
          exportDebugPcaPlot(logosOutDir, training, &dbscan, dbscanLogoLabel, "pca_xy_dbscan");
          const fs::path csvPath = logosOutDir / "dbscan_labels.csv";
          std::ofstream csv(csvPath);
          if (csv.is_open()) {
            csv << "eps,minPts,logoClusterLabel\n";
            csv << usedDbscanEps << "," << usedDbscanMinPts << "," << dbscanLogoLabel << "\n";
            csv << "\nindex,timeSec,label,isLogo,isSeed\n";
            const std::vector<int>& seeds = training.model.logoSampleIndices;
            std::unordered_set<int> seedSet(seeds.begin(), seeds.end());
            for (int i = 0; i < sampleCount; i++) {
              const int lab = (i < static_cast<int>(dbscan.size())) ? dbscan[static_cast<size_t>(i)] : -1;
              const int isLogo = (lab == dbscanLogoLabel) ? 1 : 0;
              const int isSeed = seedSet.count(i) ? 1 : 0;
              csv << i << "," << training.sampleTimesSec[static_cast<size_t>(i)] << "," << lab << "," << isLogo << "," << isSeed << "\n";
            }
          }
        }
      }
    }

    bool inAd = false;
    double adStart = 0.0;
    int noLogoStreak = 0;
    int logoStreak = 0;
    int startCandidateIdx = -1;

    const bool useBinaryHasLogo = args.outlier || args.tokayo;

    for (int i = 0; i < sampleCount; i++) {
      const bool logoNow = useBinaryHasLogo ? (hasLogo[static_cast<size_t>(i)] != 0)
                                            : ((i < static_cast<int>(distSmooth.size())) ? (distSmooth[static_cast<size_t>(i)] <= exitTh) : true);
      const bool strongNoLogo = useBinaryHasLogo ? (!logoNow)
                                                 : ((i < static_cast<int>(distSmooth.size())) ? (distSmooth[static_cast<size_t>(i)] >= enterTh) : false);
      const bool strongLogo = useBinaryHasLogo ? (logoNow)
                                               : ((i < static_cast<int>(distSmooth.size())) ? (distSmooth[static_cast<size_t>(i)] <= exitTh) : true);

      if (!inAd) {
        if (strongNoLogo) {
          if (noLogoStreak == 0) startCandidateIdx = i;
          noLogoStreak++;
        } else {
          noLogoStreak = 0;
          startCandidateIdx = -1;
        }

        if (noLogoStreak >= args.enterConsecutive) {
          inAd = true;
          const int idx = std::max(0, startCandidateIdx);
          adStart = training.sampleTimesSec[static_cast<size_t>(idx)];
          logoStreak = 0;
          noLogoStreak = 0;
          startCandidateIdx = -1;
        }
      } else {
        if (strongLogo) {
          logoStreak++;
        } else {
          logoStreak = 0;
        }

        if (logoStreak >= args.exitConsecutive) {
          inAd = false;
          const int endIdx = std::max(0, i - args.exitConsecutive + 1);
          const double adEnd = training.sampleTimesSec[static_cast<size_t>(endIdx)];
          if ((adEnd - adStart) >= args.minAdSec) {
            Interval it;
            it.startSec = adStart;
            it.endSec = adEnd;
            it.startPdt = offsetToProgramDateTime(segments, segEpochMs, adStart);
            it.endPdt = offsetToProgramDateTime(segments, segEpochMs, adEnd);
            ads.push_back(std::move(it));
            progress(args,
                     "Ad detectado: " + formatSec(adStart) + " (" + formatHms(adStart) + ") -> " +
                         formatSec(adEnd) + " (" + formatHms(adEnd) + ")");
          }
          logoStreak = 0;
        }
      }
    }

    if (inAd) {
      const double adEnd = totalDurationSec;
      if ((adEnd - adStart) >= args.minAdSec) {
        Interval it;
        it.startSec = adStart;
        it.endSec = adEnd;
        it.startPdt = offsetToProgramDateTime(segments, segEpochMs, adStart);
        it.endPdt = offsetToProgramDateTime(segments, segEpochMs, adEnd);
        ads.push_back(std::move(it));
        progress(args,
                 "Ad detectado: " + formatSec(adStart) + " (" + formatHms(adStart) + ") -> " +
                     formatSec(adEnd) + " (" + formatHms(adEnd) + ")");
      }
    }

    // Second pass: refine boundaries around each detected AD interval.
    refineIntervalsIterative(args, args.m3u8, totalDurationSec, training.model, ads,
                             args.debug ? &logosOutDir : nullptr,
                             tokayoModelPtr.get());
    for (auto& it : ads) {
      it.startPdt = offsetToProgramDateTime(segments, segEpochMs, it.startSec);
      it.endPdt = offsetToProgramDateTime(segments, segEpochMs, it.endSec);
    }

    const fs::path outPath(args.outputPath);
    ensureParentDirExists(outPath);
    const auto processEnd = std::chrono::steady_clock::now();
    const auto elapsedMs =
        std::chrono::duration_cast<std::chrono::milliseconds>(processEnd - processStart).count();
    const double elapsedSec = static_cast<double>(elapsedMs) / 1000.0;

    std::ostringstream json;
    json << "{\n";
    json << "  \"m3u8\": ";
    json_util::writeString(json, args.m3u8);
    json << ",\n";
    json << "  \"totalDurationSec\": " << totalDurationSec << ",\n";
    json << "  \"process\": {\n";
    json << "    \"elapsedMs\": " << elapsedMs << ",\n";
    json << "    \"elapsedSec\": " << elapsedSec << "\n";
    json << "  },\n";
    json << "  \"training\": {\n";
    json << "    \"sampleEverySec\": " << training.sampleEverySec << ",\n";
    json << "    \"sampleCount\": " << training.sampleTimesSec.size() << ",\n";
    json << "    \"roiWidthPct\": " << args.roiWidthPct << ",\n";
    json << "    \"k\": " << args.k << ",\n";
    json << "    \"logoCorner\": ";
    json_util::writeString(json, cornerName(training.model.cornerIndex));
    json << ",\n";
    json << "    \"logoThresholdBhattacharyya\": " << training.model.threshold << ",\n";
    json << "    \"detection\": {\n";
    json << "      \"strategy\": ";
    json_util::writeString(json, args.tokayo ? "tokayo" : (args.outlier ? "outlier" : "bhattacharyya"));
    json << ",\n";
    if (args.tokayo) {
      json << "      \"tokayo\": {\n";
      json << "        \"method\": \"pixel-median + NCC\",\n";
      if (tokayoModelPtr) {
        json << "        \"nccThreshold\": " << tokayoModelPtr->nccThreshold << ",\n";
        json << "        \"logoSubRect\": {"
             << "\"x\":" << tokayoModelPtr->logoSubRect.x
             << ",\"y\":" << tokayoModelPtr->logoSubRect.y
             << ",\"w\":" << tokayoModelPtr->logoSubRect.width
             << ",\"h\":" << tokayoModelPtr->logoSubRect.height << "}\n";
      } else {
        json << "        \"nccThreshold\": null,\n";
        json << "        \"logoSubRect\": null\n";
      }
      json << "      },\n";
      json << "      \"enterConsecutive\": " << args.enterConsecutive << ",\n";
      json << "      \"exitConsecutive\": " << args.exitConsecutive << "\n";
    } else if (args.outlier) {
      json << "      \"outlierMode\": ";
      json_util::writeString(json, args.outlierMode);
      json << ",\n";
      if (args.outlierMode == "dbscan") {
        json << "      \"dbscan\": {\n";
        json << "        \"eps\": " << usedDbscanEps << ",\n";
        json << "        \"minPts\": " << usedDbscanMinPts << ",\n";
        json << "        \"logoClusterLabel\": " << dbscanLogoLabel << "\n";
        json << "      },\n";
      } else if (args.outlierMode == "lof") {
        json << "      \"lof\": {\n";
        json << "        \"k\": " << args.lofK << ",\n";
        json << "        \"threshold\": " << args.lofThreshold << "\n";
        json << "      },\n";
      } else if (args.outlierMode == "knn") {
        json << "      \"knn\": {\n";
        json << "        \"k\": " << usedKnnK << ",\n";
        json << "        \"quantile\": " << usedKnnQ << ",\n";
        json << "        \"threshold\": " << usedKnnThreshold << "\n";
        json << "      },\n";
      }
      json << "      \"enterConsecutive\": " << args.enterConsecutive << ",\n";
      json << "      \"exitConsecutive\": " << args.exitConsecutive << "\n";
    } else {
      json << "      \"smoothWindow\": " << args.smoothWindow << ",\n";
      json << "      \"enterMult\": " << args.enterMult << ",\n";
      json << "      \"exitMult\": " << args.exitMult << ",\n";
      json << "      \"enterThreshold\": " << enterTh << ",\n";
      json << "      \"exitThreshold\": " << exitTh << ",\n";
      json << "      \"enterConsecutive\": " << args.enterConsecutive << ",\n";
      json << "      \"exitConsecutive\": " << args.exitConsecutive << "\n";
    }
    json << "    }\n";
    json << "  },\n";
    json << "  \"ads\": [\n";
    for (size_t i = 0; i < ads.size(); i++) {
      const auto& it = ads[i];
      json << "    {\n";
      json << "      \"startOffsetSec\": " << it.startSec << ",\n";
      json << "      \"startOffsetHms\": ";
      json_util::writeString(json, formatHms(it.startSec));
      json << ",\n";
      json << "      \"endOffsetSec\": " << it.endSec << ",\n";
      json << "      \"endOffsetHms\": ";
      json_util::writeString(json, formatHms(it.endSec));
      json << ",\n";
      json << "      \"startProgramDateTime\": ";
      if (it.startPdt.has_value()) json_util::writeString(json, it.startPdt.value());
      else json << "null";
      json << ",\n";
      json << "      \"endProgramDateTime\": ";
      if (it.endPdt.has_value()) json_util::writeString(json, it.endPdt.value());
      else json << "null";
      json << "\n";
      json << "    }" << (i + 1 < ads.size() ? "," : "") << "\n";
    }
    json << "  ],\n";
    json << "  \"debug\": {\n";
    json << "    \"enabled\": " << (args.debug ? "true" : "false") << ",\n";
    json << "    \"logosOutputDir\": ";
    if (args.debug) json_util::writeString(json, logosOutDir.string());
    else json << "null";
    json << ",\n";
    json << "    \"logoSampleCount\": " << training.model.logoSampleIndices.size() << "\n";
    json << "  }\n";
    json << "}\n";

    const std::string jsonStr = json.str();

    std::ofstream out(outPath);
    if (!out.is_open()) throw std::runtime_error("could not open output file: " + args.outputPath);
    progress(args, "Escribiendo salida JSON en: " + args.outputPath);
    out << jsonStr;
    out.close();

    // Always print JSON to stdout, even with --quiet.
    std::cout << jsonStr;
    progress(args, "Fin. Ads encontrados: " + std::to_string(ads.size()));
    return 0;
  } catch (const std::exception& e) {
    std::cerr << "ads_detector error: " << e.what() << "\n";
    return 1;
  }
}

