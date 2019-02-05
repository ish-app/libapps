// Copyright 2019 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

'use strict';

/**
 * @fileoverview nassh.Buffer tests.
 */

nassh.Buffer.Tests = new lib.TestManager.Suite('nassh.Buffer.Tests');

/**
 * Check behavior of empty buffers.
 */
nassh.Buffer.Tests.addTest('buffer-empty', function(result, cx) {
  const buffer = new nassh.Buffer();

  // No data available.
  result.assertEQ(0, buffer.getQueuedBytes());
  // Read data that doesn't exist.
  const data = buffer.read(100);
  // The buffer should be empty.
  result.assertEQ(0, data.length);
  result.assertEQ(new Uint8Array(), data);
  // Internal length should be still be zero.
  result.assertEQ(0, buffer.getQueuedBytes());
  // Acking data that doesn't exist shouldn't confuse it.
  buffer.ack(10);
  result.assertEQ(0, buffer.getQueuedBytes());

  result.pass();
});

/**
 * Check autoacking behavior.
 */
nassh.Buffer.Tests.addTest('buffer-autoack', function(result, cx) {
  const buffer = new nassh.Buffer(true);

  // Write some data to the buffer.
  buffer.write([1, 2]);
  buffer.write([3]);
  // Make sure our counters are correct.
  result.assertEQ(3, buffer.getQueuedBytes());
  result.assertEQ(3, buffer.queued_.length);

  // Read out a byte and check the counters.
  let data = buffer.read(1);
  result.assertEQ(new Uint8Array([1]), data);
  result.assertEQ(2, buffer.getQueuedBytes());
  result.assertEQ(2, buffer.queued_.length);

  // Read out the rest of the data and check the counters.
  data = buffer.read(2);
  result.assertEQ(new Uint8Array([2, 3]), data);
  result.assertEQ(0, buffer.getQueuedBytes());
  result.assertEQ(0, buffer.queued_.length);

  result.pass();
});

/**
 * Check manual acking behavior.
 */
nassh.Buffer.Tests.addTest('buffer-manual-ack', function(result, cx) {
  const buffer = new nassh.Buffer();

  // Write some data to the buffer.
  buffer.write([5, 6, 7]);
  result.assertEQ(3, buffer.getQueuedBytes());

  // Read it out and verify the ack counts.
  let data = buffer.read(1);
  result.assertEQ(2, buffer.getQueuedBytes());
  result.assertEQ(3, buffer.queued_.length);

  // Read out the rest of the data and check the counters.
  data = buffer.read(2);
  result.assertEQ(0, buffer.getQueuedBytes());
  result.assertEQ(3, buffer.queued_.length);

  // Check ack handling.
  buffer.ack(1);
  result.assertEQ(2, buffer.queued_.length);
  buffer.ack(2);
  result.assertEQ(0, buffer.queued_.length);

  result.pass();
});

/**
 * Check automatic buffer growing.
 */
nassh.Buffer.Tests.addTest('buffer-grow', function(result, cx) {
  const buffer = new nassh.Buffer();
  const basesize = buffer.buffer_.byteLength;

  // Fill the buffer.
  buffer.write(new Array(basesize).fill(10));
  result.assertEQ(basesize, buffer.getQueuedBytes());
  result.assertEQ(basesize, buffer.buffer_.byteLength);

  // Add some more data and check the growth.
  buffer.write([1, 2, 3]);
  result.assertEQ(basesize + 1024, buffer.buffer_.byteLength);

  // Read out most data to verify buffer doesn't move.
  result.assertEQ(new Uint8Array(basesize).fill(10), buffer.read(basesize));
  result.assertEQ(basesize + 1024, buffer.buffer_.byteLength);
  result.assertEQ(3, buffer.getQueuedBytes());

  // Write some more data to check more growth.
  buffer.write(new Uint8Array(1024).fill(20));
  result.assertEQ(1027, buffer.getQueuedBytes());
  result.assertEQ(basesize + 2048, buffer.buffer_.byteLength);

  // Read out all the data.
  result.assertEQ(new Uint8Array([1, 2, 3]), buffer.read(3));
  result.assertEQ(new Uint8Array(1024).fill(20), buffer.read(1024));

  // Counters shouldn't change even as we ack.
  result.assertEQ(basesize + 2048, buffer.buffer_.byteLength);
  buffer.ack(basesize + 1027);
  result.assertEQ(basesize + 2048, buffer.buffer_.byteLength);
  result.assertEQ(0, buffer.readCount_);

  result.pass();
});
