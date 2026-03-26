import inputDevice from './inputDevice.js';
import { AudioCapture } from './audioCapture.js';
import { TranscribeSession } from './transcribe.js';
import { complete as chatComplete } from './chat.js';
import { synthesize } from './synthesize.js';
import audioPlayback from './audioPlayback.js';
import logger from '../utils/logger.js';
import config from '../config.js';

const STATES = {
  IDLE:       'IDLE',
  LISTENING:  'LISTENING',
  PROCESSING: 'PROCESSING',
};

class StateMachine {
  #state = STATES.IDLE;
  #audioCapture = null;
  #transcribeSession = null;
  #transcriptPromise = null;

  async start() {
    inputDevice.on('keydown', () => this.#onKeyDown());
    inputDevice.on('keyup',   () => this.#onKeyUp());
    inputDevice.on('error',   err => logger.error({ err }, 'Input device error'));

    await inputDevice.start();

    logger.info(`Walter ready — hold ${config.ptt.key} to speak`);
  }

  async stop() {
    await inputDevice.stop();
    audioPlayback.stop();
  }

  #onKeyDown() {
    if (this.#state !== STATES.IDLE) {
      logger.debug({ state: this.#state }, 'Ignoring keydown');
      return;
    }
    this.#setState(STATES.LISTENING);
    this.#startListening();
  }

  #onKeyUp() {
    if (this.#state !== STATES.LISTENING) {
      logger.debug({ state: this.#state }, 'Ignoring keyup');
      return;
    }
    this.#setState(STATES.PROCESSING);
    this.#process().catch(err => {
      logger.error({ err }, 'Processing pipeline error');
      this.#setState(STATES.IDLE);
    });
  }

  #setState(next) {
    logger.debug({ from: this.#state, to: next }, 'State transition');
    this.#state = next;
  }

  #startListening() {
    this.#transcribeSession = new TranscribeSession();

    // Start consuming the transcript stream — runs concurrently with audio feeding
    this.#transcriptPromise = this.#transcribeSession.transcribe();
    this.#transcriptPromise.catch(err => {
      logger.error({
        err,
        name: err?.name,
        message: err?.message,
        code: err?.code,
        fault: err?.$fault,
        metadata: err?.$metadata,
      }, 'Transcription stream error');
    });

    this.#audioCapture = new AudioCapture();
    this.#audioCapture.on('data', chunk => this.#transcribeSession.pushAudio(chunk));
    this.#audioCapture.on('error', err => logger.error({ err }, 'Audio capture error'));
    this.#audioCapture.start();

    logger.info('Listening...');
  }

  async #process() {
    // Stop mic, signal end of audio to Transcribe
    await this.#audioCapture.stop();
    this.#transcribeSession.endAudio();

    // Wait for Transcribe to finalize
    let transcript;
    try {
      transcript = await this.#transcriptPromise;
    } catch (err) {
      logger.error({ err }, 'Transcription error');
      this.#setState(STATES.IDLE);
      return;
    }

    if (!transcript) {
      logger.info('No speech detected');
      this.#setState(STATES.IDLE);
      return;
    }

    logger.info({ transcript }, 'Transcript');

    // Send to ChatGPT
    let response;
    try {
      response = await chatComplete(transcript);
    } catch (err) {
      logger.error({ err }, 'Chat completion error');
      this.#setState(STATES.IDLE);
      return;
    }

    logger.info({ response }, 'ChatGPT response');

    // Synthesize and play
    try {
      const audioStream = await synthesize(response);
      await audioPlayback.play(audioStream);
    } catch (err) {
      logger.error({ err }, 'Synthesis/playback error');
    }

    this.#setState(STATES.IDLE);
  }
}

export default new StateMachine();
