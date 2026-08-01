/**
 * Community-curated knowledge of Minecraft version changes that break datapacks.
 * This is the "what people say" layer — pack.mcmeta is often wrong, so real
 * compatibility comes from the actual content + known version diffs.
 *
 * The rule DATA now lives in the single source of truth (./rules); this
 * module re-exports the historical view + types so existing importers keep
 * working unchanged.
 */
export { FEATURE_RULES, type FeatureRule, type FeatureType } from './rules'
