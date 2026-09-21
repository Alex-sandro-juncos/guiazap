// Envia notificações push de verdade (aparecem mesmo com o site fechado,
// em quem já ativou e permitiu notificações). Usa a biblioteca "web-push".

const webpush = require('web-push');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

exports.handler = async function (event) {
  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'chaves VAPID não configuradas' }) };
    }

    webpush.setVapidDetails('mailto:contato@guiazap.shop', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const body = JSON.parse(event.body || '{}');
    const { titulo, mensagem, url, userIds, profissionalId, tipo } = body; // userIds: lista de IDs, "todos", ou use profissionalId pra notificar só quem segue essa empresa
    if (!titulo || !mensagem) {
      return { statusCode: 400, body: JSON.stringify({ error: 'título e mensagem são obrigatórios' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };

    // ⚠️ SEGURANÇA: essa function não pedia login NENHUM — qualquer pessoa
    // (sem estar logada) conseguia mandar POST direto aqui e: (a) empurrar
    // notificação push com título/texto inventados pros seguidores de
    // QUALQUER empresa (só sabendo o profissionalId, que é público), (b)
    // mandar push pra QUALQUER lista de userIds que quisesse adivinhar, ou
    // (c) no caso mais grave, mandar `userIds: "todos"` e disparar pra
    // TODO MUNDO cadastrado no GuiaZap de uma vez — sem limite nenhum.
    // Outras functions internas (lembretes, notificação de mensagem nova,
    // pedido pago) já chamam essa aqui server-a-server, então elas
    // continuam funcionando: só passam a mandar o header também, mas o
    // segredo interno já cobre esse caso. Chamadas vindas direto do
    // navegador (Vitrine, Vagas, Chat, Pedidos) agora precisam estar
    // logadas de verdade.
    const segredoInterno = event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'];
    const chamadaInterna = !!(process.env.INTERNAL_FUNCTIONS_SECRET && segredoInterno === process.env.INTERNAL_FUNCTIONS_SECRET);

    let usuarioChamador = null;
    if (!chamadaInterna) {
      const tokenChamador = (event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '');
      if (!tokenChamador) {
        return { statusCode: 401, body: JSON.stringify({ error: 'não autenticado' }) };
      }
      const usuarioResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${tokenChamador}` }
      });
      if (!usuarioResp.ok) {
        return { statusCode: 401, body: JSON.stringify({ error: 'sessão inválida ou expirada' }) };
      }
      usuarioChamador = await usuarioResp.json();
    }

    let filtroUrl = `${SUPABASE_URL}/rest/v1/push_subscriptions?select=*`;

    if (profissionalId) {
      // Notificar seguidores de uma empresa: só o DONO dela pode disparar
      // (a chamada interna do servidor não usa esse caminho hoje, mas
      // segue liberada porque já é confiável por definição).
      if (!chamadaInterna) {
        const empresaResp = await fetch(
          `${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&user_id=eq.${usuarioChamador.id}&select=id`,
          { headers }
        );
        const empresas = await empresaResp.json();
        if (!empresas || !empresas[0]) {
          return { statusCode: 403, body: JSON.stringify({ error: 'essa empresa não é sua' }) };
        }
      }
      // Busca só quem segue essa empresa específica
      const seguidoresResp = await fetch(
        `${SUPABASE_URL}/rest/v1/seguidores?profissional_id=eq.${profissionalId}&select=user_id`,
        { headers }
      );
      const seguidores = await seguidoresResp.json();
      const idsSeguidores = (seguidores || []).map(s => s.user_id);
      if (idsSeguidores.length === 0) {
        return { statusCode: 200, body: JSON.stringify({ enviados: 0, motivo: 'sem seguidores' }) };
      }
      filtroUrl += `&user_id=in.(${idsSeguidores.join(',')})`;
    } else if (userIds && userIds !== 'todos' && Array.isArray(userIds) && userIds.length > 0) {
      filtroUrl += `&user_id=in.(${userIds.join(',')})`;
    } else if (userIds === 'todos' && !chamadaInterna) {
      // Broadcast pra TODO MUNDO — exigir login já tira o anonimato, mas
      // sozinho não impede um usuário de verdade de repetir isso um monte
      // de vezes e encher a caixa de notificação de todo mundo. Trava um
      // limite baixo por pessoa (3 por dia) — dá pra publicar vaga
      // normalmente, mas não dá pra usar isso como canal de spam.
      const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const usosRespo = await fetch(
        `${SUPABASE_URL}/rest/v1/broadcast_todos_registro?user_id=eq.${usuarioChamador.id}&created_at=gte.${desde}&select=id`,
        { headers }
      );
      const usosHoje = usosRespo.ok ? await usosRespo.json() : [];
      if (usosHoje.length >= 3) {
        return { statusCode: 429, body: JSON.stringify({ error: 'Limite de avisos pra todo mundo atingido por hoje (3). Tenta de novo amanhã.' }) };
      }
      await fetch(`${SUPABASE_URL}/rest/v1/broadcast_todos_registro`, {
        method: 'POST', headers, body: JSON.stringify({ user_id: usuarioChamador.id })
      });
    }

    const resp = await fetch(filtroUrl, { headers });
    const inscricoes = await resp.json();

    if (!inscricoes || inscricoes.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ enviados: 0, motivo: 'sem inscrições' }) };
    }

    let enviados = 0;
    for (const inscricao of inscricoes) {
      const pushSubscription = {
        endpoint: inscricao.endpoint,
        keys: { p256dh: inscricao.p256dh, auth: inscricao.auth }
      };
      const payload = JSON.stringify({ title: titulo, body: mensagem, url: url || '/', tipo: tipo || null });

      try {
        // Chamadas pedem urgência alta — isso ajuda o sistema de notificação
        // (FCM, por trás do Chrome) a tentar furar o modo Doze/economia de
        // energia do Android, que às vezes atrasa notificações comuns.
        const opcoesEnvio = tipo === 'chamada' ? { urgency: 'high', TTL: 30 } : { TTL: 300 };
        await webpush.sendNotification(pushSubscription, payload, opcoesEnvio);
        enviados++;
      } catch (err) {
        // Se a inscrição não existe mais (usuário desinstalou, etc), remove do banco
        if (err.statusCode === 404 || err.statusCode === 410) {
          await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${inscricao.id}`, {
            method: 'DELETE',
            headers
          });
        } else {
          console.error('erro ao enviar push', err);
        }
      }
    }

    return { statusCode: 200, body: JSON.stringify({ enviados }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};