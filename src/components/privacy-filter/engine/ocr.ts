// SPDX-License-Identifier: AGPL-3.0-only
// The phone-number lane of Offleak (https://github.com/azharizz/offleak, commit 24e6a77, AGPL-3.0:
// backends/portable/ocr.py and the MirrorProbe in detection/objects.py), with Tesseract.js in place of RapidOCR.
import { createWorker, type Worker as TesseractWorker } from 'tesseract.js';
import { phoneBoxesInLine, regionFromLocale, type OcrWord } from '@/domain/privacy-filter/phone';
import type { Box } from '@/domain/privacy-filter/geometry';

/** Self-hosted by scripts/privacy-assets.mjs: HELLO's CSP lets the page reach its own origin only. */
const PATHS = { workerPath: '/vendor/tesseract/worker.min.js', corePath: '/vendor/tesseract/', langPath: '/models/privacy' };

export interface TextScan {
  phone: Box[];
  /** Sum of confidence x length: compares a frame read plain and flipped (mirror vote). */
  textScore: number;
}

interface TLine {
  text: string;
  confidence: number;
  words: OcrWord[];
}
interface TBlock {
  paragraphs: Array<{ lines: TLine[] }>;
}

export class PhoneReader {
  private worker: TesseractWorker | null = null;
  private loading: Promise<TesseractWorker> | null = null;
  private readonly region = regionFromLocale(typeof navigator === 'undefined' ? null : navigator.language);

  async load(): Promise<void> {
    await this.get();
  }

  private get(): Promise<TesseractWorker> {
    if (this.worker) return Promise.resolve(this.worker);
    this.loading ??= createWorker('eng', 1, { ...PATHS, workerBlobURL: false, gzip: true, logger: () => undefined }).then(async (w) => {
      // Sparse text: screens, tickets and signs in a scene rather than a page of prose.
      await w.setParameters({ tessedit_pageseg_mode: '11' as never });
      this.worker = w;
      return w;
    });
    return this.loading;
  }

  async read(image: HTMLCanvasElement | OffscreenCanvas | ImageBitmap): Promise<TextScan> {
    const worker = await this.get();
    const { data } = await worker.recognize(image as unknown as HTMLCanvasElement, {}, { blocks: true });
    const blocks = (data as unknown as { blocks: TBlock[] | null }).blocks ?? [];
    const scan: TextScan = { phone: [], textScore: 0 };
    for (const block of blocks) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          scan.textScore += (line.confidence / 100) * line.text.trim().length;
          scan.phone.push(...phoneBoxesInLine(line.words, this.region));
        }
      }
    }
    return scan;
  }

  async terminate(): Promise<void> {
    const w = this.worker ?? (this.loading ? await this.loading.catch(() => null) : null);
    this.worker = null;
    this.loading = null;
    await w?.terminate();
  }
}
