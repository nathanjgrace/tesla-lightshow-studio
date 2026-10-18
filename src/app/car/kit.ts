// Geometry helpers shared by every car body. Bodies are side profiles
// extruded across the car's width, then narrowed toward the roof and ends.
//
// Coordinates: meters, x = forward, y = up, z = right (so left is -z).

import * as THREE from 'three';

export type Side = 'left' | 'right';
export const SIDES: readonly Side[] = ['left', 'right'];
export const sideSign = (s: Side) => (s === 'right' ? 1 : -1);

export const COLORS = {
  white: new THREE.Color('#fff4e0'),
  amber: new THREE.Color('#ffa21a'),
  red: new THREE.Color('#ff1a1a'),
  lensFront: new THREE.Color('#25282d'),
  lensRear: new THREE.Color('#3a0a0a'),
  lensAmber: new THREE.Color('#3a2408'),
};

export interface TaperSpec {
  /** Height above which the sides lean inward (tumblehome). */
  from: number;
  /** Inward lean per meter of height. */
  roof: number;
  /** Plan-view rounding at the nose and tail: starts this far from center. */
  endStart: number;
  endLength: number;
  endAmount: number;
}

/** Body geometry for one car: its width and how its shape narrows. */
export class BodyKit {
  constructor(
    readonly halfWidth: number,
    readonly taperSpec: TaperSpec,
  ) {}

  widthFactor(x: number, y: number, ends = true): number {
    const t = this.taperSpec;
    let f = y > t.from ? 1 - (y - t.from) * t.roof : 1;
    const ax = Math.abs(x);
    if (ends && t.endAmount > 0 && ax > t.endStart) f *= 1 - ((ax - t.endStart) / t.endLength) ** 2 * t.endAmount;
    return f;
  }

  taper(geometry: THREE.BufferGeometry, ends = true): void {
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) * this.widthFactor(pos.getX(i), pos.getY(i), ends));
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  /** Half-width of the side surface at a point. */
  surfaceZ(x: number, y: number): number {
    return this.halfWidth * this.widthFactor(x, y);
  }

  /** Extrudes a side-profile shape across the car's width, centered on z = 0. */
  extrudeAcross(shape: THREE.Shape, width: number, bevel: number, curveSegments = 28): THREE.BufferGeometry {
    const depth = width - 2 * bevel;
    const g = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel * 0.8,
      bevelSegments: bevel > 0.03 ? 6 : 1,
      curveSegments,
    });
    g.translate(0, 0, -depth / 2);
    return g;
  }

  /** A thin panel on one side of the car, its outer face `outset` outside the side surface. */
  sidePanel(shape: THREE.Shape, side: Side, thickness: number, outset: number): THREE.BufferGeometry {
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: thickness,
      bevelEnabled: true,
      bevelThickness: 0.006,
      bevelSize: 0.006,
      bevelSegments: 2,
      curveSegments: 12,
    });
    g.translate(0, 0, this.halfWidth + outset - thickness);
    if (side === 'left') g.scale(1, 1, -1);
    this.taper(g, false);
    return g;
  }
}

/**
 * Splits a geometry's triangles into material groups chosen per triangle
 * from its center and face normal (e.g. glass on the roof, paint elsewhere).
 */
export function assignMaterials(
  source: THREE.BufferGeometry,
  pick: (center: THREE.Vector3, normal: THREE.Vector3) => number,
): THREE.BufferGeometry {
  const g = source.index ? source.toNonIndexed() : source;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const triCount = pos.count / 3;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const center = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const byMaterial: number[][] = [];
  for (let t = 0; t < triCount; t++) {
    a.fromBufferAttribute(pos, t * 3);
    b.fromBufferAttribute(pos, t * 3 + 1);
    c.fromBufferAttribute(pos, t * 3 + 2);
    center.copy(a).add(b).add(c).divideScalar(3);
    normal.subVectors(c, b).cross(ab.subVectors(a, b)).normalize();
    (byMaterial[pick(center, normal)] ??= []).push(t);
  }
  const out = new THREE.BufferGeometry();
  const attrs = Object.entries(g.attributes) as [string, THREE.BufferAttribute][];
  const arrays = attrs.map(([, attr]) => new Float32Array(attr.count * attr.itemSize));
  let written = 0;
  byMaterial.forEach((tris, materialIndex) => {
    if (!tris) return;
    out.addGroup(written * 3, tris.length * 3, materialIndex);
    for (const t of tris) {
      attrs.forEach(([, attr], i) => {
        const size = attr.itemSize;
        arrays[i]!.set((attr.array as Float32Array).subarray(t * 3 * size, (t + 1) * 3 * size), written * 3 * size);
      });
      written++;
    }
  });
  attrs.forEach(([name, attr], i) => out.setAttribute(name, new THREE.BufferAttribute(arrays[i]!, attr.itemSize)));
  out.computeVertexNormals();
  return out;
}

export function roundedRect(x0: number, y0: number, x1: number, y1: number, r: number): THREE.Shape {
  const p = new THREE.Shape();
  p.moveTo(x0 + r, y0);
  p.lineTo(x1 - r, y0);
  p.quadraticCurveTo(x1, y0, x1, y0 + r);
  p.lineTo(x1, y1 - r);
  p.quadraticCurveTo(x1, y1, x1 - r, y1);
  p.lineTo(x0 + r, y1);
  p.quadraticCurveTo(x0, y1, x0, y1 - r);
  p.lineTo(x0, y0 + r);
  p.quadraticCurveTo(x0, y0, x0 + r, y0);
  return p;
}

export function polygon(points: readonly (readonly [number, number])[]): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(points[0]![0], points[0]![1]);
  for (const p of points.slice(1)) shape.lineTo(p[0], p[1]);
  shape.closePath();
  return shape;
}

/** Bottom edge of a side profile with two wheel arches, drawn rear to front. */
export function rockerWithArches(
  s: THREE.Shape,
  rearX: number,
  frontX: number,
  rockerY: number,
  axles: { front: number; rear: number },
  archRadius: number,
  archCenterY: number,
): void {
  const dx = Math.sqrt(archRadius ** 2 - (rockerY - archCenterY) ** 2);
  const start = Math.atan2(rockerY - archCenterY, dx);
  s.moveTo(rearX, rockerY);
  s.lineTo(axles.rear - dx, rockerY);
  s.absarc(axles.rear, archCenterY, archRadius, Math.PI - start, start, true);
  s.lineTo(axles.front - dx, rockerY);
  s.absarc(axles.front, archCenterY, archRadius, Math.PI - start, start, true);
  s.lineTo(frontX, rockerY);
}

/** A blurry dark ellipse texture for the car's contact shadow. */
export function shadowTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(128, 64, 10, 128, 64, 128);
  gradient.addColorStop(0, 'rgba(0,0,0,0.75)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.setTransform(1, 0, 0, 0.5, 0, 32);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
