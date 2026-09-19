import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';

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