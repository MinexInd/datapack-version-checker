/**
 * Community-curated knowledge of version changes specific to resource packs.
 *
 * The rule DATA now lives in the single source of truth (./rules.js); this
 * module re-exports the historical view + type so existing importers keep
 * working unchanged.
 */
export { RESOURCE_FEATURE_RULES, type ResourceFeatureRule } from './rules.js'
