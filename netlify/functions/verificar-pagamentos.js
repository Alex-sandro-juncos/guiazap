// Roda sozinha de hora em hora (configurado no netlify.toml).
// Verifica se algum cadastro "pendente" já tem assinatura aprovada no Mercado Pago
// que o webhook, por algum motivo, não avisou — e ativa automaticamente.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_REMETENTE = 'GuiaZap <contato@guiazap.shop>';

async function enviarEmail(destinatario, assunto, html){
  if(!RESEND_API_KEY || !destinatario) return;
  try{
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: EMAIL_REMETENTE, to: [destinatario], subject: assunto, html })
    });
  } catch(e){
    console.error('erro ao enviar e-mail', e);
  }
}

exports.handler = async function () {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

    // 1. Busca todos os cadastros pendentes que têm e-mail (candidatos a checar)
    const pendentesResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profissionais?status_pagamento=eq.pendente&user_email=not.is.null&select=id,name,user_email,plano`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    const pendentes = await pendentesResp.json();

    if (!pendentes || pendentes.length === 0) {
      return { statusCode: 200, body: 'nenhum cadastro pendente pra checar' };
    }

    let ativadosCount = 0;

    for (const cadastro of pendentes) {
      try {
        // 2. Checa no Mercado Pago se esse e-mail tem assinatura aprovada
        const searchResp = await fetch(
          `https://api.mercadopago.com/preapproval/search?payer_email=${encodeURIComponent(cadastro.user_email)}&status=authorized&limit=1`,
          { headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } }
        );
        const searchData = await searchResp.json();
        const assinatura = searchData.results && searchData.results[0];

        if (!assinatura) continue; // sem assinatura aprovada pra esse e-mail, pula pro próximo

        // 3. Encontrou! Ativa o cadastro (mantém o plano que já estava escolhido)
        await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${cadastro.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
          },
          body: JSON.stringify({ status_pagamento: 'ativo' })
        });

        await enviarEmail(
          cadastro.user_email,
          'Pagamento confirmado — cadastro ativo no GuiaZap!',
          `<p>Olá!</p>
           <p>Seu pagamento foi confirmado e seu cadastro "<b>${cadastro.name}</b>" no GuiaZap já está <b>ativo</b>, aparecendo para todos na busca.</p>
           <p>Acesse <a href="https://guiazap.shop">guiazap.shop</a> pra ver seu cadastro no ar.</p>`
        );

        ativadosCount++;
      } catch (e) {
        console.error(`erro ao checar/ativar cadastro ${cadastro.id}`, e);
      }
    }

    return { statusCode: 200, body: `checados: ${pendentes.length}, ativados: ${ativadosCount}` };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: 'erro na verificacao automatica: ' + err.message };
  }
};