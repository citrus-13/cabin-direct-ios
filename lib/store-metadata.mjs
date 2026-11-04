const evidenceKeys = ['device_installation', 'real_replaykit_broadcast', 'device_network_and_stability',
  'accessibility_manual_acceptance', 'publisher_and_urls_confirmed', 'privacy_label_finalized',
  'export_compliance_confirmed', 'content_and_name_rights_confirmed', 'store_screenshots_finalized',
  'app_store_submission_authorized'];
const counts = value => [...value].length;
function requireValue(value, message) { if (!value) throw new Error(message); }
function https(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.hostname.includes('.') &&
      !/^(localhost|127\.|10\.|192\.168\.)/.test(url.hostname);
  } catch { return false; }
}
export function auditStoreMetadata(metadata, version) {
  requireValue(metadata?.schema_version === 1 && metadata.status === 'draft_not_submitted', 'Only a source-reviewed draft is supported');
  requireValue(metadata.version === version && metadata.source_profile === 'screen-companion-v1' &&
    metadata.platform === 'iOS' && metadata.device_family === 'iPhone', 'Metadata profile/version mismatch');
  requireValue(JSON.stringify(metadata.ui_languages) === JSON.stringify(['zh-Hans']) &&
    metadata.listing?.locale === 'zh-Hans', 'Only the implemented Chinese UI is advertised');
  const sizes = {};
  for (const [key, max] of [['name', 30], ['subtitle', 30], ['promotional_text', 170],
    ['description', 4000], ['whats_new', 4000]]) {
    const value = metadata.listing[key];
    requireValue(typeof value === 'string' && value.trim().length > 0 && counts(value) <= max, 'Invalid listing field: ' + key);
    requireValue(!/<\/?[A-Za-z][^>]*>/.test(value), 'Listing fields must be plain text');
    sizes[key] = counts(value);
  }
  requireValue(sizes.name >= 2, 'App name too short');
  const keywords = metadata.listing.keywords;
  requireValue(typeof keywords === 'string' && keywords.length > 0 && Buffer.byteLength(keywords, 'utf8') <= 100 &&
    keywords.split(',').every(word => counts(word.trim()) > 2), 'Keywords exceed byte limit or contain too-short terms');
  sizes.keywords_utf8_bytes = Buffer.byteLength(keywords, 'utf8');
  requireValue(metadata.publisher && metadata.submission_urls && metadata.evidence, 'Missing publisher/URL/evidence records');
  requireValue(evidenceKeys.every(key => typeof metadata.evidence[key] === 'boolean') &&
    Object.keys(metadata.evidence).every(key => evidenceKeys.includes(key)), 'Explicit known evidence fields required');
  const blockers = evidenceKeys.filter(key => !metadata.evidence[key]);
  for (const key of ['public_name', 'public_contact_email', 'review_contact']) {
    const value = metadata.publisher[key];
    requireValue(value === null || (typeof value === 'string' && value.trim().length > 0), 'Invalid publisher field');
    if (value === null) blockers.push('publisher.' + key);
  }
  for (const key of ['privacy_policy', 'support']) {
    const value = metadata.submission_urls[key];
    requireValue(value === null || https(value), 'Expected public HTTPS submission URL');
    if (value === null) blockers.push('submission_urls.' + key);
  }
  if (metadata.age_rating === null) blockers.push('age_rating');
  if (metadata.pricing === null) blockers.push('pricing');
  // This source-only utility cannot certify external evidence or authorize submission.
  return { draft_valid: true, field_sizes: sizes, declared_blockers: blockers,
    declared_inputs_complete: blockers.length === 0, requires_independent_review: true,
    submission_ready: false, app_store_submitted: false };
}
