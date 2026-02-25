#include "logo_detector.h"

#include <opencv2/imgproc.hpp>
#include <opencv2/imgcodecs.hpp>

#include <algorithm>
#include <cmath>
#include <functional>
#include <cstring>
#include <limits>
#include <numeric>
#include <random>
#include <thread>
#include <atomic>
#include <unordered_set>
#include <mutex>
#include <stdexcept>
#include <vector>

namespace {

double clampPct(double v) {
  if (v < 0.01) return 0.01;
  if (v > 1.0) return 1.0;
  return v;
}

int roiSidePx(const cv::Mat& img, double roiWidthPct) {
  const int w = img.cols;
  if (w <= 0) return 1;
  const int h = img.rows;
  if (h <= 0) return 1;
  const double pct = clampPct(roiWidthPct);
  // Requirement: both width and height are computed from source width.
  const int side = static_cast<int>(std::lround(static_cast<double>(w) * pct));
  return std::max(1, std::min(side, std::min(w, h)));
}

cv::Rect cornerRect(const cv::Mat& img, int cornerIndex, double roiWidthPct) {
  const int w = img.cols;
  const int h = img.rows;
  const int r = roiSidePx(img, roiWidthPct);
  switch (cornerIndex) {
    case 0: return cv::Rect(0, 0, r, r);
    case 1: return cv::Rect(w - r, 0, r, r);
    case 2: return cv::Rect(0, h - r, r, r);
    case 3: return cv::Rect(w - r, h - r, r, r);
    default: return cv::Rect(0, 0, r, r);
  }
}

cv::Mat hist512Hsv(const cv::Mat& bgrRoi) {
  // Downscale ROI to reduce CPU without changing the analyzed region.
  cv::Mat roi = bgrRoi;
  if (roi.cols > 64 || roi.rows > 64) {
    cv::Mat resized;
    cv::resize(roi, resized, cv::Size(64, 64), 0, 0, cv::INTER_AREA);
    roi = std::move(resized);
  }
  cv::Mat hsv;
  cv::cvtColor(roi, hsv, cv::COLOR_BGR2HSV);

  // Focus on the centered area (logo) to reduce background sensitivity.
  // Empirically, the logo sits near the center of the corner ROI; masking reduces false positives
  // when the underlying video content changes behind the logo.
  cv::Mat mask(hsv.rows, hsv.cols, CV_8UC1, cv::Scalar(0));
  const int cx = hsv.cols / 2;
  const int cy = hsv.rows / 2;
  const int radius = static_cast<int>(std::lround(static_cast<double>(std::min(hsv.cols, hsv.rows)) * 0.40));
  cv::circle(mask, cv::Point(cx, cy), std::max(1, radius), cv::Scalar(255), cv::FILLED);

  int channels[] = {0, 1, 2};
  int histSize[] = {8, 8, 8};
  float hRange[] = {0.0f, 180.0f};
  float sRange[] = {0.0f, 256.0f};
  float vRange[] = {0.0f, 256.0f};
  const float* ranges[] = {hRange, sRange, vRange};

  cv::Mat hist;
  cv::calcHist(&hsv, 1, channels, mask, hist, 3, histSize, ranges, true, false);
  hist = hist.reshape(1, 1);
  hist.convertTo(hist, CV_32F);
  const double sum = cv::sum(hist)[0];
  if (sum > 0) hist /= static_cast<float>(sum);
  return hist;
}

cv::Mat cornerHist(const cv::Mat& frame, int cornerIndex, double roiWidthPct) {
  const auto rect = cornerRect(frame, cornerIndex, roiWidthPct);
  return hist512Hsv(frame(rect));
}

cv::Mat cornerRoi(const cv::Mat& frame, int cornerIndex, double roiWidthPct) {
  const auto rect = cornerRect(frame, cornerIndex, roiWidthPct);
  return frame(rect).clone();
}

double mean(const std::vector<double>& v) {
  if (v.empty()) return 0.0;
  return std::accumulate(v.begin(), v.end(), 0.0) / static_cast<double>(v.size());
}

double stddev(const std::vector<double>& v) {
  if (v.size() < 2) return 0.0;
  const double m = mean(v);
  double acc = 0.0;
  for (double x : v) acc += (x - m) * (x - m);
  return std::sqrt(acc / static_cast<double>(v.size() - 1));
}

double quantile(std::vector<double> v, double q) {
  if (v.empty()) return 0.0;
  if (q <= 0.0) return *std::min_element(v.begin(), v.end());
  if (q >= 1.0) return *std::max_element(v.begin(), v.end());
  const size_t idx = static_cast<size_t>(std::llround(q * static_cast<double>(v.size() - 1)));
  std::nth_element(v.begin(), v.begin() + static_cast<long>(idx), v.end());
  return v[idx];
}

}  // namespace

