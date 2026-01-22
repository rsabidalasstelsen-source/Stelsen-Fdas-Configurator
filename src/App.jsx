import React, { useMemo, useState } from "react";
import "./App.css";

/* ======================
   SIMPLE LOGIN (CLIENT-SIDE)
   NOTE: basic protection only
====================== */
const AUTH_CONFIG = {
  username: "admin",
  password: "fdas123", // palitan mo
};

const DEFAULT_DEVICE_CATALOG = [
  { key: "smoke", label: "Smoke Detector", points: 1 },
  { key: "heat", label: "Heat Detector", points: 1 },
  { key: "mps", label: "Manual Pull Station", points: 1 },
  { key: "aim", label: "Addressable Interface Module (AIM)", points: 1 },
  { key: "ann", label: "Annunciator (device)", points: 1 },
  { key: "wfs", label: "Water Flow Switch (WFS)", points: 1 },
  { key: "ts", label: "Tamper Switch (TS)", points: 1 },
  { key: "fjt", label: "Fireman’s Telephone Jack", points: 1 },
  { key: "md", label: "Motorized Damper", points: 1 },
  { key: "hornStrobe", label: "Horn/Strobe", points: 0 },
  { key: "speakerStrobe", label: "Speaker/Strobe", points: 0 },
];

const DEFAULT_RULES = {
  sparePercent: 0.1,
  loopMaxPoints: 250,
  loopSparePercent: 0.2,

  nacMaxAmps: 2.0,
  hornStrobeAmpsEach: 0.10,
  speakerStrobeAmpsEach: 0.11,
  nacSparePercent: 0.2,

  moduleMap: {
    CT1: { label: "GSA-CT1 (Monitor/Input Module)" },
    CR: { label: "GSA-CR (Control Relay Module)" },
    CC1: { label: "GSA-CC1 (NAC / Control Module)" },
    SIM: { label: "SIM-INTL (Serial Interface / Zone Module)" },
  },

  slcPointKeys: ["smoke", "heat", "mps", "aim", "ann", "wfs", "ts", "fjt", "md"],

  defaultModulePerDeviceKey: {
    wfs: { module: "CT1", per: 1 },
    ts: { module: "CT1", per: 1 },
    md: { module: "CR", per: 1 },
  },

  cc1PerNAC: 1,
};

function clampNumber(v, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(v);
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}
const roundUp = (n) => Math.ceil(n);
const formatPct = (n) => `${Math.round(n * 100)}%`;

function allocateToLoops(totalPoints, loopMaxPoints, loopSparePercent) {
  const effectiveCap = Math.floor(loopMaxPoints * (1 - loopSparePercent));
  if (effectiveCap <= 0) return { loopCount: 0, pointsPerLoop: [], effectiveCap: 0 };
  const loopCount = Math.max(1, Math.ceil(totalPoints / effectiveCap));
  const base = Math.floor(totalPoints / loopCount);
  const rem = totalPoints % loopCount;
  const pointsPerLoop = Array.from({ length: loopCount }, (_, i) => base + (i < rem ? 1 : 0));
  return { loopCount, pointsPerLoop, effectiveCap };
}

function estimateNACs({ hornCount, speakerCount, hornAmpsEach, speakerAmpsEach, nacMaxAmps, nacSparePercent }) {
  const effNacCap = nacMaxAmps * (1 - nacSparePercent);
  const hornTotalA = hornCount * hornAmpsEach;
  const spkTotalA = speakerCount * speakerAmpsEach;
  const hornNacs = effNacCap > 0 ? Math.ceil(hornTotalA / effNacCap) : 0;
  const spkNacs = effNacCap > 0 ? Math.ceil(spkTotalA / effNacCap) : 0;
  return { effNacCap, hornTotalA, spkTotalA, hornNacs, spkNacs, totalNacs: hornNacs + spkNacs };
}

