#include "m3u8.h"

#include <sstream>
#include <string>
#include <vector>

namespace {

static inline std::string trim(std::string s) {
  while (!s.empty() && (s.back() == '\r' || s.back() == '\n' || s.back() == ' ' ||
                        s.back() == '\t'))
    s.pop_back();
  size_t i = 0;
  while (i < s.size() && (s[i] == ' ' || s[i] == '\t')) i++;
  return s.substr(i);
}

static inline bool startsWith(const std::string& s, const char* prefix) {
  const std::string p(prefix);
  return s.rfind(p, 0) == 0;
}

}  // namespace

namespace m3u8 {

std::vector<Segment> parse(const std::string& playlistContent) {
  std::vector<Segment> segments;
  std::istringstream in(playlistContent);

  std::string currentPdt;
  double currentDur = 0.0;
  bool haveDur = false;

  std::string line;
  while (std::getline(in, line)) {
    line = trim(line);
    if (line.empty()) continue;

    if (startsWith(line, "#EXT-X-PROGRAM-DATE-TIME:")) {
      currentPdt = trim(line.substr(std::string("#EXT-X-PROGRAM-DATE-TIME:").size()));
      // Some playlists put PDT after the segment URI; attach it to the previous segment if needed.
      if (!haveDur && !segments.empty() && segments.back().programDateTime.empty()) {
        segments.back().programDateTime = currentPdt;
      }
      continue;
    }

    if (startsWith(line, "#EXTINF:")) {
      const auto payload = line.substr(std::string("#EXTINF:").size());
      const auto commaPos = payload.find(',');
      const auto durStr = trim(payload.substr(0, commaPos));
      try {
        currentDur = std::stod(durStr);
        haveDur = true;
      } catch (...) {
        haveDur = false;
      }
      continue;
    }

    if (!line.empty() && line[0] != '#') {
      if (!haveDur) continue;
      Segment seg;
      seg.uri = line;
      seg.durationSec = currentDur;
      seg.programDateTime = currentPdt;
      segments.push_back(seg);
      haveDur = false;
      continue;
    }
  }

  double offset = 0.0;
  for (auto& s : segments) {
    s.startOffsetSec = offset;
    offset += s.durationSec;
    s.endOffsetSec = offset;
  }
  return segments;
}

double totalDuration(const std::vector<Segment>& segments) {
  if (segments.empty()) return 0.0;
  return segments.back().endOffsetSec;
}

}  // namespace m3u8

