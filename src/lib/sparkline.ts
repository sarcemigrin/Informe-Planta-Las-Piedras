/** Build an inline SVG string for a mini sparkline chart.
 *  Kept in a .ts (not .tsx) file to avoid TSX parser confusion
 *  with angle-bracket characters inside strings.
 */
export function buildSparkSvg(
  data: number[],
  color: string,
  refVal?: number,
): string {
  const W = 100, H = 36;
  const pts = data.filter(v => v > 0);
  if (pts.length < 2) return "";

  const minV = Math.min(...pts), maxV = Math.max(...pts);
  const pad  = (maxV - minV) * 0.15 || 2;
  const lo   = minV - pad, rng = (maxV + pad) - lo;
  const toY  = (v: number) => +(H - ((v - lo) / rng) * H).toFixed(1);

  const polyPts = data
    .map((v, i) => v > 0 ? +((i / (data.length - 1)) * W).toFixed(1) + "," + toY(v) : "")
    .filter(Boolean)
    .join(" ");

  const lastVal = data[data.length - 1];
  const lastY   = lastVal > 0 ? toY(lastVal) : null;
  const refY    = refVal !== undefined ? toY(refVal) : null;

  const a = (k: string, v: string | number) => " " + k + '="' + v + '"';

  let svg =
    "<svg" +
    a("width", "100%") +
    a("viewBox", "0 0 " + W + " " + H) +
    a("overflow", "visible") +
    a("style", "display:block") +
    ">";

  svg +=
    "<polyline" +
    a("points", polyPts) +
    a("fill", "none") +
    a("stroke", color) +
    a("stroke-width", "1.8") +
    a("stroke-linejoin", "round") +
    a("stroke-linecap", "round") +
    "/>";

  if (refY !== null && refY >= -4 && refY <= H + 4) {
    svg +=
      "<line" +
      a("x1", "0") + a("y1", refY) + a("x2", W) + a("y2", refY) +
      a("stroke", color) +
      a("stroke-width", "0.8") +
      a("stroke-dasharray", "3 2") +
      a("opacity", "0.4") +
      "/>";
  }

  if (lastY !== null) {
    svg += "<circle" + a("cx", W) + a("cy", lastY) + a("r", "3") + a("fill", color) + "/>";
  }

  svg += "</svg>";
  return svg;
}
