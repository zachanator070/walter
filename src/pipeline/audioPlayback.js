import { spawn } from 'child_process';
import config from '../config.js';
import logger from '../utils/logger.js';

class AudioPlayback {
  #process = null;

  // Pipes a Node.js Readable of raw PCM audio into aplay.
  // Resolves when playback finishes.
  play(audioStream) {
    return new Promise((resolve, reject) => {
      const args = [
        '-D', config.audio.outputDevice,
        '-f', 'S16_LE',
        '-r', '16000',
        '-c', '1',
        '-t', 'raw',
        '-q',
      ];

      logger.debug({ device: config.audio.outputDevice }, 'Starting aplay');
      this.#process = spawn('aplay', args, { stdio: ['pipe', 'ignore', 'pipe'] });

      audioStream.pipe(this.#process.stdin);

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

      this.#process.on('close', () => {
        this.#process = null;
        resolve();
      });
    });
  }

  stop() {
    if (this.#process) {
      this.#process.kill('SIGTERM');
      this.#process = null;
    }
  }
}

export default new AudioPlayback();
