import config from '../config.js';
import logger from './logger.js';

class ConversationHistory {
  #messages = [];
  #timer = null;

  add(role, content) {
    this.#messages.push({ role, content });

    // Keep the last maxHistoryTurns user+assistant pairs
    const max = config.conversation.maxHistoryTurns * 2;
    if (this.#messages.length > max) {
      this.#messages = this.#messages.slice(-max);
    }

    this.#resetTimer();
  }

  // Returns the full message array with the system prompt prepended
  getMessages() {
    return [
      { role: 'system', content: config.openai.systemPrompt },
      ...this.#messages,
    ];
  }

  get length() {
    return this.#messages.length;
  }

  #resetTimer() {
    if (this.#timer) clearTimeout(this.#timer);

    this.#timer = setTimeout(() => {
      logger.info('Conversation timeout — history cleared');
      this.#messages = [];
      this.#timer = null;
    }, config.conversation.timeoutMs);

    // Don't keep the process alive just for this timer
    this.#timer.unref();
  }
}

export default new ConversationHistory();
