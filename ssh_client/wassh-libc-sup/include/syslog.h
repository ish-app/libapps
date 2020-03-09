// Copyright 2019 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/syslog.h.html

// We don't currently implement these functions.  OpenSSH wants this header and
// its settings in order to compile, so satisfy it.  Might be useful to support
// later too.

#ifndef WASSH_SYSLOG_H
#define WASSH_SYSLOG_H

#include <sys/cdefs.h>

__BEGIN_DECLS

// openlog() options.
#define LOG_PID     0x01
#define LOG_CONS    0x02
#define LOG_NDELAY  0x08
#define LOG_ODELAY  0x04
#define LOG_NOWAIT  0x10

// openlog() facilities.
#define LOG_KERN    (0 << 3)
#define LOG_USER    (1 << 3)
#define LOG_MAIL    (2 << 3)
#define LOG_NEWS    (3 << 3)
#define LOG_UUCP    (4 << 3)
#define LOG_DAEMON  (5 << 3)
#define LOG_AUTH    (6 << 3)
#define LOG_CRON    (7 << 3)
#define LOG_LPR     (8 << 3)
#define LOG_LOCAL0  (9 << 3)
#define LOG_LOCAL1  (10 << 3)
#define LOG_LOCAL2  (11 << 3)
#define LOG_LOCAL3  (12 << 3)
#define LOG_LOCAL4  (13 << 3)
#define LOG_LOCAL5  (14 << 3)
#define LOG_LOCAL6  (15 << 3)
#define LOG_LOCAL7  (16 << 3)

// syslog() priorities.
#define LOG_EMERG   0
#define LOG_ALERT   1
#define LOG_CRIT    2
#define LOG_ERR     3
#define LOG_WARNING 4
#define LOG_NOTICE  5
#define LOG_INFO    6
#define LOG_DEBUG   7

// setlogmask() helper.
#define LOG_MASK(pri) (1 << (pri))

void closelog(void);
void openlog(const char*, int, int);
int setlogmask(int);
void syslog(int, const char*, ...)
    __attribute__((__format__(__printf__, 2, 3)));

__END_DECLS

#endif
