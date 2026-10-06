// Busbar thickness from a steady-state heat balance: the heat the bar generates (I²R) must equal
// what it sheds by free convection and radiation at the allowed temperature rise.
// Follows the "Busbar Calculations" spreadsheet, plus the downward-facing underside it left out.
//
// The bar lies flat: the wide face (length × width) is horizontal, current flows along the length.

export const G = 9.81 // m/s²
export const STEFAN_BOLTZMANN = 5.67e-8 // W/m²K⁴

export type Air = {
  k: number // thermal conductivity, W/m·K
  alpha: number // thermal diffusivity, m²/s
  nu: number // kinematic viscosity, m²/s
}

// Properties of air at 1 atm (Çengel, Table A-15): [T °C, k, α, ν]
const AIR_TABLE: [number, number, number, number][] = [
  [-50, 0.01979, 1.252e-5, 9.319e-6],
  [-40, 0.02057, 1.356e-5, 1.008e-5],
  [-30, 0.02134, 1.465e-5, 1.087e-5],
  [-20, 0.02211, 1.578e-5, 1.169e-5],
  [-10, 0.02288, 1.696e-5, 1.252e-5],
  [0, 0.02364, 1.818e-5, 1.338e-5],
  [5, 0.02401, 1.88e-5, 1.382e-5],
  [10, 0.02439, 1.944e-5, 1.426e-5],
  [15, 0.02476, 2.009e-5, 1.47e-5],
  [20, 0.02514, 2.074e-5, 1.516e-5],
  [25, 0.02551, 2.141e-5, 1.562e-5],
  [30, 0.02588, 2.208e-5, 1.608e-5],
  [35, 0.02625, 2.277e-5, 1.655e-5],
  [40, 0.02662, 2.346e-5, 1.702e-5],
  [45, 0.02699, 2.416e-5, 1.75e-5],
  [50, 0.02735, 2.487e-5, 1.798e-5],
  [60, 0.02808, 2.632e-5, 1.896e-5],
  [70, 0.02881, 2.78e-5, 1.995e-5],
  [80, 0.02953, 2.931e-5, 2.097e-5],
  [90, 0.03024, 3.086e-5, 2.201e-5],
  [100, 0.03095, 3.243e-5, 2.306e-5],
  [120, 0.03235, 3.565e-5, 2.522e-5],
  [140, 0.03374, 3.898e-5, 2.745e-5],
  [160, 0.03511, 4.241e-5, 2.975e-5],
  [180, 0.03646, 4.593e-5, 3.212e-5],
  [200, 0.03779, 4.954e-5, 3.455e-5],
]
export const AIR_T_MIN = AIR_TABLE[0][0]
export const AIR_T_MAX = AIR_TABLE[AIR_TABLE.length - 1][0]

// Linear interpolation in the table; clamped at its ends.
export function airAt(tC: number): Air {
  const t = Math.min(AIR_T_MAX, Math.max(AIR_T_MIN, tC))
  let i = 1
  while (i < AIR_TABLE.length - 1 && AIR_TABLE[i][0] < t) i++
  const [t0, k0, a0, n0] = AIR_TABLE[i - 1]
  const [t1, k1, a1, n1] = AIR_TABLE[i]
  const f = (t - t0) / (t1 - t0)
  return { k: k0 + f * (k1 - k0), alpha: a0 + f * (a1 - a0), nu: n0 + f * (n1 - n0) }
}

export type Correlation = {
  id: string
  formula: string // shown in engineering mode
  range: string
  inRange: boolean
}

export type Face = {
  Lc: number // characteristic length, m
  Ra: number
  Nu: number
  h: number // W/m²K
  correlation: Correlation
}

