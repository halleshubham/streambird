/**
 * The small "Powered by StreamBird" mark drawn in the bottom-right corner of streams on plans that show it
 * (Free; see `plans.watermark`). Sits above the news ticker and, on a vertical stream, clear of the bottom edge.
 */
export function drawPoweredBy(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  logo: HTMLImageElement | null,
  reserveBottom: number,
): void {
  const portrait = h > w;
  const unit = (portrait ? w : h) / 720;
  const margin = Math.round(20 * unit);
  const pillH = Math.round(40 * unit);
  const padX = Math.round(12 * unit);
  const gap = Math.round(8 * unit);
  const fontPx = Math.round(18 * unit);

  ctx.save();
  ctx.font = `600 ${fontPx}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
  const text = 'Powered by StreamBird';
  const textW = ctx.measureText(text).width;
  const iconH = Math.round(28 * unit);
  const hasLogo = !!logo && logo.complete && logo.naturalHeight > 0;
  const iconW = hasLogo ? (logo!.naturalWidth / logo!.naturalHeight) * iconH : 0;
  const pillW = Math.round(padX * 2 + (hasLogo ? iconW + gap : 0) + textW);
  const bottomGap = portrait ? Math.round(h * 0.06) : margin;
  const x = w - margin - pillW;
  const y = h - reserveBottom - bottomGap - pillH;

  ctx.fillStyle = 'rgba(17,14,34,0.78)';
  ctx.beginPath();
  ctx.roundRect(x, y, pillW, pillH, pillH / 2);
  ctx.fill();
  let cx = x + padX;
  if (hasLogo) {
    ctx.drawImage(logo!, cx, y + (pillH - iconH) / 2, iconW, iconH);
    cx += iconW + gap;
  }
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, y + pillH / 2 + unit);
  ctx.restore();
}
