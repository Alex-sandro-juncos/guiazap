// Lista CENTRAL de comandos de voz de NAVEGAÇÃO ENTRE PÁGINAS — usada por
// todas as páginas que têm modo voz (index, vitrine, blog, pedidos, vagas,
// currículo), pra que qualquer comando de "ir pra tal lugar" funcione
// IGUAL, não importa de onde a pessoa estiver falando.
//
// Se um dia precisar adicionar uma página nova na navegação por voz, ou
// ensinar uma frase nova, só mexe AQUI — não precisa editar cada página
// uma por uma.
//
// Uso: verificarNavegacaoUniversalPorVoz(textoNormalizado, 'nome-da-pagina-atual.html')
// Retorna { url, fala } se bateu com algum destino, ou null se não bateu.
// Frases que começam com "=" exigem que a fala inteira seja exatamente
// aquilo (ex: "=blog" só bate se a pessoa falou só "blog", nada mais —
// evita disparar sem querer no meio de outra frase). As demais frases
// bastam estar contidas em qualquer parte do que foi falado.

// ---------- IA GENÉRICA DE INTERPRETAÇÃO DE COMANDO DE VOZ ----------
// Função compartilhada por qualquer página com modo voz — chama a function
// genérica no backend (interpretar-comando-voz-generico.js), passando quais
// ações fazem sentido NAQUELA tela e os dados de contexto relevantes.
// Devolve o resultado (action/params/voice_response) ou null se der erro
// (nesse caso, quem chamou deve cair no "não entendi" de sempre).

async function _pegarSessionTokenGenerico(){
  const candidatos = ['supabaseClientChat', 'supabaseClientV', 'supabaseClient', 'supabaseClientFrete', 'supabaseClientCorridas', 'supabaseClientAgenda'];
  for(const nome of candidatos){
    if(typeof window[nome] !== 'undefined' && window[nome] && window[nome].auth){
      try{
        const { data: { session } } = await window[nome].auth.getSession();
        if(session && session.access_token) return session.access_token;
      } catch(e){}
    }
  }
  return null;
}

async function chamarIAGenericaVoz(texto, contexto, acoesDisponiveis, dadosContexto){
  try{
    const token = await _pegarSessionTokenGenerico();
    if(!token) return null;

    const resp = await fetch('/.netlify/functions/interpretar-comando-voz-generico', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ texto, contexto, acoesDisponiveis, dadosContexto })
    });
    if(!resp.ok) return null;
    const resultado = await resp.json();
    if(resultado.action === 'NENHUMA' && !resultado.voice_response) return null;
    return resultado;
  } catch(e){
    console.error('erro ao chamar IA genérica de voz', e);
    return null;
  }
}

// Verbos/frases que indicam "quero ir pra algum lugar" — usados junto com
// a palavra-chave de cada destino (ver função de match abaixo), pra cobrir
// MUITO mais jeitos de pedir a mesma coisa sem precisar listar frase por
// frase (ex: "vai pra vitrine", "abre o blog", "me leva pro mapa").
const _VERBOS_NAVEGACAO_VOZ = [
  'ir pra', 'ir para', 'ir pro', 'ir ao', 'ir a', 'vai pra', 'vai para', 'vai pro',
  'abre', 'abrir', 'volta pra', 'volta para', 'voltar pra', 'voltar para',
  'bora pra', 'bora para', 'bora pro', 'me leva pra', 'me leva para', 'me leva pro',
  'leva pra', 'leva para', 'mostra', 'mostrar', 'cade', 'cadê', 'acessar',
  'quero acessar', 'quero ir', 'quero ver', 'gostaria de acessar', 'gostaria de ir',
  'poderia abrir', 'preciso ir', 'preciso acessar', 'entrar em', 'entrar na', 'entrar no'
];

