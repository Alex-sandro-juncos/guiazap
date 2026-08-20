// Roda sozinha uma vez por semana (configurado no netlify.toml).
// Manda um resumo por e-mail pra cada empresa do Pacote Premium: visualizações
// totais do perfil, novos seguidores na semana, avaliações e mensagens recebidas
// na semana, e quantidade de produtos ativos na Vitrine.

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
    const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };

    const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Busca todas as empresas Premium ativas
    const empresasResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profissionais?plano=eq.premium&status_pagamento=eq.ativo&select=id,name,user_email,visualizacoes`,
      { headers }
    );
    const empresas = await empresasResp.json();

    if (!empresas || empresas.length === 0) {
      return { statusCode: 200, body: 'nenhuma empresa Premium pra mandar relatório' };
    }

    let enviadosCount = 0;

    for (const empresa of empresas) {
      if (!empresa.user_email) continue;

      try {
        const [seguidoresResp, avaliacoesResp, mensagensResp, produtosResp] = await Promise.all([
          fetch(`${SUPABASE_URL}/rest/v1/seguidores?profissional_id=eq.${empresa.id}&created_at=gte.${seteDiasAtras}&select=id`, { headers }),
          fetch(`${SUPABASE_URL}/rest/v1/avaliacoes?profissional_id=eq.${empresa.id}&created_at=gte.${seteDiasAtras}&select=id`, { headers }),
          fetch(`${SUPABASE_URL}/rest/v1/mensagens_empresa?profissional_id=eq.${empresa.id}&created_at=gte.${seteDiasAtras}&select=id`, { headers }),
          fetch(`${SUPABASE_URL}/rest/v1/produtos?profissional_id=eq.${empresa.id}&select=id`, { headers })
        ]);

        const novosSeguidores = (await seguidoresResp.json()).length;
        const novasAvaliacoes = (await avaliacoesResp.json()).length;
        const novasMensagens = (await mensagensResp.json()).length;
        const totalProdutos = (await produtosResp.json()).length;

        const html = `
          <p>Olá!</p>
          <p>Aqui está o resumo semanal do seu cadastro <b>${empresa.name}</b> no GuiaZap:</p>
          <ul>
            <li>👁️ <b>${empresa.visualizacoes || 0}</b> visualizações totais no perfil</li>
            <li>👥 <b>${novosSeguidores}</b> novo${novosSeguidores !== 1 ? 's' : ''} seguidor${novosSeguidores !== 1 ? 'es' : ''} essa semana</li>
            <li>⭐ <b>${novasAvaliacoes}</b> avaliaç${novasAvaliacoes !== 1 ? 'ões' : 'ão'} recebida${novasAvaliacoes !== 1 ? 's' : ''} essa semana</li>
            <li>💬 <b>${novasMensagens}</b> mensage${novasMensagens !== 1 ? 'ns' : 'm'} recebida${novasMensagens !== 1 ? 's' : ''} essa semana</li>
            <li>🛍️ <b>${totalProdutos}</b> produto${totalProdutos !== 1 ? 's' : ''} ativo${totalProdutos !== 1 ? 's' : ''} na Vitrine</li>
          </ul>
          <p><a href="https://guiazap.shop">Acessar o GuiaZap</a></p>
          <p style="font-size:0.8em; color:#888;">Esse relatório é um benefício exclusivo do Pacote Premium.</p>
        `;

        await enviarEmail(empresa.user_email, `📊 Seu resumo semanal — ${empresa.name}`, html);
        enviadosCount++;
      } catch (e) {
        console.error(`erro ao montar relatório da empresa ${empresa.id}`, e);
      }
    }

    return { statusCode: 200, body: `relatórios enviados: ${enviadosCount}` };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: 'erro no relatorio semanal: ' + err.message };
  }
};