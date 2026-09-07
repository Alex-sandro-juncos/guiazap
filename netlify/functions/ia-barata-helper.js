// Chamada única de modelo BARATO pra interpretar JSON.
// Ordem: Gemini Flash-Lite (se tiver chave) → Claude Haiku (chave Anthropic que você já tem).
// Sonnet sai do caminho padrão.

const GEMINI_MODELO = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite';
const HAIKU_MODELO = process.env.HAIKU_MODEL || 'claude-haiku-4-5';

function extrairJson(texto) {
  if (!texto) return null;
  let limpo = String(texto).replace(/```json|```/g, '').trim();
  const inicio = limpo.indexOf('{');
  const fim = limpo.lastIndexOf('}');
  if (inicio !== -1 && fim !== -1) limpo = limpo.slice(inicio, fim + 1);
  try {
    return JSON.parse(limpo);
  } catch (e) {
    return null;
  }
}

async function chamarGemini(system, user, maxTokens) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODELO}:generateContent?key=${key}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: maxTokens || 500,
        responseMimeType: 'application/json'
      }
    })
  });
  const data = await resp.json();
  if (!resp.ok) {
    console.error('erro Gemini:', JSON.stringify(data));
    return null;
  }
  const texto = data.candidates && data.candidates[0] && data.candidates[0].content
    ? data.candidates[0].content.parts.map(p => p.text || '').join('')
    : '';
  return extrairJson(texto);
}

async function chamarHaiku(system, user, maxTokens) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: HAIKU_MODELO,
      max_tokens: maxTokens || 500,
      system,
      messages: [{ role: 'user', content: user }]
    })
  });
  const data = await resp.json();
  if (!resp.ok) {
    console.error('erro Haiku:', JSON.stringify(data));
    return null;
  }
  const texto = data.content && data.content[0] ? data.content[0].text : '';
  return extrairJson(texto);
}

async function chamarIABarata(system, user, maxTokens) {
  const gemini = await chamarGemini(system, user, maxTokens);
  if (gemini) return { ok: true, json: gemini, provedor: 'gemini' };

  const haiku = await chamarHaiku(system, user, maxTokens);
  if (haiku) return { ok: true, json: haiku, provedor: 'haiku' };

  return { ok: false, json: null, provedor: null };
}

module.exports = { chamarIABarata, extrairJson };
