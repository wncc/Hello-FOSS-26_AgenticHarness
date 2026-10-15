import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
    GEMINI_API_KEY: z.string().optional(),
    OPENROUTER_API_KEY: z.string().optional(),
    SEARCH_API_KEY: z.string().optional(),
    SEARCH_PROVIDER: z.enum(['tavily', 'duckduckgo', 'mock']).optional(),
    // Used for Tavily search provider (if different from SEARCH_API_KEY)
    TAVILY_API_KEY: z.string().optional(),
});

export const env = envSchema.parse(process.env);
