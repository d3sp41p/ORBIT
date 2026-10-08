/** A body as seen on screen: projected centre, disk radius and camera distance. */
export interface ScreenBody<T> {
  item: T;
  x: number;
  y: number;
  /** Projected depth; > 1 means behind the camera. */
  z: number;
  /** Visible disk radius in pixels. */
  disk: number;
  /** Touch radius in pixels (at least the disk, larger for tiny bodies). */
  touch: number;
  /** Distance from the camera in scene units. */
  camDist: number;
}

/**
 * What the cursor points at. A body whose visible disk is under the cursor
 * wins, nearest to the camera first, so a close planet hides everything
 * behind it. Otherwise the closest small body within its touch radius.
 */
export function pickBody<T>(x: number, y: number, bodies: Iterable<ScreenBody<T>>): T | null {
  let front: T | null = null,
    frontDist = Infinity;
  let near: T | null = null,
    nearD = Infinity;
  for (const b of bodies) {
    if (b.z > 1) continue;
    const d = Math.hypot(b.x - x, b.y - y);
    if (d < b.disk && b.camDist < frontDist) {
      frontDist = b.camDist;
      front = b.item;
    }
    if (d < b.touch && d < nearD) {
      nearD = d;
      near = b.item;
    }
  }
  return front ?? near;
}
