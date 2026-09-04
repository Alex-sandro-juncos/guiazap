function lerAutomaticoPapoAtivo(){
  return localStorage.getItem('papo_ler_automatico') !== '0';
}

function toggleLerAutomaticoPapo(){
  const novo = lerAutomaticoPapoAtivo() ? '0' : '1';
  localStorage.setItem('papo_ler_automatico', novo);
  atualizarBotaoLerAutomaticoPapo();
  if('speechSynthesis' in window){
    speechSynthesis.cancel();
    const fala = new SpeechSynthesisUtterance(novo === '1'
      ? 'Leitura automática ligada. Mensagens novas serão lidas em voz alta.'
      : 'Leitura automática desligada.');
    fala.lang = 'pt-BR';
    speechSynthesis.speak(fala);
  }
}

function atualizarBotaoLerAutomaticoPapo(){
  const btn = document.getElementById('btn-ler-auto-papo');
  if(!btn) return;
  btn.textContent = lerAutomaticoPapoAtivo()
    ? '🔊 Ler mensagens novas: LIGADO'
    : '🔇 Ler mensagens novas: DESLIGADO';
}

function lerMensagemRecebidaSeAtivo(m){
  if(!lerAutomaticoPapoAtivo()) return;
  if(!('speechSynthesis' in window)) return;
  if(!m || m.tipo === 'apagada') return;
  if(typeof currentUserChat !== 'undefined' && currentUserChat && m.remetente_user_id === currentUserChat.id) return;

  let texto = '';
  if(m.tipo === 'texto' && m.texto) texto = m.texto;
  else if(m.tipo === 'audio' && (m.texto || '').trim()) texto = 'Áudio: ' + m.texto;
  else if(m.tipo === 'audio') texto = 'Chegou um áudio. Peça pra pessoa usar o botão de falar texto.';
  else if(m.tipo === 'imagem') texto = 'Chegou uma foto.';
  else if(m.tipo === 'arquivo') texto = 'Chegou um arquivo.';
  else if(m.tipo === 'gif') texto = 'Chegou um GIF.';
  else if(m.tipo === 'sticker') texto = 'Chegou uma figurinha.';
  if(!texto) return;

  speechSynthesis.cancel();
  const nome = (typeof outroLadoNomeAtual !== 'undefined' && outroLadoNomeAtual) ? outroLadoNomeAtual : 'Contato';
  const fala = new SpeechSynthesisUtterance(nome + ' disse: ' + texto);
  fala.lang = 'pt-BR';
  speechSynthesis.speak(fala);
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', atualizarBotaoLerAutomaticoPapo);
} else {
  atualizarBotaoLerAutomaticoPapo();
}
