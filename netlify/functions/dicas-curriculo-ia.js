// Dá 2-4 dicas curtas e construtivas de como melhorar um currículo,
// baseado no que a pessoa já preencheu. Não reescreve nada sozinha, só
// sugere — quem decide o que mudar é a própria pessoa.

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { objetivo, experiencia, formacao, habilidades } = JSON.parse(event.body || '{}');
    if (!objetivo && !experiencia && !formacao && !habilidades) {
      return { statusCode: 400, body: JSON.stringify({ error: 'currículo vazio demais pra dar dica' }) };
    }

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY não configurada' }) };
    }

    const conteudo = `Objetivo: ${objetivo || '(não preenchido)'}\nExperiência: ${experiencia || '(não preenchido)'}\nFormação: ${formacao || '(não preenchido)'}\nHabilidades: ${habilidades || '(não preenchido)'}`;

    const promptSistema = `Você dá dicas curtas e construtivas pra alguém melhorar o currículo dela, num banco de talentos de empregos locais (vagas simples, comércio, serviços — não é currículo executivo). Responda com no máximo 4 dicas bem curtas e práticas (uma frase cada), em português, tom encorajador, nunca condescendente. Foque em coisas fáceis de mudar: se falta algo importante, se está genérico demais, se poderia destacar melhor alguma experiência. Se o currículo já estiver bom, diga isso e dê só 1 dica pequena de mais.

Responda APENAS com um JSON válido, sem markdown: { "dicas": ["dica 1", "dica 2", ...] }`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 400,
        system: promptSistema,
        messages: [{ role: 'user', content: conteudo }]
      })
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.error('erro da API da Anthropic:', JSON.stringify(data));
      return { statusCode: 500, body: JSON.stringify({ error: 'erro ao gerar dicas' }) };
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
      resultado = { dicas: [] };
    }

    return { statusCode: 200, body: JSON.stringify(resultado) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao gerar dicas de currículo' }) };
  }
};