/* ------------------------------------------------------------------ */
/*  Signed URLs for the private `case-photos` bucket.                   */
/*                                                                      */
/*  Patient clinical photos are PHI, so the bucket is private: an       */
/*  object URL alone grants nothing, and every view goes through a      */
/*  short-lived signed link that Storage only issues when the caller    */
/*  passes the bucket's RLS SELECT policy (uploader, or a member of the */
/*  clinic/lab on the case the photo belongs to — schema Phase 50).     */
/*                                                                      */
/*  Cases keep storing the same public-format URL they always did: the  */
/*  object PATH is embedded in it, which is all signing needs. That     */
/*  means no data migration, old and new rows behave identically, and   */
/*  the offline uploader's "compute the URL before the bytes land"      */
/*  trick keeps working untouched.                                      */
/* ------------------------------------------------------------------ */
import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";

const BUCKET = "case-photos";
const TTL_SECONDS = 60 * 60; // link lifetime asked of Storage
const RENEW_MARGIN_MS = 5 * 60 * 1000; // re-sign this long before expiry

// path -> { url, expiresAt }, and in-flight de-duplication so a drawer with
// eight thumbnails of the same photo issues one request, not eight.
const cache = new Map();
const inflight = new Map();

// Locally-created previews (a just-picked file) are already displayable and
// must never be sent to Storage.
const isLocal = (u) => typeof u === "string" && (u.startsWith("blob:") || u.startsWith("data:"));

/**
 * Object path inside the bucket, from whatever we stored on the case.
 * Handles the public format (.../object/public/case-photos/<path>), an
 * already-signed link (.../object/sign/case-photos/<path>?token=...), and a
 * bare "<uid>/<group>/<file>" path. Returns null for anything foreign, which
 * callers pass through untouched.
 */
export function storagePath(url) {
  if (typeof url !== "string" || !url || isLocal(url)) return null;
  const marker = `/${BUCKET}/`;
  const at = url.indexOf(marker);
  if (at !== -1) return url.slice(at + marker.length).split("?")[0];
  if (!/^https?:\/\//i.test(url)) return url.split("?")[0]; // bare path
  return null; // some other host — leave it alone
}

const fresh = (entry) => entry && entry.expiresAt - RENEW_MARGIN_MS > Date.now();

/**
 * Sign one stored URL. Returns the original string for local previews and
 * foreign URLs, so it is always safe to call. Throws only if Storage refuses
 * — callers decide whether that's a broken thumbnail or a failed export.
 */
export async function signStoredUrl(url) {
  if (!url || isLocal(url)) return url ?? null;
  const path = storagePath(url);
  if (!path) return url;

  const hit = cache.get(path);
  if (fresh(hit)) return hit.url;
  if (inflight.has(path)) return inflight.get(path);

  const req = (async () => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, TTL_SECONDS);
    if (error || !data?.signedUrl) throw error ?? new Error("Could not sign photo URL");
    cache.set(path, { url: data.signedUrl, expiresAt: Date.now() + TTL_SECONDS * 1000 });
    return data.signedUrl;
  })().finally(() => inflight.delete(path));

  inflight.set(path, req);
  return req;
}

/**
 * Sign several at once — one round trip for a whole case's photos. Returns a
 * Map of original URL -> signed URL (or the original, when nothing to sign).
 * Failures are omitted rather than thrown: one dead object shouldn't blank
 * the rest of the gallery.
 */
export async function signStoredUrls(urls) {
  const out = new Map();
  const need = [];
  for (const u of urls ?? []) {
    if (!u || out.has(u)) continue;
    if (isLocal(u)) { out.set(u, u); continue; }
    const path = storagePath(u);
    if (!path) { out.set(u, u); continue; }
    const hit = cache.get(path);
    if (fresh(hit)) out.set(u, hit.url);
    else need.push({ url: u, path });
  }
  if (need.length === 0) return out;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(need.map((n) => n.path), TTL_SECONDS);
  if (error) return out; // offline / refused — callers show the error state
  const byPath = new Map((data ?? []).map((d) => [d.path, d]));
  for (const n of need) {
    const signed = byPath.get(n.path)?.signedUrl;
    if (!signed) continue;
    cache.set(n.path, { url: signed, expiresAt: Date.now() + TTL_SECONDS * 1000 });
    out.set(n.url, signed);
  }
  return out;
}

/** Drop cached links — used on sign-out so a shared device can't reuse them. */
export function clearSignedUrlCache() {
  cache.clear();
  inflight.clear();
}

/**
 * Resolve one stored URL to a displayable one.
 * -> { url, loading, error }. Local previews resolve synchronously, so a
 * just-picked photo never flashes a spinner.
 */
export function useSignedUrl(rawUrl) {
  const immediate = !rawUrl || isLocal(rawUrl) ? rawUrl ?? null : null;
  const [state, setState] = useState({ url: immediate, loading: !!rawUrl && !immediate, error: null });

  useEffect(() => {
    if (!rawUrl || isLocal(rawUrl)) {
      setState({ url: rawUrl ?? null, loading: false, error: null });
      return undefined;
    }
    let alive = true;
    setState((s) => (s.loading ? s : { url: null, loading: true, error: null }));
    signStoredUrl(rawUrl)
      .then((url) => alive && setState({ url, loading: false, error: null }))
      .catch((err) => alive && setState({ url: null, loading: false, error: err?.message || "Unavailable" }));
    return () => {
      alive = false;
    };
  }, [rawUrl]);

  return state;
}

/**
 * <img> for a private-bucket photo: skeleton while signing, a quiet
 * placeholder if the link can't be issued (revoked access, offline, deleted
 * object) — never a broken-image icon.
 */
export function SignedImage({ url, alt = "", className = "", style, crossOrigin, onLoad, onClick }) {
  const { url: src, loading, error } = useSignedUrl(url);
  if (loading)
    return <div className={`animate-pulse bg-slate-200 ${className}`} style={style} onClick={onClick} aria-hidden="true" />;
  if (error || !src)
    return (
      <div
        className={`flex items-center justify-center bg-slate-100 text-[9px] font-medium text-slate-400 ${className}`}
        style={style}
        onClick={onClick}
        title={error || "Photo unavailable"}
      >
        Unavailable
      </div>
    );
  return (
    <img src={src} alt={alt} className={className} style={style} crossOrigin={crossOrigin} onLoad={onLoad} onClick={onClick} />
  );
}

/**
 * Anchor that downloads a private photo, signing first. It must never just
 * disappear while signing or on failure — a control that vanishes silently
 * reads as a broken app, so both states stay visible and explain themselves.
 */
export function SignedDownloadLink({ url, name, className, children, onClick }) {
  const { url: src, loading, error } = useSignedUrl(url);
  if (loading)
    return (
      <span className={`${className} cursor-wait opacity-60`} title="Preparing a secure download link…" aria-busy="true">
        {children}
      </span>
    );
  if (error || !src)
    return (
      <span
        className={`${className} cursor-not-allowed opacity-50`}
        title={error ? `Download unavailable — ${error}` : "Download unavailable"}
      >
        {children}
      </span>
    );
  return (
    <a href={src} download={name} className={className} onClick={onClick}>
      {children}
    </a>
  );
}
