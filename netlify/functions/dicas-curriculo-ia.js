// Dá 2-4 dicas curtas e construtivas de como melhorar um currículo,
// baseado no que a pessoa já preencheu. Não reescreve nada sozinha, só
// sugere — quem decide o que mudar é a própria pessoa.
// As dicas saem na voz do Zeca (persona compartilhada em ia-barata-helper.js).
//
// ⚠️ Limite por IP com FAIL-CLOSED: esse endpoint é público (sem login,
// de propósito — não queremos travar quem está montando currículo pela
// primeira vez), então precisa de limite. Se o Supabase falhar, bloqueia
// em vez de liberar — evita virar uma porta aberta de custo de IA.

const { PERSONA_ZECA } = require('./ia-barata-helper');

const LIMITE_POR_HORA = 20;
const JANELA_MINUTOS = 60;

async function podeChamar(ip) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };
  const chave = 'dicas-curriculo-ia:' + ip;

  const buscaResp = await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico?chave=eq.${encodeURIComponent(chave)}`, { headers });
  if (!buscaResp.ok) throw new Error('não consegui checar o limite de uso');
  const registros = await buscaResp.json();
  const agora = new Date();

  if (registros[0]) {
    const minutosPassados = (agora - new Date(registros[0].janela_inicio)) / 60000;
    if (minutosPassados >= JANELA_MINUTOS) {
      await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico?chave=eq.${encodeURIComponent(chave)}`, {
        method: 'PATCH', headers, body: JSON.stringify({ contagem: 1, janela_inicio: agora.toISOString() })
      });
      return true;
    }
    if (registros[0].contagem >= LIMITE_POR_HORA) return false;
    await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico?chave=eq.${encodeURIComponent(chave)}`, {
      method: 'PATCH', headers, body: JSON.stringify({ contagem: registros[0].contagem + 1 })
    });
    return true;
  }

  await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico`, {
    method: 'POST', headers, body: JSON.stringify({ chave, contagem: 1, janela_inicio: agora.toISOString() })
  });
  return true;
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const ip = event.headers['x-nf-client-connection-ip'] || (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'desconhecido';
    let liberado;
    try {
      liberado = await podeChamar(ip);
    } catch (eLimite) {
      console.error('checagem de limite falhou, bloqueando por segurança:', eLimite);
      return { statusCode: 429, body: JSON.stringify({ error: 'muitas tentativas, tenta de novo em instantes' }) };
    }
    if (!liberado) {
      return { statusCode: 429, body: JSON.stringify({ error: 'Muitos pedidos de dica seguidos. Espera um pouco e tenta de novo.' }) };
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

    const promptSistema = PERSONA_ZECA + `Você dá dicas curtas e construtivas pra alguém melhorar o currículo dela, num banco de talentos de empregos locais (vagas simples, comércio, serviços — não é currículo executivo). Responda com no máximo 4 dicas bem curtas e práticas (uma frase cada), em português, tom encorajador, nunca condescendente. Foque em coisas fáceis de mudar: se falta algo importante, se está genérico demais, se poderia destacar melhor alguma experiência. Se o currículo já estiver bom, diga isso e dê só 1 dica pequena de mais.

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