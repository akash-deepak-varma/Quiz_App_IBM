import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.resolve(__dirname, '../../.env'),
});

console.log({
  baseURL: process.env.ANTHROPIC_BASE_URL,
  model: process.env.ANTHROPIC_MODEL,

  apiKeyLoaded: !!process.env.ANTHROPIC_API_KEY,
  apiKeyLength: process.env.ANTHROPIC_API_KEY?.length,

  startsWithBearer:
    process.env.ANTHROPIC_API_KEY?.startsWith('Bearer '),

  startsWithSk:
    process.env.ANTHROPIC_API_KEY?.startsWith('sk-'),
});

const client = new Anthropic({
  baseURL: process.env.ANTHROPIC_BASE_URL,
  authToken: process.env.ANTHROPIC_API_KEY,
  timeout: 60_000,
  maxRetries: 0,
});

console.time('request');

try {
  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL,
    max_tokens: 50,
    messages: [
      {
        role: 'user',
        content: 'Reply with exactly: WORKING',
      },
    ],
  });

  console.timeEnd('request');

  console.log(
    response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
  );
} catch (error) {
  console.timeEnd('request');

  console.error({
    name: error.name,
    message: error.message,
    status: error.status,
    requestId: error.request_id,
  });
}