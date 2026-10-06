// Enclosed bar: heat crosses a thin air gap to the box wall.
//
// With a gap of a few millimetres the air cannot circulate, so each wide face loses heat by
// conduction through the air layer (Nu = 1, h = k/δ) to the wall it faces, plus radiation between
// the two surfaces. The narrow edges are left out, which is the safe choice.

import { G, STEFAN_BOLTZMANN, airAt, bottomNu, sideNu, topNu, type Air, type Correlation, type Face } from './calc.ts'

export const RA_CRITICAL = 1708 // an air layer heated from below starts to circulate above this

export type Gap = {
  gap: number // δ, m
  Ra: number // based on δ and Ts − Tw
  Nu: number
  h: number
  circulating: boolean
}

export type BoxInputs = {
  length: number // outside dimensions, m
  width: number
  height: number
  wallThickness: number // m
  wallConductivity: number // W/m·K
  outerEmissivity: number
  otherHeat: number // W released inside the box by everything except this bar
}

export type EnclosedInputs = {
  current: number
  length: number
  width: number
  ambientC: number // air outside the box
  deltaT: number // allowed rise of the bar above that air
  resistivity: number
  emissivity: number // bar surface
  wallEmissivity: number // inside of the box
  gapTop: number // m
  gapBottom: number | null // null: the bar rests on a holder, nothing leaves the underside
  wall: { kind: 'direct'; tempC: number } | { kind: 'box'; box: BoxInputs }
}

export type BoxResult = {
  areaTop: number
  areaSides: number
  areaTotal: number
  qBox: number // everything the box has to shed, W
  Tout: number // outside wall temperature, K
  dTWall: number // drop through the wall, K
  top: Face
  bottom: Face
  side: Face
  qConvection: number
  qRadiation: number
}

export type EnclosedResult = {
  Tinf: number
  Ts: number
  Tw: number // inside wall temperature, K
  Tf: number
  beta: number
  air: Air
  top: Gap
  bottom: Gap | null
  areaFace: number
  radFactor: number // 1 / (1/ε_bar + 1/ε_wall − 1)
  qTop: number
  qBottom: number
  qRadiation: number
  qTotal: number
  crossSection: number
  thickness: number
  resistance: number
  currentDensity: number
  box: BoxResult | null
}

// Heat the box sheds from its outside when its wall is at Tout: the open-air correlations
// applied to its top, its underside and its four sides.
function boxLoss(box: BoxInputs, TinfK: number, Tout: number) {
  const dT = Tout - TinfK
  const Tf = (Tout + TinfK) / 2
  const air = airAt(Tf - 273.15)
  const Pr = air.nu / air.alpha
  const face = (Lc: number, nu: (Ra: number) => [number, Correlation]): Face => {
    const Ra = (G * (1 / Tf) * dT * Lc ** 3) / (air.nu * air.alpha)
    const [Nu, correlation] = nu(Ra)
    return { Lc, Ra, Nu, h: (Nu * air.k) / Lc, correlation }
  }
  const areaTop = box.length * box.width
  const areaSides = 2 * (box.length + box.width) * box.height
  const areaTotal = 2 * areaTop + areaSides
  const LcH = areaTop / (2 * (box.length + box.width))
  const top = face(LcH, topNu)
  const bottom = face(LcH, bottomNu)
  const side = face(box.height, (Ra) => sideNu(Ra, Pr))
  const qConvection = (top.h * areaTop + bottom.h * areaTop + side.h * areaSides) * dT
  const qRadiation = box.outerEmissivity * STEFAN_BOLTZMANN * areaTotal * (Tout ** 4 - TinfK ** 4)
  return { areaTop, areaSides, areaTotal, top, bottom, side, qConvection, qRadiation, q: qConvection + qRadiation }
}

