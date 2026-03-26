import { open } from 'fs/promises';
import { EventEmitter } from 'events';
import config from '../config.js';
import logger from '../utils/logger.js';

// Linux input_event struct layout:
//   64-bit: timeval(16 bytes) + type(2) + code(2) + value(4) = 24 bytes
//   32-bit: timeval(8 bytes)  + type(2) + code(2) + value(4) = 16 bytes
const IS_64BIT = process.arch === 'arm64' || process.arch === 'x64';
const EVENT_SIZE = IS_64BIT ? 24 : 16;
const TIMEVAL_SIZE = IS_64BIT ? 16 : 8;

// ioctl EVIOCGRAB = _IOW('E', 0x90, int) = 0x40044590
const EVIOCGRAB = 0x40044590;

const EV_KEY = 1;
const KEY_DOWN = 1;
const KEY_UP = 0;

// Supported PTT_KEY values
const KEY_CODES = {
  KEY_ESC: 1,
  KEY_1: 2,   KEY_2: 3,   KEY_3: 4,   KEY_4: 5,   KEY_5: 6,
  KEY_6: 7,   KEY_7: 8,   KEY_8: 9,   KEY_9: 10,  KEY_0: 11,
  KEY_TAB: 15,
  KEY_Q: 16,  KEY_W: 17,  KEY_E: 18,  KEY_R: 19,  KEY_T: 20,
  KEY_Y: 21,  KEY_U: 22,  KEY_I: 23,  KEY_O: 24,  KEY_P: 25,
  KEY_A: 30,  KEY_S: 31,  KEY_D: 32,  KEY_F: 33,  KEY_G: 34,
  KEY_H: 35,  KEY_J: 36,  KEY_K: 37,  KEY_L: 38,
  KEY_ENTER: 28,
  KEY_LEFTSHIFT: 42, KEY_RIGHTSHIFT: 54,
  KEY_LEFTCTRL: 29,  KEY_RIGHTCTRL: 97,
  KEY_LEFTALT: 56,   KEY_RIGHTALT: 100,
  KEY_Z: 44,  KEY_X: 45,  KEY_C: 46,  KEY_V: 47,  KEY_B: 48,
  KEY_N: 49,  KEY_M: 50,
  KEY_SPACE: 57,
  KEY_F1: 59,  KEY_F2: 60,  KEY_F3: 61,  KEY_F4: 62,
  KEY_F5: 63,  KEY_F6: 64,  KEY_F7: 65,  KEY_F8: 66,
  KEY_F9: 67,  KEY_F10: 68, KEY_F11: 87, KEY_F12: 88,
};

class InputDevice extends EventEmitter {
  #fileHandle = null;
  #running = false;
  #targetKeyCode;

  constructor() {
    super();
    const keyName = config.ptt.key;
    this.#targetKeyCode = KEY_CODES[keyName];
    if (this.#targetKeyCode === undefined) {
      throw new Error(
        `Unknown PTT_KEY "${keyName}". Supported values: ${Object.keys(KEY_CODES).join(', ')}`
      );
    }
  }

  async start() {
    const devicePath = config.ptt.inputDevice;
    logger.info({ devicePath, key: config.ptt.key }, 'Opening PTT input device');

    // O_RDONLY = 0
    this.#fileHandle = await open(devicePath, 0);

    // Grab device exclusively so key events don't reach other processes
    try {
      const { default: ioctl } = await import('ioctl');
      ioctl(this.#fileHandle.fd, EVIOCGRAB, 1);
      logger.info('Input device grabbed exclusively');
    } catch (err) {
      logger.warn({ err: err.message }, 'Could not grab device exclusively — key events may reach other processes');
    }

    this.#running = true;
    this.#readLoop().catch(err => {
      if (this.#running) {
        logger.error({ err }, 'Input device read loop error');
        this.emit('error', err);
      }
    });
  }

  async #readLoop() {
    const buf = Buffer.alloc(EVENT_SIZE);
    while (this.#running) {
      try {
        const { bytesRead } = await this.#fileHandle.read(buf, 0, EVENT_SIZE, null);

        if (!this.#running) break;

        if (bytesRead === 0) {
          logger.warn('Input device returned EOF — device may be disconnected');
          this.emit('error', new Error('Input device EOF'));
          break;
        }

        if (bytesRead < EVENT_SIZE) continue;

        const type  = buf.readUInt16LE(TIMEVAL_SIZE);
        const code  = buf.readUInt16LE(TIMEVAL_SIZE + 2);
        const value = buf.readInt32LE(TIMEVAL_SIZE + 4);

        if (type === EV_KEY) {
          // Find key name
          const keyName = Object.entries(KEY_CODES).find(([_, c]) => c === code)?.[0] || `UNKNOWN(${code})`;
          logger.info({ code, keyName, value: value === KEY_DOWN ? 'DOWN' : value === KEY_UP ? 'UP' : 'REPEAT' }, 'Key event detected');
          
          if (code === this.#targetKeyCode) {
            if (value === KEY_DOWN) this.emit('keydown');
            else if (value === KEY_UP) this.emit('keyup');
            // value === 2 is key repeat — ignored
          }
        }
      } catch (err) {
        if (!this.#running) break; // Expected when stop() closes the fd
        throw err;
      }
    }
  }

  async stop() {
    this.#running = false;
    if (this.#fileHandle) {
      try {
        const { default: ioctl } = await import('ioctl');
        ioctl(this.#fileHandle.fd, EVIOCGRAB, 0);
      } catch {}
      await this.#fileHandle.close();
      this.#fileHandle = null;
    }
  }
}

export default new InputDevice();
