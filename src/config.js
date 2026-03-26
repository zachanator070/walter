// Environment variables are loaded before this module runs via:
//   node --env-file=.env  (local dev)
//   docker-compose env_file directive (production)

function required(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

function optional(name, defaultValue) {
  return process.env[name] ?? defaultValue;
}

export default Object.freeze({
  aws: {
    region: required('AWS_REGION'),
    accessKeyId: required('AWS_ACCESS_KEY_ID'),
    secretAccessKey: required('AWS_SECRET_ACCESS_KEY'),
  },
  openai: {
    apiKey: required('OPENAI_API_KEY'),
    model: optional('OPENAI_MODEL', 'gpt-4o-mini'),
    systemPrompt: optional('SYSTEM_PROMPT', 'You are a helpful assistant.'),
  },
  audio: {
    inputDevice: optional('AUDIO_INPUT_DEVICE', 'hw:1,0'),
    outputDevice: optional('AUDIO_OUTPUT_DEVICE', 'hw:0,0'),
    sampleRate: parseInt(optional('SAMPLE_RATE', '16000'), 10),
    playbackLeadInMs: parseInt(optional('PLAYBACK_LEAD_IN_MS', '150'), 10),
  },
  polly: {
    voiceId: optional('POLLY_VOICE_ID', 'Joanna'),
    engine: optional('POLLY_ENGINE', 'neural'),
  },
  ptt: {
    inputDevice: required('PTT_INPUT_DEVICE'),
    key: optional('PTT_KEY', 'KEY_SPACE'),
  },
  conversation: {
    timeoutMs: parseInt(optional('CONVERSATION_TIMEOUT_MS', '300000'), 10),
    maxHistoryTurns: parseInt(optional('MAX_HISTORY_TURNS', '20'), 10),
  },
});
