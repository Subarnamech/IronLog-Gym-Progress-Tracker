import { useId, useMemo, useState, type ReactNode } from 'react'
import { MoonIcon, SunIcon, TriangleAlertIcon } from 'lucide-react'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTheme } from '@/lib/theme'

import {
  AIR_DENSITY,
  AIR_T_MAX,
  AIR_T_MIN,
  ALUMINIUM,
  COPPER,
  G,
  STEFAN_BOLTZMANN,
  designCurrent,
  nextStandardThickness,
  resistivityAt,
  solve,
  type Conductor,
  type Face,
  type Result,
} from './calc'
import { RA_CRITICAL, solveEnclosed, type EnclosedOutcome, type Gap } from './enclosed'

type Mode = 'simple' | 'engineering'
type Surroundings = 'open' | 'enclosed'
type WallMode = 'direct' | 'box'

const MATERIALS: { value: string; label: string; conductor: Conductor | null }[] = [
  { value: 'copper', label: 'Copper', conductor: COPPER },
  { value: 'aluminium', label: 'Aluminium', conductor: ALUMINIUM },
  { value: 'custom', label: 'Other (enter resistivity)', conductor: null },
]

// Thermal conductivity of common enclosure walls, W/m·K
const WALL_MATERIALS: { value: string; label: string; k: number }[] = [
  { value: 'aluminium', label: 'Aluminium', k: 205 },
  { value: 'steel', label: 'Steel', k: 50 },
  { value: 'stainless', label: 'Stainless steel', k: 15 },
  { value: 'plastic', label: 'ABS or polycarbonate', k: 0.2 },
  { value: 'nylon', label: 'Nylon', k: 0.25 },
  { value: 'custom', label: 'Other (enter conductivity)', k: NaN },
]

// Opened from the installed app (start_url has ?source=pwa): no link back to the hub.
const standalone = (() => {
  const fromPwa = /[?&]source=pwa\b/.test(location.search)
  try {
    if (fromPwa) sessionStorage.setItem('busbar-standalone', '1')
    return sessionStorage.getItem('busbar-standalone') === '1'
  } catch {
    return fromPwa
  }
})()

const params = new URLSearchParams(location.search)

function loadMode(): Mode {
  // ?mode=engineering (or simple) in the address wins, so a link can open a given mode
  const fromUrl = params.get('mode')
  if (fromUrl === 'engineering' || fromUrl === 'simple') return fromUrl
  try {
    return localStorage.getItem('busbar-mode') === 'engineering' ? 'engineering' : 'simple'
  } catch {
    return 'simple'
  }
}

const num = (s: string) => (s.trim() === '' ? NaN : Number(s))
const toC = (kelvin: number) => kelvin - 273.15

// Up to `sig` significant figures, switching to ×10ⁿ outside a readable range.
function fmt(x: number, sig = 4): string {
  if (!Number.isFinite(x)) return '–'
  if (x === 0) return '0'
  const abs = Math.abs(x)
  if (abs >= 1e5 || abs < 1e-3) {
    const [m, e] = x.toExponential(sig - 1).split('e')
    return `${Number(m)} × 10${superscript(Number(e))}`
  }
  return String(Number(x.toPrecision(sig)))
}
function superscript(n: number): string {
  const map: Record<string, string> = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' }
  return String(n).split('').map((c) => map[c]).join('')
}

