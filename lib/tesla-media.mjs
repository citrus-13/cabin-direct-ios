/** Tesla vehicle-command protojson; time units intentionally require local confirmation. */
const field = (obj, snake) => {
  const camel = snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  for (const key of [snake, camel]) if (Object.hasOwn(obj, key)) return obj[key];
  for (const key of [`optional_${snake}`, `optional${camel[0].toUpperCase()}${camel.slice(1)}`]) {
    if (obj[key] && typeof obj[key] === 'object') return field(obj[key], snake);
  }
};
function unwrap(input, name) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Missing Tesla media state');
  const data = field(input, 'vehicle_data') ?? input;
  return field(data, name) ?? data;
}
function requiredText(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError('Missing or invalid Tesla track metadata');
  return value.trim();
}
function seconds(value, divisor) {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '' || !/^\d+(\.\d+)?$/.test(String(value))) throw new TypeError('Missing or invalid Tesla media time');
  const result = Number(value) / divisor;
  if (!Number.isFinite(result) || result < 0 || result > 86400) throw new TypeError('Tesla media time exceeds limit');
  return result;
}
export function normalizeTeslaMedia(media, detail, { timeUnit, observedAt = Date.now() } = {}) {
  if (!['ms', 's'].includes(timeUnit)) throw new TypeError('Explicit Tesla media time unit is required');
  if (!Number.isSafeInteger(observedAt) || observedAt < 0) throw new TypeError('Invalid observation timestamp');
  const state = unwrap(media, 'media_state');
  const extra = unwrap(detail, 'media_detail_state');
  const rawStatus = field(state, 'media_playback_status');
  const status = ({ Stopped: 0, Playing: 1, Paused: 2 })[rawStatus] ?? rawStatus;
  if (![0, 1, 2].includes(status)) throw new TypeError('Missing or invalid Tesla playback status');
  const divisor = timeUnit === 'ms' ? 1000 : 1;
  const duration = seconds(field(extra, 'now_playing_duration'), divisor);
  const position = seconds(field(extra, 'now_playing_elapsed'), divisor);
  if (duration <= 0 || position > duration) throw new TypeError('Inconsistent Tesla media times');
  return { title: requiredText(field(state, 'now_playing_title')), artist: requiredText(field(state, 'now_playing_artist')),
    duration, position, playing: status === 1, sentAt: observedAt };
}
