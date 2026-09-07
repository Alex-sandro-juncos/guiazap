// Revisa um artigo do blog recém-enviado usando IA, e decide sozinha se
// aprova (publica) ou exclui — sem precisar de ninguém lendo manualmente.
// É chamada automaticamente pelo blog.html logo depois que o artigo é
// gravado no banco (ainda como "aprovado: false").
//
// Critérios de reprovação (a IA decide olhando o texto completo):
// - Spam, propaganda ou link/conteúdo comercial disfarçado de artigo
// - Fora do tema do blog (o GuiaZap é um diretório de empresas/profissionais
//   locais — artigos devem ser sobre esse tipo de assunto: dicas pra quem
//   busca ou oferece serviços, negócios locais, etc)
// - Texto incoerente, sem sentido, palavras soltas sem conexão lógica
//   entre si (sinal de teste/spam/bagunça, não um artigo de verdade)
// - Ofensivo de qualquer tipo: preconceito de raça, religião, orientação
//   sexual, gênero, etc — inclusive em duplo sentido/insinuação, não só
//   quando é explícito
// - Conteúdo sexual, mesmo que sutil ou em duplo sentido
// - Política partidária ou temas extremamente polêmicos/delicados que não
//   têm a ver com o propósito do blog
//
// Endpoint PÚBLICO de propósito (o envio de artigo não exige login), então
// tem limite de tentativas por IP — sem isso, dava pra gastar crédito da
// API à vontade só chamando essa function em loop.

const LIMITE_POR_HORA = 15;
const JANELA_MINUTOS = 60;

