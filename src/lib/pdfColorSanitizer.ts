/**
 * PDF Color Sanitizer Utility for html2canvas
 * 
 * Tailwind CSS v4 compiles colors using modern CSS Color 4 functions (oklch, oklab).
 * In modern Chromium browsers, getComputedStyle() returns oklab(...) or oklch(...)
 * values which crash html2canvas's internal color parser (which only supports sRGB/HEX/HSL).
 * 
 * This module provides comprehensive multi-layer sanitization:
 * 1. Global interception of `window.getComputedStyle` during capture.
 * 2. Interception of `CSSStyleDeclaration.prototype.getPropertyValue` and color getters.
 * 3. In-iframe sanitization of cloned `<style>` tags and inline styles.
 * 4. High-performance native 2D canvas conversion with mathematical CIE-L*a*b* sRGB fallback.
 */

import html2canvas from 'html2canvas';

/**
 * Converts an oklab or oklch color string to standard sRGB using mathematical conversion
 * as a fail-safe fallback when canvas 2D context is unavailable.
 */
export function convertOklabToRgbFallback(str: string): string {
  try {
    const isOklch = str.toLowerCase().startsWith('oklch');
    const contentMatch = str.match(/\(([^)]+)\)/);
    if (!contentMatch) return '#000000';
    const content = contentMatch[1].trim();

    // Separate color values and optional alpha channel
    const parts = content.split('/');
    const valuesPart = parts[0].trim();
    const alphaPart = parts[1] ? parts[1].trim() : '1';

    const tokens = valuesPart.split(/[\s,]+/).filter(Boolean);
    if (tokens.length < 3) return '#000000';

    let L = parseFloat(tokens[0]);
    if (tokens[0].includes('%')) L = L / 100;

    let alpha = parseFloat(alphaPart);
    if (alphaPart.includes('%')) alpha = alpha / 100;
    if (isNaN(alpha)) alpha = 1;

    let a = 0;
    let b = 0;

    if (isOklch) {
      let C = parseFloat(tokens[1]);
      if (tokens[1].includes('%')) C = (C / 100) * 0.4;
      let H = parseFloat(tokens[2]);
      if (tokens[2].includes('turn')) H = parseFloat(tokens[2]) * 360;
      else if (tokens[2].includes('rad')) H = (parseFloat(tokens[2]) * 180) / Math.PI;
      const hRad = (H * Math.PI) / 180;
      a = C * Math.cos(hRad);
      b = C * Math.sin(hRad);
    } else {
      a = parseFloat(tokens[1]);
      if (tokens[1].includes('%')) a = ((parseFloat(tokens[1]) / 100) - 0.5) * 0.8;
      b = parseFloat(tokens[2]);
      if (tokens[2].includes('%')) b = ((parseFloat(tokens[2]) / 100) - 0.5) * 0.8;
    }

    // Convert OKLab to linear sRGB
    const l_ = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
    const m_ = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
    const s_ = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);

    const rLinear = +4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
    const gLinear = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
    const bLinear = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_;

    const toGamma = (c: number) => {
      const clamped = Math.max(0, Math.min(1, c));
      return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
    };

    const r = Math.round(toGamma(rLinear) * 255);
    const g = Math.round(toGamma(gLinear) * 255);
    const b_ = Math.round(toGamma(bLinear) * 255);

    if (alpha >= 0.999) {
      return `rgb(${r}, ${g}, ${b_})`;
    } else {
      return `rgba(${r}, ${g}, ${b_}, ${Number(alpha.toFixed(3))})`;
    }
  } catch {
    return '#000000';
  }
}

/**
 * Shared canvas for color conversion in browser environments
 */
let sharedCanvasCtx: CanvasRenderingContext2D | null = null;
function getSharedCanvasContext(): CanvasRenderingContext2D | null {
  if (typeof window === 'undefined') return null;
  if (!sharedCanvasCtx) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      sharedCanvasCtx = canvas.getContext('2d');
    } catch {
      sharedCanvasCtx = null;
    }
  }
  return sharedCanvasCtx;
}

const globalColorCache = new Map<string, string>();

/**
 * Sanitizes any color string by converting oklab(...) and oklch(...) expressions
 * to sRGB using canvas fillStyle or mathematical fallback.
 */
