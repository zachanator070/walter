import OpenAI from 'openai';
import config from '../config.js';
import conversationHistory from '../utils/conversationHistory.js';
import logger from '../utils/logger.js';

const client = new OpenAI({ apiKey: config.openai.apiKey });

export async function complete(userText) {
  conversationHistory.add('user', userText);

  const completion = await client.chat.completions.create({
    model: config.openai.model,
    messages: conversationHistory.getMessages(),
  });

  const responseText =
    completion.choices[0]?.message?.content?.trim() ??
    "Sorry, I couldn't generate a response.";

  conversationHistory.add('assistant', responseText);

  logger.debug(
    { turns: conversationHistory.length, model: config.openai.model },
    'Chat completion done'
  );

  return responseText;
}
