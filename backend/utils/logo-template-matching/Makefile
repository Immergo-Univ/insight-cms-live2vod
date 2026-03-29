# Single-source binary (see header comment in logo-template-matching.c).
CC ?= gcc
CFLAGS ?= -O2 -std=c11 -Wall -Wextra
LDFLAGS ?= -lcurl -lm

logo-template-matching: logo-template-matching.c
	$(CC) $(CFLAGS) logo-template-matching.c -o logo-template-matching $(LDFLAGS)

clean:
	rm -f logo-template-matching

.PHONY: clean
