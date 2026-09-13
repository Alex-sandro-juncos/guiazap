// Modera automaticamente um depoimento recém-enviado. Se a IA achar que
// está tudo bem (elogio, crítica construtiva, comentário normal sobre o
// GuiaZap), aprova sozinho na hora. Se parecer spam, ofensivo, ou fora do
// assunto, deixa como está (não aprovado) pra revisão manual no Admin —
// nunca aprova algo duvidoso sozinho, só adianta os casos claramente ok.

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { depoimentoId } = JSON.parse(event.body || '{}');
    if (!depoimentoId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'depoimentoId é obrigatório' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    const buscaResp = await fetch(`${SUPABASE_URL}/rest/v1/depoimentos?id=eq.${depoimentoId}&select=id,nome,tipo,mensagem,aprovado`, { headers });
    const registros = await buscaResp.json();
    const depoimento = registros[0];
    if (!depoimento || depoimento.aprovado) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, acao: 'nada_a_fazer' }) };
    }

    const promptSistema = `Você modera depoimentos enviados por usuários do GuiaZap (um diretório de profissionais e loja online, tipo um "guia local"). Responda APENAS com um JSON válido, sem texto antes/depois, sem markdown:
{
  "classificacao": "aprovar" | "revisar",
  "motivo": "explicação curta, só pra registro interno"
}

Aprove ("aprovar") quando o depoimento for um comentário normal e de boa-fé sobre a experiência da pessoa com o GuiaZap — elogio, crítica construtiva, sugestão, relato neutro. Isso vale mesmo que seja crítico ou negativo, desde que seja um feedback real e legível.

Marque como "revisar" quando: for spam ou propaganda de outra coisa; contiver xingamento, ofensa, discurso de ódio, ou conteúdo sexual; for completamente fora de assunto (nada a ver com o GuiaZap); contiver dados pessoais sensíveis de terceiros; ou o texto for confuso/vazio/sem sentido a ponto de não dar pra avaliar.

Na dúvida, escolha "revisar" — só aprove sozinho quando tiver certeza razoável.`;

    const mensagemParaAvaliar = `Nome: ${depoimento.nome}\nTipo: ${depoimento.tipo}\nDepoimento: ${depoimento.mensagem}`;

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
        messages: [{ role: 'user', content: mensagemParaAvaliar }]
      })
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.error('erro da API da Anthropic:', JSON.stringify(data));
      return { statusCode: 200, body: JSON.stringify({ ok: true, acao: 'erro_ia_deixa_manual' }) };
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
      return { statusCode: 200, body: JSON.stringify({ ok: true, acao: 'erro_parse_deixa_manual' }) };
    }

    if (resultado.classificacao === 'aprovar') {
      await fetch(`${SUPABASE_URL}/rest/v1/depoimentos?id=eq.${depoimentoId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ aprovado: true, aprovado_por_ia: true })
      });
      return { statusCode: 200, body: JSON.stringify({ ok: true, acao: 'aprovado_automaticamente' }) };
    }

    // Fica como está (não aprovado) — mas guarda o motivo pra ajudar na revisão manual
    await fetch(`${SUPABASE_URL}/rest/v1/depoimentos?id=eq.${depoimentoId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ motivo_revisao_ia: resultado.motivo || null })
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, acao: 'deixado_para_revisao_manual' }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 200, body: JSON.stringify({ ok: true, acao: 'erro_deixa_manual' }) };
  }
};