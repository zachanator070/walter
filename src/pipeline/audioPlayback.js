import { spawn } from 'child_process';
import { Readable } from 'stream';
import config from '../config.js';
import logger from '../utils/logger.js';

class AudioPlayback {
  #process = null;
  #stopping = false;

  // Plays raw PCM audio (Buffer or Readable) through aplay. Resolves when playback finishes.
  play(audio) {
    return new Promise((resolve, reject) => {
      const outputDevice = config.audio.outputDevice.startsWith('hw:')
        ? config.audio.outputDevice.replace(/^hw:/, 'plughw:')
        : config.audio.outputDevice;
      const sourceRate = config.audio.sampleRate;
      const playbackRate = config.audio.playbackSampleRate;
      const channels = config.audio.outputChannels;
      const leadInMs = config.audio.playbackLeadInMs;

      let pcm = Buffer.isBuffer(audio) ? audio : null;
      if (pcm) {
        pcm = this.#preparePcm(pcm, sourceRate, playbackRate, channels);
      }

      const args = [
        '-D', outputDevice,
        '-f', 'S16_LE',
        '-r', String(playbackRate),
        '-c', String(channels),
        '-t', 'raw',
      ];

      const pcmBytes = pcm?.length ?? null;
      logger.info({
        device: outputDevice,
        configuredDevice: config.audio.outputDevice,
        sourceRate,
        playbackRate,
        channels,
        leadInMs,
        pcmBytes,
      }, 'Starting aplay');

      this.#stopping = false;
      const startedAt = Date.now();
      this.#process = spawn('aplay', args, { stdio: ['pipe', 'ignore', 'pipe'] });

      const leadInBytes = Math.max(0, Math.round(playbackRate * 2 * channels * (leadInMs / 1000)));
      const audioStream = pcm ? Readable.from(pcm) : audio;

      if (leadInBytes > 0) {
        this.#process.stdin.write(Buffer.alloc(leadInBytes));
      }

      audioStream.on('error', err => {
        logger.error({ err }, 'Playback audio stream error');
        reject(err);
      });

      audioStream.pipe(this.#process.stdin);

      this.#process.stdin.on('error', err => {
        if (err.code !== 'EPIPE') logger.warn({ err }, 'aplay stdin error');
      });

      this.#process.stderr.on('data', data => {
        const msg = data.toString().trim();
        if (msg) logger.warn({ msg }, 'aplay');
      });

      this.#process.on('error', err => {
        this.#process = null;
        reject(err);
      });

      this.#process.on('close', code => {
        this.#process = null;
        const durationMs = Date.now() - startedAt;

        if (!this.#stopping && code !== null && code !== 0) {
          reject(new Error(`aplay exited with code ${code}`));
          return;
        }

        logger.info({ durationMs, pcmBytes, code }, 'Playback finished');
        resolve();
      });
    });
  }

  #preparePcm(mono, sourceRate, playbackRate, channels) {
    let pcm = mono;

    if (playbackRate !== sourceRate) {
      pcm = this.#upsample(mono, sourceRate, playbackRate);
    }

    if (channels === 2) {
      pcm = this.#monoToStereo(pcm);
    }

    return pcm;
  }

  #upsample(mono, fromRate, toRate) {
    if (toRate % fromRate !== 0) {
      throw new Error(
        `PLAYBACK_SAMPLE_RATE (${toRate}) must be an integer multiple of SAMPLE_RATE (${fromRate})`
      );
    }

    const ratio = toRate / fromRate;
    const out = Buffer.alloc(mono.length * ratio);

    for (let i = 0, o = 0; i < mono.length; i += 2, o += 2 * ratio) {
      const sample = mono.readInt16LE(i);
      for (let r = 0; r < ratio; r++) {
        out.writeInt16LE(sample, o + r * 2);
      }
    }

    return out;
  }

  #monoToStereo(mono) {
    const stereo = Buffer.alloc(mono.length * 2);
    for (let i = 0, j = 0; i < mono.length; i += 2, j += 4) {
      const sample = mono.readInt16LE(i);
      stereo.writeInt16LE(sample, j);
      stereo.writeInt16LE(sample, j + 2);
    }
    return stereo;
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
