import { useState, useEffect, useCallback } from "react";
import {
  doc, collection, onSnapshot, setDoc, getDoc,
  getDocs, serverTimestamp, query, orderBy,
} from "firebase/firestore";
import { db } from "./firebase.js";

/* ══════════════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════════════ */
// Step 1 — main result
const MAIN_OUTCOMES = [
  { id:"venda", label:"Venda Realizada", emoji:"🛍️", isSale:true,  color:"#22c55e" },
  { id:"troca", label:"Troca Realizada", emoji:"🔄", isSale:true,  color:"#3b82f6" },
  { id:"nao_vendeu", label:"Não Vendeu", emoji:"❌", isSale:false, color:"#ef4444" },
];

// Step 2 — non-sale reasons (shown when "Não Vendeu" is selected)
const SUB_OUTCOMES = [
  { id:"reservou",   label:"Reservou para outro dia", emoji:"📅", detail:false },
  { id:"preco",      label:"Preço Elevado",           emoji:"💸", detail:false },
  { id:"sem_peca",   label:"Não tinha a peça",        emoji:"📦", detail:true,  detailLabel:"Qual peça?" },
  { id:"sem_tamanho",label:"Não tinha o tamanho",     emoji:"📏", detail:false },
  { id:"sem_cor",    label:"Não tinha a cor",         emoji:"🎨", detail:false },
  { id:"olhando",    label:"Estava só olhando",       emoji:"👀", detail:false },
  { id:"outro",      label:"Outro Motivo",            emoji:"📝", detail:true,  detailLabel:"Especifique" },
];

// Flat lookup used by reports/PDF
const ALL_OUTCOMES = [
  ...MAIN_OUTCOMES.filter(o=>o.isSale),
  ...SUB_OUTCOMES.map(o=>({...o, isSale:false, color:"#9ca3af"})),
];

const C = {
  bg:"#130e0c", surface:"#2c1f1a", border:"#3d2a22", muted:"#a89880",
  accent:"#e05c2d", text:"#f5f0e8", green:"#22c55e", red:"#ef4444", yellow:"#f59e0b",
};

/* ══════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════ */
const fmtTime  = iso => iso ? new Date(iso).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}) : "—";
const fmtDate  = d   => d.toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"});
const fmtClock = d   => d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
const fmtShort = iso => iso ? new Date(iso).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric"}) : "—";
const uid      = ()  => Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const cap      = s   => s.charAt(0).toUpperCase()+s.slice(1);

/* ══════════════════════════════════════════════════════
   FIREBASE HELPERS
   stores/{id}              → { name, pin, active, createdAt }
   config/admin             → { pin }
   sessions/{storeId}       → { startedAt, queue, services, updatedAt }
   history/{storeId}/days/{dayId} → { startedAt, closedAt, queue, services }
══════════════════════════════════════════════════════ */
const storeRef    = id  => doc(db, "stores", id);
const sessionRef  = id  => doc(db, "sessions", id);
const adminRef    = ()  => doc(db, "config", "admin");
const historyCol  = id  => collection(db, "history", id, "days");
const histDayRef  = (storeId, dayId) => doc(db, "history", storeId, "days", dayId);

/* ══════════════════════════════════════════════════════
   SHARED UI
══════════════════════════════════════════════════════ */
const Inp = ({style={},...p}) => (
  <input style={{display:"block",width:"100%",background:"#1a1210",border:`1px solid ${C.border}`,
    borderRadius:10,padding:"13px 16px",color:C.text,fontSize:15,fontFamily:"inherit",
    marginBottom:14,outline:"none",boxSizing:"border-box",...style}} {...p}/>
);
const Btn = ({variant="primary",style={},...p}) => {
  const v={
    primary:{background:C.accent,border:"none",borderRadius:10,padding:"14px 20px",color:"#fff",fontSize:15,fontWeight:600},
    ghost:{background:"transparent",border:`1px solid ${C.border}`,borderRadius:8,padding:"9px 15px",color:C.muted,fontSize:13},
    accent:{background:C.accent,border:"none",borderRadius:8,padding:"9px 15px",color:"#fff",fontSize:13,fontWeight:600},
    danger:{background:C.red,border:"none",borderRadius:8,padding:"9px 15px",color:"#fff",fontSize:13,fontWeight:600},
    green:{background:"#15803d",border:"none",borderRadius:8,padding:"9px 15px",color:"#fff",fontSize:13,fontWeight:600},
    sm:{background:"transparent",border:`1px solid ${C.border}`,borderRadius:8,padding:"5px 9px",color:C.muted,fontSize:11},
  }[variant]||{};
  return <button style={{cursor:"pointer",fontFamily:"inherit",transition:"filter .15s",...v,...style}} {...p}/>;
};
const Overlay = ({children,onClose,closeable=true}) => (
  <div onClick={closeable?onClose:undefined}
    style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",display:"flex",
            alignItems:"center",justifyContent:"center",zIndex:999,padding:20}}>
    <div onClick={e=>e.stopPropagation()}
      style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:20,
              padding:32,maxWidth:460,width:"100%",position:"relative",maxHeight:"90vh",overflowY:"auto"}}>
      {closeable&&<button onClick={onClose}
        style={{position:"absolute",top:14,right:14,background:"transparent",
                border:"none",color:C.muted,fontSize:18,cursor:"pointer",lineHeight:1}}>✕</button>}
      {children}
    </div>
  </div>
);
const AppShell = ({children}) => (
  <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"'Outfit',sans-serif"}}>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap');
      *{font-family:'Outfit',sans-serif;box-sizing:border-box;}
      input::placeholder{color:#6b5a52;} input:focus{border-color:${C.accent}!important;outline:none;}
      button:hover:not(:disabled){filter:brightness(1.12);}
      button:active:not(:disabled){transform:scale(.97);}
      button:disabled{opacity:.4;cursor:not-allowed;}
      select{background:#1a1210;color:${C.text};}
      ::-webkit-scrollbar{width:4px;} ::-webkit-scrollbar-thumb{background:${C.border};border-radius:2px;}
    `}</style>
    <div style={{maxWidth:640,margin:"0 auto",paddingBottom:80}}>{children}</div>
  </div>
);
const Header = ({title,sub,actions}) => (
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
               padding:"22px 20px 14px",borderBottom:`1px solid #2c1f1a`,flexWrap:"wrap",gap:12}}>
    <div>
      <div style={{fontSize:20,fontWeight:700}}>{title}</div>
      <div style={{fontSize:13,color:C.muted,marginTop:2,display:"flex",gap:8,alignItems:"center"}}>{sub}</div>
    </div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{actions}</div>
  </div>
);
const StatsBar = ({items}) => (
  <div style={{display:"flex",justifyContent:"space-around",padding:"14px 20px",
               background:C.surface,margin:"14px 20px",borderRadius:12}}>
    {items.map((s,i)=>(
      <div key={i} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
        <div style={{fontSize:26,fontWeight:700,lineHeight:1,color:s.color||C.text}}>{s.num}</div>
        <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:".5px"}}>{s.label}</div>
      </div>
    ))}
  </div>
);
const SecHead = ({children,dim,style={}}) => (
  <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:1,color:C.muted,
               marginBottom:10,marginTop:4,opacity:dim?.4:1,...style}}>{children}</div>
);
const RSection = ({title,children}) => (
  <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:20,marginTop:14}}>
    <div style={{fontSize:11,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:16}}>{title}</div>
    {children}
  </div>
);
const Tag = ({children}) => (
  <span style={{fontSize:13,fontWeight:400,opacity:.85,background:"rgba(255,255,255,.13)",
                padding:"4px 12px",borderRadius:20}}>{children}</span>
);

