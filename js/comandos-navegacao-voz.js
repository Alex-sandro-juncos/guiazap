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

const _DESTINOS_NAVEGACAO_VOZ = [
  {
    arquivo: 'index.html',
    fala: 'Voltando pra página inicial...',
    gatilhos: ['=inicio', '=início', '=guiazap', 'pagina inicial', 'página inicial', 'voltar pro guiazap', 'voltar para o guiazap', 'ir pro guiazap', 'ir para o guiazap', 'ir para pagina inicial', 'ir para página inicial']
  },
  {
    arquivo: 'vitrine.html',
    fala: 'Indo pra Vitrine...',
    gatilhos: ['=vitrine', 'ir para vitrine', 'ir pra vitrine', 'ver vitrine', 'abrir vitrine', 'quero comprar', 'fazer compras', 'fazer uma compra', 'ir para compras', 'ir pra compras', 'quero ir para compras', 'quero ir pra compras', 'ir as compras', 'ir às compras', 'ver produtos']
  },
  {
    arquivo: 'blog.html',
    fala: 'Indo pro blog...',
    gatilhos: [
      '=blog', 'ir para o blog', 'ir pro blog', 'abrir blog', 'ver blog', 'ler blog',
      // O reconhecimento de voz às vezes entende "ler blog" errado, como se
      // fosse inglês — cobre essas variações também
      'learn blog', 'lair blog', 'blair blog'
    ]
  },
  {
    arquivo: 'pedidos.html',
    fala: 'Indo pra tela de pedidos...',
    gatilhos: ['=pedidos', 'ir para pedidos', 'ir pra pedidos', 'ver meus pedidos', 'meus pedidos']
  },
  {
    arquivo: 'vagas.html',
    fala: 'Indo pra tela de vagas...',
    gatilhos: ['=vagas', 'ir para vagas', 'ir pra vagas', 'ver vagas', 'abrir vagas', 'contrata se', 'contrata-se']
  },
  {
    arquivo: 'curriculo.html',
    fala: 'Indo pro montador de currículo...',
    gatilhos: ['=curriculo', '=currículo', 'ir para curriculo', 'ir pra curriculo', 'ir para currículo', 'ir pra currículo', 'montar curriculo', 'montar currículo', 'montador de curriculo', 'montador de currículo']
  },
  {
    arquivo: 'sobre.html',
    fala: 'Indo pra página sobre o GuiaZap...',
    gatilhos: ['=sobre', 'como funciona', 'sobre o guiazap', 'o que e o guiazap', 'o que é o guiazap']
  },
  {
    arquivo: 'chat.html',
    fala: 'Indo pro Papo...',
    gatilhos: ['=papo', 'ir para o papo', 'ir pro papo', 'abrir papo', 'ir para o chat', 'ir pro chat', 'abrir chat']
  },
  {
    arquivo: 'mapa.html',
    fala: 'Indo pro mapa...',
    gatilhos: ['=mapa', 'ir para o mapa', 'ir pro mapa', 'abrir mapa', 'ver mapa', 'ver no mapa']
  }
];

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

    const bateu = destino.gatilhos.some(gatilho => {
      if(gatilho.startsWith('=')) return textoNormalizado === gatilho.slice(1);
      return textoNormalizado.includes(gatilho);
    });

    if(bateu) return { url: destino.arquivo, fala: destino.fala };
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