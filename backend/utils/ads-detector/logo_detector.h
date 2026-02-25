#pragma once

#include <opencv2/core.hpp>
#include <opencv2/videoio.hpp>

#include <functional>
#include <string>
#include <vector>

namespace logo_detector {

struct LogoModel {
  int cornerIndex = 0;          // 0 TL, 1 TR, 2 BL, 3 BR
  cv::Mat meanHist;             // 1x(8*8*8) CV_32F
  double threshold = 0.35;      // Bhattacharyya distance threshold
  std::vector<int> logoSampleIndices;
};

struct TrainingOutput {
  LogoModel model;
  double sampleEverySec = 5.0;
  std::vector<double> sampleTimesSec;  // Sampled timestamps (seconds)
  cv::Mat sampleHists;                 // N x 512 (CV_32F), ROI histogram per sample
  std::vector<std::vector<unsigned char>> sampleRoiPng;  // N (optional, debug)
  cv::Mat pca2d;                       // N x 2 (CV_32F)
  cv::PCA pcaModel;                    // PCA model for projecting new histograms
  std::vector<int> kmeansLabels;       // N
  int logoClusterLabel = 0;
};

TrainingOutput train(const std::string& source,
                     double totalDurationSec,
                     double roiWidthPct,
                     int k,
                     int cornerIndex,
                     double sampleEverySec,
                     int threads,
                     bool captureDebugRois,
                     const std::function<void(int current, int totalOrNeg1)>& onSample = {});

double distanceToLogo(const cv::Mat& bgrFrame,
                      int cornerIndex,
                      double roiWidthPct,
                      const cv::Mat& meanHist);

cv::Mat extractHistogram(const cv::Mat& bgrFrame,
                         int cornerIndex,
                         double roiWidthPct);

}  // namespace logo_detector

