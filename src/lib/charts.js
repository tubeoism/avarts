// Shared Chart.js plugins/palettes for the Dashboard and Stats pages, so both stay visually
// identical without duplicating the canvas-pattern code.

/** Categorical palette for chart series that need genuinely different hues (not a single-hue
 * light->dark ramp) - e.g. one series per calendar year, or per race distance - kept clear of
 * every hue in ACTIVITY_COLORS (format.js) so a viewer never mistakes a series color for an
 * activity-type color used elsewhere in the app. 7 slots is the practical ceiling: validated with
 * the dataviz skill's palette validator (lightness band, chroma floor, CVD separation, contrast -
 * all pairs), the yellow-green band can only safely hold ONE hue once red-green color blindness
 * is accounted for, and the app's own oranges/teals/blues/purple already claim most of the rest
 * of the hue wheel. Callers needing more than 7 series reuse a slot via seriesVisual() below. */
export const EXTRA_SERIES_COLORS = {
  light: ['#9c7f0d', '#126821', '#2140ba', '#8254de', '#ab2bab', '#bd288c', '#da2f68'],
  dark: ['#a5870d', '#29a33d', '#6781e9', '#7d4eda', '#c841c8', '#d043a1', '#d4356a'],
};

const EXTRA_POINT_STYLES = ['circle', 'triangle', 'rectRot', 'rect', 'star'];

/** The chart canvases on /stats and /performance carry their data as JSON in data-* attributes
 * (written at build time by the page frontmatter); these three helpers are the shared way both
 * pages read a canvas back. */
export function readCanvas(id) {
  const el = document.getElementById(id);
  return el instanceof HTMLCanvasElement ? el : null;
}

export function dataOf(el, key) {
  return JSON.parse(el.dataset[key] || 'null');
}

/** Maps every calendar year (oldest first, from the canvas's shared `data-years`) to its palette
 * slot index - the SAME index for a given year on every "one series per calendar year" chart,
 * across pages: /stats and /performance both derive `data-years` from the full activity history
 * the same way, so e.g. 2023 is always the same seriesVisual() color regardless of which chart,
 * page, or activity-type/metric filter is showing it, rather than each chart independently
 * indexing just the years it happens to have data for. */
export function yearIndexOf(canvas) {
  return new Map(dataOf(canvas, 'years').map((year, i) => [year, i]));
}

