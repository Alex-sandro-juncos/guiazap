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

    const { chamarIABarata } = require('./ia-barata-helper');
    const { normalizarTexto, buscarCache, salvarPending, salvarAprovado } = require('./comandos-voz-cache');

    const textoNorm = normalizarTexto(texto);
    const cache = await buscarCache('pedidos', textoNorm);
    if (cache) {
      return { statusCode: 200, body: JSON.stringify(cache) };
    }
    await salvarPending('pedidos', textoNorm, texto);

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

    const ia = await chamarIABarata(promptSistema, texto, 500);
    const resultado = ia.ok
      ? ia.json
      : { voice_response: 'Desculpa, não entendi direito. Pode repetir?', action: 'NENHUMA', params: {} };

    if (ia.ok) await salvarAprovado('pedidos', textoNorm, resultado);

    return { statusCode: 200, body: JSON.stringify(resultado) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao processar comando de voz' }) };
  }
};