# Models

`selfie_segmenter.tflite` is Google's MediaPipe **Selfie Segmenter** (float16, 256x256), Apache License 2.0,
downloaded from
https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite

It is what "Any background" (person cut-out) uses in the host studio. It runs in the browser with the
`@mediapipe/tasks-vision` WebAssembly runtime (copied into the build at `/mediapipe/` by `vite.config.ts`);
no video leaves the computer.
