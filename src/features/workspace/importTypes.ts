import type { AssetKind, AssetRole, DepletionMode, HaulString, MeshData, MeshStats } from '@/core/types';

export type ImportStatus = 'reading' | 'ready' | 'error';

/** One file in the import modal. */
export interface ImportItem {
  key: string;
  fileName: string;
  sizeBytes: number;
  status: ImportStatus;
  error?: string;
  mesh?: MeshData;
  stats?: MeshStats;
  ms?: number;
  // user choices
  include: boolean;
  name: string;
  kind: AssetKind;
  role: AssetRole;
  color: string;
  materialId: string;
  depletionMode: DepletionMode;
  advanceAzimuthDeg: number;
  warnings: string[];
}

export interface StringsImport {
  fileName: string;
  strings: HaulString[];
  warnings: string[];
}
