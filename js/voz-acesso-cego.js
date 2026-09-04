// Primeiro toque em qualquer lugar liga o modo voz.
// Sem isso o Chrome bloqueia o microfone e o cego não acha o botão.

function _criarOverlayVozCego(onAtivar){
  if(document.getElementById('overlay-voz-cego')) return;

  const box = document.createElement('div');
  box.id = 'overlay-voz-cego';
  box.setAttribute('role', 'button');
  box.setAttribute('aria-label', 'Toque em qualquer lugar da tela para ativar o modo voz');
  box.tabIndex = 0;
  box.style.cssText = 'position:fixed;inset:0;z-index:4000;background:rgba(10,20,16,0.94);color:white;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px;text-align:center;cursor:pointer;';
  box.innerHTML = `
    <div style="font-size:3rem;margin-bottom:12px;">🎙️</div>
    <div style="font-size:1.35rem;font-weight:800;line-height:1.3;">Toque em qualquer lugar<br>para ativar o modo voz</div>
    <div style="margin-top:14px;font-size:0.95rem;opacity:0.9;max-width:320px;line-height:1.45;">
      Feito pra quem não enxerga. Depois de um toque, é só falar.
    </div>
  `;

  const ativar = () => {
    box.remove();
    localStorage.setItem('guiazap_quer_voz', '1');
    if(typeof onAtivar === 'function') onAtivar();
  };

  box.addEventListener('click', ativar);
  box.addEventListener('keydown', (e) => {
    if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); ativar(); }
  });
  document.body.appendChild(box);
  setTimeout(() => { try{ box.focus(); } catch(e){} }, 200);

  if('speechSynthesis' in window){
    try{
      speechSynthesis.cancel();
      const fala = new SpeechSynthesisUtterance('Toque em qualquer lugar da tela para ativar o modo voz.');
      fala.lang = 'pt-BR';
      speechSynthesis.speak(fala);
    } catch(e){}
  }
}

function prepararAcessoVozCego(iniciarFn){
  const quer = localStorage.getItem('guiazap_quer_voz') === '1';
  const retomar = localStorage.getItem('retomarModoVozAoCarregar') === '1';

  const tentarAuto = () => {
    if(typeof iniciarFn === 'function') iniciarFn();
  };

  if(quer || retomar){
    localStorage.removeItem('retomarModoVozAoCarregar');
    setTimeout(tentarAuto, 800);
    // Se o navegador bloquear sem gesto, o overlay aparece depois
    setTimeout(() => {
      const jaOn = window._vozIndexAtiva || window._vozPapoAtiva || window._vozVitrineAtiva;
      if(!jaOn) _criarOverlayVozCego(tentarAuto);
    }, 2500);
    return;
  }

  _criarOverlayVozCego(tentarAuto);
}
