// Copyright (c) 2012 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Base class of XHR or WebSocket backed streams.
 *
 * This class implements session initialization and back-off logic common for
 * both types of streams.
 */
nassh.Stream.GoogleRelay = function(fd) {
  nassh.Stream.apply(this, [fd]);

  this.host_ = null;
  this.port_ = null;
  this.relay_ = null;

  this.sessionID_ = null;

  this.backoffMS_ = 0;
  this.backoffTimeout_ = null;

  this.writeBuffer_ = new nassh.Buffer();
  this.writeCount_ = 0;
  this.onWriteSuccess_ = null;

  this.readCount_ = 0;
};

/**
 * We are a subclass of nassh.Stream.
 */
nassh.Stream.GoogleRelay.prototype = Object.create(nassh.Stream.prototype);
nassh.Stream.GoogleRelay.constructor = nassh.Stream.GoogleRelay;

/**
 * Open a relay socket.
 *
 * This fires off the /proxy request, and if it succeeds starts the /read
 * hanging GET.
 */
nassh.Stream.GoogleRelay.prototype.asyncOpen_ = function(args, onComplete) {
  this.relay_ = args.relay;
  this.host_ = args.host;
  this.port_ = args.port;
  this.resume_ = args.resume;

  var sessionRequest = new XMLHttpRequest();

  var onError = () => {
    console.error('Failed to get session id:', sessionRequest);
    onComplete(false, `${sessionRequest.status}: ${sessionRequest.statusText}`);
  };

  var onReady = () => {
    if (sessionRequest.readyState != XMLHttpRequest.DONE)
      return;

    if (sessionRequest.status != 200)
      return onError();

    this.sessionID_ = sessionRequest.responseText;
    this.resumeRead_();
    onComplete(true);
  };

  sessionRequest.open('GET', this.relay_.relayServer +
                      'proxy?host=' + this.host_ + '&port=' + this.port_,
                      true);
  sessionRequest.withCredentials = true;  // We need to see cookies for /proxy.
  sessionRequest.onabort = sessionRequest.ontimeout =
      sessionRequest.onerror = onError;
  sessionRequest.onloadend = onReady;
  sessionRequest.send();
};

nassh.Stream.GoogleRelay.prototype.resumeRead_ = function() {
  throw nassh.Stream.ERR_NOT_IMPLEMENTED;
};

/**
 * Queue up some data to write.
 */
nassh.Stream.GoogleRelay.prototype.asyncWrite = function(data, onSuccess) {
  if (!data.byteLength) {
    return;
  }

  this.writeBuffer_.write(data);
  this.onWriteSuccess_ = onSuccess;

  if (!this.backoffTimeout_)
    this.sendWrite_();
};

/**
 * Send the next pending write.
 */
nassh.Stream.GoogleRelay.prototype.sendWrite_ = function() {
  throw nassh.Stream.ERR_NOT_IMPLEMENTED;
};

/**
 * Indicates that the backoff timer has expired and we can try again.
 *
 * This does not guarantee that communications have been restored, only
 * that we can try again.
 */
nassh.Stream.GoogleRelay.prototype.onBackoffExpired_ = function() {
  this.backoffTimeout_ = null;
  this.resumeRead_();
  this.sendWrite_();
};

/**
 * Called after a successful read or write to indicate that communication
 * is working as expected.
 */
nassh.Stream.GoogleRelay.prototype.requestSuccess_ = function(isRead) {
  this.backoffMS_ = 0;

  if (this.backoffTimeout_) {
    // Sometimes we end up clearing the backoff before the timeout actually
    // expires.  This is the case if a read and write request are in progress
    // and one fails while the other succeeds.  If the success completes *after*
    // the failure, we end up here.
    //
    // We assume we're free to clear the backoff and continue as normal.
    clearTimeout(this.backoffTimeout_);
    this.onBackoffExpired_();
  } else {
    if (isRead) {
      this.resumeRead_();
    } else {
      this.sendWrite_();
    }
  }
};

