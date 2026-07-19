// Gaze tracking via MediaPipe FaceLandmarker, entirely in-browser. The JS is
// bundled from node_modules but the WASM runtime (~5 MB) and landmark model
// (~3.7 MB) are fetched lazily from CDNs, mirroring how the kuromoji
// dictionary loads in sentence practice. The WASM URL is pinned to the
// installed package version so the runtime always matches the bundled JS.
const WASM_BASE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const RADIANS_TO_DEGREES = 180 / Math.PI;
// A blendshape score of 1.0 means the eye is rotated to its extreme; the true
// range varies per person. ponytail: calibration knob, tune together with
// GAZE_STEADY_RADIUS_DEGREES in takeMetrics.js against real takes.
const EYE_RANGE_DEGREES = 30;

let landmarker = null;
let landmarkerPromise = null;

export function loadGazeLandmarker() {
  if (landmarker) {
    return Promise.resolve(landmarker);
  }

  if (!landmarkerPromise) {
    landmarkerPromise = import("@mediapipe/tasks-vision")
      .then(async ({ FilesetResolver, FaceLandmarker }) => {
        const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_URL);

        landmarker = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });

        return landmarker;
      })
      .catch((error) => {
        // Allow a later retry, e.g. the CDN was temporarily unreachable.
        landmarkerPromise = null;
        throw error;
      });
  }

  return landmarkerPromise;
}

// Converts a FaceLandmarker result into a gaze-in-world direction in degrees,
// or null when no face was detected. Head pose (from the transformation
// matrix) and eye-in-head rotation (from the eyeLook blendshapes) share one
// sign convention — positive x is the speaker's left, positive y is down —
// so when the head turns whilst the eyes hold a fixed point, the eyes
// counter-rotate and the two terms cancel instead of double-counting.
export function computeGazeAngles(result) {
  const categories = result?.faceBlendshapes?.[0]?.categories;
  const matrix = result?.facialTransformationMatrixes?.[0]?.data;

  if (!categories?.length || !matrix) {
    return null;
  }

  const shapes = {};

  for (const category of categories) {
    shapes[category.categoryName] = category.score;
  }

  // The matrix is column-major; elements 8-10 are the rotated z (face
  // forward) axis, giving yaw and pitch directly.
  const headYaw = Math.atan2(matrix[8], matrix[10]) * RADIANS_TO_DEGREES;
  const headPitch = Math.asin(Math.min(1, Math.max(-1, -matrix[9]))) * RADIANS_TO_DEGREES;
  const eyeX =
    ((shapes.eyeLookOutLeft ?? 0) +
      (shapes.eyeLookInRight ?? 0) -
      (shapes.eyeLookInLeft ?? 0) -
      (shapes.eyeLookOutRight ?? 0)) /
    2;
  const eyeY =
    ((shapes.eyeLookDownLeft ?? 0) +
      (shapes.eyeLookDownRight ?? 0) -
      (shapes.eyeLookUpLeft ?? 0) -
      (shapes.eyeLookUpRight ?? 0)) /
    2;

  return {
    x: headYaw + eyeX * EYE_RANGE_DEGREES,
    y: headPitch + eyeY * EYE_RANGE_DEGREES,
  };
}
