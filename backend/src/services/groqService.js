import axios from 'axios';
import 'dotenv/config';

const CANDIDATE_MODELS = [
  process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b'
];

const mock = (payload, reason = 'Demo mode active') => ({
  mode: 'DEMO/MOCK',
  data: payload,
  warning: reason
});

function cleanAndParseJSON(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Empty response from AI');
  }

  // 1. Direct parse attempt
  try {
    return JSON.parse(rawText.trim());
  } catch {}

  // 2. Extract from markdown code blocks
  const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {}
  }

  // 3. Extract substring between first '{' and last '}'
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(rawText.substring(start, end + 1));
    } catch {}
  }

  throw new Error(`Unable to parse JSON from AI response: ${rawText.slice(0, 100)}...`);
}

export async function askGroq(system, input, fallback) {
  const isDemo = process.env.DEMO_MODE === 'true' || !process.env.GROQ_API_KEY;
  if (isDemo) {
    return mock(fallback, 'Demo mode enabled via configuration');
  }

  const startTime = Date.now();
  let lastError = null;

  for (const model of CANDIDATE_MODELS) {
    try {
      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `${system}\nYou MUST return a single, strictly valid JSON object without any additional conversational text or markdown wrappers.`
            },
            {
              role: 'user',
              content: typeof input === 'string' ? input : JSON.stringify(input)
            }
          ]
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      const content = response.data?.choices?.[0]?.message?.content;
      const parsed = cleanAndParseJSON(content);

      return {
        mode: 'GROQ',
        model,
        latencyMs: Date.now() - startTime,
        data: parsed
      };
    } catch (err) {
      lastError = err;
      console.warn(`[GroqService] Model ${model} request failed: ${err.response?.data?.error?.message || err.message}. Attempting fallback...`);
    }
  }

  console.error('[GroqService] All models failed, using deterministic fallback:', lastError?.message);
  return {
    ...mock(fallback, `Groq API error: ${lastError?.response?.data?.error?.message || lastError?.message}`),
    error: lastError?.message
  };
}

export async function checkGroqStatus() {
  if (process.env.DEMO_MODE === 'true' || !process.env.GROQ_API_KEY) {
    return { active: false, mode: 'DEMO', reason: 'DEMO_MODE is true or GROQ_API_KEY is missing' };
  }
  try {
    const test = await askGroq('System', { ping: true }, { ping: true });
    return {
      active: test.mode === 'GROQ',
      mode: test.mode,
      model: test.model || process.env.GROQ_MODEL,
      latencyMs: test.latencyMs
    };
  } catch (err) {
    return { active: false, mode: 'ERROR', error: err.message };
  }
}