const _DESTINOS_NAVEGACAO_VOZ = [
  {
    arquivo: 'index.html',
    fala: 'Voltando pra página inicial...',
    gatilhos: ['=inicio', '=início', '=guiazap', 'pagina inicial', 'página inicial', 'voltar pro guiazap', 'voltar para o guiazap', 'ir pro guiazap', 'ir para o guiazap', 'ir para pagina inicial', 'ir para página inicial', 'volta pro guiazap', 'volta pro inicio', 'volta ao inicio', 'me leva pro guiazap'],
    palavrasChave: ['guiazap', 'inicio', 'início', 'pagina inicial', 'página inicial']
  },
  {
    arquivo: 'vitrine.html',
    fala: 'Indo pra Vitrine...',
    gatilhos: ['=vitrine', 'ir para vitrine', 'ir pra vitrine', 'ver vitrine', 'abrir vitrine', 'quero comprar', 'fazer compras', 'fazer uma compra', 'ir para compras', 'ir pra compras', 'quero ir para compras', 'quero ir pra compras', 'ir as compras', 'ir às compras', 'ver produtos', 'tô afim de comprar', 'to afim de comprar'],
    palavrasChave: ['vitrine', 'produtos', 'loja']
  },
  {
    arquivo: 'blog.html',
    fala: 'Indo pro blog...',
    gatilhos: [
      '=blog', 'ir para o blog', 'ir pro blog', 'abrir blog', 'ver blog', 'ler blog',
      // O reconhecimento de voz às vezes entende "ler blog" errado, como se
      // fosse inglês — cobre essas variações também
      'learn blog', 'lair blog', 'blair blog'
    ],
    palavrasChave: ['blog']
  },
  {
    arquivo: 'pedidos.html',
    fala: 'Indo pra tela de pedidos recebidos...',
    gatilhos: ['=pedidos', 'pedidos recebidos', 'gerenciar pedidos', 'pedidos da minha empresa', 'ver pedidos recebidos', 'pedidos da empresa', 'desejo gerenciar os pedidos', 'gerenciar os pedidos recebidos'],
    palavrasChave: ['pedidos recebidos', 'pedidos da empresa', 'gerenciar pedidos']
  },
  {
    arquivo: 'meus-pedidos.html',
    fala: 'Indo pra suas compras...',
    gatilhos: ['=minhas compras', 'minhas compras', 'meus pedidos', 'ver meus pedidos', 'ir para meus pedidos', 'ir pra meus pedidos', 'historico de compras', 'histórico de compras', 'acompanhar pedido', 'acompanhar meu pedido', 'cade minhas compras', 'cadê minhas compras', 'quero visualizar o historico de compras', 'quero visualizar o histórico de compras'],
    palavrasChave: ['minhas compras', 'meus pedidos', 'historico de compras', 'histórico de compras']
  },
  {
    arquivo: 'vagas.html',
    fala: 'Indo pra tela de vagas...',
    gatilhos: ['=vagas', 'ir para vagas', 'ir pra vagas', 'ver vagas', 'abrir vagas', 'contrata se', 'contrata-se', 'quero ver vagas', 'peço que abra a secao de vagas', 'peço que abra a seção de vagas', 'tem vaga ai'],
    palavrasChave: ['vagas', 'vagas de emprego', 'contrata se']
  },
  {
    arquivo: 'curriculo.html',
    fala: 'Indo pro montador de currículo...',
    gatilhos: ['=curriculo', '=currículo', 'ir para curriculo', 'ir pra curriculo', 'ir para currículo', 'ir pra currículo', 'montar curriculo', 'montar currículo', 'montar o curriculo', 'montar meu curriculo', 'montar um curriculo', 'montador de curriculo', 'montador de currículo', 'gostaria de montar o meu curriculo', 'gostaria de montar meu curriculo'],
    palavrasChave: ['curriculo', 'currículo']
  },
  {
    arquivo: 'sobre.html',
    fala: 'Indo pra página sobre o GuiaZap...',
    gatilhos: ['=sobre', 'como funciona', 'sobre o guiazap', 'o que e o guiazap', 'o que é o guiazap', 'poderia explicar como funciona', 'como que funciona isso', 'como funciona isso'],
    palavrasChave: ['como funciona', 'sobre o guiazap']
  },
  {
    arquivo: 'chat.html',
    fala: 'Indo pro Papo...',
    gatilhos: ['=papo', 'ir para o papo', 'ir pro papo', 'abrir papo', 'abrir o papo', 'ir para o chat', 'ir pro chat', 'abrir chat', 'abrir o chat', 'quero conversar', 'favor abrir o papo', 'chama o chat', 'chama o papo'],
    palavrasChave: ['papo', 'chat']
  },
  {
    arquivo: 'mapa.html',
    fala: 'Indo pro mapa...',
    gatilhos: ['=mapa', 'ir para o mapa', 'ir pro mapa', 'abrir mapa', 'ver mapa', 'ver no mapa', 'desejo visualizar o mapa', 'mostra o mapa'],
    palavrasChave: ['mapa']
  },
  {
    arquivo: 'agenda.html',
    fala: 'Indo pra sua Agenda...',
    gatilhos: ['=agenda', 'ir para agenda', 'ir pra agenda', 'ver agenda', 'abrir agenda', 'minha agenda', 'ver meus contatos', 'meus contatos'],
    palavrasChave: ['agenda', 'meus contatos']
  },
  {
    arquivo: 'chamar-frete.html',
    fala: 'Indo chamar um frete...',
    gatilhos: ['=chamar frete', 'chamar frete', 'quero um frete', 'preciso de um frete', 'chamar uma corrida', 'preciso de uma moto', 'preciso de um motoboy', 'quero um motoboy', 'preciso de um carreto'],
    palavrasChave: ['chamar frete', 'chamar corrida']
  },
  {
    arquivo: 'corridas.html',
    fala: 'Indo pro GuiaCorridas...',
    gatilhos: ['=guiacorridas', '=corridas', 'guia corridas', 'guiacorridas', 'minhas corridas', 'ver minhas corridas'],
    palavrasChave: ['guiacorridas', 'minhas corridas']
  },
  {
    arquivo: 'banco-entregadores.html',
    fala: 'Indo pro Banco de Entregadores...',
    gatilhos: ['=banco de entregadores', 'banco de entregadores', 'ver entregadores', 'buscar entregador', 'buscar entregadores'],
    palavrasChave: ['banco de entregadores', 'entregadores']
  }
];

