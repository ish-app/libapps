// Copyright 2019 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

'use strict';

/**
 * @fileoverview: Utility code for generic worker processes.
 */

/**
 * A worker that runs a producer and consumer in parallel.
 */
nassh.WorkerPipeline = function(producer, consumer, {
    size=10,
    producerDelay=50,
    consumerDelay=10}={}) {
  this.producer = producer;
  this.consumer = consumer;

  // The chunks that have been read in and are waiting for transmission.
  // The size here is a bit arbitrary -- we don't want it to be too big
  // for memory usage, but need to make sure the write process is never
  // starved.  Since local disk reads are usually significantly faster,
  // this seems to be OK.
  this.queue_ = [];
  this.queueSize_ = size;

  // How long to sleep when the pipeline is empty/full.
  this.producerDelay_ = producerDelay;
  this.consumerDelay_ = consumerDelay;

  // Signal that the processes should exit.
  this.halt_ = false;

  // Signal to the consumer process when the producer process is done.
  this.producerFinished_ = false;
};

nassh.WorkerPipeline.FINISHED = Symbol('Finished');

nassh.WorkerPipeline.prototype.stop = function() {
  this.halt_ = true;
};

nassh.WorkerPipeline.prototype.run = function() {
  // Kick off the producer & consumer processes.
  return Promise.all([
    this.producerProcess_().then(() => {
      this.producerFinished_ = true;
    }),
    this.consumerProcess_(),
  ]);
};

nassh.WorkerPipeline.prototype.producerProcess_ = function() {
  // The producer process that pushes new work units onto the queue.
  return new Promise((resolve) => {
    // The main loop to manage filling the queue.
    const main = () => {
      if (this.halt_) {
        resolve();
        return;
      }

      // If the queue isn't full, produce another unit, then run again for
      // the next unit.  If the queue is full, go to sleep for a short
      // time and hope the consumer process consumed a unit.
      if (this.queue_.length < this.queueSize_) {
        return this.producer().then((result) => {
          if (result === nassh.WorkerPipeline.FINISHED) {
            resolve();
          } else {
            this.queue_.push(result);
            return main();
          }
        })
        .catch(resolve);
      } else {
        setTimeout(main, this.producerDelay_);
      }
    };

    main();
  });
};

nassh.WorkerPipeline.prototype.consumerProcess_ = function() {
  // The write process that reads new chunks off the head of the queue.
  return new Promise((resolve) => {
    // The main loop to manage draining the queue.
    const main = () => {
      if (this.halt_) {
        resolve();
        return;
      }

      // If the queue has work, pop the first item off and send it, then
      // run again for the next chunk.  If the queue is empty and the
      // reading has finished, then we can halt too.  Otherwise sleep.
      if (this.queue_.length) {
        return this.consumer(this.queue_.shift())
          .then(main)
          .catch(resolve);
      } else if (this.producerFinished_) {
        resolve();
      } else {
        setTimeout(main, this.consumerDelay_);
      }
    };

    main();
  });
};