// Inside wall temperature when the box has to shed qBox in total. The wall is taken to be at one
// temperature all over.
function boxWall(box: BoxInputs, TinfK: number, qBox: number): BoxResult & { Tw: number } {
  let lo = TinfK
  let hi = TinfK + 2000
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2
    if (boxLoss(box, TinfK, mid).q < qBox) lo = mid
    else hi = mid
  }
  const Tout = (lo + hi) / 2
  const { q: _q, ...loss } = boxLoss(box, TinfK, Tout)
  const dTWall = (qBox * box.wallThickness) / (box.wallConductivity * loss.areaTotal)
  return { ...loss, qBox, Tout, dTWall, Tw: Tout + dTWall }
}

// Heat one bar loses to a wall at Tw, with the bar at its limit Ts.
function barToWall(inp: EnclosedInputs, Ts: number, Tw: number) {
  const dT = Ts - Tw
  const Tf = (Ts + Tw) / 2
  const beta = 1 / Tf
  const air = airAt(Tf - 273.15)
  const areaFace = inp.length * inp.width
  const plus = (x: number) => Math.max(0, x)
  const layer = (gap: number, hotBelow: boolean): Gap => {
    const Ra = (G * beta * dT * gap ** 3) / (air.nu * air.alpha)
    // Hot surface underneath: still air below Ra = 1708, then Hollands et al. for the circulating
    // layer. Hot surface on top: the layer is stable, so it is conduction at any Ra.
    const circulating = hotBelow && Ra > RA_CRITICAL
    const Nu = circulating ? 1 + 1.44 * plus(1 - RA_CRITICAL / Ra) + plus(Ra ** (1 / 3) / 18 - 1) : 1
    return { gap, Ra, Nu, h: (Nu * air.k) / gap, circulating }
  }
  const top = layer(inp.gapTop, true)
  const bottom = inp.gapBottom === null ? null : layer(inp.gapBottom, false)
  const radFactor = inp.emissivity > 0 && inp.wallEmissivity > 0 ? 1 / (1 / inp.emissivity + 1 / inp.wallEmissivity - 1) : 0
  const qTop = top.h * areaFace * dT
  const qBottom = bottom ? bottom.h * areaFace * dT : 0
  const qRadiation = radFactor * STEFAN_BOLTZMANN * (bottom ? 2 : 1) * areaFace * (Ts ** 4 - Tw ** 4)
  return { Tf, beta, air, areaFace, top, bottom, radFactor, qTop, qBottom, qRadiation, qTotal: qTop + qBottom + qRadiation }
}

export type EnclosedOutcome = { ok: true; result: EnclosedResult } | { ok: false; wallC: number; limitC: number }

export function solveEnclosed(inp: EnclosedInputs): EnclosedOutcome {
  const Tinf = inp.ambientC + 273.15
  const Ts = Tinf + inp.deltaT

  let Tw: number
  let box: BoxResult | null = null
  if (inp.wall.kind === 'direct') {
    Tw = inp.wall.tempC + 273.15
  } else {
    // The bar's own heat warms the wall it is losing heat to, so find the bar heat Q at which the
    // two agree: Q = barToWall(Tw(Q + other heat)). The right side falls as Q rises.
    const b = inp.wall.box
    const wallFor = (q: number) => boxWall(b, Tinf, q + b.otherHeat)
    let lo = 0
    let hi = Math.max(0, barToWall(inp, Ts, wallFor(0).Tw).qTotal)
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2
      if (barToWall(inp, Ts, wallFor(mid).Tw).qTotal > mid) lo = mid
      else hi = mid
    }
    const { Tw: solvedTw, ...solved } = wallFor((lo + hi) / 2)
    Tw = solvedTw
    box = solved
  }

  if (!(Tw < Ts)) return { ok: false, wallC: Tw - 273.15, limitC: Ts - 273.15 }
  const bar = barToWall(inp, Ts, Tw)
  const crossSection = (inp.resistivity * inp.length * inp.current ** 2) / bar.qTotal
  return {
    ok: true,
    result: {
      Tinf, Ts, Tw, ...bar, box,
      crossSection,
      thickness: crossSection / inp.width,
      resistance: (inp.resistivity * inp.length) / crossSection,
      currentDensity: inp.current / (crossSection * 1e6),
    },
  }
}
