// Chat geral do Zeca — o ponto de entrada novo da Fase 2/3. Diferente dos
// outros usos do Zeca (que só emprestam a voz dele pra uma tarefa
// pontual), aqui é uma conversa de verdade: a pessoa pode pedir pra achar
// uma empresa, pedir dica de currículo, pedir ajuda com um rascunho pro
// blog, perguntar como um pacote funciona, gerar imagem, editar uma foto,
// analisar um arquivo .zip de código, fazer uma pergunta geral (código,
// conhecimento, até coisa atual via busca na web), ou só bater papo —
// tudo pela mesma conversa, sem precisar ir em outra tela.
//
// Funciona em 2 passos pra nunca inventar empresa que não existe:
// 1. Uma chamada de IA barata decide a intenção: busca de empresa, gerar
//    imagem, modo geral (com limite diário por nível de conta — ver
//    zeca-limites-helper.js), ou "resposta" (que cobre dica de currículo,
//    ajuda com blog, dúvida sobre o GuiaZap e conversa solta).
// 2. Se for busca, consulta o Supabase de verdade e só DEPOIS pede pro
//    Zeca comentar os resultados reais — ele nunca inventa nome de empresa.
//    Se for modo geral e precisar de informação atual, busca na web de
//    verdade (Tavily) antes de responder.

const { chamarIABarata, PERSONA_ZECA } = require('./ia-barata-helper');
const { resolverNivelZeca, consumirLimiteZeca } = require('./zeca-limites-helper');
const { memoriaAtivada, carregarHistoricoConversa, salvarTrocaDeMensagens } = require('./zeca-memoria');
const JSZip = require('jszip');

// E-mail do criador do GuiaZap — só ele, confirmado pelo LOGIN (nunca por
// frase digitada no chat, que qualquer um poderia copiar), ganha: sem
// limite diário no modo geral/imagem/zip, limite bem maior de zip, e
// liberdade pra falar sobre a arquitetura interna do próprio GuiaZap.
// Isso NÃO libera nada que a política de segurança do próprio modelo
// (Gemini/Claude) não permitiria pra mais ninguém — só remove a reserva
// de falar sobre detalhes internos do próprio GuiaZap e os limites de uso.
const ADMIN_EMAIL_ZECA = 'contato@guiazap.shop';

// --- Suporte a arquivo .zip (revisão de código) ---
// Limites duplos: um pro público (protege custo/tempo de resposta) e um
// bem mais alto só pro criador. Mesmo pro criador isso não é "infinito"
// de propósito — sem algum teto, um zip gigante estoura o tempo da
// função e o contexto que a IA aguenta processar numa chamada só.
const EXTENSOES_TEXTO = new Set(['.js', '.ts', '.jsx', '.tsx', '.py', '.rb', '.php', '.java', '.c', '.cpp', '.h', '.go', '.rs', '.sh', '.sql', '.html', '.css', '.json', '.md', '.txt', '.yml', '.yaml', '.xml', '.toml', '.env', '.gitignore', '.csv']);
const MAX_ARQUIVOS_ZIP = 40;
const MAX_CARACTERES_ZIP = 60000;
// Pro criador não tem teto de propósito — só um número bem alto (não
// Infinity de verdade) porque a IA por trás tem uma janela de contexto
// finita mesmo pagando; passar muito disso só faz a chamada falhar ou
// cortar o conteúdo sem avisar direito.
const MAX_ARQUIVOS_ZIP_CRIADOR = 5000;
const MAX_CARACTERES_ZIP_CRIADOR = 4000000;

