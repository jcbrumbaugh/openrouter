// OpenRouter nodes. The video node is request-spec driven on purpose: model
// slugs and generation endpoints move around, so endpoint/body/polling are
// fields rather than constants. Use the "Models" node to discover live slugs.

import { asText, media } from '../core/types.js';
import { DEFAULT_BASE_URL, chatCompletion, listModels, request, sleep, userMessage } from '../providers/openrouter.js';
import { findMediaUrl, extractChatText, getPath, renderTemplate } from '../util/extract.js';
import { requireKeyFor } from '../providers/keyshapes.js';

const STATUS_DONE = ['succeeded', 'success', 'completed', 'complete', 'done', 'finished', 'ready'];
const STATUS_FAILED = ['failed', 'error', 'errored', 'cancelled', 'canceled', 'rejected'];
const ID_KEYS = ['id', 'task_id', 'taskId', 'request_id', 'requestId', 'job_id', 'jobId', 'generation_id', 'generationId', 'name'];

function findJobId(payload) {
  for (const key of ID_KEYS) {
    const value = payload?.[key] ?? payload?.data?.[key] ?? payload?.result?.[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

function findStatus(payload) {
  const raw = payload?.status ?? payload?.state ?? payload?.data?.status ?? payload?.result?.status;
  return typeof raw === 'string' ? raw.toLowerCase() : null;
}

const baseUrlField = {
  id: 'baseUrl',
  kind: 'text',
  label: 'Base URL',
  placeholder: DEFAULT_BASE_URL,
  advanced: true,
};

export function registerOpenRouterNodes(registry) {
  registry.register({
    type: 'or-models',
    title: 'OpenRouter Models',
    category: 'OpenRouter',
    accent: '#69b7f0',
    hint: 'Lists live model slugs. Filter by "seedance" to find the exact id to use.',
    inputs: [],
    outputs: [
      { id: 'json', label: 'JSON', type: 'json' },
      { id: 'text', label: 'Slugs', type: 'text' },
    ],
    fields: [
      { id: 'credential', kind: 'credential', label: 'API key', provider: 'openrouter' },
      { id: 'filter', kind: 'text', label: 'Filter', placeholder: 'seedance' },
      baseUrlField,
      { id: '_result', kind: 'preview', label: '' },
    ],
    defaults: { credential: '', filter: '', baseUrl: '' },
    cacheable: false,
    async run({ data, signal, keystore, log, setData }) {
      const apiKey = requireKeyFor(keystore, data.credential, 'openrouter');
      log('GET /models');
      const payload = await listModels({ baseUrl: data.baseUrl, apiKey, signal });
      const all = payload?.data ?? [];
      const needle = (data.filter ?? '').trim().toLowerCase();
      const matches = needle
        ? all.filter((m) => `${m.id} ${m.name ?? ''}`.toLowerCase().includes(needle))
        : all;
      const slugs = matches.map((m) => m.id);
      log(`${all.length} models, ${slugs.length} match`);
      setData({ _result: slugs.length ? slugs.join('\n') : '(no matches)' });
      return { json: { data: matches }, text: slugs.join('\n') };
    },
  });

  registry.register({
    type: 'or-chat',
    title: 'OpenRouter Chat',
    category: 'OpenRouter',
    accent: '#7c9cff',
    hint: 'Any text model on OpenRouter. Attach an image for vision models.',
    inputs: [
      { id: 'prompt', label: 'Prompt', type: 'text', required: true },
      { id: 'image', label: 'Image', type: 'image' },
    ],
    outputs: [
      { id: 'text', label: 'Text', type: 'text' },
      { id: 'json', label: 'JSON', type: 'json' },
    ],
    fields: [
      { id: 'credential', kind: 'credential', label: 'API key', provider: 'openrouter' },
      { id: 'model', kind: 'model', label: 'Model', placeholder: 'anthropic/claude-sonnet-4.5' },
      { id: 'system', kind: 'textarea', label: 'System', rows: 2, placeholder: 'optional system prompt' },
      { id: 'temperature', kind: 'number', label: 'Temperature', step: '0.1', min: 0, max: 2 },
      { id: 'maxTokens', kind: 'number', label: 'Max tokens', step: '1', min: 1 },
      baseUrlField,
      { id: '_result', kind: 'preview', label: '' },
    ],
    defaults: {
      credential: '',
      model: 'anthropic/claude-sonnet-4.5',
      system: '',
      temperature: 0.7,
      maxTokens: 1024,
      baseUrl: '',
    },
    cacheable: true,
    async run({ data, inputs, signal, keystore, log, setData }) {
      const apiKey = requireKeyFor(keystore, data.credential, 'openrouter');
      if (!data.model) throw new Error('Pick a model.');
      const messages = [];
      if (data.system?.trim()) messages.push({ role: 'system', content: data.system });
      messages.push(userMessage({ text: asText(inputs.prompt), imageUrl: inputs.image?.url }));

      log(`chat -> ${data.model}`);
      const payload = await chatCompletion({
        baseUrl: data.baseUrl,
        apiKey,
        signal,
        body: {
          model: data.model,
          messages,
          temperature: Number(data.temperature),
          max_tokens: Number(data.maxTokens) || undefined,
        },
      });
      const text = extractChatText(payload);
      const usage = payload?.usage;
      if (usage) log(`tokens: ${usage.prompt_tokens ?? '?'} in / ${usage.completion_tokens ?? '?'} out`);
      setData({ _result: text });
      return { text, json: payload };
    },
  });

  registry.register({
    type: 'or-image',
    title: 'OpenRouter Image',
    category: 'OpenRouter',
    accent: '#f0a868',
    hint: 'Image-output models via /chat/completions with the image modality.',
    inputs: [
      { id: 'prompt', label: 'Prompt', type: 'text', required: true },
      { id: 'image', label: 'Ref image', type: 'image' },
    ],
    outputs: [
      { id: 'image', label: 'Image', type: 'image' },
      { id: 'json', label: 'JSON', type: 'json' },
    ],
    fields: [
      { id: 'credential', kind: 'credential', label: 'API key', provider: 'openrouter' },
      { id: 'model', kind: 'model', label: 'Model', placeholder: 'google/gemini-2.5-flash-image' },
      baseUrlField,
      { id: '_result', kind: 'preview', label: '' },
    ],
    defaults: { credential: '', model: 'google/gemini-2.5-flash-image', baseUrl: '' },
    async run({ data, inputs, signal, keystore, log, setData }) {
      const apiKey = requireKeyFor(keystore, data.credential, 'openrouter');
      log(`image -> ${data.model}`);
      const payload = await chatCompletion({
        baseUrl: data.baseUrl,
        apiKey,
        signal,
        body: {
          model: data.model,
          modalities: ['image', 'text'],
          messages: [userMessage({ text: asText(inputs.prompt), imageUrl: inputs.image?.url })],
        },
      });
      // Preferred shape is choices[0].message.images[].image_url.url; fall back to a scan.
      const direct = getPath(payload, 'choices[0].message.images[0].image_url.url');
      const url = typeof direct === 'string' ? direct : findMediaUrl(payload, 'image')?.url;
      if (!url) {
        throw new Error('No image came back. Check that this model supports image output.');
      }
      const value = media('image', url);
      setData({ _result: value });
      return { image: value, json: payload };
    },
  });

  registry.register({
    type: 'or-video',
    title: 'OpenRouter Video',
    category: 'OpenRouter',
    accent: '#c49bff',
    hint: 'Video through OpenRouter, if your account has a video model. For Seedance, use the Runway Video node.',
    inputs: [
      { id: 'prompt', label: 'Prompt', type: 'text', required: true },
      { id: 'image', label: 'First frame', type: 'image' },
    ],
    outputs: [
      { id: 'video', label: 'Video', type: 'video' },
      { id: 'url', label: 'URL', type: 'text' },
      { id: 'json', label: 'JSON', type: 'json' },
    ],
    fields: [
      { id: '_where', kind: 'info', label: '', text: 'Seedance lives on Runway - use the Runway Video node. This node is for video models hosted on OpenRouter itself.' },
      { id: 'credential', kind: 'credential', label: 'API key', provider: 'openrouter' },
      { id: 'model', kind: 'model', label: 'Model', placeholder: 'bytedance/seedance-2.5' },
      {
        id: 'mode',
        kind: 'select',
        label: 'Call style',
        options: [
          { value: 'generation', label: 'Generation endpoint (submit + poll)' },
          { value: 'chat', label: 'Chat completions' },
          { value: 'custom', label: 'Custom body' },
        ],
      },
      { id: 'duration', kind: 'number', label: 'Seconds', step: '1', min: 1, max: 60 },
      {
        id: 'resolution',
        kind: 'select',
        label: 'Resolution',
        options: [
          { value: '480p', label: '480p' },
          { value: '720p', label: '720p' },
          { value: '1080p', label: '1080p' },
        ],
      },
      {
        id: 'aspectRatio',
        kind: 'select',
        label: 'Aspect',
        options: [
          { value: '16:9', label: '16:9' },
          { value: '9:16', label: '9:16' },
          { value: '1:1', label: '1:1' },
          { value: '4:3', label: '4:3' },
        ],
      },
      { id: 'path', kind: 'text', label: 'Submit path', placeholder: '/videos', advanced: true, hideWhen: { mode: 'chat' } },
      { id: 'pollPath', kind: 'text', label: 'Poll path', placeholder: '/videos/{id}', advanced: true, hideWhen: { mode: 'chat' } },
      {
        id: 'bodyTemplate',
        kind: 'textarea',
        label: 'Body (JSON, {{prompt}} {{image}} {{duration}})',
        rows: 6,
        advanced: true,
        showWhen: { mode: 'custom' },
      },
      { id: 'pollSeconds', kind: 'number', label: 'Poll every (s)', step: '1', min: 1, advanced: true },
      { id: 'timeoutSeconds', kind: 'number', label: 'Give up after (s)', step: '10', min: 10, advanced: true },
      baseUrlField,
      { id: '_result', kind: 'preview', label: '' },
    ],
    defaults: {
      credential: '',
      model: 'bytedance/seedance-2.5',
      mode: 'generation',
      duration: 5,
      resolution: '720p',
      aspectRatio: '16:9',
      path: '/videos',
      pollPath: '/videos/{id}',
      bodyTemplate: '{\n  "model": "bytedance/seedance-2.5",\n  "prompt": "{{prompt}}",\n  "duration": {{duration}}\n}',
      pollSeconds: 5,
      timeoutSeconds: 600,
      baseUrl: '',
    },
    cacheable: true,
    async run({ data, inputs, signal, keystore, log, setStatus, setData }) {
      const apiKey = requireKeyFor(keystore, data.credential, 'openrouter', {
        nodeHint: 'For Seedance, use the Runway Video node - Runway carries it as seedance2_5.',
      });
      const prompt = asText(inputs.prompt);
      const imageUrl = inputs.image?.url;
      if (!prompt.trim()) throw new Error('The prompt is empty.');

      let payload;
      if (data.mode === 'chat') {
        log(`video via chat -> ${data.model}`);
        payload = await chatCompletion({
          baseUrl: data.baseUrl,
          apiKey,
          signal,
          body: {
            model: data.model,
            modalities: ['video', 'text'],
            messages: [userMessage({ text: prompt, imageUrl })],
          },
        });
      } else {
        const body =
          data.mode === 'custom'
            ? parseTemplate(data.bodyTemplate, { prompt, image: imageUrl ?? '', duration: Number(data.duration) || 5 })
            : {
                model: data.model,
                prompt,
                duration: Number(data.duration) || undefined,
                resolution: data.resolution || undefined,
                aspect_ratio: data.aspectRatio || undefined,
                ...(imageUrl ? { image: imageUrl } : {}),
              };
        log(`POST ${data.path || '/videos'} -> ${body.model ?? data.model}`);
        payload = await request({
          baseUrl: data.baseUrl,
          path: data.path || '/videos',
          apiKey,
          method: 'POST',
          body,
          signal,
        });
      }

      let url = findMediaUrl(payload, 'video')?.url ?? null;

      if (!url && data.mode !== 'chat') {
        const jobId = findJobId(payload);
        if (!jobId) {
          throw new Error(
            'The response had no video URL and no job id to poll. Open the JSON output to see what came back, then adjust the paths under Advanced.',
          );
        }
        const pollTemplate = data.pollPath || '/videos/{id}';
        const deadline = Date.now() + (Number(data.timeoutSeconds) || 600) * 1000;
        const every = Math.max(1, Number(data.pollSeconds) || 5) * 1000;
        let attempt = 0;
        log(`job ${jobId} queued, polling`);
        while (!url) {
          if (Date.now() > deadline) throw new Error(`Timed out waiting for job ${jobId}.`);
          await sleep(every, signal);
          attempt += 1;
          setStatus(`polling (${attempt})`);
          payload = await request({
            baseUrl: data.baseUrl,
            path: pollTemplate.replace('{id}', encodeURIComponent(jobId)),
            apiKey,
            method: 'GET',
            signal,
          });
          const status = findStatus(payload);
          if (status) log(`job ${jobId}: ${status}`);
          if (status && STATUS_FAILED.includes(status)) {
            const reason = payload?.error?.message ?? payload?.error ?? payload?.failure_reason ?? status;
            throw new Error(`Generation ${status}: ${asText(reason)}`);
          }
          url = findMediaUrl(payload, 'video')?.url ?? null;
          if (!url && status && STATUS_DONE.includes(status)) {
            throw new Error('The job reported success but no video URL was in the payload.');
          }
        }
      }

      if (!url) {
        throw new Error('No video URL in the response. Check the model slug and call style.');
      }
      const value = media('video', url);
      setData({ _result: value });
      log('video ready');
      return { video: value, url, json: payload };
    },
  });
}

function parseTemplate(template, vars) {
  const rendered = renderTemplate(template, {
    prompt: JSON.stringify(String(vars.prompt)).slice(1, -1),
    image: vars.image,
    duration: vars.duration,
  });
  try {
    return JSON.parse(rendered);
  } catch (err) {
    throw new Error(`Custom body is not valid JSON after substitution: ${err.message}`);
  }
}
