// Runway: image -> video. Runway routes third-party models, so Seedance 2.5 is
// reachable here as model "seedance2_5".

import { asText, media } from '../core/types.js';
import { sleep } from '../util/media.js';
import { requireKeyFor } from '../providers/keyshapes.js';
import {
  DEFAULT_RUNWAY_BASE,
  RUNWAY_BAD,
  RUNWAY_DONE,
  RUNWAY_RATIOS,
  RUNWAY_VIDEO_MODELS,
  createImageToVideo,
  getTask,
} from '../providers/runway.js';

export function registerRunwayNodes(registry) {
  registry.register({
    type: 'runway-video',
    title: 'Runway Video',
    category: 'Runway',
    accent: '#c49bff',
    hint: 'Image-to-video through Runway, including Seedance 2.5.',
    inputs: [
      { id: 'image', label: 'Image', type: 'image', required: true },
      { id: 'prompt', label: 'Prompt', type: 'text' },
    ],
    outputs: [
      { id: 'video', label: 'Video', type: 'video' },
      { id: 'url', label: 'URL', type: 'text' },
      { id: 'json', label: 'JSON', type: 'json' },
    ],
    fields: [
      { id: 'credential', kind: 'credential', label: 'Runway key', provider: 'runway' },
      { id: 'model', kind: 'select', label: 'Model', options: RUNWAY_VIDEO_MODELS },
      { id: 'ratio', kind: 'select', label: 'Ratio', options: RUNWAY_RATIOS },
      {
        id: 'duration',
        kind: 'select',
        label: 'Duration',
        options: [
          { value: '4', label: '4 seconds' },
          { value: '6', label: '6 seconds' },
          { value: '8', label: '8 seconds' },
        ],
      },
      { id: 'seed', kind: 'number', label: 'Seed (0 = random)', step: '1', min: 0, advanced: true },
      { id: 'baseUrl', kind: 'text', label: 'Base URL', placeholder: DEFAULT_RUNWAY_BASE, advanced: true },
      { id: 'pollSeconds', kind: 'number', label: 'Poll every (s)', step: '1', min: 1, advanced: true },
      { id: 'timeoutSeconds', kind: 'number', label: 'Give up after (s)', step: '30', min: 30, advanced: true },
      { id: '_result', kind: 'preview', label: '' },
    ],
    defaults: {
      credential: '',
      model: 'seedance2_5',
      ratio: '1280:720',
      duration: '4',
      seed: 0,
      baseUrl: DEFAULT_RUNWAY_BASE,
      pollSeconds: 5,
      timeoutSeconds: 900,
    },
    async run({ data, inputs, signal, keystore, log, setStatus, setData }) {
      const apiKey = requireKeyFor(keystore, data.credential, 'runway');
      const baseUrl = data.baseUrl || DEFAULT_RUNWAY_BASE;
      const promptImage = inputs.image?.url;
      if (!promptImage) throw new Error('Connect an image to drive the video.');
      if (promptImage.startsWith('blob:')) {
        throw new Error('Runway needs a public URL or a data URL; this image only exists inside this page.');
      }

      const body = {
        model: data.model,
        promptImage,
        ratio: data.ratio,
        duration: Number(data.duration) || 4,
      };
      const promptText = asText(inputs.prompt).trim();
      if (promptText) body.promptText = promptText.slice(0, 1000);
      if (Number(data.seed) > 0) body.seed = Number(data.seed);

      log(`POST /v1/image_to_video (${data.model})`);
      const taskId = await createImageToVideo({ baseUrl, apiKey, body, signal });
      log(`task ${taskId} queued`);

      const every = Math.max(1, Number(data.pollSeconds) || 5) * 1000;
      const deadline = Date.now() + (Number(data.timeoutSeconds) || 900) * 1000;

      for (let attempt = 1; ; attempt += 1) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for Runway task ${taskId}.`);
        await sleep(every, signal);
        const task = await getTask({
          baseUrl,
          apiKey,
          taskId,
          signal,
          onRetry: (err, attempt, delay) => log(
            `status check failed (${err.message}) - retrying in ${delay / 1000}s, the job is still running`,
            'warn',
          ),
        });
        const status = task?.status ?? 'PENDING';
        setStatus(`${status.toLowerCase()} (${attempt})`);

        if (status === RUNWAY_DONE) {
          const url = Array.isArray(task.output) ? task.output[0] : task.output;
          if (!url) throw new Error('Runway reported success but returned no output URL.');
          const value = media('video', url);
          setData({ _result: value });
          log('video ready (Runway output URLs expire, so download anything you want to keep)');
          return { video: value, url, json: task };
        }
        if (RUNWAY_BAD.includes(status)) {
          const why = task?.failure ?? task?.failureCode ?? task?.error ?? status;
          throw new Error(`Runway task ${status.toLowerCase()}: ${asText(why)}`);
        }
        if (attempt === 1 || attempt % 6 === 0) log(`task ${taskId}: ${status}`);
      }
    },
  });
}
