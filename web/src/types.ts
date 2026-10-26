export type EngineId = 'potrace' | 'imagetracer' | 'vtracer';
export type ExperimentStatus = 'ok' | 'partial' | 'error';
export type EngineStatus = 'ok' | 'partial' | 'error' | 'pending';
export type TabId = 'compare' | 'metrics' | 'diff' | 'report';

export interface SilhouetteMetrics {
  reference: string;
  iou: number;
  dice: number;
  precision: number;
  recall: number;
  accuracy: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

export interface QualityMetrics {
  rmse: number;
  mae: number;
  psnr: number;
  ssim: number;
  ssimP05: number;
  deltaE76: number;
  deltaE2000: number;
  deltaE2000P95: number;
  diffJndRatio: number;
  diff5Ratio: number;
  diffRgb16Ratio: number;
  diffRgb32Ratio: number;
  exactPixelRatio: number;
  colors: number;
  colorsSource: number;
  coverage: number;
  coverageSource: number;
  heatmapScale: number;
  diffGain: number;
  silhouette: SilhouetteMetrics | null;
}

export interface SvgStats {
  paths: number;
  subpaths: number;
  nodes: number;
  segments: number;
  lines: number;
  curves: number;
  cubic: number;
  quadratic: number;
  arcs: number;
  controlPoints: number;
  commands: number;
  coordinatePrecision: number;
  colors: number;
  colorRefs: number;
  gradients: number;
  shapes: number;
  hasText: boolean;
  hasImage: boolean;
  hasUse: boolean;
  pathLengthPx: number;
  meanSegmentPx: number;
  nodesPerMegapixel: number;
  bbox: { x: number; y: number; width: number; height: number } | null;
  viewBox: { x: number; y: number; w: number; h: number } | null;
  invalidPaths: number;
  parseError: string | null;
  bytes: number;
  gzipBytes: number;
  gzipRatio: number;
  bytesPerPixel: number;
  sha1: string;
}

export interface TimingStats {
  samples: number[];
  runs: number;
  median: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
  std: number | null;
  cv: number | null;
  warmup: number;
}

export interface EngineFiles {
  svg?: string;
  render?: string;
  heatmap?: string;
  heatmapFixed?: string;
  ssim?: string;
  diff?: string;
}

export interface EngineRecord {
  id: EngineId;
  name?: string;
  version?: string;
  status: EngineStatus;
  error?: string | null;
  timing?: TimingStats | null;
  deterministic?: boolean | null;
  stats?: SvgStats | null;
  metrics?: QualityMetrics | null;
  viewBox?: { x: number; y: number; w: number; h: number } | null;
  aspectMismatch?: number | null;
  failures?: number;
  errors?: string[];
  files?: EngineFiles;
}

export interface SourceInfo {
  originalName: string;
  originalMime: string;
  originalBytes: number;
  originalSha256: string;
  originalFile: string;
  format: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  megapixels: number;
  aspect: number;
  hasAlpha: boolean;
  transparentRatio: number;
  normalizedBytes: number;
  normalizedSha256: string;
  normalizedFile: string;
  thumbFile: string;
  background: string;
  qualityBackground: string;
  maxSide: number;
  downscaled: boolean;
  scale: number;
  client?: Record<string, unknown> | null;
  orientation?: number;
}

export interface ExperimentConfig {
  repetitions: number;
  warmup: number;
  background: string;
  maxSide: number;
}

export interface EngineParams {
  potrace: Record<string, unknown>;
  imagetracer: Record<string, unknown>;
  vtracer: Record<string, unknown>;
}

export interface ExperimentTiming {
  resolvedThreshold: number;
  engineOrder: EngineId[];
  repetitions: number;
  warmup: number;
  durationMs: number;
  analysisMs: number | null;
  workerRestarts: number;
  totalDurationMs?: number;
  createdAt?: string;
}

export interface EnvironmentInfo {
  node: string;
  platform: string;
  arch: string;
  release: string;
  cpu: string;
  cores: number;
  totalMemoryMB: number;
  appVersion: string;
  methodologyVersion: string;
  engineVersions?: Record<string, string>;
}

export interface WarningItem {
  level: 'warn' | 'error' | 'info';
  message: string;
}

export interface RoiRecord {
  id: string;
  name: string;
  note: string;
  rect: { x: number; y: number; w: number; h: number };
  metrics: Partial<Record<EngineId, QualityMetrics & { error?: string }>>;
  createdAt: string;
}

export interface BestMap {
  quality?: { engine: EngineId; value: number };
  rmse?: { engine: EngineId; value: number };
  color?: { engine: EngineId; value: number };
  silhouette?: { engine: EngineId; value: number };
  speed?: { engine: EngineId; value: number };
  size?: { engine: EngineId; value: number };
}

export interface ExperimentRecord {
  schemaVersion: number;
  id: string;
  name: string;
  notes: string;
  tags: string[];
  author: string;
  batchId: string | null;
  batchName: string | null;
  derivedFrom: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  status: ExperimentStatus;
  source: SourceInfo;
  config: ExperimentConfig;
  params: EngineParams & { potrace: Record<string, unknown> & { resolvedThreshold?: number } };
  timing: ExperimentTiming;
  engines: Record<EngineId, EngineRecord>;
  rois: RoiRecord[];
  environment: EnvironmentInfo;
  methodology: {
    version: string;
    appVersion: string;
    inputNormalization: string;
    timing: string;
    quality: string;
  };
  best: BestMap;
  warnings: WarningItem[];
}

export interface ExperimentSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: ExperimentStatus;
  batchId: string | null;
  batchName: string | null;
  derivedFrom: string | null;
  tags: string[];
  pinned: boolean;
  author: string;
  notesPreview: string;
  source: {
    originalName: string;
    width: number;
    height: number;
    megapixels: number;
    format: string;
    background: string;
  };
  config: { repetitions: number; warmup: number; maxSide: number; resolvedThreshold: number };
  timing: { durationMs: number; analysisMs: number };
  engines: Record<EngineId, {
    status: EngineStatus;
    median: number | null;
    bytes: number | null;
    nodes: number | null;
    paths: number | null;
    rmse: number | null;
    ssim: number | null;
    deltaE2000: number | null;
    silhouetteIou: number | null;
    error: string | null;
  }>;
  best: BestMap;
  roisCount: number;
}

