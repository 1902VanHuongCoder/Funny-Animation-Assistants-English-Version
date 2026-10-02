/**
 * Composite coordinate transform utilities
 *
 * v2.0.0 Scheme A: Preserve Visual Appearance
 *
 * When an object attaches to or detaches from a composite, position, scale, and rotation are transformed
 * simultaneously, ensuring the global visual appearance of the object does not change.
 *
 * v19.2: Uses matrix decomposition instead of simplified formulas to properly handle flipX scenarios.
 * When parent.flipX=true, PIXI scaleX is negative, causing simplified position / rotation formulas to fail.
 * The matrix approach handles all cases uniformly.
 */

/** Minimal interface required for transformation */
interface TransformData {
    x: number
    y: number
    scaleX: number
    scaleY: number
    rotation: number
    flipX?: boolean
    transformOriginX?: number
    transformOriginY?: number
}

// ==================== Internal Matrix Utilities ====================

/** 2D affine transform matrix */
interface Transform2D {
    a: number   // effScaleX * cos(rotation)
    b: number   // effScaleX * sin(rotation)
    c: number   // -scaleY * sin(rotation)
    d: number   // scaleY * cos(rotation)
    tx: number  // x
    ty: number  // y
}

/** Build affine matrix from TransformData (flipX baked into scaleX) */
function buildMatrix(t: TransformData): Transform2D {
    const effScaleX = t.scaleX * (t.flipX ? -1 : 1)
    const cos = Math.cos(t.rotation)
    const sin = Math.sin(t.rotation)
    const originX = t.transformOriginX ?? 0
    const originY = t.transformOriginY ?? 0
    const originPositionX = t.flipX ? -originX : originX
    const originPositionY = originY
    const a = effScaleX * cos
    const b = effScaleX * sin
    const c = -t.scaleY * sin
    const d = t.scaleY * cos

    return {
        a,
        b,
        c,
        d,
        tx: t.x + originPositionX - (a * originX + c * originY),
        ty: t.y + originPositionY - (b * originX + d * originY),
    }
}

/** Matrix multiplication */
function multiplyMatrix(parent: Transform2D, child: Transform2D): Transform2D {
    return {
        a: parent.a * child.a + parent.c * child.b,
        b: parent.b * child.a + parent.d * child.b,
        c: parent.a * child.c + parent.c * child.d,
        d: parent.b * child.c + parent.d * child.d,
        tx: parent.a * child.tx + parent.c * child.ty + parent.tx,
        ty: parent.b * child.tx + parent.d * child.ty + parent.ty,
    }
}

