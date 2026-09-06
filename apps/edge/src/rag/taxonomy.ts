export const TAXONOMY_RULE_VERSION = 'taxonomy-p0-v1';

// @req TAX-FR-001 — the controlled category vocabulary and its aliases.
// @req TAX-FR-002 — name parsing into reproducible components and signatures.
// @req TAX-FR-003 — family assignment with explainable evidence and an explicit unclassified bucket.
// @req TAX-NFR-001 — classification is deterministic — a pinned rule version and pure text rules, so a repeat run assigns the same families.

export type TaxonomyAssignmentStatus =
  | 'auto'
  | 'review_required'
  | 'approved'
  | 'unclassified';

export interface TaxonomyComponent {
  categoryId: string;
  matchedAlias: string;
  sourcePhrase: string;
}

export interface TaxonomyMetadata {
  packagingPhrases: string[];
  commercialPhrases: string[];
  seriesPrefix: string | null;
  descriptiveSuffixPresent: boolean;
}

export interface TaxonomyClassification {
  originalName: string;
  normalizedName: string;
  ruleVersion: typeof TAXONOMY_RULE_VERSION;
  status: Exclude<TaxonomyAssignmentStatus, 'approved'>;
  categoryIds: string[];
  componentSignature: string | null;
  components: TaxonomyComponent[];
  metadata: TaxonomyMetadata;
  reviewReasons: string[];
}

interface AliasDefinition {
  categoryId: string;
  aliases: readonly string[];
}

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const VOCABULARY: readonly AliasDefinition[] = [
  {
    categoryId: 'drinkware',
    aliases: [
      'coffee mug',
      'vacuum cup',
      'thermos cup',
      'vacuum flask',
      'tea pot',
      'tumbler',
      'teacup',
      'teapot',
      'mug',
      'cup',
      'flask',
      'bottle',
    ],
  },
  {
    categoryId: 'umbrella',
    aliases: ['manual umbrella', 'paradise umbrella', 'umbrella'],
  },
  {
    categoryId: 'pen',
    aliases: ['fountain pen', 'sign pen', 'pen'],
  },
  {
    categoryId: 'notebook',
    aliases: [
      'loose leaf notebook',
      'account book',
      'a5 notebook',
      'a6 notebook',
      'notebook',
    ],
  },
  {
    categoryId: 'usb_flash_drive',
    aliases: ['usb flash drive', 'flash drive', '16g usb', 'usb'],
  },
  {
    categoryId: 'power_bank',
    aliases: [
      'power bank with phone stand',
      'mag safe power bank',
      'magnetic power bank',
      'four cables power bank',
      'power bank',
    ],
  },
  {
    categoryId: 'fan',
    aliases: [
      'turbo handheld fan',
      'handheld fan',
      'foldable fan',
      'mini fan',
      'neck fan',
      'fan',
    ],
  },
  { categoryId: 'humidifier', aliases: ['humidifier'] },
  { categoryId: 'neck_massager', aliases: ['neck massager'] },
  { categoryId: 'massage_gun', aliases: ['massage gun'] },
  { categoryId: 'hair_dryer', aliases: ['hair dryer'] },
  {
    categoryId: 'speaker',
    aliases: ['bluetooth speaker', 'speaker clock', 'speaker'],
  },
  { categoryId: 'earbuds', aliases: ['earbuds'] },
  { categoryId: 'headset', aliases: ['headset'] },
  { categoryId: 'smart_bracelet', aliases: ['smart bracelet'] },
  { categoryId: 'mouse', aliases: ['wireless mouse', 'mouse'] },
  { categoryId: 'keyboard', aliases: ['foldable keyboard', 'keyboard'] },
  {
    categoryId: 'bookmark',
    aliases: ['bookmark with tassel', 'cloud shape bookmark', 'bookmark'],
  },
  { categoryId: 'notebook_refill', aliases: ['ink refill', 'refill'] },
  { categoryId: 'name_card_holder', aliases: ['name card holder'] },
  { categoryId: 'key_chain', aliases: ['key chain', 'keychain'] },
  { categoryId: 'briefcase', aliases: ['briefcase'] },
  { categoryId: 'bag', aliases: ['business organizer bag', 'bag'] },
  {
    categoryId: 'charger',
    aliases: ['wireless charger', 'car charger', 'charging mount', 'charger'],
  },
  {
    categoryId: 'car_accessory',
    aliases: ['car wireless charging mount', 'car parking dual number plate'],
  },
  { categoryId: 'towel', aliases: ['towel'] },
  { categoryId: 'glove', aliases: ['glove'] },
  {
    categoryId: 'massage_comb',
    aliases: ['electric massage comb', 'massage comb'],
  },
  {
    categoryId: 'coffee_maker',
    aliases: ['pour-over coffee maker', 'coffee maker'],
  },
  { categoryId: 'tea_set', aliases: ['tea set'] },
].map((definition) => ({
  ...definition,
  aliases: [...definition.aliases].sort(
    (left, right) => right.length - left.length || compareStable(left, right)
  ),
}));

