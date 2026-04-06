import { useState, useEffect } from "react";
import {
  doc, collection, onSnapshot, setDoc, getDoc,
  getDocs, deleteDoc, serverTimestamp, query, where,
} from "firebase/firestore";
import { db } from "./firebase.js";

/* ══════════════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════════════ */
const OUTCOMES = [
  { id:"venda",       label:"Venda Realizada",      emoji:"🛍️", isSale:true,  color:"#22c55e" },
  { id:"troca",       label:"Troca Realizada",       emoji:"🔄", isSale:true,  color:"#3b82f6" },
  { id:"sem_produto", label:"Produto Indisponível",  emoji:"📦", isSale:false, color:"#f59e0b" },
  { id:"sem_tamanho", label:"Sem o Tamanho",         emoji:"📏", isSale:false, color:"#f59e0b" },
  { id:"olhando",     label:"Estava Só Olhando",     emoji:"👀", isSale:false, color:"#9ca3af" },
  { id:"preco",       label:"Preço Elevado",         emoji:"💸", isSale:false, color:"#ef4444" },
  { id:"desistiu",    label:"Cliente Desistiu",      emoji:"🚶", isSale:false, color:"#9ca3af" },
  { id:"outro",       label:"Outro Motivo",          emoji:"📝", isSale:false, color:"#9ca3af" },
];

/* ══════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════ */
const todayKey = ()  => new Date().toISOString().split("T")[0];
const fmtTime  = iso => iso ? new Date(iso).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}) : "—";
const fmtDate  = d   => d.toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"});
const fmtClock = d   => d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});

/* ══════════════════════════════════════════════════════
   SHARED STYLES
══════════════════════════════════════════════════════ */
const S = {
  /* layout */
  page:    { maxWidth:600, margin:"0 auto", paddingBottom:60 },
  center:  { display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:20 },
  /* cards */
  card:    { background:"#2c1f1a", border:"1px solid #3d2a22", borderRadius:16, padding:"20px 24px" },
  /* form */
  inp:     { display:"block", width:"100%", background:"#1a1210", border:"1px solid #3d2a22", borderRadius:10,
             padding:"13px 16px", color:"#f5f0e8", fontSize:15, fontFamily:"inherit", marginBottom:14,
             outline:"none", boxSizing:"border-box" },
  /* buttons */
  btnPrimary:{ display:"block", width:"100%", background:"#e05c2d", border:"none", borderRadius:10,
               padding:"14px 24px", color:"#fff", fontSize:15, fontWeight:600, cursor:"pointer", fontFamily:"inherit" },
  btnGhost: { background:"transparent", border:"1px solid #3d2a22", borderRadius:8,
              padding:"10px 16px", color:"#a89880", fontSize:13, cursor:"pointer", fontFamily:"inherit" },
  btnAccent:{ background:"#e05c2d", border:"none", borderRadius:8, padding:"10px 16px",
              color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"inherit" },
  btnDanger:{ background:"#ef4444", border:"none", borderRadius:8, padding:"10px 16px",
              color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"inherit" },
  /* overlay */
  overlay: { position:"fixed", inset:0, background:"rgba(0,0,0,.8)", display:"flex",
             alignItems:"center", justifyContent:"center", zIndex:999, padding:20 },
  modal:   { background:"#2c1f1a", border:"1px solid #3d2a22", borderRadius:20, padding:32,
             maxWidth:440, width:"100%", position:"relative", maxHeight:"90vh", overflowY:"auto" },
};

const globalCss = `
  input:focus { border-color:#e05c2d !important; }
  input::placeholder { color:#6b5a52; }
  button:hover:not(:disabled) { filter:brightness(1.1); }
  button:active:not(:disabled) { transform:scale(.98); }
  button:disabled { opacity:.38; cursor:not-allowed; }
`;