export function sanitizeColorValue(
  value: string,
  canvasCtx?: CanvasRenderingContext2D | null,
  cache?: Map<string, string>
): string {
  if (!value || typeof value !== 'string') return value;
  if (!value.includes('oklab') && !value.includes('oklch') && !value.includes('color(')) return value;

  const currentCache = cache || globalColorCache;
  if (currentCache.has(value)) {
    return currentCache.get(value)!;
  }

  const ctx = canvasCtx || getSharedCanvasContext();

  const converted = value.replace(/(?:okl(?:ab|ch)|color)\([^)]+\)/gi, (match) => {
    // 1. Try native browser 2D canvas conversion
    if (ctx) {
      try {
        ctx.fillStyle = '#000000';
        ctx.fillStyle = match;
        const res = ctx.fillStyle;
        if (res && !res.includes('oklab') && !res.includes('oklch') && !res.includes('color(')) {
          return res;
        }
      } catch {}
    }
    // 2. Mathematical fallback for oklab/oklch
    if (match.toLowerCase().startsWith('okl')) {
      return convertOklabToRgbFallback(match);
    }
    return '#000000';
  });

  currentCache.set(value, converted);
  return converted;
}

/**
 * Creates a Proxy around a CSSStyleDeclaration that ensures any color access
 * returns a safe sRGB color string.
 */
export function createSanitizedStyleDeclaration(
  target: CSSStyleDeclaration,
  canvasCtx?: CanvasRenderingContext2D | null,
  colorCache?: Map<string, string>
): CSSStyleDeclaration {
  return new Proxy(target, {
    get(obj, prop) {
      if (prop === 'getPropertyValue') {
        return (propertyName: string): string => {
          const raw = obj.getPropertyValue(propertyName);
          return sanitizeColorValue(raw, canvasCtx, colorCache);
        };
      }
      if (prop === 'item') {
        return (index: number): string => obj.item(index);
      }

      // CRITICAL: Call target[prop] directly (WITHOUT receiver) so that native
      // getters on CSSStyleDeclaration.prototype execute with `this` bound to `target`
      let val: any;
      try {
        val = (obj as any)[prop];
      } catch {
        return '';
      }

      if (typeof val === 'function') {
        return val.bind(obj);
      }

      if (typeof val === 'string' && (val.includes('oklab') || val.includes('oklch') || val.includes('color('))) {
        return sanitizeColorValue(val, canvasCtx, colorCache);
      }

      return val;
    }
  });
}

/**
 * Color property names frequently accessed during html2canvas parsing
 */
const COLOR_PROP_NAMES = [
  'color',
  'backgroundColor',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'outlineColor',
  'boxShadow',
  'textShadow',
  'textDecorationColor',
  'webkitTextStrokeColor',
  'fill',
  'stroke'
];

let activeSanitizationDepth = 0;
let originalWindowGetComputedStyle: typeof window.getComputedStyle | null = null;
let originalGetPropertyValue: typeof CSSStyleDeclaration.prototype.getPropertyValue | null = null;
const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();

/**
 * Wraps an async operation with global CSS style declaration and getComputedStyle interception.
 * This guarantees that whenever html2canvas inspects any element (in parent or cloned window),
 * all colors are converted to sRGB.
 */
export async function withColorSanitization<T>(action: () => Promise<T>): Promise<T> {
  if (typeof window === 'undefined') {
    return await action();
  }

  const ctx = getSharedCanvasContext();

  if (activeSanitizationDepth === 0) {
    // 1. Intercept window.getComputedStyle
    originalWindowGetComputedStyle = window.getComputedStyle;
    window.getComputedStyle = function (elt: Element, pseudoElt?: string | null): CSSStyleDeclaration {
      const original = originalWindowGetComputedStyle!.call(window, elt, pseudoElt);
      return createSanitizedStyleDeclaration(original, ctx, globalColorCache);
    };

    // 2. Intercept CSSStyleDeclaration.prototype.getPropertyValue
    if (window.CSSStyleDeclaration && window.CSSStyleDeclaration.prototype) {
      originalGetPropertyValue = window.CSSStyleDeclaration.prototype.getPropertyValue;
      window.CSSStyleDeclaration.prototype.getPropertyValue = function (prop: string): string {
        const raw = originalGetPropertyValue!.call(this, prop);
        if (typeof raw === 'string' && (raw.includes('oklab') || raw.includes('oklch') || raw.includes('color('))) {
          return sanitizeColorValue(raw, ctx, globalColorCache);
        }
        return raw;
      };

      // 3. Intercept explicit color getters on CSSStyleDeclaration.prototype
      for (const prop of COLOR_PROP_NAMES) {
        try {
          const desc = Object.getOwnPropertyDescriptor(window.CSSStyleDeclaration.prototype, prop);
          originalDescriptors.set(prop, desc);
          if (desc && desc.get) {
            const origGet = desc.get;
            Object.defineProperty(window.CSSStyleDeclaration.prototype, prop, {
              ...desc,
              get: function () {
                const val = origGet.call(this);
                if (typeof val === 'string' && (val.includes('oklab') || val.includes('oklch') || val.includes('color('))) {
                  return sanitizeColorValue(val, ctx, globalColorCache);
                }
                return val;
              }
            });
          }
        } catch {}
      }
    }
  }

  activeSanitizationDepth++;

  try {
    return await action();
  } finally {
    activeSanitizationDepth--;
    if (activeSanitizationDepth === 0) {
      // Restore window.getComputedStyle
      if (originalWindowGetComputedStyle) {
        window.getComputedStyle = originalWindowGetComputedStyle;
        originalWindowGetComputedStyle = null;
      }

      // Restore CSSStyleDeclaration.prototype.getPropertyValue
      if (originalGetPropertyValue && window.CSSStyleDeclaration?.prototype) {
        window.CSSStyleDeclaration.prototype.getPropertyValue = originalGetPropertyValue;
        originalGetPropertyValue = null;
      }

      // Restore color getters
      if (window.CSSStyleDeclaration?.prototype) {
        for (const [prop, desc] of originalDescriptors.entries()) {
          try {
            if (desc) {
              Object.defineProperty(window.CSSStyleDeclaration.prototype, prop, desc);
            }
          } catch {}
        }
        originalDescriptors.clear();
      }
    }
  }
}

