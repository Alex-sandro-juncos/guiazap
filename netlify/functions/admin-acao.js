// Executa ações de moderação (suspender ou excluir empresa/produto) — só o e-mail admin consegue.

const ADMIN_EMAIL = 'contato@guiazap.shop';
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

exports.handler = async function (event) {
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) {
      return { statusCode: 401, body: JSON.stringify({ error: 'não autenticado' }) };
    }
    const token = authHeader.replace('Bearer ', '');

    const body = JSON.parse(event.body || '{}');
    const { acao, tabela, id } = body;

    if (!['suspender', 'excluir', 'ativar', 'verificar', 'desverificar', 'plano_completo', 'plano_basico', 'plano_premium', 'confirmar_whatsapp_verificacao', 'aprovar_selo', 'rejeitar_selo'].includes(acao) || !['profissionais', 'produtos'].includes(tabela) || !id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'parâmetros inválidos' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` }
    });
    const userData = await userResp.json();

    if (!userData.email || userData.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      return { statusCode: 403, body: JSON.stringify({ error: 'acesso negado' }) };
    }

    if (acao === 'excluir') {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?id=eq.${id}`, {
        method: 'DELETE',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
      });
      if (!resp.ok) return { statusCode: 500, body: JSON.stringify({ error: 'erro ao excluir' }) };
      return { statusCode: 200, body: JSON.stringify({ sucesso: true }) };
    }

    // suspender/ativar = só faz sentido pra "profissionais" (produtos não têm status_pagamento próprio)
    if ((acao === 'suspender' || acao === 'ativar') && tabela === 'profissionais') {
      const novoStatus = acao === 'ativar' ? 'ativo' : 'pendente';
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({ status_pagamento: novoStatus })
      });
      if (!resp.ok) return { statusCode: 500, body: JSON.stringify({ error: 'erro ao atualizar status' }) };

      if (acao === 'ativar') {
        const cadastroResp = await fetch(
          `${SUPABASE_URL}/rest/v1/profissionais?id=eq.${id}&select=name,user_email`,
          { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
        );
        const cadastros = await cadastroResp.json();
        if (cadastros[0] && cadastros[0].user_email) {
          await enviarEmail(
            cadastros[0].user_email,
            'Cadastro ativado — GuiaZap',
            `<p>Olá!</p>
             <p>Seu cadastro "<b>${cadastros[0].name}</b>" no GuiaZap está <b>ativo</b>, aparecendo para todos na busca.</p>
             <p>Acesse <a href="https://guiazap.shop">guiazap.shop</a> pra conferir.</p>
             <p>Qualquer dúvida, fale com a gente: contato@guiazap.shop</p>`
          );
        }
      }

      return { statusCode: 200, body: JSON.stringify({ sucesso: true }) };
    }

    if ((acao === 'verificar' || acao === 'desverificar') && tabela === 'profissionais') {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({ verificado: acao === 'verificar' })
      });
      if (!resp.ok) return { statusCode: 500, body: JSON.stringify({ error: 'erro ao atualizar verificação' }) };
      return { statusCode: 200, body: JSON.stringify({ sucesso: true }) };
    }

    if ((acao === 'plano_completo' || acao === 'plano_basico' || acao === 'plano_premium') && tabela === 'profissionais') {
      const novoPlano = acao === 'plano_completo' ? 'completo' : acao === 'plano_premium' ? 'premium' : 'basico';
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({ plano: novoPlano })
      });
      if (!resp.ok) return { statusCode: 500, body: JSON.stringify({ error: 'erro ao mudar plano' }) };
      return { statusCode: 200, body: JSON.stringify({ sucesso: true }) };
    }

    if (acao === 'confirmar_whatsapp_verificacao' && tabela === 'profissionais') {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({ verificacao_whatsapp_confirmado: true })
      });
      if (!resp.ok) return { statusCode: 500, body: JSON.stringify({ error: 'erro ao confirmar whatsapp' }) };
      return { statusCode: 200, body: JSON.stringify({ sucesso: true }) };
    }

    if (acao === 'aprovar_selo' && tabela === 'profissionais') {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({ verificado: true, verificacao_status: 'aprovado' })
      });
      if (!resp.ok) return { statusCode: 500, body: JSON.stringify({ error: 'erro ao aprovar selo' }) };

      const cadastroResp = await fetch(
        `${SUPABASE_URL}/rest/v1/profissionais?id=eq.${id}&select=name,user_email`,
        { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
      );
      const cadastros = await cadastroResp.json();
      if (cadastros[0] && cadastros[0].user_email) {
        await enviarEmail(
          cadastros[0].user_email,
          'Selo Verificado aprovado — GuiaZap',
          `<p>Olá!</p>
           <p>Seu cadastro "<b>${cadastros[0].name}</b>" agora tem o Selo Verificado ✅ no GuiaZap!</p>
           <p>Acesse <a href="https://guiazap.shop">guiazap.shop</a> pra conferir.</p>`
        );
      }

      return { statusCode: 200, body: JSON.stringify({ sucesso: true }) };
    }

    if (acao === 'rejeitar_selo' && tabela === 'profissionais') {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({ verificacao_status: 'rejeitado' })
      });
      if (!resp.ok) return { statusCode: 500, body: JSON.stringify({ error: 'erro ao rejeitar' }) };
      return { statusCode: 200, body: JSON.stringify({ sucesso: true }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'ação não suportada para essa tabela' }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};