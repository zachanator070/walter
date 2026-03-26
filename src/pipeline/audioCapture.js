import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import config from '../config.js';
import logger from '../utils/logger.js';

export class AudioCapture extends EventEmitter {
  #process = null;

  start() {
    const args = [
      '-D', config.audio.inputDevice,
      '-f', 'S16_LE',
      '-r', String(config.audio.sampleRate),
      '-c', '1',
      '-t', 'raw',
      '-q',
    ];

    logger.debug({ device: config.audio.inputDevice }, 'Starting arecord');
    this.#process = spawn('arecord', args);

    this.#process.stdout.on('data', chunk => this.emit('data', chunk));

    this.#process.stderr.on('data', data =>
      logger.debug({ msg: data.toString().trim() }, 'arecord')
    );

    this.#process.on('error', err => this.emit('error', err));

    this.#process.on('close', code => {
      if (code !== null && code !== 0) {
        this.emit('error', new Error(`arecord exited with code ${code}`));
      }
    });
  }

  stop() {
    return new Promise(resolve => {
      if (!this.#process) return resolve();

      const proc = this.#process;
      this.#process = null;

      proc.once('close', resolve);
      proc.kill('SIGTERM');

      // Force kill if still running after 500ms
      setTimeout(() => proc.kill('SIGKILL'), 500).unref();
    });
  }
}
