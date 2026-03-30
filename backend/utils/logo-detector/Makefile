# OpenCV 4 (pkg-config name is usually opencv4 on Debian/Ubuntu).
CXX ?= g++
CXXFLAGS ?= -O2 -std=c++17 -Wall -Wextra
OPENCV_PKG ?= $(shell pkg-config --exists opencv4 && echo opencv4 || echo opencv)

logo-detector: logo-detector.cpp
	$(CXX) $(CXXFLAGS) $$(pkg-config --cflags $(OPENCV_PKG)) $< -o $@ $$(pkg-config --libs $(OPENCV_PKG))

clean:
	rm -f logo-detector

.PHONY: clean
