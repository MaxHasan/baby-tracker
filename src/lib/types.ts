// Two-axis feed model — delivery and substance are independent. Never merge.
export type FeedDelivery = 'breast' | 'bottle';
export type FeedSubstance = 'breast_milk' | 'formula';
export type BreastSide = 'L' | 'R' | 'both';

export interface Feed {
  id: string;
  child_id: string;
  ts: string;
  delivery: FeedDelivery;
  substance: FeedSubstance;
  volume_ml: number | null;
  duration_min: number | null;
  side: BreastSide | null;
  note: string | null;
}

export interface Pump {
  id: string;
  child_id: string;
  ts: string;
  left_ml: number | null;
  right_ml: number | null;
  total_ml: number;
  duration_min: number | null;
  note: string | null;
}

export interface Diaper {
  id: string;
  child_id: string;
  ts: string;
  wet: boolean;
  dirty: boolean;
  stool_colour: string | null;
  note: string | null;
}

export interface Sleep {
  id: string;
  child_id: string;
  start_ts: string;
  end_ts: string | null;
  note: string | null;
}

export interface Growth {
  id: string;
  child_id: string;
  measured_at: string;
  weight_g: number | null;
  length_cm: number | null;
  head_cm: number | null;
  note: string | null;
}

export interface Child {
  id: string;
  name: string;
  dob: string;
  birth_weight_g: number | null;
}

// Semantic colors — identical to the Phase 1 Sheet (it is the viz spec).
export const COLORS = {
  direct: '#C75B7A',
  ebm: '#2E86AB',
  formula: '#E8973A',
  sleep: '#7A6FB3',
  wet: '#4C9BD4',
  dirty: '#8B6F47',
  left: '#2E86AB',  // pump L — deep blue (all pumped milk is EBM)
  right: '#7FC5E0', // pump R — light blue
  grey: '#9E9E9E',
} as const;

export const TARGET_ML_PER_KG = 150;
// Daily requirement ramps up over the first week: ~60 mL/kg on day 0 rising
// to the full 150 mL/kg by ~day 7 (standard newborn feeding guidance).
export const TARGET_ML_PER_KG_BIRTH = 60;
export const TARGET_RAMP_DAYS = 7;

/** Target mL per kg for a given age in days (60→150 over the first week). */
export function targetMlPerKg(ageDays: number): number {
  const t = Math.min(1, Math.max(0, ageDays / TARGET_RAMP_DAYS));
  return Math.round(TARGET_ML_PER_KG_BIRTH + (TARGET_ML_PER_KG - TARGET_ML_PER_KG_BIRTH) * t);
}

// Direct-breast intake can't be measured, so we estimate it PER FEED, not per
// minute. Kent et al. 2006 (Pediatrics 117(3):e387) measured a mean of 76 mL
// transferred per breastfeed (range 0–240) in exclusively breastfed infants;
// crucially, transfer is front-loaded, so intake does NOT scale linearly with
// time at the breast — a per-minute model badly over/under-estimates.
// Defaulted to 90 mL/feed: the population mean adjusted up for a heavier-feeding baby, whose
// measured bottle volumes and rapid weight gain put her above the average.
export const DIRECT_ML_PER_FEED = 90;
export const DIRECT_FEED_MEAN_KENT = 76; // population mean, for the disclaimer
// Physiological spread is wide (0–240 mL/feed); band shown as ±40%.
export const DIRECT_BAND = 0.4;

// The Kent norm describes ESTABLISHED lactation (her cohort was 1–6 months).
// Days 0–2 are colostrum (single-digit mL per feed); volumes climb through
// lactogenesis II (~day 3–5) and approach the norm by ~day 14. Audit of
// a real week-1 log showed the flat norm overstating direct
// intake up to 10× (e.g. day 1: 11 marathon feeds × 90 = 990 mL "taken").
// Fraction of the per-feed norm by age in days, linearly interpolated:
const DIRECT_RAMP: [ageDays: number, fraction: number][] = [
  [0, 0.10], [1, 0.12], [2, 0.18], [3, 0.33], [4, 0.50], [5, 0.60], [7, 0.75], [14, 1],
];

/** Modeled mL transferred per direct breastfeed at a given age in days. */
export function directMlPerFeed(ageDays: number): number {
  const a = Math.max(0, ageDays);
  let frac = 1;
  for (let i = 0; i < DIRECT_RAMP.length - 1; i++) {
    const [d0, f0] = DIRECT_RAMP[i];
    const [d1, f1] = DIRECT_RAMP[i + 1];
    if (a <= d1) {
      frac = f0 + ((a - d0) / (d1 - d0)) * (f1 - f0);
      break;
    }
  }
  return Math.round(DIRECT_ML_PER_FEED * frac);
}