function Field({
  label,
  unit,
  value,
  onChange,
  hint,
  invalid,
}: {
  label: string
  unit?: string
  value: string
  onChange: (v: string) => void
  hint?: string
  invalid?: boolean
}) {
  const id = useId()
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          step="any"
          value={value}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value)}
          className={unit ? 'pr-14' : undefined}
        />
        {unit && (
          <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Choice({
  label,
  items,
  value,
  onChange,
}: {
  label: string
  items: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="grid content-start gap-1.5">
      <Label>{label}</Label>
      <Select items={items} value={value} onValueChange={(v) => v && onChange(v as string)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((m) => (
            <SelectItem key={m.value} value={m.value}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

// One line of working: what it is, the formula, and the number it gives.
function Step({ name, formula, value, unit }: { name: ReactNode; formula?: ReactNode; value: ReactNode; unit?: string }) {
  return (
    <div className="grid gap-x-4 gap-y-0.5 border-b py-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto] sm:items-baseline">
      <div className="text-muted-foreground">{name}</div>
      <div className="w-full justify-self-start text-left font-mono text-[0.8rem] break-words">{formula}</div>
      <div className="font-medium tabular-nums sm:text-right">
        {value}
        {unit && <span className="ml-1 font-normal text-muted-foreground">{unit}</span>}
      </div>
    </div>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="pt-2 text-xs text-pretty text-muted-foreground">{children}</p>
}

function FaceSteps({ face, lcFormula, pr }: { face: Face; lcFormula: string; pr?: number }) {
  return (
    <>
      <Step name="Characteristic length" formula={lcFormula} value={fmt(face.Lc * 1000)} unit="mm" />
      <Step name="Rayleigh number" formula="Ra = g β ΔT Lc³ / (ν α)" value={fmt(face.Ra)} />
      {pr !== undefined && <Step name="Prandtl number" formula="Pr = ν / α" value={fmt(pr)} />}
      <Step
        name={
          <>
            Nusselt number
            <span className="block text-xs">valid for {face.correlation.range}</span>
          </>
        }
        formula={face.correlation.formula}
        value={fmt(face.Nu)}
      />
      <Step name="Heat transfer coefficient" formula="h = Nu k / Lc" value={fmt(face.h)} unit="W/m²K" />
    </>
  )
}

function GapSteps({ gap, area, q, hotBelow }: { gap: Gap; area: number; q: number; hotBelow: boolean }) {
  return (
    <>
      <Step name="Gap" formula="δ" value={fmt(gap.gap * 1000)} unit="mm" />
      <Step name="Rayleigh number of the air layer" formula="Ra = g β (Ts − Tw) δ³ / (ν α)" value={fmt(gap.Ra)} />
      <Step
        name="Nusselt number"
        formula={
          gap.circulating
            ? 'Nu = 1 + 1.44 [1 − 1708/Ra]⁺ + [Ra^(1/3)/18 − 1]⁺'
            : hotBelow
              ? `Nu = 1  (Ra < ${RA_CRITICAL}, still air)`
              : 'Nu = 1  (hot surface on top, still air)'
        }
        value={fmt(gap.Nu)}
      />
      <Step name="Heat transfer coefficient" formula="h = Nu k / δ" value={fmt(gap.h)} unit="W/m²K" />
      <Step name="Heat across the gap" formula="Q = h A₁ (Ts − Tw)" value={fmt(q)} unit="W" />
      <Step name="Face area" formula="A₁ = L × w" value={fmt(area * 1e6)} unit="mm²" />
    </>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}

export default function BusbarApp() {
  const { dark, toggle } = useTheme()
  const [mode, setModeState] = useState<Mode>(loadMode)
  function setMode(m: Mode) {
    setModeState(m)
    try {
      localStorage.setItem('busbar-mode', m)
    } catch {
      // private mode: the choice just doesn't persist
    }
  }

  // Defaults are the spreadsheet's worked example.
  const [current, setCurrent] = useState('200')
  const [length, setLength] = useState('25')
  const [width, setWidth] = useState('47')
  const [ambient, setAmbient] = useState('40')
  const [rise, setRise] = useState('20')
  const [material, setMaterial] = useState('copper')
  const [customRho, setCustomRho] = useState('2e-8')
  const [emissivity, setEmissivity] = useState('0.05')
  const [underside, setUnderside] = useState(true)
  const [chosen, setChosen] = useState('')

  const [surroundings, setSurroundings] = useState<Surroundings>(params.get('surroundings') === 'enclosed' ? 'enclosed' : 'open')
  const [gapTop, setGapTop] = useState('5')
  const [gapBottom, setGapBottom] = useState('5')
  const [wallMode, setWallMode] = useState<WallMode>(params.get('wall') === 'box' ? 'box' : 'direct')
  const [wallTemp, setWallTemp] = useState('45')
  const [wallEmissivity, setWallEmissivity] = useState('0.9')
  const [box, setBox] = useState({
    length: '400', width: '300', height: '150', wall: '2', material: 'aluminium', customK: '1',
    otherHeat: '0', outerEmissivity: '0.9',
  })
  const setB = (k: keyof typeof box) => (v: string) => setBox((s) => ({ ...s, [k]: v }))

  const [veh, setVeh] = useState({
    mass: '300', rolling: '0.015', incline: '15', v0: '5', v1: '30', time: '3',
    cd: '0.8', area: '0.6', efficiency: '85', voltage: '77.28',
  })
  const setV = (k: keyof typeof veh) => (v: string) => setVeh((s) => ({ ...s, [k]: v }))

  const engineering = mode === 'engineering'
  const enclosed = surroundings === 'enclosed'

  // The bar is sized to sit at its limit, so that is the temperature its resistivity is taken at.
  const limitC = num(ambient) + num(rise)
  const conductor = MATERIALS.find((m) => m.value === material)!.conductor
  const resistivity = conductor ? resistivityAt(conductor, limitC) : num(customRho)
  const wallK = box.material === 'custom' ? num(box.customK) : WALL_MATERIALS.find((m) => m.value === box.material)!.k

  const unit01 = (s: string) => num(s) >= 0 && num(s) <= 1
  const bad = {
    current: !(num(current) > 0),
    length: !(num(length) > 0),
    width: !(num(width) > 0),
    ambient: !Number.isFinite(num(ambient)),
    rise: !(num(rise) > 0),
    resistivity: !(resistivity > 0),
    emissivity: !unit01(emissivity),
    gapTop: enclosed && !(num(gapTop) > 0),
    gapBottom: enclosed && underside && !(num(gapBottom) > 0),
    wallEmissivity: enclosed && !unit01(wallEmissivity),
    wallTemp: enclosed && wallMode === 'direct' && !Number.isFinite(num(wallTemp)),
    boxLength: enclosed && wallMode === 'box' && !(num(box.length) > 0),
    boxWidth: enclosed && wallMode === 'box' && !(num(box.width) > 0),
    boxHeight: enclosed && wallMode === 'box' && !(num(box.height) > 0),
    boxWall: enclosed && wallMode === 'box' && !(num(box.wall) > 0),
    boxK: enclosed && wallMode === 'box' && !(wallK > 0),
    boxHeat: enclosed && wallMode === 'box' && !(num(box.otherHeat) >= 0),
    boxEmissivity: enclosed && wallMode === 'box' && !unit01(box.outerEmissivity),
  }
  const valid = !Object.values(bad).some(Boolean)

  const common = {
    current: num(current),
    length: num(length) / 1000,
    width: num(width) / 1000,
    ambientC: num(ambient),
    deltaT: num(rise),
    resistivity,
    emissivity: num(emissivity),
  }
  const inputKey = JSON.stringify([common, underside, surroundings, gapTop, gapBottom, wallMode, wallTemp, wallEmissivity, box, wallK])

  // Open air: free convection from every face, as in the spreadsheet.
  const r: Result | null = useMemo(
    () => (valid && !enclosed ? solve({ ...common, undersideExposed: underside }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inputKey, valid],
  )
  // Enclosed: conduction across the air gaps to the box wall.
  const enc: EnclosedOutcome | null = useMemo(
    () =>
      valid && enclosed
        ? solveEnclosed({
            ...common,
            wallEmissivity: num(wallEmissivity),
            gapTop: num(gapTop) / 1000,
            gapBottom: underside ? num(gapBottom) / 1000 : null,
            wall:
              wallMode === 'direct'
                ? { kind: 'direct', tempC: num(wallTemp) }
                : {
                    kind: 'box',
                    box: {
                      length: num(box.length) / 1000,
                      width: num(box.width) / 1000,
                      height: num(box.height) / 1000,
                      wallThickness: num(box.wall) / 1000,
                      wallConductivity: wallK,
                      outerEmissivity: num(box.outerEmissivity),
                      otherHeat: num(box.otherHeat),
                    },
                  },
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inputKey, valid],
  )
  const e = enc?.ok ? enc.result : null
  const out = r ?? e // whichever method is active; both carry the fields the result card shows

  const tMm = out ? out.thickness * 1000 : NaN
  const standard = out ? nextStandardThickness(tMm) : null
  const chosenMm = num(chosen) > 0 ? num(chosen) : standard
  const safety = out && chosenMm ? chosenMm / tMm : NaN

  const filmC = out ? toC(out.Tf) : NaN
  const warnings: string[] = []
  if (out) {
    if (filmC < AIR_T_MIN || filmC > AIR_T_MAX)
      warnings.push(`The air property table covers ${AIR_T_MIN} to ${AIR_T_MAX} °C. The film temperature here is ${fmt(filmC, 3)} °C, so the nearest table values were used.`)
    if (out.thickness > num(width) / 1000)
      warnings.push('The thickness comes out larger than the width. The method assumes a flat bar, so try a wider one.')
  }
  if (r) {
    const off = [r.top, r.bottom, r.side].filter((f): f is Face => !!f && !f.correlation.inRange)
    if (off.length) warnings.push('The Rayleigh number is outside the range of one of the convection formulas, so that result is an extrapolation.')
  }
  if (e?.top.circulating)
    warnings.push(`The gap above the bar is wide enough for the air to circulate (Rayleigh number above ${RA_CRITICAL}), so a formula for a circulating air layer was used there instead of pure conduction.`)

  const v = designCurrent({
    mass: num(veh.mass), rollingResistance: num(veh.rolling), inclineDeg: num(veh.incline),
    v0Kmh: num(veh.v0), v1Kmh: num(veh.v1), accelTime: num(veh.time),
    dragCoefficient: num(veh.cd), frontalArea: num(veh.area),
    motorEfficiency: num(veh.efficiency) / 100, voltage: num(veh.voltage),
  })
  const vehicleOk = Number.isFinite(v.current) && v.current > 0

  const sizeSteps = out && (
    <>
      <Step
        name="Resistivity at the bar's temperature"
        formula={conductor ? `ρ = ρ₂₀ [1 + α (Ts − 20 °C)],  ρ₂₀ = ${fmt(conductor.rho20)}, α = ${conductor.tempCoeff} /K` : 'ρ, as entered'}
        value={fmt(resistivity)}
        unit="Ω·m"
      />
      <Step name="Heat balance" formula="I² R = Q,  R = ρ L / A" value={`${fmt(out.resistance * 1e6)} µΩ`} />
      <Step name="Cross-section" formula="A = ρ L I² / Q" value={fmt(out.crossSection * 1e6)} unit="mm²" />
      <Step name="Thickness" formula="t = A / w" value={fmt(tMm)} unit="mm" />
      <Step name="Current density" formula="J = I / A" value={fmt(out.currentDensity)} unit="A/mm²" />
      {chosenMm !== null && <Step name="Factor of safety" formula="chosen thickness / t" value={fmt(safety)} />}
    </>
  )

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-[110rem] flex-col px-4 sm:px-6 lg:px-8 2xl:px-12">
      <header className="flex h-14 items-center justify-between gap-3 border-b md:h-16">
        <div className="flex min-w-0 items-center gap-2">
          {!standalone && (
            <>
              <a href="../" className="text-muted-foreground transition-colors hover:text-foreground">
                OmniPorta
              </a>
              <span className="text-muted-foreground/50" aria-hidden="true">
                /
              </span>
            </>
          )}
          <span className="truncate font-semibold tracking-tight">Busbar Sizing</span>
        </div>
        <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
          {dark ? <SunIcon /> : <MoonIcon />}
        </Button>
      </header>

      <main className="flex-1 py-6 md:py-8">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Busbar thickness</h1>
            <p className="mt-1 max-w-prose text-sm text-pretty text-muted-foreground">
              Finds how thick a flat bar must be to carry a current without heating up more than you allow.
            </p>
          </div>
          <Tabs value={mode} onValueChange={(m) => setMode(m as Mode)}>
            <TabsList>
              <TabsTrigger value="simple" className="px-3">
                Simple
              </TabsTrigger>
              <TabsTrigger value="engineering" className="px-3">
                Engineering
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2 lg:items-start">
          <Card>
            <CardHeader>
              <CardTitle>Inputs</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Current" unit="A" value={current} onChange={setCurrent} invalid={bad.current} />
                <Field label="Length" unit="mm" value={length} onChange={setLength} invalid={bad.length} hint="Along the current." />
                <Field label="Width" unit="mm" value={width} onChange={setWidth} invalid={bad.width} />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field
                  label={enclosed ? 'Air temperature outside the box' : 'Air temperature'}
                  unit="°C"
                  value={ambient}
                  onChange={setAmbient}
                  invalid={bad.ambient}
                  hint="Use the hottest it will get."
                />
                <Field label="Allowed temperature rise" unit="°C" value={rise} onChange={setRise} invalid={bad.rise} hint="How much hotter than that air the bar may run." />
                <Choice
                  label="Material"
                  items={MATERIALS.filter((m) => engineering || m.value !== 'custom' || material === 'custom')}
                  value={material}
                  onChange={setMaterial}
                />
              </div>

              {(engineering || material === 'custom') && (
                <div className="grid gap-4 sm:grid-cols-3">
                  {material === 'custom' && (
                    <Field label="Resistivity" unit="Ω·m" value={customRho} onChange={setCustomRho} invalid={bad.resistivity} hint="At the bar's working temperature." />
                  )}
                  {engineering && (
                    <Field
                      label="Emissivity of the bar"
                      value={emissivity}
                      onChange={setEmissivity}
                      invalid={bad.emissivity}
                      hint="0 to 1. Bare polished metal is about 0.05."
                    />
                  )}
                </div>
              )}

              <Separator />
              <div className="grid gap-1.5">
                <Label>Where the bar is</Label>
                <Tabs value={surroundings} onValueChange={(s) => setSurroundings(s as Surroundings)}>
                  <TabsList>
                    <TabsTrigger value="open" className="px-3">
                      Open air
                    </TabsTrigger>
                    <TabsTrigger value="enclosed" className="px-3">
                      Enclosed, small gap
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <p className="text-sm text-pretty text-muted-foreground">
                  {enclosed
                    ? 'For a bar inside a box with less than about 10 mm of air to the wall. The air cannot circulate, so heat crosses the gap by conduction.'
                    : 'Air is free to move around the bar and carries the heat away by convection.'}
                </p>
              </div>

              <label className="flex items-start justify-between gap-4">
                <span>
                  <span className="font-medium">{enclosed ? 'Air gap under the bar too' : 'Underside open to air'}</span>
                  <span className="block text-sm text-muted-foreground">
                    Turn off if the bar sits flat on a panel, holder or insulator, so its underside loses no heat.
                  </span>
                </span>
                <Switch checked={underside} onCheckedChange={setUnderside} className="mt-0.5" />
              </label>

              {enclosed && (
                <>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Gap above the bar" unit="mm" value={gapTop} onChange={setGapTop} invalid={bad.gapTop} />
                    {underside && (
                      <Field label="Gap below the bar" unit="mm" value={gapBottom} onChange={setGapBottom} invalid={bad.gapBottom} />
                    )}
                    {engineering && (
                      <Field
                        label="Emissivity of the wall"
                        value={wallEmissivity}
                        onChange={setWallEmissivity}
                        invalid={bad.wallEmissivity}
                        hint="Inside surface. Paint and plastic are about 0.9."
                      />
                    )}
                  </div>

                  <div className="grid gap-1.5">
                    <Label>Box wall temperature</Label>
                    <Tabs value={wallMode} onValueChange={(w) => setWallMode(w as WallMode)}>
                      <TabsList>
                        <TabsTrigger value="direct" className="px-3">
                          Enter it
                        </TabsTrigger>
                        <TabsTrigger value="box" className="px-3">
                          Estimate from the box
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>

                  {wallMode === 'direct' ? (
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field
                        label="Wall temperature"
                        unit="°C"
                        value={wallTemp}
                        onChange={setWallTemp}
                        invalid={bad.wallTemp}
                        hint="Inside surface, at full load."
                      />
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-4 sm:grid-cols-3">
                        <Field label="Box length" unit="mm" value={box.length} onChange={setB('length')} invalid={bad.boxLength} />
                        <Field label="Box width" unit="mm" value={box.width} onChange={setB('width')} invalid={bad.boxWidth} />
                        <Field label="Box height" unit="mm" value={box.height} onChange={setB('height')} invalid={bad.boxHeight} />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-3">
                        <Choice label="Wall material" items={WALL_MATERIALS} value={box.material} onChange={setB('material')} />
                        <Field label="Wall thickness" unit="mm" value={box.wall} onChange={setB('wall')} invalid={bad.boxWall} />
                        <Field
                          label="Other heat in the box"
                          unit="W"
                          value={box.otherHeat}
                          onChange={setB('otherHeat')}
                          invalid={bad.boxHeat}
                          hint="Cells and other bars. It warms the wall."
                        />
                      </div>
                      {(box.material === 'custom' || engineering) && (
                        <div className="grid gap-4 sm:grid-cols-3">
                          {box.material === 'custom' && (
                            <Field label="Wall conductivity" unit="W/m·K" value={box.customK} onChange={setB('customK')} invalid={bad.boxK} />
                          )}
                          {engineering && (
                            <Field
                              label="Emissivity of the box outside"
                              value={box.outerEmissivity}
                              onChange={setB('outerEmissivity')}
                              invalid={bad.boxEmissivity}
                              hint="Bare aluminium is about 0.1."
                            />
                          )}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Result</CardTitle>
              {!valid && <CardDescription>Fill in every input with a valid number to see the result.</CardDescription>}
            </CardHeader>
            {enc && !enc.ok && (
              <CardContent>
                <Alert variant="destructive">
                  <TriangleAlertIcon />
                  <AlertTitle>The box wall is too hot</AlertTitle>
                  <AlertDescription>
                    The wall would be at {fmt(enc.wallC, 3)} °C, but the bar is only allowed to reach {fmt(enc.limitC, 3)} °C.
                    The bar cannot lose heat to a wall that is hotter than itself, so no thickness works. Lower the heat
                    in the box, cool the box, or allow a higher temperature.
                  </AlertDescription>
                </Alert>
              </CardContent>
            )}
            {out && (
              <CardContent className="grid gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Minimum thickness</div>
                  <div className="mt-1 text-4xl font-semibold tracking-tight tabular-nums">
                    {fmt(tMm, 3)} <span className="text-xl font-normal text-muted-foreground">mm</span>
                  </div>
                  {standard !== null && (
                    <p className="mt-2 text-sm">
                      Use a <span className="font-medium">{fmt(num(width))} × {standard} mm</span> bar, the next standard
                      thickness up.
                    </p>
                  )}
                </div>

                {engineering && (
                  <div className="max-w-52">
                    <Field
                      label="Chosen thickness"
                      unit="mm"
                      value={chosen}
                      onChange={setChosen}
                      hint={standard !== null ? `Leave empty to use ${standard} mm.` : undefined}
                    />
                  </div>
                )}

                <dl className="divide-y text-sm">
                  {chosenMm !== null && (
                    <Row
                      label={`Factor of safety at ${fmt(chosenMm)} mm`}
                      value={<span className={safety < 1 ? 'text-destructive' : undefined}>{fmt(safety, 3)}</span>}
                    />
                  )}
                  <Row label="Cross-section" value={`${fmt(out.crossSection * 1e6)} mm²`} />
                  <Row label="Current density" value={`${fmt(out.currentDensity, 3)} A/mm²`} />
                  <Row label="Heat to get rid of" value={`${fmt(out.qTotal, 3)} W`} />
                  <Row label="Bar temperature at this size" value={`${fmt(toC(out.Ts), 3)} °C`} />
                  {e && <Row label={e.box ? 'Box wall temperature, estimated' : 'Box wall temperature'} value={`${fmt(toC(e.Tw), 3)} °C`} />}
                </dl>

                {chosenMm !== null && safety < 1 && (
                  <Alert variant="destructive">
                    <TriangleAlertIcon />
                    <AlertTitle>{fmt(chosenMm)} mm is too thin</AlertTitle>
                    <AlertDescription>The bar would run hotter than the rise you allowed.</AlertDescription>
                  </Alert>
                )}
                {warnings.map((w) => (
                  <Alert key={w}>
                    <TriangleAlertIcon />
                    <AlertDescription>{w}</AlertDescription>
                  </Alert>
                ))}

                <p className="text-xs text-pretty text-muted-foreground">
                  {enclosed
                    ? 'Assumes a bare flat bar with direct current, losing heat only from its wide faces to a box wall at one even temperature.'
                    : 'Assumes a bare bar lying flat in still air, with direct current.'}{' '}
                  Joints, nearby bars and alternating-current effects are not included, so check the result against your
                  standard.
                </p>
              </CardContent>
            )}
          </Card>
        </div>

        {engineering && (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Calculation</CardTitle>
              <CardDescription>
                {enclosed
                  ? 'The bar is sized so the heat it generates equals the heat that crosses the air gaps to the box wall, by conduction and radiation, at the allowed temperature rise.'
                  : 'The bar is sized so the heat it generates equals the heat it loses by free convection and radiation at the allowed temperature rise.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion multiple>
                {r && (
                  <>
                    <AccordionItem value="air">
                      <AccordionTrigger>1. Air properties at the film temperature</AccordionTrigger>
                      <AccordionContent>
                        <Step name="Ambient temperature" formula="T∞" value={fmt(r.Tinf, 5)} unit="K" />
                        <Step name="Surface temperature" formula="Ts = T∞ + ΔT" value={fmt(r.Ts, 5)} unit="K" />
                        <Step name="Film temperature" formula="Tf = (T∞ + Ts) / 2" value={`${fmt(r.Tf, 5)} K (${fmt(filmC, 4)} °C)`} />
                        <Step name="Thermal expansion coefficient" formula="β = 1 / Tf" value={fmt(r.beta)} unit="1/K" />
                        <Step name="Thermal conductivity" formula="k, air table at Tf" value={fmt(r.air.k)} unit="W/m·K" />
                        <Step name="Kinematic viscosity" formula="ν, air table at Tf" value={fmt(r.air.nu)} unit="m²/s" />
                        <Step name="Thermal diffusivity" formula="α, air table at Tf" value={fmt(r.air.alpha)} unit="m²/s" />
                        <Note>Properties of air at 1 atm, interpolated between table rows. g = {G} m/s².</Note>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="top">
                      <AccordionTrigger>2. Top face: hot surface facing up</AccordionTrigger>
                      <AccordionContent>
                        <Step name="Area" formula="A₁ = L × w" value={fmt(r.areaTop * 1e6)} unit="mm²" />
                        <FaceSteps face={r.top} lcFormula="Lc = A₁ / P = L w / [2 (L + w)]" />
                        <Note>
                          Nu = 0.54 Ra^(1/4) for 10⁴ ≤ Ra ≤ 10⁷, and 0.15 Ra^(1/3) for 10⁷ ≤ Ra ≤ 10¹¹. Below 10⁴ the
                          air barely moves, so Nu = 1 is used.
                        </Note>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="bottom">
                      <AccordionTrigger>3. Underside: hot surface facing down</AccordionTrigger>
                      <AccordionContent>
                        {r.bottom ? (
                          <>
                            <Step name="Area" formula="A₁ = L × w" value={fmt(r.areaBottom * 1e6)} unit="mm²" />
                            <FaceSteps face={r.bottom} lcFormula="Lc = A₁ / P = L w / [2 (L + w)]" />
                            <Note>
                              Nu = 0.27 Ra^(1/4) for 10⁵ ≤ Ra ≤ 10¹⁰. Warm air is trapped under the plate, so this
                              face cools about half as well as the top. Below 10⁵, Nu = 1 is used.
                            </Note>
                          </>
                        ) : (
                          <p className="py-2 text-muted-foreground">
                            Not included: the underside is set as not open to air, so it sheds no heat.
                          </p>
                        )}
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="side">
                      <AccordionTrigger>4. Edges: vertical faces</AccordionTrigger>
                      <AccordionContent>
                        <Step name="Long edges, both" formula="2 A₂ = 2 L t" value={fmt(r.areaSideLong * 1e6)} unit="mm²" />
                        <Step name="End faces, both" formula="2 A₃ = 2 w t" value={fmt(r.areaSideEnd * 1e6)} unit="mm²" />
                        <FaceSteps face={r.side} lcFormula="Lc = t (height of the edge)" pr={r.Pr} />
                        <Note>
                          Churchill and Chu, vertical wall. For Ra ≥ 10⁹ the turbulent form Nu = {'{'}0.825 + 0.387
                          Ra^(1/6) / [1 + (0.492/Pr)^(9/16)]^(8/27){'}'}² is used. The edges depend on the thickness
                          being solved for, so the calculation is repeated until the two agree.
                        </Note>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="heat">
                      <AccordionTrigger>5. Heat lost</AccordionTrigger>
                      <AccordionContent>
                        <Step name="Top, convection" formula="h_top A₁ ΔT" value={fmt(r.qTop)} unit="W" />
                        <Step name="Underside, convection" formula="h_bottom A₁ ΔT" value={fmt(r.qBottom)} unit="W" />
                        <Step name="Edges, convection" formula="h_side (2 A₂ + 2 A₃) ΔT" value={fmt(r.qSide)} unit="W" />
                        <Step
                          name="Radiation"
                          formula={`ε σ A_total (Ts⁴ − T∞⁴),  σ = ${fmt(STEFAN_BOLTZMANN)} W/m²K⁴`}
                          value={fmt(r.qRadiation)}
                          unit="W"
                        />
                        <Step name="Total" formula="Q = Q_conv + Q_rad" value={fmt(r.qTotal)} unit="W" />
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="size">
                      <AccordionTrigger>6. Cross-section and thickness</AccordionTrigger>
                      <AccordionContent>{sizeSteps}</AccordionContent>
                    </AccordionItem>
                  </>
                )}

                {e && (
                  <>
                    <AccordionItem value="e-air">
                      <AccordionTrigger>1. Temperatures and air properties</AccordionTrigger>
                      <AccordionContent>
                        <Step name="Air outside the box" formula="T∞" value={fmt(e.Tinf, 5)} unit="K" />
                        <Step name="Bar temperature" formula="Ts = T∞ + ΔT" value={`${fmt(e.Ts, 5)} K (${fmt(toC(e.Ts), 4)} °C)`} />
                        <Step
                          name="Box wall, inside"
                          formula={e.box ? 'Tw, from step 5' : 'Tw, as entered'}
                          value={`${fmt(e.Tw, 5)} K (${fmt(toC(e.Tw), 4)} °C)`}
                        />
                        <Step name="Mean temperature of the air gap" formula="Tf = (Ts + Tw) / 2" value={`${fmt(e.Tf, 5)} K (${fmt(filmC, 4)} °C)`} />
                        <Step name="Thermal expansion coefficient" formula="β = 1 / Tf" value={fmt(e.beta)} unit="1/K" />
                        <Step name="Thermal conductivity" formula="k, air table at Tf" value={fmt(e.air.k)} unit="W/m·K" />
                        <Step name="Kinematic viscosity" formula="ν, air table at Tf" value={fmt(e.air.nu)} unit="m²/s" />
                        <Step name="Thermal diffusivity" formula="α, air table at Tf" value={fmt(e.air.alpha)} unit="m²/s" />
                        <Note>Properties of air at 1 atm, interpolated between table rows. g = {G} m/s².</Note>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="e-top">
                      <AccordionTrigger>2. Gap above the bar</AccordionTrigger>
                      <AccordionContent>
                        <GapSteps gap={e.top} area={e.areaFace} q={e.qTop} hotBelow />
                        <Note>
                          An air layer heated from below stays still while Ra is under {RA_CRITICAL}, so heat crosses
                          it by conduction alone: h = k / δ. Above that the air circulates and the Hollands formula for
                          an enclosed horizontal layer is used.
                        </Note>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="e-bottom">
                      <AccordionTrigger>3. Gap below the bar</AccordionTrigger>
                      <AccordionContent>
                        {e.bottom ? (
                          <>
                            <GapSteps gap={e.bottom} area={e.areaFace} q={e.qBottom} hotBelow={false} />
                            <Note>
                              With the hot surface on top the air layer is stable and never circulates, so this is
                              conduction at any gap.
                            </Note>
                          </>
                        ) : (
                          <p className="py-2 text-muted-foreground">
                            Not included: the bar is set as resting on a surface, so its underside sheds no heat.
                          </p>
                        )}
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="e-heat">
                      <AccordionTrigger>4. Radiation and total heat lost</AccordionTrigger>
                      <AccordionContent>
                        <Step name="Exchange factor, two facing surfaces" formula="F = 1 / (1/ε_bar + 1/ε_wall − 1)" value={fmt(e.radFactor)} />
                        <Step
                          name="Radiation"
                          formula={`F σ ${e.bottom ? '2 A₁' : 'A₁'} (Ts⁴ − Tw⁴),  σ = ${fmt(STEFAN_BOLTZMANN)} W/m²K⁴`}
                          value={fmt(e.qRadiation)}
                          unit="W"
                        />
                        <Step name="Across the gap above" formula="from step 2" value={fmt(e.qTop)} unit="W" />
                        <Step name="Across the gap below" formula="from step 3" value={fmt(e.qBottom)} unit="W" />
                        <Step name="Total" formula="Q = Q_above + Q_below + Q_rad" value={fmt(e.qTotal)} unit="W" />
                        <Note>The narrow edges are left out, which makes the bar come out slightly thicker than strictly needed.</Note>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="e-box">
                      <AccordionTrigger>5. Box wall temperature</AccordionTrigger>
                      <AccordionContent>
                        {e.box ? (
                          <>
                            <Step name="Heat the box must shed" formula="Q_box = Q + other heat" value={fmt(e.box.qBox)} unit="W" />
                            <Step name="Outside area" formula="A_box = 2 L_b W_b + 2 (L_b + W_b) H_b" value={fmt(e.box.areaTotal)} unit="m²" />
                            <Step name="Top of the box" formula={`${e.box.top.correlation.formula},  Lc = A / P`} value={fmt(e.box.top.h)} unit="W/m²K" />
                            <Step name="Underside of the box" formula={`${e.box.bottom.correlation.formula},  Lc = A / P`} value={fmt(e.box.bottom.h)} unit="W/m²K" />
                            <Step name="Sides of the box" formula="Churchill and Chu,  Lc = H_b" value={fmt(e.box.side.h)} unit="W/m²K" />
                            <Step name="Convection from the outside" formula="Σ h A (T_out − T∞)" value={fmt(e.box.qConvection)} unit="W" />
                            <Step name="Radiation from the outside" formula="ε_box σ A_box (T_out⁴ − T∞⁴)" value={fmt(e.box.qRadiation)} unit="W" />
                            <Step
                              name="Outside wall temperature"
                              formula="T_out, where convection + radiation = Q_box"
                              value={`${fmt(e.box.Tout, 5)} K (${fmt(toC(e.box.Tout), 4)} °C)`}
                            />
                            <Step name="Drop through the wall" formula="ΔT_wall = Q_box t_wall / (k_wall A_box)" value={fmt(e.box.dTWall)} unit="K" />
                            <Step name="Inside wall temperature" formula="Tw = T_out + ΔT_wall" value={`${fmt(e.Tw, 5)} K (${fmt(toC(e.Tw), 4)} °C)`} />
                            <Note>
                              The box is treated as standing in open, still air with all six faces exposed and its wall
                              at one even temperature. The bar's own heat warms the wall it is losing heat to, so steps
                              1 to 5 are repeated until they agree.
                            </Note>
                          </>
                        ) : (
                          <p className="py-2 text-muted-foreground">Entered directly: {fmt(toC(e.Tw), 4)} °C.</p>
                        )}
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="e-size">
                      <AccordionTrigger>6. Cross-section and thickness</AccordionTrigger>
                      <AccordionContent>{sizeSteps}</AccordionContent>
                    </AccordionItem>
                  </>
                )}

                <AccordionItem value="vehicle">
                  <AccordionTrigger>Design current from a vehicle's drive motor</AccordionTrigger>
                  <AccordionContent>
                    <p className="pb-3 text-muted-foreground">
                      Optional. Estimates the current a traction motor draws while accelerating up a slope.
                    </p>
                    <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
                      <Field label="Total mass" unit="kg" value={veh.mass} onChange={setV('mass')} />
                      <Field label="Rolling resistance" value={veh.rolling} onChange={setV('rolling')} />
                      <Field label="Incline" unit="°" value={veh.incline} onChange={setV('incline')} />
                      <Field label="Initial speed" unit="km/h" value={veh.v0} onChange={setV('v0')} />
                      <Field label="Final speed" unit="km/h" value={veh.v1} onChange={setV('v1')} />
                      <Field label="Acceleration time" unit="s" value={veh.time} onChange={setV('time')} />
                      <Field label="Drag coefficient" value={veh.cd} onChange={setV('cd')} />
                      <Field label="Frontal area" unit="m²" value={veh.area} onChange={setV('area')} />
                      <Field label="Motor efficiency" unit="%" value={veh.efficiency} onChange={setV('efficiency')} />
                      <Field label="Motor voltage" unit="V" value={veh.voltage} onChange={setV('voltage')} />
                    </div>
                    <div className="mt-4">
                      <Step name="Grade and rolling force" formula="m g sin θ + C_rr m g cos θ" value={fmt(v.fGradeRolling)} unit="N" />
                      <Step name="Acceleration force" formula="m (v₁ − v₀) / t" value={fmt(v.fAccel)} unit="N" />
                      <Step name="Aerodynamic force" formula={`½ ρ_air C_d A v₁²,  ρ_air = ${AIR_DENSITY} kg/m³`} value={fmt(v.fAero)} unit="N" />
                      <Step name="Total force" formula="F = sum of the three" value={fmt(v.fTotal)} unit="N" />
                      <Step name="Mechanical power" formula="P = F × (v₀ + v₁) / 2" value={fmt(v.power)} unit="W" />
                      <Step name="Electrical power" formula="P_el = P / η" value={fmt(v.electricalPower)} unit="W" />
                      <Step name="Motor current" formula="I = P_el / V" value={fmt(v.current)} unit="A" />
                    </div>
                    <Button
                      variant="outline"
                      className="mt-4"
                      disabled={!vehicleOk}
                      onClick={() => setCurrent(String(Math.ceil(v.current)))}
                    >
                      {vehicleOk ? `Use ${Math.ceil(v.current)} A as the current` : 'Fill in every field'}
                    </Button>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
