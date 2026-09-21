// Lê PIN_PEPPER_SECRET das variáveis de ambiente do Netlify e RECUSA
// funcionar se não estiver configurado (ou for curto demais).
//
// ANTES, todo lugar que usava o pepper fazia
// `process.env.PIN_PEPPER_SECRET || ''` — se a variável não estivesse
// configurada no Netlify (esquecimento em um novo deploy, por exemplo),
// a function continuava funcionando normalmente, só que com o pepper
// vazio. Nesse caso o hash de um PIN de 4 a 6 dígitos vira
// SHA256(':pin:' + pin + ':' + userId) — um padrão totalmente previsível,
// com no máximo 1 milhão de combinações. Se o banco vazar algum dia,
// qualquer PIN nessa condição é quebrado offline em segundos.
//
// Com esse arquivo, se o pepper não estiver configurado a function
// recusa a operação (erro 500 com log claro no Netlify) em vez de
// silenciosamente rodar insegura. Configure PIN_PEPPER_SECRET no Netlify
// (Site settings > Environment variables) com uma string aleatória de
// pelo menos 32 caracteres — por exemplo, gerada com `openssl rand -hex 32`
// no terminal.
function exigirPepper() {
  const pepper = process.env.PIN_PEPPER_SECRET;
  if (!pepper || pepper.length < 16) {
    throw new Error(
      'PIN_PEPPER_SECRET não configurado (ou curto demais) nas variáveis de ambiente do Netlify — configure antes de usar PIN, código de acesso do PDV ou senha gerencial.'
    );
  }
  return pepper;
}

module.exports = { exigirPepper };