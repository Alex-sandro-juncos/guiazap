// Interpreta o que o visitante falou na página principal (modo voz, mãos
// livres) e devolve uma ação estruturada — o FRONTEND é quem de fato
// executa a ação (filtrar a lista, abrir o WhatsApp, etc), essa function só
// decide qual é a intenção.
//
// Essa função é PÚBLICA de propósito (visitante busca sem precisar logar),
// então não dá pra proteger com "precisa estar logado". Em vez disso,
// limita quantas vezes o MESMO IP pode chamar isso por hora — sem isso,
// alguém poderia automatizar milhares de chamadas e gastar o crédito da
// API da Anthropic sem controle nenhum.

const LIMITE_POR_HORA = 20;
const JANELA_MINUTOS = 60;

async function estourouLimite(ip){
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return false; // sem tabela configurada, não bloqueia (evita derrubar a função por engano)

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };
  const chave = 'voz-index:' + ip;

  try{
    const buscaResp = await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico?chave=eq.${encodeURIComponent(chave)}`, { headers });
    const registros = await buscaResp.json();
    const agora = new Date();

    if(registros[0]){
      const janelaInicio = new Date(registros[0].janela_inicio);
      const minutosPassados = (agora - janelaInicio) / 60000;

      if(minutosPassados >= JANELA_MINUTOS){
        // Janela antiga, começa a contar de novo
        await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico?chave=eq.${encodeURIComponent(chave)}`, {
          method: 'PATCH', headers, body: JSON.stringify({ contagem: 1, janela_inicio: agora.toISOString() })
        });
        return false;
      }

      if(registros[0].contagem >= LIMITE_POR_HORA) return true; // estourou

      await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico?chave=eq.${encodeURIComponent(chave)}`, {
        method: 'PATCH', headers, body: JSON.stringify({ contagem: registros[0].contagem + 1 })
      });
      return false;
    }

    // Primeira vez desse IP
    await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico`, {
      method: 'POST', headers, body: JSON.stringify({ chave, contagem: 1, janela_inicio: agora.toISOString() })
    });
    return false;
  } catch(e){
    console.warn('erro ao checar limite de uso, deixando passar por segurança', e);
    return false; // se der erro no controle, não trava a experiência do visitante
  }
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'desconhecido';
    if(await estourouLimite(ip)){
      return { statusCode: 429, body: JSON.stringify({ voice_response: 'Muitas tentativas seguidas. Espera um pouco e tenta de novo.', action: 'NENHUMA', params: {} }) };
    }

    const { texto, empresasVisiveis } = JSON.parse(event.body || '{}');
    if (!texto) {
      return { statusCode: 400, body: JSON.stringify({ error: 'texto é obrigatório' }) };
    }

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY não configurada' }) };
    }

    const listaEmpresas = (empresasVisiveis || []).map(e => `- id:${e.id} | ${e.name} | categoria:${e.cat} | ${e.cidade}`).join('\n');

    const promptSistema = `Você interpreta comandos de VOZ de um visitante usando o GuiaZap (diretório de empresas/profissionais), no modo "mãos livres". Responda APENAS com um JSON válido, sem texto antes/depois, sem markdown, no formato:
{
  "voice_response": "resposta curta e natural, em português, pra ser lida em voz alta",
  "action": "BUSCAR" | "ABRIR_WHATSAPP" | "ABRIR_CHAT" | "FILTRAR_CIDADE" | "NENHUMA",
  "params": { ... }
}

Regras:
- BUSCAR: params = { "termo": "o que buscar (categoria, nome, etc)" }
- ABRIR_WHATSAPP: quando o visitante disser claramente que quer chamar/ligar/falar com uma empresa específica da lista abaixo. params = { "id": "id da empresa" }
- ABRIR_CHAT: quando quiser conversar pelo Papo (chat do site) em vez do WhatsApp. params = { "id": "id da empresa" }
- FILTRAR_CIDADE: params = { "cidade": "nome da cidade" }
- Se não entender ou for só conversa, action = "NENHUMA" e responda naturalmente.
- Nunca invente um id de empresa que não esteja na lista.

Empresas visíveis agora na tela:
${listaEmpresas || '(nenhuma empresa na tela no momento)'}`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 500,
        system: promptSistema,
        messages: [{ role: 'user', content: texto }]
      })
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.error('erro da API da Anthropic:', JSON.stringify(data));
      return { statusCode: 500, body: JSON.stringify({ error: 'erro ao interpretar comando' }) };
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
      resultado = { voice_response: 'Desculpa, não entendi direito. Pode repetir?', action: 'NENHUMA', params: {} };
    }

    return { statusCode: 200, body: JSON.stringify(resultado) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao processar comando de voz' }) };
  }
};