export interface Batch {
  id: string;
  name: string;
  createdAt: string;
  count: number;
  experimentIds: string[];
  statuses: Record<string, number>;
}

export interface Sample {
  id: string;
  name: string;
  description: string;
  hint: string;
  tags: string[];
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  params: Record<string, unknown>;
}

export interface AppConfig {
  app: { name: string; version: string; methodologyVersion: string };
  engines: Array<{
    id: EngineId;
    name: string;
    subtitle: string;
    color: string;
    version: string;
    algorithm: string;
    license: string;
    note: string;
  }>;
  defaultParams: {
    potrace: Record<string, unknown>;
    imagetracer: Record<string, unknown>;
    vtracer: Record<string, unknown>;
  };
  presets: Record<EngineId, Preset[]>;
  labels: {
    params: Record<EngineId, Record<string, string>>;
    enums: Record<string, Record<string, string>>;
  };
  limits: {
    maxUploadBytes: number;
    maxPixels: number;
    maxSide: number;
    defaultMaxSide: number;
    maxSvgBytes: number;
    maxRepetitions: number;
    defaultRepetitions: number;
    minRepetitions: number;
    maxFilesPerRequest: number;
    maxBatchFiles: number;
    requestTimeoutMs: number;
    analysisTimeoutMs: number;
  };
  environment: EnvironmentInfo;
  methodology: {
    title: string;
    timing: string;
    quality: string;
    normalization: string;
    caveats: string[];
  };
}

export interface ProgressMessage {
  type: 'progress' | 'done' | 'error';
  stage?: string;
  engine?: EngineId;
  round?: number;
  repetitions?: number;
  completedRuns?: number;
  totalRuns?: number;
  message?: string;
  level?: 'info' | 'warn' | 'error';
  source?: Partial<SourceInfo>;
  experiment?: ExperimentRecord;
  error?: { code: string; message: string; details?: unknown };
}

export interface NormalizedImage {
  file: File;
  normalized: Blob;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  scale: number;
  orientationApplied: boolean;
}

export interface RoiMetricsResponse {
  rect: { x: number; y: number; w: number; h: number };
  engines: Partial<Record<EngineId, QualityMetrics>>;
}