namespace logo_detector {

cv::Mat roiHist512Hsv(const cv::Mat& bgrFrame,
                      int cornerIndex,
                      double roiWidthPct) {
  const auto rect = cornerRect(bgrFrame, cornerIndex, roiWidthPct);
  return hist512Hsv(bgrFrame(rect));
}

double distanceToLogo(const cv::Mat& bgrFrame,
                      int cornerIndex,
                      double roiWidthPct,
                      const cv::Mat& meanHist) {
  const auto rect = cornerRect(bgrFrame, cornerIndex, roiWidthPct);
  const cv::Mat h = hist512Hsv(bgrFrame(rect));
  return cv::compareHist(h, meanHist, cv::HISTCMP_BHATTACHARYYA);
}

TrainingOutput train(const std::string& source,
                     double totalDurationSec,
                     double roiWidthPct,
                     int k,
                     int cornerIndex,
                     double sampleEverySec,
                     int threads,
                     bool captureDebugRois,
                     const std::function<void(int current, int totalOrNeg1)>& onSample) {
  if (totalDurationSec <= 0.0) throw std::runtime_error("totalDurationSec must be > 0");
  if (k < 2) throw std::runtime_error("k must be >= 2");
  if (cornerIndex < 0 || cornerIndex > 3) throw std::runtime_error("cornerIndex must be 0..3");
  if (roiWidthPct <= 0.0) throw std::runtime_error("roiWidthPct must be > 0");
  if (sampleEverySec <= 0.0) throw std::runtime_error("sampleEverySec must be > 0");

  TrainingOutput out;
  out.sampleEverySec = sampleEverySec;

  // Build target sampling timestamps: 0, every, 2*every, ...
  std::vector<double> times;
  for (double t = 0.0; t < totalDurationSec; t += sampleEverySec) times.push_back(t);
  if (times.size() < 5) throw std::runtime_error("not enough samples (need >= 5); increase duration or reduce --every-sec");

  const int detectedCores = static_cast<int>(std::thread::hardware_concurrency());
  const int wantedThreads = (threads <= 0) ? (detectedCores > 0 ? detectedCores : 1) : threads;
  // Requirement: default = available cores; override uses the exact passed value (e.g. --threads 100 => 100).
  const int threadCount = std::max(1, wantedThreads);

  struct Sample {
    int index = 0;
    double tSec = 0.0;
    cv::Mat hist;  // 1x512
    std::vector<unsigned char> roiPng;
  };

  std::vector<Sample> samples;
  samples.reserve(times.size());

  std::atomic<int> completed{0};
  std::mutex errorMu;
  std::string firstError;
  std::mutex samplesMu;
  std::mutex encodeMu;

  std::vector<std::vector<int>> buckets(threadCount);
  buckets.reserve(threadCount);
  for (int i = 0; i < static_cast<int>(times.size()); i++) {
    const double t = times[static_cast<size_t>(i)];
    const int bucket = std::min(threadCount - 1, std::max(0, static_cast<int>((t / totalDurationSec) * threadCount)));
    buckets[bucket].push_back(i);
  }

  auto worker = [&](const std::vector<int>& idxs) {
    try {
      if (idxs.empty()) return;
      cv::VideoCapture localCap(source);
      if (!localCap.isOpened()) throw std::runtime_error("OpenCV could not open m3u8 in worker thread");
      localCap.set(cv::CAP_PROP_BUFFERSIZE, 1);

      for (int idx : idxs) {
        const double t = times[static_cast<size_t>(idx)];
        localCap.set(cv::CAP_PROP_POS_MSEC, t * 1000.0);
        cv::Mat frame;
        if (!localCap.read(frame) || frame.empty()) continue;
        cv::Mat h = cornerHist(frame, cornerIndex, roiWidthPct);  // 1x512
        std::vector<unsigned char> png;
        if (captureDebugRois) {
          const cv::Mat roi = cornerRoi(frame, cornerIndex, roiWidthPct);
          std::lock_guard<std::mutex> lock(encodeMu);
          cv::imencode(".png", roi, png);
        }
        {
          std::lock_guard<std::mutex> lock(samplesMu);
          samples.push_back(Sample{idx, t, h, std::move(png)});
        }
        const int done = ++completed;
        if (onSample) onSample(done, static_cast<int>(times.size()));
      }
    } catch (const std::exception& e) {
      std::lock_guard<std::mutex> lock(errorMu);
      if (firstError.empty()) firstError = e.what();
    }
  };

  std::vector<std::thread> pool;
  pool.reserve(threadCount);
  for (int t = 0; t < threadCount; t++) {
    pool.emplace_back(worker, std::cref(buckets[t]));
  }
  for (auto& th : pool) th.join();

  if (!firstError.empty()) throw std::runtime_error(firstError);

  if (samples.size() < 5) throw std::runtime_error("could not read enough frames for training");

  std::sort(samples.begin(), samples.end(), [](const Sample& a, const Sample& b) { return a.index < b.index; });
  out.sampleTimesSec.clear();
  out.sampleTimesSec.reserve(samples.size());
  cv::Mat data(static_cast<int>(samples.size()), 512, CV_32F, cv::Scalar(0));
  for (int i = 0; i < static_cast<int>(samples.size()); i++) {
    out.sampleTimesSec.push_back(samples[static_cast<size_t>(i)].tSec);
    std::memcpy(data.ptr<float>(i), samples[static_cast<size_t>(i)].hist.ptr<float>(0), sizeof(float) * 512);
  }
  out.sampleHists = data.clone();
  out.sampleRoiPng.clear();
  if (captureDebugRois) {
    out.sampleRoiPng.reserve(samples.size());
    for (const auto& s : samples) out.sampleRoiPng.push_back(s.roiPng);
  }

  cv::PCA pca(data, cv::Mat(), cv::PCA::DATA_AS_ROW, 2);
  cv::Mat projected;
  pca.project(data, projected);  // N x 2
  out.pca2d = projected.clone();

  cv::Mat labels;
  cv::kmeans(projected,
             k,
             labels,
             cv::TermCriteria(cv::TermCriteria::EPS + cv::TermCriteria::COUNT, 40, 1e-4),
             5,
             cv::KMEANS_PP_CENTERS);

  std::vector<int> counts(k, 0);
  for (int r = 0; r < labels.rows; r++) counts[labels.at<int>(r, 0)]++;
  const int logoCluster =
      static_cast<int>(std::distance(counts.begin(), std::max_element(counts.begin(), counts.end())));
  out.logoClusterLabel = logoCluster;
  out.kmeansLabels.clear();
  out.kmeansLabels.reserve(labels.rows);
  for (int r = 0; r < labels.rows; r++) out.kmeansLabels.push_back(labels.at<int>(r, 0));

  std::vector<int> logoIdx;
  std::vector<int> nonLogoIdx;
  for (int r = 0; r < labels.rows; r++) {
    if (labels.at<int>(r, 0) == logoCluster)
      logoIdx.push_back(r);
    else
      nonLogoIdx.push_back(r);
  }

  // Compute a stable meanHist for the logo cluster.
  // Then filter out intra-cluster outliers (often "no-logo" frames that kmeans absorbed).
  auto computeMeanHist = [&](const std::vector<int>& idxs) -> cv::Mat {
    cv::Mat acc = cv::Mat::zeros(1, 512, CV_32F);
    for (int r : idxs) acc += data.row(r);
    acc /= static_cast<float>(std::max<size_t>(1, idxs.size()));
    return acc;
  };

  cv::Mat meanHist = computeMeanHist(logoIdx);
  std::vector<double> dLogoAll;
  dLogoAll.reserve(logoIdx.size());
  for (int r : logoIdx) {
    dLogoAll.push_back(cv::compareHist(data.row(r), meanHist, cv::HISTCMP_BHATTACHARYYA));
  }

  // Keep the densest part of the logo cluster by distance-to-mean.
  // This makes "logo seeds" more reliable for downstream classifiers (KNN/DBSCAN/thresholding).
  std::vector<int> logoSeeds;
  logoSeeds.reserve(logoIdx.size());
  const double cut = quantile(dLogoAll, 0.85);
  for (size_t i = 0; i < logoIdx.size(); i++) {
    if (dLogoAll[i] <= cut) logoSeeds.push_back(logoIdx[i]);
  }
  if (logoSeeds.size() < std::min<size_t>(5, logoIdx.size())) {
    logoSeeds = logoIdx;  // fallback: avoid collapsing if sample set is too small
  } else {
    meanHist = computeMeanHist(logoSeeds);
  }

  // Final distance sets.
  std::vector<double> dLogo;
  dLogo.reserve(logoSeeds.size());
  for (int r : logoSeeds) dLogo.push_back(cv::compareHist(data.row(r), meanHist, cv::HISTCMP_BHATTACHARYYA));

  std::unordered_set<int> seedSet(logoSeeds.begin(), logoSeeds.end());
  std::vector<int> effectiveNonLogoIdx = nonLogoIdx;
  effectiveNonLogoIdx.reserve(nonLogoIdx.size() + (logoIdx.size() - logoSeeds.size()));
  for (int r : logoIdx) {
    if (!seedSet.count(r)) effectiveNonLogoIdx.push_back(r);
  }

  std::vector<double> dNonLogo;
  dNonLogo.reserve(effectiveNonLogoIdx.size());
  for (int r : effectiveNonLogoIdx) dNonLogo.push_back(cv::compareHist(data.row(r), meanHist, cv::HISTCMP_BHATTACHARYYA));

  double threshold = mean(dLogo) + 5.0 * stddev(dLogo);
  if (!dNonLogo.empty()) {
    const double mLogo = mean(dLogo);
    const double mNon = mean(dNonLogo);
    if (mNon > mLogo) threshold = (mLogo + mNon) / 2.0;
  }
  threshold = std::clamp(threshold, 0.05, 0.95);

  out.model.cornerIndex = cornerIndex;
  out.model.meanHist = meanHist;
  out.model.threshold = threshold;
  out.model.logoSampleIndices = logoSeeds;
  return out;
}

}  // namespace logo_detector

