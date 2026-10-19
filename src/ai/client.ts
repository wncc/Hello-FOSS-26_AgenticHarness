import 'dotenv/config'
import OpenAI from 'openai'


type Provider = 'openrouter' | 'gemini';
const router: Provider = 'gemini';
const PROVIDER_CONFIG = {
    openrouter: {
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY,
        model: 'openrouter/free',
        contextWindowTokens: undefined,
    },
    gemini: {
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: process.env.GEMINI_API_KEY,
        
        model: 'gemini-flash-lite-latest',
        // deprecated: bypassThoughtSignature: false, Toggle: injects 'skip_thought_signature_validator' if signature is absent. 
        // basically, google gives you an error if it doesn't get its older thought-process back. but it *can* get dropped by openai sdk or something, if it does, we can choose to silence that error using this bypassing flag. 
        contextWindowTokens: 1_048_576,
    },
} as const;

export const config = PROVIDER_CONFIG[router];

if (config.apiKey == null) console.warn('API KEY is not set!');

export const openai = new OpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    fetch: async (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set('Accept-Encoding', 'identity');

        const response = await fetch(url, {
            ...init,
            headers,
        });

        if (
            response.ok &&
            response.body &&
            !response.headers.has('content-type')
        ) {
            const fixedHeaders = new Headers(response.headers);
            fixedHeaders.set('Content-Type', 'application/json');

            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: fixedHeaders,
            });
        }

        return response;
    },
});

