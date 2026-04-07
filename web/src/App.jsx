import { useState, useEffect, useCallback } from "react";

const OUTCOMES = [
  { id:"venda",       label:"Venda Realizada",     emoji:"🛍️", isSale:true,  color:"#22c55e" },
  { id:"troca",       label:"Troca Realizada",      emoji:"🔄", isSale:true,  color:"#3b82f6" },
  { id:"sem_produto", label:"Produto Indisponível", emoji:"📦", isSale:false, color:"#f59e0b" },
  { id:"sem_tamanho", label:"Sem o Tamanho",        emoji:"📏", isSale:false, color:"#f59e0b" },
  { id:"olhando",     label:"Estava Só Olhando",    emoji:"👀", isSale:false, color:"#9ca3af" },
  { id:"preco",       label:"Preço Elevado",        emoji:"💸", isSale:false, color:"#ef4444" },
  { id:"desistiu",    label:"Cliente Desistiu",     emoji:"🚶", isSale:false, color:"#9ca3af" },
  { id:"outro",       label:"Outro Motivo",         emoji:"📝", isSale:false, color:"#9ca3af" },
];

const C = {
  bg:"#130e0c", surface:"#2c1f1a", border:"#3d2a22", muted:"#a89880",
  accent:"#e05c2d", text:"#f5f0e8", green:"#22c55e", red:"#ef4444", yellow:"#f59e0b",
};

async function sget(key) {
  try { const r = await window.storage.get(key); return r ? JSON.parse(r.value) : null; }
  catch { return null; }
}
async function sset(key, val) {
  try { await window.storage.set(key, JSON.stringify(val)); } catch {}
}

const fmtTime  = iso => iso ? new Date(iso).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}) : "—";
const fmtDate  = d   => d.toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"});
const fmtClock = d   => d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
const fmtShort = iso => iso ? new Date(iso).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric"}) : "—";
const uid      = ()  => Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const cap      = s   => s.charAt(0).toUpperCase()+s.slice(1);