// Extrai só o texto dos arquivos de código/texto de dentro do zip, com
// limite de quantidade de arquivos e de caracteres totais — proteção
// contra zip-bomb (zip pequeno que descompacta em algo enorme).
async function extrairTextoDoZip(base64Zip, semLimiteBaixo) {
  const zip = await JSZip.loadAsync(base64Zip, { base64: true });
  const maxArquivos = semLimiteBaixo ? MAX_ARQUIVOS_ZIP_CRIADOR : MAX_ARQUIVOS_ZIP;
  const maxCaracteres = semLimiteBaixo ? MAX_CARACTERES_ZIP_CRIADOR : MAX_CARACTERES_ZIP;
  let textoTotal = '';
  let arquivosLidos = 0;

  for (const caminho of Object.keys(zip.files)) {
    if (arquivosLidos >= maxArquivos) break;
    const entrada = zip.files[caminho];
    if (entrada.dir) continue;

    const ext = caminho.slice(caminho.lastIndexOf('.')).toLowerCase();
    if (!EXTENSOES_TEXTO.has(ext)) continue;

    const conteudo = await entrada.async('string');
    const espacoRestante = maxCaracteres - textoTotal.length;
    if (espacoRestante <= 0) break;

    textoTotal += `\n\n--- ${caminho} ---\n${conteudo.slice(0, espacoRestante)}`;
    arquivosLidos++;
  }

  return { texto: textoTotal.trim(), arquivosLidos };
}

// Analisa uma imagem que a pessoa mandou (foto de produto, print, etc.)
// usando a visão do Gemini — modelo multimodal, entende imagem + texto
// na mesma chamada. Só DESCREVE/comenta a imagem, não edita.
async function analisarImagemComGemini(base64Imagem, mimeType, pergunta) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) return null;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64Imagem } },
              { text: PERSONA_ZECA + (pergunta && pergunta.trim() ? pergunta : 'Descreve essa imagem pra mim e comenta o que achar relevante.') }
            ]
          }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 800 }
        })
      }
    );
    const data = await resp.json();
    if (!resp.ok) {
      console.error('erro Gemini visão:', JSON.stringify(data));
      return null;
    }
    const texto = data.candidates && data.candidates[0] && data.candidates[0].content
      ? data.candidates[0].content.parts.map(p => p.text || '').join('')
      : '';
    return texto || null;
  } catch (e) {
    console.error('erro ao analisar imagem:', e);
    return null;
  }
}

// Edita uma imagem de verdade (ajusta cor, corta, tira fundo, etc.) usando
// o modelo de imagem do Gemini — diferente do analisarImagemComGemini
// acima, que só DESCREVE a foto, esse aqui devolve uma foto nova editada.
async function editarImagemComGemini(base64Imagem, mimeType, instrucao) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) return null;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64Imagem } },
              { text: instrucao && instrucao.trim() ? instrucao : 'Melhora essa foto: ajusta cor, luz e contraste de forma natural.' }
            ]
          }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
        })
      }
    );
    const data = await resp.json();
    if (!resp.ok) {
      console.error('erro Gemini edição de imagem:', JSON.stringify(data));
      return null;
    }
    const partes = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    let textoResposta = '';
    let imagemSaida = null;
    let mimeTypeSaida = 'image/png';
    for (const parte of partes) {
      if (parte.text) textoResposta += parte.text;
      const inline = parte.inline_data || parte.inlineData;
      if (inline && inline.data) {
        imagemSaida = inline.data;
        mimeTypeSaida = inline.mime_type || inline.mimeType || 'image/png';
      }
    }
    if (!imagemSaida) return null; // Gemini só respondeu texto, não editou de verdade
    return { texto: textoResposta || 'Prontinho! Editei sua foto.', imagemBase64: imagemSaida, mimeType: mimeTypeSaida };
  } catch (e) {
    console.error('erro ao editar imagem:', e);
    return null;
  }
}

// Detecta se o pedido junto da imagem é pra EDITAR (corta, ajusta cor,
// tira fundo, etc.) em vez de só descrever/analisar a foto.
const PALAVRAS_EDICAO_IMAGEM = /\b(edita|editar|edi[cç][aã]o|ajusta|ajustar|corrig[ei]|melhora|melhorar|corta|cortar|recorta|recortar|remov[ea]|remover|fundo (branco|transparente|azul|verde)|troca a cor|troque a cor|muda a cor|deixa (mais|com|preto e branco|p&b|pb)|vira (preto e branco|p&b)|aumenta o brilho|aumentar o brilho|clareia|clarear|escurece|escurecer|gira|girar|rotaciona|rotacionar|redimensiona|redimensionar)\b/i;

