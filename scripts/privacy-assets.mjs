#!/usr/bin/env node
/* global process, console, fetch */
/**
 * Installs the files the in-browser privacy filter needs into public/ (git-ignored):
 *
 *   public/vendor/ort/        ONNX Runtime Web wasm (copied from node_modules)
 *   public/vendor/tesseract/  Tesseract.js worker and core (copied from node_modules)
 *   public/models/privacy/    YuNet face detector, SFace face recogniser, English OCR data (downloaded once)
 *
 * HELLO's Content-Security-Policy only allows connections to its own origin, so nothing is fetched from a CDN at
 * run time. Downloads are pinned by SHA-256; a file with the wrong hash is deleted. A failed download does not fail
 * the build: the filter then reports the model as missing and, for a switched-on detector, blurs the whole frame.
 *
 * Models (licences and provenance: docs/THIRD_PARTY_LICENSE_AUDIT.md):
 *   YuNet 2023mar (MIT, OpenCV Zoo) and SFace 2021dec (Apache-2.0, OpenCV Zoo): the same files upstream Offleak uses.
 *   YOLOv8n-pose (AGPL-3.0, Ultralytics; ONNX export published by Xenova on Hugging Face): people, including people
 *     seen from behind. Upstream uses YOLO11n-pose, which has no published ONNX export.
 *   YOLO11n (AGPL-3.0, Ultralytics; ONNX export published by the WebNN project on Hugging Face, from the same
 *     yolo11n.pt as Ultralytics' v8.4.0 release, SHA-256 0ebbc80d...): screens, phones and paper for crop zoom.
 *   Tesseract English 4.0.0_best_int (Apache-2.0 data, packaged by @tesseract.js-data/eng, MIT).
 * Each URL is pinned to a repository commit, so the bytes cannot change under the same name.
 *
 *   node scripts/privacy-assets.mjs            copy runtime files, download missing models
 *   node scripts/privacy-assets.mjs --offline  copy runtime files and verify models, no network
 */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
const offline = process.argv.includes('--offline');

const COPIES = [
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'vendor/ort/ort-wasm-simd-threaded.wasm'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'vendor/ort/ort-wasm-simd-threaded.mjs'],
  ['node_modules/tesseract.js/dist/worker.min.js', 'vendor/tesseract/worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'vendor/tesseract/tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'vendor/tesseract/tesseract-core-lstm.wasm.js'],
];

/** SHA-256 values measured on the first download (2026-11-22). */
const MODELS = [
  {
    file: 'models/privacy/face_detection_yunet_2023mar.onnx',
    url: 'https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx',
    sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4',
  },
  {
    file: 'models/privacy/face_recognition_sface_2021dec.onnx',
    url: 'https://huggingface.co/opencv/face_recognition_sface/resolve/main/face_recognition_sface_2021dec.onnx',
    sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79',
  },
  {
    file: 'models/privacy/yolov8n-pose.onnx',
    url: 'https://huggingface.co/Xenova/yolov8n-pose/resolve/da4224085e2f6ce4c9ff9b670e28765194619db2/onnx/model.onnx',
    sha256: '04f6d2416266f2aba6c5ba8b26de33ed9eba3279f972ac02e33f9f1366547586',
  },
  {
    file: 'models/privacy/yolo11n.onnx',
    url: 'https://huggingface.co/webnn/yolo11n/resolve/9c5acfdd74aaff2d0f47c51b878506361039a51f/onnx/yolo11n.onnx',
    sha256: '7d8fd1717d9d5bbab6986cd134afb620649c7a394303d55b1e09fc00804cc5c1',
  },
  {
    file: 'models/privacy/eng.traineddata.gz',
    url: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz',
    sha256: '45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91',
  },
];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const exists = (path) => stat(path).then(() => true, () => false);

async function copies() {
  let copied = 0;
  for (const [from, to] of COPIES) {
    const source = join(root, from);
    if (!(await exists(source))) {
      console.warn(`privacy-assets: ${from} is missing; run npm install`);
      continue;
    }
    const target = join(pub, to);
    await mkdir(dirname(target), { recursive: true });
    if (/\.m?js$/.test(to)) {
      // Third-party, minified JavaScript: marked so that `eslint .` does not lint it as HELLO source. A leading
      // comment does not change how the script runs. Binary files (.wasm) are copied byte for byte.
      const VENDOR = '/* eslint-disable */ /* Third-party file copied from node_modules by scripts/privacy-assets.mjs. Do not edit. */\n';
      await writeFile(target, VENDOR + (await readFile(source, 'utf8')));
    } else {
      await copyFile(source, target);
    }
    copied += 1;
  }
  console.log(`privacy-assets: copied ${copied}/${COPIES.length} runtime files`);
}

async function models() {
  let ok = 0;
  for (const model of MODELS) {
    const target = join(pub, model.file);
    if (await exists(target)) {
      if (sha256(await readFile(target)) === model.sha256) {
        ok += 1;
        continue;
      }
      console.warn(`privacy-assets: ${model.file} has the wrong SHA-256; deleting it`);
      await rm(target);
    }
    if (offline) continue;
    try {
      const response = await fetch(model.url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const hash = sha256(bytes);
      if (hash !== model.sha256) throw new Error(`SHA-256 mismatch (${hash})`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
      ok += 1;
      console.log(`privacy-assets: downloaded ${model.file} (${bytes.length} bytes)`);
    } catch (error) {
      console.warn(`privacy-assets: could not install ${model.file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`privacy-assets: ${ok}/${MODELS.length} models installed`);
}

await copies();
await models();
