import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { Readable } from 'stream';
import config from '../config.js';
import logger from '../utils/logger.js';

const client = new PollyClient({
  region: config.aws.region,
  credentials: {
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey,
  },
});

export async function synthesize(text) {
  logger.debug({ chars: text.length, voice: config.polly.voiceId }, 'Synthesizing speech');

  const command = new SynthesizeSpeechCommand({
    Text: text,
    OutputFormat: 'pcm',  // Raw PCM avoids MP3 decode CPU cost on the Pi
    SampleRate: '16000',
    VoiceId: config.polly.voiceId,
    Engine: config.polly.engine,
  });

  const { AudioStream } = await client.send(command);

  // AWS SDK v3 returns a web ReadableStream in some environments; normalize to Node.js Readable
  if (AudioStream instanceof Readable) {
    return AudioStream;
  }
  return Readable.fromWeb(AudioStream);
}