// Modo geral: código em qualquer linguagem, conhecimento geral, conversa
// livre — sem ficar preso a assunto do GuiaZap. Custa mais que o resto do
// Zeca (respostas maiores, tarefa mais pesada), então tem limite diário
// por nível de conta, visitante incluso (com limite bem menor).
const LIMITES_MODO_GERAL = { visitante: 1, gratis: 10, completo: 30, premium: 60 };
const LIMITE_POR_HORA = 30;
const JANELA_MINUTOS = 60;

// Referência factual dos pacotes — dada pronta pro Zeca, pra ele nunca
// "inventar" preço ou benefício errado quando alguém pergunta como
// funciona algum plano. Manter isso sincronizado com pacotes.html.
const REFERENCIA_PACOTES = `
Pacotes do GuiaZap (preços e benefícios reais — nunca informar outro valor):
- Contato: grátis. Aparece na busca, WhatsApp direto, avaliações, 1 novidade por vez (24h).
- Completo: R$10/mês. Tudo do Contato + Banco de Talentos + até 3 novidades ativas (5 fotos cada, 24h).
- Premium: R$25/mês. Tudo do Completo + selo dourado + seguidores + novidades ilimitadas (10 fotos, 7 dias) + prioridade na busca + relatório semanal por e-mail.
- Vendas: R$40/mês. Tudo do Premium + Vitrine de produtos + carrinho + atendimento automático por menu + frete calculado automático + link externo de compra.
- Corridas e Fretes: R$10/mês. Fica no Banco de Entregadores, sem comissão nenhuma sobre o valor combinado.
- Selo Verificado: R$15 pagamento único, disponível pra qualquer pacote — confirma CPF/CNPJ de verdade.
- Impulsionar: R$5, fica 24h no topo da busca.
`;

