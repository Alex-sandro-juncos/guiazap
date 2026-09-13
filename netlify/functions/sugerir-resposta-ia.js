// Sugere uma resposta pronta pra empresa responder um cliente no Papo,
// baseada no histórico recente da conversa. A empresa pode editar antes de
// mandar — a sugestão só entra no campo de digitar, nunca é enviada sozinha.

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { historico, nomeEmpresa } = JSON.parse(event.body || '{}');
    if (!Array.isArray(historico) || historico.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'historico é obrigatório' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

    // Confere login — só quem está autenticado pode pedir sugestão
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

    const conversaTexto = historico.map(m => `${m.de === 'empresa' ? 'Empresa' : 'Cliente'}: ${m.texto}`).join('\n');

    const promptSistema = `Você ajuda uma empresa pequena a responder um cliente no WhatsApp/chat do GuiaZap. Sugira UMA resposta curta, educada, natural e direto ao ponto, escrita como se fosse a própria empresa (${nomeEmpresa || 'a empresa'}) falando — sem se identificar como IA, sem aspas em volta da resposta, sem comentar a conversa. Responda em português informal brasileiro, do jeito que um dono de pequeno negócio realmente escreveria no WhatsApp.

Responda APENAS com um JSON válido, sem texto antes/depois, sem markdown:
{ "sugestao": "texto pronto pra empresa mandar, editando se quiser" }

Se a última mensagem for do cliente, responda a ela diretamente. Se a última mensagem já for da própria empresa, sugira um bom follow-up natural (ex: perguntar se ainda tem dúvida, ou seguir a conversa).`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 300,
        system: promptSistema,
        messages: [{ role: 'user', content: 'Histórico da conversa:\n' + conversaTexto }]
      })
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.error('erro da API da Anthropic:', JSON.stringify(data));
      return { statusCode: 500, body: JSON.stringify({ error: 'erro ao gerar sugestão' }) };
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
      resultado = { sugestao: null };
    }

    return { statusCode: 200, body: JSON.stringify(resultado) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao sugerir resposta' }) };
  }
};