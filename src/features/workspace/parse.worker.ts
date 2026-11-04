/// <reference lib="webworker" />
/** Parses Vulcan .00t files off the main thread and computes mesh stats. Messages: { key, buf } → ParseReply. */
import type { MeshData, MeshStats } from '@/core/types';
import { read00t } from './geomBridge';

export type ParseReply =
  | { key: string; ok: true; mesh: MeshData; stats: MeshStats; warnings: string[]; ms: number }
  | { key: string; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<{ key: string; buf: ArrayBuffer }>) => {
  const { key, buf } = e.data;
  const t0 = performance.now();
  try {
    const { mesh, stats, warnings } = read00t(buf);
    const reply: ParseReply = { key, ok: true, mesh, stats, warnings, ms: performance.now() - t0 };
    const transfer = [mesh.verts.buffer, mesh.tris.buffer].filter((b, i, a) => a.indexOf(b) === i) as Transferable[];
    ctx.postMessage(reply, transfer);
  } catch (err) {
    ctx.postMessage({ key, ok: false, error: (err as Error).message || String(err) } satisfies ParseReply);
  }
};