const emptyFloor = (name) => ({
  name,
  smoke: 0, heat: 0, mps: 0, aim: 0, ann: 0, wfs: 0, ts: 0, fjt: 0, md: 0,
  hornStrobe: 0, speakerStrobe: 0,
});

function toCSV(rows) {
  const esc = (s) => `"${String(s ?? "").replaceAll('"', '""')}"`;
  const header = ["Item", "Qty", "Qty (with spare)", "Notes"];
  const lines = [header.map(esc).join(",")];
  for (const r of rows) lines.push([r.item, r.qty, r.qtySpare, r.notes].map(esc).join(","));
  return lines.join("\n");
}

export default function App() {
  /* ======================
     LOGIN STATES
  ====================== */
  const [isAuth, setIsAuth] = useState(() => localStorage.getItem("fdas_auth") === "true");
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginError, setLoginError] = useState("");

  function handleLogin() {
    if (loginUser === AUTH_CONFIG.username && loginPass === AUTH_CONFIG.password) {
      localStorage.setItem("fdas_auth", "true");
      setIsAuth(true);
      setLoginError("");
    } else {
      setLoginError("Invalid username or password");
    }
  }

  function handleLogout() {
    localStorage.removeItem("fdas_auth");
    setIsAuth(false);
    setLoginUser("");
    setLoginPass("");
    setLoginError("");
  }

  /* ======================
     APP STATES
  ====================== */
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [floors, setFloors] = useState([emptyFloor("Ground Floor"), emptyFloor("2nd Floor"), emptyFloor("3rd Floor")]);

  const [view, setView] = useState("inputs"); // inputs | results | bom
  const [openFloor, setOpenFloor] = useState(0);
  const [search, setSearch] = useState("");

  const catalog = DEFAULT_DEVICE_CATALOG;

  const totals = useMemo(() => {
    const t = {};
    for (const item of catalog) t[item.key] = 0;
    for (const f of floors) for (const item of catalog) t[item.key] += clampNumber(f[item.key] ?? 0);
    return t;
  }, [floors, catalog]);

  const totalsWithSpare = useMemo(() => {
    const sp = {};
    for (const k of Object.keys(totals)) sp[k] = roundUp(totals[k] * (1 + rules.sparePercent));
    return sp;
  }, [totals, rules.sparePercent]);

  const slcPoints = useMemo(() => {
    let points = 0;
    for (const k of rules.slcPointKeys) points += totalsWithSpare[k] ?? 0;
    return points;
  }, [rules.slcPointKeys, totalsWithSpare]);

  const loopPlan = useMemo(() => allocateToLoops(slcPoints, rules.loopMaxPoints, rules.loopSparePercent), [
    slcPoints, rules.loopMaxPoints, rules.loopSparePercent,
  ]);

  const nacPlan = useMemo(() => estimateNACs({
    hornCount: totalsWithSpare.hornStrobe,
    speakerCount: totalsWithSpare.speakerStrobe,
    hornAmpsEach: rules.hornStrobeAmpsEach,
    speakerAmpsEach: rules.speakerStrobeAmpsEach,
    nacMaxAmps: rules.nacMaxAmps,
    nacSparePercent: rules.nacSparePercent,
  }), [totalsWithSpare, rules]);

  const moduleEstimate = useMemo(() => {
    const moduleCounts = { CT1: 0, CR: 0, CC1: 0, SIM: 0 };

    for (const [deviceKey, cfg] of Object.entries(rules.defaultModulePerDeviceKey)) {
      const qty = totalsWithSpare[deviceKey] ?? 0;
      const per = cfg.per ?? 1;
      const module = cfg.module;
      if (moduleCounts[module] !== undefined) moduleCounts[module] += roundUp(qty / per);
    }

    moduleCounts.CC1 += nacPlan.totalNacs * (rules.cc1PerNAC || 1);
    const simSuggested = totalsWithSpare.ann >= 8 ? 1 : 0;

    return { moduleCounts, simSuggested };
  }, [rules.defaultModulePerDeviceKey, totalsWithSpare, nacPlan.totalNacs, rules.cc1PerNAC]);

  const bomRows = useMemo(() => {
    const rows = [];
    const filtered = catalog.filter((d) => d.label.toLowerCase().includes(search.toLowerCase()));

    for (const item of filtered) {
      rows.push({
        item: item.label,
        qty: totals[item.key],
        qtySpare: totalsWithSpare[item.key],
        notes:
          item.key === "hornStrobe"
            ? `Assumed NAC load: ${rules.hornStrobeAmpsEach.toFixed(2)}A each`
            : item.key === "speakerStrobe"
              ? `Assumed NAC load: ${rules.speakerStrobeAmpsEach.toFixed(2)}A each`
              : "",
      });
    }

    rows.push({ item: "—", qty: "", qtySpare: "", notes: "" });
    rows.push({ item: rules.moduleMap.CT1.label, qty: moduleEstimate.moduleCounts.CT1, qtySpare: moduleEstimate.moduleCounts.CT1, notes: "Based on WFS/TS mapping" });
    rows.push({ item: rules.moduleMap.CR.label, qty: moduleEstimate.moduleCounts.CR, qtySpare: moduleEstimate.moduleCounts.CR, notes: "Based on MD mapping" });
    rows.push({ item: rules.moduleMap.CC1.label, qty: moduleEstimate.moduleCounts.CC1, qtySpare: moduleEstimate.moduleCounts.CC1, notes: `Based on estimated NACs (${nacPlan.totalNacs})` });
    rows.push({ item: rules.moduleMap.SIM.label + " (suggestion)", qty: moduleEstimate.simSuggested, qtySpare: moduleEstimate.simSuggested, notes: moduleEstimate.simSuggested ? "Suggested due to annunciator qty" : "Not suggested" });

    return rows;
  }, [catalog, totals, totalsWithSpare, rules, moduleEstimate, nacPlan.totalNacs, search]);

  function updateRule(key, value) {
    setRules((r) => ({ ...r, [key]: value }));
  }
  function updateFloor(i, key, value) {
    setFloors((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [key]: value };
      return next;
    });
  }
  function addFloor() {
    setFloors((prev) => [...prev, emptyFloor(`Floor ${prev.length + 1}`)]);
    setOpenFloor(floors.length);
  }
  function removeFloor(i) {
    setFloors((prev) => prev.filter((_, idx) => idx !== i));
    setOpenFloor(0);
  }

  function exportJSON() {
    const payload = { rules, floors, totals, totalsWithSpare, slcPoints, loopPlan, nacPlan, moduleEstimate };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fdas-config-export.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportCSV() {
    const blob = new Blob([toCSV(bomRows)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fdas-bom.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const loopFillPct =
    loopPlan.effectiveCap
      ? Math.min(100, Math.round((slcPoints / (loopPlan.loopCount * loopPlan.effectiveCap)) * 100))
      : 0;

  /* ======================
     LOGIN GUARD (EARLY RETURN)
  ====================== */
  if (!isAuth) {
    return (
      <div className="loginWrap">
        <div className="loginCard">
          <h2>🔐 FDAS Configurator</h2>
          <p className="muted">Authorized access only</p>

          <input
            className="input"
            placeholder="Username"
            value={loginUser}
            onChange={(e) => setLoginUser(e.target.value)}
          />

          <input
            className="input"
            type="password"
            placeholder="Password"
            value={loginPass}
            onChange={(e) => setLoginPass(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleLogin();
            }}
          />

          {loginError && <div className="error">{loginError}</div>}

          <button className="btn btnPrimary" onClick={handleLogin}>
            Login
          </button>

          <div className="small muted" style={{ textAlign: "center", marginTop: 6 }}>
            Tip: Press <b>Enter</b> to login
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="brand">
          <div className="logoDot" />
          <div>
            <p className="brandTitle">FDAS Configurator</p>
            <p className="brandSub">Estimator Dashboard</p>
          </div>
        </div>

        <div className="nav">
          <button className={`navBtn ${view === "inputs" ? "navBtnActive" : ""}`} onClick={() => setView("inputs")}>
            🧾 Inputs
          </button>
          <button className={`navBtn ${view === "results" ? "navBtnActive" : ""}`} onClick={() => setView("results")}>
            📊 Results
          </button>
          <button className={`navBtn ${view === "bom" ? "navBtnActive" : ""}`} onClick={() => setView("bom")}>
            📦 BOM
          </button>
        </div>

        <div className="sideBlock">
          <p className="sideBlockTitle">Quick Actions</p>
          <p className="sideBlockText">Export mo agad sa Excel/Sheets via CSV.</p>
          <div className="btnRow">
            <button className="btn btnPrimary" onClick={exportCSV}>Export CSV</button>
            <button className="btn" onClick={exportJSON}>Export JSON</button>
          </div>
        </div>

        <div className="sideBlock">
          <p className="sideBlockTitle">Reminder</p>
          <p className="sideBlockText">
            Estimator lang ito. Final design must follow panel manual, local code, voltage drop, and vendor limits.
          </p>
        </div>
      </aside>

      {/* MAIN */}
      <main className="main">
        <div className="topbar">
          <div>
            <h1 className="h1">FDAS Estimator Dashboard</h1>
            <p className="sub">Live summary habang nag-eedit ka</p>
          </div>
          <div className="actions">
            <button className="btn" onClick={() => setRules(DEFAULT_RULES)}>Reset Limits</button>
            <button className="btn btnPrimary" onClick={addFloor}>+ Add Floor</button>
            <button className="btn btnDanger" onClick={handleLogout}>Logout</button>
          </div>
        </div>

        {/* KPI */}
        <div className="card" style={{ marginTop: 14 }}>
          <div className="cardHeader">
            <div>
              <p className="cardTitle">Quick Summary</p>
              <p className="cardHint">Computed totals + utilization</p>
            </div>
            <span className="pill">Loop fill: {loopFillPct}%</span>
          </div>

          <div className="kpis">
            <div className="kpi">
              <div className="kpiLabel">SLC Points (with spare)</div>
              <div className="kpiValue">{slcPoints}</div>
            </div>
            <div className="kpi">
              <div className="kpiLabel">Estimated SLC Loops</div>
              <div className="kpiValue">{loopPlan.loopCount}</div>
            </div>
            <div className="kpi">
              <div className="kpiLabel">Total NAC Circuits</div>
              <div className="kpiValue">{nacPlan.totalNacs}</div>
            </div>
            <div className="kpi">
              <div className="kpiLabel">Modules (CT1 / CR / CC1)</div>
              <div className="kpiValue">
                {moduleEstimate.moduleCounts.CT1} / {moduleEstimate.moduleCounts.CR} / {moduleEstimate.moduleCounts.CC1}
              </div>
            </div>
          </div>

          <div className="progressRow">
            <span>Loop usable cap: {loopPlan.effectiveCap} pts/loop</span>
            <span>{rules.loopMaxPoints} max, {formatPct(rules.loopSparePercent)} headroom</span>
          </div>
          <div className="progress"><div style={{ "--w": `${loopFillPct}%` }} /></div>
        </div>

        {/* VIEWS */}
        {view === "inputs" && (
          <div className="grid grid2" style={{ marginTop: 14 }}>
            {/* LIMITS */}
            <div className="card">
              <div className="cardHeader">
                <div>
                  <p className="cardTitle">Assumptions / Limits</p>
                  <p className="cardHint">Edit based sa panel at datasheet</p>
                </div>
                <span className="pill">SIM suggestion: {moduleEstimate.simSuggested ? "Yes" : "No"}</span>
              </div>

              <div className="fieldGrid">
                <Field label="BOM Spare %" hint="0.10 = 10% spare" value={rules.sparePercent} onChange={(v)=>updateRule("sparePercent", clampNumber(v,0,1))} suffix="0–1" />
                <Field label="SLC Max Points / Loop" hint="Typical 125–250–320" value={rules.loopMaxPoints} onChange={(v)=>updateRule("loopMaxPoints", clampNumber(v,50,1000))} />
                <Field label="Loop Headroom %" hint="Capacity buffer" value={rules.loopSparePercent} onChange={(v)=>updateRule("loopSparePercent", clampNumber(v,0,0.8))} suffix="0–0.8" />
              </div>

              <div style={{ height: 12 }} />

              <div className="fieldGrid">
                <Field label="NAC Max Amps" hint="Check module rating" value={rules.nacMaxAmps} onChange={(v)=>updateRule("nacMaxAmps", clampNumber(v,0.5,10))} />
                <Field label="Horn/Strobe A each" hint="Datasheet value" value={rules.hornStrobeAmpsEach} onChange={(v)=>updateRule("hornStrobeAmpsEach", clampNumber(v,0.01,2))} />
                <Field label="Speaker/Strobe A each" hint="Datasheet value" value={rules.speakerStrobeAmpsEach} onChange={(v)=>updateRule("speakerStrobeAmpsEach", clampNumber(v,0.01,2))} />
              </div>

              <div style={{ height: 12 }} />

              <div className="fieldGrid">
                <Field label="NAC Headroom %" hint="Amperage buffer" value={rules.nacSparePercent} onChange={(v)=>updateRule("nacSparePercent", clampNumber(v,0,0.8))} suffix="0–0.8" />
                <Field label="CC1 per NAC" hint="Usually 1 per NAC" value={rules.cc1PerNAC} onChange={(v)=>updateRule("cc1PerNAC", clampNumber(v,0,10))} />
                <div className="field">
                  <div className="fieldLabel">Module Totals</div>
                  <div className="fieldHint">Based on mapping rules</div>
                  <div className="inputRow" style={{ flexWrap: "wrap" }}>
                    <span className="pill">CT1: {moduleEstimate.moduleCounts.CT1}</span>
                    <span className="pill">CR: {moduleEstimate.moduleCounts.CR}</span>
                    <span className="pill">CC1: {moduleEstimate.moduleCounts.CC1}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* FLOORS */}
            <div className="card">
              <div className="cardHeader">
                <div>
                  <p className="cardTitle">Per-Floor Inputs</p>
                  <p className="cardHint">Click floor header to expand</p>
                </div>
              </div>

              {floors.map((f, idx) => (
                <div key={idx} className="accordion">
                  <div className="accTop" onClick={() => setOpenFloor((v) => (v === idx ? -1 : idx))}>
                    <div className="accTitle">
                      <span>{f.name || `Floor ${idx + 1}`}</span>
                      <span className="pill">#{idx + 1}</span>
                    </div>
                    <span className="pill">{openFloor === idx ? "Open" : "Closed"}</span>
                  </div>

                  {openFloor === idx && (
                    <div className="accBody">
                      <div className="grid" style={{ gap: 10 }}>
                        <div className="grid grid2">
                          <div className="field">
                            <div className="fieldLabel">Floor Name</div>
                            <div className="fieldHint">Rename as needed</div>
                            <div className="inputRow">
                              <input className="input" value={f.name} onChange={(e)=>updateFloor(idx,"name",e.target.value)} />
                            </div>
                          </div>

                          <div className="field">
                            <div className="fieldLabel">Actions</div>
                            <div className="fieldHint">Clear / Remove</div>
                            <div className="inputRow">
                              <button className="btn" onClick={() => {
                                setFloors((prev) => {
                                  const next = [...prev];
                                  next[idx] = emptyFloor(f.name || `Floor ${idx + 1}`);
                                  return next;
                                });
                              }}>Clear</button>

                              {floors.length > 1 && (
                                <button className="btn btnDanger" onClick={() => removeFloor(idx)}>Remove</button>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="miniGrid">
                          {catalog.map((item) => (
                            <MiniNumber
                              key={item.key}
                              label={item.label}
                              value={f[item.key]}
                              onChange={(v) => updateFloor(idx, item.key, clampNumber(v, 0, 99999))}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {view === "results" && (
          <div className="grid grid2" style={{ marginTop: 14 }}>
            <div className="card">
              <div className="cardHeader">
                <div>
                  <p className="cardTitle">Loop Estimation (SLC)</p>
                  <p className="cardHint">Points + headroom</p>
                </div>
              </div>
              <div className="grid" style={{ gap: 10 }}>
                <Row label="Total addressable points (with spare)" value={<b>{slcPoints}</b>} />
                <Row label="Loop usable capacity" value={<b>{loopPlan.effectiveCap} pts/loop</b>} />
                <Row label="Estimated SLC loops needed" value={<b style={{ fontSize: 18 }}>{loopPlan.loopCount}</b>} />
              </div>

              <div style={{ marginTop: 12 }}>
                <div className="muted small">Suggested distribution:</div>
                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {(loopPlan.pointsPerLoop || []).map((p, i) => (
                    <span className="pill" key={i}>Loop {i + 1}: {p} pts</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="cardHeader">
                <div>
                  <p className="cardTitle">NAC / Notification</p>
                  <p className="cardHint">Amperage + headroom</p>
                </div>
              </div>
              <div className="grid" style={{ gap: 10 }}>
                <Row label="Effective NAC capacity" value={<b>{nacPlan.effNacCap.toFixed(2)}A</b>} />
                <Row label="Horn/Strobe total load" value={<b>{nacPlan.hornTotalA.toFixed(2)}A → {nacPlan.hornNacs} NAC(s)</b>} />
                <Row label="Speaker/Strobe total load" value={<b>{nacPlan.spkTotalA.toFixed(2)}A → {nacPlan.spkNacs} NAC(s)</b>} />
                <Row label="Total NAC circuits" value={<b style={{ fontSize: 18 }}>{nacPlan.totalNacs}</b>} />
              </div>

              <div style={{ marginTop: 12 }}>
                <span className="pill">CT1: {moduleEstimate.moduleCounts.CT1}</span>{" "}
                <span className="pill">CR: {moduleEstimate.moduleCounts.CR}</span>{" "}
                <span className="pill">CC1: {moduleEstimate.moduleCounts.CC1}</span>
              </div>
            </div>
          </div>
        )}

        {view === "bom" && (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="cardHeader">
              <div>
                <p className="cardTitle">BOM Summary</p>
                <p className="cardHint">Search + export</p>
              </div>
              <div className="actions">
                <input className="input" style={{ width: 280 }} value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search device..." />
                <button className="btn btnPrimary" onClick={exportCSV}>Export CSV</button>
              </div>
            </div>

            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Qty (with spare)</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {bomRows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.item === "—" ? <span className="muted">—</span> : r.item}</td>
                      <td>{r.qty}</td>
                      <td>{r.qtySpare}</td>
                      <td className="muted">{r.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="small muted" style={{ marginTop: 10 }}>
              CSV file openable sa Excel / Google Sheets for quotation.
            </div>
          </div>
        )}

        <div className="small muted" style={{ marginTop: 16 }}>
          Next upgrade: battery sizing + cable/voltage drop + labor costing + per-building.
        </div>
      </main>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
      <span className="muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Field({ label, hint, value, onChange, suffix }) {
  return (
    <div className="field">
      <div className="fieldLabel">{label}</div>
      <div className="fieldHint">{hint}</div>
      <div className="inputRow">
        <input type="number" className="input" value={value} onChange={(e) => onChange(e.target.value)} />
        {suffix ? <span className="suffix">{suffix}</span> : null}
      </div>
    </div>
  );
}

function MiniNumber({ label, value, onChange }) {
  return (
    <div className="mini">
      <div className="miniLabel">{label}</div>
      <div style={{ marginTop: 8 }}>
        <input type="number" className="input" value={value} min={0} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}