async function estourouLimite(ip) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return false;

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };
  const chave = 'zeca-chat:' + ip;

  try {
    const buscaResp = await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico?chave=eq.${encodeURIComponent(chave)}`, { headers });
    const registros = await buscaResp.json();
    const agora = new Date();

    if (registros[0]) {
      const minutosPassados = (agora - new Date(registros[0].janela_inicio)) / 60000;
      if (minutosPassados >= JANELA_MINUTOS) {
        await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico?chave=eq.${encodeURIComponent(chave)}`, {
          method: 'PATCH', headers, body: JSON.stringify({ contagem: 1, janela_inicio: agora.toISOString() })
        });
        return false;
      }
      if (registros[0].contagem >= LIMITE_POR_HORA) return true;
      await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico?chave=eq.${encodeURIComponent(chave)}`, {
        method: 'PATCH', headers, body: JSON.stringify({ contagem: registros[0].contagem + 1 })
      });
      return false;
    }
    await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico`, {
      method: 'POST', headers, body: JSON.stringify({ chave, contagem: 1, janela_inicio: agora.toISOString() })
    });
    return false;
  } catch (e) {
    console.warn('erro ao checar limite de uso, bloqueando por segurança', e);
    return true; // fail-closed: bloqueia em vez de liberar se o controle falhar
  }
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { mensagem, historico, imagem, arquivoZip, conversaId } = JSON.parse(event.body || '{}');
    if ((!mensagem || !mensagem.trim()) && !imagem && !arquivoZip) {
      return { statusCode: 400, body: JSON.stringify({ error: 'mensagem é obrigatória' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    // Memória é opt-in — só carrega/salva se a pessoa tiver ativado.
    // Sem login, não tem como ter memória (precisa saber de quem é).
    // O mesmo login também é usado pra reconhecer o criador (Alex) —
    // nunca por frase digitada no chat, sempre pela sessão autenticada.
    const authHeaderChat = event.headers.authorization || event.headers.Authorization;
    let usuarioIdChat = null;
    let usaMemoria = false;
    let souCriador = false;
    if (authHeaderChat) {
      const tokenChat = authHeaderChat.replace('Bearer ', '');
      const usuarioResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${tokenChat}` }
      });
      if (usuarioResp.ok) {
        const usuarioChat = await usuarioResp.json();
        usuarioIdChat = usuarioChat.id;
        usaMemoria = await memoriaAtivada(usuarioIdChat);
        souCriador = (usuarioChat.email || '').toLowerCase() === ADMIN_EMAIL_ZECA.toLowerCase();
      }
    }

    // Rate limit geral (30 msgs/hora por IP) protege contra abuso de
    // visitante/bot — o criador (login confirmado acima) nunca passa por
    // essa trava, pode mandar quantas mensagens quiser.
    if (!souCriador) {
      const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'desconhecido';
      if (await estourouLimite(ip)) {
        return { statusCode: 429, body: JSON.stringify({ resposta: 'Muitas mensagens seguidas! Espera um pouquinho e manda de novo.' }) };
      }
    }

    const contextoCriador = souCriador
      ? '\n\nIMPORTANTE: quem está falando com você agora é o Alex, o criador e desenvolvedor do GuiaZap — confirmado pelo login dele, não é alguém se passando por ele. Pode reconhecer isso naturalmente (sem exagerar toda hora) e responder livremente qualquer pergunta sobre como o GuiaZap funciona por dentro — arquitetura, decisões técnicas, limites, como o Zeca foi construído, etc. Isso NÃO muda suas regras gerais de segurança (nunca ajuda com conteúdo perigoso, ilegal, ou que a política de segurança do seu próprio modelo não permite, mesmo pra ele) — só remove a reserva de falar sobre detalhes internos do próprio GuiaZap.'
      : '';

    // Se veio uma imagem, nem passa pelo classificador de texto — é
    // sempre tratado como "olha essa imagem" (ou "edita essa imagem"),
    // com a mesma trava de limite diário do modo geral (é tarefa pesada
    // igual). O criador não tem limite diário aqui.
    if (imagem && imagem.data) {
      const nivel = souCriador ? { autorizado: true, limiteDoDia: null } : await resolverNivelZeca(event, 'zeca-geral', LIMITES_MODO_GERAL);
      if (nivel.erroAuth) {
        return { statusCode: 200, body: JSON.stringify({ resposta: 'Sua sessão expirou — atualiza a página e tenta de novo.' }) };
      }
      if (!nivel.autorizado) {
        return {
          statusCode: 429,
          body: JSON.stringify({
            resposta: `Você já usou seu limite de ${nivel.limiteDoDia} pergunta${nivel.limiteDoDia > 1 ? 's' : ''} "fora do GuiaZap" hoje (imagem conta nesse mesmo limite). ${nivel.logado ? 'Um pacote maior dá mais por dia.' : 'Cria uma conta grátis ou volta amanhã.'}`
          })
        };
      }

      const pedeEdicao = PALAVRAS_EDICAO_IMAGEM.test(mensagem || '');

      if (pedeEdicao) {
        const resultadoEdicao = await editarImagemComGemini(imagem.data, imagem.mimeType, mensagem);
        if (!resultadoEdicao) {
          return { statusCode: 200, body: JSON.stringify({ resposta: 'Não consegui editar essa imagem agora. Tenta descrever de novo o que você quer mudar, ou manda outra foto.' }) };
        }
        await consumirLimiteZeca(nivel);
        return {
          statusCode: 200,
          body: JSON.stringify({
            resposta: resultadoEdicao.texto,
            imagemEditada: { data: resultadoEdicao.imagemBase64, mimeType: resultadoEdicao.mimeType }
          })
        };
      }

      const respostaVisao = await analisarImagemComGemini(imagem.data, imagem.mimeType, mensagem);
      if (!respostaVisao) {
        return { statusCode: 200, body: JSON.stringify({ resposta: 'Não consegui olhar essa imagem agora. Tenta de novo?' }) };
      }

      await consumirLimiteZeca(nivel);
      return { statusCode: 200, body: JSON.stringify({ resposta: respostaVisao }) };
    }

    // Se veio um .zip, extrai o texto dos arquivos de código de dentro e
    // pede pro Zeca comentar/revisar — mesma trava de limite do modo geral.
    // Criador ganha teto de arquivos/caracteres bem maior (ver constantes
    // no topo do arquivo) e sem limite diário de uso.
    if (arquivoZip) {
      const nivel = souCriador ? { autorizado: true, limiteDoDia: null } : await resolverNivelZeca(event, 'zeca-geral', LIMITES_MODO_GERAL);
      if (nivel.erroAuth) {
        return { statusCode: 200, body: JSON.stringify({ resposta: 'Sua sessão expirou — atualiza a página e tenta de novo.' }) };
      }
      if (!nivel.autorizado) {
        return {
          statusCode: 429,
          body: JSON.stringify({
            resposta: `Você já usou seu limite de ${nivel.limiteDoDia} pergunta${nivel.limiteDoDia > 1 ? 's' : ''} "fora do GuiaZap" hoje (zip conta nesse mesmo limite). ${nivel.logado ? 'Um pacote maior dá mais por dia.' : 'Cria uma conta grátis ou volta amanhã.'}`
          })
        };
      }

      let extraido;
      try {
        extraido = await extrairTextoDoZip(arquivoZip, souCriador);
      } catch (eZip) {
        console.error('erro ao ler zip:', eZip);
        return { statusCode: 200, body: JSON.stringify({ resposta: 'Não consegui abrir esse .zip. Confere se o arquivo não está corrompido e tenta de novo.' }) };
      }

      if (!extraido.texto) {
        return { statusCode: 200, body: JSON.stringify({ resposta: 'Não achei nenhum arquivo de código/texto legível dentro desse .zip.' }) };
      }

      const promptZip = `Você é o Zeca, respondendo sobre um projeto de código que a pessoa mandou como .zip (${extraido.arquivosLidos} arquivo(s) lido(s)). Responda com o mesmo cuidado de qualquer assistente de IA completo — comente, revise, ache bugs, sugira melhoria, ou responda a pergunta específica da pessoa sobre esse código.
Responda APENAS com um JSON válido: {"resposta": "sua resposta completa aqui"}${contextoCriador}

Conteúdo dos arquivos:
${extraido.texto}`;

      const iaZip = await chamarIABarata(promptZip, mensagem || 'Dá uma olhada nesse projeto e me diz o que acha.', 1800, true);
      if (!iaZip.ok || !iaZip.json || !iaZip.json.resposta) {
        return { statusCode: 200, body: JSON.stringify({ resposta: 'Deu ruim pra analisar esse zip agora. Tenta de novo?' }) };
      }

      await consumirLimiteZeca(nivel);
      return { statusCode: 200, body: JSON.stringify({ resposta: iaZip.json.resposta }) };
    }

    // Últimas trocas da conversa, só pra dar contexto (a pessoa pode
    // mandar "e perto do centro?" depois de já ter perguntado por elétrico).
    // Se a memória estiver ativa e for uma conversa salva, usa o histórico
    // de verdade do banco em vez do que o navegador mandou.
    const historicoParaUsar = (usaMemoria && conversaId)
      ? await carregarHistoricoConversa(conversaId, usuarioIdChat)
      : (Array.isArray(historico) ? historico : []);

    const contextoHistorico = historicoParaUsar.length
      ? '\n\nÚltimas mensagens dessa conversa (mais recente por último):\n' + historicoParaUsar.slice(-6).map(h => `${h.de === 'zeca' ? 'Zeca' : 'Pessoa'}: ${h.texto}`).join('\n')
      : '';

    // Passo 1 — decide a intenção, sem ainda comentar nenhuma empresa
    const promptIntencao = `Você decide a intenção de uma mensagem mandada pro Zeca, a IA do chat geral do GuiaZap (diretório de empresas/profissionais locais no Brasil, com busca, WhatsApp direto, vitrine de produtos, vagas de emprego, currículo, blog).
${REFERENCIA_PACOTES}
Responda APENAS com um JSON válido: {"tipo": "busca" | "gerar_imagem" | "executar_codigo" | "geral" | "resposta", "categoria_busca": "categoria ou serviço procurado, ou null", "cidade_busca": "cidade/bairro mencionado, ou null", "descricao_imagem": "o que a pessoa quer na imagem, só se tipo for gerar_imagem, ou null", "codigo_para_executar": "o código-fonte a rodar, só se tipo for executar_codigo, ou null", "linguagem_codigo": "nome da linguagem (python, javascript, java, c, c++, c#, ruby, go, php, bash, typescript), só se tipo for executar_codigo, ou null", "busca_web": "uma boa frase de busca no Google, só se tipo for geral E a pergunta precisar de informação atual/recente (notícia, previsão do tempo, preço de hoje, quem ocupa um cargo agora, evento recente) que você não teria como saber com certeza — senão null", "resposta": "sua resposta em texto, só usada se tipo for resposta"}

Regras:
- tipo "busca": quando a pessoa claramente quer ACHAR um profissional/empresa/produto (ex: "procuro eletricista", "tem pizzaria aberta?", "cabeleireira perto de mim")
- tipo "gerar_imagem": quando a pessoa pede pra você GERAR/CRIAR/DESENHAR uma imagem, foto ilustrativa ou foto de produto (ex: "gera uma foto do meu bolo", "cria uma imagem de um hambúrguer"). Preenche descricao_imagem com o que ela descreveu, de forma limpa.
- tipo "executar_codigo": quando a pessoa pede EXPLICITAMENTE pra RODAR/EXECUTAR/TESTAR um código (não só escrever) — ex: "roda esse código pra mim", "executa isso e me diz o resultado", "testa esse python: ...". Só usa esse tipo quando tiver um código de verdade pra rodar (colado na mensagem ou já combinado antes na conversa) E uma linguagem clara. Se a pessoa só pediu pra ESCREVER/CRIAR código sem pedir pra rodar, isso é tipo "geral", não "executar_codigo".
- tipo "geral": pedido de VERDADE pesado, sem relação com o GuiaZap — escrever/explicar código de programação (sem rodar), ou explicar conhecimento geral de forma substancial (ciência, história, matemática, etc.). NÃO gera a resposta aqui, só identifica — deixa o campo "resposta" vazio nesse caso. Preenche busca_web quando a pergunta precisar de informação atual (ver acima).
- tipo "resposta": pra tudo mais — saudação ("oi", "tudo bem?"), agradecimento, despedida, bate-papo leve, e tudo que É sobre o GuiaZap ou os casos especiais abaixo. Cobre TAMBÉM:
  • Se a pessoa pedir dica de currículo, ou colar o texto de um currículo/experiência pedindo avaliação: dê no máximo 4 dicas curtas e práticas (uma frase cada), tom encorajador, focando em coisas fáceis de mudar. Se já estiver bom, diga isso e dê só 1 dica a mais.
  • Se a pessoa pedir ajuda com um texto/rascunho pro blog do GuiaZap (artigo sobre negócio local, dica pra quem busca/oferece serviço, empreendedorismo): dê feedback construtivo — se o texto foge do tema do blog, tem spam/propaganda disfarçada, ou conteúdo ofensivo/sexual/político partidário, avise isso claramente antes de mandar (esses tipos de conteúdo são barrados na revisão automática); senão, dê 2-3 sugestões de como melhorar.
  Pra qualquer pergunta sobre como o GuiaZap funciona, pacotes/preços, ou dúvida sobre o site: responda com a informação certa usando a referência de pacotes acima quando for sobre preço/plano. Se não souber algo específico do GuiaZap que não está na referência, diga que não tem certeza e sugira falar com o suporte (contato@guiazap.shop), em vez de inventar.${contextoCriador}${contextoHistorico}`;

    const ia = await chamarIABarata(promptIntencao, mensagem, 500, true);

    if (!ia.ok || !ia.json) {
      return { statusCode: 200, body: JSON.stringify({ resposta: 'Deu ruim aqui do meu lado agora. Tenta de novo em instantes?' }) };
    }

    const decisao = ia.json;

    if (decisao.tipo === 'executar_codigo') {
      // A execução de verdade acontece direto no front-end com o token
      // da pessoa, chamando executar-codigo-zeca.js — aqui só valida se
      // tem código e linguagem antes de sinalizar.
      if (!decisao.codigo_para_executar || !decisao.linguagem_codigo) {
        return { statusCode: 200, body: JSON.stringify({ resposta: 'Me manda o código completo e diz a linguagem (Python, JavaScript, etc.) que eu rodo pra você.' }) };
      }
      return {
        statusCode: 200,
        body: JSON.stringify({
          tipo: 'executar_codigo',
          codigo: decisao.codigo_para_executar,
          linguagem: decisao.linguagem_codigo,
          resposta: 'Rodando seu código...'
        })
      };
    }

    if (decisao.tipo === 'geral') {
      // Modo geral custa mais e tem limite diário por nível de conta —
      // confere ANTES de gastar com a resposta de verdade. Criador sem limite.
      const nivel = souCriador ? { autorizado: true, limiteDoDia: null } : await resolverNivelZeca(event, 'zeca-geral', LIMITES_MODO_GERAL);
      if (nivel.erroAuth) {
        return { statusCode: 200, body: JSON.stringify({ resposta: 'Sua sessão expirou — atualiza a página e tenta de novo.' }) };
      }
      if (!nivel.autorizado) {
        return {
          statusCode: 429,
          body: JSON.stringify({
            resposta: `Você já usou seu limite de ${nivel.limiteDoDia} pergunta${nivel.limiteDoDia > 1 ? 's' : ''} "fora do GuiaZap" hoje. ${nivel.logado ? 'Um pacote maior dá mais por dia.' : 'Cria uma conta grátis ou volta amanhã.'}`
          })
        };
      }

      // Se a pergunta precisa de informação atual, busca de verdade na
      // web antes de responder (Tavily — feito pra alimentar IA, já
      // devolve texto limpo em vez de HTML de página). Se a busca falhar
      // por qualquer motivo, segue sem ela — o Zeca avisa que não tem
      // certeza em vez de travar a conversa inteira.
      let contextoWeb = '';
      if (decisao.busca_web && process.env.TAVILY_API_KEY) {
        try {
          const respBusca = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
            body: JSON.stringify({
              query: decisao.busca_web,
              search_depth: 'basic',
              max_results: 4,
              include_answer: true,
              language: 'pt'
            })
          });
          if (respBusca.ok) {
            const dadosBusca = await respBusca.json();
            const trechos = (dadosBusca.results || []).slice(0, 4).map(r => `- ${r.title}: ${(r.content || '').slice(0, 300)}`).join('\n');
            if (dadosBusca.answer || trechos) {
              contextoWeb = `\n\nResultado de uma busca na web feita agora sobre "${decisao.busca_web}" (use isso pra responder com informação atual; não invente nada fora disso quando a pergunta depender de atualidade):\n${dadosBusca.answer ? 'Resumo: ' + dadosBusca.answer + '\n' : ''}${trechos}`;
            }
          }
        } catch (eBusca) {
          console.warn('busca na web falhou, respondendo sem ela', eBusca);
        }
      }

      const promptGeral = `Você é o Zeca, a IA do GuiaZap — mas agora respondendo uma pergunta geral, sem relação com o site (código, conhecimento, conversa livre). Responda com o mesmo cuidado e qualidade de qualquer assistente de IA completo: se for código, escreva o código de verdade, funcional, comentado quando ajudar; se for conhecimento geral, responda com precisão. Se vier junto um resultado de busca na web (abaixo), baseie sua resposta nele pra informação atual, e não no que você "lembra" de antes. Continua sendo o Zeca — mantém o tom direto e sem enrolação, mas aqui pode se estender o quanto a pergunta precisar (não precisa ser curto igual as outras respostas do GuiaZap).
Responda APENAS com um JSON válido: {"resposta": "sua resposta completa aqui"}${contextoCriador}${contextoWeb}${contextoHistorico}`;

      const iaGeral = await chamarIABarata(promptGeral, mensagem, 1800, true);
      if (!iaGeral.ok || !iaGeral.json || !iaGeral.json.resposta) {
        return { statusCode: 200, body: JSON.stringify({ resposta: 'Deu ruim pra pensar nessa agora. Tenta de novo?' }) };
      }

      await consumirLimiteZeca(nivel);

      let conversaIdSalva = null;
      let limiteConversasAtingido = false;
      if (usaMemoria) {
        conversaIdSalva = await salvarTrocaDeMensagens(usuarioIdChat, conversaId, mensagem, iaGeral.json.resposta);
        if (!conversaIdSalva && !conversaId) limiteConversasAtingido = true; // era conversa nova e não coube
      }
      return { statusCode: 200, body: JSON.stringify({ resposta: iaGeral.json.resposta, conversaId: conversaIdSalva, limiteConversasAtingido }) };
    }

    if (decisao.tipo === 'gerar_imagem') {
      // A checagem de limite por nível de pacote (visitante/grátis/completo/
      // premium/vendas) acontece de verdade dentro do gerar-imagem-zeca.js
      // quando o front-end chamar ele — aqui só sinaliza a intenção.
      return {
        statusCode: 200,
        body: JSON.stringify({
          tipo: 'gerar_imagem',
          descricaoImagem: decisao.descricao_imagem || mensagem,
          resposta: 'Bora, gerando sua imagem...'
        })
      };
    }

    if (decisao.tipo !== 'busca') {
      const respostaTexto = decisao.resposta || 'Pode falar de novo? Não peguei direito.';
      let conversaIdSalva = null;
      let limiteConversasAtingido = false;
      if (usaMemoria) {
        conversaIdSalva = await salvarTrocaDeMensagens(usuarioIdChat, conversaId, mensagem, respostaTexto);
        if (!conversaIdSalva && !conversaId) limiteConversasAtingido = true;
      }
      return { statusCode: 200, body: JSON.stringify({ resposta: respostaTexto, conversaId: conversaIdSalva, limiteConversasAtingido }) };
    }

    // Passo 2 — busca de verdade no banco, só empresas ativas
    let query = `${SUPABASE_URL}/rest/v1/profissionais?status_pagamento=eq.ativo&select=id,name,cat,cidade,bairro,verificado,plano,whatsapp&limit=5`;
    if (decisao.categoria_busca) query += `&cat=ilike.*${encodeURIComponent(decisao.categoria_busca)}*`;
    if (decisao.cidade_busca) query += `&cidade=ilike.*${encodeURIComponent(decisao.cidade_busca)}*`;

    const buscaResp = await fetch(query, { headers });
    const resultados = buscaResp.ok ? await buscaResp.json() : [];

    if (resultados.length === 0) {
      const promptSemResultado = `Você não achou nenhum resultado pra busca da pessoa (categoria: ${decisao.categoria_busca || 'não especificada'}, cidade: ${decisao.cidade_busca || 'não especificada'}). Explique isso de forma breve e sugira ela tentar um termo diferente ou dar uma olhada no mapa.`;
      const iaSemResultado = await chamarIABarata(promptSemResultado, mensagem, 200, true);
      return { statusCode: 200, body: JSON.stringify({ resposta: (iaSemResultado.ok && iaSemResultado.json.resposta) || 'Não achei ninguém com isso ainda por aqui. Tenta um termo diferente?' }) };
    }

    const listaResultados = resultados.map(r => `${r.name} (${r.cat}${r.cidade ? ', ' + r.cidade : ''}${r.verificado ? ', verificado' : ''})`).join('; ');

    const promptComResultado = `Você achou essas empresas de verdade no banco pra sugerir (NUNCA cite nenhuma empresa que não esteja nessa lista): ${listaResultados}.
Responda APENAS com JSON: {"resposta": "comente os resultados de forma natural e breve, cite os nomes reais, sem inventar nada"}`;

    const iaComResultado = await chamarIABarata(promptComResultado, mensagem, 300, true);
    const respostaFinal = (iaComResultado.ok && iaComResultado.json.resposta) || `Achei: ${listaResultados}.`;

    return { statusCode: 200, body: JSON.stringify({ resposta: respostaFinal, resultados }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ resposta: 'Deu ruim aqui do meu lado agora. Tenta de novo em instantes?' }) };
  }
};