/** Matrix inversion */
function invertMatrix(m: Transform2D): Transform2D {
    const det = m.a * m.d - m.b * m.c
    if (Math.abs(det) < 1e-10) {
        return { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
    }
    const invDet = 1 / det
    return {
        a: m.d * invDet,
        b: -m.b * invDet,
        c: -m.c * invDet,
        d: m.a * invDet,
        tx: (m.c * m.ty - m.d * m.tx) * invDet,
        ty: (m.b * m.tx - m.a * m.ty) * invDet,
    }
}

/**
 * Decompose scaleX, scaleY, rotation from affine matrix
 *
 * Matrix = R(theta) * S(sx, sy), where sx can be negative (flipX).
 * When det < 0 (reflection), the negative sign goes to scaleX, and rotation is corrected with atan2(-b, -a).
 * This prevents pure X-reflection from being misinterpreted as 180° rotation (the atan2(0, -1) = pi trap).
 */
function decomposeMatrix(m: Transform2D): {
    x: number; y: number; scaleX: number; scaleY: number; rotation: number
} {
    const x = m.tx
    const y = m.ty
    const scaleXRaw = Math.sqrt(m.a * m.a + m.b * m.b)
    const scaleY = Math.sqrt(m.c * m.c + m.d * m.d)
    const det = m.a * m.d - m.b * m.c

    let scaleX: number
    let rotation: number

    if (det < 0) {
        // Negative determinant = reflection (flipX), place negative sign on scaleX
        scaleX = -scaleXRaw
        // atan2(b, a) adds pi when a < 0 (misinterpreting flipX as 180° rotation)
        // Compensate with atan2(-b, -a): a = sx*cos(theta), b = sx*sin(theta),
        // when sx < 0, -b/(-sx)=sin(theta), -a/(-sx)=cos(theta) -> atan2(-b, -a) = theta
        rotation = Math.atan2(-m.b, -m.a)
    } else {
        scaleX = scaleXRaw
        rotation = Math.atan2(m.b, m.a)
    }

    return { x, y, scaleX, scaleY, rotation }
}

function decomposeMatrixForTransform(m: Transform2D, t: TransformData): {
    x: number; y: number; scaleX: number; scaleY: number; rotation: number
} {
    const decomposed = decomposeMatrix(m)
    const originX = t.transformOriginX ?? 0
    const originY = t.transformOriginY ?? 0
    if (originX === 0 && originY === 0) {
        return decomposed
    }

    const flipX = decomposed.scaleX < 0
    const cos = Math.cos(decomposed.rotation)
    const sin = Math.sin(decomposed.rotation)
    const a = decomposed.scaleX * cos
    const b = decomposed.scaleX * sin
    const c = -decomposed.scaleY * sin
    const d = decomposed.scaleY * cos
    const originPositionX = flipX ? -originX : originX
    const originPositionY = originY

    return {
        ...decomposed,
        x: m.tx - originPositionX + (a * originX + c * originY),
        y: m.ty - originPositionY + (b * originX + d * originY),
    }
}

/**
 * Global coordinates -> Local coordinates (used when attaching)
 *
 * Converts child object global transform to local transform relative to parent,
 * preserving child's global visual appearance.
 *
 * v19.2: Uses matrix decomposition to handle parent.flipX accurately.
 * The returned flipX indicates the value to set on the child after attaching.
 */
export function globalToLocal(child: TransformData, parent: TransformData): TransformData {
    const childMatrix = buildMatrix(child)
    const parentMatrix = buildMatrix(parent)
    const invParent = invertMatrix(parentMatrix)
    const localMatrix = multiplyMatrix(invParent, childMatrix)
    const decomposed = decomposeMatrixForTransform(localMatrix, child)

    // decomposeMatrix can only represent reflection via negative scale,
    // but our data model requires scaleX/scaleY >= 0 with separate flipX flag.
    // Determinant sign change = parent and child flipX differ (XOR)
    const parentFlip = parent.flipX ?? false
    const childFlip = child.flipX ?? false
    const localFlip = parentFlip !== childFlip

    return {
        x: decomposed.x,
        y: decomposed.y,
        scaleX: Math.abs(decomposed.scaleX),
        scaleY: Math.abs(decomposed.scaleY),
        rotation: decomposed.rotation,
        flipX: localFlip,
    }
}

/**
 * Local coordinates -> Global coordinates (used when detaching)
 *
 * Restores child local transform to global transform,
 * preserving child's global visual appearance.
 *
 * v19.2: Uses matrix decomposition to handle parent.flipX accurately.
 * The returned flipX indicates the value to set on the child after detaching.
 */
export function localToGlobal(child: TransformData, parent: TransformData): TransformData {
    const childMatrix = buildMatrix(child)
    const parentMatrix = buildMatrix(parent)
    const globalMatrix = multiplyMatrix(parentMatrix, childMatrix)
    const decomposed = decomposeMatrixForTransform(globalMatrix, child)

    // Same as globalToLocal: XOR restores global flipX
    const parentFlip = parent.flipX ?? false
    const childFlip = child.flipX ?? false
    const globalFlip = parentFlip !== childFlip

    return {
        x: decomposed.x,
        y: decomposed.y,
        scaleX: Math.abs(decomposed.scaleX),
        scaleY: Math.abs(decomposed.scaleY),
        rotation: decomposed.rotation,
        flipX: globalFlip,
    }
}