nassh.Stream.GoogleRelay.prototype.requestError_ = function(isRead) {
  if (!this.sessionID_ || this.backoffTimeout_)
    return;

  if (!this.backoffMS_) {
    this.backoffMS_ = 1;
  } else {
    this.backoffMS_ = this.backoffMS_ * 2 + 13;
    if (this.backoffMS_ > 10000)
      this.backoffMS_ = 10000 - (this.backoffMS_ % 9000);
  }

  var requestType = isRead ? 'read' : 'write';
  console.log('Error during ' + requestType +
              ', backing off: ' + this.backoffMS_ + 'ms');

  if (this.backoffMS_ >= 1000) {
    // Browser timeouts tend to have a wide margin for error.  We want to reduce
    // the risk that a failed retry will redisplay this message just as its
    // fading away.  So we show the retry message for a little longer than we
    // expect to back off.
    this.relay_.io.showOverlay(nassh.msg('RELAY_RETRY'), this.backoffMS_ + 500);
  }

  this.backoffTimeout_ =
      setTimeout(this.onBackoffExpired_.bind(this), this.backoffMS_);
};

/**
 * XHR backed stream.
 *
 * This class manages the read and write XML http requests used to communicate
 * with the Google relay server.
 */
nassh.Stream.GoogleRelayXHR = function(fd) {
  nassh.Stream.GoogleRelay.apply(this, [fd]);

  this.writeRequest_ = new XMLHttpRequest();
  this.writeRequest_.ontimeout = this.writeRequest_.onabort =
      this.writeRequest_.onerror = this.onRequestError_.bind(this);
  this.writeRequest_.onloadend = this.onWriteDone_.bind(this);

  this.readRequest_ = new XMLHttpRequest();
  this.readRequest_.ontimeout = this.readRequest_.onabort =
      this.readRequest_.onerror = this.onRequestError_.bind(this);
  this.readRequest_.onloadend = this.onReadReady_.bind(this);

  this.lastWriteSize_ = 0;
};

/**
 * We are a subclass of nassh.Stream.GoogleRelay.
 */
nassh.Stream.GoogleRelayXHR.prototype =
    Object.create(nassh.Stream.GoogleRelay.prototype);
nassh.Stream.GoogleRelayXHR.constructor = nassh.Stream.GoogleRelayXHR;

/**
 * Maximum length of message that can be sent to avoid request limits.
 */
nassh.Stream.GoogleRelayXHR.prototype.maxMessageLength = 1024;

nassh.Stream.GoogleRelayXHR.prototype.resumeRead_ = function() {
  if (this.isRequestBusy_(this.readRequest_)) {
    // Read request is in progress.
    return;
  }

  if (this.backoffTimeout_) {
    console.warn('Attempt to read while backing off.');
    return;
  }

  this.readRequest_.open('GET', this.relay_.relayServer + 'read?sid=' +
                         this.sessionID_ + '&rcnt=' + this.readCount_, true);
  this.readRequest_.send();
};

/**
 * Send the next pending write.
 */
nassh.Stream.GoogleRelayXHR.prototype.sendWrite_ = function() {
  if (this.writeBuffer_.getQueuedBytes() == 0 ||
      this.isRequestBusy_(this.writeRequest_)) {
    // Nothing to write, or a write is in progress.
    return;
  }

  if (this.backoffTimeout_) {
    console.warn('Attempt to write while backing off.');
    return;
  }

  const dataBuffer = this.writeBuffer_.read(this.maxMessageLength);
  const data = nassh.base64ToBase64Url(btoa(
      lib.codec.codeUnitArrayToString(dataBuffer)));
  this.writeRequest_.open('GET', this.relay_.relayServer +
                          'write?sid=' + this.sessionID_ +
                          '&wcnt=' + this.writeCount_ + '&data=' + data, true);
  this.writeRequest_.send();
  this.lastWriteSize_ = dataBuffer.length;
};

/**
 * Called when the readRequest_ has finished loading.
 *
 * This indicates that the response entity has the data for us to send to the
 * terminal.
 */