/* ══════════════════════════════════════════════════════
   ROOT
══════════════════════════════════════════════════════ */
export default function App() {
  const [screen,setScreen] = useState("login");
  const [store, setStore]  = useState(null);
  return (
    <>
      {screen==="login" && (
        <LoginPage
          onStore={s=>{setStore(s);setScreen("store");}}
          onAdmin={()=>setScreen("admin")}
        />
      )}
      {screen==="store" && (
        <StoreApp store={store} onLogout={()=>{setStore(null);setScreen("login");}}/>
      )}
      {screen==="admin" && (
        <AdminDashboard onLogout={()=>setScreen("login")}/>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════
   LOGIN
══════════════════════════════════════════════════════ */
function LoginPage({onStore,onAdmin}) {
  const [tab,setTab]               = useState("store");
  const [stores,setStores]         = useState([]);
  const [storeId,setStoreId]       = useState("");
  const [pin,setPin]               = useState("");
  const [adminPin,setAdminPin]     = useState("");
  const [newAdminPin,setNewAdminPin]=useState("");
  const [firstRun,setFirstRun]     = useState(null); // null=loading
  const [err,setErr]               = useState("");

  // Load stores in real-time
  useEffect(()=>{
    const unsub = onSnapshot(collection(db,"stores"), snap=>{
      setStores(snap.docs.map(d=>({id:d.id,...d.data()}))
        .filter(s=>s.active!==false)
        .sort((a,b)=>a.name.localeCompare(b.name)));
    });
    return ()=>unsub();
  },[]);

  // Check if admin PIN exists
  useEffect(()=>{
    getDoc(adminRef()).then(d=>setFirstRun(!d.exists()));
  },[]);

  const loginStore=async()=>{
    setErr("");
    if(!storeId){setErr("Selecione uma loja.");return;}
    if(!pin){setErr("Digite o PIN.");return;}
    const snap=await getDoc(storeRef(storeId));
    if(!snap.exists()||snap.data().pin!==pin){setErr("PIN incorreto.");return;}
    onStore({id:storeId,name:snap.data().name});
  };

  const loginAdmin=async()=>{
    setErr("");
    if(!adminPin){setErr("Digite o PIN.");return;}
    const snap=await getDoc(adminRef());
    if(!snap.exists()||snap.data().pin!==adminPin){setErr("PIN incorreto.");return;}
    onAdmin();
  };

  const createPin=async()=>{
    if(newAdminPin.length<4){setErr("PIN deve ter pelo menos 4 dígitos.");return;}
    await setDoc(adminRef(),{pin:newAdminPin});
    onAdmin(); // auto-login after creating PIN
  };

  if(firstRun===null) return <div style={{minHeight:"100vh",background:C.bg}}/>;

  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"'Outfit',sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap');
        *{font-family:'Outfit',sans-serif;box-sizing:border-box;}
        input::placeholder{color:#6b5a52;} input:focus{border-color:${C.accent}!important;outline:none;}
        button:hover:not(:disabled){filter:brightness(1.12);}
        button:active:not(:disabled){transform:scale(.97);}
        button:disabled{opacity:.4;cursor:not-allowed;}
        select{appearance:auto;}
        ::-webkit-scrollbar{width:4px;} ::-webkit-scrollbar-thumb{background:${C.border};border-radius:2px;}
      `}</style>
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",padding:20}}>
        <div style={{width:"100%",maxWidth:420}}>
          <div style={{textAlign:"center",marginBottom:32}}>
            <div style={{fontSize:52}}>🏪</div>
            <h1 style={{fontSize:26,fontWeight:800,marginTop:12}}>Sistema de Atendimento</h1>
            <p style={{color:C.muted,fontSize:14,marginTop:6}}>Acesso por loja ou painel administrativo</p>
          </div>

          {/* Tabs */}
          <div style={{display:"flex",background:C.surface,borderRadius:12,padding:4,
                       marginBottom:20,border:`1px solid ${C.border}`}}>
            {[["store","🏪  Loja"],["admin","⚙️  Administrador"]].map(([t,label])=>(
              <button key={t} onClick={()=>{setTab(t);setErr("");}}
                style={{flex:1,padding:"10px 0",border:"none",borderRadius:9,fontFamily:"inherit",
                        fontSize:13,fontWeight:600,cursor:"pointer",
                        background:tab===t?C.accent:"transparent",color:tab===t?"#fff":C.muted}}>
                {label}
              </button>
            ))}
          </div>

          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,padding:"24px 28px"}}>
            {/* Store Login */}
            {tab==="store"&&<>
              <p style={{color:C.muted,fontSize:13,marginBottom:18}}>Selecione a loja e insira o PIN</p>
              {stores.length===0
                ?<p style={{color:C.muted,fontSize:14,lineHeight:1.7}}>
                   Nenhuma loja cadastrada.<br/>Acesse como Administrador para criar.
                 </p>
                :<>
                  <select value={storeId} onChange={e=>setStoreId(e.target.value)}
                    style={{display:"block",width:"100%",background:"#1a1210",
                            border:`1px solid ${C.border}`,borderRadius:10,padding:"13px 16px",
                            fontSize:15,fontFamily:"inherit",marginBottom:14,cursor:"pointer",
                            color:storeId?C.text:C.muted}}>
                    <option value="">Selecione a loja…</option>
                    {stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <Inp type="password" placeholder="PIN da loja" value={pin}
                       onChange={e=>setPin(e.target.value)}
                       onKeyDown={e=>e.key==="Enter"&&loginStore()}/>
                </>}
              {err&&<p style={{color:"#f87171",fontSize:13,marginBottom:12}}>{err}</p>}
              <Btn variant="primary" style={{width:"100%"}} disabled={stores.length===0} onClick={loginStore}>
                Entrar →
              </Btn>
            </>}

            {/* Admin Login */}
            {tab==="admin"&&(firstRun
              ?<>
                <p style={{color:C.muted,fontSize:13,marginBottom:18,lineHeight:1.6}}>
                  👋 Primeira vez — crie o PIN de administrador.
                </p>
                <Inp type="password" placeholder="Criar PIN (mín. 4 dígitos)" value={newAdminPin}
                     onChange={e=>setNewAdminPin(e.target.value)}
                     onKeyDown={e=>e.key==="Enter"&&createPin()}/>
                {err&&<p style={{color:"#f87171",fontSize:13,marginBottom:12}}>{err}</p>}
                <Btn variant="primary" style={{width:"100%"}} onClick={createPin}>Criar PIN e Entrar →</Btn>
              </>
              :<>
                <p style={{color:C.muted,fontSize:13,marginBottom:18}}>PIN de administrador</p>
                <Inp type="password" placeholder="PIN de administrador" value={adminPin} autoFocus
                     onChange={e=>setAdminPin(e.target.value)}
                     onKeyDown={e=>e.key==="Enter"&&loginAdmin()}/>
                {err&&<p style={{color:"#f87171",fontSize:13,marginBottom:12}}>{err}</p>}
                <Btn variant="primary" style={{width:"100%"}} onClick={loginAdmin}>Acessar Painel →</Btn>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   STORE APP
   Firestore model:
   sessions/{storeId}             → { startedAt, queue, services, updatedAt }
   history/{storeId}/days/{dayId} → { startedAt, closedAt, queue, services }
══════════════════════════════════════════════════════ */
function StoreApp({store,onLogout}) {
  const [view,setView]               = useState("queue");
  const [session,setSession]         = useState(null);
  const [queue,setQueue]             = useState([]);
  const [services,setServices]       = useState([]);
  const [curSvc,setCurSvc]           = useState(null);
  const [outcomeStep,setOutcomeStep] = useState("main");
  const [subDetail,setSubDetail]     = useState("");
  const [showAdd,setShowAdd]         = useState(false);
  const [addName,setAddName]         = useState("");
  const [confirmEnd,setConfirmEnd]   = useState(null);
  const [confirmClose,setConfirmClose]=useState(false);
  const [editSvc,setEditSvc]         = useState(null);
  const [editStep,setEditStep]       = useState("main");
  const [editSubDetail,setEditSubDetail]=useState("");
  const [now,setNow]                 = useState(new Date());
  const [ready,setReady]             = useState(false);

  useEffect(()=>{const t=setInterval(()=>setNow(new Date()),30000);return()=>clearInterval(t);},[]);

  // Real-time session listener
  useEffect(()=>{
    const ref=sessionRef(store.id);
    const unsub=onSnapshot(ref,snap=>{
      if(snap.exists()){
        const d=snap.data();
        // Only load if session is active (has startedAt)
        if(d.startedAt){
          setSession(d); setQueue(d.queue||[]); setServices(d.services||[]);
        } else {
          // Idle state after day was closed
          setSession(null); setQueue([]); setServices([]);
        }
      } else {
        // No document yet — idle, waiting for first entry
        setSession(null); setQueue([]); setServices([]);
      }
      setReady(true);
    });
    return ()=>unsub();
  },[store.id]);

  const persist=async(nq,ns,forceStartedAt)=>{
    await setDoc(sessionRef(store.id),{
      startedAt: forceStartedAt||session?.startedAt||new Date().toISOString(),
      queue: nq??queue,
      services: ns??services,
      updatedAt: serverTimestamp(),
    });
  };

  const closeDay=async()=>{
    const dayId=uid();
    await setDoc(histDayRef(store.id,dayId),{
      startedAt: session?.startedAt||new Date().toISOString(),
      closedAt: new Date().toISOString(),
      queue, services,
    });
    // Leave session idle — no startedAt until first entry tomorrow
    await setDoc(sessionRef(store.id),{
      startedAt: null,
      queue:[], services:[], updatedAt:serverTimestamp(),
    });
    setSession(null); setQueue([]); setServices([]);
    setConfirmClose(false); setView("queue"); setCurSvc(null);
  };

  const activeQ=()=>[...queue].filter(p=>p.status!=="done").sort((a,b)=>{
    if(a.status==="serving")return -1;if(b.status==="serving")return 1;
    if(a.status==="absent"&&b.status!=="absent")return 1;
    if(b.status==="absent"&&a.status!=="absent")return -1;
    return a.order-b.order;
  });
  const doneQ=()=>queue.filter(p=>p.status==="done");
  const nextP=()=>activeQ().find(p=>p.status==="waiting");
  const tSvc=services.length,tSales=services.filter(s=>s.isSale).length;
  const conv=tSvc>0?Math.round((tSales/tSvc)*100):0;

  const addPerson=async()=>{
    const name=addName.trim();if(!name)return;
    const nq=[...queue,{id:uid(),name,status:"waiting",
      entryTime:new Date().toISOString(),breaks:[],exitTime:null,
      order:queue.filter(p=>p.status!=="done").length}];
    // If no active session yet, this entry starts the day
    const startedAt=session?.startedAt||new Date().toISOString();
    setQueue(nq); await persist(nq,null,startedAt); setAddName(""); setShowAdd(false);
  };
  const newCustomer=async()=>{
    const next=activeQ().find(p=>p.status==="waiting");
    if(!next||curSvc)return;
    const sv={id:uid(),salespersonId:next.id,salespersonName:next.name,startTime:new Date().toISOString()};
    setCurSvc(sv);
    const nq=queue.map(p=>p.id===next.id?{...p,status:"serving"}:p);
    setQueue(nq); await persist(nq,null);
  };
    const resolveOutcome=(id,detail="")=>{
    const main=MAIN_OUTCOMES.find(o=>o.id===id);
    if(main) return {id,label:main.label,isSale:main.isSale};
    const sub=SUB_OUTCOMES.find(o=>o.id===id);
    if(!sub) return {id,label:id,isSale:false};
    const label=detail?`${sub.label}: ${detail}`:sub.label;
    return {id,label,isSale:false};
  };

  const finishService=async(outcomeId,detail="")=>{
    if(!curSvc)return;
    const {label,isSale}=resolveOutcome(outcomeId,detail);
    const ns=[...services,{...curSvc,endTime:new Date().toISOString(),
      outcome:outcomeId,outcomeLabel:label,isSale,detail}];
    const maxOrd=Math.max(...queue.filter(q=>q.status!=="done").map(q=>q.order),0);
    const nq=queue.map(p=>p.id===curSvc.salespersonId?{...p,status:"waiting",order:maxOrd+1}:p);
    setQueue(nq); setServices(ns); setCurSvc(null);
    setOutcomeStep("main"); setSubDetail("");
    await persist(nq,ns);
  };

  const editService=async(svcId,outcomeId,detail="")=>{
    const {label,isSale}=resolveOutcome(outcomeId,detail);
    const ns=services.map(s=>s.id===svcId
      ?{...s,outcome:outcomeId,outcomeLabel:label,isSale,detail}
      :s);
    setServices(ns); setEditSvc(null); setEditStep("main"); setEditSubDetail("");
    await persist(null,ns);
  };
  const cancelService=async()=>{
    if(!curSvc)return;
    const nq=queue.map(p=>p.id===curSvc.salespersonId?{...p,status:"waiting"}:p);
    setQueue(nq); setCurSvc(null); setOutcomeStep("main"); setSubDetail("");
    await persist(nq,null);
  };
  const skipTurn=async(id)=>{
    const maxOrd=Math.max(...queue.filter(q=>q.status!=="done").map(q=>q.order),0);
    const nq=queue.map(p=>p.id===id?{...p,order:maxOrd+1}:p);
    setQueue(nq); await persist(nq,null);
  };
  const toggleAbsent=async(id)=>{
    const p=queue.find(q=>q.id===id);if(!p)return;
    let nq;
    if(p.status==="absent"){
      const mo=Math.max(...queue.filter(q=>q.status!=="done").map(q=>q.order),0);
      nq=queue.map(q=>q.id===id?{...q,status:"waiting",order:mo+1,
        breaks:q.breaks.map((b,i)=>i===q.breaks.length-1?{...b,end:new Date().toISOString()}:b)}:q);
    }else{
      nq=queue.map(q=>q.id===id?{...q,status:"absent",
        breaks:[...q.breaks,{start:new Date().toISOString(),end:null}]}:q);
    }
    setQueue(nq); await persist(nq,null);
  };
  const endShift=async(id)=>{
    const nq=queue.map(p=>p.id===id?{...p,status:"done",exitTime:new Date().toISOString()}:p);
    setQueue(nq); setConfirmEnd(null); await persist(nq,null);
  };

  if(!ready) return (
    <AppShell>
      <div style={{padding:60,textAlign:"center",color:C.muted}}>Carregando…</div>
    </AppShell>
  );

  // IDLE STATE — day was closed, waiting for first entry to start a new day
  if(!session?.startedAt) return (
    <AppShell>
      <Header title={store.name}
        sub={<>{cap(fmtDate(now))} <span style={{background:"#2c1f1a",padding:"2px 10px",borderRadius:20,fontWeight:500}}>{fmtClock(now)}</span></>}
        actions={<Btn variant="ghost" onClick={onLogout} style={{padding:"9px 12px"}}>⎋ Sair</Btn>}
      />
      <div style={{textAlign:"center",padding:"60px 30px",color:C.muted}}>
        <div style={{fontSize:52,marginBottom:20}}>🌅</div>
        <div style={{fontSize:18,fontWeight:700,color:C.text,marginBottom:10}}>Pronta para começar!</div>
        <div style={{fontSize:14,marginBottom:8}}>O dia ainda não foi iniciado.</div>
        <div style={{fontSize:13,opacity:.6,marginBottom:32}}>
          O dia inicia automaticamente quando a primeira funcionária der entrada.
        </div>
        <Btn variant="primary" style={{display:"inline-block",padding:"14px 32px"}}
          onClick={()=>setShowAdd(true)}>
          + Registrar Primeira Entrada
        </Btn>
      </div>

      {showAdd&&(
        <Overlay onClose={()=>setShowAdd(false)}>
          <div style={{fontSize:36,marginBottom:12}}>👋</div>
          <h2 style={{fontSize:20,fontWeight:700,marginBottom:8}}>Registrar Entrada</h2>
          <p style={{color:C.muted,fontSize:13,marginBottom:20}}>
            Isso irá iniciar o dia de <strong>{store.name}</strong>
          </p>
          <Inp autoFocus value={addName} placeholder="Nome da funcionária…"
               onChange={e=>setAddName(e.target.value)}
               onKeyDown={e=>e.key==="Enter"&&addPerson()}/>
          <div style={{display:"flex",gap:8,marginTop:4,justifyContent:"flex-end"}}>
            <Btn variant="ghost" onClick={()=>setShowAdd(false)}>Cancelar</Btn>
            <Btn variant="primary" style={{width:"auto",padding:"10px 20px"}} onClick={addPerson}>
              Iniciar o Dia →
            </Btn>
          </div>
        </Overlay>
      )}
    </AppShell>
  );

  const aq=activeQ(),dq=doneQ(),np=nextP();

  return (
    <AppShell>
      <Header title={store.name}
        sub={<>
          {cap(fmtDate(now))}
          <span style={{background:"#2c1f1a",padding:"2px 10px",borderRadius:20,fontWeight:500}}>
            {fmtClock(now)}
          </span>
        </>}
        actions={<>
          {view==="queue"
            ?<Btn variant="ghost" onClick={()=>setView("report")}>📊 Relatório</Btn>
            :<Btn variant="ghost" onClick={()=>setView("queue")}>← Fila</Btn>}
          {view==="report"&&<>
            <Btn variant="accent" onClick={()=>exportPDF(store.name,queue,services,session?.startedAt)}>📄 PDF</Btn>
            <Btn variant="green" onClick={()=>setConfirmClose(true)}>🌙 Encerrar Dia</Btn>
          </>}
          {view==="queue"&&<Btn variant="accent" onClick={()=>setShowAdd(true)}>+ Entrada</Btn>}
          <Btn variant="ghost" onClick={onLogout} style={{padding:"9px 12px"}}>⎋ Sair</Btn>
        </>}
      />

      {/* Session info strip */}
      <div style={{margin:"12px 20px 0",padding:"10px 16px",background:"#1a1210",borderRadius:10,
                   fontSize:12,color:C.muted,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span>📅 Dia iniciado em {fmtShort(session?.startedAt)} às {fmtTime(session?.startedAt)}</span>
        {view==="queue"&&(
          <button onClick={()=>setView("report")}
            style={{background:"transparent",border:"none",color:C.accent,
                    fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
            Ver relatório + encerrar →
          </button>
        )}
      </div>

      <StatsBar items={[
        {num:tSvc,label:"Atendimentos"},
        {num:tSales,label:"Vendas",color:C.green},
        {num:`${conv}%`,label:"Conversão"},
        {num:aq.filter(p=>p.status==="waiting").length,label:"Na Fila"},
      ]}/>

      {/* Queue */}
      {view==="queue"&&<>
        <div style={{padding:"4px 20px 16px"}}>
          <button disabled={!np||!!curSvc} onClick={newCustomer}
            style={{display:"flex",alignItems:"center",justifyContent:"center",gap:12,
                    width:"100%",background:C.accent,border:"none",borderRadius:14,
                    padding:"20px 24px",color:"#fff",fontSize:19,fontWeight:700,
                    cursor:np&&!curSvc?"pointer":"not-allowed",
                    opacity:np&&!curSvc?1:.35,fontFamily:"inherit"}}>
            🛎️ Novo Cliente
            {curSvc&&<Tag>Em atendimento…</Tag>}
            {np&&!curSvc&&<Tag>→ {np.name}</Tag>}
          </button>
        </div>
        <div style={{padding:"0 20px"}}>
          <SecHead>Fila de Atendimento</SecHead>
          {aq.length===0&&(
            <div style={{textAlign:"center",padding:"36px 20px",color:C.muted,fontSize:14}}>
              <div style={{fontSize:32,marginBottom:8}}>👥</div>
              Nenhuma funcionária na fila
              <div style={{fontSize:13,opacity:.5,marginTop:6}}>
                Use "+ Entrada" para registrar o início do expediente
              </div>
            </div>
          )}
          {aq.map((p,i)=>(
            <PersonCard key={p.id} person={p} position={i+1} isNext={p.id===np?.id}
              onSkip={()=>skipTurn(p.id)} onAbsent={()=>toggleAbsent(p.id)} onEnd={()=>setConfirmEnd(p.id)}/>
          ))}
          {dq.length>0&&<>
            <SecHead dim>Expediente Encerrado</SecHead>
            {dq.map(p=><PersonCard key={p.id} person={p} done/>)}
          </>}
        </div>
      </>}

      {/* Report */}
      {view==="report"&&<>
        <div style={{margin:"16px 20px",background:"#0d1f0d",border:"1px solid #22c55e44",
                     borderRadius:14,padding:"16px 20px",
                     display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontWeight:700,color:C.green,fontSize:14}}>🌙 Encerrar o dia</div>
            <div style={{fontSize:12,color:C.muted,marginTop:2}}>
              Salva no histórico e zera para amanhã
            </div>
          </div>
          <Btn variant="green" onClick={()=>setConfirmClose(true)}>Encerrar Dia →</Btn>
        </div>
        <ReportView services={services} queue={queue} tSvc={tSvc} tSales={tSales} conv={conv} onEdit={s=>{setEditSvc(s);setEditStep("main");setEditSubDetail("");}}/>
      </>}

      {/* Modals */}
      {showAdd&&(
        <Overlay onClose={()=>setShowAdd(false)}>
          <div style={{fontSize:36,marginBottom:12}}>👋</div>
          <h2 style={{fontSize:20,fontWeight:700,marginBottom:8}}>Registrar Entrada</h2>
          <p style={{color:C.muted,fontSize:13,marginBottom:20}}>Adicionar à fila de atendimento</p>
          <Inp autoFocus value={addName} placeholder="Nome da funcionária…"
               onChange={e=>setAddName(e.target.value)}
               onKeyDown={e=>e.key==="Enter"&&addPerson()}/>
          <div style={{display:"flex",gap:8,marginTop:4,justifyContent:"flex-end"}}>
            <Btn variant="ghost" onClick={()=>setShowAdd(false)}>Cancelar</Btn>
            <Btn variant="primary" style={{width:"auto",padding:"10px 20px"}} onClick={addPerson}>
              Entrar na Fila →
            </Btn>
          </div>
        </Overlay>
      )}

      {curSvc&&(
        <Overlay closeable={false}>
          <div style={{fontSize:36,marginBottom:12}}>🤝</div>
          <h2 style={{fontSize:20,fontWeight:700,marginBottom:8}}>
            {outcomeStep==="main"?"Resultado do Atendimento":"Motivo da Não Venda"}
          </h2>
          <p style={{color:C.muted,fontSize:13,marginBottom:20}}>
            <strong>{curSvc.salespersonName}</strong> · {fmtTime(curSvc.startTime)}
          </p>

          {/* STEP 1 — main */}
          {outcomeStep==="main"&&(
            <div style={{display:"grid",gridTemplateColumns:"1fr",gap:8}}>
              {MAIN_OUTCOMES.map(o=>(
                <button key={o.id}
                  onClick={()=>{
                    if(o.id==="nao_vendeu"){ setOutcomeStep("sub"); }
                    else { finishService(o.id); }
                  }}
                  style={{background:"#1a1210",border:`1px solid ${o.color}55`,borderRadius:12,
                          padding:"16px 14px",cursor:"pointer",display:"flex",alignItems:"center",
                          gap:12,fontFamily:"inherit",textAlign:"left"}}>
                  <span style={{fontSize:26}}>{o.emoji}</span>
                  <span style={{fontSize:14,color:C.text,fontWeight:600}}>{o.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* STEP 2 — sub reasons */}
          {outcomeStep==="sub"&&(
            <>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {SUB_OUTCOMES.map(o=>(
                  <button key={o.id}
                    onClick={()=>{
                      if(!o.detail){ finishService(o.id,""); }
                      else {
                        // toggle selection — if already selected, clear
                        setSubDetail(prev=>prev.startsWith(o.id+":")?"":o.id+":");
                      }
                    }}
                    style={{background: subDetail.startsWith(o.id+":")?"#2c1f1a":"#1a1210",
                            border:`1px solid ${subDetail.startsWith(o.id+":")?"#e05c2d":"#3d2a2255"}`,
                            borderRadius:12,padding:"12px 10px",cursor:"pointer",display:"flex",
                            flexDirection:"column",alignItems:"center",gap:5,fontFamily:"inherit"}}>
                    <span style={{fontSize:20}}>{o.emoji}</span>
                    <span style={{fontSize:11,color:C.text,lineHeight:1.3,textAlign:"center"}}>{o.label}</span>
                  </button>
                ))}
              </div>

              {/* Detail text field */}
              {SUB_OUTCOMES.filter(o=>o.detail).map(o=>{
                if(!subDetail.startsWith(o.id+":")) return null;
                const detailText=subDetail.slice(o.id.length+1);
                return(
                  <div key={o.id} style={{marginTop:12}}>
                    <input
                      autoFocus
                      value={detailText}
                      onChange={e=>setSubDetail(o.id+":"+e.target.value)}
                      placeholder={o.detailLabel+"…"}
                      style={{display:"block",width:"100%",background:"#1a1210",
                              border:`1px solid ${C.border}`,borderRadius:10,
                              padding:"11px 14px",color:C.text,fontSize:14,
                              fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}
                    />
                    <Btn variant="accent" style={{width:"100%",marginTop:8}}
                      disabled={!detailText.trim()}
                      onClick={()=>finishService(o.id,detailText.trim())}>
                      Confirmar →
                    </Btn>
                  </div>
                );
              })}

              {/* Confirm button for options without detail */}
              {subDetail!==""&&!SUB_OUTCOMES.find(o=>o.detail&&subDetail.startsWith(o.id+":"))&&(()=>{
                const selId=subDetail.replace(":","");
                return(
                  <Btn variant="accent" style={{width:"100%",marginTop:12}}
                    onClick={()=>finishService(selId,"")}>
                    Confirmar →
                  </Btn>
                );
              })()}

              <Btn variant="ghost" style={{width:"100%",marginTop:8,fontSize:12}}
                onClick={()=>{ setOutcomeStep("main"); setSubDetail(""); }}>
                ← Voltar
              </Btn>
            </>
          )}

          <Btn variant="ghost" style={{width:"100%",marginTop:12,fontSize:13}} onClick={cancelService}>
            ✕ Cancelar atendimento
          </Btn>
        </Overlay>
      )}

      {confirmEnd&&(
        <Overlay onClose={()=>setConfirmEnd(null)}>
          <div style={{fontSize:36,marginBottom:12}}>🚪</div>
          <h2 style={{fontSize:20,fontWeight:700,marginBottom:8}}>Encerrar Expediente?</h2>
          <p style={{color:C.muted,fontSize:13,marginBottom:20}}>
            {queue.find(p=>p.id===confirmEnd)?.name} será removida da fila.
          </p>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <Btn variant="ghost" onClick={()=>setConfirmEnd(null)}>Voltar</Btn>
            <Btn variant="danger" onClick={()=>endShift(confirmEnd)}>Confirmar Saída</Btn>
          </div>
        </Overlay>
      )}

      {confirmClose&&(
        <Overlay onClose={()=>setConfirmClose(false)}>
          <div style={{fontSize:36,marginBottom:12}}>🌙</div>
          <h2 style={{fontSize:20,fontWeight:700,marginBottom:8}}>Encerrar o Dia?</h2>
          <p style={{color:C.muted,fontSize:13,marginBottom:8}}>
            O relatório será salvo no histórico e a fila será zerada para amanhã.
          </p>
          <div style={{background:"#1a1210",borderRadius:10,padding:"12px 16px",marginBottom:20,fontSize:13}}>
            <div>📊 {tSvc} atendimento{tSvc!==1?"s":""} · {tSales} venda{tSales!==1?"s":""} · {conv}% conversão</div>
            <div style={{color:C.muted,marginTop:4,fontSize:12}}>
              Iniciado às {fmtTime(session?.startedAt)}
            </div>
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <Btn variant="ghost" onClick={()=>setConfirmClose(false)}>Cancelar</Btn>
            <Btn variant="green" onClick={closeDay}>✓ Confirmar Encerramento</Btn>
          </div>
        </Overlay>
      )}

      {/* ── EDIT SERVICE MODAL ── */}
      {editSvc&&(
        <Overlay onClose={()=>{ setEditSvc(null); setEditStep("main"); setEditSubDetail(""); }}>
          <div style={{fontSize:28,marginBottom:10}}>✏️</div>
          <h2 style={{fontSize:18,fontWeight:700,marginBottom:6}}>Editar Atendimento</h2>
          <p style={{color:C.muted,fontSize:12,marginBottom:18}}>
            {editSvc.salespersonName} · {fmtTime(editSvc.startTime)}<br/>
            <span style={{color:editSvc.isSale?C.green:"#f87171"}}>Atual: {editSvc.outcomeLabel}</span>
          </p>

          {editStep==="main"&&(
            <div style={{display:"grid",gridTemplateColumns:"1fr",gap:8}}>
              {MAIN_OUTCOMES.map(o=>(
                <button key={o.id}
                  onClick={()=>{
                    if(o.id==="nao_vendeu"){ setEditStep("sub"); }
                    else { editService(editSvc.id,o.id); }
                  }}
                  style={{background:"#1a1210",border:`1px solid ${o.color}55`,borderRadius:12,
                          padding:"14px",cursor:"pointer",display:"flex",alignItems:"center",
                          gap:12,fontFamily:"inherit",textAlign:"left"}}>
                  <span style={{fontSize:22}}>{o.emoji}</span>
                  <span style={{fontSize:13,color:C.text,fontWeight:600}}>{o.label}</span>
                </button>
              ))}
            </div>
          )}

          {editStep==="sub"&&(
            <>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {SUB_OUTCOMES.map(o=>(
                  <button key={o.id}
                    onClick={()=>{
                      if(!o.detail){ editService(editSvc.id,o.id,""); }
                      else { setEditSubDetail(prev=>prev.startsWith(o.id+":")?"":o.id+":"); }
                    }}
                    style={{background:editSubDetail.startsWith(o.id+":")?"#2c1f1a":"#1a1210",
                            border:`1px solid ${editSubDetail.startsWith(o.id+":")?"#e05c2d":"#3d2a2255"}`,
                            borderRadius:12,padding:"11px 8px",cursor:"pointer",display:"flex",
                            flexDirection:"column",alignItems:"center",gap:4,fontFamily:"inherit"}}>
                    <span style={{fontSize:18}}>{o.emoji}</span>
                    <span style={{fontSize:11,color:C.text,lineHeight:1.3,textAlign:"center"}}>{o.label}</span>
                  </button>
                ))}
              </div>
              {SUB_OUTCOMES.filter(o=>o.detail).map(o=>{
                if(!editSubDetail.startsWith(o.id+":")) return null;
                const dt=editSubDetail.slice(o.id.length+1);
                return(
                  <div key={o.id} style={{marginTop:10}}>
                    <input autoFocus value={dt}
                      onChange={e=>setEditSubDetail(o.id+":"+e.target.value)}
                      placeholder={o.detailLabel+"…"}
                      style={{display:"block",width:"100%",background:"#1a1210",
                              border:`1px solid ${C.border}`,borderRadius:10,
                              padding:"10px 14px",color:C.text,fontSize:13,
                              fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}
                    />
                    <Btn variant="accent" style={{width:"100%",marginTop:8}} disabled={!dt.trim()}
                      onClick={()=>editService(editSvc.id,o.id,dt.trim())}>Confirmar →</Btn>
                  </div>
                );
              })}
              {editSubDetail!==""&&!SUB_OUTCOMES.find(o=>o.detail&&editSubDetail.startsWith(o.id+":"))&&(()=>{
                const selId=editSubDetail.replace(":","");
                return <Btn variant="accent" style={{width:"100%",marginTop:10}}
                  onClick={()=>editService(editSvc.id,selId,"")}>Confirmar →</Btn>;
              })()}
              <Btn variant="ghost" style={{width:"100%",marginTop:8,fontSize:12}}
                onClick={()=>{ setEditStep("main"); setEditSubDetail(""); }}>← Voltar</Btn>
            </>
          )}
        </Overlay>
      )}
    </AppShell>
  );
}

/* ══════════════════════════════════════════════════════
   ADMIN DASHBOARD
══════════════════════════════════════════════════════ */
function AdminDashboard({onLogout}) {
  const [tab,setTab]                 = useState("overview");
  const [stores,setStores]           = useState([]);
  const [sessions,setSessions]       = useState({});
  const [histories,setHistories]     = useState({});
  const [detailStore,setDetailStore] = useState(null);
  const [detailRec,setDetailRec]     = useState(null);
  const [histStore,setHistStore]     = useState(null);
  const [dashStores,setDashStores]   = useState([]);     // selected store ids
  const [dashFrom,setDashFrom]       = useState("");     // YYYY-MM-DD
  const [dashTo,setDashTo]           = useState("");
  const [dashData,setDashData]       = useState(null);   // compiled result
  const [dashLoading,setDashLoading] = useState(false);
  const [allHistories,setAllHistories]= useState({});    // full history cache
  const [showAdd,setShowAdd]         = useState(false);
  const [newName,setNewName]         = useState("");
  const [newPin,setNewPin]           = useState("");
  const [editStore,setEditStore]     = useState(null);
  const [saving,setSaving]           = useState(false);
  const [now,setNow]                 = useState(new Date());

  useEffect(()=>{const t=setInterval(()=>setNow(new Date()),30000);return()=>clearInterval(t);},[]);

  // Real-time stores
  useEffect(()=>{
    const unsub=onSnapshot(collection(db,"stores"),snap=>{
      setStores(snap.docs.map(d=>({id:d.id,...d.data()}))
        .sort((a,b)=>a.name.localeCompare(b.name)));
    });
    return ()=>unsub();
  },[]);

  // Real-time sessions for all stores
  useEffect(()=>{
    if(stores.length===0)return;
    const unsubs=stores.map(s=>
      onSnapshot(sessionRef(s.id),snap=>{
        setSessions(prev=>({...prev,[s.id]:snap.exists()?snap.data():{queue:[],services:[]}}));
      })
    );
    return ()=>unsubs.forEach(u=>u());
  },[stores]);

  // Load histories (for history tab AND dashboard)
  const loadHistories=useCallback(async()=>{
    const data={};
    for(const s of stores){
      const snap=await getDocs(query(historyCol(s.id),orderBy("closedAt","desc")));
      data[s.id]=snap.docs.map(d=>({id:d.id,...d.data()}));
    }
    setHistories(data);
    setAllHistories(data);
  },[stores]);

  useEffect(()=>{
    if(tab==="history"||tab==="dashboard")loadHistories();
  },[tab,loadHistories]);

  // Dashboard: compile data from selected stores + date range
  const runDashboard=useCallback(()=>{
    if(!dashFrom||!dashTo||dashStores.length===0){setDashData(null);return;}
    setDashLoading(true);
    const from=new Date(dashFrom+"T00:00:00");
    const to  =new Date(dashTo  +"T23:59:59");

    // Collect all day records within range from selected stores
    const allSvcs=[], staffMap={}, reasonMap={}, storeMap={};
    const hC={};for(let h=8;h<=21;h++)hC[h]=0;

    dashStores.forEach(sid=>{
      const store=stores.find(s=>s.id===sid);
      storeMap[sid]={name:store?.name||sid,svc:0,sales:0};
      const hist=allHistories[sid]||[];

      // Also include current open session if it falls within range
      const curSess=sessions[sid];
      const allDays=[...hist];
      if(curSess?.startedAt){
        const sessDate=new Date(curSess.startedAt);
        if(sessDate>=from&&sessDate<=to){
          allDays.push({...curSess,closedAt:null,id:"current"});
        }
      }

      allDays.forEach(day=>{
        const dayDate=new Date(day.startedAt);
        if(dayDate<from||dayDate>to)return;
        const svcs=day.services||[];
        svcs.forEach(sv=>{
          allSvcs.push({...sv,storeName:store?.name||sid,storeId:sid});
          storeMap[sid].svc++;
          if(sv.isSale) storeMap[sid].sales++;

          // hourly
          const h=new Date(sv.startTime).getHours();
          if(h>=8&&h<=21) hC[h]=(hC[h]||0)+1;

          // reasons
          if(!sv.isSale){
            const lbl=sv.outcomeLabel||"Outro";
            reasonMap[lbl]=(reasonMap[lbl]||0)+1;
          }

          // staff
          const key=`${sid}_${sv.salespersonName}`;
          if(!staffMap[key]) staffMap[key]={name:sv.salespersonName,store:store?.name||sid,svc:0,sales:0};
          staffMap[key].svc++;
          if(sv.isSale) staffMap[key].sales++;
        });
      });
    });

    const totalSvc=allSvcs.length;
    const totalSales=allSvcs.filter(s=>s.isSale).length;
    const conv=totalSvc>0?Math.round((totalSales/totalSvc)*100):0;
    const durs=allSvcs.filter(s=>s.startTime&&s.endTime).map(s=>new Date(s.endTime)-new Date(s.startTime));
    const avgDur=durs.length?Math.round(durs.reduce((a,b)=>a+b,0)/durs.length/60000):0;

    const sortedReasons=Object.entries(reasonMap).sort((a,b)=>b[1]-a[1]);
    const sortedStaff=Object.values(staffMap)
      .map(p=>({...p,conv:p.svc>0?Math.round((p.sales/p.svc)*100):0}))
      .sort((a,b)=>b.sales-a.sales);
    const sortedStores=Object.values(storeMap)
      .map(s=>({...s,conv:s.svc>0?Math.round((s.sales/s.svc)*100):0}))
      .sort((a,b)=>b.sales-a.sales);
    const sortedHour=Object.entries(hC).sort((a,b)=>parseInt(a[0])-parseInt(b[0]));
    const maxHour=Math.max(...sortedHour.map(([,c])=>c),1);
    const peakH=sortedHour.slice().sort((a,b)=>b[1]-a[1])[0];

    setDashData({totalSvc,totalSales,conv,avgDur,sortedReasons,sortedStaff,sortedStores,sortedHour,maxHour,peakH});
    setDashLoading(false);
  },[dashFrom,dashTo,dashStores,allHistories,sessions,stores]);

  const mx=sid=>{
    const d=sessions[sid]||{queue:[],services:[]};
    const sv=d.services||[],q=d.queue||[];
    const sa=sv.filter(s=>s.isSale).length;
    return{svc:sv.length,sales:sa,
           conv:sv.length>0?Math.round((sa/sv.length)*100):0,
           active:q.filter(p=>p.status!=="done").length,
           queue:q,services:sv,startedAt:d.startedAt};
  };

  const activeStores=stores.filter(s=>s.active!==false);
  const allSvc  =activeStores.reduce((a,s)=>a+(sessions[s.id]?.services||[]).length,0);
  const allSales=activeStores.reduce((a,s)=>a+(sessions[s.id]?.services||[]).filter(x=>x.isSale).length,0);
  const allConv =allSvc>0?Math.round((allSales/allSvc)*100):0;

  const addStore=async()=>{
    if(!newName.trim()||!newPin.trim())return;
    setSaving(true);
    const id=uid();
    await setDoc(storeRef(id),{
      name:newName.trim(), pin:newPin.trim(),
      active:true, createdAt:serverTimestamp(),
    });
    setNewName(""); setNewPin(""); setShowAdd(false); setSaving(false);
  };

  const saveEdit=async()=>{
    if(!editStore)return; setSaving(true);
    await setDoc(storeRef(editStore.id),
      {name:editStore.name,pin:editStore.pin},{merge:true});
    setEditStore(null); setSaving(false);
  };

  const toggleActive=async(s)=>{
    await setDoc(storeRef(s.id),{active:!s.active},{merge:true});
  };

  // Store current session detail
  if(tab==="detail"&&detailStore){
    const m=mx(detailStore.id);
    return(
      <AppShell>
        <Header title={detailStore.name}
          sub={<>Dia atual · desde {fmtTime(m.startedAt)}</>}
          actions={<>
            <Btn variant="ghost" onClick={()=>setTab("overview")}>← Painel</Btn>
            <Btn variant="accent" onClick={()=>exportPDF(detailStore.name,m.queue,m.services,m.startedAt)}>
              📄 PDF
            </Btn>
          </>}
        />
        <StatsBar items={[
          {num:m.svc,label:"Atendimentos"},
          {num:m.sales,label:"Vendas",color:C.green},
          {num:`${m.conv}%`,label:"Conversão"},
          {num:m.active,label:"Em turno"},
        ]}/>
        <ReportView services={m.services} queue={m.queue} tSvc={m.svc} tSales={m.sales} conv={m.conv}/>
      </AppShell>
    );
  }

  // Historical record detail
  if(tab==="histDetail"&&detailRec){
    const{storeName,record:rec}=detailRec;
    const sv=rec.services||[],q=rec.queue||[];
    const ts=sv.length,tsa=sv.filter(s=>s.isSale).length,cr=ts>0?Math.round((tsa/ts)*100):0;
    return(
      <AppShell>
        <Header title={storeName}
          sub={`${fmtShort(rec.startedAt)} · ${fmtTime(rec.startedAt)} – ${fmtTime(rec.closedAt)}`}
          actions={<>
            <Btn variant="ghost" onClick={()=>setTab("history")}>← Histórico</Btn>
            <Btn variant="accent" onClick={()=>exportPDF(storeName,q,sv,rec.startedAt)}>📄 PDF</Btn>
          </>}
        />
        <StatsBar items={[
          {num:ts,label:"Atendimentos"},
          {num:tsa,label:"Vendas",color:C.green},
          {num:`${cr}%`,label:"Conversão"},
          {num:q.length,label:"Funcionárias"},
        ]}/>
        <ReportView services={sv} queue={q} tSvc={ts} tSales={tsa} conv={cr}/>
      </AppShell>
    );
  }

  return(
    <AppShell>
      <Header title="Painel Administrativo" sub={cap(fmtDate(now))}
        actions={<>
          <Btn variant="ghost"
               style={tab==="overview"?{borderColor:C.accent,color:C.accent}:{}}
               onClick={()=>setTab("overview")}>📊 Hoje</Btn>
          <Btn variant="ghost"
               style={tab==="dashboard"?{borderColor:C.accent,color:C.accent}:{}}
               onClick={()=>setTab("dashboard")}>📈 Dashboard</Btn>
          <Btn variant="ghost"
               style={tab==="history"?{borderColor:C.accent,color:C.accent}:{}}
               onClick={()=>setTab("history")}>📅 Histórico</Btn>
          <Btn variant="ghost"
               style={tab==="stores"?{borderColor:C.accent,color:C.accent}:{}}
               onClick={()=>setTab("stores")}>🏪 Lojas</Btn>
          <Btn variant="ghost" onClick={onLogout} style={{padding:"9px 12px"}}>⎋ Sair</Btn>
        </>}
      />

      {/* TODAY */}
      {tab==="overview"&&<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,margin:"20px 20px 0"}}>
          {[
            {num:activeStores.length,label:"Lojas Ativas"},
            {num:allSvc,label:"Atendimentos"},
            {num:allSales,label:"Vendas",color:C.green},
            {num:`${allConv}%`,label:"Conversão"},
          ].map((s,i)=>(
            <div key={i} style={{background:C.surface,border:`1px solid ${C.border}`,
                                  borderRadius:12,padding:"16px 12px",textAlign:"center"}}>
              <div style={{fontSize:28,fontWeight:700,color:s.color||C.text}}>{s.num}</div>
              <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",
                           letterSpacing:".5px",marginTop:4}}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={{padding:"20px"}}>
          <SecHead style={{marginBottom:12}}>Lojas</SecHead>
          {stores.length===0&&(
            <div style={{textAlign:"center",padding:"48px 20px",color:C.muted}}>
              <div style={{fontSize:36,marginBottom:12}}>🏪</div>
              Nenhuma loja cadastrada.
              <br/>
              <Btn variant="accent" style={{display:"inline-block",marginTop:16}}
                   onClick={()=>setTab("stores")}>Ir para Lojas →</Btn>
            </div>
          )}
          {stores.map(s=>{
            const m=mx(s.id);
            const cc=m.conv>=60?C.green:m.conv>=40?C.yellow:"#f87171";
            return(
              <div key={s.id}
                onClick={()=>{setDetailStore(s);setTab("detail");}}
                style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,
                        padding:"16px 20px",marginBottom:10,cursor:"pointer",
                        opacity:s.active===false?.5:1,transition:"border-color .2s"}}
                onMouseEnter={e=>e.currentTarget.style.borderColor=C.accent}
                onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:16}}>{s.name}</div>
                    {s.active===false
                      ?<div style={{fontSize:12,color:C.muted,marginTop:2}}>Inativa</div>
                      :m.active>0
                        ?<div style={{fontSize:12,color:C.muted,marginTop:2}}>
                           🟢 {m.active} em turno · desde {fmtTime(m.startedAt)}
                         </div>
                        :<div style={{fontSize:12,color:C.muted,marginTop:2}}>
                           Sem atividade no momento
                         </div>}
                  </div>
                  {m.svc>0&&(
                    <div style={{display:"flex",gap:20}}>
                      {[
                        {val:m.svc,label:"Atend.",color:C.text},
                        {val:m.sales,label:"Vendas",color:C.green},
                        {val:`${m.conv}%`,label:"Conv.",color:cc},
                      ].map(({val,label,color})=>(
                        <div key={label} style={{textAlign:"center"}}>
                          <div style={{fontSize:22,fontWeight:700,color}}>{val}</div>
                          <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",
                                       letterSpacing:".5px"}}>{label}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </>}

      {/* HISTORY */}
      {tab==="history"&&(
        <div style={{padding:"20px"}}>
          <SecHead style={{marginBottom:16}}>Histórico de Dias Encerrados</SecHead>
          {stores.every(s=>(histories[s.id]||[]).length===0)&&(
            <div style={{textAlign:"center",padding:"48px 20px",color:C.muted}}>
              <div style={{fontSize:36,marginBottom:12}}>📅</div>
              Nenhum dia encerrado ainda.<br/>
              <span style={{fontSize:13,opacity:.6}}>
                Os relatórios aparecerão aqui quando as lojas encerrarem o dia.
              </span>
            </div>
          )}
          {stores.map(s=>{
            const hist=histories[s.id]||[];
            if(hist.length===0)return null;
            const open=histStore===s.id;
            return(
              <div key={s.id} style={{marginBottom:16}}>
                <button onClick={()=>setHistStore(open?null:s.id)}
                  style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                          width:"100%",background:C.surface,border:`1px solid ${C.border}`,
                          borderRadius:12,padding:"14px 16px",cursor:"pointer",
                          fontFamily:"inherit",color:C.text}}>
                  <div style={{fontWeight:700,fontSize:15}}>{s.name}</div>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:12,color:C.muted}}>
                      {hist.length} dia{hist.length!==1?"s":""} encerrado{hist.length!==1?"s":""}
                    </span>
                    <span style={{color:C.muted}}>{open?"▲":"▼"}</span>
                  </div>
                </button>
                {open&&(
                  <div style={{marginTop:4}}>
                    {hist.map(rec=>{
                      const sv=rec.services||[];
                      const sa=sv.filter(s=>s.isSale).length;
                      const cr=sv.length>0?Math.round((sa/sv.length)*100):0;
                      const cc=cr>=60?C.green:cr>=40?C.yellow:"#f87171";
                      return(
                        <div key={rec.id}
                          onClick={()=>{setDetailRec({storeName:s.name,record:rec});setTab("histDetail");}}
                          style={{background:"#1a1210",border:`1px solid ${C.border}`,borderRadius:10,
                                  padding:"12px 16px",marginBottom:6,cursor:"pointer",
                                  display:"flex",justifyContent:"space-between",alignItems:"center"}}
                          onMouseEnter={e=>e.currentTarget.style.borderColor=C.accent}
                          onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
                          <div>
                            <div style={{fontWeight:600,fontSize:14}}>{fmtShort(rec.startedAt)}</div>
                            <div style={{fontSize:12,color:C.muted,marginTop:2}}>
                              {fmtTime(rec.startedAt)} – {fmtTime(rec.closedAt)}
                            </div>
                          </div>
                          <div style={{display:"flex",gap:16}}>
                            {[
                              {val:sv.length,label:"Atend.",color:C.text},
                              {val:sa,label:"Vendas",color:C.green},
                              {val:`${cr}%`,label:"Conv.",color:cc},
                            ].map(({val,label,color})=>(
                              <div key={label} style={{textAlign:"center"}}>
                                <div style={{fontSize:18,fontWeight:700,color}}>{val}</div>
                                <div style={{fontSize:10,color:C.muted,textTransform:"uppercase"}}>
                                  {label}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* STORES */}
      {/* ── DASHBOARD ── */}
      {tab==="dashboard"&&(
        <div style={{padding:"20px"}}>
          {/* Filters */}
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,padding:20,marginBottom:16}}>
            <SecHead style={{marginBottom:14}}>Filtros</SecHead>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
              <div>
                <div style={{fontSize:11,color:C.muted,marginBottom:6,textTransform:"uppercase",letterSpacing:".5px"}}>Data Inicial</div>
                <input type="date" value={dashFrom} onChange={e=>setDashFrom(e.target.value)}
                  style={{width:"100%",background:"#1a1210",border:`1px solid ${C.border}`,borderRadius:8,
                          padding:"10px 12px",color:C.text,fontSize:13,fontFamily:"inherit",outline:"none",
                          boxSizing:"border-box",colorScheme:"dark"}}/>
              </div>
              <div>
                <div style={{fontSize:11,color:C.muted,marginBottom:6,textTransform:"uppercase",letterSpacing:".5px"}}>Data Final</div>
                <input type="date" value={dashTo} onChange={e=>setDashTo(e.target.value)}
                  style={{width:"100%",background:"#1a1210",border:`1px solid ${C.border}`,borderRadius:8,
                          padding:"10px 12px",color:C.text,fontSize:13,fontFamily:"inherit",outline:"none",
                          boxSizing:"border-box",colorScheme:"dark"}}/>
              </div>
            </div>

            <div style={{fontSize:11,color:C.muted,marginBottom:8,textTransform:"uppercase",letterSpacing:".5px"}}>Lojas</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:16}}>
              <button
                onClick={()=>setDashStores(dashStores.length===stores.length?[]:stores.map(s=>s.id))}
                style={{background:dashStores.length===stores.length?"#e05c2d22":"transparent",
                        border:`1px solid ${dashStores.length===stores.length?C.accent:C.border}`,
                        borderRadius:20,padding:"5px 14px",color:dashStores.length===stores.length?C.accent:C.muted,
                        fontSize:12,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>
                {dashStores.length===stores.length?"✓ Todas":"Todas"}
              </button>
              {stores.map(s=>{
                const sel=dashStores.includes(s.id);
                return(
                  <button key={s.id}
                    onClick={()=>setDashStores(sel?dashStores.filter(id=>id!==s.id):[...dashStores,s.id])}
                    style={{background:sel?"#e05c2d22":"transparent",
                            border:`1px solid ${sel?C.accent:C.border}`,
                            borderRadius:20,padding:"5px 14px",
                            color:sel?C.accent:C.muted,fontSize:12,
                            cursor:"pointer",fontFamily:"inherit"}}>
                    {sel?"✓ ":""}{s.name}
                  </button>
                );
              })}
            </div>

            <Btn variant="accent" style={{width:"100%"}}
              disabled={!dashFrom||!dashTo||dashStores.length===0||dashLoading}
              onClick={runDashboard}>
              {dashLoading?"Calculando…":"📈 Gerar Dashboard"}
            </Btn>
            {(!dashFrom||!dashTo)&&<p style={{fontSize:12,color:C.muted,marginTop:8,textAlign:"center"}}>
              Selecione o período e ao menos uma loja
            </p>}
          </div>

          {/* Results */}
          {dashData&&<>
            {/* KPIs */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
              {[
                {num:dashData.totalSvc,  label:"Atendimentos",  color:C.text},
                {num:dashData.totalSales,label:"Vendas",         color:C.green},
                {num:`${dashData.conv}%`,label:"Conversão",      color:dashData.conv>=60?C.green:dashData.conv>=40?C.yellow:"#f87171"},
                {num:dashData.avgDur>0?`${dashData.avgDur}'`:"—",label:"Tempo Médio",color:C.text},
              ].map((k,i)=>(
                <div key={i} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:"16px 12px",textAlign:"center"}}>
                  <div style={{fontSize:26,fontWeight:700,color:k.color}}>{k.num}</div>
                  <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:".5px",marginTop:4}}>{k.label}</div>
                </div>
              ))}
            </div>

            {/* Por Loja */}
            {dashData.sortedStores.length>1&&(
              <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:20,marginBottom:14}}>
                <SecHead style={{marginBottom:14}}>Comparativo por Loja</SecHead>
                {dashData.sortedStores.map((s,i)=>{
                  const maxS=dashData.sortedStores[0].sales||1;
                  const cc=s.conv>=60?C.green:s.conv>=40?C.yellow:"#f87171";
                  return(
                    <div key={s.name} style={{marginBottom:16}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                        <span style={{fontSize:13,fontWeight:600}}>{i+1}. {s.name}</span>
                        <div style={{display:"flex",gap:14,fontSize:12}}>
                          <span style={{color:C.muted}}>{s.svc} atend.</span>
                          <span style={{color:C.green,fontWeight:600}}>{s.sales} vendas</span>
                          <span style={{color:cc,fontWeight:600}}>{s.conv}%</span>
                        </div>
                      </div>
                      <div style={{height:8,background:"#1a1210",borderRadius:4,overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${Math.round((s.sales/maxS)*100)}%`,
                                     background:C.accent,borderRadius:4,transition:"width .4s"}}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Movimento por hora */}
            <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:20,marginBottom:14}}>
              <SecHead style={{marginBottom:14}}>Movimento por Hora</SecHead>
              <div style={{display:"flex",alignItems:"flex-end",gap:4,height:80,marginBottom:6}}>
                {dashData.sortedHour.map(([h,c])=>{
                  const isPeak=h===dashData.peakH?.[0];
                  const bh=dashData.maxHour>0?Math.max((c/dashData.maxHour)*68,c>0?3:0):0;
                  return(
                    <div key={h} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                      <div style={{fontSize:9,color:C.muted,fontWeight:c>0?700:400,opacity:c>0?1:.3}}>{c>0?c:""}</div>
                      <div style={{width:"100%",borderRadius:"3px 3px 0 0",
                                   height:bh,background:isPeak?C.accent:c>0?"#4b3a32":"#1a1210",
                                   minHeight:c>0?3:0,transition:"height .3s"}}/>
                      <div style={{fontSize:9,color:isPeak?C.accent:C.muted}}>{h}h</div>
                    </div>
                  );
                })}
              </div>
              {dashData.peakH&&dashData.peakH[1]>0&&(
                <p style={{fontSize:11,color:C.muted,marginTop:4}}>
                  🔥 Pico: {dashData.peakH[0]}h com {dashData.peakH[1]} atendimento{dashData.peakH[1]!==1?"s":""}
                </p>
              )}
            </div>

            {/* Motivos de não venda */}
            {dashData.sortedReasons.length>0&&(
              <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:20,marginBottom:14}}>
                <SecHead style={{marginBottom:14}}>Motivos de Não Venda</SecHead>
                {(()=>{
                  const total=dashData.sortedReasons.reduce((a,[,c])=>a+c,0);
                  const maxR=dashData.sortedReasons[0]?.[1]||1;
                  return dashData.sortedReasons.map(([label,cnt])=>(
                    <div key={label} style={{marginBottom:14}}>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:5}}>
                        <span style={{color:"#d4c4b8"}}>{label}</span>
                        <span style={{color:C.muted,fontSize:12}}>{cnt} <span style={{color:C.muted,fontSize:11}}>({Math.round((cnt/total)*100)}%)</span></span>
                      </div>
                      <div style={{height:6,background:"#1a1210",borderRadius:3,overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${Math.round((cnt/maxR)*100)}%`,
                                     background:C.accent,borderRadius:3}}/>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}

            {/* Performance vendedoras */}
            {dashData.sortedStaff.length>0&&(
              <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:20,marginBottom:14}}>
                <SecHead style={{marginBottom:14}}>Performance por Vendedora</SecHead>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,auto) 1fr auto",gap:"6px 12px",alignItems:"center"}}>
                  {["Vendedora","Loja","Atend.","Conversão","Vendas"].map(h=>(
                    <div key={h} style={{fontSize:10,color:C.muted,textTransform:"uppercase",
                                         letterSpacing:".5px",paddingBottom:8,borderBottom:`1px solid ${C.border}`}}>{h}</div>
                  ))}
                  {dashData.sortedStaff.map((p,i)=>{
                    const cc=p.conv>=60?C.green:p.conv>=40?C.yellow:"#f87171";
                    const maxSales=dashData.sortedStaff[0].sales||1;
                    return(<>
                      <div key={p.name+"n"} style={{fontSize:13,fontWeight:600,paddingBottom:8,
                                                     borderBottom:`1px solid #1a1210`}}>
                        {i===0&&"★ "}{p.name}
                      </div>
                      <div key={p.name+"s"} style={{fontSize:12,color:C.muted,paddingBottom:8,
                                                     borderBottom:`1px solid #1a1210`}}>{p.store}</div>
                      <div key={p.name+"a"} style={{fontSize:13,paddingBottom:8,
                                                     borderBottom:`1px solid #1a1210`,textAlign:"center"}}>{p.svc}</div>
                      <div key={p.name+"b"} style={{paddingBottom:8,borderBottom:`1px solid #1a1210`}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <div style={{flex:1,height:6,background:"#1a1210",borderRadius:3,overflow:"hidden"}}>
                            <div style={{height:"100%",width:`${p.conv}%`,background:cc,borderRadius:3}}/>
                          </div>
                          <span style={{fontSize:11,fontWeight:700,color:cc,width:32}}>{p.conv}%</span>
                        </div>
                      </div>
                      <div key={p.name+"v"} style={{fontSize:14,fontWeight:700,color:C.green,
                                                     paddingBottom:8,borderBottom:`1px solid #1a1210`,
                                                     textAlign:"center"}}>{p.sales}</div>
                    </>);
                  })}
                </div>
              </div>
            )}

            {/* Export PDF */}
            <button onClick={()=>exportDashPDF(dashData,dashFrom,dashTo,stores.filter(s=>dashStores.includes(s.id)).map(s=>s.name))}
              style={{width:"100%",background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,
                      padding:"14px",color:C.text,fontSize:13,fontWeight:600,cursor:"pointer",
                      fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
              📄 Exportar Dashboard em PDF
            </button>
          </>}
        </div>
      )}

      {tab==="stores"&&(
        <div style={{padding:"20px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div style={{fontWeight:600}}>Lojas ({stores.length})</div>
            <Btn variant="accent" onClick={()=>setShowAdd(true)}>+ Nova Loja</Btn>
          </div>
          {stores.length===0&&(
            <div style={{textAlign:"center",padding:"36px",color:C.muted}}>
              Nenhuma loja ainda. Clique em "+ Nova Loja".
            </div>
          )}
          {stores.map(s=>(
            <div key={s.id} style={{background:C.surface,border:`1px solid ${C.border}`,
                                    borderRadius:12,padding:"14px 16px",marginBottom:8,
                                    opacity:s.active===false?.55:1}}>
              {editStore?.id===s.id
                ?<div>
                    <div style={{display:"flex",gap:8,marginBottom:8}}>
                      <Inp value={editStore.name} style={{marginBottom:0,flex:1}}
                           onChange={e=>setEditStore({...editStore,name:e.target.value})}
                           placeholder="Nome"/>
                      <Inp value={editStore.pin} style={{marginBottom:0,width:110}}
                           onChange={e=>setEditStore({...editStore,pin:e.target.value})}
                           placeholder="PIN"/>
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <Btn variant="ghost" onClick={()=>setEditStore(null)}>Cancelar</Btn>
                      <Btn variant="accent" disabled={saving} onClick={saveEdit}>
                        {saving?"Salvando…":"Salvar"}
                      </Btn>
                    </div>
                  </div>
                :<div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <div style={{fontWeight:600,fontSize:15}}>{s.name}</div>
                      <div style={{fontSize:12,color:C.muted,marginTop:2}}>
                        PIN:{" "}
                        <code style={{background:"#1a1210",padding:"1px 8px",
                                      borderRadius:6,letterSpacing:2}}>{s.pin}</code>
                        {s.active===false&&<span style={{color:C.red,marginLeft:8}}>· Inativa</span>}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:6}}>
                      <Btn variant="sm" onClick={()=>setEditStore({id:s.id,name:s.name,pin:s.pin})}>
                        ✏️ Editar
                      </Btn>
                      <Btn variant="sm"
                           style={{color:s.active===false?C.green:C.yellow}}
                           onClick={()=>toggleActive(s)}>
                        {s.active===false?"✓ Ativar":"⊘ Pausar"}
                      </Btn>
                    </div>
                  </div>
              }
            </div>
          ))}
        </div>
      )}

      {/* Modal: add store */}
      {showAdd&&(
        <Overlay onClose={()=>setShowAdd(false)}>
          <div style={{fontSize:36,marginBottom:12}}>🏪</div>
          <h2 style={{fontSize:20,fontWeight:700,marginBottom:8}}>Nova Loja</h2>
          <p style={{color:C.muted,fontSize:13,marginBottom:20}}>
            Defina o nome e o PIN de acesso
          </p>
          <Inp autoFocus value={newName} placeholder="Nome da loja…"
               onChange={e=>setNewName(e.target.value)}/>
          <Inp value={newPin} placeholder="PIN (ex: 1234)"
               onChange={e=>setNewPin(e.target.value)}
               onKeyDown={e=>e.key==="Enter"&&addStore()}/>
          <div style={{display:"flex",gap:8,marginTop:4,justifyContent:"flex-end"}}>
            <Btn variant="ghost" onClick={()=>setShowAdd(false)}>Cancelar</Btn>
            <Btn variant="primary" style={{width:"auto",padding:"10px 20px"}}
                 disabled={saving||!newName.trim()||!newPin.trim()} onClick={addStore}>
              {saving?"Salvando…":"Criar Loja →"}
            </Btn>
          </div>
        </Overlay>
      )}
    </AppShell>
  );
}

