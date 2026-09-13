// Resume os comentários das avaliações de um profissional em 2-3 frases,
// pra quem está decidindo não precisar ler tudo. Não inventa nada que não
// esteja nos comentários — só resume o que já foi escrito.

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { comentarios } = JSON.parse(event.body || '{}');
    if (!Array.isArray(comentarios) || comentarios.length < 3) {
      return { statusCode: 400, body: JSON.stringify({ error: 'precisa de pelo menos 3 comentários' }) };
    }

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY não configurada' }) };
    }

    const listaTexto = comentarios.map((c, i) => `${i + 1}. (nota ${c.nota}/5) ${c.comentario}`).join('\n');

    const promptSistema = `Resuma essas avaliações de um profissional/empresa do GuiaZap em no máximo 2 frases curtas, em português, direto ao ponto — o que as pessoas mais elogiam e o que mais reclamam (se houver reclamação). Baseie-se SÓ no que está escrito nos comentários, sem inventar nada. Se os comentários forem só positivos, diga isso. Não use markdown, não numere, não cite "avaliação 1" etc — escreva como um resumo corrido.

Responda APENAS com um JSON válido: { "resumo": "texto do resumo" }`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 250,
        system: promptSistema,
        messages: [{ role: 'user', content: listaTexto }]
      })
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.error('erro da API da Anthropic:', JSON.stringify(data));
      return { statusCode: 500, body: JSON.stringify({ error: 'erro ao resumir' }) };
    }

    const textoResposta = data.content && data.content[0] ? data.content[0].text : '';
    let resultado;
    try {
      let textoLimpo = textoResposta.replace(/```json|```/g, '').trim();
      const inicioJson = textoLimpo.indexOf('{');
      const fimJson = textoLimpo.lastIndexOf('}');
      if (inicioJson !== -1 && fimJson !== -1) textoLimpo = textoLimpo.slice(inicioJson, fimJson + 1);
      resultado = JSON.parse(textoLimpo);
    } catch (e) {
      resultado = { resumo: null };
    }

    return { statusCode: 200, body: JSON.stringify(resultado) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao resumir avaliações' }) };
  }
};