// Confere se o texto tem um VERBO de navegação junto com a PALAVRA-CHAVE
// de algum destino — cobre "vai pra X", "abre X", "me leva pro X" etc. sem
// precisar listar cada combinação de frase manualmente.
function _bateuPorVerboEChave(textoNormalizado, destino){
  if(!destino.palavrasChave) return false;
  const temChave = destino.palavrasChave.some(chave => textoNormalizado.includes(chave));
  if(!temChave) return false;
  return _VERBOS_NAVEGACAO_VOZ.some(verbo => textoNormalizado.includes(verbo));
}


// ---------- MODO VOZ PERMANENTE ----------
// Diferente do "retomarModoVozAoCarregar" (que é usado só UMA vez, ao
// navegar de uma página do GuiaZap pra outra), essa flag NUNCA se apaga
// sozinha — fica salva até a pessoa mandar desativar de propósito. Serve
// pra alguém que usa o modo voz sempre (ex: pessoa cega) não precisar
// reativar toda vez que fecha e abre o navegador de novo.
const _CHAVE_MODO_VOZ_PERMANENTE = 'modo_voz_permanente_ativo';

function modoVozPermanenteAtivo(){
  return localStorage.getItem(_CHAVE_MODO_VOZ_PERMANENTE) === '1';
}
function ativarModoVozPermanente(){
  localStorage.setItem(_CHAVE_MODO_VOZ_PERMANENTE, '1');
}
function desativarModoVozPermanente(){
  localStorage.removeItem(_CHAVE_MODO_VOZ_PERMANENTE);
}

// ---------- RETOMAR DIRETO (sem pausa de "ativar") ----------
// O "retomarModoVozAoCarregar" sozinho sempre pausa esperando a pessoa
// falar "ativar" antes de continuar — isso é bom quando é só reabrir uma
// página fechada (modo voz permanente), mas é ruim quando a pessoa ACABOU
// de pedir pra ir pra essa página no meio de uma conversa já em andamento
// (ex: perguntou "quer comprar?", ela disse "sim", e aí precisar falar
// "ativar" de novo faz a conversa "cair do script"). Essa flag marca que
// é pra continuar direto, sem pausa nenhuma.
const _CHAVE_RETOMAR_DIRETO = 'retomar_modo_voz_direto';

function marcarRetomarModoVozDireto(){
  localStorage.setItem(_CHAVE_RETOMAR_DIRETO, '1');
}
function consumirRetomarModoVozDireto(){
  const v = localStorage.getItem(_CHAVE_RETOMAR_DIRETO) === '1';
  localStorage.removeItem(_CHAVE_RETOMAR_DIRETO);
  return v;
}

function verificarNavegacaoUniversalPorVoz(textoNormalizado, paginaAtual){
  if(!textoNormalizado) return null;

  for(const destino of _DESTINOS_NAVEGACAO_VOZ){
    if(destino.arquivo === paginaAtual) continue; // já está lá, não faz nada

    const bateuGatilhoExato = destino.gatilhos.some(gatilho => {
      if(gatilho.startsWith('=')) return textoNormalizado === gatilho.slice(1);
      return textoNormalizado.includes(gatilho);
    });

    if(bateuGatilhoExato || _bateuPorVerboEChave(textoNormalizado, destino)){
      return { url: destino.arquivo, fala: destino.fala };
    }
  }

  return null;
}

// Versão com IA de reserva: primeiro tenta a lista local (rápido, grátis).
// Se não bater com nada, manda pra IA interpretar — cobre qualquer jeito
// criativo ou inesperado de pedir pra navegar, tipo "mudei de ideia, quero
// comprar uma coisa" no meio de outra conversa. Retorna uma Promise.
async function verificarNavegacaoUniversalPorVozComIA(textoNormalizado, textoOriginal, paginaAtual){
  const localMatch = verificarNavegacaoUniversalPorVoz(textoNormalizado, paginaAtual);
  if(localMatch) return localMatch;

  try{
    const resp = await fetch('/.netlify/functions/interpretar-navegacao-universal-voz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto: textoOriginal, paginaAtual })
    });
    const resultado = await resp.json();
    if(resultado.pagina){
      return { url: resultado.pagina, fala: resultado.resposta_falada || ('Indo pra ' + resultado.pagina + '...') };
    }
    // IA não achou nenhuma página, mas pode ter uma resposta falada útil
    return { url: null, fala: resultado.resposta_falada || null };
  } catch(e){
    console.warn('erro ao consultar IA de navegação por voz', e);
    return null;
  }
}