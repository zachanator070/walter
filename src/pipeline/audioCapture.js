import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import config from '../config.js';
import logger from '../utils/logger.js';

export class AudioCapture extends EventEmitter {
  #process = null;
  #stopping = false;
  #segmentActive = false;
  #sawExpectedExit = false;
  #prebuffer = [];
  #prebufferBytes = 0;
  #finalizeNotifier = null;
  #maxPrebufferBytes = Math.max(
    0,
    Math.round(config.audio.sampleRate * 2 * (config.audio.preRollMs / 1000))
  );

  start() {
    if (this.#process) return;

    const inputDevice = config.audio.inputDevice.startsWith('hw:')
      ? config.audio.inputDevice.replace(/^hw:/, 'plughw:')
      : config.audio.inputDevice;

    // Small period/buffer sizes keep stdout reads short so event-loop stalls
    // (e.g. PTT key-repeat floods) are less likely to overrun or batch huge chunks.
    const periodSize = Math.max(128, Math.round(config.audio.sampleRate * 0.05));
    const args = [
      '-D', inputDevice,
      '-f', 'S16_LE',
      '-r', String(config.audio.sampleRate),
      '-c', '1',
      '--period-size', String(periodSize),
      '--buffer-size', String(periodSize * 4),
      '-t', 'raw',
      '-q',
    ];

    logger.debug({
      device: inputDevice,
      configuredDevice: config.audio.inputDevice,
      preRollMs: config.audio.preRollMs,
    }, 'Starting arecord');
    this.#stopping = false;
    this.#sawExpectedExit = false;
    this.#process = spawn('arecord', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    this.#process.stdout.on('data', chunk => {
      this.#rememberChunk(chunk);
      if (this.#segmentActive) {
        this.emit('data', chunk);
        this.#finalizeNotifier?.(chunk.length);
      }
    });

    this.#process.stderr.on('data', data => {
      const msg = data.toString().trim();
      if (!msg) return;

      if (this.#isExpectedShutdownMessage(msg)) {
        this.#sawExpectedExit = true;

        if (this.#stopping) {
          logger.debug({ msg }, 'arecord stopped');
          return;
        }
      }

      logger.debug({ msg }, 'arecord');
    });

    this.#process.on('error', err => {
      if (this.#stopping && err?.code === 'ESRCH') return;
      this.emit('error', err);
    });

    this.#process.on('close', (code, signal) => {
      this.#process = null;
      this.#segmentActive = false;

      if (this.#stopping || this.#sawExpectedExit) {
        logger.debug({ code, signal, expected: this.#sawExpectedExit }, 'arecord exited during shutdown');
        this.#sawExpectedExit = false;
        return;
      }

      if (code !== null && code !== 0) {
        this.emit('error', new Error(`arecord exited with code ${code}${signal ? ` (signal ${signal})` : ''}`));
      }
    });
  }

  beginSegment() {
    if (!this.#process) this.start();
    if (this.#segmentActive) return;

    this.#segmentActive = true;
    logger.debug({ bufferedBytes: this.#prebufferBytes }, 'Starting audio segment with pre-roll');

    for (const chunk of this.#prebuffer) {
      this.emit('data', Buffer.from(chunk));
    }
  }

  endSegment() {
    this.#segmentActive = false;
  }

  // Keep forwarding audio after key-up until arecord goes quiet (captures trailing speech).
  finalizeSegment() {
    return new Promise(resolve => {
      if (!this.#segmentActive) {
        resolve();
        return;
      }

      const maxWaitMs = 600;
      const quietMs = 150;
      const startedAt = Date.now();
      let quietTimer;
      let maxTimer;
      let bytesForwarded = 0;

      const finish = () => {
        this.#finalizeNotifier = null;
        clearTimeout(quietTimer);
        clearTimeout(maxTimer);
        this.#segmentActive = false;
        logger.debug({
          bytesForwarded,
          elapsedMs: Date.now() - startedAt,
        }, 'Audio segment finalized');
        resolve();
      };

      this.#finalizeNotifier = byteLength => {
        bytesForwarded += byteLength;
        clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, quietMs);
      };

      maxTimer = setTimeout(finish, maxWaitMs);
      quietTimer = setTimeout(finish, quietMs);
    });
  }

  // Release the capture device (e.g. before speaker playback on half-duplex hardware).
  suspend() {
    return this.stop();
  }

  resume() {
    this.start();
  }

  stop() {
    return new Promise(resolve => {
      if (!this.#process) return resolve();

      const proc = this.#process;
      this.#process = null;
      this.#stopping = true;
      this.#segmentActive = false;

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        this.#stopping = false;
        resolve();
      };

      proc.once('close', finish);
      proc.once('exit', finish);

      const escalate = signal => {
        if (proc.exitCode === null && proc.signalCode === null) {
          try {
            proc.kill(signal);
          } catch {}
        }
      };

      if (proc.exitCode !== null || proc.signalCode !== null || proc.killed) {
        finish();
        return;
      }

      escalate('SIGINT');
      setTimeout(() => escalate('SIGTERM'), 1000).unref();
      setTimeout(() => escalate('SIGKILL'), 2500).unref();
      setTimeout(finish, 3000).unref();
    });
  }

  #rememberChunk(chunk) {
    if (this.#maxPrebufferBytes <= 0) return;

    const copy = Buffer.from(chunk);
    this.#prebuffer.push(copy);
    this.#prebufferBytes += copy.length;

    while (this.#prebufferBytes > this.#maxPrebufferBytes && this.#prebuffer.length > 0) {
      this.#prebufferBytes -= this.#prebuffer.shift().length;
    }
  }

  #isExpectedShutdownMessage(msg) {
    return /Interrupted system call|aborted by signal/i.test(msg);
  }
}