async function estourouLimite(ip, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY){
  if(!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return false;

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };
  const chave = 'revisar-blog-ia:' + ip;

  try{
    const buscaResp = await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico?chave=eq.${encodeURIComponent(chave)}`, { headers });
    const registros = await buscaResp.json();
    const agora = new Date();

    if(registros[0]){
      const janelaInicio = new Date(registros[0].janela_inicio);
      const minutosPassados = (agora - janelaInicio) / 60000;

      if(minutosPassados >= JANELA_MINUTOS){
        await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico?chave=eq.${encodeURIComponent(chave)}`, {
          method: 'PATCH', headers, body: JSON.stringify({ contagem: 1, janela_inicio: agora.toISOString() })
        });
        return false;
      }

      if(registros[0].contagem >= LIMITE_POR_HORA) return true;

      await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico?chave=eq.${encodeURIComponent(chave)}`, {
        method: 'PATCH', headers, body: JSON.stringify({ contagem: registros[0].contagem + 1 })
      });
      return false;
    }

    await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico`, {
      method: 'POST', headers, body: JSON.stringify({ chave, contagem: 1, janela_inicio: agora.toISOString() })
    });
    return false;
  } catch(e){
    console.warn('erro ao checar limite de uso, deixando passar por segurança', e);
    return false;
  }
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Supabase não configurado' }) };
    }
    if (!ANTHROPIC_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY não configurada' }) };
    }

    const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'desconhecido';
    if (await estourouLimite(ip, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)) {
      return { statusCode: 429, body: JSON.stringify({ error: 'Muitas tentativas seguidas. Espera um pouco.' }) };
    }

    const { id } = JSON.parse(event.body || '{}');
    if (!id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'id é obrigatório' }) };
    }

    const dbHeaders = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    // Busca o artigo direto no banco (não confia no texto que o front-end
    // manda — alguém poderia mandar um texto diferente do que foi salvo)
    const buscaResp = await fetch(`${SUPABASE_URL}/rest/v1/blog_posts?id=eq.${id}&select=id,titulo,conteudo,aprovado`, { headers: dbHeaders });
    const posts = await buscaResp.json();
    const post = posts && posts[0];

    if (!post) {
      return { statusCode: 404, body: JSON.stringify({ error: 'artigo não encontrado' }) };
    }
    if (post.aprovado) {
      // Já foi decidido antes (ex: alguém chamou essa function duas vezes) — não revisa de novo
      return { statusCode: 200, body: JSON.stringify({ decisao: 'aprovado', motivo: 'já estava aprovado' }) };
    }

    const promptSistema = `Você é o moderador automático do blog do GuiaZap, um diretório de empresas e profissionais locais no Brasil (o blog publica artigos sobre negócios locais, dicas pra quem busca ou oferece serviços, empreendedorismo, etc).

Sua tarefa: ler o TÍTULO e o CONTEÚDO de um artigo enviado por um visitante, e decidir se ele deve ser PUBLICADO ou EXCLUÍDO. Responda APENAS com um JSON válido, sem texto antes/depois, sem markdown, no formato:
{"decisao": "aprovar" ou "excluir", "motivo": "explicação curta e objetiva, em português"}

EXCLUA o artigo se ele tiver QUALQUER um desses problemas:
- Spam, propaganda, link ou conteúdo comercial disfarçado de artigo
- Completamente fora do tema do blog (nada a ver com negócios, serviços, empreendedorismo ou vida local)
- Texto incoerente, sem sentido, palavras soltas sem nenhuma conexão lógica entre si (sinal de teste ou bagunça, não um artigo de verdade)
- Qualquer tipo de ofensa ou preconceito — raça, religião, orientação sexual, gênero, nacionalidade — inclusive quando é sutil, em duplo sentido ou insinuação, não só quando é explícito
- Conteúdo sexual, mesmo que sutil ou em duplo sentido
- Política partidária (citando partido, político ou governante específico) ou temas extremamente polêmicos/delicados sem relação com o propósito do blog. IMPORTANTE: uma denúncia, crítica ou opinião sobre um problema/situação, SEM citar nome de político ou partido específico, não deve ser barrada só por ser um tema social ou uma reclamação — o problema é mencionar partido/político por nome, não o assunto em si.

Se o artigo for coerente, sobre um tema aceitável, e não tiver nenhum desses problemas, APROVE — mesmo que a escrita não seja perfeita ou o tema seja simples. O objetivo é barrar spam/lixo/ofensa, não exigir qualidade literária.

Seja rigoroso: na dúvida entre aprovar e excluir um conteúdo realmente problemático, prefira excluir.`;

    const textoParaAvaliar = `TÍTULO: ${post.titulo}\n\nCONTEÚDO: ${post.conteudo}`;

    const iaResp = await fetch('https://api.anthropic.com/v1/messages', {
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
        messages: [{ role: 'user', content: textoParaAvaliar }]
      })
    });

    const iaData = await iaResp.json();
    if (!iaResp.ok) {
      console.error('erro da API da Anthropic ao revisar blog:', JSON.stringify(iaData));
      // Se a IA falhar, NÃO exclui por engano — deixa pendente pra revisão manual depois
      return { statusCode: 200, body: JSON.stringify({ decisao: 'pendente', motivo: 'erro ao revisar automaticamente, ficou pendente' }) };
    }

    const textoResposta = iaData.content && iaData.content[0] ? iaData.content[0].text : '';
    let resultado;
    try {
      let textoLimpo = textoResposta.replace(/```json|```/g, '').trim();
      const inicioJson = textoLimpo.indexOf('{');
      const fimJson = textoLimpo.lastIndexOf('}');
      if (inicioJson !== -1 && fimJson !== -1) textoLimpo = textoLimpo.slice(inicioJson, fimJson + 1);
      resultado = JSON.parse(textoLimpo);
    } catch (e) {
      console.error('resposta da IA não veio em JSON válido:', textoResposta);
      return { statusCode: 200, body: JSON.stringify({ decisao: 'pendente', motivo: 'erro ao revisar automaticamente, ficou pendente' }) };
    }

    if (resultado.decisao === 'aprovar') {
      const patchResp = await fetch(`${SUPABASE_URL}/rest/v1/blog_posts?id=eq.${id}`, {
        method: 'PATCH', headers: dbHeaders, body: JSON.stringify({ aprovado: true })
      });
      if (!patchResp.ok) {
        console.error('erro ao aprovar post via IA:', await patchResp.text());
        return { statusCode: 500, body: JSON.stringify({ error: 'erro ao aplicar aprovação' }) };
      }
      return { statusCode: 200, body: JSON.stringify({ decisao: 'aprovado', motivo: resultado.motivo || '' }) };
    } else {
      const delResp = await fetch(`${SUPABASE_URL}/rest/v1/blog_posts?id=eq.${id}`, {
        method: 'DELETE', headers: dbHeaders
      });
      if (!delResp.ok) {
        console.error('erro ao excluir post via IA:', await delResp.text());
        return { statusCode: 500, body: JSON.stringify({ error: 'erro ao aplicar exclusão' }) };
      }
      return { statusCode: 200, body: JSON.stringify({ decisao: 'excluido', motivo: resultado.motivo || 'não passou na revisão automática' }) };
    }
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao revisar artigo' }) };
  }
};