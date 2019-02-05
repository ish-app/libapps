// Copyright 2019 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

'use strict';

/**
 * @fileoverview Some generic array/buffer helpers.
 */

/**
 * A FIFO byte stream of ackable data.
 *
 * This provides a FIFO byte stream of all the queued data.  This allows
 * multiple arrays of different sizes to be merged together and then easily
 * read out in a single flat stream.  The read process need not be aware of
 * the incoming buffers and their sizes.
 *
 * Buffers are copied when written.
 *
 * When data is read, it is retained until explicitly acked.  This allows for
 * rewinding.
 *
 * The buffer will automatically grow as needed (or the VM runs out of memory),
 * and will shrink itself back down when fully acked.
 *
 * @param {boolean} autoack Automatically call ack() during read().
 */
nassh.Buffer = function(autoack=false) {
  this.buffer_ = new ArrayBuffer(32 * 1024);
  this.u8_ = new Uint8Array(this.buffer_);
  this.free_ = this.u8_.subarray();
  this.queued_ = this.u8_.subarray(0, 0);
  this.readCount_ = 0;
  this.autoack_ = autoack;
};

/**
 * Return the number of unread bytes still queued.
 *
 * @return {number} How many unread bytes are available for reading.
 */
nassh.Buffer.prototype.getQueuedBytes = function() {
  return this.queued_.length - this.readCount_;
};

/**
 * Add the buffer to the queue.
 *
 * The buffer may be a raw ArrayBuffer or a typed array.  The data is copied
 * in, so the buffer may be safely reused after it's been written.
 *
 * @param {ArrayBuffer|TypedArray} buffer The buffer to queue.
 */
nassh.Buffer.prototype.write = function(buffer) {
  if (buffer instanceof ArrayBuffer) {
    buffer = new Uint8Array(buffer);
  } else if (!ArrayBuffer.isView(buffer) && !Array.isArray(buffer)) {
    throw new Error('Invalid argument type');
  }

  if (this.free_.length < buffer.length) {
    if (this.u8_.length < this.queued_.length + buffer.length) {
      // Expand the buffer 1kb or so at a time.
      const size = (Math.floor((this.queued_.length + buffer.length) / 1024)
                    + 1) * 1024;
      this.buffer_ = new ArrayBuffer(size);
      this.u8_ = new Uint8Array(this.buffer_);
    }

    // Move the existing bytes to the new location.
    this.u8_.set(this.queued_);
    this.queued_ = this.u8_.subarray(0, this.queued_.length);
    this.free_ = this.u8_.subarray(this.queued_.length);
  }

  this.free_.set(buffer);
  this.free_ = this.free_.subarray(buffer.length);
  this.queued_ = this.u8_.subarray(
      this.queued_.byteOffset,
      this.queued_.byteOffset + this.queued_.length + buffer.length);
};

/**
 * Read queued data out.
 *
 * The returned array is a view into the underlying buffer.  It should not be
 * mutated unless rewinds are not necessary.
 *
 * Short/partial reads are supported.
 *
 * @param {number} length How many bytes to read.
 * @param {Uint8Array} The bytes requested.
 */
nassh.Buffer.prototype.read = function(length) {
  let ret = this.queued_.subarray(this.readCount_, this.readCount_ + length);
  this.readCount_ += ret.length;
  if (this.autoack_) {
    ret = ret.slice();
    this.ack(ret.length);
  }
  return ret;
};

/**
 * Ack bytes previously read from the buffer.
 *
 * Data is not actually released until acked.
 *
 * @param {number} length How many bytes to ack.
 */
nassh.Buffer.prototype.ack = function(length) {
  if (length < this.queued_.length) {
    // We still have pending data.
    this.queued_ = this.queued_.subarray(length);
    this.readCount_ -= length;
  } else {
    // We've flushed all pending data, so reset all our views.
    if (this.buffer_.byteLength >= 128 * 1024) {
      // If our buffer grew quite a lot, take it back down.
      this.buffer_ = new ArrayBuffer(32 * 1024);
      this.u8_ = new Uint8Array(this.buffer_);
    }

    this.free_ = this.u8_.subarray();
    this.queued_ = this.u8_.subarray(0, 0);
    this.readCount_ = 0;
  }
};
