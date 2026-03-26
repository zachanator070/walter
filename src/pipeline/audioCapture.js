import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import config from '../config.js';
import logger from '../utils/logger.js';

export class AudioCapture extends EventEmitter {
  #process = null;
  #stopping = false;

  start() {
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

    logger.debug({ device: inputDevice, configuredDevice: config.audio.inputDevice }, 'Starting arecord');
    this.#stopping = false;
    this.#process = spawn('arecord', args);

    this.#process.stdout.on('data', chunk => this.emit('data', chunk));

    this.#process.stderr.on('data', data =>
      logger.debug({ msg: data.toString().trim() }, 'arecord')
    );

    this.#process.on('error', err => this.emit('error', err));

    this.#process.on('close', code => {
      if (this.#stopping) return;
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
      this.#stopping = true;

      proc.once('close', resolve);
      proc.kill('SIGTERM');

      // Force kill if still running after 500ms
      setTimeout(() => proc.kill('SIGKILL'), 500).unref();
    });
  }
}
