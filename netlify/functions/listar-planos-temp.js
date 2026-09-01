// FERRAMENTA TEMPORÁRIA — lista todos os planos de assinatura cadastrados
// no Mercado Pago, com nome e ID de cada um. Depois de usar pra achar o
// MP_PLANO_ID_ENTREGADOR, pode apagar esse arquivo (não é usado por
// nenhuma outra parte do site).

exports.handler = async function () {
  try {
    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

    const resp = await fetch('https://api.mercadopago.com/preapproval_plan/search?status=active', {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
    });
    const data = await resp.json();

    const lista = (data.results || []).map(p => ({
      nome: p.reason,
      id: p.id,
      valor: p.auto_recurring ? p.auto_recurring.transaction_amount : null
    }));

    // Devolve como texto simples, fácil de ler no navegador
    const texto = lista.map(p => `Nome: ${p.nome}\nID: ${p.id}\nValor: R$${p.valor}\n---`).join('\n');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: texto || 'Nenhum plano encontrado.'
    };
  } catch (err) {
    return { statusCode: 500, body: 'Erro: ' + err.message };
  }
};