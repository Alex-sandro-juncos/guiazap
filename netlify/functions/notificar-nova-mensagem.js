// Avisa por notificação push (e por e-mail, como reserva) quando alguém
// manda uma mensagem nova no chat interno, pro OUTRO participante da conversa
// (não pra quem acabou de mandar).

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_REMETENTE = 'GuiaZap <contato@guiazap.shop>';

exports.handler = async function (event) {
  try {
    const body = JSON.parse(event.body || '{}');
    const { conversaId, remetenteUserId, texto } = body;
    if (!conversaId || !remetenteUserId || !texto) {
      return { statusCode: 400, body: JSON.stringify({ error: 'dados incompletos' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };

    // Descobre quem são os dois participantes dessa conversa (sem embed —
    // relação conversas↔profissionais dá erro 400 quando combinada assim)
    const conversaResp = await fetch(
      `${SUPABASE_URL}/rest/v1/conversas?id=eq.${conversaId}&select=visitante_user_id,profissional_id,usuario2_id,silenciada_por_visitante,silenciada_por_empresa`,
      { headers }
    );
    const conversas = await conversaResp.json();
    const conversa = conversas[0];
    if (!conversa) {
      return { statusCode: 200, body: JSON.stringify({ enviado: false, motivo: 'conversa não encontrada' }) };
    }

    let empresa = null;
    if (conversa.profissional_id) {
      const empresaResp = await fetch(
        `${SUPABASE_URL}/rest/v1/profissionais?id=eq.${conversa.profissional_id}&select=name,user_id`,
        { headers }
      );
      const empresas = await empresaResp.json();
      empresa = empresas[0] || null;
    }

    let destinatarioUserId;
    let nomeRemetente;
    let destinatarioSilenciou;

    if (conversa.usuario2_id) {
      // Conversa entre duas pessoas (não é com empresa)
      if (remetenteUserId === conversa.visitante_user_id) {
        destinatarioUserId = conversa.usuario2_id;
        destinatarioSilenciou = conversa.silenciada_por_empresa; // reaproveita essa coluna pro "segundo" participante
      } else {
        destinatarioUserId = conversa.visitante_user_id;
        destinatarioSilenciou = conversa.silenciada_por_visitante;
      }

      const remetenteResp = await fetch(`${SUPABASE_URL}/rest/v1/perfis_usuario?user_id=eq.${remetenteUserId}&select=nome_exibicao`, { headers });
      const remetentePerfil = await remetenteResp.json();
      nomeRemetente = (remetentePerfil[0] && remetentePerfil[0].nome_exibicao) || 'Um contato do GuiaZap';
    } else {
      const donoEmpresaUserId = empresa ? empresa.user_id : null;
      const nomeEmpresa = empresa ? empresa.name : 'Empresa';

      if (remetenteUserId === conversa.visitante_user_id) {
        destinatarioUserId = donoEmpresaUserId;
        nomeRemetente = 'Um visitante';
        destinatarioSilenciou = conversa.silenciada_por_empresa;
      } else {
        destinatarioUserId = conversa.visitante_user_id;
        nomeRemetente = nomeEmpresa;
        destinatarioSilenciou = conversa.silenciada_por_visitante;
      }
    }

    if (!destinatarioUserId) {
      return { statusCode: 200, body: JSON.stringify({ enviado: false, motivo: 'destinatário não encontrado' }) };
    }

    if (destinatarioSilenciou) {
      return { statusCode: 200, body: JSON.stringify({ enviado: false, motivo: 'destinatário silenciou essa conversa' }) };
    }

    // Manda a notificação push (reaproveita a função que já existe)
    await fetch(`${process.env.URL || 'https://guiazap.shop'}/.netlify/functions/enviar-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titulo: `💬 Nova mensagem de ${nomeRemetente}`,
        mensagem: texto.slice(0, 100),
        url: '/chat.html',
        userIds: [destinatarioUserId],
        tipo: 'mensagem'
      })
    });

    return { statusCode: 200, body: JSON.stringify({ enviado: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};