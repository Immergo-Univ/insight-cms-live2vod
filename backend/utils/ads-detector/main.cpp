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
#include <optional>
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
  double minAdSec = 4.0;
  int smoothWindow = 3;          // moving average window over distances (1 = disabled)
  double enterMult = 1.25;       // enter AD if dist >= threshold * enterMult
  double exitMult = 1.00;        // exit AD if dist <= threshold * exitMult (must be <= enterMult)
  int enterConsecutive = 2;      // require N consecutive no-logo samples to enter AD
  int exitConsecutive = 2;       // require N consecutive logo samples to exit AD
  bool outlier = false;          // if true, use DBSCAN on PCA points instead of Bhattacharyya distance
  std::string outlierMode = "dbscan"; // dbscan | lof | knn
  double dbscanEps = 0.0;        // 0 = auto
  int dbscanMinPts = 5;
  int lofK = 10;
  double lofThreshold = 1.60;
  int knnK = 7;
  double knnQuantile = 0.95;
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

static bool evaluateHasLogoParallelProbes(const std::string& source,
                                          const Args& args,
                                          const logo_detector::LogoModel& model,
                                          double totalDurationSec,
                                          const std::vector<RefineProbe>& probes,
                                          std::vector<char>& outHasLogo) {
  outHasLogo.assign(probes.size(), 0);
  if (probes.empty()) return true;

  const int threadCount = computeThreadCount(args.threads);
  std::vector<std::vector<int>> buckets(static_cast<size_t>(threadCount));
  for (int i = 0; i < static_cast<int>(probes.size()); i++) {
    const double t = probes[static_cast<size_t>(i)].tSec;
    const int bucket =
        std::min(threadCount - 1,
                 std::max(0, static_cast<int>(((totalDurationSec > 0.0) ? (t / totalDurationSec) : 0.0) * threadCount)));
    buckets[static_cast<size_t>(bucket)].push_back(i);
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
                                     const fs::path* debugDirOrNull) {
  if (ads.empty()) return;

  const double refineStepSec = 2.5;
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
  if (!evaluateHasLogoParallelProbes(source, args, model, totalDurationSec, probes, probeHas)) {
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
        args.debug,
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

    progress(args,
             "Detectando ads desde muestras (cada " + std::to_string(training.sampleEverySec) +
                 " sec, min-ad-sec=" + std::to_string(args.minAdSec) +
                 ", strategy=" + std::string(args.outlier ? ("outlier/" + args.outlierMode) : "bhattacharyya") +
                 ", smooth=" + std::to_string(args.smoothWindow) +
                 ", enterMult=" + std::to_string(args.enterMult) +
                 ", exitMult=" + std::to_string(args.exitMult) +
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

    if (!args.outlier) {
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

    for (int i = 0; i < sampleCount; i++) {
      const bool logoNow = args.outlier ? (hasLogo[static_cast<size_t>(i)] != 0)
                                        : ((i < static_cast<int>(distSmooth.size())) ? (distSmooth[static_cast<size_t>(i)] <= exitTh) : true);
      const bool strongNoLogo = args.outlier ? (!logoNow)
                                            : ((i < static_cast<int>(distSmooth.size())) ? (distSmooth[static_cast<size_t>(i)] >= enterTh) : false);
      const bool strongLogo = args.outlier ? (logoNow)
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
                             args.debug ? &logosOutDir : nullptr);
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
    json_util::writeString(json, args.outlier ? "outlier" : "bhattacharyya");
    json << ",\n";
    if (args.outlier) {
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

