// Small dense linear algebra for networks of a few dozen species.

/** Solve A x = b in place (A is n*n row-major, destroyed). Returns false if singular. */
export function solveInPlace(A: Float64Array, b: Float64Array, n: number): boolean {
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = Math.abs(A[col * n + col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(A[r * n + col]);
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (best < 1e-300) return false;
    if (piv !== col) {
      for (let c = 0; c < n; c++) {
        const t = A[col * n + c];
        A[col * n + c] = A[piv * n + c];
        A[piv * n + c] = t;
      }
      const t = b[col];
      b[col] = b[piv];
      b[piv] = t;
    }
    const d = A[col * n + col];
    for (let r = col + 1; r < n; r++) {
      const f = A[r * n + col] / d;
      if (f === 0) continue;
      for (let c = col; c < n; c++) A[r * n + c] -= f * A[col * n + c];
      b[r] -= f * b[col];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < n; c++) s -= A[r * n + c] * b[c];
    b[r] = s / A[r * n + r];
  }
  return true;
}

/**
 * Left null space of N (m species x r reactions): all g with g^T N = 0.
 * These are the conserved moieties (NAD pool, adenylate pool, CoA pool...).
 * Computed as the null space of N^T via reduced row echelon form.
 */
export function leftNullSpace(N: number[][], m: number, r: number, tol = 1e-10): number[][] {
  // Build N^T (r x m)
  const A: number[][] = [];
  for (let j = 0; j < r; j++) {
    const row: number[] = [];
    for (let i = 0; i < m; i++) row.push(N[i][j]);
    A.push(row);
  }
  const pivCols: number[] = [];
  let row = 0;
  for (let col = 0; col < m && row < r; col++) {
    let piv = row;
    let best = Math.abs(A[row][col]);
    for (let k = row + 1; k < r; k++) {
      if (Math.abs(A[k][col]) > best) {
        best = Math.abs(A[k][col]);
        piv = k;
      }
    }
    if (best < tol) continue;
    [A[row], A[piv]] = [A[piv], A[row]];
    const d = A[row][col];
    for (let c = 0; c < m; c++) A[row][c] /= d;
    for (let k = 0; k < r; k++) {
      if (k === row) continue;
      const f = A[k][col];
      if (Math.abs(f) < 1e-300) continue;
      for (let c = 0; c < m; c++) A[k][c] -= f * A[row][c];
    }
    pivCols.push(col);
    row++;
  }
  const free: number[] = [];
  for (let c = 0; c < m; c++) if (!pivCols.includes(c)) free.push(c);
  const basis: number[][] = [];
  for (const f of free) {
    const v = new Array(m).fill(0);
    v[f] = 1;
    pivCols.forEach((pc, i) => {
      v[pc] = -A[i][f];
    });
    basis.push(v.map((x) => (Math.abs(x) < 1e-12 ? 0 : x)));
  }
  return basis;
}

/** Inverse of a small symmetric positive-definite matrix (k x k, k tiny). */
export function invertSmall(M: number[][]): number[][] {
  const k = M.length;
  const A = M.map((r, i) => [...r, ...Array.from({ length: k }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c] || 1e-300;
    for (let j = 0; j < 2 * k; j++) A[c][j] /= d;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r][c];
      for (let j = 0; j < 2 * k; j++) A[r][j] -= f * A[c][j];
    }
  }
  return A.map((r) => r.slice(k));
}
