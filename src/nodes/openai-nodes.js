// OpenAI image generation, with several variations per run and a gallery to
// pick the one that goes downstream.

import { asText, media } from '../core/types.js';
import { dataUrlToBlob } from '../util/media.js';
import {
  DEFAULT_OPENAI_BASE,
  IMAGE_QUALITIES,
  IMAGE_SIZES,
  editImages,
  generateImages,
  imagesFromPayload,
} from '../providers/openai.js';

export function registerOpenAiNodes(registry) {
  registry.register({
    type: 'openai-image',
    title: 'OpenAI Image',
    category: 'OpenAI',
    accent: '#74c69d',
    hint: 'Text or image in, several variations out. Click one to send it downstream.',
    inputs: [
      { id: 'prompt', label: 'Prompt', type: 'text', required: true },
      { id: 'image', label: 'Source', type: 'image' },
    ],
    outputs: [
      { id: 'image', label: 'Picked', type: 'image' },
      { id: 'images', label: 'All', type: 'json' },
      { id: 'json', label: 'JSON', type: 'json' },
    ],
    fields: [
      { id: 'credential', kind: 'credential', label: 'OpenAI key', provider: 'openai' },
      { id: 'model', kind: 'text', label: 'Model', placeholder: 'gpt-image-1' },
      { id: 'count', kind: 'range', label: 'Variations per run', min: 1, max: 4, step: 1, zeroLabel: '1' },
      { id: 'size', kind: 'select', label: 'Size', options: IMAGE_SIZES },
      { id: 'quality', kind: 'select', label: 'Quality', options: IMAGE_QUALITIES },
      {
        id: 'background',
        kind: 'select',
        label: 'Background',
        options: [
          { value: 'auto', label: 'Auto' },
          { value: 'opaque', label: 'Opaque' },
          { value: 'transparent', label: 'Transparent' },
        ],
        advanced: true,
      },
      { id: 'baseUrl', kind: 'text', label: 'Base URL', placeholder: DEFAULT_OPENAI_BASE, advanced: true },
      { id: '_gallery', kind: 'gallery', label: '' },
    ],
    defaults: {
      credential: '',
      model: 'gpt-image-1',
      count: 2,
      size: '1024x1024',
      quality: 'medium',
      background: 'auto',
      baseUrl: DEFAULT_OPENAI_BASE,
    },
    // Picking a different variation must not look like a settings change, or
    // choosing a favourite would re-run the generation and bill you again.
    cacheIgnore: ['_result', '_images', '_selected'],
    async run({ data, inputs, signal, keystore, log, setData }) {
      const apiKey = keystore.require(data.credential, 'OpenAI key');
      const baseUrl = data.baseUrl || DEFAULT_OPENAI_BASE;
      const prompt = asText(inputs.prompt).trim();
      if (!prompt) throw new Error('The prompt is empty.');
      const count = Math.min(4, Math.max(1, Number(data.count) || 1));
      const source = inputs.image?.url;

      let payload;
      if (source) {
        if (!source.startsWith('data:')) {
          throw new Error('Editing needs an uploaded image. Remote URLs are not sent to OpenAI by this node.');
        }
        const { blob, extension } = dataUrlToBlob(source);
        const form = new FormData();
        form.append('model', data.model || 'gpt-image-1');
        form.append('prompt', prompt);
        form.append('n', String(count));
        if (data.size && data.size !== 'auto') form.append('size', data.size);
        if (data.quality && data.quality !== 'auto') form.append('quality', data.quality);
        form.append('image', blob, `source.${extension}`);
        log(`POST /images/edits x${count}`);
        payload = await editImages({ baseUrl, apiKey, form, signal });
      } else {
        const body = {
          model: data.model || 'gpt-image-1',
          prompt,
          n: count,
        };
        if (data.size && data.size !== 'auto') body.size = data.size;
        if (data.quality && data.quality !== 'auto') body.quality = data.quality;
        if (data.background && data.background !== 'auto') body.background = data.background;
        log(`POST /images/generations x${count}`);
        payload = await generateImages({ baseUrl, apiKey, body, signal });
      }

      const images = imagesFromPayload(payload);
      if (!images.length) throw new Error('OpenAI returned no images.');
      log(`${images.length} variation${images.length > 1 ? 's' : ''} back`);
      setData({ _images: images, _selected: 0 });
      return {
        image: media('image', images[0]),
        images,
        json: payload,
      };
    },
  });
}
