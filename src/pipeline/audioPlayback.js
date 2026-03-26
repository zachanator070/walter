import { spawn } from 'child_process';
import { PassThrough } from 'stream';
import config from '../config.js';
import logger from '../utils/logger.js';

class AudioPlayback {
  #process = null;
  #stopping = false;

  // Pipes a Node.js Readable of raw PCM audio into aplay.
  // Resolves when playback finishes.
  play(audioStream) {
    return new Promise((resolve, reject) => {
      const outputDevice = config.audio.outputDevice.startsWith('hw:')
        ? config.audio.outputDevice.replace(/^hw:/, 'plughw:')
        : config.audio.outputDevice;
      const sampleRate = config.audio.sampleRate;
      const leadInMs = config.audio.playbackLeadInMs;

      const args = [
        '-D', outputDevice,
        '-f', 'S16_LE',
        '-r', String(sampleRate),
        '-c', '1',
        '-t', 'raw',
        '-q',
      ];

      logger.debug({
        device: outputDevice,
        configuredDevice: config.audio.outputDevice,
        sampleRate,
        leadInMs,
      }, 'Starting aplay');
      this.#stopping = false;
      this.#process = spawn('aplay', args, { stdio: ['pipe', 'ignore', 'pipe'] });

      const prefixedStream = new PassThrough();
      const leadInBytes = Math.max(0, Math.round(sampleRate * 2 * (leadInMs / 1000)));
      if (leadInBytes > 0) {
        prefixedStream.write(Buffer.alloc(leadInBytes));
      }
      audioStream.pipe(prefixedStream);
      prefixedStream.pipe(this.#process.stdin);

      // EPIPE is expected when aplay finishes before the stream ends
      this.#process.stdin.on('error', err => {
        if (err.code !== 'EPIPE') logger.warn({ err }, 'aplay stdin error');
      });

      this.#process.stderr.on('data', data =>
        logger.debug({ msg: data.toString().trim() }, 'aplay')
      );

      this.#process.on('error', err => {
        this.#process = null;
        reject(err);
      });

      this.#process.on('close', code => {
        this.#process = null;
        if (!this.#stopping && code !== null && code !== 0) {
          reject(new Error(`aplay exited with code ${code}`));
          return;
        }
        resolve();
      });
    });
  }

  stop() {
    if (this.#process) {
      this.#stopping = true;
      this.#process.kill('SIGTERM');
      this.#process = null;
    }
  }
}

export default new AudioPlayback();
