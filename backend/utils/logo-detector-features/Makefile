# logo-detector: HLS (m3u8) logo region detector — OpenCV + FFmpeg (libav)
# Source is logo-detector.c but contains C++ (OpenCV); compiled as C++.

CXX      ?= g++
CXXFLAGS ?= -O2 -std=c++17 -Wall -Wextra -pedantic

PKG_CONFIG ?= pkg-config

OPENCV_PKG := $(shell $(PKG_CONFIG) --exists opencv4 && echo opencv4 || echo opencv)
FFMPEG_LIBS := libavformat libavcodec libswscale libavutil

CXXFLAGS += $(shell $(PKG_CONFIG) --cflags $(OPENCV_PKG))
LDFLAGS  += $(shell $(PKG_CONFIG) --libs $(OPENCV_PKG))
CXXFLAGS += $(shell $(PKG_CONFIG) --cflags $(FFMPEG_LIBS))
LDFLAGS  += $(shell $(PKG_CONFIG) --libs $(FFMPEG_LIBS))
CXXFLAGS += $(shell $(PKG_CONFIG) --cflags libcurl 2>/dev/null)
LDFLAGS  += $(shell $(PKG_CONFIG) --libs libcurl 2>/dev/null || echo -lcurl)

TARGET := logo-detector
SRC    := logo-detector.c

.PHONY: all clean

all: $(TARGET)

$(TARGET): $(SRC)
	$(CXX) $(CXXFLAGS) -x c++ -o $@ $< $(LDFLAGS)

clean:
	rm -f $(TARGET)
