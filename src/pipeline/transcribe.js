import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} from '@aws-sdk/client-transcribe-streaming';
import config from '../config.js';
import logger from '../utils/logger.js';

export class TranscribeSession {
  #audioQueue = [];
  #audioResolve = null;
  #ended = false;
  #client;

  constructor() {
    this.#client = new TranscribeStreamingClient({
      region: config.aws.region,
      credentials: {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
      },
    });
  }

  // Called by audioCapture to feed raw PCM chunks into the stream
  pushAudio(chunk) {
    this.#audioQueue.push(chunk);
    if (this.#audioResolve) {
      this.#audioResolve();
      this.#audioResolve = null;
    }
  }

  // Called on key release to signal end of audio
  endAudio() {
    this.#ended = true;
    if (this.#audioResolve) {
      this.#audioResolve();
      this.#audioResolve = null;
    }
  }

  // Async generator that bridges the audio queue to the AWS SDK stream
  async *#audioGenerator() {
    while (true) {
      if (this.#audioQueue.length > 0) {
        yield { AudioEvent: { AudioChunk: this.#audioQueue.shift() } };
      } else if (this.#ended) {
        return;
      } else {
        await new Promise(resolve => {
          this.#audioResolve = resolve;
        });
      }
    }
  }

  // Starts the Transcribe session and resolves with the final transcript string.
  // Must be called before pushAudio/endAudio (it runs concurrently with audio feeding).
  async transcribe() {
    const command = new StartStreamTranscriptionCommand({
      LanguageCode: 'en-US',
      MediaEncoding: 'pcm',
      MediaSampleRateHertz: config.audio.sampleRate,
      AudioStream: this.#audioGenerator(),
    });

    const { TranscriptResultStream } = await this.#client.send(command);

    let transcript = '';

    for await (const event of TranscriptResultStream) {
      if (!event.TranscriptEvent) continue;

      const results = event.TranscriptEvent.Transcript?.Results ?? [];
      for (const result of results) {
        if (result.IsPartial) continue;

        const text = result.Alternatives?.[0]?.Transcript?.trim() ?? '';
        if (text) {
          transcript += (transcript ? ' ' : '') + text;
          logger.debug({ partial: text }, 'Transcribe final segment');
        }
      }
    }

    return transcript.trim();
  }
}