/* ══════════════════════════════════════════════════════
   ROOT
══════════════════════════════════════════════════════ */
export default function App() {
  const [view,  setView]  = useState("login"); // login | store | admin
  const [store, setStore] = useState(null);    // { id, name }

  return (
    <>
      <style>{globalCss}</style>
      {view === "login" && (
        <LoginPage
          onStore={(s) => { setStore(s); setView("store"); }}
          onAdmin={()  => setView("admin")}
        />
      )}
      {view === "store" && (
        <StoreApp store={store} onLogout={() => setView("login")} />
      )}
      {view === "admin" && (
        <AdminDashboard onLogout={() => setView("login")} />
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════
   LOGIN PAGE
══════════════════════════════════════════════════════ */
function LoginPage({ onStore, onAdmin }) {
  const [tab,      setTab]      = useState("store"); // store | admin
  const [stores,   setStores]   = useState([]);
  const [storeId,  setStoreId]  = useState("");
  const [pin,      setPin]      = useState("");
  const [adminPin, setAdminPin] = useState("");
  const [loading,  setLoading]  = useState(true);
  const [err,      setErr]      = useState("");
  const [firstRun, setFirstRun] = useState(false); // no admin PIN set yet
  const [newAdminPin, setNewAdminPin] = useState("");

  /* Load stores list + check admin config */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "stores"), snap => {
      setStores(snap.docs.map(d => ({ id: d.id, ...d.data() }))
                         .filter(s => s.active !== false)
                         .sort((a,b) => a.name.localeCompare(b.name)));
      setLoading(false);
    });
    getDoc(doc(db,"config","admin")).then(d => setFirstRun(!d.exists()));
    return () => unsub();
  }, []);

  const handleStoreLogin = async () => {
    setErr("");
    if (!storeId) { setErr("Selecione uma loja."); return; }
    if (!pin)     { setErr("Digite o PIN.");        return; }
    const snap = await getDoc(doc(db,"stores",storeId));
    if (!snap.exists() || snap.data().pin !== pin) { setErr("PIN incorreto."); return; }
    onStore({ id: storeId, name: snap.data().name });
  };

  const handleAdminLogin = async () => {
    setErr("");
    if (!adminPin) { setErr("Digite o PIN de administrador."); return; }
    const snap = await getDoc(doc(db,"config","admin"));
    if (!snap.exists() || snap.data().pin !== adminPin) { setErr("PIN incorreto."); return; }
    onAdmin();
  };

  const handleFirstSetup = async () => {
    if (!newAdminPin || newAdminPin.length < 4) { setErr("PIN deve ter pelo menos 4 caracteres."); return; }
    await setDoc(doc(db,"config","admin"), { pin: newAdminPin });
    setFirstRun(false);
    setErr("PIN criado! Faça login.");
  };

  return (
    <div style={S.center}>
      <div style={{ width:"100%", maxWidth:420 }}>
        {/* Logo */}
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <div style={{ fontSize:52 }}>🏪</div>
          <h1 style={{ fontSize:26, fontWeight:800, marginTop:12 }}>Sistema de Atendimento</h1>
          <p style={{ color:"#a89880", fontSize:14, marginTop:6 }}>Acesso por loja ou painel administrativo</p>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", background:"#2c1f1a", borderRadius:12, padding:4, marginBottom:20 }}>
          {[["store","🏪  Loja"],["admin","⚙️  Administrador"]].map(([t,label]) => (
            <button key={t} onClick={() => { setTab(t); setErr(""); }}
              style={{ flex:1, padding:"10px 0", border:"none", borderRadius:9, fontFamily:"inherit",
                       fontSize:13, fontWeight:600, cursor:"pointer",
                       background: tab===t ? "#e05c2d" : "transparent",
                       color: tab===t ? "#fff" : "#a89880" }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ ...S.card }}>
          {/* Store login */}
          {tab === "store" && (
            <>
              <p style={{ color:"#a89880", fontSize:13, marginBottom:16 }}>Selecione a loja e insira o PIN</p>
              {loading
                ? <p style={{ color:"#a89880", fontSize:14 }}>Carregando lojas…</p>
                : stores.length === 0
                  ? <p style={{ color:"#a89880", fontSize:14 }}>Nenhuma loja cadastrada.<br/>Peça ao administrador para criar.</p>
                  : <>
                      <select value={storeId} onChange={e => setStoreId(e.target.value)}
                        style={{ ...S.inp, cursor:"pointer" }}>
                        <option value="">Selecione a loja…</option>
                        {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      <input style={S.inp} type="password" placeholder="PIN da loja"
                             value={pin} onChange={e => setPin(e.target.value)}
                             onKeyDown={e => e.key==="Enter" && handleStoreLogin()} />
                      {err && <p style={{ color:"#f87171", fontSize:13, marginBottom:12 }}>{err}</p>}
                      <button style={S.btnPrimary} onClick={handleStoreLogin}>Entrar →</button>
                    </>}
            </>
          )}

          {/* Admin login / first setup */}
          {tab === "admin" && (
            firstRun
              ? <>
                  <p style={{ color:"#a89880", fontSize:13, marginBottom:16 }}>
                    👋 Primeira configuração — crie o PIN de administrador.
                  </p>
                  <input style={S.inp} type="password" placeholder="Criar PIN (mín. 4 caracteres)"
                         value={newAdminPin} onChange={e => setNewAdminPin(e.target.value)}
                         onKeyDown={e => e.key==="Enter" && handleFirstSetup()} />
                  {err && <p style={{ color:err.includes("criado") ? "#22c55e" : "#f87171", fontSize:13, marginBottom:12 }}>{err}</p>}
                  <button style={S.btnPrimary} onClick={handleFirstSetup}>Criar PIN e Entrar →</button>
                </>
              : <>
                  <p style={{ color:"#a89880", fontSize:13, marginBottom:16 }}>PIN de administrador</p>
                  <input style={S.inp} type="password" placeholder="PIN de administrador"
                         value={adminPin} onChange={e => setAdminPin(e.target.value)}
                         onKeyDown={e => e.key==="Enter" && handleAdminLogin()} />
                  {err && <p style={{ color:"#f87171", fontSize:13, marginBottom:12 }}>{err}</p>}
                  <button style={S.btnPrimary} onClick={handleAdminLogin}>Acessar Painel →</button>
                </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   STORE APP
══════════════════════════════════════════════════════ */
function StoreApp({ store, onLogout }) {
  const [view,       setView]       = useState("queue"); // queue | report
  const [queue,      setQueue]      = useState([]);
  const [services,   setServices]   = useState([]);
  const [curSvc,     setCurSvc]     = useState(null);
  const [showAdd,    setShowAdd]    = useState(false);
  const [addName,    setAddName]    = useState("");
  const [confirmEnd, setConfirmEnd] = useState(null);
  const [now,        setNow]        = useState(new Date());

  /* Clock */
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);

  /* Real-time Firestore listener */
  useEffect(() => {
    const ref = doc(db, "days", `${store.id}_${todayKey()}`);
    const unsub = onSnapshot(ref, snap => {
      if (snap.exists()) {
        const d = snap.data();
        setQueue(d.queue    || []);
        setServices(d.services || []);
      }
    });
    return () => unsub();
  }, [store.id]);

  /* Save to Firestore */
  const persist = async (newQueue, newServices) => {
    const ref = doc(db, "days", `${store.id}_${todayKey()}`);
    await setDoc(ref, {
      queue:     newQueue    ?? queue,
      services:  newServices ?? services,
      storeId:   store.id,
      storeName: store.name,
      date:      todayKey(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  };

  /* ── Actions */
  const addPerson = async () => {
    const name = addName.trim(); if (!name) return;
    const active = queue.filter(p => p.status !== "done");
    const nq = [...queue, { id:Date.now().toString(), name, status:"waiting",
                            entryTime:new Date().toISOString(), breaks:[], exitTime:null, order:active.length }];
    setQueue(nq); setShowAdd(false); setAddName("");
    await persist(nq, null);
  };

  const newCustomer = async () => {
    const next = activeQ().find(p => p.status === "waiting");
    if (!next || curSvc) return;
    const svc = { id:Date.now().toString(), salespersonId:next.id, salespersonName:next.name, startTime:new Date().toISOString() };
    const nq  = queue.map(p => p.id===next.id ? {...p, status:"serving"} : p);
    setQueue(nq); setCurSvc(svc);
    await persist(nq, null);
  };

  const finishService = async (outcomeId) => {
    if (!curSvc) return;
    const info     = OUTCOMES.find(o => o.id===outcomeId);
    const finished = { ...curSvc, endTime:new Date().toISOString(), outcome:outcomeId, outcomeLabel:info?.label, isSale:info?.isSale };
    const ns       = [...services, finished];
    const maxOrd   = Math.max(...queue.filter(q=>q.status!=="done").map(q=>q.order), 0);
    const nq       = queue.map(p => p.id===curSvc.salespersonId ? {...p, status:"waiting", order:maxOrd+1} : p);
    setServices(ns); setQueue(nq); setCurSvc(null);
    await persist(nq, ns);
  };

  const cancelService = async () => {
    if (!curSvc) return;
    const nq = queue.map(p => p.id===curSvc.salespersonId ? {...p, status:"waiting"} : p);
    setQueue(nq); setCurSvc(null);
    await persist(nq, null);
  };

  const skipTurn = async (id) => {
    const maxOrd = Math.max(...queue.filter(q=>q.status!=="done").map(q=>q.order), 0);
    const nq = queue.map(p => p.id===id ? {...p, order:maxOrd+1} : p);
    setQueue(nq); await persist(nq, null);
  };

  const toggleAbsent = async (id) => {
    const p = queue.find(q => q.id===id); if (!p) return;
    let nq;
    if (p.status==="absent") {
      const maxOrd    = Math.max(...queue.filter(q=>q.status!=="done").map(q=>q.order), 0);
      const updBreaks = p.breaks.map((b,i) => i===p.breaks.length-1 ? {...b, end:new Date().toISOString()} : b);
      nq = queue.map(q => q.id===id ? {...q, status:"waiting", order:maxOrd+1, breaks:updBreaks} : q);
    } else {
      nq = queue.map(q => q.id===id ? {...q, status:"absent", breaks:[...q.breaks, {start:new Date().toISOString(), end:null}]} : q);
    }
    setQueue(nq); await persist(nq, null);
  };

  const endShift = async (id) => {
    const nq = queue.map(p => p.id===id ? {...p, status:"done", exitTime:new Date().toISOString()} : p);
    setQueue(nq); setConfirmEnd(null);
    await persist(nq, null);
  };

  /* ── Derived */
  const activeQ = () =>
    [...queue].filter(p=>p.status!=="done").sort((a,b)=>{
      if(a.status==="serving") return -1; if(b.status==="serving") return 1;
      if(a.status==="absent"&&b.status!=="absent") return 1;
      if(b.status==="absent"&&a.status!=="absent") return -1;
      return a.order-b.order;
    });
  const doneQ     = () => queue.filter(p=>p.status==="done");
  const nextP     = () => activeQ().find(p=>p.status==="waiting");
  const totalSvc  = services.length;
  const totalSale = services.filter(s=>s.isSale).length;
  const convRate  = totalSvc>0 ? Math.round((totalSale/totalSvc)*100) : 0;

  const aq = activeQ(), dq = doneQ(), np = nextP();
  const dayStr = fmtDate(now).charAt(0).toUpperCase() + fmtDate(now).slice(1);

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                    padding:"22px 20px 14px", borderBottom:"1px solid #2c1f1a", flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:700 }}>{store.name}</div>
          <div style={{ fontSize:13, color:"#a89880", marginTop:2, display:"flex", gap:8, alignItems:"center" }}>
            <span style={{ textTransform:"capitalize" }}>{dayStr}</span>
            <span style={{ background:"#2c1f1a", padding:"2px 10px", borderRadius:20, fontWeight:500 }}>{fmtClock(now)}</span>
          </div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          {view==="queue"
            ? <button style={S.btnGhost} onClick={() => setView("report")}>📊 Relatório</button>
            : <button style={S.btnGhost} onClick={() => setView("queue")}>← Fila</button>}
          {view==="report" && <button style={S.btnAccent} onClick={() => exportPDF(store.name, queue, services)}>📄 PDF</button>}
          {view==="queue"  && <button style={S.btnAccent} onClick={() => setShowAdd(true)}>+ Entrada</button>}
          <button style={S.btnGhost} onClick={onLogout} title="Sair">⎋</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:"flex", justifyContent:"space-around", padding:"14px 20px",
                    background:"#2c1f1a", margin:"14px 20px", borderRadius:12 }}>
        {[
          { num:totalSvc,   label:"Atendimentos" },
          { num:totalSale,  label:"Vendas",  green:true },
          { num:`${convRate}%`, label:"Conversão" },
          { num:aq.filter(p=>p.status==="waiting").length, label:"Na Fila" },
        ].map((s,i) => (
          <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
            <div style={{ fontSize:26, fontWeight:700, lineHeight:1, color:s.green?"#22c55e":"#f5f0e8" }}>{s.num}</div>
            <div style={{ fontSize:10, color:"#a89880", textTransform:"uppercase", letterSpacing:".5px" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Queue view */}
      {view === "queue" && <>
        <div style={{ padding:"4px 20px 16px" }}>
          <button
            onClick={newCustomer}
            disabled={!np || !!curSvc}
            style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:12,
                     width:"100%", background:"#e05c2d", border:"none", borderRadius:14,
                     padding:"20px 24px", color:"#fff", fontSize:19, fontWeight:700,
                     cursor: np&&!curSvc ? "pointer":"not-allowed",
                     opacity: np&&!curSvc ? 1 : .35, fontFamily:"inherit" }}>
            🛎️ Novo Cliente
            {curSvc && <span style={{ fontSize:13, fontWeight:400, opacity:.85, background:"rgba(255,255,255,.13)", padding:"4px 12px", borderRadius:20 }}>Em atendimento…</span>}
            {np&&!curSvc && <span style={{ fontSize:13, fontWeight:400, opacity:.85, background:"rgba(255,255,255,.13)", padding:"4px 12px", borderRadius:20 }}>→ {np.name}</span>}
          </button>
        </div>

        <div style={{ padding:"0 20px" }}>
          <div style={{ fontSize:11, textTransform:"uppercase", letterSpacing:1, color:"#a89880", marginBottom:10 }}>Fila de Atendimento</div>
          {aq.length===0 && (
            <div style={{ textAlign:"center", padding:"36px 20px", color:"#a89880", fontSize:14 }}>
              <div style={{ fontSize:32, marginBottom:8 }}>👥</div>
              <div>Nenhuma funcionária na fila</div>
              <div style={{ fontSize:13, opacity:.5, marginTop:6 }}>Use "+ Entrada" para registrar o início do expediente</div>
            </div>
          )}
          {aq.map((p,i) => (
            <PersonCard key={p.id} person={p} position={i+1} isNext={p.id===np?.id}
              onSkip={() => skipTurn(p.id)}
              onAbsent={() => toggleAbsent(p.id)}
              onEnd={() => setConfirmEnd(p.id)} />
          ))}
          {dq.length > 0 && <>
            <div style={{ fontSize:11, textTransform:"uppercase", letterSpacing:1, color:"#a89880", marginTop:24, marginBottom:10, opacity:.4 }}>Expediente Encerrado</div>
            {dq.map(p => <PersonCard key={p.id} person={p} done />)}
          </>}
        </div>
      </>}

      {/* Report view */}
      {view === "report" && (
        <ReportView services={services} queue={queue}
          totalSvc={totalSvc} totalSale={totalSale} convRate={convRate} />
      )}

      {/* Modal: add person */}
      {showAdd && (
        <Overlay onClose={() => setShowAdd(false)}>
          <div style={{ fontSize:36, marginBottom:12 }}>👋</div>
          <h2 style={{ fontSize:20, fontWeight:700, marginBottom:8 }}>Registrar Entrada</h2>
          <p style={{ color:"#a89880", fontSize:13, marginBottom:20 }}>Adicionar à fila de atendimento</p>
          <input style={S.inp} autoFocus value={addName} placeholder="Nome da funcionária…"
                 onChange={e=>setAddName(e.target.value)}
                 onKeyDown={e=>e.key==="Enter"&&addPerson()} />
          <div style={{ display:"flex", gap:8, marginTop:4, justifyContent:"flex-end" }}>
            <button style={S.btnGhost} onClick={()=>setShowAdd(false)}>Cancelar</button>
            <button style={{ ...S.btnPrimary, width:"auto", padding:"10px 20px" }} onClick={addPerson}>Entrar na Fila →</button>
          </div>
        </Overlay>
      )}

      {/* Modal: outcome */}
      {curSvc && (
        <Overlay closeable={false}>
          <div style={{ fontSize:36, marginBottom:12 }}>🤝</div>
          <h2 style={{ fontSize:20, fontWeight:700, marginBottom:8 }}>Resultado do Atendimento</h2>
          <p style={{ color:"#a89880", fontSize:13, marginBottom:20 }}>
            <strong>{curSvc.salespersonName}</strong> · {fmtTime(curSvc.startTime)}
          </p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {OUTCOMES.map(o => (
              <button key={o.id} onClick={() => finishService(o.id)}
                style={{ background:"#1a1210", border:`1px solid ${o.color}55`, borderRadius:12,
                         padding:"14px 10px", cursor:"pointer", display:"flex", flexDirection:"column",
                         alignItems:"center", gap:6, fontFamily:"inherit" }}>
                <span style={{ fontSize:22 }}>{o.emoji}</span>
                <span style={{ fontSize:12, color:"#f5f0e8", lineHeight:1.3, textAlign:"center" }}>{o.label}</span>
              </button>
            ))}
          </div>
          <button style={{ ...S.btnGhost, width:"100%", marginTop:12, fontSize:13 }} onClick={cancelService}>
            ← Cancelar (desfazer)
          </button>
        </Overlay>
      )}

      {/* Modal: confirm end shift */}
      {confirmEnd && (
        <Overlay onClose={() => setConfirmEnd(null)}>
          <div style={{ fontSize:36, marginBottom:12 }}>🚪</div>
          <h2 style={{ fontSize:20, fontWeight:700, marginBottom:8 }}>Encerrar Expediente?</h2>
          <p style={{ color:"#a89880", fontSize:13, marginBottom:20 }}>
            {queue.find(p=>p.id===confirmEnd)?.name} será removida da fila.
          </p>
          <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
            <button style={S.btnGhost} onClick={()=>setConfirmEnd(null)}>Voltar</button>
            <button style={{ ...S.btnDanger, padding:"10px 20px" }} onClick={()=>endShift(confirmEnd)}>Confirmar Saída</button>
          </div>
        </Overlay>
      )}
    </div>
  );
}

/* ── Person Card ─────────────────────────── */
function PersonCard({ person, position, isNext, onSkip, onAbsent, onEnd, done }) {
  const acc = { waiting:isNext?"#e05c2d":"#4b5563", serving:"#22c55e", absent:"#f59e0b", done:"#374151" }[person.status]||"#4b5563";
  const badge = {
    waiting: isNext ? "🎯 Próxima" : `#${position}`,
    serving: "⚡ Atendendo", absent: "⏸ Ausente",
    done: `✓ Saiu ${fmtTime(person.exitTime)}`,
  }[person.status] || `#${position}`;

  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                  background:"#2c1f1a", borderRadius:12, padding:"13px 14px", marginBottom:8,
                  borderLeft:`3px solid ${acc}`, gap:10, opacity:done?.4:1 }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, flex:1, minWidth:0 }}>
        <div style={{ fontSize:11, fontWeight:700, padding:"4px 10px", borderRadius:20,
                      background:`${acc}22`, color:acc, whiteSpace:"nowrap", flexShrink:0 }}>{badge}</div>
        <div>
          <div style={{ fontSize:15, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{person.name}</div>
          <div style={{ fontSize:11, color:"#a89880", marginTop:2 }}>
            Entrada {fmtTime(person.entryTime)}
            {person.breaks.length>0 && ` · ${person.breaks.length} pausa${person.breaks.length>1?"s":""}`}
          </div>
        </div>
      </div>
      {!done && (
        <div style={{ display:"flex", gap:6, flexShrink:0 }}>
          <button style={{ background:"transparent", border:"1px solid #3d2a22", borderRadius:8,
                           padding:"5px 9px", fontSize:11, cursor:"pointer", fontFamily:"inherit",
                           color: person.status==="absent"?"#22c55e":"#f59e0b" }} onClick={onAbsent}>
            {person.status==="absent"?"▶ Retornar":"⏸ Pausar"}
          </button>
          {person.status==="waiting" &&
            <button style={{ background:"transparent", border:"1px solid #3d2a22", borderRadius:8,
                             padding:"5px 9px", color:"#a89880", fontSize:11, cursor:"pointer", fontFamily:"inherit" }} onClick={onSkip}>
              ⏭ Pular
            </button>}
          <button style={{ background:"transparent", border:"1px solid #3d2a22", borderRadius:8,
                           padding:"5px 9px", color:"#ef4444", fontSize:11, cursor:"pointer", fontFamily:"inherit" }} onClick={onEnd}>✕</button>
        </div>
      )}
    </div>
  );
}

/* ── Report View ─────────────────────────── */
function ReportView({ services, queue, totalSvc, totalSale, convRate }) {
  const nonSales = services.filter(s=>!s.isSale);
  const rC = {}; nonSales.forEach(s=>{rC[s.outcomeLabel]=(rC[s.outcomeLabel]||0)+1;});
  const sortedR = Object.entries(rC).sort((a,b)=>b[1]-a[1]);
  const maxR = sortedR[0]?.[1]||1;

  return (
    <div style={{ padding:"8px 20px 60px" }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, margin:"16px 0" }}>
        {[{num:totalSvc,label:"Atendimentos",color:"#f5f0e8"},{num:totalSale,label:"Vendas",color:"#22c55e"},{num:`${convRate}%`,label:"Conversão",color:"#f5f0e8"}]
          .map((s,i)=>(
          <div key={i} style={{ background:"#2c1f1a", border:"1px solid #3d2a22", borderRadius:12, padding:"20px 16px", textAlign:"center" }}>
            <div style={{ fontSize:36, fontWeight:700, color:s.color }}>{s.num}</div>
            <div style={{ fontSize:11, color:"#a89880", textTransform:"uppercase", letterSpacing:".5px", marginTop:4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Reasons */}
      <div style={{ background:"#2c1f1a", border:"1px solid #3d2a22", borderRadius:12, padding:20, marginTop:14 }}>
        <div style={{ fontSize:11, color:"#a89880", textTransform:"uppercase", letterSpacing:1, marginBottom:16 }}>Motivos de Não Venda</div>
        {sortedR.length===0 && <p style={{ color:"#a89880", fontSize:13, textAlign:"center" }}>Nenhum registro</p>}
        {sortedR.map(([label,cnt])=>(
          <div key={label} style={{ marginBottom:14 }}>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:6 }}>
              <span style={{ color:"#d4c4b8" }}>{label}</span>
              <span style={{ fontWeight:600 }}>{cnt}</span>
            </div>
            <div style={{ height:6, background:"#1a1210", borderRadius:3, overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${(cnt/maxR)*100}%`, background:"#e05c2d", borderRadius:3 }} />
            </div>
          </div>
        ))}
      </div>

      {/* Staff */}
      <div style={{ background:"#2c1f1a", border:"1px solid #3d2a22", borderRadius:12, padding:20, marginTop:14 }}>
        <div style={{ fontSize:11, color:"#a89880", textTransform:"uppercase", letterSpacing:1, marginBottom:16 }}>Funcionárias</div>
        {queue.map(p=>{
          const ps=services.filter(s=>s.salespersonId===p.id), pv=ps.filter(s=>s.isSale).length;
          return (
            <div key={p.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start",
                                     borderBottom:"1px solid #2c201a", paddingBottom:12, marginBottom:12 }}>
              <div>
                <div style={{ fontWeight:600, fontSize:15 }}>{p.name}</div>
                <div style={{ fontSize:12, color:"#a89880", marginTop:2 }}>
                  Entrada {fmtTime(p.entryTime)}
                  {p.breaks.map((b,i)=>` · Pausa ${i+1}: ${fmtTime(b.start)}–${fmtTime(b.end)}`)}
                  {p.exitTime && ` · Saída ${fmtTime(p.exitTime)}`}
                </div>
              </div>
              <div style={{ textAlign:"right", fontSize:13 }}>
                <div>{ps.length} atend.</div>
                <div style={{ color:"#22c55e" }}>{pv} vendas</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* History */}
      <div style={{ background:"#2c1f1a", border:"1px solid #3d2a22", borderRadius:12, padding:20, marginTop:14 }}>
        <div style={{ fontSize:11, color:"#a89880", textTransform:"uppercase", letterSpacing:1, marginBottom:16 }}>Histórico ({services.length})</div>
        {services.length===0 && <p style={{ color:"#a89880", fontSize:13, textAlign:"center" }}>Nenhum atendimento</p>}
        {[...services].reverse().map(s=>(
          <div key={s.id} style={{ display:"flex", gap:12, padding:"8px 0", borderBottom:"1px solid #2c201a", alignItems:"center" }}>
            <span style={{ fontSize:12, color:"#a89880", flexShrink:0 }}>{fmtTime(s.startTime)}</span>
            <span style={{ fontSize:13, flex:1 }}>{s.salespersonName}</span>
            <span style={{ fontSize:12, color:s.isSale?"#22c55e":"#f87171" }}>{s.outcomeLabel}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   ADMIN DASHBOARD
══════════════════════════════════════════════════════ */
function AdminDashboard({ onLogout }) {
  const [adminView,  setAdminView]  = useState("overview"); // overview | manage | storeDetail
  const [stores,     setStores]     = useState([]);
  const [todayData,  setTodayData]  = useState([]);         // array of day docs
  const [detailStore,setDetailStore]= useState(null);
  const [showAddStore,setShowAddStore]= useState(false);
  const [newStoreName,setNewStoreName]= useState("");
  const [newStorePin, setNewStorePin] = useState("");
  const [editStore,  setEditStore]  = useState(null);       // { id, name, pin }
  const [saving,     setSaving]     = useState(false);

  /* Real-time: stores list */
  useEffect(() => {
    const unsub = onSnapshot(collection(db,"stores"), snap => {
      setStores(snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.name.localeCompare(b.name)));
    });
    return () => unsub();
  }, []);

  /* Real-time: today's data for all stores */
  useEffect(() => {
    const q = query(collection(db,"days"), where("date","==",todayKey()));
    const unsub = onSnapshot(q, snap => {
      setTodayData(snap.docs.map(d=>({id:d.id,...d.data()})));
    });
    return () => unsub();
  }, []);

  /* ── Store management */
  const addStore = async () => {
    if (!newStoreName.trim() || !newStorePin.trim()) return;
    setSaving(true);
    const id = Date.now().toString();
    await setDoc(doc(db,"stores",id), { name:newStoreName.trim(), pin:newStorePin.trim(), active:true, createdAt:serverTimestamp() });
    setNewStoreName(""); setNewStorePin(""); setShowAddStore(false); setSaving(false);
  };

  const saveEditStore = async () => {
    if (!editStore) return;
    setSaving(true);
    await setDoc(doc(db,"stores",editStore.id), { name:editStore.name, pin:editStore.pin, active:true }, { merge:true });
    setEditStore(null); setSaving(false);
  };

  const toggleStoreActive = async (s) => {
    await setDoc(doc(db,"stores",s.id), { active:!s.active }, { merge:true });
  };

  /* ── Metrics helpers */
  const getDayData = (storeId) => todayData.find(d => d.storeId===storeId) || { queue:[], services:[] };
  const storeMetrics = (storeId) => {
    const d   = getDayData(storeId);
    const svc = d.services||[], q = d.queue||[];
    const sales = svc.filter(s=>s.isSale).length;
    const conv  = svc.length>0 ? Math.round((sales/svc.length)*100) : 0;
    const active= q.filter(p=>p.status!=="done").length;
    return { svc:svc.length, sales, conv, active, queue:q, services:svc };
  };

  /* Combined totals */
  const allSvc   = todayData.reduce((a,d)=>a+(d.services||[]).length, 0);
  const allSales = todayData.reduce((a,d)=>a+(d.services||[]).filter(s=>s.isSale).length, 0);
  const allConv  = allSvc>0 ? Math.round((allSales/allSvc)*100) : 0;
  const allActive= todayData.reduce((a,d)=>a+(d.queue||[]).filter(p=>p.status!=="done").length, 0);

  /* ── Detail store view */
  if (adminView==="storeDetail" && detailStore) {
    const { queue:q, services:svc } = getDayData(detailStore.id);
    const ts=svc.length, tsa=svc.filter(s=>s.isSale).length, cr=ts>0?Math.round((tsa/ts)*100):0;
    return (
      <div style={S.page}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                      padding:"22px 20px 14px", borderBottom:"1px solid #2c1f1a", flexWrap:"wrap", gap:12 }}>
          <div>
            <div style={{ fontSize:20, fontWeight:700 }}>{detailStore.name}</div>
            <div style={{ fontSize:13, color:"#a89880", marginTop:2 }}>Relatório de hoje</div>
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button style={S.btnGhost} onClick={()=>setAdminView("overview")}>← Painel</button>
            <button style={S.btnAccent} onClick={()=>exportPDF(detailStore.name, q, svc)}>📄 PDF</button>
          </div>
        </div>
        <ReportView services={svc} queue={q} totalSvc={ts} totalSale={tsa} convRate={cr} />
      </div>
    );
  }

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                    padding:"22px 20px 14px", borderBottom:"1px solid #2c1f1a", flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:700 }}>Painel Administrativo</div>
          <div style={{ fontSize:13, color:"#a89880", marginTop:2, textTransform:"capitalize" }}>{fmtDate(new Date())}</div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button style={{ ...S.btnGhost, ...(adminView==="overview"?{borderColor:"#e05c2d",color:"#e05c2d"}:{}) }}
                  onClick={()=>setAdminView("overview")}>📊 Visão Geral</button>
          <button style={{ ...S.btnGhost, ...(adminView==="manage"?{borderColor:"#e05c2d",color:"#e05c2d"}:{}) }}
                  onClick={()=>setAdminView("manage")}>🏪 Lojas</button>
          <button style={S.btnGhost} onClick={onLogout}>⎋ Sair</button>
        </div>
      </div>

      {/* ── OVERVIEW ── */}
      {adminView==="overview" && <>
        {/* Combined stats */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, margin:"20px 20px 0" }}>
          {[
            { num:stores.filter(s=>s.active!==false).length, label:"Lojas Ativas",    color:"#f5f0e8" },
            { num:allSvc,                                    label:"Atendimentos",     color:"#f5f0e8" },
            { num:allSales,                                  label:"Vendas Totais",   color:"#22c55e" },
            { num:`${allConv}%`,                             label:"Conversão Geral", color:"#f5f0e8" },
          ].map((s,i)=>(
            <div key={i} style={{ background:"#2c1f1a", border:"1px solid #3d2a22", borderRadius:12, padding:"16px 12px", textAlign:"center" }}>
              <div style={{ fontSize:28, fontWeight:700, color:s.color }}>{s.num}</div>
              <div style={{ fontSize:10, color:"#a89880", textTransform:"uppercase", letterSpacing:".5px", marginTop:4 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Store cards */}
        <div style={{ padding:"20px 20px" }}>
          <div style={{ fontSize:11, textTransform:"uppercase", letterSpacing:1, color:"#a89880", marginBottom:12 }}>
            Desempenho por Loja — Hoje
          </div>
          {stores.length===0 && (
            <div style={{ textAlign:"center", padding:"36px 20px", color:"#a89880", fontSize:14 }}>
              <div style={{ fontSize:32, marginBottom:8 }}>🏪</div>
              Nenhuma loja cadastrada ainda.<br/>
              <button style={{ ...S.btnAccent, display:"inline-block", marginTop:16, padding:"10px 24px" }}
                      onClick={()=>setAdminView("manage")}>
                Criar primeira loja →
              </button>
            </div>
          )}
          {stores.map(s => {
            const m = storeMetrics(s.id);
            const convColor = m.conv>=60?"#22c55e":m.conv>=40?"#f59e0b":"#f87171";
            const hasData = m.svc>0||m.active>0;
            return (
              <div key={s.id} onClick={()=>{ setDetailStore(s); setAdminView("storeDetail"); }}
                style={{ background:"#2c1f1a", border:"1px solid #3d2a22", borderRadius:14,
                         padding:"16px 20px", marginBottom:10, cursor:"pointer",
                         opacity: s.active===false?.5:1, transition:"border-color .2s" }}
                onMouseEnter={e=>e.currentTarget.style.borderColor="#e05c2d"}
                onMouseLeave={e=>e.currentTarget.style.borderColor="#3d2a22"}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:16 }}>{s.name}</div>
                    {s.active===false && <span style={{ fontSize:11, color:"#a89880" }}>Inativa</span>}
                    {hasData && m.active>0 &&
                      <div style={{ fontSize:12, color:"#a89880", marginTop:2 }}>🟢 {m.active} funcionária{m.active>1?"s":""} em turno</div>}
                    {!hasData && <div style={{ fontSize:12, color:"#a89880", marginTop:2 }}>Sem atividade hoje</div>}
                  </div>
                  <div style={{ textAlign:"right" }}>
                    {hasData && m.svc>0 && <>
                      <div style={{ display:"flex", gap:16, alignItems:"center" }}>
                        <div style={{ textAlign:"center" }}>
                          <div style={{ fontSize:22, fontWeight:700 }}>{m.svc}</div>
                          <div style={{ fontSize:10, color:"#a89880", textTransform:"uppercase" }}>Atend.</div>
                        </div>
                        <div style={{ textAlign:"center" }}>
                          <div style={{ fontSize:22, fontWeight:700, color:"#22c55e" }}>{m.sales}</div>
                          <div style={{ fontSize:10, color:"#a89880", textTransform:"uppercase" }}>Vendas</div>
                        </div>
                        <div style={{ textAlign:"center" }}>
                          <div style={{ fontSize:22, fontWeight:700, color:convColor }}>{m.conv}%</div>
                          <div style={{ fontSize:10, color:"#a89880", textTransform:"uppercase" }}>Conv.</div>
                        </div>
                      </div>
                    </>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </>}

      {/* ── MANAGE STORES ── */}
      {adminView==="manage" && (
        <div style={{ padding:"20px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
            <div style={{ fontSize:14, fontWeight:600 }}>Lojas Cadastradas ({stores.length})</div>
            <button style={S.btnAccent} onClick={()=>setShowAddStore(true)}>+ Nova Loja</button>
          </div>

          {stores.length===0 && (
            <div style={{ textAlign:"center", padding:"36px 20px", color:"#a89880" }}>Nenhuma loja ainda</div>
          )}

          {stores.map(s => (
            <div key={s.id} style={{ background:"#2c1f1a", border:"1px solid #3d2a22", borderRadius:12,
                                     padding:"14px 16px", marginBottom:8, opacity:s.active===false?.55:1 }}>
              {editStore?.id===s.id
                ? /* edit row */
                  <div>
                    <div style={{ display:"flex", gap:8, marginBottom:8 }}>
                      <input style={{ ...S.inp, marginBottom:0, flex:1 }} value={editStore.name}
                             onChange={e=>setEditStore({...editStore,name:e.target.value})} placeholder="Nome da loja" />
                      <input style={{ ...S.inp, marginBottom:0, width:120 }} value={editStore.pin}
                             onChange={e=>setEditStore({...editStore,pin:e.target.value})} placeholder="PIN" />
                    </div>
                    <div style={{ display:"flex", gap:8 }}>
                      <button style={S.btnGhost} onClick={()=>setEditStore(null)}>Cancelar</button>
                      <button style={{ ...S.btnAccent }} disabled={saving} onClick={saveEditStore}>
                        {saving?"Salvando…":"Salvar"}
                      </button>
                    </div>
                  </div>
                : /* display row */
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div>
                      <div style={{ fontWeight:600, fontSize:15 }}>{s.name}</div>
                      <div style={{ fontSize:12, color:"#a89880", marginTop:2 }}>
                        PIN: <code style={{ background:"#1a1210", padding:"1px 8px", borderRadius:6, letterSpacing:2 }}>{s.pin}</code>
                        {s.active===false && <span style={{ marginLeft:8, color:"#f87171" }}>· Inativa</span>}
                      </div>
                    </div>
                    <div style={{ display:"flex", gap:6 }}>
                      <button style={{ ...S.btnGhost, fontSize:12, padding:"6px 12px" }}
                              onClick={()=>setEditStore({id:s.id,name:s.name,pin:s.pin})}>✏️ Editar</button>
                      <button style={{ ...S.btnGhost, fontSize:12, padding:"6px 12px",
                                       color:s.active===false?"#22c55e":"#f59e0b" }}
                              onClick={()=>toggleStoreActive(s)}>
                        {s.active===false?"✓ Ativar":"⊘ Desativar"}
                      </button>
                    </div>
                  </div>
              }
            </div>
          ))}
        </div>
      )}

      {/* Modal: add store */}
      {showAddStore && (
        <Overlay onClose={()=>setShowAddStore(false)}>
          <div style={{ fontSize:36, marginBottom:12 }}>🏪</div>
          <h2 style={{ fontSize:20, fontWeight:700, marginBottom:8 }}>Nova Loja</h2>
          <p style={{ color:"#a89880", fontSize:13, marginBottom:20 }}>Defina o nome e o PIN de acesso da loja</p>
          <input style={S.inp} autoFocus value={newStoreName} placeholder="Nome da loja…"
                 onChange={e=>setNewStoreName(e.target.value)} />
          <input style={S.inp} value={newStorePin} placeholder="PIN de acesso (ex: 1234)"
                 onChange={e=>setNewStorePin(e.target.value)}
                 onKeyDown={e=>e.key==="Enter"&&addStore()} />
          <div style={{ display:"flex", gap:8, marginTop:4, justifyContent:"flex-end" }}>
            <button style={S.btnGhost} onClick={()=>setShowAddStore(false)}>Cancelar</button>
            <button style={{ ...S.btnPrimary, width:"auto", padding:"10px 20px" }}
                    disabled={saving} onClick={addStore}>
              {saving?"Salvando…":"Criar Loja →"}
            </button>
          </div>
        </Overlay>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   SHARED: OVERLAY / MODAL
══════════════════════════════════════════════════════ */
function Overlay({ children, onClose, closeable=true }) {
  return (
    <div style={S.overlay} onClick={closeable?onClose:undefined}>
      <div style={S.modal} onClick={e=>e.stopPropagation()}>
        {closeable && (
          <button onClick={onClose}
            style={{ position:"absolute", top:14, right:14, background:"transparent",
                     border:"none", color:"#a89880", fontSize:18, cursor:"pointer", padding:"4px 8px" }}>✕</button>
        )}
        {children}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   PDF EXPORT  (same rich version — works in any view)
══════════════════════════════════════════════════════ */
function exportPDF(storeName, queue, services) {
  const nonSales=services.filter(s=>!s.isSale);
  const tSvc=services.length, tSales=services.filter(s=>s.isSale).length;
  const cr=tSvc>0?Math.round((tSales/tSvc)*100):0;
  const durations=services.filter(s=>s.startTime&&s.endTime).map(s=>new Date(s.endTime)-new Date(s.startTime));
  const avgDur=durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length/60000):0;
  const hC={}; for(let h=8;h<=21;h++) hC[h]=0;
  services.forEach(s=>{ const h=new Date(s.startTime).getHours(); if(h>=8&&h<=21) hC[h]=(hC[h]||0)+1; });
  const hDisp=Object.entries(hC).sort((a,b)=>parseInt(a[0])-parseInt(b[0]));
  const maxH=Math.max(...hDisp.map(([,c])=>c),1);
  const peak=hDisp.slice().sort((a,b)=>b[1]-a[1])[0];
  const rC={}; nonSales.forEach(s=>{rC[s.outcomeLabel]=(rC[s.outcomeLabel]||0)+1;});
  const sortedR=Object.entries(rC).sort((a,b)=>b[1]-a[1]); const maxR=sortedR[0]?.[1]||1;
  const staff=queue.map(p=>{
    const ps=services.filter(s=>s.salespersonId===p.id);
    const pS=ps.filter(s=>s.isSale).length, pC=ps.length?Math.round((pS/ps.length)*100):0;
    const end=p.exitTime?new Date(p.exitTime):new Date();
    const totalMs=end-new Date(p.entryTime);
    const brkMs=p.breaks.reduce((acc,b)=>{const bE=b.end?new Date(b.end):new Date(); return acc+(bE-new Date(b.start));},0);
    const wm=Math.round((totalMs-brkMs)/60000);
    const wStr=Math.floor(wm/60)>0?`${Math.floor(wm/60)}h ${wm%60}m`:`${wm}m`;
    const bm=Math.round(brkMs/60000);
    const bStr=bm>0?(Math.floor(bm/60)>0?`${Math.floor(bm/60)}h ${bm%60}m`:`${bm}m`):"—";
    return {...p,ps,pS,pC,wStr,bStr};
  }).sort((a,b)=>b.pS-a.pS);
  const best=staff.find(p=>p.pS>0); const maxSS=Math.max(...staff.map(p=>p.pS),0);
  const gT=new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
  const gD=new Date().toLocaleDateString("pt-BR",{day:"numeric",month:"long",year:"numeric"});
  const wD=new Date().toLocaleDateString("pt-BR",{weekday:"long"});
  const dS=new Date().toLocaleDateString("pt-BR",{weekday:"long",year:"numeric",month:"long",day:"numeric"});

  const html=`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Relatório — ${storeName}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',-apple-system,sans-serif;color:#111827;background:#fff;font-size:13px;line-height:1.5}
.page{max-width:860px;margin:0 auto;padding:48px 48px 60px}
.rh{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:20px;border-bottom:3px solid #111827;margin-bottom:32px}
.rh h1{font-size:26px;font-weight:800;letter-spacing:-.5px}.rh .store{font-size:15px;color:#6b7280;margin-top:4px;font-weight:500}
.rh .meta{text-align:right;color:#9ca3af;font-size:12px;line-height:1.8}.rh .meta strong{color:#111827;font-size:14px;display:block;font-weight:700}
.sec{margin-bottom:32px}.sec-t{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#9ca3af;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid #f3f4f6}
.kpi-row{display:grid;gap:12px}.k4{grid-template-columns:repeat(4,1fr)}.k2{grid-template-columns:repeat(2,1fr);margin-top:12px}
.kpi{border:1px solid #e5e7eb;border-radius:10px;padding:16px;background:#f9fafb}.kpi.dk{background:#111827;border-color:#111827}.kpi.gr{background:#f0fdf4;border-color:#bbf7d0}.kpi.am{background:#fffbeb;border-color:#fde68a}
.kpi-n{font-size:30px;font-weight:800;color:#111827;letter-spacing:-1px;line-height:1}.kpi.dk .kpi-n{color:#fff}.kpi.gr .kpi-n{color:#15803d}
.kpi-l{font-size:10px;color:#9ca3af;margin-top:5px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}.kpi.dk .kpi-l,.kpi.gr .kpi-l{color:#a89880}.kpi-sub{font-size:11px;color:#d1d5db;margin-top:3px}.kpi.gr .kpi-sub{color:#86efac}
.badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;text-transform:uppercase}.badge-gold{background:#fef9c3;color:#92400e}
table{width:100%;border-collapse:collapse}thead th{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#9ca3af;padding:8px 10px;text-align:left;border-bottom:1px solid #e5e7eb}
tbody td{padding:9px 10px;border-bottom:1px solid #f3f4f6;vertical-align:middle}tbody tr:last-child td{border-bottom:none}
.tn{font-weight:600;color:#111827}.tg{color:#15803d;font-weight:600}.td{color:#9ca3af;font-size:12px}.tc{text-align:center}
.mb{display:flex;align-items:center;gap:8px}.mb-track{flex:1;height:6px;background:#f3f4f6;border-radius:3px;overflow:hidden;min-width:60px}.mb-fill{height:100%;border-radius:3px}.mb-label{font-size:11px;font-weight:700;width:32px;text-align:right}
.rbar{display:flex;align-items:center;gap:10px;margin-bottom:8px}.rbar-name{flex:0 0 170px;font-size:12px;color:#374151}.rbar-track{flex:1;height:10px;background:#f3f4f6;border-radius:5px;overflow:hidden}.rbar-fill{height:100%;background:#e05c2d;border-radius:5px}.rbar-n{flex:0 0 24px;font-weight:700;font-size:12px;text-align:right}.rbar-p{flex:0 0 36px;font-size:11px;color:#9ca3af;text-align:right}
.hchart{display:flex;align-items:flex-end;gap:5px;height:90px;margin-bottom:6px}.hcol{display:flex;flex-direction:column;align-items:center;gap:3px;flex:1}.hbwrap{flex:1;display:flex;align-items:flex-end;width:100%}.hbar{width:100%;border-radius:3px 3px 0 0;min-height:2px}.hlabel{font-size:9px;color:#9ca3af;white-space:nowrap}.hcount{font-size:9px;font-weight:700;color:#6b7280}
.hist{display:flex;gap:12px;align-items:center;padding:6px 0;border-bottom:1px solid #f9fafb;font-size:12px}.hist:last-child{border-bottom:none}.ht{color:#9ca3af;flex:0 0 42px}.hp{flex:1;font-weight:500}.ho{flex:0 0 150px;text-align:right;font-size:11px}
.rfooter{margin-top:40px;padding-top:14px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;color:#d1d5db;font-size:11px}
.nb{page-break-inside:avoid}@media print{.page{padding:24px};body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="page">
<div class="rh"><div><h1>Relatório de Atendimentos</h1><div class="store">${storeName}</div></div><div class="meta"><strong>${gD}</strong>${wD.charAt(0).toUpperCase()+wD.slice(1)}<br>Gerado às ${gT}</div></div>
<div class="sec nb"><div class="sec-t">Resumo Executivo</div>
<div class="kpi-row k4">
<div class="kpi"><div class="kpi-n">${tSvc}</div><div class="kpi-l">Atendimentos</div></div>
<div class="kpi gr"><div class="kpi-n">${tSales}</div><div class="kpi-l">Vendas</div><div class="kpi-sub">${nonSales.length} sem conversão</div></div>
<div class="kpi dk"><div class="kpi-n" style="color:${cr>=60?"#86efac":cr>=40?"#fde68a":"#fca5a5"}">${cr}%</div><div class="kpi-l">Conversão</div><div class="kpi-sub">${cr>=60?"✓ Meta atingida":cr>=40?"~ Próximo da meta":"↓ Abaixo da meta"}</div></div>
<div class="kpi"><div class="kpi-n">${avgDur>0?avgDur+"'":"—"}</div><div class="kpi-l">Tempo Médio</div><div class="kpi-sub" style="color:#9ca3af">por atendimento</div></div>
</div>
${(peak&&peak[1]>0)||best?`<div class="kpi-row k2">
${peak&&peak[1]>0?`<div class="kpi am"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#d97706;margin-bottom:4px">Horário de Pico</div><div style="font-size:16px;font-weight:700;color:#111827">${peak[0]}h – ${parseInt(peak[0])+1}h</div><div style="font-size:12px;color:#9ca3af;margin-top:2px">${peak[1]} atendimento${peak[1]>1?"s":""}</div></div>`:"<div></div>"}
${best?`<div class="kpi" style="border-color:#fde68a;background:#fffbeb"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#d97706;margin-bottom:4px">Destaque do Dia ★</div><div style="font-size:16px;font-weight:700;color:#111827">${best.name}</div><div style="font-size:12px;color:#9ca3af;margin-top:2px">${best.pS} venda${best.pS!==1?"s":""} · ${best.pC}% conversão</div></div>`:"<div></div>"}
</div>`:""}
</div>
<div class="sec nb"><div class="sec-t">Performance por Funcionária</div>
<table><thead><tr><th>Funcionária</th><th>Entrada</th><th>Saída</th><th>Expediente</th><th>Pausas</th><th class="tc">Atend.</th><th class="tc">Vendas</th><th>Conversão</th></tr></thead>
<tbody>${staff.map(p=>`<tr><td class="tn">${p.name}${p.pS===maxSS&&maxSS>0?"&nbsp;<span class='badge badge-gold'>★</span>":""}</td><td class="td">${fmtTime(p.entryTime)}</td><td class="td">${p.exitTime?fmtTime(p.exitTime):"—"}</td><td class="td">${p.wStr}</td><td class="td">${p.bStr}</td><td class="tc" style="font-weight:600">${p.ps.length}</td><td class="tc tg">${p.pS}</td><td><div class="mb"><div class="mb-track"><div class="mb-fill" style="width:${p.pC}%;background:${p.pC>=60?"#16a34a":p.pC>=40?"#d97706":"#dc2626"}"></div></div><span class="mb-label" style="color:${p.pC>=60?"#16a34a":p.pC>=40?"#d97706":"#dc2626"}">${p.pC}%</span></div></td></tr>`).join("")}</tbody></table></div>
${services.length>0?`<div class="sec nb"><div class="sec-t">Movimento por Hora</div><div class="hchart">${hDisp.map(([h,c])=>{const ip=parseInt(h)===parseInt(peak?.[0])&&c>0;const bh=maxH>0?Math.max((c/maxH)*70,c>0?4:0):0;return`<div class="hcol"><div class="hcount" style="opacity:${c>0?1:0}">${c>0?c:""}</div><div class="hbwrap"><div class="hbar" style="height:${bh}px;background:${ip?"#e05c2d":c>0?"#374151":"#f3f4f6"}"></div></div><div class="hlabel" style="color:${ip?"#e05c2d":"#9ca3af"}">${h}h</div></div>`;}).join("")}</div><p style="font-size:11px;color:#9ca3af;margin-top:4px">Coluna em laranja = horário de pico</p></div>`:""}
<div class="sec nb"><div class="sec-t">Motivos de Não Venda — ${nonSales.length} ocorrência${nonSales.length!==1?"s":""}</div>
${sortedR.length===0?'<p style="color:#9ca3af;font-size:13px">Todos os atendimentos resultaram em venda!</p>':sortedR.map(([l,c])=>`<div class="rbar"><div class="rbar-name">${l}</div><div class="rbar-track"><div class="rbar-fill" style="width:${Math.round((c/maxR)*100)}%"></div></div><div class="rbar-n">${c}</div><div class="rbar-p">${nonSales.length?Math.round((c/nonSales.length)*100):0}%</div></div>`).join("")}
</div>
${queue.some(p=>p.breaks.length>0)?`<div class="sec nb"><div class="sec-t">Registro de Pausas</div><table><thead><tr><th>Funcionária</th><th>Pausa</th><th>Saída</th><th>Retorno</th><th>Duração</th></tr></thead><tbody>${queue.flatMap(p=>p.breaks.map((b,i)=>{const dur=b.end?Math.round((new Date(b.end)-new Date(b.start))/60000):null;const ds=dur!==null?(dur>=60?`${Math.floor(dur/60)}h ${dur%60}m`:`${dur} min`):"—";return`<tr><td class="tn">${p.name}</td><td class="td tc">${i+1}ª</td><td class="td">${fmtTime(b.start)}</td><td class="td">${b.end?fmtTime(b.end):"Em pausa"}</td><td class="td">${ds}</td></tr>`;})).join("")}</tbody></table></div>`:""}
<div class="sec"><div class="sec-t">Histórico Completo — ${services.length} registro${services.length!==1?"s":""}</div>
${services.length===0?'<p style="color:#9ca3af;font-size:13px">Nenhum atendimento.</p>':services.map(s=>`<div class="hist"><span class="ht">${fmtTime(s.startTime)}</span><span class="hp">${s.salespersonName}</span><span class="ho" style="color:${s.isSale?"#15803d":"#dc2626"};font-weight:${s.isSale?600:400}">${s.outcomeLabel}</span></div>`).join("")}
</div>
<div class="rfooter"><span>${storeName} · ${dS}</span><span>Sistema de Atendimento · Gerado às ${gT}</span></div>
</div></body></html>`;

  const w = window.open("","_blank");
  if (w) { w.document.write(html); w.document.close(); setTimeout(()=>w.print(),800); }
}
