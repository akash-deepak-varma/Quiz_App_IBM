import 'dotenv/config';

export const env = {
  port: Number(process.env.PORT) || 4000,
  jwtSecret: process.env.JWT_SECRET,
  aiProvider: process.env.AI_PROVIDER || 'mock',
  quizGenerateRateLimit: Number(process.env.QUIZ_GENERATE_RATE_LIMIT) || 10,

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    baseURL: process.env.ANTHROPIC_BASE_URL,
    model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseURL: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_MODEL || 'gpt-5.6-terra-dzus',
  },
};

if (!env.jwtSecret) {
  throw new Error('JWT_SECRET is not set -- copy .env.example to .env and fill it in.');
}