// Hot surface facing up. Below Ra = 10⁴ the spreadsheet falls back to Nu = 1 (pure conduction).
function topNu(Ra: number): [number, Correlation] {
  if (Ra < 1e4) return [1, { id: 'top-low', formula: 'Nu = 1', range: 'Ra < 10⁴ (conduction limit)', inRange: true }]
  if (Ra <= 1e7)
    return [0.54 * Ra ** 0.25, { id: 'top-lam', formula: 'Nu = 0.54 Ra^(1/4)', range: '10⁴ ≤ Ra ≤ 10⁷', inRange: true }]
  return [
    0.15 * Ra ** (1 / 3),
    { id: 'top-turb', formula: 'Nu = 0.15 Ra^(1/3)', range: '10⁷ ≤ Ra ≤ 10¹¹', inRange: Ra <= 1e11 },
  ]
}

// Hot surface facing down. Same conduction fallback below the correlation's range.
function bottomNu(Ra: number): [number, Correlation] {
  if (Ra < 1e5)
    return [1, { id: 'bottom-low', formula: 'Nu = 1', range: 'Ra < 10⁵ (conduction limit)', inRange: true }]
  return [
    0.27 * Ra ** 0.25,
    { id: 'bottom', formula: 'Nu = 0.27 Ra^(1/4)', range: '10⁵ ≤ Ra ≤ 10¹⁰', inRange: Ra <= 1e10 },
  ]
}

// Vertical wall, Churchill and Chu.
function sideNu(Ra: number, Pr: number): [number, Correlation] {
  const pr = 1 + (0.492 / Pr) ** (9 / 16)
  if (Ra < 1e9)
    return [
      0.68 + (0.67 * Ra ** 0.25) / pr ** (4 / 9),
      {
        id: 'side-lam',
        formula: 'Nu = 0.68 + 0.67 Ra^(1/4) / [1 + (0.492/Pr)^(9/16)]^(4/9)',
        range: '10⁻¹ < Ra < 10⁹',
        inRange: Ra > 0.1,
      },
    ]
  return [
    (0.825 + (0.387 * Ra ** (1 / 6)) / pr ** (8 / 27)) ** 2,
    {
      id: 'side-turb',
      formula: 'Nu = {0.825 + 0.387 Ra^(1/6) / [1 + (0.492/Pr)^(9/16)]^(8/27)}²',
      range: 'Ra < 10¹²',
      inRange: Ra < 1e12,
    },
  ]
}

export type Inputs = {
  current: number // A
  length: number // m, along the current
  width: number // m
  ambientC: number // °C
  deltaT: number // K, allowed rise of the bar above ambient
  resistivity: number // Ω·m
  emissivity: number
  undersideExposed: boolean // false: the bar sits on a surface and its underside sheds no heat
  air?: Air // override the table lookup (used to check against the spreadsheet)
}

export type Result = {
  Tinf: number // K
  Ts: number
  Tf: number
  beta: number // 1/K
  air: Air
  Pr: number
  top: Face
  bottom: Face | null
  side: Face
  areaTop: number // m²
  areaBottom: number
  areaSideLong: number // both long edges, 2·L·t
  areaSideEnd: number // both end faces, 2·w·t
  qTop: number // W
  qBottom: number
  qSide: number
  qConvection: number
  qRadiation: number
  qTotal: number
  crossSection: number // m²
  thickness: number // m
  resistance: number // Ω
  currentDensity: number // A/mm²
}

