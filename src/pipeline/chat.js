import OpenAI from 'openai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import config from '../config.js';
import conversationHistory from '../utils/conversationHistory.js';
import logger from '../utils/logger.js';

const client = new OpenAI({ apiKey: config.openai.apiKey });

const transport = new StdioClientTransport({
  command: 'node',
  args: [fileURLToPath(new URL('../mcp-server.js', import.meta.url))],
});
const mcp = new Client({ name: 'walter', version: '1.0.0' }, { capabilities: {} });
await mcp.connect(transport);

const { tools: mcpTools } = await mcp.listTools();
const tools = mcpTools.map(t => ({
  type: 'function',
  function: {
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
  },
}));

export async function complete(userText) {
  conversationHistory.add('user', userText);
  const messages = conversationHistory.getMessages();

  let response = await client.chat.completions.create({
    model: config.openai.model,
    messages,
    tools,
  });

  while (response.choices[0].finish_reason === 'tool_calls') {
    const assistantMessage = response.choices[0].message;
    messages.push(assistantMessage);

    for (const call of assistantMessage.tool_calls) {
      const result = await mcp.callTool({
        name: call.function.name,
        arguments: JSON.parse(call.function.arguments),
      });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result.content),
      });
    }

    response = await client.chat.completions.create({
      model: config.openai.model,
      messages,
      tools,
    });
  }

  const responseText =
    response.choices[0].message.content?.trim() ??
    "Sorry, I couldn't generate a response.";

  conversationHistory.add('assistant', responseText);

  logger.debug(
    { turns: conversationHistory.length, model: config.openai.model },
    'Chat completion done'
  );

  return responseText;
}
