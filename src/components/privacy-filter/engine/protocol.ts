import type { Box, FaceRow } from '@/domain/privacy-filter/geometry';
import type { ScoredFace } from '@/domain/privacy-filter/heads';

/** Messages between the page and the vision worker. Frames travel as transferred ImageBitmaps. */

export const MODEL_PATHS = {
  yunet: '/models/privacy/face_detection_yunet_2023mar.onnx',
  sface: '/models/privacy/face_recognition_sface_2021dec.onnx',
  pose: '/models/privacy/yolov8n-pose.onnx',
  screens: '/models/privacy/yolo11n.onnx',
  ortWasm: '/vendor/ort/',
} as const;

export type VisionRequest =
  | { type: 'init'; faces: boolean; recognizer: boolean; pose?: boolean; screens?: boolean }
  | { type: 'gallery'; features: number[][] }
  | { type: 'faces'; frame: ImageBitmap; k: number; tiles: boolean }
  | { type: 'probe'; frame: ImageBitmap }
  | { type: 'enroll'; image: ImageBitmap }
  | { type: 'qr'; frame: ImageBitmap; tiles: boolean }
  | { type: 'pose'; frame: ImageBitmap; k: number; tiles: boolean }
  | { type: 'screens'; frame: ImageBitmap };

export interface InitResult {
  faces: boolean;
  recognizer: boolean;
  pose: boolean;
  screens: boolean;
  qr: 'BarcodeDetector' | 'jsQR';
  errors: string[];
}

export interface EnrolledPerson {
  feature: number[];
  /** Crop shown on the person's card, in image pixels. */
  box: Box;
}

export interface EnrollResult {
  people: EnrolledPerson[];
  /** False when a group photo could not be split safely: it is kept as one reference, flagged for review. */
  split: boolean;
  /** Faces found; zero means the picture cannot be used. */
  found: number;
}

export type VisionResult =
  | { type: 'init'; result: InitResult }
  | { type: 'gallery'; count: number }
  | { type: 'faces'; faces: ScoredFace[] }
  | { type: 'probe'; scores: [number, number, number, number] }
  | { type: 'enroll'; result: EnrollResult }
  | { type: 'qr'; boxes: Box[]; /** Codes found only by their finder squares (not decodable). */ shapes: number }
  | { type: 'pose'; people: PoseFound[] }
  | { type: 'screens'; boxes: Box[] };

/** A person from the pose model, in frame pixels: whole-body box, confidence and head box. */
export interface PoseFound {
  box: Box;
  score: number;
  head: Box;
}

export type Envelope<T> = { id: number; ok: true; body: T } | { id: number; ok: false; error: string };

export type { Box, FaceRow };
