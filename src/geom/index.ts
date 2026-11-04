/**
 * hAIul SIM geometry + file I/O - PUBLIC API (pure TypeScript, no DOM; usable in workers and Node tests).
 *
 * OWNER: geometry agent. Other modules import only from '@/geom'.
 * Units: metres, world coordinates site grid [E, N, Z]; grades as fractions; volumes m³.
 */

// types
export type { Vec2, XYZ, Grid, Plane } from './types';

// mesh analysis
export {
  meshStats, meshTopology, orientMesh, meshBBox, signedVolume, classifyMesh, weldVertices, mergeMeshes, flipWinding,
  toLocalFloat32, computeNormals, vertexCount, triangleCount,
} from './mesh';
export type { MeshTopology, MeshOrientation, LocalBuffers } from './mesh';

// height queries and grids
export { buildHeightIndex, heightAt, heightsAlong, rasterize, gridHeightAt, gridToMesh } from './heightIndex';
export type { HeightIndex, HeightSample } from './heightIndex';

// haul-string tools
export {
  fromVec3, toVec3, snapPoints, densify, simplify3d, stringMetrics, reversePoints, insertPoint, removePoint,
  movePoint, nearestOnString, smoothGrades, gradeClass, GRADE_CLASS_LIMITS,
} from './strings';
export type { StringMetrics, StringSegmentMetrics, NearestOnString, GradeClass } from './strings';

// auto-route
export { autoRoute } from './route';
export type { AutoRouteOptions, AutoRouteResult } from './route';

// sections and profiles
export { sectionCut, profileAlongString } from './section';
export type { SectionCut, SectionPath, ProfileSample } from './section';

// depletion
export {
  prepareSolid, depletionNormal, depletionPlane, volumeBeyondPlane, volumeBehindPlane, capLoops, clipMesh, toScenePlane,
} from './depletion';
export type { SolidHandle, DepletionPlane, CapResult, KeepSide, ScenePlane } from './depletion';

// polygon / polyline utilities
export { triangulatePolygon } from './triangulate';
export { planLength, simplify2d, subdivide, chaikin, ringArea, pointInRing } from './polyline';

// file I/O
export { parse00t, write00t, looksLike00t } from '@/io/vulcan00t';
export type { Parsed00t } from '@/io/vulcan00t';
export { isVulZ, inspectVulZ, decodeVulZ, expandFastLZ } from '@/io/vulz';
export type { VulZInfo, VulZDecoded } from '@/io/vulz';
export { parseStringsText, toCsv, toXyz, toDxf3dPolyline, toDataDump, dxfLayerName, dxfLayerNames } from '@/io/strings';
export type { ParsedString, ParsedStrings, StringLike } from '@/io/strings';

// demo site
export { buildDemoSite, DEMO_IDS } from '@/demo/demoSite';
export type { DemoSite } from '@/demo/demoSite';
