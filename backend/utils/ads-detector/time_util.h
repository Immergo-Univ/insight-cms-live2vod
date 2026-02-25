#pragma once

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <ctime>
#include <cstdint>
#include <iomanip>
#include <sstream>
#include <string>

namespace time_util {

inline int64_t timegm_utc(std::tm* tm) {
#if defined(_GNU_SOURCE) || defined(__GLIBC__)
  return static_cast<int64_t>(::timegm(tm));
#else
  const char* oldTz = std::getenv("TZ");
  setenv("TZ", "UTC", 1);
  tzset();
  const auto t = static_cast<int64_t>(std::mktime(tm));
  if (oldTz) setenv("TZ", oldTz, 1);
  else unsetenv("TZ");
  tzset();
  return t;
#endif
}

inline bool parseIso8601LikeToEpochMs(const std::string& input, int64_t* outEpochMs) {
  // Accepts: "YYYY-MM-DDTHH:MM:SS(.mmm)?(Z|+HHMM|-HHMM|+HH:MM|-HH:MM)"
  if (!outEpochMs) return false;
  if (input.size() < 19) return false;

  std::tm tm{};
  tm.tm_year = std::stoi(input.substr(0, 4)) - 1900;
  tm.tm_mon = std::stoi(input.substr(5, 2)) - 1;
  tm.tm_mday = std::stoi(input.substr(8, 2));
  tm.tm_hour = std::stoi(input.substr(11, 2));
  tm.tm_min = std::stoi(input.substr(14, 2));
  tm.tm_sec = std::stoi(input.substr(17, 2));

  size_t i = 19;
  int ms = 0;
  if (i < input.size() && input[i] == '.') {
    i++;
    const size_t msStart = i;
    while (i < input.size() && std::isdigit(static_cast<unsigned char>(input[i]))) i++;
    const auto msStr = input.substr(msStart, i - msStart);
    if (!msStr.empty()) {
      ms = std::stoi(msStr.substr(0, std::min<size_t>(3, msStr.size())));
      if (msStr.size() == 1) ms *= 100;
      if (msStr.size() == 2) ms *= 10;
    }
  }

  int tzSign = 0;
  int tzHour = 0;
  int tzMin = 0;
  if (i < input.size() && (input[i] == 'Z' || input[i] == 'z')) {
    tzSign = 0;
    i++;
  } else if (i < input.size() && (input[i] == '+' || input[i] == '-')) {
    tzSign = (input[i] == '+') ? 1 : -1;
    i++;
    if (i + 1 >= input.size()) return false;
    tzHour = std::stoi(input.substr(i, 2));
    i += 2;
    if (i < input.size() && input[i] == ':') i++;
    if (i + 1 >= input.size()) return false;
    tzMin = std::stoi(input.substr(i, 2));
    i += 2;
  }

  const int64_t base = timegm_utc(&tm);
  const int64_t tzOffsetSec = tzSign == 0 ? 0 : (tzSign * (tzHour * 3600 + tzMin * 60));
  *outEpochMs = (base - tzOffsetSec) * 1000 + ms;
  return true;
}

inline std::string epochMsToIso8601Utc(int64_t epochMs) {
  const std::time_t sec = static_cast<std::time_t>(epochMs / 1000);
  const int ms = static_cast<int>(epochMs % 1000);
  std::tm tm{};
  gmtime_r(&sec, &tm);
  std::ostringstream out;
  out << std::put_time(&tm, "%Y-%m-%dT%H:%M:%S");
  out << '.' << std::setw(3) << std::setfill('0') << ms << "+0000";
  return out.str();
}

}  // namespace time_util

