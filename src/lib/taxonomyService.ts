/**
 * Solarithm Insight - Dynamic Taxonomy Resolution Engine
 * Fulfills Admin Console Firestore Contracts:
 * - Subscribes to dedicated taxonomy documents (/metadata/taxonomies, /config/pricing)
 * - Subscribes to taxonomy collections (/scopes, /pricingCategories, /pricingRules)
 * - Dynamically derives unique canonical scope & category options from live Firestore records
 * - Tokenizes compound scopes (joined by '+') and reassembles with exact taxonomy casing
 */

'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  collection, 
  doc, 
  onSnapshot, 
  getDoc 
} from 'firebase/firestore';
import { db } from '@/src/lib/firebase';
import { COLLECTIONS } from '@/src/config/schema';

/**
 * Normalizes a token string for flexible matching (strips non-alphanumeric, lowercases)
 */
export function normalizeTokenKey(token: string): string {
  return String(token || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Resolves a single scope token against dynamic canonical scopes list
 * Returns exact canonical casing from live Firestore taxonomy records,
 * or preserves the original token from the database without destructive reformatting.
 */
export function resolveSingleScopeToken(token: string, canonicalMap: Map<string, string>): string {
  const trimmed = String(token || '').trim();
  if (!trimmed) return '';

  const exactKey = trimmed.toLowerCase();
  const strippedKey = normalizeTokenKey(trimmed);

  if (canonicalMap.has(exactKey)) {
    return canonicalMap.get(exactKey)!;
  }
  if (canonicalMap.has(strippedKey)) {
    return canonicalMap.get(strippedKey)!;
  }

  // Preserve the exact stored canonical string from Firestore
  return trimmed;
}

/**
 * Resolves compound scope strings (e.g. joined by '+')
 * 1. Tokenizes by '+'
 * 2. Trims whitespace
 * 3. Resolves each segment against dynamic canonical scope taxonomy
 * 4. Reassembles using exact casing declared in taxonomy (e.g., 'Pre-Design + PVsyst + CEIG + IFP')
 */
export function resolveCompoundScope(
  rawScope: string | undefined | null,
  canonicalMap?: Map<string, string>
): string {
  if (!rawScope || typeof rawScope !== 'string') return '';
  const trimmed = rawScope.trim();
  if (!trimmed) return '';

  // Check if compound scope joined by '+'
  if (trimmed.includes('+')) {
    const activeMap = canonicalMap || new Map<string, string>();
    return trimmed
      .split('+')
      .map((segment) => resolveSingleScopeToken(segment, activeMap))
      .filter(Boolean)
      .join(' + ');
  }

  // Single scope
  if (canonicalMap) {
    return resolveSingleScopeToken(trimmed, canonicalMap);
  }

  const baselineMap = new Map<string, string>();
  return resolveSingleScopeToken(trimmed, baselineMap);
}

/**
 * Splits compound scope into individual resolved segments
 */
export function getCompoundScopeBreakdown(
  rawScope: string | undefined | null,
  canonicalMap?: Map<string, string>
): string[] {
  if (!rawScope) return [];
  const resolved = resolveCompoundScope(rawScope, canonicalMap);
  if (!resolved) return [];

  if (resolved.includes('+')) {
    return resolved.split('+').map((s) => s.trim()).filter(Boolean);
  }
  if (resolved.includes(',')) {
    return resolved.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [resolved];
}

/**
 * Normalizes a category / tier key for grouping duplicates:
 * - Trims and lowercases
 * - Normalizes letter 'o' vs digit '0' when in tier prefixes (e.g., 'to bhimani' -> 't0 bhimani', 'to' -> 't0')
 * - Merges consecutive whitespaces
 */
export function normalizeCategoryKey(raw: string | undefined | null): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .trim()
    .toLowerCase()
    .replace(/^to(\s|$|-|_)/, 't0$1')
    .replace(/\bto\b/g, 't0')
    .replace(/\s+/g, ' ');
}

/**
 * Resolves a category string against canonical entries defined in Admin Console:
 * - Matches normalized key
 * - First checks Admin Console / config list
 * - Falls back to known canonical standards (e.g. 'T0 Bhimani', 'T7k', 'T1'..'T8')
 * - Falls back to raw trimmed string
 */
export function resolveCanonicalCategory(
  rawCat: string | undefined | null,
  canonicalList: string[] = []
): string {
  if (!rawCat || typeof rawCat !== 'string') return '';
  const trimmed = rawCat.trim();
  if (!trimmed) return '';
  const normKey = normalizeCategoryKey(trimmed);

  // 1. Highest priority: Defined canonical entry in Admin Console
  const adminMatch = canonicalList.find((c) => normalizeCategoryKey(c) === normKey);
  if (adminMatch) {
    return adminMatch;
  }

  // 2. Standard canonical formatting for well-known tier names
  if (normKey === 't0 bhimani') return 'T0 Bhimani';
  if (normKey === 't7k') return 'T7k';
  const tierMatch = normKey.match(/^t(\d+)(.*)$/);
  if (tierMatch) {
    const num = tierMatch[1];
    const suffix = tierMatch[2].trim();
    if (!suffix) return `T${num}`;
    return `T${num} ${suffix.charAt(0).toUpperCase() + suffix.slice(1)}`;
  }

  return trimmed;
}

export interface DynamicTaxonomyState {
  canonicalScopes: string[];
  canonicalCategories: string[];
  canonicalSubServices: string[];
  scopeCanonicalMap: Map<string, string>;
  categoryCanonicalMap: Map<string, string>;
  rules: any[];
  isLoading: boolean;
  resolveScope: (raw: string) => string;
  resolveCategory: (raw: string) => string;
  getScopeBreakdown: (raw: string) => string[];
}

/**
 * React Hook: Subscribes to Firestore taxonomy contracts in real-time
 * - Dedicated documents: /metadata/taxonomies, /config/pricing
 * - Dedicated collections: /scopes, /pricingCategories, /pricingRules
 */
export function useDynamicTaxonomy(externalRules?: any[]): DynamicTaxonomyState {
  const [dedicatedTaxonomyDoc, setDedicatedTaxonomyDoc] = useState<any | null>(null);
  const [dedicatedConfigDoc, setDedicatedConfigDoc] = useState<any | null>(null);
  const [firestoreScopes, setFirestoreScopes] = useState<any[]>([]);
  const [firestoreCategories, setFirestoreCategories] = useState<any[]>([]);
  const [firestoreRules, setFirestoreRules] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!db) {
      setIsLoading(false);
      return;
    }

    const unsubs: (() => void)[] = [];

    // 1. Subscribe to /metadata/taxonomies dedicated document
    try {
      const unsubMeta = onSnapshot(
        doc(db, 'metadata', 'taxonomies'),
        (snapshot) => {
          if (snapshot.exists()) {
            setDedicatedTaxonomyDoc(snapshot.data());
          }
        },
        () => {
          // Graceful fallback if doc does not exist
        }
      );
      unsubs.push(unsubMeta);
    } catch {
      // Optional doc
    }

    // 2. Subscribe to /config/pricing dedicated document
    try {
      const unsubConfig = onSnapshot(
        doc(db, 'config', 'pricing'),
        (snapshot) => {
          if (snapshot.exists()) {
            setDedicatedConfigDoc(snapshot.data());
          }
        },
        () => {
          // Graceful fallback
        }
      );
      unsubs.push(unsubConfig);
    } catch {
      // Optional doc
    }

    // 3. Subscribe to /scopes collection
    try {
      const unsubScopes = onSnapshot(
        collection(db, COLLECTIONS.SCOPES),
        (snapshot) => {
          const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          setFirestoreScopes(list);
        },
        () => {}
      );
      unsubs.push(unsubScopes);
    } catch {}

    // 4. Subscribe to /pricingCategories collection
    try {
      const unsubCategories = onSnapshot(
        collection(db, COLLECTIONS.PRICING_CATEGORIES),
        (snapshot) => {
          const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          setFirestoreCategories(list);
        },
        () => {}
      );
      unsubs.push(unsubCategories);
    } catch {}

    // 5. Subscribe to /pricingRules collection
    try {
      const unsubRules = onSnapshot(
        collection(db, COLLECTIONS.PRICING_RULES),
        (snapshot) => {
          const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          setFirestoreRules(list);
          setIsLoading(false);
        },
        () => {
          setIsLoading(false);
        }
      );
      unsubs.push(unsubRules);
    } catch {
      setIsLoading(false);
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, []);

  const activeRules = useMemo(() => {
    if (firestoreRules.length > 0) return firestoreRules;
    if (externalRules && Array.isArray(externalRules) && externalRules.length > 0) return externalRules;
    return [];
  }, [firestoreRules, externalRules]);

  // Build Dynamic Scope Canonical Map and Array
  const { canonicalScopes, scopeCanonicalMap } = useMemo(() => {
    const map = new Map<string, string>(); // lowercase/normalized key -> exact canonical string

    const registerScope = (raw: any) => {
      if (!raw || typeof raw !== 'string') return;
      const trimmed = raw.trim();
      if (!trimmed) return;

      // If compound scope, register individual tokens as well
      if (trimmed.includes('+')) {
        trimmed.split('+').forEach((part) => registerScope(part));
      }

      const lowerKey = trimmed.toLowerCase();
      const strippedKey = normalizeTokenKey(trimmed);

      if (!map.has(lowerKey)) {
        map.set(lowerKey, trimmed);
      }
      if (!map.has(strippedKey)) {
        map.set(strippedKey, trimmed);
      }
    };

    // A. From /metadata/taxonomies dedicated document
    if (dedicatedTaxonomyDoc) {
      const scopes = dedicatedTaxonomyDoc.scopes || dedicatedTaxonomyDoc.scopeList || dedicatedTaxonomyDoc.taxonomy?.scopes;
      if (Array.isArray(scopes)) {
        scopes.forEach(registerScope);
      } else if (typeof scopes === 'object' && scopes !== null) {
        Object.values(scopes).forEach(registerScope);
      }
    }

    // B. From /config/pricing dedicated document
    if (dedicatedConfigDoc) {
      const scopes = dedicatedConfigDoc.scopes || dedicatedConfigDoc.scopeOfWork || dedicatedConfigDoc.scopeList;
      if (Array.isArray(scopes)) {
        scopes.forEach(registerScope);
      } else if (typeof scopes === 'object' && scopes !== null) {
        Object.values(scopes).forEach(registerScope);
      }
    }

    // C. From /scopes collection
    firestoreScopes.forEach((s) => {
      const val = s.name || s.scopeOfWork || s.scope || s.label || s.title || s.id;
      registerScope(val);
    });

    // D. From active rules in /pricingRules (derived dynamically)
    activeRules.forEach((r) => {
      const val = r.scopeOfWork || r.scope || r.scopeName || r.name;
      registerScope(val);
    });

    // Extract unique canonical scope names sorted alphabetically
    const uniqueValues = Array.from(new Set(map.values())).sort((a, b) => a.localeCompare(b));

    return {
      canonicalScopes: uniqueValues,
      scopeCanonicalMap: map
    };
  }, [dedicatedTaxonomyDoc, dedicatedConfigDoc, firestoreScopes, activeRules]);

  // Build Dynamic Category Canonical Map and Array
  const { canonicalCategories, categoryCanonicalMap } = useMemo(() => {
    const adminCanonicalList: string[] = [];

    // Helper to register official canonical entries defined in Admin Console
    const registerAdminCanonical = (raw: any) => {
      if (!raw || typeof raw !== 'string') return;
      const trimmed = raw.trim();
      if (!trimmed) return;
      if (!adminCanonicalList.some((existing) => normalizeCategoryKey(existing) === normalizeCategoryKey(trimmed))) {
        adminCanonicalList.push(trimmed);
      }
    };

    // A. From /metadata/taxonomies dedicated doc (Admin Console source of truth)
    if (dedicatedTaxonomyDoc) {
      const cats = dedicatedTaxonomyDoc.categories || dedicatedTaxonomyDoc.tiers || dedicatedTaxonomyDoc.pricingCategories;
      if (Array.isArray(cats)) cats.forEach(registerAdminCanonical);
    }

    // B. From /config/pricing dedicated doc (Admin Console config)
    if (dedicatedConfigDoc) {
      const cats = dedicatedConfigDoc.categories || dedicatedConfigDoc.tiers || dedicatedConfigDoc.pricingCategories;
      if (Array.isArray(cats)) cats.forEach(registerAdminCanonical);
    }

    // C. From /pricingCategories collection (Admin Console taxonomy)
    firestoreCategories.forEach((c) => {
      const val = c.name || c.category || c.tier || c.code || c.id;
      registerAdminCanonical(val);
    });

    const map = new Map<string, string>(); // normalizedKey -> exact canonical string

    // First, map all defined Admin Console canonical categories
    adminCanonicalList.forEach((cat) => {
      const normKey = normalizeCategoryKey(cat);
      if (!map.has(normKey)) {
        map.set(normKey, cat);
      }
    });

    // Second, register unique categories present in active pricingRules
    // Grouping case-insensitive and typographical duplicates under the canonical entry
    activeRules.forEach((r) => {
      const val = r.category || r.pricingCategory || r.tier;
      if (val && typeof val === 'string' && val.trim()) {
        const normKey = normalizeCategoryKey(val);
        if (!map.has(normKey)) {
          // Resolve using canonical rules (e.g., merging T0 BHIMANI / TO Bhimani -> T0 Bhimani, T7K -> T7k)
          const canonical = resolveCanonicalCategory(val, adminCanonicalList);
          map.set(normKey, canonical);
        }
      }
    });

    const uniqueValues = Array.from(new Set(map.values())).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );

    return {
      canonicalCategories: uniqueValues,
      categoryCanonicalMap: map
    };
  }, [dedicatedTaxonomyDoc, dedicatedConfigDoc, firestoreCategories, activeRules]);

  // Dynamic Sub-Services
  const canonicalSubServices = useMemo(() => {
    const set = new Set<string>();
    activeRules.forEach((r) => {
      const raw = r.subService || r.service || r.subServiceName;
      if (raw && typeof raw === 'string' && raw.trim()) {
        set.add(raw.trim());
      }
    });
    if (set.size === 0) {
      set.add('Standard');
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [activeRules]);

  // Memoized resolution helpers
  const resolveScope = useCallback(
    (raw: string) => resolveCompoundScope(raw, scopeCanonicalMap),
    [scopeCanonicalMap]
  );

  const resolveCategory = useCallback(
    (raw: string) => {
      const norm = normalizeCategoryKey(raw);
      return categoryCanonicalMap.get(norm) || resolveCanonicalCategory(raw, canonicalCategories);
    },
    [categoryCanonicalMap, canonicalCategories]
  );

  const getScopeBreakdownHelper = useCallback(
    (raw: string) => getCompoundScopeBreakdown(raw, scopeCanonicalMap),
    [scopeCanonicalMap]
  );

  return {
    canonicalScopes,
    canonicalCategories,
    canonicalSubServices,
    scopeCanonicalMap,
    categoryCanonicalMap,
    rules: activeRules,
    isLoading,
    resolveScope,
    resolveCategory,
    getScopeBreakdown: getScopeBreakdownHelper
  };
}