/* ── UI Primitives ─────────────────────────────────── */
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
      {screen==="login" && <LoginPage onStore={s=>{setStore(s);setScreen("store");}} onAdmin={()=>setScreen("admin")}/>}
      {screen==="store" && <StoreApp store={store} onLogout={()=>{setStore(null);setScreen("login");}}/>}
      {screen==="admin" && <AdminDashboard onLogout={()=>setScreen("login")}/>}
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
  const [firstRun,setFirstRun]     = useState(false);
  const [ready,setReady]           = useState(false);
  const [err,setErr]               = useState("");

  useEffect(()=>{
    (async()=>{
      const sl=await sget("stores"); setStores(sl||[]);
      const cfg=await sget("config_admin"); setFirstRun(!cfg?.pin);
      setReady(true);
    })();
  },[]);

  const loginStore=async()=>{
    setErr("");
    if(!storeId){setErr("Selecione uma loja.");return;}
    if(!pin){setErr("Digite o PIN.");return;}
    const s=stores.find(x=>x.id===storeId);
    if(!s||s.pin!==pin){setErr("PIN incorreto.");return;}
    onStore({id:s.id,name:s.name});
  };
  const loginAdmin=async()=>{
    setErr("");
    const cfg=await sget("config_admin");
    if(!cfg?.pin||cfg.pin!==adminPin){setErr("PIN incorreto.");return;}
    onAdmin();
  };
  const createPin=async()=>{
    if(newAdminPin.length<4){setErr("PIN deve ter pelo menos 4 dígitos.");return;}
    await sset("config_admin",{pin:newAdminPin});
    setFirstRun(false); setErr("✓ PIN criado! Faça login.");
  };

  if(!ready) return <div style={{minHeight:"100vh",background:C.bg}}/>;

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
          <div style={{display:"flex",background:C.surface,borderRadius:12,padding:4,marginBottom:20,border:`1px solid ${C.border}`}}>
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
            {tab==="store" && <>
              <p style={{color:C.muted,fontSize:13,marginBottom:18}}>Selecione a loja e insira o PIN</p>
              {stores.filter(s=>s.active!==false).length===0
                ? <p style={{color:C.muted,fontSize:14,lineHeight:1.7}}>Nenhuma loja cadastrada.<br/>Acesse como Administrador para criar.</p>
                : <>
                    <select value={storeId} onChange={e=>setStoreId(e.target.value)}
                      style={{display:"block",width:"100%",background:"#1a1210",border:`1px solid ${C.border}`,
                              borderRadius:10,padding:"13px 16px",fontSize:15,fontFamily:"inherit",marginBottom:14,cursor:"pointer"}}>
                      <option value="">Selecione a loja…</option>
                      {stores.filter(s=>s.active!==false).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <Inp type="password" placeholder="PIN da loja" value={pin}
                         onChange={e=>setPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&loginStore()}/>
                  </>}
              {err&&<p style={{color:"#f87171",fontSize:13,marginBottom:12}}>{err}</p>}
              <Btn variant="primary" style={{width:"100%"}}
                   disabled={stores.filter(s=>s.active!==false).length===0} onClick={loginStore}>Entrar →</Btn>
            </>}
            {tab==="admin" && (firstRun
              ? <>
                  <p style={{color:C.muted,fontSize:13,marginBottom:18,lineHeight:1.6}}>👋 Primeira vez — crie o PIN de administrador.</p>
                  <Inp type="password" placeholder="Criar PIN (mín. 4 dígitos)" value={newAdminPin}
                       onChange={e=>setNewAdminPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&createPin()}/>
                  {err&&<p style={{color:err.startsWith("✓")?"#22c55e":"#f87171",fontSize:13,marginBottom:12}}>{err}</p>}
                  <Btn variant="primary" style={{width:"100%"}} onClick={createPin}>Criar PIN →</Btn>
                </>
              : <>
                  <p style={{color:C.muted,fontSize:13,marginBottom:18}}>PIN de administrador</p>
                  <Inp type="password" placeholder="PIN de administrador" value={adminPin} autoFocus
                       onChange={e=>setAdminPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&loginAdmin()}/>
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
   Storage model:
   session_${id}  → { startedAt, queue, services }   ← active open day
   history_${id}  → [{ id, startedAt, closedAt, queue, services }, …]
══════════════════════════════════════════════════════ */
function StoreApp({store,onLogout}) {
  const [view,setView]               = useState("queue");
  const [session,setSession]         = useState(null);
  const [queue,setQueue]             = useState([]);
  const [services,setServices]       = useState([]);
  const [curSvc,setCurSvc]           = useState(null);
  const [showAdd,setShowAdd]         = useState(false);
  const [addName,setAddName]         = useState("");
  const [confirmEnd,setConfirmEnd]   = useState(null);
  const [confirmClose,setConfirmClose]=useState(false);
  const [now,setNow]                 = useState(new Date());
  const [ready,setReady]             = useState(false);

  const sKey = `session_${store.id}`;
  const hKey = `history_${store.id}`;

  useEffect(()=>{const t=setInterval(()=>setNow(new Date()),30000);return()=>clearInterval(t);},[]);

  useEffect(()=>{
    (async()=>{
      let sess=await sget(sKey);
      if(!sess){ sess={startedAt:new Date().toISOString(),queue:[],services:[]}; await sset(sKey,sess); }
      setSession(sess); setQueue(sess.queue||[]); setServices(sess.services||[]);
      setReady(true);
    })();
  },[store.id]);

  const persist=async(nq,ns)=>{
    const upd={...session,queue:nq??queue,services:ns??services};
    setSession(upd); await sset(sKey,upd);
  };

  // Close day → save to history, open fresh session
  const closeDay=async()=>{
    const hist=await sget(hKey)||[];
    await sset(hKey,[{id:uid(),startedAt:session.startedAt,closedAt:new Date().toISOString(),queue,services},...hist]);
    const newSess={startedAt:new Date().toISOString(),queue:[],services:[]};
    await sset(sKey,newSess);
    setSession(newSess); setQueue([]); setServices([]); setCurSvc(null);
    setConfirmClose(false); setView("queue");
  };

  const activeQ=()=>[...queue].filter(p=>p.status!=="done").sort((a,b)=>{
    if(a.status==="serving")return -1;if(b.status==="serving")return 1;
    if(a.status==="absent"&&b.status!=="absent")return 1;
    if(b.status==="absent"&&a.status!=="absent")return -1;
    return a.order-b.order;
  });
  const doneQ=()=>queue.filter(p=>p.status==="done");
  const nextP=()=>activeQ().find(p=>p.status==="waiting");
  const tSvc=services.length, tSales=services.filter(s=>s.isSale).length;
  const conv=tSvc>0?Math.round((tSales/tSvc)*100):0;

  const addPerson=async()=>{
    const name=addName.trim();if(!name)return;
    const nq=[...queue,{id:uid(),name,status:"waiting",entryTime:new Date().toISOString(),
                        breaks:[],exitTime:null,order:queue.filter(p=>p.status!=="done").length}];
    setQueue(nq); await persist(nq,null); setAddName(""); setShowAdd(false);
  };
  const newCustomer=async()=>{
    const next=activeQ().find(p=>p.status==="waiting");
    if(!next||curSvc)return;
    const sv={id:uid(),salespersonId:next.id,salespersonName:next.name,startTime:new Date().toISOString()};
    setCurSvc(sv);
    const nq=queue.map(p=>p.id===next.id?{...p,status:"serving"}:p);
    setQueue(nq); await persist(nq,null);
  };
  const finishService=async(outcomeId)=>{
    if(!curSvc)return;
    const info=OUTCOMES.find(o=>o.id===outcomeId);
    const ns=[...services,{...curSvc,endTime:new Date().toISOString(),outcome:outcomeId,outcomeLabel:info?.label,isSale:info?.isSale}];
    const maxOrd=Math.max(...queue.filter(q=>q.status!=="done").map(q=>q.order),0);
    const nq=queue.map(p=>p.id===curSvc.salespersonId?{...p,status:"waiting",order:maxOrd+1}:p);
    setQueue(nq); setServices(ns); setCurSvc(null); await persist(nq,ns);
  };
  const cancelService=async()=>{
    if(!curSvc)return;
    const nq=queue.map(p=>p.id===curSvc.salespersonId?{...p,status:"waiting"}:p);
    setQueue(nq); setCurSvc(null); await persist(nq,null);
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
      nq=queue.map(q=>q.id===id?{...q,status:"absent",breaks:[...q.breaks,{start:new Date().toISOString(),end:null}]}:q);
    }
    setQueue(nq); await persist(nq,null);
  };
  const endShift=async(id)=>{
    const nq=queue.map(p=>p.id===id?{...p,status:"done",exitTime:new Date().toISOString()}:p);
    setQueue(nq); setConfirmEnd(null); await persist(nq,null);
  };

  if(!ready) return <AppShell><div style={{padding:40,textAlign:"center",color:C.muted}}>Carregando…</div></AppShell>;

  const aq=activeQ(),dq=doneQ(),np=nextP();

  return (
    <AppShell>
      <Header title={store.name}
        sub={<>{cap(fmtDate(now))} <span style={{background:"#2c1f1a",padding:"2px 10px",borderRadius:20,fontWeight:500}}>{fmtClock(now)}</span></>}
        actions={<>
          {view==="queue"
            ?<Btn variant="ghost" onClick={()=>setView("report")}>📊 Relatório</Btn>
            :<Btn variant="ghost" onClick={()=>setView("queue")}>← Fila</Btn>}
          {view==="report"&&<>
            <Btn variant="accent" onClick={()=>exportPDF(store.name,queue,services,session?.startedAt)}>📄 PDF</Btn>
            <Btn variant="green" onClick={()=>setConfirmClose(true)}>🌙 Encerrar Dia</Btn>
          </>}
          {view==="queue"&&<Btn variant="accent" onClick={()=>setShowAdd(true)}>+ Entrada</Btn>}
          <Btn variant="ghost" onClick={onLogout} style={{padding:"9px 12px"}}>⎋</Btn>
        </>}
      />

      {/* Session info strip */}
      <div style={{margin:"12px 20px 0",padding:"10px 16px",background:"#1a1210",borderRadius:10,
                   fontSize:12,color:C.muted,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span>📅 Dia iniciado em {fmtShort(session?.startedAt)} às {fmtTime(session?.startedAt)}</span>
        {view==="queue"&&(
          <button onClick={()=>setView("report")}
            style={{background:"transparent",border:"none",color:C.accent,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
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
            style={{display:"flex",alignItems:"center",justifyContent:"center",gap:12,width:"100%",
                    background:C.accent,border:"none",borderRadius:14,padding:"20px 24px",color:"#fff",
                    fontSize:19,fontWeight:700,cursor:np&&!curSvc?"pointer":"not-allowed",
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
              <div style={{fontSize:13,opacity:.5,marginTop:6}}>Use "+ Entrada" para registrar o início do expediente</div>
            </div>
          )}
          {aq.map((p,i)=><PersonCard key={p.id} person={p} position={i+1} isNext={p.id===np?.id}
            onSkip={()=>skipTurn(p.id)} onAbsent={()=>toggleAbsent(p.id)} onEnd={()=>setConfirmEnd(p.id)}/>)}
          {dq.length>0&&<>
            <SecHead dim>Expediente Encerrado</SecHead>
            {dq.map(p=><PersonCard key={p.id} person={p} done/>)}
          </>}
        </div>
      </>}

      {/* Report */}
      {view==="report"&&<>
        <div style={{margin:"16px 20px",background:"#0d1f0d",border:"1px solid #22c55e44",borderRadius:14,
                     padding:"16px 20px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontWeight:700,color:C.green,fontSize:14}}>🌙 Encerrar o dia</div>
            <div style={{fontSize:12,color:C.muted,marginTop:2}}>Salva no histórico e zera para amanhã</div>
          </div>
          <Btn variant="green" onClick={()=>setConfirmClose(true)}>Encerrar Dia →</Btn>
        </div>
        <ReportView services={services} queue={queue} tSvc={tSvc} tSales={tSales} conv={conv}/>
      </>}

      {showAdd&&(
        <Overlay onClose={()=>setShowAdd(false)}>
          <div style={{fontSize:36,marginBottom:12}}>👋</div>
          <h2 style={{fontSize:20,fontWeight:700,marginBottom:8}}>Registrar Entrada</h2>
          <p style={{color:C.muted,fontSize:13,marginBottom:20}}>Adicionar à fila de atendimento</p>
          <Inp autoFocus value={addName} placeholder="Nome da funcionária…"
               onChange={e=>setAddName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addPerson()}/>
          <div style={{display:"flex",gap:8,marginTop:4,justifyContent:"flex-end"}}>
            <Btn variant="ghost" onClick={()=>setShowAdd(false)}>Cancelar</Btn>
            <Btn variant="primary" style={{width:"auto",padding:"10px 20px"}} onClick={addPerson}>Entrar na Fila →</Btn>
          </div>
        </Overlay>
      )}

      {curSvc&&(
        <Overlay closeable={false}>
          <div style={{fontSize:36,marginBottom:12}}>🤝</div>
          <h2 style={{fontSize:20,fontWeight:700,marginBottom:8}}>Resultado do Atendimento</h2>
          <p style={{color:C.muted,fontSize:13,marginBottom:20}}><strong>{curSvc.salespersonName}</strong> · {fmtTime(curSvc.startTime)}</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {OUTCOMES.map(o=>(
              <button key={o.id} onClick={()=>finishService(o.id)}
                style={{background:"#1a1210",border:`1px solid ${o.color}55`,borderRadius:12,
                        padding:"14px 10px",cursor:"pointer",display:"flex",flexDirection:"column",
                        alignItems:"center",gap:6,fontFamily:"inherit"}}>
                <span style={{fontSize:22}}>{o.emoji}</span>
                <span style={{fontSize:12,color:C.text,lineHeight:1.3,textAlign:"center"}}>{o.label}</span>
              </button>
            ))}
          </div>
          <Btn variant="ghost" style={{width:"100%",marginTop:12,fontSize:13}} onClick={cancelService}>← Cancelar (desfazer)</Btn>
        </Overlay>
      )}

      {confirmEnd&&(
        <Overlay onClose={()=>setConfirmEnd(null)}>
          <div style={{fontSize:36,marginBottom:12}}>🚪</div>
          <h2 style={{fontSize:20,fontWeight:700,marginBottom:8}}>Encerrar Expediente?</h2>
          <p style={{color:C.muted,fontSize:13,marginBottom:20}}>{queue.find(p=>p.id===confirmEnd)?.name} será removida da fila.</p>
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
            O relatório será salvo no histórico e a fila será zerada para o próximo dia.
          </p>
          <div style={{background:"#1a1210",borderRadius:10,padding:"12px 16px",marginBottom:20,fontSize:13}}>
            <div>📊 {tSvc} atendimento{tSvc!==1?"s":""} · {tSales} venda{tSales!==1?"s":""} · {conv}% conversão</div>
            <div style={{color:C.muted,marginTop:4,fontSize:12}}>Iniciado às {fmtTime(session?.startedAt)}</div>
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <Btn variant="ghost" onClick={()=>setConfirmClose(false)}>Cancelar</Btn>
            <Btn variant="green" onClick={closeDay}>✓ Confirmar Encerramento</Btn>
          </div>
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
  const [detailRec,setDetailRec]     = useState(null); // {storeName, record}
  const [histStore,setHistStore]     = useState(null);
  const [showAdd,setShowAdd]         = useState(false);
  const [newName,setNewName]         = useState("");
  const [newPin,setNewPin]           = useState("");
  const [editStore,setEditStore]     = useState(null);
  const [saving,setSaving]           = useState(false);
  const [now,setNow]                 = useState(new Date());

  useEffect(()=>{const t=setInterval(()=>setNow(new Date()),30000);return()=>clearInterval(t);},[]);

  const reload=useCallback(async()=>{
    const sl=await sget("stores")||[];
    setStores(sl);
    const sess={},hist={};
    for(const s of sl){
      sess[s.id]=await sget(`session_${s.id}`)||{queue:[],services:[]};
      hist[s.id]=await sget(`history_${s.id}`)||[];
    }
    setSessions(sess); setHistories(hist);
  },[]);

  useEffect(()=>{reload();},[reload]);

  const mx=sid=>{
    const d=sessions[sid]||{queue:[],services:[]};
    const sv=d.services||[],q=d.queue||[];
    const sa=sv.filter(s=>s.isSale).length;
    return{svc:sv.length,sales:sa,conv:sv.length>0?Math.round((sa/sv.length)*100):0,
           active:q.filter(p=>p.status!=="done").length,queue:q,services:sv,startedAt:d.startedAt};
  };

  const active=stores.filter(s=>s.active!==false);
  const allSvc  =active.reduce((a,s)=>a+(sessions[s.id]?.services||[]).length,0);
  const allSales=active.reduce((a,s)=>a+(sessions[s.id]?.services||[]).filter(x=>x.isSale).length,0);
  const allConv =allSvc>0?Math.round((allSales/allSvc)*100):0;

  const addStore=async()=>{
    if(!newName.trim()||!newPin.trim())return;
    setSaving(true);
    const sl=await sget("stores")||[];
    await sset("stores",[...sl,{id:uid(),name:newName.trim(),pin:newPin.trim(),active:true}]);
    setNewName("");setNewPin("");setShowAdd(false);setSaving(false);await reload();
  };
  const saveEdit=async()=>{
    if(!editStore)return;setSaving(true);
    const sl=await sget("stores")||[];
    await sset("stores",sl.map(s=>s.id===editStore.id?{...s,name:editStore.name,pin:editStore.pin}:s));
    setEditStore(null);setSaving(false);await reload();
  };
  const toggleActive=async(s)=>{
    const sl=await sget("stores")||[];
    await sset("stores",sl.map(x=>x.id===s.id?{...x,active:!x.active}:x));
    await reload();
  };

  // Drill into store's current session
  if(tab==="detail"&&detailStore){
    const m=mx(detailStore.id);
    return(
      <AppShell>
        <Header title={detailStore.name} sub={<>Dia atual · desde {fmtTime(m.startedAt)}</>}
          actions={<>
            <Btn variant="ghost" onClick={()=>setTab("overview")}>← Painel</Btn>
            <Btn variant="accent" onClick={()=>exportPDF(detailStore.name,m.queue,m.services,m.startedAt)}>📄 PDF</Btn>
          </>}
        />
        <StatsBar items={[{num:m.svc,label:"Atendimentos"},{num:m.sales,label:"Vendas",color:C.green},
          {num:`${m.conv}%`,label:"Conversão"},{num:m.active,label:"Em turno"}]}/>
        <ReportView services={m.services} queue={m.queue} tSvc={m.svc} tSales={m.sales} conv={m.conv}/>
      </AppShell>
    );
  }

  // Drill into a historical record
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
        <StatsBar items={[{num:ts,label:"Atendimentos"},{num:tsa,label:"Vendas",color:C.green},
          {num:`${cr}%`,label:"Conversão"},{num:q.length,label:"Funcionárias"}]}/>
        <ReportView services={sv} queue={q} tSvc={ts} tSales={tsa} conv={cr}/>
      </AppShell>
    );
  }

  return(
    <AppShell>
      <Header title="Painel Administrativo" sub={cap(fmtDate(now))}
        actions={<>
          <Btn variant="ghost" style={tab==="overview"?{borderColor:C.accent,color:C.accent}:{}} onClick={()=>setTab("overview")}>📊 Hoje</Btn>
          <Btn variant="ghost" style={tab==="history"?{borderColor:C.accent,color:C.accent}:{}} onClick={()=>setTab("history")}>📅 Histórico</Btn>
          <Btn variant="ghost" style={tab==="stores"?{borderColor:C.accent,color:C.accent}:{}} onClick={()=>setTab("stores")}>🏪 Lojas</Btn>
          <Btn variant="ghost" onClick={onLogout} style={{padding:"9px 12px"}}>⎋</Btn>
        </>}
      />

      {/* TODAY */}
      {tab==="overview"&&<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,margin:"20px 20px 0"}}>
          {[{num:active.length,label:"Lojas Ativas"},{num:allSvc,label:"Atendimentos"},
            {num:allSales,label:"Vendas",color:C.green},{num:`${allConv}%`,label:"Conversão"}]
            .map((s,i)=>(
            <div key={i} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:"16px 12px",textAlign:"center"}}>
              <div style={{fontSize:28,fontWeight:700,color:s.color||C.text}}>{s.num}</div>
              <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:".5px",marginTop:4}}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={{padding:"20px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <SecHead>Dias Abertos por Loja</SecHead>
            <Btn variant="sm" onClick={reload} style={{fontSize:12}}>↻ Atualizar</Btn>
          </div>
          {stores.length===0&&(
            <div style={{textAlign:"center",padding:"48px 20px",color:C.muted}}>
              <div style={{fontSize:36,marginBottom:12}}>🏪</div>
              Nenhuma loja cadastrada.
              <br/><Btn variant="accent" style={{display:"inline-block",marginTop:16}} onClick={()=>setTab("stores")}>Ir para Lojas →</Btn>
            </div>
          )}
          {stores.map(s=>{
            const m=mx(s.id);const cc=m.conv>=60?C.green:m.conv>=40?C.yellow:"#f87171";
            return(
              <div key={s.id} onClick={()=>{setDetailStore(s);setTab("detail");}}
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
                        ?<div style={{fontSize:12,color:C.muted,marginTop:2}}>🟢 {m.active} em turno · desde {fmtTime(m.startedAt)}</div>
                        :<div style={{fontSize:12,color:C.muted,marginTop:2}}>Sem atividade no momento</div>}
                  </div>
                  {m.svc>0&&(
                    <div style={{display:"flex",gap:20}}>
                      {[{val:m.svc,label:"Atend.",color:C.text},{val:m.sales,label:"Vendas",color:C.green},{val:`${m.conv}%`,label:"Conv.",color:cc}]
                        .map(({val,label,color})=>(
                          <div key={label} style={{textAlign:"center"}}>
                            <div style={{fontSize:22,fontWeight:700,color}}>{val}</div>
                            <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:".5px"}}>{label}</div>
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
          {stores.length===0&&<p style={{color:C.muted}}>Nenhuma loja cadastrada.</p>}
          {stores.every(s=>(histories[s.id]||[]).length===0)&&stores.length>0&&(
            <div style={{textAlign:"center",padding:"48px 20px",color:C.muted}}>
              <div style={{fontSize:36,marginBottom:12}}>📅</div>
              Nenhum dia encerrado ainda.<br/>
              <span style={{fontSize:13,opacity:.6}}>Os relatórios aparecerão aqui quando as lojas encerrarem o dia.</span>
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
                          borderRadius:12,padding:"14px 16px",cursor:"pointer",fontFamily:"inherit",color:C.text}}>
                  <div style={{fontWeight:700,fontSize:15}}>{s.name}</div>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:12,color:C.muted}}>{hist.length} dia{hist.length!==1?"s":""} encerrado{hist.length!==1?"s":""}</span>
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
                            <div style={{fontSize:12,color:C.muted,marginTop:2}}>{fmtTime(rec.startedAt)} – {fmtTime(rec.closedAt)}</div>
                          </div>
                          <div style={{display:"flex",gap:16}}>
                            {[{val:sv.length,label:"Atend.",color:C.text},{val:sa,label:"Vendas",color:C.green},{val:`${cr}%`,label:"Conv.",color:cc}]
                              .map(({val,label,color})=>(
                                <div key={label} style={{textAlign:"center"}}>
                                  <div style={{fontSize:18,fontWeight:700,color}}>{val}</div>
                                  <div style={{fontSize:10,color:C.muted,textTransform:"uppercase"}}>{label}</div>
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
      {tab==="stores"&&(
        <div style={{padding:"20px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div style={{fontWeight:600}}>Lojas ({stores.length})</div>
            <Btn variant="accent" onClick={()=>setShowAdd(true)}>+ Nova Loja</Btn>
          </div>
          {stores.length===0&&<div style={{textAlign:"center",padding:"36px",color:C.muted}}>Nenhuma loja ainda.</div>}
          {stores.map(s=>(
            <div key={s.id} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,
                                    padding:"14px 16px",marginBottom:8,opacity:s.active===false?.55:1}}>
              {editStore?.id===s.id
                ?<div>
                    <div style={{display:"flex",gap:8,marginBottom:8}}>
                      <Inp value={editStore.name} style={{marginBottom:0,flex:1}} onChange={e=>setEditStore({...editStore,name:e.target.value})} placeholder="Nome"/>
                      <Inp value={editStore.pin} style={{marginBottom:0,width:110}} onChange={e=>setEditStore({...editStore,pin:e.target.value})} placeholder="PIN"/>
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <Btn variant="ghost" onClick={()=>setEditStore(null)}>Cancelar</Btn>
                      <Btn variant="accent" disabled={saving} onClick={saveEdit}>{saving?"Salvando…":"Salvar"}</Btn>
                    </div>
                  </div>
                :<div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <div style={{fontWeight:600,fontSize:15}}>{s.name}</div>
                      <div style={{fontSize:12,color:C.muted,marginTop:2}}>
                        PIN: <code style={{background:"#1a1210",padding:"1px 8px",borderRadius:6,letterSpacing:2}}>{s.pin}</code>
                        {s.active===false&&<span style={{color:C.red,marginLeft:8}}>· Inativa</span>}
                        {(histories[s.id]||[]).length>0&&<span style={{marginLeft:8}}>· {(histories[s.id]||[]).length} dias no histórico</span>}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:6}}>
                      <Btn variant="sm" onClick={()=>setEditStore({id:s.id,name:s.name,pin:s.pin})}>✏️ Editar</Btn>
                      <Btn variant="sm" style={{color:s.active===false?C.green:C.yellow}} onClick={()=>toggleActive(s)}>
                        {s.active===false?"✓ Ativar":"⊘ Pausar"}
                      </Btn>
                    </div>
                  </div>
              }
            </div>
          ))}
        </div>
      )}

      {showAdd&&(
        <Overlay onClose={()=>setShowAdd(false)}>
          <div style={{fontSize:36,marginBottom:12}}>🏪</div>
          <h2 style={{fontSize:20,fontWeight:700,marginBottom:8}}>Nova Loja</h2>
          <p style={{color:C.muted,fontSize:13,marginBottom:20}}>Defina o nome e o PIN de acesso</p>
          <Inp autoFocus value={newName} placeholder="Nome da loja…" onChange={e=>setNewName(e.target.value)}/>
          <Inp value={newPin} placeholder="PIN (ex: 1234)" onChange={e=>setNewPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addStore()}/>
          <div style={{display:"flex",gap:8,marginTop:4,justifyContent:"flex-end"}}>
            <Btn variant="ghost" onClick={()=>setShowAdd(false)}>Cancelar</Btn>
            <Btn variant="primary" style={{width:"auto",padding:"10px 20px"}} disabled={saving} onClick={addStore}>
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
  const badge={waiting:isNext?"🎯 Próxima":`#${position}`,serving:"⚡ Atendendo",absent:"⏸ Ausente",
    done:`✓ Saiu ${fmtTime(p.exitTime)}`}[p.status]||`#${position}`;
  return(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                 background:C.surface,borderRadius:12,padding:"13px 14px",marginBottom:8,
                 borderLeft:`3px solid ${acc}`,gap:10,opacity:done?.45:1}}>
      <div style={{display:"flex",alignItems:"center",gap:12,flex:1,minWidth:0}}>
        <div style={{fontSize:11,fontWeight:700,padding:"4px 10px",borderRadius:20,
                     background:`${acc}22`,color:acc,whiteSpace:"nowrap",flexShrink:0}}>{badge}</div>
        <div>
          <div style={{fontSize:15,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.name}</div>
          <div style={{fontSize:11,color:C.muted,marginTop:2}}>
            Entrada {fmtTime(p.entryTime)}{p.breaks.length?` · ${p.breaks.length} pausa${p.breaks.length>1?"s":""}`:""}</div>
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
function ReportView({services,queue,tSvc,tSales,conv}){
  const nS=services.filter(s=>!s.isSale);
  const rC={};nS.forEach(s=>{rC[s.outcomeLabel]=(rC[s.outcomeLabel]||0)+1;});
  const sR=Object.entries(rC).sort((a,b)=>b[1]-a[1]);
  const mR=sR[0]?.[1]||1;
  return(
    <div style={{padding:"8px 20px 60px"}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,margin:"16px 0"}}>
        {[{n:tSvc,l:"Atendimentos",c:C.text},{n:tSales,l:"Vendas",c:C.green},{n:`${conv}%`,l:"Conversão",c:C.text}].map((s,i)=>(
          <div key={i} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:"20px 16px",textAlign:"center"}}>
            <div style={{fontSize:36,fontWeight:700,color:s.c}}>{s.n}</div>
            <div style={{fontSize:11,color:C.muted,textTransform:"uppercase",letterSpacing:".5px",marginTop:4}}>{s.l}</div>
          </div>
        ))}
      </div>
      <RSection title="Motivos de Não Venda">
        {sR.length===0?<p style={{color:C.muted,fontSize:13,textAlign:"center"}}>Nenhum registro</p>
          :sR.map(([label,cnt])=>(
            <div key={label} style={{marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:6}}>
                <span style={{color:"#d4c4b8"}}>{label}</span><span style={{fontWeight:600}}>{cnt}</span>
              </div>
              <div style={{height:6,background:"#1a1210",borderRadius:3,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${Math.round((cnt/mR)*100)}%`,background:C.accent,borderRadius:3}}/>
              </div>
            </div>
          ))}
      </RSection>
      <RSection title="Funcionárias">
        {queue.length===0?<p style={{color:C.muted,fontSize:13,textAlign:"center"}}>Nenhum registro</p>
          :queue.map(p=>{
            const ps=services.filter(s=>s.salespersonId===p.id),pv=ps.filter(s=>s.isSale).length;
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
        {services.length===0?<p style={{color:C.muted,fontSize:13,textAlign:"center"}}>Nenhum atendimento</p>
          :[...services].reverse().map(s=>(
            <div key={s.id} style={{display:"flex",gap:12,padding:"8px 0",borderBottom:`1px solid #2c201a`,alignItems:"center"}}>
              <span style={{fontSize:12,color:C.muted,flexShrink:0}}>{fmtTime(s.startTime)}</span>
              <span style={{fontSize:13,flex:1}}>{s.salespersonName}</span>
              <span style={{fontSize:12,color:s.isSale?C.green:"#f87171"}}>{s.outcomeLabel}</span>
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
  const dur=services.filter(s=>s.startTime&&s.endTime).map(s=>new Date(s.endTime)-new Date(s.startTime));
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
    const wm=Math.round((tM-bM)/60000),wS=Math.floor(wm/60)>0?`${Math.floor(wm/60)}h ${wm%60}m`:`${wm}m`;
    const bm=Math.round(bM/60000),bS=bm>0?(Math.floor(bm/60)>0?`${Math.floor(bm/60)}h ${bm%60}m`:`${bm}m`):"—";
    return{...p,ps,pS,pC,wS,bS};
  }).sort((a,b)=>b.pS-a.pS);
  const best=st.find(p=>p.pS>0),mSS=Math.max(...st.map(p=>p.pS),0);
  const gT=new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
  const ref=startedAt?new Date(startedAt):new Date();
  const gD=ref.toLocaleDateString("pt-BR",{day:"numeric",month:"long",year:"numeric"});
  const wD=ref.toLocaleDateString("pt-BR",{weekday:"long"});

  const html=`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Relatório — ${storeName}</title>
<style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',sans-serif;color:#111827;font-size:13px;line-height:1.5}
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
table{width:100%;border-collapse:collapse}thead th{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#9ca3af;padding:8px 10px;text-align:left;border-bottom:1px solid #e5e7eb}
tbody td{padding:9px 10px;border-bottom:1px solid #f3f4f6;vertical-align:middle}tbody tr:last-child td{border-bottom:none}
.tn{font-weight:600;color:#111827}.tg{color:#15803d;font-weight:600}.td{color:#9ca3af;font-size:12px}.tc{text-align:center}
.mb{display:flex;align-items:center;gap:8px}.mb-t{flex:1;height:6px;background:#f3f4f6;border-radius:3px;overflow:hidden;min-width:60px}
.mb-f{height:100%;border-radius:3px}.mb-l{font-size:11px;font-weight:700;width:32px;text-align:right}
.rb{display:flex;align-items:center;gap:10px;margin-bottom:8px}.rn{flex:0 0 160px;font-size:12px;color:#374151}
.rt{flex:1;height:10px;background:#f3f4f6;border-radius:5px;overflow:hidden}.rf{height:100%;background:#e05c2d;border-radius:5px}
.rq{flex:0 0 24px;font-weight:700;font-size:12px;text-align:right}.rp{flex:0 0 36px;font-size:11px;color:#9ca3af;text-align:right}
.hc{display:flex;align-items:flex-end;gap:5px;height:90px;margin-bottom:6px}
.hcl{display:flex;flex-direction:column;align-items:center;gap:3px;flex:1}
.hbw{flex:1;display:flex;align-items:flex-end;width:100%}.hb{width:100%;border-radius:3px 3px 0 0;min-height:2px}
.hl{font-size:9px;white-space:nowrap}.hct{font-size:9px;font-weight:700;color:#6b7280}
.hi{display:flex;gap:12px;align-items:center;padding:6px 0;border-bottom:1px solid #f9fafb;font-size:12px}.hi:last-child{border-bottom:none}
.ht2{color:#9ca3af;flex:0 0 42px}.hp{flex:1;font-weight:500}.ho{flex:0 0 150px;text-align:right;font-size:11px}
.ft{margin-top:40px;padding-top:14px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;color:#d1d5db;font-size:11px}
.nb{page-break-inside:avoid}@media print{.pg{padding:24px};body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="pg">
<div class="rh"><div><h1>Relatório de Atendimentos</h1><div class="st">${storeName}</div></div>
<div class="mt"><strong>${gD}</strong>${wD.charAt(0).toUpperCase()+wD.slice(1)}<br>Gerado às ${gT}</div></div>
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
<tbody>${st.map(p=>`<tr><td class="tn">${p.name}${p.pS===mSS&&mSS>0?" <span class='bd'>★</span>":""}</td><td class="td">${fmtTime(p.entryTime)}</td><td class="td">${p.exitTime?fmtTime(p.exitTime):"—"}</td><td class="td">${p.wS}</td><td class="td">${p.bS}</td><td class="tc" style="font-weight:600">${p.ps.length}</td><td class="tc tg">${p.pS}</td><td><div class="mb"><div class="mb-t"><div class="mb-f" style="width:${p.pC}%;background:${p.pC>=60?"#16a34a":p.pC>=40?"#d97706":"#dc2626"}"></div></div><span class="mb-l" style="color:${p.pC>=60?"#16a34a":p.pC>=40?"#d97706":"#dc2626"}">${p.pC}%</span></div></td></tr>`).join("")}</tbody></table></div>
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
