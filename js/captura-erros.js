// Captura erros de JavaScript que acontecem de verdade no navegador das
// pessoas usando o site, e manda pra registrar — sem isso, um bug só é
// descoberto quando alguém manda print. Não trava nada, não aparece nada
// na tela pra quem está usando (é só um registro silencioso).

(function(){
  let _ultimoErroEnviado = null;
  let _ultimoEnvioEm = 0;

  function registrarErro(mensagem, stack){
    // Evita mandar o MESMO erro repetido em sequência muito rápida (ex: um
    // erro que dispara em loop) — no máximo um a cada 5 segundos por tipo
    const agora = Date.now();
    if(mensagem === _ultimoErroEnviado && (agora - _ultimoEnvioEm) < 5000) return;
    _ultimoErroEnviado = mensagem;
    _ultimoEnvioEm = agora;

    let userId = null;
    try{
      // Tenta achar o id do usuário logado em qualquer client Supabase que
      // a página tiver — sem travar se não achar nenhum
      const candidatos = ['supabaseClientChat', 'supabaseClientV', 'supabaseClient', 'supabaseClientFrete', 'supabaseClientCorridas', 'currentUser', 'currentUserChat'];
      for(const nome of candidatos){
        if(window[nome] && window[nome].id){ userId = window[nome].id; break; }
      }
    } catch(e){}

    fetch('/.netlify/functions/registrar-erro-frontend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pagina: window.location.pathname,
        mensagem: String(mensagem || 'erro sem mensagem').slice(0, 2000),
        stack: stack ? String(stack).slice(0, 4000) : null,
        userId
      })
    }).catch(() => {}); // se nem isso funcionar, desiste em silêncio
  }

  window.addEventListener('error', function(event){
    registrarErro(event.message, event.error ? event.error.stack : null);
  });

  window.addEventListener('unhandledrejection', function(event){
    const razao = event.reason;
    registrarErro(
      razao && razao.message ? razao.message : String(razao),
      razao && razao.stack ? razao.stack : null
    );
  });
})();