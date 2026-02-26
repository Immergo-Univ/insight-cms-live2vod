#pragma once

#include <string>

namespace http {

// Throws std::runtime_error on failure.
std::string get(const std::string& url, long timeoutSeconds = 20);

// Returns true if the URL responds with 2xx, false otherwise.
// Does not throw — connection errors return false.
bool headOk(const std::string& url, long timeoutSeconds = 3);

}  // namespace http

