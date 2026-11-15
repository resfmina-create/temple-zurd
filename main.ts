import * as http from 'http';

// --- 1. MODEL & PROVIDER CATALOG SIMULATION ---
interface ModelDef {
  id: string;
  provider: string;
  free: boolean;
  capabilities: { chat: boolean; coding: boolean; speed: number }; // speed: 1-10
  available: boolean;
}

const SIMULATED_PROVIDERS = [
  { name: 'Provider-Alpha', models: [{ id: 'alpha-chat-v1', free: true, capabilities: { chat: true, coding: true, speed: 8 }, available: true }] },
  { name: 'Provider-Beta', models: [{ id: 'beta-fast-7b', free: true, capabilities: { chat: true, coding: false, speed: 10 }, available: true }] },
  { name: 'Provider-Gamma', models: [{ id: 'gamma-coder-code', free: true, capabilities: { chat: false, coding: true, speed: 6 }, available: true }] },
  { name: 'Provider-Delta', models: [{ id: 'delta-free-mini', free: true, capabilities: { chat: true, coding: true, speed: 7 }, available: true }] },
  { name: 'Provider-Epsilon', models: [{ id: 'epsilon-base', free: true, capabilities: { chat: true, coding: false, speed: 5 }, available: false }] }, // Unavailable
  { name: 'Provider-Zeta', models: [{ id: 'zeta-ultra-free', free: true, capabilities: { chat: true, coding: true, speed: 9 }, available: true }] },
  { name: 'Provider-Eta', models: [{ id: 'eta-basic', free: true, capabilities: { chat: true, coding: false, speed: 4 }, available: true }] },
  { name: 'Provider-Theta', models: [{ id: 'theta-code-pro', free: true, capabilities: { chat: false, coding: true, speed: 8 }, available: true }] },
  { name: 'Provider-Iota', models: [{ id: 'iota-lite', free: true, capabilities: { chat: true, coding: true, speed: 7 }, available: true }] },
  { name: 'Provider-Kappa', models: [{ id: 'kappa-free-max', free: true, capabilities: { chat: true, coding: true, speed: 9 }, available: true }] },
];

// Catalog Discovery at startup
function discoverCatalog(): ModelDef[] {
  const catalog: ModelDef[] = [];
  for (const p of SIMULATED_PROVIDERS) {
    for (const m of p.models) {
      catalog.push({
        id: m.id,
        provider: p.name,
        free: m.free,
        capabilities: m.capabilities,
        available: m.available,
      });
    }
  }
  return catalog;
}

const catalog = discoverCatalog();

// --- 2. ROUTING & FAILOVER LOGIC ---
function selectBestModels(requiresCoding: boolean): ModelDef[] {
  const freeModels = catalog.filter(m => m.free && m.available);
  const capable = freeModels.filter(m => !requiresCoding || m.capabilities.coding);
  return capable.sort((a, b) => b.capabilities.speed - a.capabilities.speed);
}

function invokeProvider(modelId: string, requestPayload: any, attemptToken: string): { success: boolean; response?: any; error?: string } {
  const hash = (attemptToken + modelId).split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  if (hash % 5 === 0) {
    return { success: false, error: `Provider refused request for model ${modelId} (Rate limit / Overloaded)` };
  }
  return {
    success: true,
    response: {
      id: `resp-${Date.now()}`,
      model: modelId,
      choices: [{ message: { role: 'assistant', content: `Processed successfully by ${modelId}` }, finish_reason: 'stop' }],
      content: [{ type: 'text', text: `Processed successfully by ${modelId}` }]
    }
  };
}

function handleRequestWithFailover(requiresCoding: boolean, payload: any, format: 'openai' | 'anthropic') {
  const sortedModels = selectBestModels(requiresCoding);
  let lastError = '';

  for (let i = 0; i < sortedModels.length; i++) {
    const model = sortedModels[i];
    const attemptToken = `${JSON.stringify(payload)}-${i}`;
    const result = invokeProvider(model.id, payload, attemptToken);

    if (result.success) {
      if (format === 'openai') {
        return {
          id: result.response.id,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: model.id,
          choices: [{ index: 0, message: result.response.choices[0].message, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
        };
      } else {
        return {
          id: result.response.id,
          type: 'message',
          role: 'assistant',
          content: result.response.content,
          model: model.id,
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 10 }
        };
      }
    } else {
      lastError = result.error || 'Unknown refusal';
    }
  }

  throw new Error(`All fallback providers exhausted. Last error: ${lastError}`);
}

// --- 3. HTTP SERVER SETUP ---
const server = http.createServer(async (req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const url = req.url || '';

    if (url === '/catalog' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ catalog_discovered: catalog, total_providers: SIMULATED_PROVIDERS.length }, null, 2));
      return;
    }

    if (url === '/v1/chat/completions' && req.method === 'POST') {
      try {
        const payload = JSON.parse(body || '{}');
        const promptText = JSON.stringify(payload);
        const requiresCoding = promptText.toLowerCase().includes('code') || promptText.toLowerCase().includes('function');
        const response = handleRequestWithFailover(requiresCoding, payload, 'openai');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (url === '/v1/messages' && req.method === 'POST') {
      try {
        const payload = JSON.parse(body || '{}');
        const promptText = JSON.stringify(payload);
        const requiresCoding = promptText.toLowerCase().includes('code') || promptText.toLowerCase().includes('function');
        const response = handleRequestWithFailover(requiresCoding, payload, 'anthropic');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
});
