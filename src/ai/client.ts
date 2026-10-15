import 'dotenv/config'
import OpenAI from 'openai'


type Provider = 'openrouter' | 'gemini';
const router: Provider = 'gemini';
const PROVIDER_CONFIG = {
    openrouter: {
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY,
        model: 'openrouter/free',
    },
    gemini: {
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: process.env.GEMINI_API_KEY,
        
        model: 'gemini-flash-lite-latest',
        // deprecated: bypassThoughtSignature: false, Toggle: injects 'skip_thought_signature_validator' if signature is absent. 
        // basically, google gives you an error if it doesn't get its older thought-process back. but it *can* get dropped by openai sdk or something, if it does, we can choose to silence that error using this bypassing flag. 
    },
} as const;

export const config = PROVIDER_CONFIG[router];

if (config.apiKey == null) console.warn('API KEY is not set!');

// Gemini's OpenAI-compatible endpoint can return a valid JSON body with no
// Content-Type header. The OpenAI SDK only parses JSON when that header is
// present, so it would hand back a raw string instead of a completion object.
// This wrapper adds the missing header. It leaves all other responses alone.
const fetchWithMissingContentType: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Accept-Encoding', 'identity');

    const response = await fetch(input, { ...init, headers });

    if (!response.ok || response.headers.get('content-type') || !response.body) {
        return response;
    }

    const repairedHeaders = new Headers(response.headers);
    repairedHeaders.set('Content-Type', 'application/json');

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: repairedHeaders,
    });
};

export const openai = new OpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    ...(router === 'gemini' ? { fetch: fetchWithMissingContentType } : {}),
});