// Shared value formatters for per-activity metric fields (avg HR/watts/cadence/elevation/pace/
// distance) - used by the metric-vs-time heatmap and metric-correlation scatters on /stats and
// /performance, which draw on the same underlying per-activity fields.
export const fmtInt = (v) => String(Math.round(v));
export const fmtPace = (v) => {
  const totalSec = Math.round(v * 60);
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`;
};
export const identity = (v) => v;

/** Assigns the Nth series (0-indexed, in whatever fixed order the caller iterates - e.g. oldest
 * year first, shortest distance first) a color from EXTRA_SERIES_COLORS. Once there are more
 * series than colors (9 calendar years or 10 best-effort distances against a 7-color palette),
 * cycles back through the same colors with a different point shape (scatter) / dash (line) so the
 * reused hue still reads as a distinct series. */
export function seriesVisual(index, mode) {
  const palette = EXTRA_SERIES_COLORS[mode] || EXTRA_SERIES_COLORS.light;
  const lap = Math.floor(index / palette.length);
  return {
    color: palette[index % palette.length],
    pointStyle: EXTRA_POINT_STYLES[lap % EXTRA_POINT_STYLES.length],
    dashed: lap > 0,
  };
}

/** Chart.js plugin: draws the formatted value past the end of each bar in a single-dataset
 * horizontal bar chart (indexAxis: 'y') - Chart.js has no built-in data-label support, and this
 * app doesn't otherwise depend on chartjs-plugin-datalabels, so a small canvas plugin (same
 * approach as tsbZonesPlugin below) covers the one thing it's needed for here. `formatter(index)`
 * receives the bar's index into the dataset and returns the label text (or null/undefined to
 * skip that bar). */
export function barValueLabelsPlugin({ color, formatter }) {
  return {
    id: 'barValueLabels',
    afterDatasetsDraw(chart) {
      if (!chart.isDatasetVisible(0)) return;
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      ctx.save();
      ctx.fillStyle = color;
      ctx.font = "600 12px 'Be Vietnam Pro', system-ui, sans-serif";
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      meta.data.forEach((bar, index) => {
        const text = formatter(index);
        if (text == null) return;
        const tipX = Math.max(bar.x, bar.base);
        ctx.fillText(text, tipX + 6, bar.y);
      });
      ctx.restore();
    },
  };
}

/** TSB (Form) bands, drawn as faint diagonal stripes behind the line series on the TSB axis -
 * per training-load convention, TSB in [-20,-5] reads as the sweet spot for productive
 * ("optimal") training load, [-5,10] as freshness/recovery. */
export const TSB_ZONES = [
  { from: -20, to: -5, color: 'rgba(76, 175, 80, 0.55)', labelKey: 'chart.tsbZoneOptimal' },
  { from: -5, to: 10, color: 'rgba(33, 150, 243, 0.55)', labelKey: 'chart.tsbZoneRecovery' },
];

function stripePattern(ctx, strokeStyle) {
  const size = 10;
  const patternCanvas = document.createElement('canvas');
  patternCanvas.width = size;
  patternCanvas.height = size;
  const pctx = patternCanvas.getContext('2d');
  pctx.strokeStyle = strokeStyle;
  pctx.lineWidth = 1.5;
  pctx.beginPath();
  pctx.moveTo(0, size);
  pctx.lineTo(size, 0);
  pctx.moveTo(-size / 2, size / 2);
  pctx.lineTo(size / 2, -size / 2);
  pctx.moveTo(size / 2, size * 1.5);
  pctx.lineTo(size * 1.5, size / 2);
  pctx.stroke();
  return ctx.createPattern(patternCanvas, 'repeat');
}

/** Chart.js plugin: fills `zones` (in the plotted metric's own data units) as diagonal-stripe
 * bands clipped to the chart area, positioned via the named y-axis (defaults to 'y1', where TSB
 * is plotted). Charts in this app are always destroyed and recreated on theme change (see
 * onThemeChange in lib/theme.js), so a fresh plugin instance per Chart construction is safe -
 * nothing here is cached across draws. When `datasetIndex` is given, the zones only draw while
 * that dataset (the TSB line) is visible - toggling it off via the legend hides its axis's
 * meaning along with the shading, rather than leaving orphaned bands with no TSB line to explain.
 * beforeDatasetsDraw re-runs on every legend toggle (Chart.js redraws the whole chart), so this
 * needs no extra event wiring of its own. */
export function tsbZonesPlugin(zones, { axisId = 'y1', datasetIndex } = {}) {
  return {
    id: 'tsbZones',
    beforeDatasetsDraw(chart) {
      if (datasetIndex != null && !chart.isDatasetVisible(datasetIndex)) return;
      const { ctx, chartArea, scales } = chart;
      const scale = scales[axisId];
      if (!chartArea || !scale) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(chartArea.left, chartArea.top, chartArea.right - chartArea.left, chartArea.bottom - chartArea.top);
      ctx.clip();
      for (const zone of zones) {
        const yTop = Math.max(chartArea.top, scale.getPixelForValue(zone.to));
        const yBottom = Math.min(chartArea.bottom, scale.getPixelForValue(zone.from));
        if (yBottom <= yTop) continue;
        ctx.fillStyle = stripePattern(ctx, zone.color);
        ctx.fillRect(chartArea.left, yTop, chartArea.right - chartArea.left, yBottom - yTop);
      }
      ctx.restore();
    },
  };
}
