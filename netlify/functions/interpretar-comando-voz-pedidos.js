// Interpreta comandos de voz na tela de PEDIDOS (lado da empresa). Exige
// login (é a empresa gerenciando os próprios pedidos).

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { texto, pedidosVisiveis } = JSON.parse(event.body || '{}');
    if (!texto) {
      return { statusCode: 400, body: JSON.stringify({ error: 'texto é obrigatório' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const tokenUsuario = (event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '');
    if (!tokenUsuario) {
      return { statusCode: 401, body: JSON.stringify({ error: 'não autenticado' }) };
    }
    const usuarioResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${tokenUsuario}` }
    });
    if (!usuarioResp.ok) {
      return { statusCode: 401, body: JSON.stringify({ error: 'sessão inválida ou expirada' }) };
    }

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY não configurada' }) };
    }

    const listaPedidos = (pedidosVisiveis || []).map(p => `- id:${p.id} | status:${p.status} | R$${p.total} | itens: ${p.itensResumo}`).join('\n');

    const promptSistema = `Você interpreta comandos de VOZ de um dono de empresa gerenciando pedidos no GuiaZap, modo "mãos livres". Responda APENAS com um JSON válido, sem texto antes/depois, sem markdown, no formato:
{
  "voice_response": "resposta curta e natural, em português, pra ser lida em voz alta",
  "action": "LER_PEDIDOS_NOVOS" | "ACEITAR" | "RECUSAR" | "AVANCAR_STATUS" | "NENHUMA",
  "params": { ... }
}

Regras:
- LER_PEDIDOS_NOVOS: lista os pedidos aguardando confirmação (status aguardando_confirmacao). Sem params.
- ACEITAR: aceita um pedido pendente. params = { "id": "id do pedido" }. Se só existir 1 pedido aguardando_confirmacao na lista, usa esse. Se tiver mais de um e não ficar claro qual, action = "NENHUMA" e pede pra especificar.
- RECUSAR: mesma lógica de ACEITAR, mas recusa (estorna o pagamento automaticamente).
- AVANCAR_STATUS: avança pro próximo status (aceito→preparando, preparando→pronto, pronto→saiu_entrega ou concluido). params = { "id": "id do pedido" }.
- Nunca invente um id de pedido que não esteja na lista.

Pedidos visíveis agora:
${listaPedidos || '(nenhum pedido no momento)'}`;

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