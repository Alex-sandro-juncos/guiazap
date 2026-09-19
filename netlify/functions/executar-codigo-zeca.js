// Executa código de verdade — diferente do resto do Zeca, que só ESCREVE
// código. Isso roda de verdade e devolve o resultado.
//
// ⚠️ NUNCA roda o código dentro dessa function (isso teria acesso às
// chaves secretas do GuiaZap via process.env — um código malicioso
// poderia tentar vazar elas). Em vez disso, manda pro Judge0 CE, um
// serviço externo especializado em rodar código de forma isolada, sem
// nenhum acesso ao resto do sistema.
//
// ⚠️ O nível grátis do Judge0 CE é 50 execuções por dia — pro GuiaZap
// INTEIRO, não por pessoa. Por isso tem DOIS limites: um global (45/dia,
// com margem) e um por pessoa (15/dia) — sem o segundo, uma pessoa só
// logada poderia sozinha esgotar a cota do dia inteira e travar todo
// mundo. Exige login (trava simples contra visitante anônimo abusar).

const LINGUAGENS = {
  python: 71, python3: 71, py: 71,
  javascript: 63, js: 63, node: 63, nodejs: 63,
  java: 62,
  c: 50,
  'c++': 54, cpp: 54,
  'c#': 51, csharp: 51,
  ruby: 72,
  go: 60, golang: 60,
  php: 68,
  bash: 46, shell: 46, sh: 46,
  typescript: 74, ts: 74
};

const LIMITE_GLOBAL_DIA = 45; // deixa uma margem do limite real de 50 do Judge0
const LIMITE_POR_PESSOA_DIA = 15; // pra uma pessoa só não conseguir sozinha esgotar a cota do dia inteira

// E-mail do criador do GuiaZap — mesmo usado no zeca-chat.js e no
// gerar-imagem-zeca.js. Confirmado sempre pelo LOGIN, nunca por texto
// digitado. O criador não tem limite por pessoa (mas ainda soma pro
// limite GLOBAL — esse aqui protege a cota do Judge0 pro site inteiro,
// compartilhada com todo mundo, então não faz sentido "tirar" pra ninguém).
const ADMIN_EMAIL_CODIGO = 'contato@guiazap.shop';

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) {
      return { statusCode: 401, body: JSON.stringify({ error: 'precisa estar logado pra executar código' }) };
    }

    const { codigo, linguagem } = JSON.parse(event.body || '{}');
    if (!codigo || !codigo.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'código é obrigatório' }) };
    }

    const linguagemNormalizada = (linguagem || '').toLowerCase().trim();
    const languageId = LINGUAGENS[linguagemNormalizada];
    if (!languageId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `Linguagem "${linguagem}" não suportada. Tenta: Python, JavaScript, Java, C, C++, C#, Ruby, Go, PHP, Bash ou TypeScript.` })
      };
    }

    const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
    if (!RAPIDAPI_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'execução de código não configurada (RAPIDAPI_KEY)' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headersServico = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    const token = authHeader.replace('Bearer ', '');
    const usuarioResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
    });
    if (!usuarioResp.ok) {
      return { statusCode: 401, body: JSON.stringify({ error: 'sessão inválida ou expirada' }) };
    }
    const usuario = await usuarioResp.json();
    const souCriador = (usuario.email || '').toLowerCase() === ADMIN_EMAIL_CODIGO.toLowerCase();

    // Dois limites, checados ANTES de gastar com o Judge0:
    // 1. Global — o nível grátis do Judge0 é compartilhado pelo site inteiro
    // 2. Por pessoa — pra uma pessoa só não conseguir sozinha esgotar a
    //    cota do dia inteira, deixando todo mundo sem poder usar
    const agora = new Date();

    async function buscarRegistroLimite(chave) {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico?chave=eq.${encodeURIComponent(chave)}`, { headers: headersServico });
      const registros = await resp.json();
      return registros[0] || null;
    }

    const chaveGlobal = 'executar-codigo-zeca:global';
    const chavePessoa = 'executar-codigo-zeca:user:' + usuario.id;

    const registroGlobal = await buscarRegistroLimite(chaveGlobal);
    if (registroGlobal) {
      const horasPassadas = (agora - new Date(registroGlobal.janela_inicio)) / 3600000;
      if (horasPassadas < 24 && registroGlobal.contagem >= LIMITE_GLOBAL_DIA) {
        return {
          statusCode: 429,
          body: JSON.stringify({ error: 'O GuiaZap já usou a cota grátis de execução de código de hoje (é compartilhada entre todo mundo). Volta amanhã!' })
        };
      }
    }

    const registroPessoa = souCriador ? null : await buscarRegistroLimite(chavePessoa);
    if (!souCriador && registroPessoa) {
      const horasPassadas = (agora - new Date(registroPessoa.janela_inicio)) / 3600000;
      if (horasPassadas < 24 && registroPessoa.contagem >= LIMITE_POR_PESSOA_DIA) {
        return {
          statusCode: 429,
          body: JSON.stringify({ error: `Você já usou seu limite de ${LIMITE_POR_PESSOA_DIA} execuções hoje (é um recurso compartilhado, com pouca cota — assim ninguém sozinho usa tudo). Volta amanhã!` })
        };
      }
    }

    // Chama o Judge0 CE (isolado, nunca vê nenhuma chave do GuiaZap)
    const respExecucao = await fetch('https://judge0-ce.p.rapidapi.com/submissions?base64_encoded=false&wait=true', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'judge0-ce.p.rapidapi.com'
      },
      body: JSON.stringify({
        source_code: codigo,
        language_id: languageId,
        cpu_time_limit: 5
      })
    });

    if (!respExecucao.ok) {
      const erroTexto = await respExecucao.text();
      console.error('erro Judge0:', erroTexto);
      return { statusCode: 500, body: JSON.stringify({ error: 'não consegui executar o código agora' }) };
    }

    const resultado = await respExecucao.json();

    // Desconta dos dois limites só depois de confirmar que a chamada foi pra frente
    async function consumirLimite(chave, registroAtual) {
      if (registroAtual) {
        const horasPassadas = (agora - new Date(registroAtual.janela_inicio)) / 3600000;
        const novaContagem = horasPassadas >= 24 ? 1 : registroAtual.contagem + 1;
        const novaJanela = horasPassadas >= 24 ? agora.toISOString() : registroAtual.janela_inicio;
        await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico?chave=eq.${encodeURIComponent(chave)}`, {
          method: 'PATCH', headers: headersServico, body: JSON.stringify({ contagem: novaContagem, janela_inicio: novaJanela })
        });
      } else {
        await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico`, {
          method: 'POST', headers: headersServico, body: JSON.stringify({ chave, contagem: 1, janela_inicio: agora.toISOString() })
        });
      }
    }
    await consumirLimite(chaveGlobal, registroGlobal);
    if (!souCriador) await consumirLimite(chavePessoa, registroPessoa);

    return {
      statusCode: 200,
      body: JSON.stringify({
        stdout: resultado.stdout || '',
        stderr: resultado.stderr || resultado.compile_output || '',
        status: resultado.status ? resultado.status.description : 'desconhecido',
        tempo: resultado.time,
        memoria: resultado.memory
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao executar código' }) };
  }
};