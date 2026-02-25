#pragma once

#include <string>
#include <vector>

namespace m3u8 {

struct Segment {
  std::string uri;
  double durationSec = 0.0;
  std::string programDateTime;  // Raw string after EXT-X-PROGRAM-DATE-TIME:
  double startOffsetSec = 0.0;
  double endOffsetSec = 0.0;
};

std::vector<Segment> parse(const std::string& playlistContent);
double totalDuration(const std::vector<Segment>& segments);

}  // namespace m3u8

