// Bastidores: usa a IA (Google Gemini) para transformar um item bagunçado da Entrada
// em uma ou mais SESSÕES prontas (com critério de conclusão, "não faz parte", passos, etc).
// A chave do Gemini fica só aqui no servidor, nunca aparece para o navegador.

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

const SCHEMA = {
  type: 'object',
  properties: {
    sessoes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          titulo: { type: 'string' },
          area: { type: 'string' },
          criterioConclusao: { type: 'string' },
          naoFazParte: { type: 'string' },
          passos: { type: 'array', items: { type: 'string' } },
          tempoEstimadoMin: { type: 'integer' },
          energiaMin: { type: 'string', enum: ['baixa', 'media', 'alta'] },
          cognicaoMin: { type: 'string', enum: ['baixa', 'media', 'alta'] },
          impacto: { type: 'string', enum: ['baixo', 'medio', 'alto'] }
        },
        required: ['titulo', 'area', 'criterioConclusao', 'passos', 'tempoEstimadoMin', 'energiaMin', 'cognicaoMin', 'impacto']
      }
    }
  },
  required: ['sessoes']
};

const INSTRUCAO = `Você ajuda uma pessoa com dificuldade de função executiva (TDAH) a sair da análise e entrar em ação.
Recebe um item solto e bagunçado que ela precisa fazer. Sua tarefa: transformá-lo em UMA OU MAIS sessões executáveis.

Regras:
- Uma "sessão" é um bloco curto com fim claro (poucos minutos a ~45 min). Se o item é grande, quebre em várias sessões pequenas, na ordem de execução.
- "passos": 2 a 5 ações concretas e literais, no imperativo, começando por um verbo. Nada de reflexão ("pensar sobre", "analisar", "entender") — só ação física/observável.
- "criterioConclusao": responda "como sei que posso parar?" de forma objetiva e verificável.
- "naoFazParte": liste o que NÃO deve ser feito nesta sessão para evitar expansão de escopo (ou string vazia se não se aplica).
- "area": uma palavra como Trabalho, Casa, Saúde, Pessoal, Estudos, Finanças.
- "tempoEstimadoMin": realista (5, 10, 15, 25, 45).
- "energiaMin" e "cognicaoMin": o mínimo necessário (baixa/media/alta). Tarefas mecânicas = baixa; tarefas que exigem foco/decisão = alta.
- "impacto": baixo/medio/alto conforme a importância.
- Escreva tudo em português simples e acolhedor.
Responda SOMENTE no formato JSON pedido.`;

export default async (req) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json({ erro: 'sem_chave', mensagem: 'Chave da IA não configurada.' }, 503);

  if (req.method !== 'POST') return json({ erro: 'metodo nao suportado' }, 405);

  let body;
  try { body = await req.json(); } catch (e) { body = null; }
  const texto = body && typeof body.texto === 'string' ? body.texto.trim() : '';
  if (!texto) return json({ erro: 'texto faltando' }, 400);

  const model = 'gemini-2.0-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payload = {
    systemInstruction: { parts: [{ text: INSTRUCAO }] },
    contents: [{ role: 'user', parts: [{ text: `Item da Entrada: "${texto}"` }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: 'application/json',
      responseSchema: SCHEMA
    }
  };

  let resp;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    return json({ erro: 'falha_rede', mensagem: 'Não consegui falar com a IA.' }, 502);
  }

  if (!resp.ok) {
    const detalhe = await resp.text().catch(() => '');
    return json({ erro: 'falha_ia', status: resp.status, detalhe: detalhe.slice(0, 500) }, 502);
  }

  let data;
  try { data = await resp.json(); } catch (e) { return json({ erro: 'resposta_invalida' }, 502); }

  const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!txt) return json({ erro: 'resposta_vazia' }, 502);

  let parsed;
  try { parsed = JSON.parse(txt); } catch (e) { return json({ erro: 'json_invalido', bruto: txt.slice(0, 500) }, 502); }

  const sessoes = Array.isArray(parsed.sessoes) ? parsed.sessoes : [];
  if (!sessoes.length) return json({ erro: 'sem_sessoes' }, 502);

  return json({ sessoes });
};