/* ══════════════════════════════════════════════════════
   PERSON CARD
══════════════════════════════════════════════════════ */
function PersonCard({person:p,position,isNext,onSkip,onAbsent,onEnd,done}){
  const acc={waiting:isNext?C.accent:"#4b5563",serving:C.green,absent:C.yellow,done:"#374151"}[p.status]||"#4b5563";
  const badge={
    waiting:isNext?"🎯 Próxima":`#${position}`,
    serving:"⚡ Atendendo",absent:"⏸ Ausente",
    done:`✓ Saiu ${fmtTime(p.exitTime)}`,
  }[p.status]||`#${position}`;
  return(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                 background:C.surface,borderRadius:12,padding:"13px 14px",marginBottom:8,
                 borderLeft:`3px solid ${acc}`,gap:10,opacity:done?.45:1}}>
      <div style={{display:"flex",alignItems:"center",gap:12,flex:1,minWidth:0}}>
        <div style={{fontSize:11,fontWeight:700,padding:"4px 10px",borderRadius:20,
                     background:`${acc}22`,color:acc,whiteSpace:"nowrap",flexShrink:0}}>{badge}</div>
        <div>
          <div style={{fontSize:15,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
            {p.name}
          </div>
          <div style={{fontSize:11,color:C.muted,marginTop:2}}>
            Entrada {fmtTime(p.entryTime)}
            {p.breaks.length?` · ${p.breaks.length} pausa${p.breaks.length>1?"s":""}`:""}</div>
        </div>
      </div>
      {!done&&(
        <div style={{display:"flex",gap:6,flexShrink:0}}>
          <Btn variant="sm" style={{color:p.status==="absent"?C.green:C.yellow}} onClick={onAbsent}>
            {p.status==="absent"?"▶ Retornar":"⏸ Pausar"}
          </Btn>
          {p.status==="waiting"&&<Btn variant="sm" onClick={onSkip}>⏭ Pular</Btn>}
          <Btn variant="sm" style={{color:C.red}} onClick={onEnd}>✕</Btn>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   REPORT VIEW
══════════════════════════════════════════════════════ */
function ReportView({services,queue,tSvc,tSales,conv,onEdit}){
  const nS=services.filter(s=>!s.isSale);
  const rC={};nS.forEach(s=>{rC[s.outcomeLabel]=(rC[s.outcomeLabel]||0)+1;});
  const sR=Object.entries(rC).sort((a,b)=>b[1]-a[1]);
  const mR=sR[0]?.[1]||1;
  return(
    <div style={{padding:"8px 20px 60px"}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,margin:"16px 0"}}>
        {[{n:tSvc,l:"Atendimentos",c:C.text},{n:tSales,l:"Vendas",c:C.green},{n:`${conv}%`,l:"Conversão",c:C.text}]
          .map((s,i)=>(
            <div key={i} style={{background:C.surface,border:`1px solid ${C.border}`,
                                  borderRadius:12,padding:"20px 16px",textAlign:"center"}}>
              <div style={{fontSize:36,fontWeight:700,color:s.c}}>{s.n}</div>
              <div style={{fontSize:11,color:C.muted,textTransform:"uppercase",
                           letterSpacing:".5px",marginTop:4}}>{s.l}</div>
            </div>
          ))}
      </div>

      <RSection title="Motivos de Não Venda">
        {sR.length===0
          ?<p style={{color:C.muted,fontSize:13,textAlign:"center"}}>Nenhum registro</p>
          :sR.map(([label,cnt])=>(
            <div key={label} style={{marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:6}}>
                <span style={{color:"#d4c4b8"}}>{label}</span>
                <span style={{fontWeight:600}}>{cnt}</span>
              </div>
              <div style={{height:6,background:"#1a1210",borderRadius:3,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${Math.round((cnt/mR)*100)}%`,
                             background:C.accent,borderRadius:3}}/>
              </div>
            </div>
          ))}
      </RSection>

      <RSection title="Funcionárias">
        {queue.length===0
          ?<p style={{color:C.muted,fontSize:13,textAlign:"center"}}>Nenhum registro</p>
          :queue.map(p=>{
            const ps=services.filter(s=>s.salespersonId===p.id);
            const pv=ps.filter(s=>s.isSale).length;
            return(
              <div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",
                                       borderBottom:`1px solid #2c201a`,paddingBottom:12,marginBottom:12}}>
                <div>
                  <div style={{fontWeight:600,fontSize:15}}>{p.name}</div>
                  <div style={{fontSize:12,color:C.muted,marginTop:2}}>
                    Entrada {fmtTime(p.entryTime)}
                    {p.breaks.map((b,i)=>` · Pausa ${i+1}: ${fmtTime(b.start)}–${fmtTime(b.end)}`)}
                    {p.exitTime&&` · Saída ${fmtTime(p.exitTime)}`}
                  </div>
                </div>
                <div style={{textAlign:"right",fontSize:13}}>
                  <div>{ps.length} atend.</div>
                  <div style={{color:C.green}}>{pv} vendas</div>
                </div>
              </div>
            );
          })}
      </RSection>

      <RSection title={`Histórico (${services.length})`}>
        {onEdit&&<p style={{color:C.muted,fontSize:11,marginBottom:12,marginTop:-8}}>
          Clique em ✏️ para alterar o resultado de um atendimento.
        </p>}
        {services.length===0
          ?<p style={{color:C.muted,fontSize:13,textAlign:"center"}}>Nenhum atendimento</p>
          :[...services].reverse().map(s=>(
            <div key={s.id} style={{display:"flex",gap:10,padding:"8px 0",
                                     borderBottom:`1px solid #2c201a`,alignItems:"center"}}>
              <span style={{fontSize:12,color:C.muted,flexShrink:0}}>{fmtTime(s.startTime)}</span>
              <span style={{fontSize:13,flex:1}}>{s.salespersonName}</span>
              <span style={{fontSize:12,color:s.isSale?C.green:"#f87171",flex:1}}>{s.outcomeLabel}</span>
              {onEdit&&(
                <button onClick={()=>onEdit(s)}
                  style={{background:"transparent",border:`1px solid ${C.border}`,borderRadius:6,
                          padding:"3px 8px",color:C.muted,fontSize:11,cursor:"pointer",
                          fontFamily:"inherit",flexShrink:0}}>
                  ✏️
                </button>
              )}
            </div>
          ))}
      </RSection>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   PDF EXPORT
══════════════════════════════════════════════════════ */
function exportPDF(storeName,queue,services,startedAt){
  const nS=services.filter(s=>!s.isSale);
  const tV=services.length,tSa=services.filter(s=>s.isSale).length;
  const cr=tV>0?Math.round((tSa/tV)*100):0;
  const dur=services.filter(s=>s.startTime&&s.endTime)
    .map(s=>new Date(s.endTime)-new Date(s.startTime));
  const aD=dur.length?Math.round(dur.reduce((a,b)=>a+b,0)/dur.length/60000):0;
  const hC={};for(let h=8;h<=21;h++)hC[h]=0;
  services.forEach(s=>{const h=new Date(s.startTime).getHours();if(h>=8&&h<=21)hC[h]=(hC[h]||0)+1;});
  const hD=Object.entries(hC).sort((a,b)=>parseInt(a[0])-parseInt(b[0]));
  const mH=Math.max(...hD.map(([,c])=>c),1);
  const pk=hD.slice().sort((a,b)=>b[1]-a[1])[0];
  const rC={};nS.forEach(s=>{rC[s.outcomeLabel]=(rC[s.outcomeLabel]||0)+1;});
  const sR=Object.entries(rC).sort((a,b)=>b[1]-a[1]);const mR=sR[0]?.[1]||1;
  const st=queue.map(p=>{
    const ps=services.filter(s=>s.salespersonId===p.id);
    const pS=ps.filter(s=>s.isSale).length,pC=ps.length?Math.round((pS/ps.length)*100):0;
    const en=p.exitTime?new Date(p.exitTime):new Date();
    const tM=en-new Date(p.entryTime);
    const bM=p.breaks.reduce((a,b)=>{const bE=b.end?new Date(b.end):new Date();return a+(bE-new Date(b.start));},0);
    const wm=Math.round((tM-bM)/60000);
    const wS=Math.floor(wm/60)>0?`${Math.floor(wm/60)}h ${wm%60}m`:`${wm}m`;
    const bm=Math.round(bM/60000);
    const bS=bm>0?(Math.floor(bm/60)>0?`${Math.floor(bm/60)}h ${bm%60}m`:`${bm}m`):"—";
    return{...p,ps,pS,pC,wS,bS};
  }).sort((a,b)=>b.pS-a.pS);
  const best=st.find(p=>p.pS>0),mSS=Math.max(...st.map(p=>p.pS),0);
  const gT=new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
  const ref=startedAt?new Date(startedAt):new Date();
  const gD=ref.toLocaleDateString("pt-BR",{day:"numeric",month:"long",year:"numeric"});
  const wD=ref.toLocaleDateString("pt-BR",{weekday:"long"});

  const html=`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Relatório — ${storeName}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;color:#111827;font-size:13px;line-height:1.5}
.pg{max-width:860px;margin:0 auto;padding:48px}
.rh{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:20px;border-bottom:3px solid #111827;margin-bottom:32px}
.rh h1{font-size:26px;font-weight:800}.rh .st{font-size:15px;color:#6b7280;margin-top:4px;font-weight:500}
.rh .mt{text-align:right;color:#9ca3af;font-size:12px;line-height:1.8}.rh .mt strong{color:#111827;font-size:14px;display:block;font-weight:700}
.sc{margin-bottom:32px}.sc-t{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#9ca3af;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid #f3f4f6}
.kr{display:grid;gap:12px}.k4{grid-template-columns:repeat(4,1fr)}.k2{grid-template-columns:repeat(2,1fr);margin-top:12px}
.kp{border:1px solid #e5e7eb;border-radius:10px;padding:16px;background:#f9fafb}
.kp.dk{background:#111827;border-color:#111827}.kp.gr{background:#f0fdf4;border-color:#bbf7d0}.kp.am{background:#fffbeb;border-color:#fde68a}
.kn{font-size:30px;font-weight:800;color:#111827;letter-spacing:-1px;line-height:1}.kp.dk .kn{color:#fff}.kp.gr .kn{color:#15803d}
.kl{font-size:10px;color:#9ca3af;margin-top:5px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.ks{font-size:11px;color:#d1d5db;margin-top:3px}.kp.gr .ks{color:#86efac}
.bd{display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;background:#fef9c3;color:#92400e}
table{width:100%;border-collapse:collapse}
thead th{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#9ca3af;padding:8px 10px;text-align:left;border-bottom:1px solid #e5e7eb}
tbody td{padding:9px 10px;border-bottom:1px solid #f3f4f6;vertical-align:middle}tbody tr:last-child td{border-bottom:none}
.tn{font-weight:600;color:#111827}.tg{color:#15803d;font-weight:600}.td{color:#9ca3af;font-size:12px}.tc{text-align:center}
.mb{display:flex;align-items:center;gap:8px}.mb-t{flex:1;height:6px;background:#f3f4f6;border-radius:3px;overflow:hidden;min-width:60px}.mb-f{height:100%;border-radius:3px}.mb-l{font-size:11px;font-weight:700;width:32px;text-align:right}
.rb{display:flex;align-items:center;gap:10px;margin-bottom:8px}.rn{flex:0 0 160px;font-size:12px;color:#374151}.rt{flex:1;height:10px;background:#f3f4f6;border-radius:5px;overflow:hidden}.rf{height:100%;background:#e05c2d;border-radius:5px}.rq{flex:0 0 24px;font-weight:700;font-size:12px;text-align:right}.rp{flex:0 0 36px;font-size:11px;color:#9ca3af;text-align:right}
.hc{display:flex;align-items:flex-end;gap:5px;height:90px;margin-bottom:6px}.hcl{display:flex;flex-direction:column;align-items:center;gap:3px;flex:1}.hbw{flex:1;display:flex;align-items:flex-end;width:100%}.hb{width:100%;border-radius:3px 3px 0 0;min-height:2px}.hl{font-size:9px;white-space:nowrap}.hct{font-size:9px;font-weight:700;color:#6b7280}
.hi{display:flex;gap:12px;align-items:center;padding:6px 0;border-bottom:1px solid #f9fafb;font-size:12px}.hi:last-child{border-bottom:none}.ht2{color:#9ca3af;flex:0 0 42px}.hp{flex:1;font-weight:500}.ho{flex:0 0 150px;text-align:right;font-size:11px}
.ft{margin-top:40px;padding-top:14px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;color:#d1d5db;font-size:11px}
.nb{page-break-inside:avoid}
@media print{.pg{padding:24px};body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="pg">
<div class="rh">
  <div><h1>Relatório de Atendimentos</h1><div class="st">${storeName}</div></div>
  <div class="mt"><strong>${gD}</strong>${wD.charAt(0).toUpperCase()+wD.slice(1)}<br>Gerado às ${gT}</div>
</div>
<div class="sc nb"><div class="sc-t">Resumo Executivo</div>
<div class="kr k4">
<div class="kp"><div class="kn">${tV}</div><div class="kl">Atendimentos</div></div>
<div class="kp gr"><div class="kn">${tSa}</div><div class="kl">Vendas</div><div class="ks">${nS.length} sem conversão</div></div>
<div class="kp dk"><div class="kn" style="color:${cr>=60?"#86efac":cr>=40?"#fde68a":"#fca5a5"}">${cr}%</div><div class="kl">Conversão</div><div class="ks">${cr>=60?"✓ Meta atingida":cr>=40?"~ Próximo":"↓ Abaixo da meta"}</div></div>
<div class="kp"><div class="kn">${aD>0?aD+"'":"—"}</div><div class="kl">Tempo Médio</div><div class="ks" style="color:#9ca3af">por atendimento</div></div>
</div>
${(pk&&pk[1]>0)||best?`<div class="kr k2">
${pk&&pk[1]>0?`<div class="kp am"><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#d97706;margin-bottom:4px">Horário de Pico</div><div style="font-size:16px;font-weight:700">${pk[0]}h–${parseInt(pk[0])+1}h</div><div style="font-size:12px;color:#9ca3af;margin-top:2px">${pk[1]} atendimento${pk[1]>1?"s":""}</div></div>`:"<div></div>"}
${best?`<div class="kp" style="border-color:#fde68a;background:#fffbeb"><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#d97706;margin-bottom:4px">Destaque do Dia ★</div><div style="font-size:16px;font-weight:700">${best.name}</div><div style="font-size:12px;color:#9ca3af;margin-top:2px">${best.pS} venda${best.pS!==1?"s":""} · ${best.pC}% conv.</div></div>`:"<div></div>"}
</div>`:""}
</div>
<div class="sc nb"><div class="sc-t">Performance por Funcionária</div>
<table><thead><tr><th>Funcionária</th><th>Entrada</th><th>Saída</th><th>Expediente</th><th>Pausas</th><th class="tc">Atend.</th><th class="tc">Vendas</th><th>Conversão</th></tr></thead>
<tbody>${st.map(p=>`<tr>
<td class="tn">${p.name}${p.pS===mSS&&mSS>0?" <span class='bd'>★</span>":""}</td>
<td class="td">${fmtTime(p.entryTime)}</td>
<td class="td">${p.exitTime?fmtTime(p.exitTime):"—"}</td>
<td class="td">${p.wS}</td><td class="td">${p.bS}</td>
<td class="tc" style="font-weight:600">${p.ps.length}</td>
<td class="tc tg">${p.pS}</td>
<td><div class="mb"><div class="mb-t"><div class="mb-f" style="width:${p.pC}%;background:${p.pC>=60?"#16a34a":p.pC>=40?"#d97706":"#dc2626"}"></div></div><span class="mb-l" style="color:${p.pC>=60?"#16a34a":p.pC>=40?"#d97706":"#dc2626"}">${p.pC}%</span></div></td>
</tr>`).join("")}</tbody></table></div>
${services.length>0?`<div class="sc nb"><div class="sc-t">Movimento por Hora</div><div class="hc">${hD.map(([h,c])=>{const ip=parseInt(h)===parseInt(pk?.[0])&&c>0;const bh=mH>0?Math.max((c/mH)*70,c>0?4:0):0;return`<div class="hcl"><div class="hct" style="opacity:${c>0?1:0}">${c>0?c:""}</div><div class="hbw"><div class="hb" style="height:${bh}px;background:${ip?"#e05c2d":c>0?"#374151":"#f3f4f6"}"></div></div><div class="hl" style="color:${ip?"#e05c2d":"#9ca3af"}">${h}h</div></div>`;}).join("")}</div><p style="font-size:11px;color:#9ca3af;margin-top:4px">Laranja = horário de pico</p></div>`:""}
<div class="sc nb"><div class="sc-t">Motivos de Não Venda</div>
${sR.length===0?'<p style="color:#9ca3af">Todos resultaram em venda!</p>':sR.map(([l,c])=>`<div class="rb"><div class="rn">${l}</div><div class="rt"><div class="rf" style="width:${Math.round((c/mR)*100)}%"></div></div><div class="rq">${c}</div><div class="rp">${nS.length?Math.round((c/nS.length)*100):0}%</div></div>`).join("")}
</div>
${queue.some(p=>p.breaks.length>0)?`<div class="sc nb"><div class="sc-t">Registro de Pausas</div><table><thead><tr><th>Funcionária</th><th>Pausa</th><th>Saída</th><th>Retorno</th><th>Duração</th></tr></thead><tbody>${queue.flatMap(p=>p.breaks.map((b,i)=>{const d=b.end?Math.round((new Date(b.end)-new Date(b.start))/60000):null;const ds=d!==null?(d>=60?`${Math.floor(d/60)}h ${d%60}m`:`${d} min`):"—";return`<tr><td class="tn">${p.name}</td><td class="td tc">${i+1}ª</td><td class="td">${fmtTime(b.start)}</td><td class="td">${b.end?fmtTime(b.end):"Em pausa"}</td><td class="td">${ds}</td></tr>`;})).join("")}</tbody></table></div>`:""}
<div class="sc"><div class="sc-t">Histórico — ${services.length} registro${services.length!==1?"s":""}</div>
${services.length===0?'<p style="color:#9ca3af">Nenhum atendimento.</p>':services.map(s=>`<div class="hi"><span class="ht2">${fmtTime(s.startTime)}</span><span class="hp">${s.salespersonName}</span><span class="ho" style="color:${s.isSale?"#15803d":"#dc2626"};font-weight:${s.isSale?600:400}">${s.outcomeLabel}</span></div>`).join("")}
</div>
<div class="ft"><span>${storeName} · ${gD}</span><span>Sistema de Atendimento · ${gT}</span></div>
</div></body></html>`;

  const w=window.open("","_blank");
  if(w){w.document.write(html);w.document.close();setTimeout(()=>w.print(),800);}
}

/* ══════════════════════════════════════════════════════
   DASHBOARD PDF EXPORT
══════════════════════════════════════════════════════ */
function exportDashPDF(data, from, to, storeNames) {
  const fmtD = iso => new Date(iso+"T00:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric"});
  const gT   = new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
  const maxR = data.sortedReasons[0]?.[1]||1;
  const maxSt= data.sortedStaff[0]?.sales||1;
  const maxSt2=data.sortedStores[0]?.sales||1;

  const html=`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Dashboard — ${storeNames.join(", ")}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;color:#111827;font-size:13px;line-height:1.5}
.pg{max-width:900px;margin:0 auto;padding:44px}
.rh{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:18px;border-bottom:3px solid #111827;margin-bottom:28px}
.rh h1{font-size:24px;font-weight:800}.rh .sub{font-size:13px;color:#6b7280;margin-top:3px}
.rh .mt{text-align:right;font-size:12px;color:#9ca3af;line-height:1.8}
.rh .mt strong{color:#111827;font-size:14px;display:block;font-weight:700}
.sc{margin-bottom:28px}.sc-t{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#9ca3af;margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid #f3f4f6}
.k4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.kp{border:1px solid #e5e7eb;border-radius:10px;padding:16px;background:#f9fafb;text-align:center}
.kp.dk{background:#111827;border-color:#111827}.kp.gr{background:#f0fdf4;border-color:#bbf7d0}
.kn{font-size:28px;font-weight:800;color:#111827;letter-spacing:-1px;line-height:1}
.kp.dk .kn{color:#fff}.kp.gr .kn{color:#15803d}
.kl{font-size:10px;color:#9ca3af;margin-top:4px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.bar-row{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.bar-label{flex:0 0 180px;font-size:12px;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar-track{flex:1;height:10px;background:#f3f4f6;border-radius:5px;overflow:hidden}
.bar-fill{height:100%;background:#e05c2d;border-radius:5px}
.bar-fill.green{background:#16a34a}
.bar-num{flex:0 0 28px;font-weight:700;font-size:12px;text-align:right}
.bar-pct{flex:0 0 36px;font-size:11px;color:#9ca3af;text-align:right}
.hc{display:flex;align-items:flex-end;gap:4px;height:80px;margin-bottom:6px}
.hcl{display:flex;flex-direction:column;align-items:center;gap:3px;flex:1}
.hbw{flex:1;display:flex;align-items:flex-end;width:100%}
.hb{width:100%;border-radius:3px 3px 0 0;min-height:2px}
.hl{font-size:9px;color:#9ca3af;white-space:nowrap}.hct{font-size:9px;font-weight:700;color:#6b7280}
table{width:100%;border-collapse:collapse}
thead th{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#9ca3af;padding:7px 10px;text-align:left;border-bottom:1px solid #e5e7eb}
tbody td{padding:8px 10px;border-bottom:1px solid #f3f4f6;vertical-align:middle}
tbody tr:last-child td{border-bottom:none}
.tn{font-weight:600;color:#111827}.tg{color:#15803d;font-weight:600}.td{color:#9ca3af;font-size:12px}.tc{text-align:center}
.mb{display:flex;align-items:center;gap:6px}.mb-t{flex:1;height:6px;background:#f3f4f6;border-radius:3px;overflow:hidden;min-width:60px}
.mb-f{height:100%;border-radius:3px}.mb-l{font-size:11px;font-weight:700;width:32px;text-align:right}
.ft{margin-top:36px;padding-top:12px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;color:#d1d5db;font-size:11px}
.nb{page-break-inside:avoid}
@media print{.pg{padding:24px};body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="pg">

<div class="rh">
  <div>
    <h1>📈 Dashboard de Atendimentos</h1>
    <div class="sub">${storeNames.join(" · ")} · ${fmtD(from)} a ${fmtD(to)}</div>
  </div>
  <div class="mt"><strong>Período Selecionado</strong>${fmtD(from)} – ${fmtD(to)}<br>Gerado às ${gT}</div>
</div>

<div class="sc nb"><div class="sc-t">Resumo Geral</div>
<div class="k4">
<div class="kp"><div class="kn">${data.totalSvc}</div><div class="kl">Atendimentos</div></div>
<div class="kp gr"><div class="kn">${data.totalSales}</div><div class="kl">Vendas</div></div>
<div class="kp dk"><div class="kn" style="color:${data.conv>=60?"#86efac":data.conv>=40?"#fde68a":"#fca5a5"}">${data.conv}%</div><div class="kl">Conversão</div></div>
<div class="kp"><div class="kn">${data.avgDur>0?data.avgDur+"'":"—"}</div><div class="kl">Tempo Médio</div></div>
</div></div>

${data.sortedStores.length>1?`
<div class="sc nb"><div class="sc-t">Comparativo por Loja</div>
<table><thead><tr><th>#</th><th>Loja</th><th class="tc">Atend.</th><th class="tc">Vendas</th><th style="min-width:120px">Conversão</th></tr></thead>
<tbody>${data.sortedStores.map((s,i)=>{
  const cc=s.conv>=60?"#16a34a":s.conv>=40?"#d97706":"#dc2626";
  return `<tr><td class="td">${i+1}</td><td class="tn">${s.name}</td><td class="tc">${s.svc}</td><td class="tc tg">${s.sales}</td>
  <td><div class="mb"><div class="mb-t"><div class="mb-f" style="width:${s.conv}%;background:${cc}"></div></div><span class="mb-l" style="color:${cc}">${s.conv}%</span></div></td></tr>`;
}).join("")}</tbody></table></div>`:""}

<div class="sc nb"><div class="sc-t">Movimento por Hora do Dia</div>
<div class="hc">${data.sortedHour.map(([h,c])=>{
  const ip=h===data.peakH?.[0]&&c>0;
  const bh=data.maxHour>0?Math.max((c/data.maxHour)*68,c>0?3:0):0;
  return `<div class="hcl"><div class="hct" style="opacity:${c>0?1:0}">${c>0?c:""}</div><div class="hbw"><div class="hb" style="height:${bh}px;background:${ip?"#e05c2d":c>0?"#374151":"#f3f4f6'}"></div></div><div class="hl" style="color:${ip?"#e05c2d":"#9ca3af"}">${h}h</div></div>`;
}).join("")}</div>
${data.peakH&&data.peakH[1]>0?`<p style="font-size:11px;color:#9ca3af;margin-top:4px">🔥 Pico: ${data.peakH[0]}h com ${data.peakH[1]} atendimento${data.peakH[1]!==1?"s":""}</p>`:""}
</div>

${data.sortedReasons.length>0?`
<div class="sc nb"><div class="sc-t">Motivos de Não Venda</div>
${(()=>{
  const total=data.sortedReasons.reduce((a,[,c])=>a+c,0);
  return data.sortedReasons.map(([label,cnt])=>`
<div class="bar-row">
  <div class="bar-label">${label}</div>
  <div class="bar-track"><div class="bar-fill" style="width:${Math.round((cnt/maxR)*100)}%"></div></div>
  <div class="bar-num">${cnt}</div>
  <div class="bar-pct">${Math.round((cnt/total)*100)}%</div>
</div>`).join("");
})()}</div>`:""}

${data.sortedStaff.length>0?`
<div class="sc nb"><div class="sc-t">Performance por Vendedora</div>
<table><thead><tr><th>#</th><th>Vendedora</th>${data.sortedStores.length>1?"<th>Loja</th>":""}<th class="tc">Atend.</th><th class="tc">Vendas</th><th style="min-width:110px">Conversão</th></tr></thead>
<tbody>${data.sortedStaff.map((p,i)=>{
  const cc=p.conv>=60?"#16a34a":p.conv>=40?"#d97706":"#dc2626";
  return `<tr><td class="td">${i===0?"★":i+1}</td><td class="tn">${p.name}</td>${data.sortedStores.length>1?`<td class="td">${p.store}</td>`:""}<td class="tc">${p.svc}</td><td class="tc tg">${p.sales}</td>
  <td><div class="mb"><div class="mb-t"><div class="mb-f" style="width:${p.conv}%;background:${cc}"></div></div><span class="mb-l" style="color:${cc}">${p.conv}%</span></div></td></tr>`;
}).join("")}</tbody></table></div>`:""}

<div class="ft">
  <span>Dashboard · ${storeNames.join(", ")} · ${fmtD(from)} a ${fmtD(to)}</span>
  <span>Gerado às ${gT}</span>
</div>
</div></body></html>`;

  const w=window.open("","_blank");
  if(w){w.document.write(html);w.document.close();setTimeout(()=>w.print(),800);}
}
