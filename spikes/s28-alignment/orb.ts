// Spike S28 (M12-03), route 2: OpenCV (Apache-2.0) ORB feature matching.
// OpenCV finds and matches the features; the similarity is fitted by the
// same RANSAC + least squares as route 1 (this OpenCV.js build has no
// estimateAffinePartial2D, and estimateAffine2D allows an uneven stretch,
// which D-60 forbids). Not a dependency: installed for the run only with
//   npm install --no-save @techstark/opencv-js@4.12.0-release.1

import { ransacSim, type Sim } from './geom.ts';
import type { Ink } from './image.ts';

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- the untyped OpenCV.js API, installed for the run only */
type CV = any;

export const OPENCV_PACKAGE = '@techstark/opencv-js';

// Boxed: a promise must never resolve to the thenable module itself.
let cvP: Promise<{ cv: CV } | null> | null = null;

/** Loads OpenCV.js, or null when it is not installed. Reports the load time. */
export function opencv(): Promise<{ cv: CV; loadMs: number } | null> {
  const t0 = performance.now();
  cvP ??= (async () => {
    try {
      const name = OPENCV_PACKAGE;
      const m = (await import(/* @vite-ignore */ name)) as { cv?: CV; default?: CV };
      // Never `await` the module: it is an Emscripten thenable that resolves
      // to itself. The WASM runtime may finish before or after the import resolves.
      const cv: CV = m.cv ?? m.default;
      for (let i = 0; i < 1000 && !cv.Mat; i++) await new Promise((r) => setTimeout(r, 10));
      return cv.Mat ? { cv } : null;
    } catch {
      return null;
    }
  })();
  return cvP.then((box) => (box ? { cv: box.cv, loadMs: performance.now() - t0 } : null));
}

export interface OrbResult {
  sim: Sim | null;
  keypointsA: number;
  keypointsB: number;
  matches: number;
  inliers: number;
  rmsPx: number;
  ms: number;
}

/**
 * ORB on both ink rasters (rendered at `scale` px per pt in their own
 * displayed frames), Hamming brute-force matching with Lowe's ratio test,
 * then a similarity A → B in displayed pt. Each raster has its own px per pt.
 */
export function orbAlign(
  cv: CV,
  a: Ink,
  scaleA: number,
  b: Ink,
  scaleB: number,
  nfeatures = 8000,
): OrbResult {
  const t0 = performance.now();
  const toMat = (ink: Ink): CV => {
    const m = new cv.Mat(ink.h, ink.w, cv.CV_8UC1);
    const d = m.data as Uint8Array;
    for (let i = 0; i < ink.data.length; i++) d[i] = 255 - (ink.data[i] ?? 0);
    return m;
  };
  const ma = toMat(a);
  const mb = toMat(b);
  const orb = new cv.ORB(nfeatures, 1.2, 8, 31, 0, 2, cv.ORB_HARRIS_SCORE, 31, 20);
  const ka = new cv.KeyPointVector();
  const kb = new cv.KeyPointVector();
  const da = new cv.Mat();
  const db = new cv.Mat();
  const none = new cv.Mat();
  const bf = new cv.BFMatcher(cv.NORM_HAMMING, false);
  const knn = new cv.DMatchVectorVector();
  try {
    orb.detectAndCompute(ma, none, ka, da);
    orb.detectAndCompute(mb, none, kb, db);
    const res: OrbResult = {
      sim: null,
      keypointsA: ka.size(),
      keypointsB: kb.size(),
      matches: 0,
      inliers: 0,
      rmsPx: 0,
      ms: 0,
    };
    if (ka.size() < 3 || kb.size() < 3) {
      res.ms = performance.now() - t0;
      return res;
    }
    bf.knnMatch(da, db, knn, 2);
    const src: number[] = [];
    const dst: number[] = [];
    for (let i = 0; i < knn.size(); i++) {
      const pair = knn.get(i);
      if (pair.size() < 2) continue;
      const m0 = pair.get(0);
      const m1 = pair.get(1);
      if (m0.distance > 0.8 * m1.distance) continue;
      const pa = ka.get(m0.queryIdx).pt;
      const pb = kb.get(m0.trainIdx).pt;
      src.push(pa.x / scaleA, pa.y / scaleA);
      dst.push(pb.x / scaleB, pb.y / scaleB);
    }
    res.matches = src.length / 2;
    const r = ransacSim(src, dst, {
      threshold: 3 / scaleB,
      iterations: 2000,
      maxDeg: 45,
      scaleRange: [0.25, 4],
    });
    if (r) {
      res.sim = r.sim;
      res.inliers = r.inliers.length;
      res.rmsPx = r.rms * scaleB;
    }
    res.ms = performance.now() - t0;
    return res;
  } finally {
    for (const o of [ma, mb, orb, ka, kb, da, db, none, bf, knn]) o.delete();
  }
}