/**
 * Configures the html2canvas cloned document to intercept and sanitize
 * all getComputedStyle, stylesheet rules, and inline CSS color values.
 */
export function setupHtml2CanvasColorSanitizer(clonedDoc: Document): void {
  if (!clonedDoc) return;

  const ctx = getSharedCanvasContext();

  // 1. Proxy getComputedStyle on the cloned document's iframe window if distinct
  const clonedWindow = clonedDoc.defaultView;
  if (clonedWindow && clonedWindow !== window) {
    try {
      const origClonedGetComputedStyle = clonedWindow.getComputedStyle.bind(clonedWindow);
      clonedWindow.getComputedStyle = function (elt: Element, pseudoElt?: string | null): CSSStyleDeclaration {
        const originalStyles = origClonedGetComputedStyle(elt, pseudoElt);
        return createSanitizedStyleDeclaration(originalStyles, ctx, globalColorCache);
      };

      if (clonedWindow.CSSStyleDeclaration?.prototype) {
        const origClonedGetProp = clonedWindow.CSSStyleDeclaration.prototype.getPropertyValue;
        clonedWindow.CSSStyleDeclaration.prototype.getPropertyValue = function (prop: string): string {
          const raw = origClonedGetProp.call(this, prop);
          return sanitizeColorValue(raw, ctx, globalColorCache);
        };
      }
    } catch (err) {
      console.warn('[pdfColorSanitizer] Failed to proxy cloned window styles:', err);
    }
  }

  // 2. Sanitize all <style> elements inside the cloned document
  try {
    const styleTags = clonedDoc.querySelectorAll('style');
    for (let i = 0; i < styleTags.length; i++) {
      const tag = styleTags[i];
      if (tag && tag.textContent && (tag.textContent.includes('oklab') || tag.textContent.includes('oklch') || tag.textContent.includes('color('))) {
        tag.textContent = sanitizeColorValue(tag.textContent, ctx, globalColorCache);
      }
    }
  } catch (err) {
    console.warn('[pdfColorSanitizer] Failed to sanitize <style> tags in clone:', err);
  }

  // 3. Proactively traverse cloned DOM elements to sanitize explicit inline styles
  try {
    const allElements = clonedDoc.querySelectorAll('*');
    for (let i = 0; i < allElements.length; i++) {
      const el = allElements[i] as HTMLElement;
      if (el && el.style && el.style.length > 0) {
        for (let j = 0; j < el.style.length; j++) {
          const prop = el.style[j];
          const val = el.style.getPropertyValue(prop);
          if (val && (val.includes('oklab') || val.includes('oklch') || val.includes('color('))) {
            el.style.setProperty(prop, sanitizeColorValue(val, ctx, globalColorCache));
          }
        }
      }
    }
  } catch (err) {
    console.warn('[pdfColorSanitizer] Failed to sanitize inline styles in clone:', err);
  }
}

/**
 * Drop-in, color-safe wrapper around html2canvas.
 * Guarantees that neither oklab, oklch, nor modern color() functions can trigger
 * 'Attempting to parse an unsupported color function' exceptions.
 */
export async function safeHtml2Canvas(
  element: HTMLElement,
  options: Record<string, any> = {}
): Promise<HTMLCanvasElement> {
  const userOnClone = options.onclone;

  const mergedOptions = {
    ...options,
    useCORS: options.useCORS ?? true,
    allowTaint: false,
    onclone: (clonedDoc: Document, clonedEl: HTMLElement) => {
      // 1. Sanitize the cloned document and iframe window
      setupHtml2CanvasColorSanitizer(clonedDoc);

      // 2. Execute user's onclone callback if supplied
      if (typeof userOnClone === 'function') {
        userOnClone(clonedDoc, clonedEl);
      }
    }
  };

  return withColorSanitization(async () => {
    return await html2canvas(element, mergedOptions);
  });
}
