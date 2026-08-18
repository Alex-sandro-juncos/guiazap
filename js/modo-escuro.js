// Modo escuro — funciona em qualquer página que inclua este arquivo.
// Salva a preferência no navegador, então continua igual na próxima visita.

function aplicarModoEscuro(ativo){
  document.body.classList.toggle('dark-mode', ativo);
  const btn = document.getElementById('btn-modo-escuro');
  if(btn) btn.textContent = ativo ? '☀️ Modo claro' : '🌙 Modo escuro';
}

function toggleModoEscuro(){
  const ativoAgora = !document.body.classList.contains('dark-mode');
  localStorage.setItem('modo_escuro', ativoAgora ? '1' : '0');
  aplicarModoEscuro(ativoAgora);
}

// Aplica assim que a página carrega, antes de qualquer outra coisa
aplicarModoEscuro(localStorage.getItem('modo_escuro') === '1');