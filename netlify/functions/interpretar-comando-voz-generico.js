// Interpreta comandos de voz mais soltos em QUALQUER página do site — é
// genérica de propósito, pra não precisar criar uma function nova pra cada
// tela nova que ganhar comando de voz. Quem chama define quais ações
// existem naquela tela (acoesDisponiveis) e o contexto de dados relevante
// (dadosContexto) — essa function só decide qual ação bate melhor com o
// que a pessoa falou, e devolve os parâmetros pra o FRONTEND executar.
//
// Exige login (mesma lógica de custo/segurança do da Vitrine) — cada
// página usa seu próprio "tipo" de contador de uso diário, mas todos
// dividem o mesmo limite generoso (comando de voz é curto e barato).

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { texto, contexto, acoesDisponiveis, dadosContexto } = JSON.parse(event.body || '{}');
    if (!texto || !contexto || !Array.isArray(acoesDisponiveis) || acoesDisponiveis.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'texto, contexto e acoesDisponiveis são obrigatórios' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headersServico = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    // 1. Confere se está logado
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
    const usuario = await usuarioResp.json();

    // 2. Limite diário por USUÁRIO — soma tudo num contador só
    // ("comando_voz_generico"), independente de qual página chamou
    const LIMITE_DIARIO = 300;
    const hoje = new Date().toISOString().slice(0, 10);
    const usoResp = await fetch(`${SUPABASE_URL}/rest/v1/uso_ia_diario_usuario?user_id=eq.${usuario.id}&tipo=eq.comando_voz_generico&data=eq.${hoje}&select=contador`, { headers: headersServico });
    const usoData = await usoResp.json();
    const contadorAtual = usoData[0] ? usoData[0].contador : 0;

    if (contadorAtual >= LIMITE_DIARIO) {
      return { statusCode: 429, body: JSON.stringify({ error: 'Limite diário de comandos de voz atingido. Tenta de novo amanhã.' }) };
    }

    await fetch(`${SUPABASE_URL}/rest/v1/uso_ia_diario_usuario`, {
      method: 'POST',
      headers: { ...headersServico, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ user_id: usuario.id, tipo: 'comando_voz_generico', data: hoje, contador: contadorAtual + 1 })
    });

    const { chamarIABarata } = require('./ia-barata-helper');
    const { normalizarTexto, buscarCache, salvarPending, salvarAprovado } = require('./comandos-voz-cache');

    const textoNorm = normalizarTexto(contexto + '::' + texto);
    const cache = await buscarCache(contexto, textoNorm);
    if (cache) {
      return { statusCode: 200, body: JSON.stringify(cache) };
    }
    await salvarPending(contexto, textoNorm, texto);

    const listaAcoes = acoesDisponiveis.map(a => `- "${a.nome}": ${a.descricao}${a.params ? ' | params esperados: ' + a.params : ''}`).join('\n');
    const contextoTexto = dadosContexto ? JSON.stringify(dadosContexto).slice(0, 4000) : '(sem dados extras)';

    const promptSistema = `Você interpreta comandos de VOZ ditos por uma pessoa usando o GuiaZap no modo "mãos livres", na tela "${contexto}". Responda APENAS com um JSON válido, sem texto antes/depois, sem markdown, no formato:
{
  "voice_response": "resposta curta e natural, em português, pra ser lida em voz alta",
  "action": "uma das ações da lista abaixo, ou NENHUMA",
  "params": { ... }
}

Ações disponíveis nessa tela:
${listaAcoes}
- "NENHUMA": quando não entender o comando, ou for só conversa — nesse caso, responda pedindo pra repetir ou esclarecer.

Regras gerais:
- Preste atenção a erros comuns de transcrição de voz em nomes próprios (nomes de empresas/pessoas costumam sair com letras trocadas ou parecidas foneticamente — tente reconhecer o mais parecido nos dados de contexto abaixo).
- Nunca invente um id, nome ou valor que não esteja nos dados de contexto.
- Seja direto e natural na resposta falada, como se fosse uma pessoa explicando rapidamente o que fez.

Dados de contexto atuais dessa tela:
${contextoTexto}`;

    const ia = await chamarIABarata(promptSistema, texto, 500);
    const resultado = ia.ok
      ? ia.json
      : { voice_response: 'Desculpa, não entendi direito. Pode repetir?', action: 'NENHUMA', params: {} };

    if (ia.ok) await salvarAprovado(contexto, textoNorm, resultado);

    return { statusCode: 200, body: JSON.stringify(resultado) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao processar comando de voz' }) };
  }
};