const PACKAGING_PATTERN =
  /\b(simple dark blue gift bag packing|simple gift bag packing|drawer box packing|gift packing|gift pack|gift set|gift box|gift bag)\b/gi;
const COMMERCIAL_PATTERN = /\bMOQ\s+\d+\s+SETS?\b/gi;

function addUnique(items: string[], value: string): void {
  if (!items.includes(value)) items.push(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^()|[\]\\]/g, '\\$&');
}

function containsAlias(segment: string, alias: string): boolean {
  const expression = new RegExp(
    '(^|[^a-z0-9])' + escapeRegExp(alias) + '($|[^a-z0-9])',
    'i'
  );
  return expression.test(segment);
}

function knownPrefix(prefix: string): boolean {
  return /(?:series|happy\s+[a-z' ]+\s+day|new\s+year|merry\s+christmas)/i.test(
    prefix
  );
}

function normalizeSeparators(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s*\+\s*/g, ' + ')
    .replace(/\s*&\s*/g, ' & ')
    .replace(/\s*·\s*/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTaxonomyText(value: string): string {
  return normalizeSeparators(value);
}

function removeMetadata(normalizedName: string): {
  workingName: string;
  metadata: TaxonomyMetadata;
  reviewReasons: string[];
} {
  let workingName = normalizedName;
  const packagingPhrases: string[] = [];
  const commercialPhrases: string[] = [];
  const reviewReasons: string[] = [];

  workingName = workingName.replace(PACKAGING_PATTERN, (phrase) => {
    addUnique(packagingPhrases, phrase.toLowerCase());
    return ' ';
  });

  workingName = workingName.replace(COMMERCIAL_PATTERN, (phrase) => {
    addUnique(commercialPhrases, phrase.toLowerCase());
    addUnique(reviewReasons, 'commercial_text');
    return ' ';
  });

  workingName = workingName.replace(/\s*\(moq[^)]*\)/gi, (phrase) => {
    addUnique(commercialPhrases, phrase.trim().toLowerCase());
    addUnique(reviewReasons, 'commercial_text');
    return ' ';
  });

  if (!/\btea set\b/i.test(workingName)) {
    workingName = workingName.replace(/\s+\bset\b(?=\s*(?:\+|$))/gi, (phrase) => {
      addUnique(packagingPhrases, phrase.trim().toLowerCase());
      return ' ';
    });
  }

  workingName = workingName.replace(/\s+(?:with|in)\s*$/i, '');

  const dotIndex = workingName.indexOf(' · ');
  const descriptiveSuffixPresent = dotIndex >= 0;
  if (descriptiveSuffixPresent) workingName = workingName.slice(0, dotIndex);

  let seriesPrefix: string | null = null;
  const colonIndex = workingName.indexOf(':');
  if (colonIndex >= 0) {
    const prefix = workingName.slice(0, colonIndex).trim();
    seriesPrefix = prefix || null;
    if (prefix && knownPrefix(prefix)) {
      addUnique(reviewReasons, 'series_prefix');
      workingName = workingName.slice(colonIndex + 1).trim();
    } else {
      addUnique(reviewReasons, 'unknown_prefix');
      workingName = workingName.slice(colonIndex + 1).trim();
    }
  }

  if (descriptiveSuffixPresent) workingName = workingName.trim();
  if (commercialPhrases.length > 0) {
    addUnique(reviewReasons, 'commercial_text');
  }

  return {
    workingName,
    metadata: {
      packagingPhrases,
      commercialPhrases,
      seriesPrefix,
      descriptiveSuffixPresent,
    },
    reviewReasons,
  };
}

function matchesCategory(segment: string, definition: AliasDefinition): string | null {
  if (
    (definition.categoryId === 'mouse' && /\bmouse\s+pad\b/i.test(segment)) ||
    (definition.categoryId === 'bag' && /\bcard\s+bag\b/i.test(segment)) ||
    (definition.categoryId === 'drinkware' && /\bworld\s+cup\b/i.test(segment))
  ) {
    return null;
  }

  return (
    definition.aliases.find((alias) => containsAlias(segment, alias)) || null
  );
}

function classifySegment(segment: string): TaxonomyComponent[] {
  const components: TaxonomyComponent[] = [];
  for (const definition of VOCABULARY) {
    const matchedAlias = matchesCategory(segment, definition);
    if (matchedAlias) {
      components.push({
        categoryId: definition.categoryId,
        matchedAlias,
        sourcePhrase: segment,
      });
    }
  }
  return components;
}

export function classifyTaxonomyName(name: string): TaxonomyClassification {
  const originalName = name;
  const normalizedName = normalizeTaxonomyText(name);
  if (!normalizedName) {
    return {
      originalName,
      normalizedName,
      ruleVersion: TAXONOMY_RULE_VERSION,
      status: 'unclassified',
      categoryIds: [],
      componentSignature: null,
      components: [],
      metadata: {
        packagingPhrases: [],
        commercialPhrases: [],
        seriesPrefix: null,
        descriptiveSuffixPresent: false,
      },
      reviewReasons: ['missing_name'],
    };
  }

  const parsed = removeMetadata(normalizedName);
  const reviewReasons = [...parsed.reviewReasons];
  if (parsed.workingName.includes(' & ')) {
    addUnique(reviewReasons, 'ampersand_separator');
  }

  const segments = parsed.workingName
    .split(/\s*(?:\+|&)\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const segmentComponents = segments.map(classifySegment);
  const components = segmentComponents.flat();

  if (segmentComponents.some((segment) => segment.length === 0)) {
    addUnique(reviewReasons, 'unmatched_component');
  }
  if (!/[+&]/.test(parsed.workingName) && segments.length === 1 && components.length > 1) {
    addUnique(reviewReasons, 'implicit_separator');
  }

  const componentCategoryIds = components.map((component) => component.categoryId);
  const categoryIds = [...new Set(componentCategoryIds)].sort(compareStable);

  if (componentCategoryIds.some((categoryId, index) =>
    componentCategoryIds.indexOf(categoryId) !== index
  )) {
    addUnique(reviewReasons, 'duplicate_component');
  }

  if (
    components.some((component) => component.matchedAlias === 'refill') ||
    components.some((component) => component.matchedAlias === 'card bag') ||
    components.some((component) => component.matchedAlias === 'speaker clock') ||
    /(?:^|\s)car\s+/i.test(parsed.workingName) ||
    /\b(?:mouse\s+pad|card\s+bag)\b/i.test(parsed.workingName)
  ) {
    addUnique(reviewReasons, 'ambiguous_context');
  }

  const componentSignature =
    components.length > 0
      ? [...componentCategoryIds].sort(compareStable).join('+')
      : null;

  const status: Exclude<TaxonomyAssignmentStatus, 'approved'> =
    categoryIds.length === 0
      ? reviewReasons.includes('ambiguous_context')
        ? 'review_required'
        : 'unclassified'
      : reviewReasons.length > 0
        ? 'review_required'
        : 'auto';

  return {
    originalName,
    normalizedName,
    ruleVersion: TAXONOMY_RULE_VERSION,
    status,
    categoryIds,
    componentSignature,
    components,
    metadata: parsed.metadata,
    reviewReasons,
  };
}
