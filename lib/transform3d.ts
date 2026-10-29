/**
 * A CSS 3D transform as data, so the DOM and WebGL place things identically.
 * Coordinates are CSS pixels: +X right, +Y down, +Z toward the viewer.
 */
export type TransformStep =
  | { op: "translate"; x: number; y: number; z: number }
  | { op: "rotateX"; angle: number }
  | { op: "rotateY"; angle: number }
  | { op: "scale"; s: number };

export function toCss(steps: TransformStep[]): string {
  return steps
    .map((step) => {
      switch (step.op) {
        case "translate":
          return `translate3d(${step.x.toFixed(2)}px, ${step.y.toFixed(2)}px, ${step.z.toFixed(2)}px)`;
        case "rotateX":
          return `rotateX(${step.angle.toFixed(5)}rad)`;
        case "rotateY":
          return `rotateY(${step.angle.toFixed(5)}rad)`;
        case "scale":
          return `scale3d(${step.s.toFixed(4)}, ${step.s.toFixed(4)}, ${step.s.toFixed(4)})`;
      }
    })
    .join(" ");
}

/**
 * Column-major 4×4 (WebGL's layout) for `transform: <steps>`, applied right
 * to left like CSS, after `start` (an ancestor's matrix) if given.
 */
export function toMatrix(steps: TransformStep[], start = identity()): Float32Array {
  let matrix = start;
  for (const step of steps) matrix = multiply(matrix, stepMatrix(step));
  return matrix;
}

function identity(): Float32Array {
  const matrix = new Float32Array(16);
  matrix[0] = matrix[5] = matrix[10] = matrix[15] = 1;
  return matrix;
}

function stepMatrix(step: TransformStep): Float32Array {
  const matrix = identity();
  switch (step.op) {
    case "translate":
      matrix[12] = step.x;
      matrix[13] = step.y;
      matrix[14] = step.z;
      break;
    case "rotateX": {
      const cos = Math.cos(step.angle);
      const sin = Math.sin(step.angle);
      matrix[5] = cos;
      matrix[6] = sin;
      matrix[9] = -sin;
      matrix[10] = cos;
      break;
    }
    case "rotateY": {
      const cos = Math.cos(step.angle);
      const sin = Math.sin(step.angle);
      matrix[0] = cos;
      matrix[2] = -sin;
      matrix[8] = sin;
      matrix[10] = cos;
      break;
    }
    case "scale":
      matrix[0] = matrix[5] = matrix[10] = step.s;
      break;
  }
  return matrix;
}

function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row]! * b[col * 4 + k]!;
      out[col * 4 + row] = sum;
    }
  }
  return out;
}
