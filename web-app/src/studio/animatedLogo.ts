// The logo's animated-GIF decoder is the shared animated-image helper (see animatedImage.ts); these names are kept
// so the logo code reads the same as before.
export { decodeAnimatedImage as decodeAnimatedLogo, frameDelayMs, frameIndexAt, imageDecoderCtor, MAX_ANIMATED_BYTES as MAX_LOGO_BYTES, MAX_ANIMATED_FRAMES as MAX_LOGO_FRAMES } from './animatedImage';
export type { AnimatedImage as AnimatedLogo } from './animatedImage';
