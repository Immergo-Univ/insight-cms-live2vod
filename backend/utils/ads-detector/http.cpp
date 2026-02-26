#include "http.h"

#include <curl/curl.h>

#include <stdexcept>
#include <string>

namespace {

size_t writeToString(void* contents, size_t size, size_t nmemb, void* userp) {
  const size_t total = size * nmemb;
  auto* out = static_cast<std::string*>(userp);
  out->append(static_cast<const char*>(contents), total);
  return total;
}

}  // namespace

namespace http {

std::string get(const std::string& url, long timeoutSeconds) {
  CURL* curl = curl_easy_init();
  if (!curl) throw std::runtime_error("curl_easy_init failed");

  std::string response;
  curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
  curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
  curl_easy_setopt(curl, CURLOPT_TIMEOUT, timeoutSeconds);
  curl_easy_setopt(curl, CURLOPT_USERAGENT, "insight-ads-detector/1.0");
  curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeToString);
  curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);

  const CURLcode res = curl_easy_perform(curl);
  long httpCode = 0;
  curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &httpCode);
  curl_easy_cleanup(curl);

  if (res != CURLE_OK) {
    throw std::runtime_error(std::string("curl_easy_perform failed: ") +
                             curl_easy_strerror(res));
  }
  if (httpCode >= 400) {
    throw std::runtime_error("HTTP error " + std::to_string(httpCode));
  }
  return response;
}

bool headOk(const std::string& url, long timeoutSeconds) {
  CURL* curl = curl_easy_init();
  if (!curl) return false;

  curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
  curl_easy_setopt(curl, CURLOPT_NOBODY, 1L);
  curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
  curl_easy_setopt(curl, CURLOPT_TIMEOUT, timeoutSeconds);
  curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, timeoutSeconds);
  curl_easy_setopt(curl, CURLOPT_USERAGENT, "insight-ads-detector/1.0");

  const CURLcode res = curl_easy_perform(curl);
  long httpCode = 0;
  if (res == CURLE_OK) {
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &httpCode);
  }
  curl_easy_cleanup(curl);

  return res == CURLE_OK && httpCode >= 200 && httpCode < 400;
}

}  // namespace http