nassh.Stream.GoogleRelayXHR.prototype.onReadReady_ = function(e) {
  if (this.readRequest_.readyState != XMLHttpRequest.DONE)
    return;

  if (this.readRequest_.status == 410) {
    // HTTP 410 Gone indicates that the relay has dropped our ssh session.
    this.close();
    this.sessionID_ = null;
    return;
  }

  if (this.readRequest_.status != 200)
    return this.onRequestError_(e);

  this.readCount_ += Math.floor(
      this.readRequest_.responseText.length * 3 / 4);
  var data = nassh.base64UrlToBase64(this.readRequest_.responseText);
  this.onDataAvailable(data);

  this.requestSuccess_(true);
};

/**
 * Called when the writeRequest_ has finished loading.
 *
 * This indicates that data we wrote has either been successfully written, or
 * failed somewhere along the way.
 */
nassh.Stream.GoogleRelayXHR.prototype.onWriteDone_ = function(e) {
  if (this.writeRequest_.readyState != XMLHttpRequest.DONE)
    return;

  if (this.writeRequest_.status == 410) {
    // HTTP 410 Gone indicates that the relay has dropped our ssh session.
    this.close();
    return;
  }

  if (this.writeRequest_.status != 200)
    return this.onRequestError_(e);

  this.writeBuffer_.ack(this.lastWriteSize_);
  this.writeCount_ += this.lastWriteSize_;

  this.requestSuccess_(false);

  if (typeof this.onWriteSuccess_ == 'function')
    this.onWriteSuccess_(this.writeCount_);
};

nassh.Stream.GoogleRelayXHR.prototype.onRequestError_ = function(e) {
  this.requestError_(e.target == this.readRequest_);
};

/**
 * Returns true if the given XHR is busy.
 */
nassh.Stream.GoogleRelayXHR.prototype.isRequestBusy_ = function(r) {
  return (r.readyState != XMLHttpRequest.DONE &&
          r.readyState != XMLHttpRequest.UNSENT);
};

/**
 * WebSocket backed stream.
 *
 * This class manages the read and write through WebSocket to communicate
 * with the Google relay server.
 */
nassh.Stream.GoogleRelayWS = function(fd) {
  nassh.Stream.GoogleRelay.apply(this, [fd]);

  this.socket_ = null;

  // Time when data was sent most recently.
  this.ackTime_ = 0;

  // Ack related to most recently sent data.
  this.expectedAck_ = 0;

  // Circular list of recently observed ack times.
  this.ackTimes_ = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  // Slot to record next ack time in.
  this.ackTimesIndex_ = 0;

  // Number of connect attempts made.
  this.connectCount_ = 0;
};

/**
 * We are a subclass of nassh.Stream.GoogleRelay.
 */
nassh.Stream.GoogleRelayWS.prototype =
    Object.create(nassh.Stream.GoogleRelay.prototype);
nassh.Stream.GoogleRelayWS.constructor = nassh.Stream.GoogleRelayWS;

/**
 * Maximum length of message that can be sent to avoid request limits.
 * -4 for 32-bit ack that is sent before payload.
 */
nassh.Stream.GoogleRelayWS.prototype.maxMessageLength = 32 * 1024 - 4;

nassh.Stream.GoogleRelayWS.prototype.resumeRead_ = function() {
  if (this.backoffTimeout_) {
    console.warn('Attempt to read while backing off.');
    return;
  }

  if (this.sessionID_ && !this.socket_) {
    var uri = this.relay_.relayServerSocket +
        'connect?sid=' + this.sessionID_ +
        '&ack=' + (this.readCount_ & 0xffffff) +
        '&pos=' + (this.writeCount_ & 0xffffff);
    if (this.relay_.reportConnectAttempts)
      uri += '&try=' + ++this.connectCount_;
    this.socket_ = new WebSocket(uri);
    this.socket_.binaryType = 'arraybuffer';
    this.socket_.onopen = this.onSocketOpen_.bind(this);
    this.socket_.onmessage = this.onSocketData_.bind(this);
    this.socket_.onclose = this.socket_.onerror =
        this.onSocketError_.bind(this);
  }
};

nassh.Stream.GoogleRelayWS.prototype.onSocketOpen_ = function(e) {
  if (e.target !== this.socket_)
    return;

  this.connectCount_ = 0;
  this.requestSuccess_(false);
};

