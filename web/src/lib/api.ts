import type {
  AppConfig,
  Batch,
  EngineId,
  ExperimentRecord,
  ExperimentSummary,
  ProgressMessage,
  RoiMetricsResponse,
  RoiRecord,
  Sample,
} from '@/types';

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(message: string, code = 'ERROR', status = 0, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function parseError(response: Response): Promise<ApiError> {
  try {
    const data = await response.json();
    return new ApiError(data?.error?.message || response.statusText, data?.error?.code || 'HTTP_ERROR', response.status, data?.error?.details);
  } catch {
    return new ApiError(response.statusText || 'Ошибка запроса', 'HTTP_ERROR', response.status);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw await parseError(response);
  return response.json() as Promise<T>;
}

export const api = {
  config: () => request<AppConfig>('/api/config'),
  health: () => request<unknown>('/api/health'),
  samples: () => request<{ samples: Sample[] }>('/api/samples'),
  experiments: (params: { q?: string; tag?: string; batch?: string; limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') query.set(key, String(value));
    return request<{ total: number; items: ExperimentSummary[] }>(`/api/experiments?${query.toString()}`);
  },
  experiment: (id: string) => request<ExperimentRecord>(`/api/experiments/${id}`),
  batches: () => request<{ batches: Batch[] }>('/api/batches'),
  patchExperiment: (id: string, patch: Partial<Pick<ExperimentRecord, 'name' | 'notes' | 'tags' | 'author' | 'batchName' | 'pinned'>>) =>
    request<ExperimentRecord>(`/api/experiments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  deleteExperiment: (id: string) => request<{ ok: true }>(`/api/experiments/${id}`, { method: 'DELETE' }),
  roiMetrics: (id: string, rect: { x: number; y: number; w: number; h: number }) =>
    request<RoiMetricsResponse>(`/api/experiments/${id}/roi?${new URLSearchParams(Object.entries(rect).map(([k, v]) => [k, String(v)])).toString()}`),
  saveRoi: (id: string, payload: { name: string; note?: string; rect: { x: number; y: number; w: number; h: number } }) =>
    request<RoiRecord>(`/api/experiments/${id}/rois`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  deleteRoi: (id: string, roiId: string) => request<ExperimentRecord>(`/api/experiments/${id}/rois/${roiId}`, { method: 'DELETE' }),
};

export function fileUrl(id: string, kind: 'source' | 'thumb' | 'original' | 'svg' | 'render' | 'heatmap' | 'heatmapFixed' | 'ssim' | 'diff', engine?: EngineId, download = false): string {
  const suffix = engine ? `/${engine}` : '';
  return `/api/experiments/${id}/file/${kind}${suffix}${download ? '?download=1' : ''}`;
}

export function exportUrl(id: string, format: 'html' | 'md' | 'csv' | 'json' | 'latex' | 'zip', download = true): string {
  return `/api/experiments/${id}/export?format=${format}${download ? '&download=1' : ''}`;
}

export function datasetExportUrl(format: 'csv' | 'json' | 'md' | 'zip', opts: { ids?: string[]; batch?: string; title?: string } = {}): string {
  const params = new URLSearchParams({ format });
  if (opts.ids?.length) params.set('ids', opts.ids.join(','));
  if (opts.batch) params.set('batch', opts.batch);
  if (opts.title) params.set('title', opts.title);
  return `/api/export?${params.toString()}`;
}

export async function uploadExperiment({
  original,
  normalized,
  meta,
  onProgress,
  signal,
}: {
  original: File;
  normalized: Blob;
  meta: Record<string, unknown>;
  onProgress?: (message: ProgressMessage) => void;
  signal?: AbortSignal;
}): Promise<ExperimentRecord> {
  const form = new FormData();
  const normalizedFile = new File([normalized], 'source.png', { type: 'image/png' });
  form.append('normalized', normalizedFile);
  form.append('original', original, original.name);
  form.append('meta', JSON.stringify(meta));
  form.append('params', JSON.stringify(meta.params ?? {}));
  const response = await fetch('/api/experiments', {
    method: 'POST',
    headers: { Accept: 'application/x-ndjson' },
    body: form,
    signal,
  });
  if (!response.ok) throw await parseError(response);
  if (!response.body) throw new ApiError('Сервер не вернул поток прогресса', 'NO_STREAM');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let experiment: ExperimentRecord | null = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message: ProgressMessage;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      onProgress?.(message);
      if (message.type === 'error') {
        throw new ApiError(message.error?.message || 'Ошибка вычисления', message.error?.code || 'COMPUTE_ERROR', 0, message.error?.details);
      }
      if (message.type === 'done' && message.experiment) {
        experiment = message.experiment;
      }
    }
  }
  if (buffer.trim()) {
    try {
      const message = JSON.parse(buffer) as ProgressMessage;
      if (message.type === 'error') throw new ApiError(message.error?.message || 'Ошибка вычисления', message.error?.code || 'COMPUTE_ERROR');
      if (message.type === 'done' && message.experiment) experiment = message.experiment;
    } catch (error) {
      if (error instanceof ApiError) throw error;
    }
  }
  if (!experiment) throw new ApiError('Вычисление завершилось без результата', 'NO_RESULT');
  return experiment;
}

export async function deriveExperiment({
  id,
  params,
  config,
  meta,
  onProgress,
}: {
  id: string;
  params?: Record<string, unknown>;
  config?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  onProgress?: (message: ProgressMessage) => void;
}): Promise<ExperimentRecord> {
  const response = await fetch(`/api/experiments/${id}/derive`, {
    method: 'POST',
    headers: { Accept: 'application/x-ndjson', 'Content-Type': 'application/json' },
    body: JSON.stringify({ params, config, meta }),
  });
  if (!response.ok) throw await parseError(response);
  if (!response.body) throw new ApiError('Сервер не вернул поток прогресса', 'NO_STREAM');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let experiment: ExperimentRecord | null = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message: ProgressMessage;
      try { message = JSON.parse(line); } catch { continue; }
      onProgress?.(message);
      if (message.type === 'error') throw new ApiError(message.error?.message || 'Ошибка', message.error?.code || 'ERROR');
      if (message.type === 'done' && message.experiment) experiment = message.experiment;
    }
  }
  if (!experiment) throw new ApiError('Вычисление завершилось без результата', 'NO_RESULT');
  return experiment;
}
