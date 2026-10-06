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
  G,
  STEFAN_BOLTZMANN,
  designCurrent,
  nextStandardThickness,
  solve,
  type Face,
  type Result,
} from './calc'

type Mode = 'simple' | 'engineering'

const MATERIALS = [
  { value: 'copper', label: 'Copper', resistivity: 1.77e-8 },
  { value: 'aluminium', label: 'Aluminium', resistivity: 2.82e-8 },
  { value: 'custom', label: 'Other (enter resistivity)', resistivity: NaN },
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

function loadMode(): Mode {
  // ?mode=engineering (or simple) in the address wins, so a link can open a given mode
  const fromUrl = new URLSearchParams(location.search).get('mode')
  if (fromUrl === 'engineering' || fromUrl === 'simple') return fromUrl
  try {
    return localStorage.getItem('busbar-mode') === 'engineering' ? 'engineering' : 'simple'
  } catch {
    return 'simple'
  }
}

const num = (s: string) => (s.trim() === '' ? NaN : Number(s))

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
    <div className="grid gap-1.5">
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

// One line of working: what it is, the formula, and the number it gives.
function Step({ name, formula, value, unit }: { name: ReactNode; formula?: ReactNode; value: ReactNode; unit?: string }) {
  return (
    <div className="grid gap-x-4 gap-y-0.5 border-b py-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto] sm:items-baseline">
      <div className="text-muted-foreground">{name}</div>
      <div className="text-left font-mono text-[0.8rem] break-words">{formula}</div>
      <div className="font-medium tabular-nums sm:text-right">
        {value}
        {unit && <span className="ml-1 font-normal text-muted-foreground">{unit}</span>}
      </div>
    </div>
  )
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
  const [customRho, setCustomRho] = useState('1.77e-8')
  const [emissivity, setEmissivity] = useState('0.05')
  const [underside, setUnderside] = useState(true)
  const [chosen, setChosen] = useState('')

  const [veh, setVeh] = useState({
    mass: '300', rolling: '0.015', incline: '15', v0: '5', v1: '30', time: '3',
    cd: '0.8', area: '0.6', efficiency: '85', voltage: '77.28',
  })
  const setV = (k: keyof typeof veh) => (v: string) => setVeh((s) => ({ ...s, [k]: v }))

  const engineering = mode === 'engineering'
  const resistivity =
    material === 'custom' ? num(customRho) : MATERIALS.find((m) => m.value === material)!.resistivity

  const bad = {
    current: !(num(current) > 0),
    length: !(num(length) > 0),
    width: !(num(width) > 0),
    ambient: !Number.isFinite(num(ambient)),
    rise: !(num(rise) > 0),
    resistivity: !(resistivity > 0),
    emissivity: !(num(emissivity) >= 0 && num(emissivity) <= 1),
  }
  const valid = !Object.values(bad).some(Boolean)

  const r: Result | null = useMemo(
    () =>
      valid
        ? solve({
            current: num(current),
            length: num(length) / 1000,
            width: num(width) / 1000,
            ambientC: num(ambient),
            deltaT: num(rise),
            resistivity,
            emissivity: num(emissivity),
            undersideExposed: underside,
          })
        : null,
    [valid, current, length, width, ambient, rise, resistivity, emissivity, underside],
  )

  const tMm = r ? r.thickness * 1000 : NaN
  const standard = r ? nextStandardThickness(tMm) : null
  const chosenMm = num(chosen) > 0 ? num(chosen) : standard
  const safety = r && chosenMm ? chosenMm / tMm : NaN

  const filmC = r ? r.Tf - 273.15 : NaN
  const warnings: string[] = []
  if (r) {
    if (filmC < AIR_T_MIN || filmC > AIR_T_MAX)
      warnings.push(`The air property table covers ${AIR_T_MIN} to ${AIR_T_MAX} °C. The film temperature here is ${fmt(filmC, 3)} °C, so the nearest table values were used.`)
    const out = [r.top, r.bottom, r.side].filter((f): f is Face => !!f && !f.correlation.inRange)
    if (out.length) warnings.push('The Rayleigh number is outside the range of one of the convection formulas, so that result is an extrapolation.')
    if (r.thickness > num(width) / 1000)
      warnings.push('The thickness comes out larger than the width. The method assumes a flat bar, so try a wider one.')
  }

  const v = designCurrent({
    mass: num(veh.mass), rollingResistance: num(veh.rolling), inclineDeg: num(veh.incline),
    v0Kmh: num(veh.v0), v1Kmh: num(veh.v1), accelTime: num(veh.time),
    dragCoefficient: num(veh.cd), frontalArea: num(veh.area),
    motorEfficiency: num(veh.efficiency) / 100, voltage: num(veh.voltage),
  })
  const vehicleOk = Number.isFinite(v.current) && v.current > 0

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
                <Field label="Length" unit="mm" value={length} onChange={setLength} invalid={bad.length} />
                <Field label="Width" unit="mm" value={width} onChange={setWidth} invalid={bad.width} />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Air temperature" unit="°C" value={ambient} onChange={setAmbient} invalid={bad.ambient} hint="Use the hottest it will get." />
                <Field label="Allowed temperature rise" unit="°C" value={rise} onChange={setRise} invalid={bad.rise} hint="How much hotter than the air the bar may run." />
                <div className="grid content-start gap-1.5">
                  <Label>Material</Label>
                  <Select items={MATERIALS} value={material} onValueChange={(m) => m && setMaterial(m as string)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MATERIALS.filter((m) => engineering || m.value !== 'custom' || material === 'custom').map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {(engineering || material === 'custom') && (
                <div className="grid gap-4 sm:grid-cols-3">
                  {material === 'custom' && (
                    <Field label="Resistivity" unit="Ω·m" value={customRho} onChange={setCustomRho} invalid={bad.resistivity} />
                  )}
                  {engineering && (
                    <Field
                      label="Emissivity"
                      value={emissivity}
                      onChange={setEmissivity}
                      invalid={bad.emissivity}
                      hint="0 to 1. Bare polished metal is about 0.05."
                    />
                  )}
                </div>
              )}

              <Separator />
              <label className="flex items-start justify-between gap-4">
                <span>
                  <span className="font-medium">Underside open to air</span>
                  <span className="block text-sm text-muted-foreground">
                    Turn off if the bar sits flat on a panel or insulator, so only the top and edges cool it.
                  </span>
                </span>
                <Switch checked={underside} onCheckedChange={setUnderside} className="mt-0.5" />
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Result</CardTitle>
              {!r && <CardDescription>Fill in every input with a valid number to see the result.</CardDescription>}
            </CardHeader>
            {r && (
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
                  <Row label="Cross-section" value={`${fmt(r.crossSection * 1e6)} mm²`} />
                  <Row label="Current density" value={`${fmt(r.currentDensity, 3)} A/mm²`} />
                  <Row label="Heat to get rid of" value={`${fmt(r.qTotal, 3)} W`} />
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
                  Assumes a bare bar lying flat in still air, with direct current. Joints, enclosures, nearby bars and
                  alternating-current effects are not included, so check the result against your standard.
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
                The bar is sized so the heat it generates equals the heat it loses by free convection and radiation at
                the allowed temperature rise.
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
                        <p className="pt-2 text-xs text-muted-foreground">
                          Properties of air at 1 atm, interpolated between table rows. g = {G} m/s².
                        </p>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="top">
                      <AccordionTrigger>2. Top face: hot surface facing up</AccordionTrigger>
                      <AccordionContent>
                        <Step name="Area" formula="A₁ = L × w" value={fmt(r.areaTop * 1e6)} unit="mm²" />
                        <FaceSteps face={r.top} lcFormula="Lc = A₁ / P = L w / [2 (L + w)]" />
                        <p className="pt-2 text-xs text-muted-foreground">
                          Nu = 0.54 Ra^(1/4) for 10⁴ ≤ Ra ≤ 10⁷, and 0.15 Ra^(1/3) for 10⁷ ≤ Ra ≤ 10¹¹. Below 10⁴ the
                          air barely moves, so Nu = 1 is used.
                        </p>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="bottom">
                      <AccordionTrigger>3. Underside: hot surface facing down</AccordionTrigger>
                      <AccordionContent>
                        {r.bottom ? (
                          <>
                            <Step name="Area" formula="A₁ = L × w" value={fmt(r.areaBottom * 1e6)} unit="mm²" />
                            <FaceSteps face={r.bottom} lcFormula="Lc = A₁ / P = L w / [2 (L + w)]" />
                            <p className="pt-2 text-xs text-muted-foreground">
                              Nu = 0.27 Ra^(1/4) for 10⁵ ≤ Ra ≤ 10¹⁰. Warm air is trapped under the plate, so this
                              face cools about half as well as the top. Below 10⁵, Nu = 1 is used.
                            </p>
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
                        <p className="pt-2 text-xs text-muted-foreground">
                          Churchill and Chu, vertical wall. For Ra ≥ 10⁹ the turbulent form Nu = {'{'}0.825 + 0.387
                          Ra^(1/6) / [1 + (0.492/Pr)^(9/16)]^(8/27){'}'}² is used. The edges depend on the thickness
                          being solved for, so the calculation is repeated until the two agree.
                        </p>
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
                      <AccordionContent>
                        <Step name="Heat balance" formula="I² R = Q,  R = ρ L / A" value={`${fmt(r.resistance * 1e6)} µΩ`} />
                        <Step name="Resistivity" formula="ρ" value={fmt(resistivity)} unit="Ω·m" />
                        <Step name="Cross-section" formula="A = ρ L I² / Q" value={fmt(r.crossSection * 1e6)} unit="mm²" />
                        <Step name="Thickness" formula="t = A / w" value={fmt(tMm)} unit="mm" />
                        <Step name="Current density" formula="J = I / A" value={fmt(r.currentDensity)} unit="A/mm²" />
                        {chosenMm !== null && (
                          <Step name="Factor of safety" formula="chosen thickness / t" value={fmt(safety)} />
                        )}
                      </AccordionContent>
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
