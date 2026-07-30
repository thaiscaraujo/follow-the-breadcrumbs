// Bastidores: guarda e devolve os dados da usuária na nuvem (sincroniza PC <-> celular).
// A "chave" é o código pessoal dela. Sem código, não faz nada.
import { getStore } from '@netlify/blobs';

function chave(codigo) {
  return 'u_' + String(codigo || '').trim().toLowerCase();
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

export default async (req) => {
  let store;
  try {
    store = getStore('breadcrumb-dados');
  } catch (e) {
    return json({ erro: 'armazenamento indisponivel' }, 500);
  }

  const url = new URL(req.url);

  if (req.method === 'GET') {
    const codigo = url.searchParams.get('codigo');
    if (!codigo) return json({ erro: 'codigo faltando' }, 400);
    try {
      const data = await store.get(chave(codigo), { type: 'json' });
      return json({ estado: data || null });
    } catch (e) {
      return json({ erro: 'falha ao ler' }, 500);
    }
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch (e) { body = null; }
    if (!body || !body.codigo) return json({ erro: 'codigo faltando' }, 400);
    try {
      await store.setJSON(chave(body.codigo), body.estado ?? {});
      return json({ ok: true });
    } catch (e) {
      return json({ erro: 'falha ao salvar' }, 500);
    }
  }

  return json({ erro: 'metodo nao suportado' }, 405);
};
