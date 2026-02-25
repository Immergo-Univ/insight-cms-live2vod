#pragma once

#include <string>

namespace http {

// Throws std::runtime_error on failure.
std::string get(const std::string& url, long timeoutSeconds = 20);

}  // namespace http

