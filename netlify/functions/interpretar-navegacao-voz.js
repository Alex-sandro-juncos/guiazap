// Última tentativa antes de desistir e falar "não entendi": quando o que a
// pessoa falou não bateu com NENHUMA palavra-chave conhecida (lista em
// js/comandos-navegacao-voz.js), manda pra IA decidir se era um pedido pra
// ir pra alguma página do site — mesmo dito de um jeito criativo,
// inesperado, ou "mudando de ideia" no meio de outra coisa.
//
// Reaproveitável por QUALQUER página com modo voz (blog, papo, vitrine,
// index, pedidos, vagas, currículo...) — é só mandar o texto e o nome da
// página atual.
//
// Endpoint PÚBLICO de propósito (várias dessas páginas não exigem login
// pra usar o modo voz), então tem limite de tentativas por IP.

const LIMITE_POR_HORA = 40;
const JANELA_MINUTOS = 60;

async function estourouLimite(ip, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY){
  if(!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return false;

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };
  const chave = 'interpretar-navegacao-voz:' + ip;

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

// Lista de destinos que a IA pode escolher — mantém sincronizado com
// js/comandos-navegacao-voz.js (arquivos e propósitos, não as frases)
const DESCRICAO_PAGINAS = `
- index.html: página inicial do GuiaZap, busca de profissionais e empresas locais
- vitrine.html: loja/vitrine de produtos, onde a pessoa compra coisas, vê carrinho, faz pedido
- blog.html: blog do site, artigos escritos pela comunidade
- pedidos.html: tela de pedidos (pra dono de empresa gerenciar pedidos recebidos)
- vagas.html: vagas de emprego, tanto pra ver vagas quanto pra publicar uma
- curriculo.html: montador de currículo
- sobre.html: página explicando o que é o GuiaZap e como funciona
- chat.html: o "Papo", chat de atendimento com uma empresa específica
`;

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

    if (!ANTHROPIC_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY não configurada' }) };
    }

    const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'desconhecido';
    if (await estourouLimite(ip, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)) {
      return { statusCode: 429, body: JSON.stringify({ pagina: null, resposta_falada: 'Muitas tentativas seguidas. Espera um pouco e tenta de novo.' }) };
    }

    const { texto, paginaAtual } = JSON.parse(event.body || '{}');
    if (!texto) {
      return { statusCode: 400, body: JSON.stringify({ error: 'texto é obrigatório' }) };
    }

    const promptSistema = `Você interpreta o que uma pessoa falou por VOZ, no modo "mãos livres", num site chamado GuiaZap. A pessoa pode ter mudado de ideia no meio de outra coisa, falado de um jeito inesperado ou criativo, ou simplesmente usado palavras diferentes das que o site reconhece por padrão.

Sua única tarefa: decidir se o que ela falou indica vontade de IR PRA ALGUMA PÁGINA do site. Responda APENAS com um JSON válido, sem texto antes/depois, sem markdown, no formato:
{"pagina": "nome-do-arquivo.html" ou null, "resposta_falada": "resposta curta e natural, em português, pra ser lida em voz alta"}

Páginas disponíveis:
${DESCRICAO_PAGINAS}

A pessoa está atualmente em: ${paginaAtual || '(desconhecido)'}

Regras:
- Só escolha uma página se a intenção de navegar for razoavelmente clara (ex: "quero comprar uma coisa" = vitrine.html; "deixa eu ver vagas de emprego" = vagas.html; "vou escrever sobre isso depois" NÃO é pedido de navegação, é só um comentário).
- Nunca escolha a página em que a pessoa já está.
- Se não tiver certeza, ou não for pedido de navegação nenhum, pagina = null, e a resposta_falada explica rapidamente que não entendeu e o que ela pode fazer.
- resposta_falada deve ser curta (1 frase), natural, sem soar robótica.`;

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
        messages: [{ role: 'user', content: texto }]
      })
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.error('erro da API da Anthropic:', JSON.stringify(data));
      return { statusCode: 200, body: JSON.stringify({ pagina: null, resposta_falada: 'Não entendi. Pode repetir de outro jeito?' }) };
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
      resultado = { pagina: null, resposta_falada: 'Não entendi. Pode repetir de outro jeito?' };
    }

    // Nunca deixa a IA mandar pra própria página atual, mesmo que ela erre
    if (resultado.pagina === paginaAtual) resultado.pagina = null;

    return { statusCode: 200, body: JSON.stringify(resultado) };
  } catch (err) {
    console.error(err);
    return { statusCode: 200, body: JSON.stringify({ pagina: null, resposta_falada: 'Não entendi. Pode repetir de outro jeito?' }) };
  }
};