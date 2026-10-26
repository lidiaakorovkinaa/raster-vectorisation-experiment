# Формат данных

Каждый эксперимент — папка `data/experiments/<id>/` и строка в `data/index.json`.

## record.json (схема v1)

```json
{
  "schemaVersion": 1,
  "id": "exp_...",
  "name": "Постер · типографика и цвет",
  "notes": "...",
  "tags": ["demo", "цвет"],
  "author": "Demo",
  "batchId": "batch_demo_2026",
  "batchName": "Демо · три сюжета",
  "derivedFrom": null,
  "pinned": true,
  "createdAt": "2026-10-26T00:00:00.000Z",
  "updatedAt": "2026-10-26T00:00:00.000Z",
  "status": "ok",
  "source": {
    "originalName": "poster.png",
    "originalMime": "image/png",
    "originalBytes": 123456,
    "originalSha256": "...",
    "originalFile": "original.png",
    "format": "png",
    "width": 960, "height": 1200,
    "sourceWidth": 1000, "sourceHeight": 1250,
    "megapixels": 1.152,
    "hasAlpha": false,
    "transparentRatio": 0,
    "normalizedSha256": "...",
    "normalizedFile": "source.png",
    "thumbFile": "thumb.png",
    "background": "#FFFFFF",
    "qualityBackground": "#F6EEDC",
    "maxSide": 1200,
    "scale": 0.96,
    "client": { "preprocessing": "browser: EXIF + canvas..." }
  },
  "config": { "repetitions": 3, "warmup": 1, "background": "#FFFFFF", "maxSide": 1200 },
  "params": {
    "potrace": { "thresholdMode": "auto", "threshold": 158, "resolvedThreshold": 158, "turdSize": 2, "...": "..." },
    "imagetracer": { "numberofcolors": 10, "...": "..." },
    "vtracer": { "colorMode": "color", "...": "..." }
  },
  "timing": {
    "resolvedThreshold": 158,
    "engineOrder": ["potrace", "imagetracer", "vtracer"],
    "repetitions": 3,
    "warmup": 1,
    "durationMs": 5699,
    "analysisMs": 2100,
    "workerRestarts": 0,
    "totalDurationMs": 5900
  },
  "engines": {
    "potrace": {
      "id": "potrace", "version": "2.1.8", "status": "ok", "error": null,
      "timing": { "samples": [96.1, 97.2, 96.7], "runs": 3, "median": 96.7, "mean": 96.6, "min": 96.1, "max": 97.2, "std": 0.55, "cv": 0.57, "warmup": 1 },
      "deterministic": true,
      "stats": { "paths": 12, "subpaths": 40, "nodes": 930, "...": "...", "bytes": 38000, "gzipBytes": 9000, "sha1": "..." },
      "metrics": { "rmse": 56.8, "ssim": 0.718, "deltaE2000": 10.577, "heatmapScale": 12, "diffGain": 2, "silhouette": { "iou": 0.985, "dice": 0.992, "...": "..." }, "...": "..." },
      "files": { "svg": "svg-potrace.svg", "render": "render-potrace.png", "heatmap": "heatmap-potrace.png", "heatmapFixed": "heatmap-fixed-potrace.png", "ssim": "ssim-potrace.png", "diff": "diff-potrace.png" }
    },
    "imagetracer": { "...": "..." },
    "vtracer": { "...": "..." }
  },
  "rois": [
    {
      "id": "roi_...",
      "name": "Буква «02»",
      "note": "",
      "rect": { "x": 120, "y": 520, "w": 340, "h": 320 },
      "metrics": { "potrace": { "ssim": 0.6, "...": "..." }, "imagetracer": {}, "vtracer": {} },
      "createdAt": "..."
    }
  ],
  "environment": { "node": "v24...", "platform": "darwin", "arch": "arm64", "cpu": "Apple M1", "cores": 8, "totalMemoryMB": 8192, "appVersion": "1.0.0", "engineVersions": { "...": "..." } },
  "methodology": { "version": "1.0", "timing": "...", "quality": "...", "inputNormalization": "..." },
  "best": { "quality": { "engine": "vtracer", "value": 0.9568 }, "speed": { "engine": "potrace", "value": 96.7 }, "size": { "engine": "potrace", "value": 38000 } },
  "warnings": [ { "level": "warn", "message": "..." } ]
}
```

## Файлы

| Файл | Содержимое |
|---|---|
| `source.png` | канонический нормализованный источник, RGB(A), рабочее разрешение |
| `original.<ext>` | исходный файл как загружен |
| `thumb.png` | превью до 420 px |
| `svg-<engine>.svg` | нормализованный SVG с `width/height` рабочего разрешения |
| `render-<engine>.png` | прозрачный рендер resvg |
| `heatmap-<engine>.png` | ΔE2000, авто-шкала (p99) |
| `heatmap-fixed-<engine>.png` | ΔE2000, фиксированная шкала 0–20 |
| `ssim-<engine>.png` | карта SSIM |
| `diff-<engine>.png` | усиленная абсолютная RGB-разница |

`record.json` не содержит сами SVG/PNG, только имена файлов. Экспорт `format=json` добавляет `assets.svgs` с полным текстом SVG.

## index.json

```json
{
  "schemaVersion": 1,
  "updatedAt": "...",
  "experiments": [ { "id": "...", "name": "...", "status": "...", "source": {}, "engines": {}, "best": {}, "...": "..." } ]
}
```

Индекс пересобирается при старте, если папки и записи расходятся. Удаление эксперимента удаляет папку и строку индекса.
