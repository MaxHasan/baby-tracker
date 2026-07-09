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
