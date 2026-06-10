import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const METRICS_URL = 'http://localhost:9100/metrics';

const server = new Server(
  { name: 'walter-tools', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_temperature',
      description: 'Get the current tank water temperature in Fahrenheit',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'get_temperature') {
    throw new Error(`Unknown tool: ${req.params.name}`);
  }

  const res = await fetch(METRICS_URL);
  const text = await res.text();
  const match = text.match(/^walter_thermostat_temperature_fahrenheit\s+([\d.]+)/m);
  if (!match) {
    throw new Error('Temperature reading not available');
  }

  return {
    content: [{ type: 'text', text: `${parseFloat(match[1]).toFixed(1)}°F` }],
  };
});

await server.connect(new StdioServerTransport());
