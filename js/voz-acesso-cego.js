// Antes, isso mostrava uma tela cheia e FALAVA em voz alta toda vez que
// qualquer página abria, a não ser que a pessoa já tivesse ativado a voz
// alguma vez (nesse caso, ativava sozinha pra sempre, sem pedir nada).
// Isso incomodava muita gente que não queria usar comando de voz.
//
// Agora ficou neutro: a voz só liga em duas situações:
//   1) a pessoa toca no botão de microfone (já existe em cada página)
//   2) a pessoa estava usando o modo voz e pediu pra ir pra outra página
//      (aí é justo continuar ouvindo, porque foi um pedido dela mesma)
// Fora isso, nada aparece e nada fala sozinho.

function prepararAcessoVozCego(iniciarFn){
  const retomar = localStorage.getItem('retomarModoVozAoCarregar') === '1';
  if(!retomar) return;

  localStorage.removeItem('retomarModoVozAoCarregar');
  if(typeof iniciarFn === 'function'){
    setTimeout(iniciarFn, 800);
  }
}