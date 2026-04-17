import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import config from '../config.js';
import logger from '../utils/logger.js';

export class AudioCapture extends EventEmitter {
  #process = null;
  #stopping = false;
  #segmentActive = false;
  #prebuffer = [];
  #prebufferBytes = 0;
  #maxPrebufferBytes = Math.max(
    0,
    Math.round(config.audio.sampleRate * 2 * (config.audio.preRollMs / 1000))
  );

  start() {
    if (this.#process) return;

    const inputDevice = config.audio.inputDevice.startsWith('hw:')
      ? config.audio.inputDevice.replace(/^hw:/, 'plughw:')
      : config.audio.inputDevice;

    const args = [
      '-D', inputDevice,
      '-f', 'S16_LE',
      '-r', String(config.audio.sampleRate),
      '-c', '1',
      '-t', 'raw',
      '-q',
    ];

    logger.debug({
      device: inputDevice,
      configuredDevice: config.audio.inputDevice,
      preRollMs: config.audio.preRollMs,
    }, 'Starting arecord');
    this.#stopping = false;
    this.#process = spawn('arecord', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    this.#process.stdout.on('data', chunk => {
      this.#rememberChunk(chunk);
      if (this.#segmentActive) {
        this.emit('data', chunk);
      }
    });

    this.#process.stderr.on('data', data => {
      const msg = data.toString().trim();
      if (!msg) return;

      if (this.#stopping && this.#isExpectedShutdownMessage(msg)) {
        logger.debug({ msg }, 'arecord stopped');
        return;
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

      if (this.#stopping) {
        logger.debug({ code, signal }, 'arecord exited after stop request');
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

      const escalate = signal => {
        if (proc.exitCode === null && proc.signalCode === null) {
          try {
            proc.kill(signal);
          } catch {}
        }
      };

      escalate('SIGINT');
      setTimeout(() => escalate('SIGTERM'), 1000).unref();
      setTimeout(() => escalate('SIGKILL'), 2500).unref();
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
