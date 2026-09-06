// Console de depuração (Eruda) — só aparece no SEU aparelho, nunca pros
// seus clientes/visitantes.
//
// Como ativar num aparelho (uma vez só): abre qualquer página do site
// adicionando ?ativar_debug=1 no final do endereço, por exemplo:
//   https://guiazap.shop/index.html?ativar_debug=1
// Depois disso, o console vai aparecer sozinho nesse mesmo aparelho/
// navegador em QUALQUER página do site, sem precisar repetir o link.
//
// Como desativar num aparelho: abre com ?desativar_debug=1

(function(){
  const params = new URLSearchParams(window.location.search);

  if(params.get('desativar_debug') === '1'){
    localStorage.removeItem('guiazap_debug_ativo');
    return;
  }

  if(params.get('ativar_debug') === '1'){
    localStorage.setItem('guiazap_debug_ativo', '1');
  }

  if(localStorage.getItem('guiazap_debug_ativo') === '1'){
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/eruda';
    document.body.appendChild(s);
    s.onload = function(){ eruda.init(); };
  }
})();