nassh.Stream.GoogleRelayWS.prototype.recordAckTime_ = function(deltaTime) {
  this.ackTimes_[this.ackTimesIndex_] = deltaTime;
  this.ackTimesIndex_ = (this.ackTimesIndex_ + 1) % this.ackTimes_.length;

  if (this.ackTimesIndex_ == 0) {
    // Filled the circular buffer; compute average.
    var average = 0;
    for (var i = 0; i < this.ackTimes_.length; ++i)
      average += this.ackTimes_[i];
    average /= this.ackTimes_.length;

    if (this.relay_.reportAckLatency) {
      // Report observed average to relay.
      // Send this meta-data as string vs. the normal binary payloads.
      var msg = 'A:' + Math.round(average);
      this.socket_.send(msg);
    }
  }
};

nassh.Stream.GoogleRelayWS.prototype.onSocketData_ = function(e) {
  if (e.target !== this.socket_)
    return;

  const dv = new DataView(e.data);
  const ack = dv.getUint32(0);

  // Acks are unsigned 24 bits. Negative means error.
  if (ack > 0xffffff) {
    this.close();
    this.sessionID_ = null;
    return;
  }

  // Track ack latency.
  if (this.ackTime_ != 0 && ack == this.expectedAck_) {
    this.recordAckTime_(Date.now() - this.ackTime_);
    this.ackTime_ = 0;
  }

  // Unsigned 24 bits wrap-around delta.
  var delta = ((ack & 0xffffff) - (this.writeCount_ & 0xffffff)) & 0xffffff;
  this.writeBuffer_.ack(delta);
  this.writeCount_ += delta;

  // This creates a copy of the ArrayBuffer, but there doesn't seem to be an
  // alternative -- PPAPI doesn't accept views like Uint8Array.  And if it did,
  // it would probably still serialize the entire underlying ArrayBuffer (which
  // in this case wouldn't be a big deal as it's only 4 extra bytes).
  const data = e.data.slice(4);
  if (data.byteLength) {
    this.onDataAvailable(data);
    this.readCount_ += data.byteLength;
  }

  // isRead == false since for WebSocket we don't need to send another read
  // request, we will get new data as soon as it comes.
  this.requestSuccess_(false);
};

nassh.Stream.GoogleRelayWS.prototype.onSocketError_ = function(e) {
  if (e.target !== this.socket_)
    return;

  this.socket_.close();
  this.socket_ = null;
  if (this.resume_) {
    this.requestError_(true);
  } else {
    nassh.Stream.prototype.close.call(this);
  }
};

nassh.Stream.GoogleRelayWS.prototype.sendWrite_ = function() {
  if (!this.socket_ || this.socket_.readyState != 1 ||
      this.writeBuffer_.getQueuedBytes() == 0) {
    // Nothing to write or socket is not ready.
    return;
  }

  if (this.backoffTimeout_) {
    console.warn('Attempt to write while backing off.');
    return;
  }

  const dataBuffer = this.writeBuffer_.read(this.maxMessageLength);
  const buf = new ArrayBuffer(dataBuffer.length + 4);
  const u8 = new Uint8Array(buf, 4);
  const dv = new DataView(buf);

  // Every ws.send() maps to a Websocket frame on wire.
  // Use first 4 bytes to send ack.
  dv.setUint32(0, this.readCount_ & 0xffffff);

  // Copy over the buffer.
  u8.set(dataBuffer);

  this.socket_.send(buf);

  // Track ack latency.
  this.ackTime_ = Date.now();
  this.expectedAck_ = this.writeCount_ & 0xffffff;

  if (typeof this.onWriteSuccess_ == 'function') {
    // Notify nassh that we are ready to consume more data.
    this.onWriteSuccess_(this.writeCount_);
  }

  if (this.writeBuffer_.getQueuedBytes()) {
    // We have more data to send but due to message limit we didn't send it.
    // We don't know when data was sent so just send new portion async.
    setTimeout(this.sendWrite_.bind(this), 0);
  }
};
