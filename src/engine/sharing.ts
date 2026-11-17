import { DEFAULT_BOX_PARAMS } from './presets';
import type { BoxParams, DriverPreset } from './types';

export interface SharedModelPayload {
  v: 1;
  params: BoxParams;
  customDriver?: DriverPreset;
}

function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64: string): string {
  const norm = b64.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4));
  const binary = atob(norm + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export function encodeModelToken(params: BoxParams, customDriver?: DriverPreset): string {
  const payload: SharedModelPayload = {
    v: 1,
    params,
    ...(customDriver ? { customDriver } : {}),
  };
  return toBase64Url(JSON.stringify(payload));
}

export function decodeModelToken(token: string): SharedModelPayload | null {
  try {
    if (!token || token.length > 16000) return null;
    const raw = fromBase64Url(token.trim());
    const parsed = JSON.parse(raw) as Partial<SharedModelPayload>;
    if (!parsed || typeof parsed !== 'object' || !parsed.params) return null;

    const mergedParams: BoxParams = {
      ...DEFAULT_BOX_PARAMS,
      ...parsed.params,
      driverCount: Math.min(6, Math.max(1, Number(parsed.params.driverCount) || 1)) as BoxParams['driverCount'],
    };

    return {
      v: 1,
      params: mergedParams,
      customDriver: parsed.customDriver,
    };
  } catch {
    return null;
  }
}

export function buildShareUrl(baseHref: string, params: BoxParams, customDriver?: DriverPreset): string {
  const url = new URL(baseHref);
  url.searchParams.set('model', encodeModelToken(params, customDriver));
  return url.toString();
}
