import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { Readable } from 'stream';
import config from '../config.js';
import logger from '../utils/logger.js';

async function streamToBuffer(stream) {
  const nodeStream = stream instanceof Readable ? stream : Readable.fromWeb(stream);
  const chunks = [];
  for await (const chunk of nodeStream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const client = new PollyClient({
  region: config.aws.region,
  credentials: {
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey,
  },
});

export async function synthesize(text) {
  logger.debug({
    chars: text.length,
    voice: config.polly.voiceId,
    engine: config.polly.engine,
    region: config.aws.region,
  }, 'Synthesizing speech');

  const sampleRate = String(config.audio.sampleRate);
  const command = new SynthesizeSpeechCommand({
    Text: text,
    OutputFormat: 'pcm',  // Raw PCM avoids MP3 decode CPU cost on the Pi
    SampleRate: sampleRate,
    VoiceId: config.polly.voiceId,
    Engine: config.polly.engine,
  });

  const { AudioStream } = await client.send(command);
  const pcm = await streamToBuffer(AudioStream);

  logger.debug({ bytes: pcm.length, sampleRate }, 'Speech synthesized');
  return pcm;
}