function evaluate(inp: Inputs, t: number): Result {
  const { current: I, length: L, width: w, deltaT: dT } = inp
  const Tinf = inp.ambientC + 273.15
  const Ts = Tinf + dT
  const Tf = (Tinf + Ts) / 2
  const beta = 1 / Tf
  const air = inp.air ?? airAt(Tf - 273.15)
  const Pr = air.nu / air.alpha
  const rayleigh = (Lc: number) => (G * beta * dT * Lc ** 3) / (air.nu * air.alpha)
  const face = (Lc: number, [Nu, correlation]: [number, Correlation], Ra: number): Face => ({
    Lc,
    Ra,
    Nu,
    h: (Nu * air.k) / Lc,
    correlation,
  })

  // Horizontal faces: Lc = area / perimeter
  const areaTop = L * w
  const LcH = areaTop / (2 * (L + w))
  const RaH = rayleigh(LcH)
  const top = face(LcH, topNu(RaH), RaH)
  const bottom = inp.undersideExposed ? face(LcH, bottomNu(RaH), RaH) : null
  // Edges are vertical walls whose height is the bar's thickness
  const RaV = rayleigh(t)
  const side = face(t, sideNu(RaV, Pr), RaV)

  const areaBottom = bottom ? areaTop : 0
  const areaSideLong = 2 * L * t
  const areaSideEnd = 2 * w * t
  const qTop = top.h * areaTop * dT
  const qBottom = bottom ? bottom.h * areaBottom * dT : 0
  const qSide = side.h * (areaSideLong + areaSideEnd) * dT
  const qConvection = qTop + qBottom + qSide
  const qRadiation =
    inp.emissivity * STEFAN_BOLTZMANN * (areaTop + areaBottom + areaSideLong + areaSideEnd) * (Ts ** 4 - Tinf ** 4)
  const qTotal = qConvection + qRadiation

  // I²R = Q with R = ρL/A  →  A = ρ L I² / Q
  const crossSection = (inp.resistivity * L * I ** 2) / qTotal
  return {
    Tinf, Ts, Tf, beta, air, Pr, top, bottom, side,
    areaTop, areaBottom, areaSideLong, areaSideEnd,
    qTop, qBottom, qSide, qConvection, qRadiation, qTotal,
    crossSection,
    thickness: crossSection / w,
    resistance: (inp.resistivity * L) / crossSection,
    currentDensity: I / (crossSection * 1e6),
  }
}

// The edge faces' area and heat-transfer coefficient both depend on the thickness being solved
// for. The spreadsheet handles that by typing in a guess; here the guess is refined until the
// thickness the heat balance asks for equals the thickness it was evaluated at.
export function solve(inp: Inputs): Result {
  // evaluate(t).thickness falls as t grows (thicker edges shed more heat), so bisect on the gap.
  let lo = 1e-7
  let hi = 10
  for (let i = 0; i < 200; i++) {
    const mid = Math.sqrt(lo * hi)
    if (evaluate(inp, mid).thickness > mid) lo = mid
    else hi = mid
    if (hi / lo < 1 + 1e-10) break
  }
  return evaluate(inp, Math.sqrt(lo * hi))
}

// What the spreadsheet does: a single pass with the edge thickness typed in by hand.
export function evaluateAt(inp: Inputs, assumedThickness: number): Result {
  return evaluate(inp, assumedThickness)
}

export const STANDARD_THICKNESSES_MM = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50]

export function nextStandardThickness(mm: number): number | null {
  return STANDARD_THICKNESSES_MM.find((s) => s >= mm) ?? null
}

// ---- Design current of a traction motor (second block of the spreadsheet) ----

export type VehicleInputs = {
  mass: number // kg
  rollingResistance: number
  inclineDeg: number
  v0Kmh: number
  v1Kmh: number
  accelTime: number // s
  dragCoefficient: number
  frontalArea: number // m²
  motorEfficiency: number // 0..1
  voltage: number // V
}

export const AIR_DENSITY = 1.225 // kg/m³

export function designCurrent(v: VehicleInputs) {
  const theta = (v.inclineDeg * Math.PI) / 180
  const v0 = v.v0Kmh / 3.6
  const v1 = v.v1Kmh / 3.6
  const vAvg = (v0 + v1) / 2
  const fGradeRolling = v.mass * G * Math.sin(theta) + v.rollingResistance * v.mass * G * Math.cos(theta)
  const fAccel = (v.mass * (v1 - v0)) / v.accelTime
  const fAero = 0.5 * AIR_DENSITY * v.dragCoefficient * v.frontalArea * v1 ** 2
  const fTotal = fGradeRolling + fAccel + fAero
  const power = fTotal * vAvg
  const electricalPower = power / v.motorEfficiency
  return { theta, v0, v1, vAvg, fGradeRolling, fAccel, fAero, fTotal, power, electricalPower, current: electricalPower / v.voltage }
}
