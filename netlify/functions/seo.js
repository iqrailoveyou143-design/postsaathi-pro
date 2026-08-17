// This function runs on the server — the API key stays hidden here,
// no user can see or steal it. Everyone shares this one key.

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callGroqWithRetry(apiKey, prompt, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' }
      })
    });

    if (res.ok) {
      return res;
    }

    if ((res.status === 503 || res.status === 429) && attempt < maxRetries) {
      lastError = await res.text();
      const waitTime = 1000 * Math.pow(2, attempt);
      await sleep(waitTime);
      continue;
    }

    return res;
  }
  throw new Error(lastError || 'Unknown error after retries');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server API key is not configured. Add GROQ_API_KEY in Netlify > Site settings > Environment variables.' })
    };
  }

  let prompt;
  try {
    ({ prompt } = JSON.parse(event.body));
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request' }) };
  }
  if (!prompt) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Prompt missing' }) };
  }

  try {
    const res = await callGroqWithRetry(apiKey, prompt);

    if (!res.ok) {
      const errText = await res.text();
      const friendlyMsg = (res.status === 503 || res.status === 429)
        ? 'The AI server is very busy right now. Please wait 30 seconds and try again.'
        : errText.slice(0, 300);
      return { statusCode: 502, body: JSON.stringify({ error: friendlyMsg }) };
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Got an empty response from the AI, please try again.' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: text
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'The AI server is busy right now, please try again in a moment.' }) };
  }
};
