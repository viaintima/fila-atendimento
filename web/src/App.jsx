import { useState, useEffect, useCallback } from "react";
import {
  doc, collection, onSnapshot, setDoc, getDoc,
  getDocs, serverTimestamp, query, orderBy,
} from "firebase/firestore";
import { db } from "./firebase.js";

const VI = {
  blush:     "#F2B5C0",
  terra:     "#B5706A",
  cream:     "#F5EDE8",
  carvao:    "#2C2020",
  gold:      "#C9A84C",
  bg:        "#FAF5F2",
  surface:   "#FFFFFF",
  surfaceAlt:"#FDF0EC",
  border:    "#EDD9D3",
  muted:     "#9E7E78",
  green:     "#2D7A4F",
  greenBg:   "#E8F5EE",
  red:       "#B83232",
  redBg:     "#FBEEEE",
  yellow:    "#A07820",
  yellowBg:  "#FDF6E3",
};

const MAIN_OUTCOMES = [
  { id:"venda",      label:"Venda Realizada", isSale:true,  color:"#2D7A4F" },
  { id:"troca",      label:"Troca Realizada", isSale:true,  color:"#2563eb" },
  { id:"nao_vendeu", label:"Não Vendeu",      isSale:false, color:"#B83232" },
];
const SUB_OUTCOMES = [
  { id:"reservou",    label:"Reservou para outro dia", detail:false },
  { id:"preco",       label:"Preço Elevado",           detail:false },
  { id:"sem_peca",    label:"Não tinha a peça",        detail:true, detailLabel:"Qual peça?" },
  { id:"sem_tamanho", label:"Não tinha o tamanho",     detail:false },
  { id:"sem_cor",     label:"Não tinha a cor",         detail:false },
  { id:"olhando",     label:"Estava só olhando",       detail:false },
  { id:"outro",       label:"Outro Motivo",            detail:true, detailLabel:"Especifique" },
];

const fmtTime  = iso => iso ? new Date(iso).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}) : "—";
const fmtDate  = d   => d.toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"});
const fmtClock = d   => d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
const fmtShort = iso => iso ? new Date(iso).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric"}) : "—";
const uid      = ()  => Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const cap      = s   => s.charAt(0).toUpperCase()+s.slice(1);
const ini      = n   => n.trim().split(" ").map(w=>w[0]).slice(0,2).join("").toUpperCase();

const storeRef   = id => doc(db,"stores",id);
const sessionRef = id => doc(db,"sessions",id);
const adminRef   = ()  => doc(db,"config","admin");
const supervisaoRef = () => doc(db,"config","supervisao");
const historyCol = id => collection(db,"history",id,"days");
const histDayRef = (s,d) => doc(db,"history",s,"days",d);
const demandsRef = id => doc(db,"demands",id);

// ──────────────────────────────────────────
// Tarefas com SLA — checklist de abertura/fechamento + demandas avulsas
// da Supervisão. Ver Especificação_Funcional_Checklist_Inteligente v3.
// ──────────────────────────────────────────
const DEMAND_TYPES = {
  ABERTURA:   { label:"Abertura",   icon:"sun",  color:VI.gold,  bg:VI.yellowBg },
  FECHAMENTO: { label:"Fechamento", icon:"moon", color:VI.terra, bg:VI.surfaceAlt },
  AVULSA:     { label:"Avulsa",     icon:"bell", color:VI.terra, bg:`${VI.blush}40` },
};
const TASK_STATUS = {
  PENDENTE:              { label:"Pendente",                     color:VI.muted, bg:VI.surfaceAlt },
  CONCLUIDA_NO_PRAZO:    { label:"Concluída",                     color:VI.green, bg:VI.greenBg },
  CONCLUIDA_ATRASADA:    { label:"Concluída (atrasada)",          color:VI.yellow, bg:VI.yellowBg },
  ATRASADA:              { label:"Atrasada",                      color:VI.red, bg:VI.redBg },
  ESCALADA:              { label:"Escalada · supervisão avisada", color:VI.red, bg:VI.redBg },
};
// Regras de pontuação — espelham a spec v3, §7 (gamificação por tarefa)
const TASK_SCORE = { ON_TIME:10, QUALITY_BONUS:5, LATE:2, PERFECT:15 };
// Prazo (min a partir da abertura) das tarefas de abertura — spec v3, §4
const ABERTURA_SLA_MIN = { LIMPEZA:30, CAIXA:30 };
// Escala de horário de fechamento por loja — ajuste aqui conforme a escala real.
const STORE_CLOSING_HOUR = {
  "centro": 19,
  "shopping icaraí": 19,
  "shopping icarai": 19,
  "center iv": 22,
  "itaipu": 22,
};
const getClosingHour = (storeName="") => STORE_CLOSING_HOUR[storeName.trim().toLowerCase()] ?? 21; // padrão se a loja não estiver na escala

// Menu rápido de demandas avulsas — o dia a dia que a Supervisão manda,
// além das 4 tarefas principais automáticas. Pode ser designado a uma
// vendedora específica ou deixado aberto à loja.
const QUICK_TASKS = [
  { title:"Arrumar sua seção",        description:"Organizar a seção de responsabilidade da vendedora." },
  { title:"Arrumar frente de loja",   description:"Organizar vitrine, entrada e fachada da loja." },
  { title:"Troca de vitrine",         description:"Trocar a vitrine conforme orientação da campanha." },
  { title:"Limpeza de estoque",       description:"Limpeza e organização da área de estoque." },
  { title:"Limpeza da copa",          description:"Limpeza da copa/área de descanso da equipe." },
  { title:"Limpeza do banheiro",      description:"Limpeza do banheiro da loja." },
  { title:"Reposição direcionada",    description:"Repor os itens indicados pela Supervisão." },
  { title:"Comunicado de campanha",   description:"Repassar a informação da campanha vigente para a equipe." },
];

const fmtCountdown = (dueAt,now) => {
  const m=Math.round((new Date(dueAt)-now)/60000);
  return m>=0?`vence em ${m}min`:`atrasado há ${Math.abs(m)}min`;
};
const fmtElapsed = (sinceAt,now) => `solicitada há ${Math.max(0,Math.round((now-new Date(sinceAt))/60000))}min`;

// Semeia o checklist fixo do dia — as tarefas principais, automáticas.
// Tudo o mais (vitrine, seção, limpeza pontual etc.) é demanda avulsa
// criada pela Supervisão em SupervisaoDashboard. Nenhuma tarefa passa por
// aprovação — a loja marca como realizada e ela fecha na hora.
function seedDemandsFromOpening(openingIso,storeName){
  const min=60000, opening=new Date(openingIso).getTime();
  const closingHour=getClosingHour(storeName);
  const dayRef=new Date(openingIso);
  const at=(h,m=0)=>{const d=new Date(dayRef);d.setHours(h,m,0,0);return d.toISOString();};
  const blank={assignedTo:null,sentBy:null,note:"",pointsAwarded:0,completedBy:null,status:"PENDENTE",createdAt:openingIso,completedAt:null};
  return [
    { id:uid(), code:"LIMPEZA",           type:"ABERTURA",   title:"Limpeza da loja",              description:"Piso, vitrine e provadores limpos antes da abertura.", dueAt:new Date(opening+ABERTURA_SLA_MIN.LIMPEZA*min).toISOString(), ...blank },
    { id:uid(), code:"CAIXA_ABERTURA",    type:"ABERTURA",   title:"Caixa conferido — Abertura",   description:"Fundo de caixa contado e registrado na abertura.",     dueAt:new Date(opening+ABERTURA_SLA_MIN.CAIXA*min).toISOString(),   ...blank },
    { id:uid(), code:"PARCIAL",           type:"FECHAMENTO", title:"Envio de Parcial",             description:"Enviar o parcial do dia para a Supervisão.",           dueAt:at(16,0), ...blank },
    { id:uid(), code:"CAIXA_FECHAMENTO",  type:"FECHAMENTO", title:"Caixa conferido — Fechamento", description:"Fundo de caixa contado e registrado no fechamento.",   dueAt:at(closingHour,0), ...blank },
    { id:uid(), code:"FECHAMENTO",        type:"FECHAMENTO", title:"Envio de Fechamento",          description:`Enviar o fechamento do dia (escala desta loja: ${closingHour}h).`, dueAt:at(closingHour,0), ...blank },
  ];
}

const Icon = ({ name, size=16, color="currentColor", sw=1.5 }) => {
  const p = {
    plus:    <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    x:       <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    check:   <polyline points="20 6 9 17 4 12"/>,
    back:    <><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></>,
    chevR:   <polyline points="9 18 15 12 9 6"/>,
    chevD:   <polyline points="6 9 12 15 18 9"/>,
    chart:   <><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>,
    print:   <><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></>,
    user:    <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
    users:   <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
    store:   <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
    clock:   <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>,
    logout:  <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
    skip:    <><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></>,
    pause:   <><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></>,
    play:    <polygon points="5 3 19 12 5 21 5 3"/>,
    edit:    <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
    bell:    <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>,
    moon:    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>,
    sun:     <><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/></>,
    settings:<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
    cal:     <><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>,
    trend:   <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></>,
    star:    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>,
    list:    <><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></>,
  };
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
      style={{display:"inline-block",verticalAlign:"middle",flexShrink:0}}>
      {p[name]}
    </svg>
  );
};

const VILogo = ({ size=28, color=VI.terra }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="20" r="8" stroke={color} strokeWidth="1.2"/>
    {[0,60,120].map(deg=>{const r=deg*Math.PI/180;return(
      <line key={deg} x1={20+18*Math.cos(r)} y1={20+18*Math.sin(r)}
            x2={20-18*Math.cos(r)} y2={20-18*Math.sin(r)} stroke={color} strokeWidth="1.2"/>
    );})}
    <text x="20" y="24.5" textAnchor="middle" fill={color}
      style={{fontSize:9,fontFamily:"Georgia,serif",letterSpacing:"0.05em"}}>VI</text>
  </svg>
);

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&display=swap');
  *{font-family:'DM Sans',sans-serif;box-sizing:border-box;-webkit-font-smoothing:antialiased;}
  input::placeholder{color:${VI.muted};}
  input:focus{border-color:${VI.terra}!important;box-shadow:0 0 0 3px ${VI.blush}40!important;outline:none;}
  button:hover:not(:disabled){opacity:.86;}
  button:active:not(:disabled){transform:scale(.97);}
  button:disabled{opacity:.4;cursor:not-allowed;}
  select{appearance:auto;}
  ::-webkit-scrollbar{width:4px;}
  ::-webkit-scrollbar-thumb{background:${VI.border};border-radius:99px;}
  @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
  @keyframes spin{to{transform:rotate(360deg)}}
  .fi{animation:fadeIn .2s ease forwards;}
  input[type=date]{color-scheme:light;}
`;

const Inp = ({style={},...p}) => (
  <input style={{display:"block",width:"100%",background:VI.cream,border:`1px solid ${VI.border}`,
    borderRadius:8,padding:"11px 14px",color:VI.carvao,fontSize:14,fontFamily:"inherit",
    marginBottom:12,outline:"none",boxSizing:"border-box",transition:"border-color .2s,box-shadow .2s",...style}} {...p}/>
);

const Btn = ({variant="primary",style={},...p}) => {
  const vs = {
    primary: {background:VI.terra,border:"none",color:"#fff",padding:"12px 20px",fontSize:14,fontWeight:600,borderRadius:8},
    ghost:   {background:"transparent",border:`1px solid ${VI.border}`,color:VI.muted,padding:"9px 14px",fontSize:13,borderRadius:8},
    accent:  {background:VI.terra,border:"none",color:"#fff",padding:"9px 14px",fontSize:13,fontWeight:600,borderRadius:8},
    danger:  {background:VI.red,border:"none",color:"#fff",padding:"9px 14px",fontSize:13,fontWeight:600,borderRadius:8},
    success: {background:VI.green,border:"none",color:"#fff",padding:"9px 14px",fontSize:13,fontWeight:600,borderRadius:8},
    dark:    {background:VI.carvao,border:"none",color:VI.cream,padding:"9px 14px",fontSize:13,fontWeight:600,borderRadius:8},
    sm:      {background:"transparent",border:`1px solid ${VI.border}`,color:VI.muted,padding:"5px 10px",fontSize:11,borderRadius:6},
  };
  return <button style={{cursor:"pointer",fontFamily:"inherit",transition:"all .15s",...(vs[variant]||{}),...style}} {...p}/>;
};

const Modal = ({children,onClose,closeable=true}) => (
  <div onClick={closeable?onClose:undefined}
    style={{position:"fixed",inset:0,background:"rgba(44,32,32,.5)",backdropFilter:"blur(3px)",
            display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:20}}>
    <div onClick={e=>e.stopPropagation()}
      style={{background:VI.surface,border:`1px solid ${VI.border}`,borderRadius:16,padding:"30px 26px",
              maxWidth:460,width:"100%",position:"relative",maxHeight:"90vh",overflowY:"auto",
              boxShadow:"0 24px 48px rgba(44,32,32,.18)"}}>
      {closeable&&<button onClick={onClose}
        style={{position:"absolute",top:12,right:12,background:"none",border:"none",
                cursor:"pointer",padding:6,borderRadius:6,color:VI.muted,display:"flex"}}>
        <Icon name="x" size={14} color={VI.muted}/>
      </button>}
      {children}
    </div>
  </div>
);

const MIcon = ({name,color=VI.terra,bg}) => (
  <div style={{width:44,height:44,background:bg||`${VI.blush}40`,borderRadius:10,
               display:"flex",alignItems:"center",justifyContent:"center",marginBottom:14}}>
    <Icon name={name} size={20} color={color}/>
  </div>
);

const AppShell = ({children}) => (
  <div style={{minHeight:"100vh",background:VI.bg,color:VI.carvao}}>
    <style>{CSS}</style>
    <div style={{maxWidth:640,margin:"0 auto",paddingBottom:80}}>{children}</div>
  </div>
);

const Topbar = ({title,sub,actions}) => (
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
               padding:"16px 22px 12px",borderBottom:`1px solid ${VI.border}`,
               flexWrap:"wrap",gap:10,background:VI.surface,position:"sticky",top:0,zIndex:10}}>
    <div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <VILogo size={20}/>
        <span style={{fontSize:17,fontWeight:600,color:VI.carvao,letterSpacing:"-0.01em"}}>{title}</span>
      </div>
      <div style={{fontSize:12,color:VI.muted,marginTop:2,display:"flex",alignItems:"center",gap:5}}>{sub}</div>
    </div>
    <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>{actions}</div>
  </div>
);

const StatsRow = ({items}) => (
  <div style={{display:"flex",borderBottom:`1px solid ${VI.border}`,background:VI.surface}}>
    {items.map((s,i)=>(
      <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",
                            padding:"12px 6px",borderRight:i<items.length-1?`1px solid ${VI.border}`:"none"}}>
        <span style={{fontSize:22,fontWeight:700,letterSpacing:"-0.03em",color:s.color||VI.carvao,lineHeight:1}}>{s.num}</span>
        <span style={{fontSize:10,color:VI.muted,textTransform:"uppercase",letterSpacing:"0.05em",marginTop:4}}>{s.label}</span>
      </div>
    ))}
  </div>
);

const RSection = ({title,children}) => (
  <div style={{background:VI.surface,border:`1px solid ${VI.border}`,borderRadius:12,padding:18,marginTop:12}}>
    <div style={{fontSize:10,color:VI.muted,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600,marginBottom:14}}>
      {title}
    </div>
    {children}
  </div>
);
export default function App() {
  const [screen,setScreen]=useState("login");
  const [store,setStore]=useState(null);
  return (<>
    {screen==="login"&&<LoginPage onStore={s=>{setStore(s);setScreen("store");}} onAdmin={()=>setScreen("admin")} onSupervisao={()=>setScreen("supervisao")}/>}
    {screen==="store"&&<StoreApp store={store} onLogout={()=>{setStore(null);setScreen("login");}}/>}
    {screen==="admin"&&<AdminDashboard onLogout={()=>setScreen("login")}/>}
    {screen==="supervisao"&&<SupervisaoDashboard onLogout={()=>setScreen("login")}/>}
  </>);
}

function LoginPage({onStore,onAdmin,onSupervisao}) {
  const [tab,setTab]=useState("store");
  const [stores,setStores]=useState([]);
  const [storeId,setStoreId]=useState("");
  const [pin,setPin]=useState("");
  const [adminPin,setAdminPin]=useState("");
  const [newAdminPin,setNewAdminPin]=useState("");
  const [firstRun,setFirstRun]=useState(null);
  const [supPin,setSupPin]=useState("");
  const [newSupPin,setNewSupPin]=useState("");
  const [firstRunSup,setFirstRunSup]=useState(null);
  const [err,setErr]=useState("");
  const [busy,setBusy]=useState(false);

  useEffect(()=>{
    const u=onSnapshot(collection(db,"stores"),snap=>{
      setStores(snap.docs.map(d=>({id:d.id,...d.data()})).filter(s=>s.active!==false).sort((a,b)=>a.name.localeCompare(b.name)));
    });
    return()=>u();
  },[]);
  useEffect(()=>{getDoc(adminRef()).then(d=>setFirstRun(!d.exists()));},[]);
  useEffect(()=>{getDoc(supervisaoRef()).then(d=>setFirstRunSup(!d.exists()));},[]);

  const loginStore=async()=>{
    setErr("");setBusy(true);
    if(!storeId){setErr("Selecione uma loja.");setBusy(false);return;}
    if(!pin){setErr("Digite o PIN.");setBusy(false);return;}
    const snap=await getDoc(storeRef(storeId));
    if(!snap.exists()||snap.data().pin!==pin){setErr("PIN incorreto.");setBusy(false);return;}
    onStore({id:storeId,name:snap.data().name});
  };
  const loginAdmin=async()=>{
    setErr("");setBusy(true);
    if(!adminPin){setErr("Digite o PIN.");setBusy(false);return;}
    const snap=await getDoc(adminRef());
    if(!snap.exists()||snap.data().pin!==adminPin){setErr("PIN incorreto.");setBusy(false);return;}
    onAdmin();
  };
  const createPin=async()=>{
    if(newAdminPin.length<4){setErr("PIN deve ter pelo menos 4 dígitos.");return;}
    await setDoc(adminRef(),{pin:newAdminPin}); onAdmin();
  };
  const loginSupervisao=async()=>{
    setErr("");setBusy(true);
    if(!supPin){setErr("Digite o PIN.");setBusy(false);return;}
    const snap=await getDoc(supervisaoRef());
    if(!snap.exists()||snap.data().pin!==supPin){setErr("PIN incorreto.");setBusy(false);return;}
    onSupervisao();
  };
  const createSupPin=async()=>{
    if(newSupPin.length<4){setErr("PIN deve ter pelo menos 4 dígitos.");return;}
    await setDoc(supervisaoRef(),{pin:newSupPin}); onSupervisao();
  };

  if(firstRun===null||firstRunSup===null) return (
    <div style={{minHeight:"100vh",background:VI.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <style>{CSS}</style>
      <div style={{width:24,height:24,border:`2px solid ${VI.border}`,borderTopColor:VI.terra,borderRadius:"50%",animation:"spin .7s linear infinite"}}/>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:VI.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <style>{CSS}</style>
      <div style={{width:"100%",maxWidth:400}} className="fi">
        <div style={{textAlign:"center",marginBottom:32}}>
          <VILogo size={52} color={VI.terra}/>
          <h1 style={{fontSize:20,fontWeight:300,letterSpacing:"0.14em",color:VI.carvao,marginTop:14,textTransform:"uppercase",fontFamily:"Georgia,serif"}}>
            Via Íntima
          </h1>
          <p style={{color:VI.muted,fontSize:12,marginTop:4,letterSpacing:"0.04em"}}>Sistema de Atendimento</p>
        </div>

        <div style={{display:"flex",background:VI.surface,borderRadius:10,padding:3,marginBottom:18,border:`1px solid ${VI.border}`}}>
          {[["store","Loja"],["supervisao","Supervisão"],["admin","Administrador"]].map(([t,l])=>(
            <button key={t} onClick={()=>{setTab(t);setErr("");}}
              style={{flex:1,padding:"10px 0",border:"none",borderRadius:8,fontFamily:"inherit",fontSize:13,fontWeight:500,cursor:"pointer",
                      background:tab===t?VI.terra:"transparent",color:tab===t?"#fff":VI.muted,transition:"all .2s"}}>
              {l}
            </button>
          ))}
        </div>

        <div style={{background:VI.surface,border:`1px solid ${VI.border}`,borderRadius:14,padding:"26px 24px",boxShadow:"0 2px 12px rgba(44,32,32,.06)"}}>
          {tab==="store"&&<>
            <p style={{color:VI.muted,fontSize:13,marginBottom:16}}>Selecione a loja e insira o PIN</p>
            {stores.length===0
              ?<p style={{color:VI.muted,fontSize:13,textAlign:"center",padding:"16px 0",lineHeight:1.7}}>
                 Nenhuma loja cadastrada.<br/><span style={{fontSize:12,opacity:.7}}>Acesse como Administrador.</span>
               </p>
              :<>
                <select value={storeId} onChange={e=>setStoreId(e.target.value)}
                  style={{display:"block",width:"100%",background:VI.cream,border:`1px solid ${VI.border}`,
                          borderRadius:8,padding:"11px 14px",fontSize:14,fontFamily:"inherit",marginBottom:12,
                          cursor:"pointer",color:storeId?VI.carvao:VI.muted}}>
                  <option value="">Selecione a loja</option>
                  {stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <Inp type="password" placeholder="PIN da loja" value={pin}
                     onChange={e=>setPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&loginStore()}/>
              </>}
            {err&&<p style={{color:VI.red,fontSize:12,marginBottom:10}}>{err}</p>}
            <Btn variant="primary" style={{width:"100%"}} disabled={stores.length===0||busy} onClick={loginStore}>
              {busy?"Verificando…":"Entrar"}
            </Btn>
          </>}
          {tab==="supervisao"&&(firstRunSup
            ?<>
               <p style={{color:VI.muted,fontSize:13,marginBottom:16,lineHeight:1.6}}>Primeira vez — crie o PIN de supervisão.</p>
               <Inp type="password" placeholder="Criar PIN (mín. 4 dígitos)" value={newSupPin}
                    onChange={e=>setNewSupPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&createSupPin()}/>
               {err&&<p style={{color:VI.red,fontSize:12,marginBottom:10}}>{err}</p>}
               <Btn variant="primary" style={{width:"100%"}} onClick={createSupPin}>Criar PIN e entrar</Btn>
             </>
            :<>
               <p style={{color:VI.muted,fontSize:13,marginBottom:16}}>PIN de supervisão</p>
               <Inp type="password" placeholder="PIN de supervisão" value={supPin} autoFocus
                    onChange={e=>setSupPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&loginSupervisao()}/>
               {err&&<p style={{color:VI.red,fontSize:12,marginBottom:10}}>{err}</p>}
               <Btn variant="primary" style={{width:"100%"}} disabled={busy} onClick={loginSupervisao}>
                 {busy?"Verificando…":"Acessar painel"}
               </Btn>
             </>
          )}
          {tab==="admin"&&(firstRun
            ?<>
               <p style={{color:VI.muted,fontSize:13,marginBottom:16,lineHeight:1.6}}>Primeira vez — crie o PIN de administrador.</p>
               <Inp type="password" placeholder="Criar PIN (mín. 4 dígitos)" value={newAdminPin}
                    onChange={e=>setNewAdminPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&createPin()}/>
               {err&&<p style={{color:VI.red,fontSize:12,marginBottom:10}}>{err}</p>}
               <Btn variant="primary" style={{width:"100%"}} onClick={createPin}>Criar PIN e entrar</Btn>
             </>
            :<>
               <p style={{color:VI.muted,fontSize:13,marginBottom:16}}>PIN de administrador</p>
               <Inp type="password" placeholder="PIN de administrador" value={adminPin} autoFocus
                    onChange={e=>setAdminPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&loginAdmin()}/>
               {err&&<p style={{color:VI.red,fontSize:12,marginBottom:10}}>{err}</p>}
               <Btn variant="primary" style={{width:"100%"}} disabled={busy} onClick={loginAdmin}>
                 {busy?"Verificando…":"Acessar painel"}
               </Btn>
             </>
          )}
        </div>
        <p style={{textAlign:"center",color:VI.muted,fontSize:11,marginTop:18,opacity:.5}}>Via Íntima · Sistema de Atendimento</p>
      </div>
    </div>
  );
}
function StoreApp({store,onLogout}) {
  const [view,setView]=useState("queue");
  const [session,setSession]=useState(null);
  const [queue,setQueue]=useState([]);
  const [services,setServices]=useState([]);
  const [curSvc,setCurSvc]=useState(null);
  const [step,setStep]=useState("main");
  const [subD,setSubD]=useState("");
  const [showAdd,setShowAdd]=useState(false);
  const [addPersonId,setAddPersonId]=useState("");
  const [roster,setRoster]=useState([]);
  const [confEnd,setConfEnd]=useState(null);
  const [confClose,setConfClose]=useState(false);
  const [editSvc,setEditSvc]=useState(null);
  const [editStep,setEditStep]=useState("main");
  const [editSubD,setEditSubD]=useState("");
  const [now,setNow]=useState(new Date());
  const [ready,setReady]=useState(false);
  const [demands,setDemands]=useState([]);
  const [demandsReady,setDemandsReady]=useState(false);
  const [activeTask,setActiveTask]=useState(null);
  const [taskNote,setTaskNote]=useState("");
  const [taskWho,setTaskWho]=useState("");
  const [taskBonus,setTaskBonus]=useState({ABERTURA:false,FECHAMENTO:false});

  useEffect(()=>{const t=setInterval(()=>setNow(new Date()),30000);return()=>clearInterval(t);},[]);
  useEffect(()=>{
    const u=onSnapshot(storeRef(store.id),snap=>{
      if(snap.exists())setRoster(snap.data().roster||[]);
    });
    return()=>u();
  },[store.id]);
  useEffect(()=>{
    const u=onSnapshot(demandsRef(store.id),snap=>{
      setDemands(snap.exists()?(snap.data().items||[]):[]);
      setDemandsReady(true);
    });
    return()=>u();
  },[store.id]);
  useEffect(()=>{
    const u=onSnapshot(sessionRef(store.id),snap=>{
      if(snap.exists()){const d=snap.data();if(d.startedAt){setSession(d);setQueue(d.queue||[]);setServices(d.services||[]);}else{setSession(null);setQueue([]);setServices([]);}}
      else{setSession(null);setQueue([]);setServices([]);}
      setReady(true);
    });
    return()=>u();
  },[store.id]);

  const persist=async(nq,ns,fs)=>{
    await setDoc(sessionRef(store.id),{startedAt:fs||session?.startedAt||new Date().toISOString(),queue:nq??queue,services:ns??services,updatedAt:serverTimestamp()});
  };
  const closeDay=async()=>{
    await setDoc(histDayRef(store.id,uid()),{startedAt:session?.startedAt||new Date().toISOString(),closedAt:new Date().toISOString(),queue,services,demands});
    await setDoc(sessionRef(store.id),{startedAt:null,queue:[],services:[],updatedAt:serverTimestamp()});
    await setDoc(demandsRef(store.id),{items:[],updatedAt:serverTimestamp()});
    setSession(null);setQueue([]);setServices([]);setConfClose(false);setView("queue");setCurSvc(null);setDemands([]);
  };

  // Semeia o checklist fixo assim que o dia começa (uma vez), com base no
  // horário real de abertura — integra o SLA das tarefas com a fila de vez.
  useEffect(()=>{
    if(session?.startedAt && demandsReady && demands.length===0){
      const seeded=seedDemandsFromOpening(session.startedAt,store.name);
      setDemands(seeded);
      setDoc(demandsRef(store.id),{items:seeded,updatedAt:serverTimestamp()});
    }
  },[session?.startedAt,demandsReady]);

  // Escalonamento automático: pendências vencidas passam para a
  // responsável e para a supervisão (spec v3, §4).
  useEffect(()=>{
    if(demands.some(d=>d.status==="PENDENTE"&&new Date(d.dueAt)<now)){
      const upd=demands.map(d=>d.status==="PENDENTE"&&new Date(d.dueAt)<now?{...d,status:"ESCALADA"}:d);
      setDemands(upd);
      setDoc(demandsRef(store.id),{items:upd,updatedAt:serverTimestamp()});
    }
  },[now]);

  const persistDemands=async(items)=>{
    await setDoc(demandsRef(store.id),{items,updatedAt:serverTimestamp()});
  };

  const openTask=(d)=>{setActiveTask(d);setTaskNote("");setTaskWho("");};
  const closeTask=()=>setActiveTask(null);

  const completeTask=async()=>{
    if(!activeTask||!taskWho)return;
    // Nada passa por aprovação da Supervisão — a loja marca como
    // realizada e a tarefa fecha na hora, com pontuação já definitiva.
    const completedAt=new Date();
    const onTime=completedAt<=new Date(activeTask.dueAt);
    const qualityBonus=taskNote.trim()?TASK_SCORE.QUALITY_BONUS:0;
    const status=onTime?"CONCLUIDA_NO_PRAZO":"CONCLUIDA_ATRASADA";
    const points=(onTime?TASK_SCORE.ON_TIME:TASK_SCORE.LATE)+qualityBonus;

    let updated=demands.map(d=>d.id===activeTask.id?{...d,status,note:taskNote,pointsAwarded:points,completedBy:taskWho,completedAt:completedAt.toISOString()}:d);

    if(status==="CONCLUIDA_NO_PRAZO"&&activeTask.type!=="AVULSA"&&!taskBonus[activeTask.type]){
      const typeItems=updated.filter(d=>d.type===activeTask.type);
      if(typeItems.every(d=>d.status==="CONCLUIDA_NO_PRAZO")){
        updated=updated.map(d=>d.id===activeTask.id?{...d,pointsAwarded:d.pointsAwarded+TASK_SCORE.PERFECT}:d);
        setTaskBonus(b=>({...b,[activeTask.type]:true}));
      }
    }

    setDemands(updated);await persistDemands(updated);setActiveTask(null);
  };

  const aq=()=>[...queue].filter(p=>p.status!=="done").sort((a,b)=>{
    if(a.status==="serving")return -1;if(b.status==="serving")return 1;
    if(a.status==="absent"&&b.status!=="absent")return 1;if(b.status==="absent"&&a.status!=="absent")return -1;
    return a.order-b.order;
  });
  const dq=()=>queue.filter(p=>p.status==="done");
  const np=()=>aq().find(p=>p.status==="waiting");
  const tSvc=services.length,tSales=services.filter(s=>s.isSale).length;
  const conv=tSvc>0?Math.round((tSales/tSvc)*100):0;

  const rosterAvail=()=>roster.filter(m=>!queue.some(p=>p.status!=="done"&&p.name===m.name));
  const addPerson=async()=>{
    const member=roster.find(m=>m.id===addPersonId);if(!member)return;
    const nq=[...queue,{id:uid(),name:member.name,status:"waiting",entryTime:new Date().toISOString(),breaks:[],exitTime:null,order:queue.filter(p=>p.status!=="done").length}];
    setQueue(nq);await persist(nq,null,session?.startedAt||new Date().toISOString());setAddPersonId("");setShowAdd(false);
  };
  const newCustomer=async()=>{
    const next=aq().find(p=>p.status==="waiting");if(!next||curSvc)return;
    const sv={id:uid(),salespersonId:next.id,salespersonName:next.name,startTime:new Date().toISOString()};
    setCurSvc(sv);const nq=queue.map(p=>p.id===next.id?{...p,status:"serving"}:p);
    setQueue(nq);await persist(nq,null);
  };
  const resolve=(id,detail="")=>{
    const m=MAIN_OUTCOMES.find(o=>o.id===id);if(m)return{id,label:m.label,isSale:m.isSale};
    const s=SUB_OUTCOMES.find(o=>o.id===id);if(!s)return{id,label:id,isSale:false};
    return{id,label:detail?`${s.label}: ${detail}`:s.label,isSale:false};
  };
  const finishSvc=async(oId,detail="")=>{
    if(!curSvc)return;
    const{label,isSale}=resolve(oId,detail);
    const ns=[...services,{...curSvc,endTime:new Date().toISOString(),outcome:oId,outcomeLabel:label,isSale,detail}];
    const mo=Math.max(...queue.filter(q=>q.status!=="done").map(q=>q.order),0);
    const nq=queue.map(p=>p.id===curSvc.salespersonId?{...p,status:"waiting",order:mo+1}:p);
    setQueue(nq);setServices(ns);setCurSvc(null);setStep("main");setSubD("");await persist(nq,ns);
  };
  const editSvcFn=async(id,oId,detail="")=>{
    const{label,isSale}=resolve(oId,detail);
    const ns=services.map(s=>s.id===id?{...s,outcome:oId,outcomeLabel:label,isSale,detail}:s);
    setServices(ns);setEditSvc(null);setEditStep("main");setEditSubD("");await persist(null,ns);
  };
  const cancelSvc=async()=>{
    if(!curSvc)return;
    const nq=queue.map(p=>p.id===curSvc.salespersonId?{...p,status:"waiting"}:p);
    setQueue(nq);setCurSvc(null);setStep("main");setSubD("");await persist(nq,null);
  };
  const skipTurn=async(id)=>{
    const mo=Math.max(...queue.filter(q=>q.status!=="done").map(q=>q.order),0);
    const nq=queue.map(p=>p.id===id?{...p,order:mo+1}:p);setQueue(nq);await persist(nq,null);
  };
  const toggleAbs=async(id)=>{
    const p=queue.find(q=>q.id===id);if(!p)return;
    let nq;
    if(p.status==="absent"){
      const mo=Math.max(...queue.filter(q=>q.status!=="done").map(q=>q.order),0);
      nq=queue.map(q=>q.id===id?{...q,status:"waiting",order:mo+1,breaks:q.breaks.map((b,i)=>i===q.breaks.length-1?{...b,end:new Date().toISOString()}:b)}:q);
    }else{nq=queue.map(q=>q.id===id?{...q,status:"absent",breaks:[...q.breaks,{start:new Date().toISOString(),end:null}]}:q);}
    setQueue(nq);await persist(nq,null);
  };
  const endShift=async(id)=>{
    const nq=queue.map(p=>p.id===id?{...p,status:"done",exitTime:new Date().toISOString()}:p);
    setQueue(nq);setConfEnd(null);await persist(nq,null);
  };

  const SubGrid=({selected,onSelect,onConfirm})=>(
    <>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        {SUB_OUTCOMES.map(o=>{const sel=selected.startsWith(o.id+":");return(
          <button key={o.id} onClick={()=>{if(!o.detail)onConfirm(o.id,"");else onSelect(p=>p.startsWith(o.id+":")?"":o.id+":");}}
            style={{background:sel?VI.surfaceAlt:VI.cream,border:`1px solid ${sel?VI.terra:VI.border}`,borderRadius:10,
                    padding:"11px 8px",cursor:"pointer",fontFamily:"inherit",fontSize:12,color:VI.carvao,fontWeight:500,textAlign:"center"}}>
            {o.label}
          </button>
        );})}
      </div>
      {SUB_OUTCOMES.filter(o=>o.detail).map(o=>{
        if(!selected.startsWith(o.id+":"))return null;
        const dt=selected.slice(o.id.length+1);
        return(<div key={o.id} style={{marginTop:10}}>
          <Inp autoFocus value={dt} onChange={e=>onSelect(o.id+":"+e.target.value)} placeholder={o.detailLabel+"…"}/>
          <Btn variant="accent" style={{width:"100%"}} disabled={!dt.trim()} onClick={()=>onConfirm(o.id,dt.trim())}>Confirmar</Btn>
        </div>);
      })}
      {selected!==""&&!SUB_OUTCOMES.find(o=>o.detail&&selected.startsWith(o.id+":"))&&(()=>{
        const sId=selected.replace(":","");
        return <Btn variant="accent" style={{width:"100%",marginTop:10}} onClick={()=>onConfirm(sId,"")}>Confirmar</Btn>;
      })()}
    </>
  );

  if(!ready)return(<AppShell><div style={{padding:80,textAlign:"center"}}>
    <div style={{width:24,height:24,border:`2px solid ${VI.border}`,borderTopColor:VI.terra,borderRadius:"50%",animation:"spin .7s linear infinite",margin:"0 auto"}}/>
  </div></AppShell>);

  const subSuffix = (s)=>(
    <span style={{background:VI.surfaceAlt,padding:"1px 8px",borderRadius:20,fontSize:11,display:"inline-flex",alignItems:"center",gap:3}}>
      <Icon name="clock" size={11} color={VI.muted}/> {fmtClock(s)}
    </span>
  );

  if(!session?.startedAt)return(
    <AppShell>
      <Topbar title={store.name}
        sub={<><span style={{textTransform:"capitalize"}}>{fmtDate(now)}</span>{subSuffix(now)}</>}
        actions={<Btn variant="ghost" style={{display:"flex",alignItems:"center",gap:5}} onClick={onLogout}><Icon name="logout" size={13} color={VI.muted}/></Btn>}/>
      <div style={{textAlign:"center",padding:"64px 28px",color:VI.muted}}>
        <div style={{width:60,height:60,background:VI.surfaceAlt,borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 18px"}}>
          <Icon name="sun" size={26} color={VI.terra}/>
        </div>
        <div style={{fontSize:18,fontWeight:600,color:VI.carvao,marginBottom:8}}>Pronta para começar</div>
        <div style={{fontSize:13,marginBottom:30,opacity:.7}}>O dia inicia com a primeira entrada.</div>
        <Btn variant="accent" style={{display:"inline-flex",alignItems:"center",gap:7,padding:"12px 26px"}} onClick={()=>{setAddPersonId("");setShowAdd(true);}}>
          <Icon name="plus" size={14} color="#fff"/> Registrar primeira entrada
        </Btn>
      </div>
      {showAdd&&<Modal onClose={()=>setShowAdd(false)}><MIcon name="user"/><h2 style={{fontSize:17,fontWeight:600,color:VI.carvao,marginBottom:5}}>Registrar entrada</h2><p style={{color:VI.muted,fontSize:13,marginBottom:18}}>Isso irá iniciar o dia de <strong>{store.name}</strong></p>
        {roster.length===0
          ?<p style={{color:VI.muted,fontSize:13,textAlign:"center",padding:"8px 0 18px"}}>Nenhuma vendedora cadastrada.<br/><span style={{fontSize:12,opacity:.7}}>Peça ao administrador para cadastrar a equipe desta loja.</span></p>
          :<select value={addPersonId} onChange={e=>setAddPersonId(e.target.value)} autoFocus
              style={{display:"block",width:"100%",background:VI.cream,border:`1px solid ${VI.border}`,borderRadius:8,padding:"11px 14px",fontSize:14,fontFamily:"inherit",marginBottom:12,cursor:"pointer",color:addPersonId?VI.carvao:VI.muted}}>
              <option value="">Selecione a vendedora</option>
              {rosterAvail().map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
            </select>}
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={()=>setShowAdd(false)}>Cancelar</Btn><Btn variant="accent" disabled={!addPersonId} onClick={addPerson}>Iniciar o dia</Btn></div></Modal>}
    </AppShell>
  );

  const aqArr=aq(),dqArr=dq(),npObj=np();

  const taskGroups={
    atrasadas:demands.filter(d=>d.status==="ATRASADA"||d.status==="ESCALADA"),
    pendentes:demands.filter(d=>d.status==="PENDENTE").sort((a,b)=>new Date(a.dueAt)-new Date(b.dueAt)),
    concluidas:demands.filter(d=>d.status==="CONCLUIDA_NO_PRAZO"||d.status==="CONCLUIDA_ATRASADA"),
  };
  const taskProgress=(type)=>{const items=demands.filter(d=>d.type===type);const done=items.filter(d=>d.status==="CONCLUIDA_NO_PRAZO"||d.status==="CONCLUIDA_ATRASADA").length;return{done,total:items.length};};
  const nextTask=taskGroups.pendentes[0]||null;
  const pointsToday=demands.reduce((s,d)=>s+(d.pointsAwarded||0),0);

  return(<AppShell>
    <Topbar title={store.name}
      sub={<><span style={{textTransform:"capitalize"}}>{fmtDate(now)}</span>{subSuffix(now)}</>}
      actions={<>
        {view!=="queue"&&<Btn variant="ghost" style={{display:"flex",alignItems:"center",gap:5}} onClick={()=>setView("queue")}><Icon name="back" size={13} color={VI.muted}/>Fila</Btn>}
        {view!=="report"&&<Btn variant="ghost" style={{display:"flex",alignItems:"center",gap:5}} onClick={()=>setView("report")}><Icon name="chart" size={13} color={VI.muted}/>Relatório</Btn>}
        {view!=="tasks"&&<Btn variant="ghost" style={{display:"flex",alignItems:"center",gap:5,...(taskGroups.atrasadas.length?{borderColor:VI.red,color:VI.red}:{})}} onClick={()=>setView("tasks")}><Icon name="list" size={13} color={taskGroups.atrasadas.length?VI.red:VI.muted}/>Tarefas{taskGroups.atrasadas.length>0?` (${taskGroups.atrasadas.length})`:""}</Btn>}
        {view==="report"&&<><Btn variant="ghost" style={{display:"flex",alignItems:"center",gap:5}} onClick={()=>exportPDF(store.name,queue,services,session?.startedAt,demands)}><Icon name="print" size={13} color={VI.muted}/>PDF</Btn><Btn variant="success" style={{display:"flex",alignItems:"center",gap:5}} onClick={()=>setConfClose(true)}><Icon name="moon" size={13} color="#fff"/>Encerrar dia</Btn></>}
        {view==="queue"&&<Btn variant="accent" style={{display:"flex",alignItems:"center",gap:5}} onClick={()=>{setAddPersonId("");setShowAdd(true);}}><Icon name="plus" size={13} color="#fff"/>Entrada</Btn>}
        <Btn variant="ghost" style={{display:"flex",alignItems:"center",gap:5,padding:"9px 10px"}} onClick={onLogout}><Icon name="logout" size={13} color={VI.muted}/></Btn>
      </>}/>
    {view!=="tasks"&&<StatsRow items={[{num:tSvc,label:"Atendimentos"},{num:tSales,label:"Vendas",color:VI.green},{num:`${conv}%`,label:"Conversão"},{num:aqArr.filter(p=>p.status==="waiting").length,label:"Na fila"}]}/>}
    {view==="tasks"&&<StatsRow items={[{num:taskGroups.pendentes.length,label:"Pendentes"},{num:taskGroups.atrasadas.length,label:"Atrasadas",color:taskGroups.atrasadas.length?VI.red:VI.carvao},{num:taskGroups.concluidas.length,label:"Concluídas",color:VI.green},{num:pointsToday,label:"Pontos hoje"}]}/>}

    <div style={{margin:"10px 22px 0",padding:"8px 12px",background:VI.surfaceAlt,borderRadius:8,fontSize:12,color:VI.muted,display:"flex",justifyContent:"space-between",alignItems:"center",border:`1px solid ${VI.border}`}}>
      <span>Dia iniciado às {fmtTime(session?.startedAt)}</span>
      {view==="queue"&&<button onClick={()=>setView("report")} style={{background:"none",border:"none",color:VI.terra,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Relatório e encerramento</button>}
    </div>

    {view==="queue"&&<>
      <div style={{padding:"14px 22px"}}>
        <button disabled={!npObj||!!curSvc} onClick={newCustomer}
          style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",background:VI.carvao,
                  border:"none",borderRadius:12,padding:"16px 18px",color:VI.cream,cursor:npObj&&!curSvc?"pointer":"not-allowed",
                  opacity:npObj&&!curSvc?1:.35,fontFamily:"inherit",transition:"opacity .2s"}}>
          <span style={{fontSize:15,fontWeight:600}}>Novo Cliente</span>
          {curSvc&&<span style={{fontSize:12,color:VI.blush,background:`${VI.terra}30`,padding:"3px 12px",borderRadius:20}}>Em atendimento</span>}
          {npObj&&!curSvc&&<span style={{fontSize:12,color:VI.muted,display:"flex",alignItems:"center",gap:4}}><Icon name="chevR" size={12} color={VI.muted}/>{npObj.name}</span>}
          {!npObj&&!curSvc&&<span style={{fontSize:12,color:VI.muted}}>Fila vazia</span>}
        </button>
      </div>
      <div style={{padding:"0 22px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <span style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:VI.muted}}>Fila de atendimento</span>
          <span style={{fontSize:11,background:VI.surfaceAlt,color:VI.muted,padding:"2px 8px",borderRadius:99,border:`1px solid ${VI.border}`}}>{aqArr.length}</span>
        </div>
        {aqArr.length===0&&<div style={{border:`1px dashed ${VI.border}`,borderRadius:12,padding:"32px 20px",textAlign:"center",background:`${VI.cream}60`}}>
          <Icon name="users" size={30} color={VI.border} sw={1}/>
          <p style={{fontSize:13,color:VI.muted,marginTop:10,fontWeight:500}}>Nenhuma funcionária na fila</p>
          <p style={{fontSize:11,color:VI.border,marginTop:4}}>Use "Entrada" para iniciar o expediente</p>
        </div>}
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {aqArr.map((p,i)=><PersonCard key={p.id} person={p} position={i+1} isNext={p.id===npObj?.id} onSkip={()=>skipTurn(p.id)} onAbsent={()=>toggleAbs(p.id)} onEnd={()=>setConfEnd(p.id)}/>)}
        </div>
        {dqArr.length>0&&<><div style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:VI.border,margin:"20px 0 8px"}}>Expediente encerrado</div><div style={{display:"flex",flexDirection:"column",gap:6}}>{dqArr.map(p=><PersonCard key={p.id} person={p} done/>)}</div></>}
      </div>
    </>}

    {view==="report"&&<>
      <div style={{margin:"14px 22px 0",background:VI.greenBg,border:`1px solid ${VI.green}44`,borderRadius:10,padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><div style={{fontWeight:600,color:VI.green,fontSize:13}}>Encerrar o dia</div><div style={{fontSize:11,color:VI.muted,marginTop:2}}>Salva no histórico e zera para amanhã</div></div>
        <Btn variant="success" style={{display:"flex",alignItems:"center",gap:5}} onClick={()=>setConfClose(true)}><Icon name="moon" size={13} color="#fff"/>Encerrar</Btn>
      </div>
      <ReportView services={services} queue={queue} tSvc={tSvc} tSales={tSales} conv={conv} demands={demands} onEdit={s=>{setEditSvc(s);setEditStep("main");setEditSubD("");}}/>
    </>}

    {view==="tasks"&&<TasksPanel
      demands={demands} now={now} groups={taskGroups} progress={taskProgress}
      nextTask={nextTask} onOpenTask={openTask}/>}

    {showAdd&&<Modal onClose={()=>setShowAdd(false)}><MIcon name="user"/><h2 style={{fontSize:17,fontWeight:600,color:VI.carvao,marginBottom:5}}>Registrar entrada</h2><p style={{color:VI.muted,fontSize:13,marginBottom:18}}>Adicionar à fila de atendimento</p>
      {roster.length===0
        ?<p style={{color:VI.muted,fontSize:13,textAlign:"center",padding:"8px 0 18px"}}>Nenhuma vendedora cadastrada.<br/><span style={{fontSize:12,opacity:.7}}>Peça ao administrador para cadastrar a equipe desta loja.</span></p>
        :<>
          <select value={addPersonId} onChange={e=>setAddPersonId(e.target.value)} autoFocus
            style={{display:"block",width:"100%",background:VI.cream,border:`1px solid ${VI.border}`,borderRadius:8,padding:"11px 14px",fontSize:14,fontFamily:"inherit",marginBottom:12,cursor:"pointer",color:addPersonId?VI.carvao:VI.muted}}>
            <option value="">Selecione a vendedora</option>
            {rosterAvail().map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          {rosterAvail().length===0&&<p style={{color:VI.muted,fontSize:12,marginTop:-6,marginBottom:12}}>Todas as vendedoras cadastradas já estão na fila hoje.</p>}
        </>}
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={()=>setShowAdd(false)}>Cancelar</Btn><Btn variant="accent" disabled={!addPersonId} onClick={addPerson}>Entrar na fila</Btn></div></Modal>}

    {curSvc&&<Modal closeable={false}><MIcon name="bell"/><h2 style={{fontSize:17,fontWeight:600,color:VI.carvao,marginBottom:5}}>{step==="main"?"Resultado do atendimento":"Motivo da não venda"}</h2><p style={{color:VI.muted,fontSize:13,marginBottom:18}}>{curSvc.salespersonName} · {fmtTime(curSvc.startTime)}</p>
      {step==="main"&&<div style={{display:"flex",flexDirection:"column",gap:8}}>{MAIN_OUTCOMES.map(o=><button key={o.id} onClick={()=>o.id==="nao_vendeu"?setStep("sub"):finishSvc(o.id)} style={{background:o.isSale?VI.greenBg:VI.redBg,border:`1px solid ${o.color}44`,borderRadius:10,padding:"13px 16px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",fontFamily:"inherit"}}><span style={{fontSize:14,color:VI.carvao,fontWeight:500}}>{o.label}</span><Icon name={o.isSale?"check":"x"} size={16} color={o.color}/></button>)}</div>}
      {step==="sub"&&<><SubGrid selected={subD} onSelect={setSubD} onConfirm={finishSvc}/><Btn variant="ghost" style={{width:"100%",marginTop:8,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",gap:5}} onClick={()=>{setStep("main");setSubD("");}}><Icon name="back" size={12} color={VI.muted}/>Voltar</Btn></>}
      <Btn variant="ghost" style={{width:"100%",marginTop:10,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",gap:5}} onClick={cancelSvc}><Icon name="x" size={12} color={VI.muted}/>Cancelar atendimento</Btn>
    </Modal>}

    {confEnd&&<Modal onClose={()=>setConfEnd(null)}><MIcon name="logout" color={VI.red} bg={VI.redBg}/><h2 style={{fontSize:17,fontWeight:600,color:VI.carvao,marginBottom:5}}>Encerrar expediente?</h2><p style={{color:VI.muted,fontSize:13,marginBottom:18}}>{queue.find(p=>p.id===confEnd)?.name} será removida da fila.</p><div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={()=>setConfEnd(null)}>Cancelar</Btn><Btn variant="danger" onClick={()=>endShift(confEnd)}>Confirmar saída</Btn></div></Modal>}

    {confClose&&<Modal onClose={()=>setConfClose(false)}><MIcon name="moon" color={VI.green} bg={VI.greenBg}/><h2 style={{fontSize:17,fontWeight:600,color:VI.carvao,marginBottom:5}}>Encerrar o dia?</h2><p style={{color:VI.muted,fontSize:13,marginBottom:10}}>O relatório será salvo e a fila será zerada para amanhã.</p><div style={{background:VI.surfaceAlt,borderRadius:8,padding:"11px 13px",marginBottom:18,fontSize:13,border:`1px solid ${VI.border}`}}><div style={{fontWeight:500}}>{tSvc} atendimentos · {tSales} vendas · {conv}% conversão</div><div style={{color:VI.muted,fontSize:11,marginTop:2}}>Iniciado às {fmtTime(session?.startedAt)}</div></div><div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={()=>setConfClose(false)}>Cancelar</Btn><Btn variant="success" onClick={closeDay}>Confirmar encerramento</Btn></div></Modal>}

    {editSvc&&<Modal onClose={()=>{setEditSvc(null);setEditStep("main");setEditSubD("");}}><MIcon name="edit"/><h2 style={{fontSize:17,fontWeight:600,color:VI.carvao,marginBottom:5}}>Editar atendimento</h2><p style={{color:VI.muted,fontSize:12,marginBottom:16}}>{editSvc.salespersonName} · {fmtTime(editSvc.startTime)}<br/><span style={{color:editSvc.isSale?VI.green:VI.red}}>Atual: {editSvc.outcomeLabel}</span></p>
      {editStep==="main"&&<div style={{display:"flex",flexDirection:"column",gap:8}}>{MAIN_OUTCOMES.map(o=><button key={o.id} onClick={()=>o.id==="nao_vendeu"?setEditStep("sub"):editSvcFn(editSvc.id,o.id)} style={{background:o.isSale?VI.greenBg:VI.redBg,border:`1px solid ${o.color}44`,borderRadius:10,padding:"12px 14px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",fontFamily:"inherit"}}><span style={{fontSize:13,color:VI.carvao,fontWeight:500}}>{o.label}</span><Icon name={o.isSale?"check":"x"} size={15} color={o.color}/></button>)}</div>}
      {editStep==="sub"&&<><SubGrid selected={editSubD} onSelect={setEditSubD} onConfirm={(id,d)=>editSvcFn(editSvc.id,id,d)}/><Btn variant="ghost" style={{width:"100%",marginTop:8,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",gap:5}} onClick={()=>{setEditStep("main");setEditSubD("");}}><Icon name="back" size={12} color={VI.muted}/>Voltar</Btn></>}
    </Modal>}

    {activeTask&&<Modal onClose={closeTask}>
      <MIcon name={DEMAND_TYPES[activeTask.type].icon} color={DEMAND_TYPES[activeTask.type].color} bg={DEMAND_TYPES[activeTask.type].bg}/>
      <h2 style={{fontSize:17,fontWeight:600,color:VI.carvao,marginBottom:5}}>{activeTask.title}</h2>
      {activeTask.sentBy&&<p style={{fontSize:11,color:VI.terra,fontWeight:600,textTransform:"uppercase",letterSpacing:".3px",marginBottom:8}}>
        enviada por {activeTask.sentBy}{activeTask.requestedAt&&` · ${fmtElapsed(activeTask.requestedAt,now)}`}
      </p>}
      <p style={{color:VI.muted,fontSize:13,marginBottom:10}}>{activeTask.description}</p>
      <p style={{color:VI.muted,fontSize:12,marginBottom:16,fontStyle:"italic"}}>{fmtCountdown(activeTask.dueAt,now)}</p>

      <div style={{fontSize:11,color:VI.muted,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.05em"}}>Quem está concluindo?</div>
      {roster.length===0
        ?<p style={{color:VI.muted,fontSize:13,marginBottom:12}}>Nenhuma vendedora cadastrada nesta loja.<br/><span style={{fontSize:12,opacity:.7}}>Peça ao administrador para cadastrar a equipe.</span></p>
        :<select value={taskWho} onChange={e=>setTaskWho(e.target.value)} autoFocus
            style={{display:"block",width:"100%",background:VI.cream,border:`1px solid ${VI.border}`,borderRadius:8,padding:"11px 14px",fontSize:14,fontFamily:"inherit",marginBottom:12,cursor:"pointer",color:taskWho?VI.carvao:VI.muted}}>
            <option value="">Selecione a vendedora</option>
            {roster.map(m=><option key={m.id} value={m.name}>{m.name}</option>)}
          </select>}

      <Inp placeholder="Observação (opcional)" value={taskNote} onChange={e=>setTaskNote(e.target.value)}/>

      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <Btn variant="ghost" onClick={closeTask}>Cancelar</Btn>
        <Btn variant="success" style={{display:"flex",alignItems:"center",gap:6}} disabled={!taskWho} onClick={completeTask}>
          <Icon name="check" size={14} color="#fff"/> Marcar como concluída
        </Btn>
      </div>
    </Modal>}
  </AppShell>);
}

function PersonCard({person:p,position,isNext,onSkip,onAbsent,onEnd,done}) {
  const cfg={
    waiting:{bar:isNext?VI.terra:VI.border,badge:isNext?"Próxima":`${position}ª`,bg:isNext?`${VI.terra}18`:VI.surfaceAlt,col:isNext?VI.terra:VI.muted},
    serving:{bar:VI.green,badge:"Atendendo",bg:VI.greenBg,col:VI.green},
    absent: {bar:VI.gold, badge:"Ausente",  bg:VI.yellowBg,col:VI.yellow},
    done:   {bar:VI.border,badge:`Saiu ${fmtTime(p.exitTime)}`,bg:VI.surfaceAlt,col:VI.muted},
  }[p.status]||{bar:VI.border,badge:`${position}ª`,bg:VI.surfaceAlt,col:VI.muted};
  return(
    <div style={{background:VI.surface,border:`1px solid ${VI.border}`,borderRadius:10,display:"flex",alignItems:"stretch",overflow:"hidden",opacity:done?.5:1}} className="fi">
      <div style={{width:3,flexShrink:0,background:cfg.bar}}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"11px 13px",gap:10,flex:1}}>
        <div style={{display:"flex",alignItems:"center",gap:9,flex:1,minWidth:0}}>
          <div style={{width:32,height:32,background:VI.surfaceAlt,borderRadius:7,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:600,color:VI.muted}}>
            {ini(p.name)}
          </div>
          <div>
            <div style={{fontSize:14,fontWeight:500,color:VI.carvao,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.name}</div>
            <div style={{fontSize:11,color:VI.muted,marginTop:1}}>Entrada {fmtTime(p.entryTime)}{p.breaks.length>0?` · ${p.breaks.length} pausa${p.breaks.length>1?"s":""}`:""}</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:7,flexShrink:0}}>
          <span style={{fontSize:11,fontWeight:600,padding:"3px 9px",borderRadius:5,background:cfg.bg,color:cfg.col,whiteSpace:"nowrap"}}>{cfg.badge}</span>
          {!done&&<div style={{display:"flex",gap:2,borderLeft:`1px solid ${VI.border}`,paddingLeft:7}}>
            <button style={{background:"none",border:"none",cursor:"pointer",padding:5,borderRadius:5,display:"flex"}} onClick={onAbsent} title={p.status==="absent"?"Retornar":"Pausar"}>
              <Icon name={p.status==="absent"?"play":"pause"} size={13} color={p.status==="absent"?VI.green:VI.yellow}/>
            </button>
            {p.status==="waiting"&&<button style={{background:"none",border:"none",cursor:"pointer",padding:5,borderRadius:5,display:"flex"}} onClick={onSkip} title="Pular"><Icon name="skip" size={13} color={VI.muted}/></button>}
            <button style={{background:"none",border:"none",cursor:"pointer",padding:5,borderRadius:5,display:"flex"}} onClick={onEnd} title="Encerrar"><Icon name="x" size={13} color={VI.red}/></button>
          </div>}
        </div>
      </div>
    </div>
  );
}

function ReportView({services,queue,tSvc,tSales,conv,demands=[],onEdit}) {
  const nS=services.filter(s=>!s.isSale);
  const rC={};nS.forEach(s=>{rC[s.outcomeLabel]=(rC[s.outcomeLabel]||0)+1;});
  const sR=Object.entries(rC).sort((a,b)=>b[1]-a[1]);const mR=sR[0]?.[1]||1;
  const tDone=demands.filter(d=>d.status==="CONCLUIDA_NO_PRAZO"||d.status==="CONCLUIDA_ATRASADA");
  const tPend=demands.filter(d=>d.status==="PENDENTE").length;
  const tLate=demands.filter(d=>d.status==="ATRASADA"||d.status==="ESCALADA").length;
  const tPoints=tDone.reduce((a,d)=>a+(d.pointsAwarded||0),0);
  const pointsByPerson={};
  tDone.forEach(d=>{if(!d.completedBy)return;if(!pointsByPerson[d.completedBy])pointsByPerson[d.completedBy]={name:d.completedBy,tasks:0,points:0};pointsByPerson[d.completedBy].tasks++;pointsByPerson[d.completedBy].points+=d.pointsAwarded||0;});
  const sortedTaskPoints=Object.values(pointsByPerson).sort((a,b)=>b.points-a.points);
  return(<div style={{padding:"8px 22px 60px"}}>
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,margin:"14px 0"}}>
      {[{n:tSvc,l:"Atendimentos",c:VI.carvao},{n:tSales,l:"Vendas",c:VI.green},{n:`${conv}%`,l:"Conversão",c:VI.carvao}].map((s,i)=>(
        <div key={i} style={{background:VI.surface,border:`1px solid ${VI.border}`,borderRadius:12,padding:"16px 14px",textAlign:"center"}}>
          <div style={{fontSize:30,fontWeight:700,color:s.c,letterSpacing:"-0.03em",lineHeight:1}}>{s.n}</div>
          <div style={{fontSize:10,color:VI.muted,textTransform:"uppercase",letterSpacing:"0.05em",marginTop:5}}>{s.l}</div>
        </div>
      ))}
    </div>
    {demands.length>0&&<RSection title="Tarefas do dia">
      <div style={{display:"flex",gap:18,marginBottom:sortedTaskPoints.length>0?16:0}}>
        {[{v:tDone.length,l:"Concluídas",c:VI.green},{v:tPend,l:"Pendentes",c:VI.carvao},{v:tLate,l:"Atrasadas",c:tLate?VI.red:VI.carvao},{v:tPoints,l:"Pontos",c:VI.terra}].map(({v,l,c})=>(
          <div key={l}><div style={{fontSize:20,fontWeight:700,color:c,letterSpacing:"-0.02em"}}>{v}</div><div style={{fontSize:10,color:VI.muted,textTransform:"uppercase"}}>{l}</div></div>
        ))}
      </div>
      {sortedTaskPoints.map((p,i)=>(
        <div key={p.name} style={{display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:i<sortedTaskPoints.length-1?`1px solid ${VI.border}`:"none",paddingBottom:8,marginBottom:8}}>
          <span style={{fontSize:13,color:VI.carvao}}>{p.name}</span>
          <span style={{fontSize:12}}><span style={{color:VI.muted}}>{p.tasks} tarefa{p.tasks!==1?"s":""}</span> <span style={{color:VI.terra,fontWeight:700}}>· {p.points} pts</span></span>
        </div>
      ))}
    </RSection>}
    <RSection title="Motivos de não venda">
      {sR.length===0?<p style={{color:VI.muted,fontSize:13,textAlign:"center"}}>Nenhum registro</p>
        :sR.map(([label,cnt])=>(
          <div key={label} style={{marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:5}}>
              <span style={{color:VI.carvao}}>{label}</span>
              <span style={{fontWeight:500,color:VI.carvao}}>{cnt} <span style={{color:VI.muted,fontWeight:400}}>({nS.length?Math.round((cnt/nS.length)*100):0}%)</span></span>
            </div>
            <div style={{height:4,background:VI.surfaceAlt,borderRadius:99,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${(cnt/mR)*100}%`,background:VI.terra,borderRadius:99}}/>
            </div>
          </div>
        ))}
    </RSection>
    <RSection title="Funcionárias">
      {queue.length===0?<p style={{color:VI.muted,fontSize:13,textAlign:"center"}}>Nenhum registro</p>
        :queue.map((p,idx)=>{const ps=services.filter(s=>s.salespersonId===p.id);const pv=ps.filter(s=>s.isSale).length;return(
          <div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:idx<queue.length-1?`1px solid ${VI.border}`:"none",paddingBottom:10,marginBottom:10}}>
            <div style={{display:"flex",alignItems:"center",gap:9}}>
              <div style={{width:30,height:30,background:VI.surfaceAlt,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:600,color:VI.muted}}>{ini(p.name)}</div>
              <div>
                <div style={{fontWeight:500,fontSize:13,color:VI.carvao}}>{p.name}</div>
                <div style={{fontSize:11,color:VI.muted,marginTop:1}}>Entrada {fmtTime(p.entryTime)}{p.breaks.map((b,i)=>` · P${i+1}: ${fmtTime(b.start)}–${fmtTime(b.end)}`)}{p.exitTime&&` · Saída ${fmtTime(p.exitTime)}`}</div>
              </div>
            </div>
            <div style={{textAlign:"right",fontSize:13}}><div style={{color:VI.carvao}}>{ps.length} atend.</div><div style={{color:VI.green,fontWeight:500}}>{pv} vendas</div></div>
          </div>
        );})}
    </RSection>
    <RSection title={`Histórico (${services.length})`}>
      {onEdit&&<p style={{color:VI.muted,fontSize:11,marginBottom:10,marginTop:-8}}>Clique em editar para alterar o resultado.</p>}
      {services.length===0?<p style={{color:VI.muted,fontSize:13,textAlign:"center"}}>Nenhum atendimento</p>
        :[...services].reverse().map(s=>(
          <div key={s.id} style={{display:"flex",gap:9,padding:"7px 0",borderBottom:`1px solid ${VI.border}`,alignItems:"center"}}>
            <span style={{fontSize:11,color:VI.muted,flexShrink:0,minWidth:36}}>{fmtTime(s.startTime)}</span>
            <span style={{fontSize:13,flex:1,color:VI.carvao}}>{s.salespersonName}</span>
            <span style={{fontSize:12,color:s.isSale?VI.green:VI.red,fontWeight:500,textAlign:"right"}}>{s.outcomeLabel}</span>
            {onEdit&&<button onClick={()=>onEdit(s)} style={{background:"none",border:`1px solid ${VI.border}`,borderRadius:5,padding:"3px 7px",color:VI.muted,fontSize:11,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:3}}><Icon name="edit" size={10} color={VI.muted}/></button>}
          </div>
        ))}
    </RSection>
  </div>);
}
function TasksPanel({demands,now,groups,progress,nextTask,onOpenTask}) {
  const abertura=progress("ABERTURA"),fechamento=progress("FECHAMENTO");
  return(<div style={{padding:"14px 22px 60px"}}>
    <button disabled={!nextTask} onClick={()=>nextTask&&onOpenTask(nextTask)}
      style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",background:VI.carvao,
              border:"none",borderRadius:12,padding:"16px 18px",color:VI.cream,cursor:nextTask?"pointer":"not-allowed",
              opacity:nextTask?1:.35,fontFamily:"inherit",transition:"opacity .2s",marginBottom:14}}>
      <span style={{fontSize:15,fontWeight:600}}>Realizar tarefa</span>
      {nextTask
        ?<span style={{fontSize:12,color:VI.blush,display:"flex",alignItems:"center",gap:4}}><Icon name="chevR" size={12} color={VI.blush}/>{nextTask.title}</span>
        :<span style={{fontSize:12,color:VI.muted}}>Nenhuma pendente</span>}
    </button>

    <div style={{display:"flex",gap:10,marginBottom:16}}>
      {[["Abertura",abertura,VI.gold],["Fechamento",fechamento,VI.terra]].map(([label,p,color])=>{
        const pct=p.total?Math.round((p.done/p.total)*100):0;
        return(<div key={label} style={{flex:1,background:VI.surface,border:`1px solid ${VI.border}`,borderRadius:12,padding:"12px 14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:6}}>
            <span style={{color:VI.carvao,fontWeight:500}}>{label}</span><span style={{color:VI.muted}}>{p.done}/{p.total}</span>
          </div>
          <div style={{height:5,background:VI.surfaceAlt,borderRadius:99,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${pct}%`,background:color,borderRadius:99,transition:"width .4s"}}/>
          </div>
        </div>);
      })}
    </div>

    {groups.atrasadas.length>0&&<TaskSection title="Atrasadas" items={groups.atrasadas} now={now} onOpen={onOpenTask}/>}
    <TaskSection title="Pendentes" items={groups.pendentes} now={now} onOpen={onOpenTask} empty="Nenhuma tarefa pendente"/>
    {groups.concluidas.length>0&&<TaskSection title="Concluídas hoje" items={groups.concluidas} now={now} dim/>}
  </div>);
}

function TaskSection({title,items,now,onOpen,dim,empty}) {
  return(<div style={{marginBottom:20,opacity:dim?.6:1}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
      <span style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:VI.muted}}>{title}</span>
      <span style={{fontSize:11,background:VI.surfaceAlt,color:VI.muted,padding:"2px 8px",borderRadius:99,border:`1px solid ${VI.border}`}}>{items.length}</span>
    </div>
    {items.length===0&&empty&&<div style={{textAlign:"center",padding:"24px 0",color:VI.muted,fontSize:13}}>{empty}</div>}
    <div style={{display:"flex",flexDirection:"column",gap:6}}>
      {items.map(d=><TaskCard key={d.id} demand={d} now={now} onClick={onOpen?()=>onOpen(d):undefined}/>)}
    </div>
  </div>);
}

function TaskCard({demand,now,onClick}) {
  const meta=DEMAND_TYPES[demand.type],statusMeta=TASK_STATUS[demand.status];
  const showCountdown=demand.status==="PENDENTE"||demand.status==="ATRASADA"||demand.status==="ESCALADA";
  const done=demand.status==="CONCLUIDA_NO_PRAZO"||demand.status==="CONCLUIDA_ATRASADA";
  const who=done?`concluída por ${demand.completedBy}`:(demand.assignedTo?`responsável: ${demand.assignedTo}`:"aberta à equipe");
  return(
    <div onClick={onClick} className="fi"
      style={{background:VI.surface,border:`1px solid ${VI.border}`,borderRadius:10,display:"flex",alignItems:"stretch",overflow:"hidden",cursor:onClick?"pointer":"default"}}>
      <div style={{width:3,flexShrink:0,background:meta.color}}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"11px 13px",gap:10,flex:1}}>
        <div style={{display:"flex",alignItems:"center",gap:9,flex:1,minWidth:0}}>
          <div style={{width:32,height:32,background:meta.bg,borderRadius:7,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <Icon name={meta.icon} size={15} color={meta.color}/>
          </div>
          <div style={{minWidth:0}}>
            <div style={{fontSize:14,fontWeight:500,color:VI.carvao,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
              {demand.title}
              {demand.sentBy&&<span style={{marginLeft:8,fontSize:10,color:VI.terra,fontWeight:600,textTransform:"uppercase",letterSpacing:".3px"}}>enviada por {demand.sentBy}</span>}
            </div>
            <div style={{fontSize:11,color:VI.muted,marginTop:1}}>
              {meta.label} · {who}
              {demand.requestedAt&&showCountdown&&` · ${fmtElapsed(demand.requestedAt,now)}`}
              {showCountdown&&` · ${fmtCountdown(demand.dueAt,now)}`}
            </div>
          </div>
        </div>
        <span style={{fontSize:11,fontWeight:600,padding:"3px 9px",borderRadius:5,background:statusMeta.bg,color:statusMeta.color,whiteSpace:"nowrap",flexShrink:0}}>{statusMeta.label}</span>
      </div>
    </div>
  );
}

function AdminDashboard({onLogout}) {
  const [tab,setTab]=useState("overview");
  const [stores,setStores]=useState([]);
  const [sessions,setSessions]=useState({});
  const [demandsLive,setDemandsLive]=useState({});
  const [histories,setHistories]=useState({});
  const [detailStore,setDetailStore]=useState(null);
  const [detailRec,setDetailRec]=useState(null);
  const [histStore,setHistStore]=useState(null);
  const [dStores,setDStores]=useState([]);
  const [dFrom,setDFrom]=useState("");
  const [dTo,setDTo]=useState("");
  const [dData,setDData]=useState(null);
  const [dBusy,setDBusy]=useState(false);
  const [pStoreId,setPStoreId]=useState("");
  const [pName,setPName]=useState("");
  const [pFrom,setPFrom]=useState("");
  const [pTo,setPTo]=useState("");
  const [pResult,setPResult]=useState(null);
  const [pBusy,setPBusy]=useState(false);
  const [editDay,setEditDay]=useState(null);
  const [editEntry,setEditEntry]=useState("");
  const [editExit,setEditExit]=useState("");
  const [editBreaks,setEditBreaks]=useState([]);
  const [editSaving,setEditSaving]=useState(false);
  const [allHist,setAllHist]=useState({});
  const [showAdd,setShowAdd]=useState(false);
  const [newName,setNewName]=useState("");
  const [newPin,setNewPin]=useState("");
  const [editSt,setEditSt]=useState(null);
  const [saving,setSaving]=useState(false);
  const [now,setNow]=useState(new Date());
  const [teamStore,setTeamStore]=useState(null);
  const [newMemberName,setNewMemberName]=useState("");

  useEffect(()=>{const t=setInterval(()=>setNow(new Date()),30000);return()=>clearInterval(t);},[]);
  useEffect(()=>{const u=onSnapshot(collection(db,"stores"),snap=>{setStores(snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.name.localeCompare(b.name)));});return()=>u();},[]);
  useEffect(()=>{if(stores.length===0)return;const us=stores.map(s=>onSnapshot(sessionRef(s.id),snap=>{setSessions(prev=>({...prev,[s.id]:snap.exists()?snap.data():{queue:[],services:[]}}));}));return()=>us.forEach(u=>u());},[stores]);
  useEffect(()=>{if(stores.length===0)return;const us=stores.map(s=>onSnapshot(demandsRef(s.id),snap=>{setDemandsLive(prev=>({...prev,[s.id]:snap.exists()?(snap.data().items||[]):[]}));}));return()=>us.forEach(u=>u());},[stores]);

  const loadHist=useCallback(async()=>{
    const data={};for(const s of stores){const snap=await getDocs(query(historyCol(s.id),orderBy("closedAt","desc")));data[s.id]=snap.docs.map(d=>({id:d.id,...d.data()}));}
    setHistories(data);setAllHist(data);
  },[stores]);
  useEffect(()=>{if(tab==="history"||tab==="dashboard"||tab==="ponto")loadHist();},[tab,loadHist]);

  const pRoster=stores.find(s=>s.id===pStoreId)?.roster||[];
  const runPonto=()=>{
    if(!pStoreId||!pName||!pFrom||!pTo)return;
    setPBusy(true);
    const from=new Date(pFrom+"T00:00:00"),to=new Date(pTo+"T23:59:59");
    const hist=allHist[pStoreId]||[];const cur=sessions[pStoreId];const allD=[...hist];
    if(cur?.startedAt){const sd=new Date(cur.startedAt);if(sd>=from&&sd<=to)allD.push({...cur,id:"current"});}
    const days=[];
    allD.forEach(day=>{
      const dd=new Date(day.startedAt);if(dd<from||dd>to)return;
      const p=(day.queue||[]).find(q=>q.name===pName);
      if(!p||!p.entryTime)return;
      const en=p.exitTime?new Date(p.exitTime):new Date();
      const tM=en-new Date(p.entryTime);
      const bM=(p.breaks||[]).reduce((a,b)=>{const bE=b.end?new Date(b.end):new Date();return a+(bE-new Date(b.start));},0);
      const workedMin=Math.round(Math.max(0,tM-bM)/60000);
      days.push({date:day.startedAt,entryTime:p.entryTime,exitTime:p.exitTime,breaks:p.breaks||[],workedMin,dayId:day.id,isCurrent:day.id==="current"});
    });
    days.sort((a,b)=>new Date(b.date)-new Date(a.date));
    const totalWorkedMin=days.reduce((a,d)=>a+d.workedMin,0);
    setPResult({days,totalWorkedMin,daysCount:days.length});
    setPBusy(false);
  };

  // Correção manual de ponto — para quando esquecem de marcar entrada,
  // saída ou o retorno de uma pausa.
  const toHM=iso=>iso?new Date(iso).toTimeString().slice(0,5):"";
  const openEditDay=(d)=>{
    setEditDay(d);
    setEditEntry(toHM(d.entryTime));
    setEditExit(toHM(d.exitTime));
    setEditBreaks(d.breaks.map(b=>({start:toHM(b.start),end:toHM(b.end)})));
  };
  const closeEditDay=()=>setEditDay(null);
  const addEditBreak=()=>setEditBreaks(b=>[...b,{start:"",end:""}]);
  const removeEditBreak=(i)=>setEditBreaks(b=>b.filter((_,idx)=>idx!==i));
  const updateEditBreak=(i,field,val)=>setEditBreaks(b=>b.map((br,idx)=>idx===i?{...br,[field]:val}:br));
  const saveEditDay=async()=>{
    if(!editDay)return;
    setEditSaving(true);
    const combineDT=(hm)=>{
      if(!hm)return null;
      const d=new Date(editDay.date);const[h,m]=hm.split(":").map(Number);
      d.setHours(h,m,0,0);return d.toISOString();
    };
    const newEntry=combineDT(editEntry)||editDay.entryTime;
    const newExit=combineDT(editExit);
    const newBreaks=editBreaks.map(b=>({start:combineDT(b.start),end:combineDT(b.end)})).filter(b=>b.start);

    if(editDay.isCurrent){
      const session=sessions[pStoreId];
      if(session){
        const nq=(session.queue||[]).map(p=>p.name===pName?{...p,entryTime:newEntry,exitTime:newExit,breaks:newBreaks}:p);
        await setDoc(sessionRef(pStoreId),{...session,queue:nq,updatedAt:serverTimestamp()});
      }
    }else{
      const day=(allHist[pStoreId]||[]).find(d=>d.id===editDay.dayId);
      if(day){
        const nq=(day.queue||[]).map(p=>p.name===pName?{...p,entryTime:newEntry,exitTime:newExit,breaks:newBreaks}:p);
        await setDoc(histDayRef(pStoreId,editDay.dayId),{...day,queue:nq});
        setAllHist(prev=>({...prev,[pStoreId]:(prev[pStoreId]||[]).map(d=>d.id===editDay.dayId?{...d,queue:nq}:d)}));
      }
    }

    const en=newExit?new Date(newExit):new Date();
    const tM=en-new Date(newEntry);
    const bM=newBreaks.reduce((a,b)=>{const bE=b.end?new Date(b.end):new Date();return a+(bE-new Date(b.start));},0);
    const workedMin=Math.round(Math.max(0,tM-bM)/60000);
    setPResult(prev=>{
      if(!prev)return prev;
      const days=prev.days.map(d=>d.dayId===editDay.dayId?{...d,entryTime:newEntry,exitTime:newExit,breaks:newBreaks,workedMin}:d);
      return{days,daysCount:days.length,totalWorkedMin:days.reduce((a,d)=>a+d.workedMin,0)};
    });
    setEditSaving(false);setEditDay(null);
  };

  const runDash=useCallback(()=>{
    if(!dFrom||!dTo||dStores.length===0){setDData(null);return;}
    setDBusy(true);
    const from=new Date(dFrom+"T00:00:00"),to=new Date(dTo+"T23:59:59");
    const allSvcs=[],staffMap={},reasonMap={},storeMap={},allDemands=[];
    const hC={};for(let h=8;h<=21;h++)hC[h]=0;
    dStores.forEach(sid=>{
      const st=stores.find(s=>s.id===sid);storeMap[sid]={name:st?.name||sid,svc:0,sales:0};
      const hist=allHist[sid]||[];const cur=sessions[sid];const allD=[...hist];
      let curInRange=false;
      if(cur?.startedAt){const sd=new Date(cur.startedAt);if(sd>=from&&sd<=to){allD.push({...cur,id:"current"});curInRange=true;}}
      allD.forEach(day=>{
        const dd=new Date(day.startedAt);if(dd<from||dd>to)return;
        (day.services||[]).forEach(sv=>{
          allSvcs.push(sv);storeMap[sid].svc++;if(sv.isSale)storeMap[sid].sales++;
          const h=new Date(sv.startTime).getHours();if(h>=8&&h<=21)hC[h]=(hC[h]||0)+1;
          if(!sv.isSale){const l=sv.outcomeLabel||"Outro";reasonMap[l]=(reasonMap[l]||0)+1;}
          const key=`${sid}_${sv.salespersonName}`;
          if(!staffMap[key])staffMap[key]={name:sv.salespersonName,store:st?.name||sid,svc:0,sales:0};
          staffMap[key].svc++;if(sv.isSale)staffMap[key].sales++;
        });
        (day.demands||[]).forEach(d=>allDemands.push({...d,_store:st?.name||sid}));
      });
      // Demandas de hoje (ainda não fechadas) contam se a loja abriu dentro do período.
      if(curInRange)(demandsLive[sid]||[]).forEach(d=>allDemands.push({...d,_store:st?.name||sid}));
    });
    const tSvc=allSvcs.length,tSales=allSvcs.filter(s=>s.isSale).length;
    const conv=tSvc>0?Math.round((tSales/tSvc)*100):0;
    const durs=allSvcs.filter(s=>s.startTime&&s.endTime).map(s=>new Date(s.endTime)-new Date(s.startTime));
    const avgDur=durs.length?Math.round(durs.reduce((a,b)=>a+b,0)/durs.length/60000):0;
    const sortedR=Object.entries(reasonMap).sort((a,b)=>b[1]-a[1]);
    const sortedStaff=Object.values(staffMap).map(p=>({...p,conv:p.svc>0?Math.round((p.sales/p.svc)*100):0})).sort((a,b)=>b.sales-a.sales);
    const sortedStores=Object.values(storeMap).map(s=>({...s,conv:s.svc>0?Math.round((s.sales/s.svc)*100):0})).sort((a,b)=>b.sales-a.sales);
    const sortedH=Object.entries(hC).sort((a,b)=>parseInt(a)-parseInt(b));
    const maxH=Math.max(...sortedH.map(([,c])=>c),1);
    const peakH=sortedH.slice().sort((a,b)=>b[1]-a[1])[0];
    // Tarefas com SLA — tempo de resolução (criação → conclusão) e % no prazo.
    const doneTasks=allDemands.filter(d=>d.status==="CONCLUIDA_NO_PRAZO"||d.status==="CONCLUIDA_ATRASADA");
    const resTimes=doneTasks.filter(d=>d.createdAt&&d.completedAt).map(d=>new Date(d.completedAt)-new Date(d.createdAt));
    const avgResolution=resTimes.length?Math.round(resTimes.reduce((a,b)=>a+b,0)/resTimes.length/60000):0;
    const onTimePct=doneTasks.length?Math.round((doneTasks.filter(d=>d.status==="CONCLUIDA_NO_PRAZO").length/doneTasks.length)*100):0;
    const tTasksDone=doneTasks.length,tTasksLate=allDemands.filter(d=>d.status==="ATRASADA"||d.status==="ESCALADA").length;
    // Pontuação da equipe — quem concluiu cada tarefa e quantos pontos ganhou.
    const pointsMap={};
    doneTasks.forEach(d=>{
      if(!d.completedBy)return;
      const key=`${d._store}_${d.completedBy}`;
      if(!pointsMap[key])pointsMap[key]={name:d.completedBy,store:d._store,tasks:0,points:0};
      pointsMap[key].tasks++;pointsMap[key].points+=d.pointsAwarded||0;
    });
    const sortedPoints=Object.values(pointsMap).sort((a,b)=>b.points-a.points);
    setDData({tSvc,tSales,conv,avgDur,sortedR,sortedStaff,sortedStores,sortedH,maxH,peakH,avgResolution,onTimePct,tTasksDone,tTasksLate,sortedPoints});
    setDBusy(false);
  },[dFrom,dTo,dStores,allHist,sessions,demandsLive,stores]);

  const mx=sid=>{const d=sessions[sid]||{queue:[],services:[]};const sv=d.services||[],q=d.queue||[];const sa=sv.filter(s=>s.isSale).length;return{svc:sv.length,sales:sa,conv:sv.length>0?Math.round((sa/sv.length)*100):0,active:q.filter(p=>p.status!=="done").length,queue:q,services:sv,startedAt:d.startedAt};};
  const actSt=stores.filter(s=>s.active!==false);
  const allSvc=actSt.reduce((a,s)=>a+(sessions[s.id]?.services||[]).length,0);
  const allSales=actSt.reduce((a,s)=>a+(sessions[s.id]?.services||[]).filter(x=>x.isSale).length,0);
  const allConv=allSvc>0?Math.round((allSales/allSvc)*100):0;

  const addStore=async()=>{if(!newName.trim()||!newPin.trim())return;setSaving(true);await setDoc(storeRef(uid()),{name:newName.trim(),pin:newPin.trim(),active:true,createdAt:serverTimestamp()});setNewName("");setNewPin("");setShowAdd(false);setSaving(false);};
  const saveEdit=async()=>{if(!editSt)return;setSaving(true);await setDoc(storeRef(editSt.id),{name:editSt.name,pin:editSt.pin},{merge:true});setEditSt(null);setSaving(false);};
  const toggleActive=async s=>await setDoc(storeRef(s.id),{active:!s.active},{merge:true});

  // Keep the open "Equipe" modal reflecting live Firestore data (roster edits
  // from another tab/device, or our own writes coming back through onSnapshot).
  useEffect(()=>{
    setTeamStore(prev=>{
      if(!prev)return prev;
      return stores.find(s=>s.id===prev.id)||prev;
    });
  },[stores]);

  const addMember=async()=>{
    const name=newMemberName.trim();if(!name||!teamStore)return;
    const roster=teamStore.roster||[];
    if(roster.some(m=>m.name.toLowerCase()===name.toLowerCase()))return; // já cadastrada
    const nr=[...roster,{id:uid(),name}];
    await setDoc(storeRef(teamStore.id),{roster:nr},{merge:true});
    setNewMemberName("");
  };
  const removeMember=async(id)=>{
    if(!teamStore)return;
    const nr=(teamStore.roster||[]).filter(m=>m.id!==id);
    await setDoc(storeRef(teamStore.id),{roster:nr},{merge:true});
  };

  const TABS=[{id:"overview",label:"Hoje",icon:"chart"},{id:"dashboard",label:"Dashboard",icon:"trend"},{id:"ponto",label:"Ponto",icon:"clock"},{id:"history",label:"Histórico",icon:"cal"},{id:"stores",label:"Lojas",icon:"store"}];

  if(tab==="detail"&&detailStore){const m=mx(detailStore.id);const dm=demandsLive[detailStore.id]||[];return(<AppShell><Topbar title={detailStore.name} sub={`Dia atual · desde ${fmtTime(m.startedAt)}`} actions={<><Btn variant="ghost" style={{display:"flex",alignItems:"center",gap:5}} onClick={()=>setTab("overview")}><Icon name="back" size={13} color={VI.muted}/>Painel</Btn><Btn variant="ghost" style={{display:"flex",alignItems:"center",gap:5}} onClick={()=>exportPDF(detailStore.name,m.queue,m.services,m.startedAt,dm)}><Icon name="print" size={13} color={VI.muted}/>PDF</Btn></>}/><StatsRow items={[{num:m.svc,label:"Atendimentos"},{num:m.sales,label:"Vendas",color:VI.green},{num:`${m.conv}%`,label:"Conversão"},{num:m.active,label:"Em turno"}]}/><ReportView services={m.services} queue={m.queue} tSvc={m.svc} tSales={m.sales} conv={m.conv} demands={dm}/></AppShell>);}
  if(tab==="histDetail"&&detailRec){const{storeName,record:rec}=detailRec;const sv=rec.services||[],q=rec.queue||[],dm=rec.demands||[];const ts=sv.length,tsa=sv.filter(s=>s.isSale).length,cr=ts>0?Math.round((tsa/ts)*100):0;return(<AppShell><Topbar title={storeName} sub={`${fmtShort(rec.startedAt)} · ${fmtTime(rec.startedAt)} – ${fmtTime(rec.closedAt)}`} actions={<><Btn variant="ghost" style={{display:"flex",alignItems:"center",gap:5}} onClick={()=>setTab("history")}><Icon name="back" size={13} color={VI.muted}/>Histórico</Btn><Btn variant="ghost" style={{display:"flex",alignItems:"center",gap:5}} onClick={()=>exportPDF(storeName,q,sv,rec.startedAt,dm)}><Icon name="print" size={13} color={VI.muted}/>PDF</Btn></>}/><StatsRow items={[{num:ts,label:"Atendimentos"},{num:tsa,label:"Vendas",color:VI.green},{num:`${cr}%`,label:"Conversão"},{num:q.length,label:"Funcionárias"}]}/><ReportView services={sv} queue={q} tSvc={ts} tSales={tsa} conv={cr} demands={dm}/></AppShell>);}

  return(<AppShell>
    <Topbar title="Painel Admin" sub={<span style={{textTransform:"capitalize"}}>{fmtDate(now)}</span>}
      actions={<>
        {TABS.map(t=><Btn key={t.id} variant="ghost" style={{display:"flex",alignItems:"center",gap:5,...(tab===t.id?{borderColor:VI.terra,color:VI.terra}:{})}} onClick={()=>setTab(t.id)}><Icon name={t.icon} size={13} color={tab===t.id?VI.terra:VI.muted}/>{t.label}</Btn>)}
        <Btn variant="ghost" style={{padding:"9px 10px",display:"flex",alignItems:"center"}} onClick={onLogout}><Icon name="logout" size={13} color={VI.muted}/></Btn>
      </>}/>

    {tab==="overview"&&<>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,margin:"18px 22px 0"}}>
        {[{num:actSt.length,label:"Lojas Ativas"},{num:allSvc,label:"Atendimentos"},{num:allSales,label:"Vendas",color:VI.green},{num:`${allConv}%`,label:"Conversão"}].map((s,i)=>(
          <div key={i} style={{background:VI.surface,border:`1px solid ${VI.border}`,borderRadius:12,padding:"14px 10px",textAlign:"center"}}>
            <div style={{fontSize:24,fontWeight:700,color:s.color||VI.carvao,letterSpacing:"-0.02em",lineHeight:1}}>{s.num}</div>
            <div style={{fontSize:10,color:VI.muted,textTransform:"uppercase",marginTop:4}}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{padding:"18px 22px"}}>
        <div style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:VI.muted,marginBottom:10}}>Lojas</div>
        {stores.length===0&&<div style={{textAlign:"center",padding:"40px 20px",color:VI.muted}}><Icon name="store" size={32} color={VI.border} sw={1}/><p style={{marginTop:10}}>Nenhuma loja cadastrada.</p><Btn variant="accent" style={{display:"inline-flex",alignItems:"center",gap:5,marginTop:14}} onClick={()=>setTab("stores")}><Icon name="plus" size={13} color="#fff"/>Criar loja</Btn></div>}
        {stores.map(s=>{const m=mx(s.id);const cc=m.conv>=60?VI.green:m.conv>=40?VI.yellow:VI.red;return(
          <div key={s.id} onClick={()=>{setDetailStore(s);setTab("detail");}}
            style={{background:VI.surface,border:`1px solid ${VI.border}`,borderRadius:12,padding:"13px 16px",marginBottom:7,cursor:"pointer",opacity:s.active===false?.5:1,transition:"border-color .2s"}}
            onMouseEnter={e=>e.currentTarget.style.borderColor=VI.terra}
            onMouseLeave={e=>e.currentTarget.style.borderColor=VI.border}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontWeight:600,fontSize:14,color:VI.carvao}}>{s.name}</div>
                {s.active===false?<div style={{fontSize:11,color:VI.muted,marginTop:2}}>Inativa</div>
                  :m.active>0?<div style={{fontSize:11,color:VI.muted,marginTop:2,display:"flex",alignItems:"center",gap:4}}><span style={{width:5,height:5,borderRadius:"50%",background:VI.green,display:"inline-block"}}/>{m.active} em turno · desde {fmtTime(m.startedAt)}</div>
                  :<div style={{fontSize:11,color:VI.muted,marginTop:2}}>Sem atividade</div>}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                {m.svc>0&&<div style={{display:"flex",gap:14}}>{[{v:m.svc,l:"Atend."},{v:m.sales,l:"Vendas",c:VI.green},{v:`${m.conv}%`,l:"Conv.",c:cc}].map(({v,l,c})=><div key={l} style={{textAlign:"center"}}><div style={{fontSize:18,fontWeight:700,color:c||VI.carvao,letterSpacing:"-0.02em"}}>{v}</div><div style={{fontSize:10,color:VI.muted,textTransform:"uppercase"}}>{l}</div></div>)}</div>}
                <Icon name="chevR" size={15} color={VI.border}/>
              </div>
            </div>
          </div>
        );})}
      </div>
    </>}

    {tab==="history"&&<div style={{padding:"18px 22px"}}>
      <div style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:VI.muted,marginBottom:12}}>Dias encerrados</div>
      {stores.every(s=>(histories[s.id]||[]).length===0)&&<div style={{textAlign:"center",padding:"40px",color:VI.muted}}><Icon name="cal" size={32} color={VI.border} sw={1}/><p style={{marginTop:10}}>Nenhum dia encerrado ainda.</p></div>}
      {stores.map(s=>{const hist=histories[s.id]||[];if(hist.length===0)return null;const open=histStore===s.id;return(
        <div key={s.id} style={{marginBottom:10}}>
          <button onClick={()=>setHistStore(open?null:s.id)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",width:"100%",background:VI.surface,border:`1px solid ${VI.border}`,borderRadius:10,padding:"12px 14px",cursor:"pointer",fontFamily:"inherit",color:VI.carvao}}>
            <span style={{fontWeight:600,fontSize:14}}>{s.name}</span>
            <div style={{display:"flex",alignItems:"center",gap:7}}><span style={{fontSize:12,color:VI.muted}}>{hist.length} dia{hist.length!==1?"s":""}</span><Icon name={open?"chevD":"chevR"} size={13} color={VI.muted}/></div>
          </button>
          {open&&<div style={{marginTop:4}}>{hist.map(rec=>{const sv=rec.services||[],sa=sv.filter(s=>s.isSale).length,cr=sv.length>0?Math.round((sa/sv.length)*100):0,cc=cr>=60?VI.green:cr>=40?VI.yellow:VI.red;return(
            <div key={rec.id} onClick={()=>{setDetailRec({storeName:s.name,record:rec});setTab("histDetail");}}
              style={{background:VI.surfaceAlt,border:`1px solid ${VI.border}`,borderRadius:8,padding:"10px 13px",marginBottom:5,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",transition:"border-color .2s"}}
              onMouseEnter={e=>e.currentTarget.style.borderColor=VI.terra}
              onMouseLeave={e=>e.currentTarget.style.borderColor=VI.border}>
              <div><div style={{fontWeight:500,fontSize:13,color:VI.carvao}}>{fmtShort(rec.startedAt)}</div><div style={{fontSize:11,color:VI.muted,marginTop:1}}>{fmtTime(rec.startedAt)} – {fmtTime(rec.closedAt)}</div></div>
              <div style={{display:"flex",gap:12}}>{[{v:sv.length,l:"Atend."},{v:sa,l:"Vendas",c:VI.green},{v:`${cr}%`,l:"Conv.",c:cc}].map(({v,l,c})=><div key={l} style={{textAlign:"center"}}><div style={{fontSize:16,fontWeight:700,color:c||VI.carvao}}>{v}</div><div style={{fontSize:10,color:VI.muted,textTransform:"uppercase"}}>{l}</div></div>)}</div>
            </div>);})}</div>}
        </div>
      );})}
    </div>}

    {tab==="dashboard"&&<div style={{padding:"18px 22px"}}>
      <div style={{background:VI.surface,border:`1px solid ${VI.border}`,borderRadius:12,padding:18,marginBottom:12}}>
        <div style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:VI.muted,marginBottom:12}}>Filtros</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
          {[["Data inicial",dFrom,setDFrom],["Data final",dTo,setDTo]].map(([l,v,s])=>(
            <div key={l}><div style={{fontSize:11,color:VI.muted,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.05em"}}>{l}</div>
            <input type="date" value={v} onChange={e=>s(e.target.value)} style={{width:"100%",background:VI.cream,border:`1px solid ${VI.border}`,borderRadius:7,padding:"10px 12px",color:VI.carvao,fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
          ))}
        </div>
        <div style={{fontSize:11,color:VI.muted,marginBottom:7,textTransform:"uppercase",letterSpacing:"0.05em"}}>Lojas</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:14}}>
          <button onClick={()=>setDStores(dStores.length===stores.length?[]:stores.map(s=>s.id))} style={{background:dStores.length===stores.length?`${VI.terra}18`:"transparent",border:`1px solid ${dStores.length===stores.length?VI.terra:VI.border}`,borderRadius:20,padding:"5px 12px",color:dStores.length===stores.length?VI.terra:VI.muted,fontSize:12,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>
            {dStores.length===stores.length?"Todas selecionadas":"Todas"}
          </button>
          {stores.map(s=>{const sel=dStores.includes(s.id);return(<button key={s.id} onClick={()=>setDStores(sel?dStores.filter(id=>id!==s.id):[...dStores,s.id])} style={{background:sel?`${VI.terra}18`:"transparent",border:`1px solid ${sel?VI.terra:VI.border}`,borderRadius:20,padding:"5px 12px",color:sel?VI.terra:VI.muted,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>{s.name}</button>);})}
        </div>
        <Btn variant="accent" style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:7}} disabled={!dFrom||!dTo||dStores.length===0||dBusy} onClick={runDash}>
          <Icon name="trend" size={13} color="#fff"/>{dBusy?"Calculando…":"Gerar dashboard"}
        </Btn>
      </div>

      {dData&&<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:12}}>
          {[{n:dData.tSvc,l:"Atendimentos",c:VI.carvao},{n:dData.tSales,l:"Vendas",c:VI.green},{n:`${dData.conv}%`,l:"Conversão",c:dData.conv>=60?VI.green:dData.conv>=40?VI.yellow:VI.red},{n:dData.avgDur>0?`${dData.avgDur}'`:"—",l:"Tempo Médio",c:VI.carvao}].map((k,i)=>(
            <div key={i} style={{background:VI.surface,border:`1px solid ${VI.border}`,borderRadius:12,padding:"14px 10px",textAlign:"center"}}>
              <div style={{fontSize:22,fontWeight:700,color:k.c,letterSpacing:"-0.03em",lineHeight:1}}>{k.n}</div>
              <div style={{fontSize:10,color:VI.muted,textTransform:"uppercase",marginTop:4}}>{k.l}</div>
            </div>
          ))}
        </div>
        <div style={{background:VI.surface,border:`1px solid ${VI.border}`,borderRadius:12,padding:18,marginBottom:10}}>
          <div style={{fontSize:10,color:VI.muted,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600,marginBottom:12}}>Tarefas (SLA)</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
            {[{n:dData.tTasksDone,l:"Concluídas",c:VI.carvao},{n:dData.avgResolution>0?`${dData.avgResolution}'`:"—",l:"Tempo de resolução",c:VI.carvao},{n:dData.tTasksDone>0?`${dData.onTimePct}%`:"—",l:"No prazo",c:dData.onTimePct>=80?VI.green:dData.onTimePct>=50?VI.yellow:VI.red}].map((k,i)=>(
              <div key={i} style={{textAlign:"center"}}>
                <div style={{fontSize:20,fontWeight:700,color:k.c,letterSpacing:"-0.02em",lineHeight:1}}>{k.n}</div>
                <div style={{fontSize:10,color:VI.muted,textTransform:"uppercase",marginTop:4}}>{k.l}</div>
              </div>
            ))}
          </div>
          {dData.tTasksLate>0&&<div style={{marginTop:12,fontSize:12,color:VI.red,display:"flex",alignItems:"center",gap:5}}><Icon name="clock" size={13} color={VI.red}/>{dData.tTasksLate} tarefa{dData.tTasksLate>1?"s":""} atrasada{dData.tTasksLate>1?"s":""} ou escalada{dData.tTasksLate>1?"s":""} no período (ainda em aberto).</div>}
        </div>
        {dData.sortedPoints.length>0&&<div style={{background:VI.surface,border:`1px solid ${VI.border}`,borderRadius:12,padding:18,marginBottom:10}}>
          <div style={{fontSize:10,color:VI.muted,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600,marginBottom:12}}>Pontuação da equipe (tarefas)</div>
          {dData.sortedPoints.map((p,i)=>(
            <div key={`${p.store}_${p.name}`} style={{display:"flex",alignItems:"center",gap:10,borderBottom:`1px solid ${VI.border}`,paddingBottom:8,marginBottom:8}}>
              <div style={{width:26,height:26,background:VI.surfaceAlt,borderRadius:5,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:600,color:VI.muted}}>
                {i===0?<Icon name="star" size={11} color={VI.gold} sw={2}/>:i+1}
              </div>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:500,color:VI.carvao}}>{p.name}</div>{dData.sortedStores.length>1&&<div style={{fontSize:11,color:VI.muted}}>{p.store}</div>}</div>
              <div style={{display:"flex",gap:8,flexShrink:0,fontSize:12,alignItems:"center"}}>
                <span style={{color:VI.muted}}>{p.tasks} tarefa{p.tasks!==1?"s":""}</span>
                <span style={{color:VI.terra,fontWeight:700,minWidth:44,textAlign:"right"}}>{p.points} pts</span>
              </div>
            </div>
          ))}
        </div>}
        {dData.sortedStores.length>1&&<div style={{background:VI.surface,border:`1px solid ${VI.border}`,borderRadius:12,padding:18,marginBottom:10}}>
          <div style={{fontSize:10,color:VI.muted,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600,marginBottom:12}}>Por loja</div>
          {dData.sortedStores.map((s,i)=>{const maxS=dData.sortedStores[0].sales||1;const cc=s.conv>=60?VI.green:s.conv>=40?VI.yellow:VI.red;return(
            <div key={s.name} style={{marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:13,fontWeight:500,color:VI.carvao}}>{i+1}. {s.name}</span><div style={{display:"flex",gap:10,fontSize:12}}><span style={{color:VI.muted}}>{s.svc}</span><span style={{color:VI.green,fontWeight:600}}>{s.sales} vendas</span><span style={{color:cc,fontWeight:600}}>{s.conv}%</span></div></div>
              <div style={{height:4,background:VI.surfaceAlt,borderRadius:99,overflow:"hidden"}}><div style={{height:"100%",width:`${Math.round((s.sales/maxS)*100)}%`,background:VI.terra,borderRadius:99}}/></div>
            </div>
          );})}
        </div>}
        <div style={{background:VI.surface,border:`1px solid ${VI.border}`,borderRadius:12,padding:18,marginBottom:10}}>
          <div style={{fontSize:10,color:VI.muted,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600,marginBottom:12}}>Movimento por hora</div>
          <div style={{display:"flex",alignItems:"flex-end",gap:4,height:68,marginBottom:5}}>
            {dData.sortedH.map(([h,c])=>{const ip=h===dData.peakH?.[0]&&c>0;const bh=dData.maxH>0?Math.max((c/dData.maxH)*56,c>0?3:0):0;return(
              <div key={h} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                <div style={{fontSize:9,color:VI.muted,opacity:c>0?1:0,fontWeight:700}}>{c>0?c:""}</div>
                <div style={{width:"100%",borderRadius:"2px 2px 0 0",height:bh,background:ip?VI.terra:c>0?VI.blush:VI.border,minHeight:c>0?3:0}}/>
                <div style={{fontSize:9,color:ip?VI.terra:VI.muted}}>{h}h</div>
              </div>
            );})}
          </div>
        </div>
        {dData.sortedR.length>0&&<div style={{background:VI.surface,border:`1px solid ${VI.border}`,borderRadius:12,padding:18,marginBottom:10}}>
          <div style={{fontSize:10,color:VI.muted,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600,marginBottom:12}}>Motivos de não venda</div>
          {(()=>{const total=dData.sortedR.reduce((a,[,c])=>a+c,0);const maxR=dData.sortedR[0]?.[1]||1;return dData.sortedR.map(([label,cnt])=>(
            <div key={label} style={{marginBottom:11}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}><span style={{color:VI.carvao}}>{label}</span><span style={{color:VI.muted}}>{cnt} ({Math.round((cnt/total)*100)}%)</span></div>
              <div style={{height:4,background:VI.surfaceAlt,borderRadius:99,overflow:"hidden"}}><div style={{height:"100%",width:`${Math.round((cnt/maxR)*100)}%`,background:VI.terra,borderRadius:99}}/></div>
            </div>
          ));})()}
        </div>}
        {dData.sortedStaff.length>0&&<div style={{background:VI.surface,border:`1px solid ${VI.border}`,borderRadius:12,padding:18,marginBottom:10}}>
          <div style={{fontSize:10,color:VI.muted,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600,marginBottom:12}}>Performance por vendedora</div>
          {dData.sortedStaff.map((p,i)=>{const cc=p.conv>=60?VI.green:p.conv>=40?VI.yellow:VI.red;return(
            <div key={p.name} style={{display:"flex",alignItems:"center",gap:10,borderBottom:`1px solid ${VI.border}`,paddingBottom:8,marginBottom:8}}>
              <div style={{width:26,height:26,background:VI.surfaceAlt,borderRadius:5,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:600,color:VI.muted}}>
                {i===0?<Icon name="star" size={11} color={VI.gold} sw={2}/>:i+1}
              </div>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:500,color:VI.carvao}}>{p.name}</div>{dData.sortedStores.length>1&&<div style={{fontSize:11,color:VI.muted}}>{p.store}</div>}</div>
              <div style={{display:"flex",gap:8,flexShrink:0,fontSize:12}}>
                <span style={{color:VI.muted}}>{p.svc} atend.</span>
                <span style={{color:VI.green,fontWeight:600}}>{p.sales} vendas</span>
                <span style={{color:cc,fontWeight:600,minWidth:32,textAlign:"right"}}>{p.conv}%</span>
              </div>
            </div>
          );})}
        </div>}
      </>}
    </div>}

    {tab==="ponto"&&<div style={{padding:"18px 22px"}}>
      <div style={{background:VI.surface,border:`1px solid ${VI.border}`,borderRadius:12,padding:18,marginBottom:12}}>
        <div style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:VI.muted,marginBottom:12}}>Consultar ponto</div>
        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:VI.muted,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.05em"}}>Loja</div>
          <select value={pStoreId} onChange={e=>{setPStoreId(e.target.value);setPName("");setPResult(null);}}
            style={{display:"block",width:"100%",background:VI.cream,border:`1px solid ${VI.border}`,borderRadius:7,padding:"10px 12px",fontSize:13,fontFamily:"inherit",cursor:"pointer",color:pStoreId?VI.carvao:VI.muted,outline:"none",boxSizing:"border-box"}}>
            <option value="">Selecione a loja</option>
            {stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:VI.muted,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.05em"}}>Vendedora</div>
          <select value={pName} onChange={e=>setPName(e.target.value)} disabled={!pStoreId}
            style={{display:"block",width:"100%",background:VI.cream,border:`1px solid ${VI.border}`,borderRadius:7,padding:"10px 12px",fontSize:13,fontFamily:"inherit",cursor:pStoreId?"pointer":"not-allowed",color:pName?VI.carvao:VI.muted,outline:"none",boxSizing:"border-box"}}>
            <option value="">Selecione a vendedora</option>
            {pRoster.map(m=><option key={m.id} value={m.name}>{m.name}</option>)}
          </select>
          {pStoreId&&pRoster.length===0&&<p style={{color:VI.muted,fontSize:12,marginTop:6}}>Esta loja ainda não tem equipe cadastrada.</p>}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
          {[["Data inicial",pFrom,setPFrom],["Data final",pTo,setPTo]].map(([l,v,s])=>(
            <div key={l}><div style={{fontSize:11,color:VI.muted,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.05em"}}>{l}</div>
            <input type="date" value={v} onChange={e=>s(e.target.value)} style={{width:"100%",background:VI.cream,border:`1px solid ${VI.border}`,borderRadius:7,padding:"10px 12px",color:VI.carvao,fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
          ))}
        </div>
        <Btn variant="accent" style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:7}} disabled={!pStoreId||!pName||!pFrom||!pTo||pBusy} onClick={runPonto}>
          <Icon name="clock" size={13} color="#fff"/>{pBusy?"Buscando…":"Buscar ponto"}
        </Btn>
      </div>

      {pResult&&<div style={{background:VI.surface,border:`1px solid ${VI.border}`,borderRadius:12,padding:18}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,gap:10,flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:14,fontWeight:600,color:VI.carvao}}>{pName}</div>
            <div style={{display:"flex",gap:16,fontSize:12,marginTop:2}}>
              <span style={{color:VI.muted}}>{pResult.daysCount} dia{pResult.daysCount!==1?"s":""}</span>
              <span style={{color:VI.terra,fontWeight:700}}>{Math.floor(pResult.totalWorkedMin/60)}h {pResult.totalWorkedMin%60}m total</span>
            </div>
          </div>
          <Btn variant="ghost" style={{display:"flex",alignItems:"center",gap:5}} onClick={()=>exportPontoPDF(stores.find(s=>s.id===pStoreId)?.name||"",pName,new Date(pFrom+"T00:00:00"),new Date(pTo+"T23:59:59"),pResult.days,pResult.totalWorkedMin)}>
            <Icon name="print" size={13} color={VI.muted}/>Exportar folha de ponto
          </Btn>
        </div>
        {pResult.days.length===0&&<p style={{color:VI.muted,fontSize:13,textAlign:"center",padding:"20px 0"}}>Nenhum registro de ponto no período.</p>}
        {pResult.days.map((d,i)=>{
          const wh=Math.floor(d.workedMin/60),wm=d.workedMin%60;
          return(<div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"10px 0",borderBottom:i<pResult.days.length-1?`1px solid ${VI.border}`:"none"}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4,gap:10}}>
                <span style={{fontSize:13,fontWeight:500,color:VI.carvao,textTransform:"capitalize"}}>{fmtShort(d.date)}</span>
                <span style={{fontSize:13,fontWeight:600,color:VI.carvao,flexShrink:0}}>{wh>0?`${wh}h ${wm}m`:`${wm}m`}</span>
              </div>
              <div style={{fontSize:12,color:VI.muted}}>
                Entrada {fmtTime(d.entryTime)}
                {d.breaks.map((b,j)=>` · Pausa ${j+1}: ${fmtTime(b.start)}–${b.end?fmtTime(b.end):"em andamento"}`)}
                {d.exitTime?` · Saída ${fmtTime(d.exitTime)}`:" · ainda em turno"}
                {(!d.exitTime||d.breaks.some(b=>!b.end))&&<span style={{color:VI.red,fontWeight:600}}> · marcação incompleta</span>}
              </div>
            </div>
            <button onClick={()=>openEditDay(d)} title="Corrigir ponto" style={{background:"none",border:`1px solid ${VI.border}`,borderRadius:7,padding:"6px 9px",cursor:"pointer",display:"flex",alignItems:"center",flexShrink:0}}>
              <Icon name="edit" size={13} color={VI.muted}/>
            </button>
          </div>);
        })}
      </div>}

      {editDay&&<Modal onClose={closeEditDay}>
        <MIcon name="clock"/>
        <h2 style={{fontSize:17,fontWeight:600,color:VI.carvao,marginBottom:5}}>Corrigir ponto</h2>
        <p style={{color:VI.muted,fontSize:13,marginBottom:18,textTransform:"capitalize"}}>{pName} · {fmtShort(editDay.date)}</p>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
          <div><div style={{fontSize:11,color:VI.muted,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.05em"}}>Entrada</div>
            <input type="time" value={editEntry} onChange={e=>setEditEntry(e.target.value)} style={{width:"100%",background:VI.cream,border:`1px solid ${VI.border}`,borderRadius:7,padding:"10px 12px",color:VI.carvao,fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
          <div><div style={{fontSize:11,color:VI.muted,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.05em"}}>Saída</div>
            <input type="time" value={editExit} onChange={e=>setEditExit(e.target.value)} style={{width:"100%",background:VI.cream,border:`1px solid ${VI.border}`,borderRadius:7,padding:"10px 12px",color:VI.carvao,fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
        </div>

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{fontSize:11,color:VI.muted,textTransform:"uppercase",letterSpacing:"0.05em"}}>Pausas</div>
          <button onClick={addEditBreak} style={{background:"none",border:"none",color:VI.terra,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:3}}><Icon name="plus" size={12} color={VI.terra}/>Adicionar</button>
        </div>
        {editBreaks.length===0&&<p style={{color:VI.muted,fontSize:12,marginBottom:10}}>Nenhuma pausa registrada.</p>}
        {editBreaks.map((b,i)=>(
          <div key={i} style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
            <input type="time" value={b.start} onChange={e=>updateEditBreak(i,"start",e.target.value)} style={{flex:1,background:VI.cream,border:`1px solid ${VI.border}`,borderRadius:7,padding:"9px 10px",color:VI.carvao,fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
            <span style={{color:VI.muted,fontSize:12}}>até</span>
            <input type="time" value={b.end} onChange={e=>updateEditBreak(i,"end",e.target.value)} style={{flex:1,background:VI.cream,border:`1px solid ${VI.border}`,borderRadius:7,padding:"9px 10px",color:VI.carvao,fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
            <button onClick={()=>removeEditBreak(i)} style={{background:"none",border:"none",cursor:"pointer",padding:4,display:"flex",flexShrink:0}}><Icon name="x" size={13} color={VI.muted}/></button>
          </div>
        ))}

        <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:16}}>
          <Btn variant="ghost" onClick={closeEditDay}>Cancelar</Btn>
          <Btn variant="accent" disabled={!editEntry||editSaving} onClick={saveEditDay}>{editSaving?"Salvando…":"Salvar correção"}</Btn>
        </div>
      </Modal>}
    </div>}

    {tab==="stores"&&<div style={{padding:"18px 22px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:VI.muted}}>Lojas ({stores.length})</div>
        <Btn variant="accent" style={{display:"flex",alignItems:"center",gap:5}} onClick={()=>setShowAdd(true)}><Icon name="plus" size={13} color="#fff"/>Nova loja</Btn>
      </div>
      {stores.length===0&&<div style={{textAlign:"center",padding:32,color:VI.muted}}><Icon name="store" size={30} color={VI.border} sw={1}/><p style={{marginTop:10}}>Nenhuma loja cadastrada.</p></div>}
      {stores.map(s=>(
        <div key={s.id} style={{background:VI.surface,border:`1px solid ${VI.border}`,borderRadius:12,padding:"13px 15px",marginBottom:7,opacity:s.active===false?.55:1}}>
          {editSt?.id===s.id
            ?<div><div style={{display:"flex",gap:8,marginBottom:8}}><Inp value={editSt.name} style={{marginBottom:0,flex:1}} onChange={e=>setEditSt({...editSt,name:e.target.value})} placeholder="Nome"/><Inp value={editSt.pin} style={{marginBottom:0,width:95}} onChange={e=>setEditSt({...editSt,pin:e.target.value})} placeholder="PIN"/></div><div style={{display:"flex",gap:8}}><Btn variant="ghost" onClick={()=>setEditSt(null)}>Cancelar</Btn><Btn variant="accent" disabled={saving} onClick={saveEdit}>{saving?"Salvando…":"Salvar"}</Btn></div></div>
            :<div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div><div style={{fontWeight:600,fontSize:14,color:VI.carvao}}>{s.name}</div><div style={{fontSize:12,color:VI.muted,marginTop:2,display:"flex",alignItems:"center",gap:5}}>PIN: <code style={{background:VI.surfaceAlt,padding:"1px 7px",borderRadius:5,letterSpacing:"0.1em",border:`1px solid ${VI.border}`}}>{s.pin}</code>{s.active===false&&<span style={{color:VI.red}}>· Inativa</span>}</div></div>
                <div style={{display:"flex",gap:5}}><Btn variant="sm" style={{display:"flex",alignItems:"center",gap:4}} onClick={()=>setTeamStore(s)}><Icon name="users" size={11} color={VI.muted}/>Equipe{(s.roster||[]).length>0?` (${s.roster.length})`:""}</Btn><Btn variant="sm" style={{display:"flex",alignItems:"center",gap:4}} onClick={()=>setEditSt({id:s.id,name:s.name,pin:s.pin})}><Icon name="edit" size={11} color={VI.muted}/>Editar</Btn><Btn variant="sm" style={{color:s.active===false?VI.green:VI.yellow}} onClick={()=>toggleActive(s)}>{s.active===false?"Ativar":"Pausar"}</Btn></div>
              </div>}
        </div>
      ))}
    </div>}

    {showAdd&&<Modal onClose={()=>setShowAdd(false)}><MIcon name="store"/><h2 style={{fontSize:17,fontWeight:600,color:VI.carvao,marginBottom:5}}>Nova loja</h2><p style={{color:VI.muted,fontSize:13,marginBottom:18}}>Defina o nome e o PIN de acesso</p><Inp autoFocus value={newName} placeholder="Nome da loja" onChange={e=>setNewName(e.target.value)}/><Inp value={newPin} placeholder="PIN (ex: 1234)" onChange={e=>setNewPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addStore()}/><div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={()=>setShowAdd(false)}>Cancelar</Btn><Btn variant="accent" disabled={saving||!newName.trim()||!newPin.trim()} onClick={addStore}>{saving?"Salvando…":"Criar loja"}</Btn></div></Modal>}

    {teamStore&&<Modal onClose={()=>{setTeamStore(null);setNewMemberName("");}}>
      <MIcon name="users"/>
      <h2 style={{fontSize:17,fontWeight:600,color:VI.carvao,marginBottom:5}}>Equipe — {teamStore.name}</h2>
      <p style={{color:VI.muted,fontSize:13,marginBottom:18}}>Cadastre as vendedoras que poderão ser selecionadas no registro diário desta loja</p>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <Inp style={{marginBottom:0,flex:1}} value={newMemberName} placeholder="Nome da vendedora"
          onChange={e=>setNewMemberName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addMember()}/>
        <Btn variant="accent" style={{flexShrink:0,display:"flex",alignItems:"center",gap:5}} onClick={addMember}>
          <Icon name="plus" size={13} color="#fff"/>Adicionar
        </Btn>
      </div>
      <div style={{maxHeight:280,overflowY:"auto"}}>
        {(teamStore.roster||[]).length===0&&<p style={{color:VI.muted,fontSize:13,textAlign:"center",padding:"10px 0"}}>Nenhuma vendedora cadastrada</p>}
        {(teamStore.roster||[]).map(m=>(
          <div key={m.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:`1px solid ${VI.border}`}}>
            <span style={{fontSize:14,color:VI.carvao}}>{m.name}</span>
            <button onClick={()=>removeMember(m.id)}
              style={{background:"none",border:`1px solid ${VI.border}`,borderRadius:6,padding:"4px 9px",color:VI.red,fontSize:11,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:4}}>
              <Icon name="x" size={10} color={VI.red}/>Remover
            </button>
          </div>
        ))}
      </div>
      <div style={{display:"flex",justifyContent:"flex-end",marginTop:18}}>
        <Btn variant="ghost" onClick={()=>{setTeamStore(null);setNewMemberName("");}}>Fechar</Btn>
      </div>
    </Modal>}
  </AppShell>);
}
function SupervisaoDashboard({onLogout}) {
  const [stores,setStores]=useState([]);
  const [demandsMap,setDemandsMap]=useState({});
  const [sessions,setSessions]=useState({});
  const [now,setNow]=useState(new Date());
  const [detailStore,setDetailStore]=useState(null);
  const [showNew,setShowNew]=useState(false);
  const [newStoreId,setNewStoreId]=useState("");
  const [quickIdx,setQuickIdx]=useState(null);
  const [title,setTitle]=useState("");
  const [description,setDescription]=useState("");
  const [dueDate,setDueDate]=useState("");
  const [dueTime,setDueTime]=useState("");
  const [assignTo,setAssignTo]=useState("");
  const [saving,setSaving]=useState(false);

  useEffect(()=>{const t=setInterval(()=>setNow(new Date()),30000);return()=>clearInterval(t);},[]);
  useEffect(()=>{const u=onSnapshot(collection(db,"stores"),snap=>{setStores(snap.docs.map(d=>({id:d.id,...d.data()})).filter(s=>s.active!==false).sort((a,b)=>a.name.localeCompare(b.name)));});return()=>u();},[]);
  useEffect(()=>{
    if(stores.length===0)return;
    const us=stores.map(s=>onSnapshot(demandsRef(s.id),snap=>{
      setDemandsMap(prev=>({...prev,[s.id]:snap.exists()?(snap.data().items||[]):[]}));
    }));
    return()=>us.forEach(u=>u());
  },[stores]);
  useEffect(()=>{
    if(stores.length===0)return;
    const us=stores.map(s=>onSnapshot(sessionRef(s.id),snap=>{
      setSessions(prev=>({...prev,[s.id]:snap.exists()?snap.data():{queue:[],services:[]}}));
    }));
    return()=>us.forEach(u=>u());
  },[stores]);

  // Mantém a loja aberta em detalhe sincronizada caso ela mude na lista.
  useEffect(()=>{
    setDetailStore(prev=>{
      if(!prev)return prev;
      return stores.find(s=>s.id===prev.id)||prev;
    });
  },[stores]);

  const countsFor=(sid)=>{
    const items=demandsMap[sid]||[];
    return{
      pendentes:items.filter(d=>d.status==="PENDENTE").length,
      atrasadas:items.filter(d=>d.status==="ATRASADA"||d.status==="ESCALADA").length,
      concluidas:items.filter(d=>d.status==="CONCLUIDA_NO_PRAZO"||d.status==="CONCLUIDA_ATRASADA").length,
    };
  };
  const totals=stores.reduce((a,s)=>{const c=countsFor(s.id);a.pendentes+=c.pendentes;a.atrasadas+=c.atrasadas;a.concluidas+=c.concluidas;return a;},{pendentes:0,atrasadas:0,concluidas:0});

  // KPIs de Fila de Vez (atendimento ao cliente), ao vivo, dia atual.
  const mxQ=(sid)=>{
    const d=sessions[sid]||{queue:[],services:[]};
    const sv=d.services||[],q=d.queue||[];
    const sa=sv.filter(s=>s.isSale).length;
    return{svc:sv.length,sales:sa,conv:sv.length>0?Math.round((sa/sv.length)*100):0,active:q.filter(p=>p.status!=="done").length,startedAt:d.startedAt};
  };
  const queueTotals=stores.reduce((a,s)=>{const m=mxQ(s.id);a.svc+=m.svc;a.sales+=m.sales;return a;},{svc:0,sales:0});
  const queueConv=queueTotals.svc>0?Math.round((queueTotals.sales/queueTotals.svc)*100):0;

  const openNew=(storeId)=>{
    setNewStoreId(storeId||"");setQuickIdx(null);setTitle("");setDescription("");setAssignTo("");
    const d=new Date(Date.now()+2*3600000);
    setDueDate(d.toISOString().slice(0,10));
    setDueTime(`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`);
    setShowNew(true);
  };
  const pickQuick=(i)=>{setQuickIdx(i);setTitle(QUICK_TASKS[i].title);setDescription(QUICK_TASKS[i].description);};

  const createDemand=async()=>{
    if(!newStoreId||!title.trim()||!dueDate||!dueTime)return;
    setSaving(true);
    const dueAt=new Date(`${dueDate}T${dueTime}:00`).toISOString();
    const current=demandsMap[newStoreId]||[];
    // Demandas avulsas fecham direto quando a loja marca como realizada.
    const now=new Date().toISOString();
    const item={id:uid(),type:"AVULSA",title:title.trim(),description:description.trim(),assignedTo:assignTo||null,sentBy:"Supervisão",requestedAt:now,createdAt:now,completedAt:null,dueAt,status:"PENDENTE",note:"",pointsAwarded:0,completedBy:null};
    await setDoc(demandsRef(newStoreId),{items:[...current,item],updatedAt:serverTimestamp()});
    setSaving(false);setShowNew(false);
  };

  if(detailStore){
    const items=demandsMap[detailStore.id]||[];
    const groups={
      atrasadas:items.filter(d=>d.status==="ATRASADA"||d.status==="ESCALADA"),
      pendentes:items.filter(d=>d.status==="PENDENTE").sort((a,b)=>new Date(a.dueAt)-new Date(b.dueAt)),
      concluidas:items.filter(d=>d.status==="CONCLUIDA_NO_PRAZO"||d.status==="CONCLUIDA_ATRASADA"),
    };
    const q=mxQ(detailStore.id);
    return(<AppShell>
      <Topbar title={detailStore.name} sub="Demandas da loja"
        actions={<>
          <Btn variant="ghost" style={{display:"flex",alignItems:"center",gap:5}} onClick={()=>setDetailStore(null)}><Icon name="back" size={13} color={VI.muted}/>Painel</Btn>
          <Btn variant="accent" style={{display:"flex",alignItems:"center",gap:5}} onClick={()=>openNew(detailStore.id)}><Icon name="plus" size={13} color="#fff"/>Nova demanda</Btn>
        </>}/>
      <StatsRow items={[{num:q.svc,label:"Atendimentos"},{num:q.sales,label:"Vendas",color:VI.green},{num:`${q.conv}%`,label:"Conversão"},{num:q.active,label:"Em turno"}]}/>
      <div style={{padding:"14px 22px 60px"}}>
        {groups.atrasadas.length>0&&<TaskSection title="Atrasadas" items={groups.atrasadas} now={now}/>}
        <TaskSection title="Pendentes" items={groups.pendentes} now={now} empty="Nenhuma tarefa pendente"/>
        {groups.concluidas.length>0&&<TaskSection title="Concluídas hoje" items={groups.concluidas} now={now} dim/>}
      </div>
      {showNew&&<NewDemandModal stores={stores} storeId={newStoreId} setStoreId={setNewStoreId}
        quickIdx={quickIdx} onPickQuick={pickQuick}
        title={title} setTitle={setTitle} description={description} setDescription={setDescription}
        dueDate={dueDate} setDueDate={setDueDate} dueTime={dueTime} setDueTime={setDueTime}
        assignTo={assignTo} setAssignTo={setAssignTo}
        saving={saving} onCancel={()=>setShowNew(false)} onCreate={createDemand}/>}
    </AppShell>);
  }

  return(<AppShell>
    <Topbar title="Supervisão" sub={<span style={{textTransform:"capitalize"}}>{fmtDate(now)}</span>}
      actions={<>
        <Btn variant="accent" style={{display:"flex",alignItems:"center",gap:5}} onClick={()=>openNew("")}><Icon name="plus" size={13} color="#fff"/>Nova demanda</Btn>
        <Btn variant="ghost" style={{padding:"9px 10px",display:"flex",alignItems:"center"}} onClick={onLogout}><Icon name="logout" size={13} color={VI.muted}/></Btn>
      </>}/>
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,margin:"18px 22px 0"}}>
      {[{num:totals.pendentes,label:"Pendentes"},{num:totals.atrasadas,label:"Atrasadas",color:totals.atrasadas?VI.red:VI.carvao},{num:totals.concluidas,label:"Concluídas hoje",color:VI.green}].map((s,i)=>(
        <div key={i} style={{background:VI.surface,border:`1px solid ${VI.border}`,borderRadius:12,padding:"14px 10px",textAlign:"center"}}>
          <div style={{fontSize:24,fontWeight:700,color:s.color||VI.carvao,letterSpacing:"-0.02em",lineHeight:1}}>{s.num}</div>
          <div style={{fontSize:10,color:VI.muted,textTransform:"uppercase",marginTop:4}}>{s.label}</div>
        </div>
      ))}
    </div>

    <div style={{padding:"18px 22px 0"}}>
      <div style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:VI.muted,marginBottom:10}}>Fila de vez — hoje</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
        {[{num:queueTotals.svc,label:"Atendimentos"},{num:queueTotals.sales,label:"Vendas",color:VI.green},{num:`${queueConv}%`,label:"Conversão",color:queueConv>=60?VI.green:queueConv>=40?VI.yellow:VI.red}].map((s,i)=>(
          <div key={i} style={{background:VI.surface,border:`1px solid ${VI.border}`,borderRadius:12,padding:"14px 10px",textAlign:"center"}}>
            <div style={{fontSize:24,fontWeight:700,color:s.color||VI.carvao,letterSpacing:"-0.02em",lineHeight:1}}>{s.num}</div>
            <div style={{fontSize:10,color:VI.muted,textTransform:"uppercase",marginTop:4}}>{s.label}</div>
          </div>
        ))}
      </div>
    </div>

    <div style={{padding:"18px 22px"}}>
      <div style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:VI.muted,marginBottom:10}}>Lojas</div>
      {stores.length===0&&<div style={{textAlign:"center",padding:"40px 20px",color:VI.muted}}><Icon name="store" size={32} color={VI.border} sw={1}/><p style={{marginTop:10}}>Nenhuma loja cadastrada.</p></div>}
      {stores.map(s=>{
        const c=countsFor(s.id);
        const q=mxQ(s.id);
        const qc=q.conv>=60?VI.green:q.conv>=40?VI.yellow:VI.red;
        return(<div key={s.id} onClick={()=>setDetailStore(s)}
          style={{background:VI.surface,border:`1px solid ${VI.border}`,borderRadius:12,padding:"13px 16px",marginBottom:7,cursor:"pointer",transition:"border-color .2s"}}
          onMouseEnter={e=>e.currentTarget.style.borderColor=VI.terra}
          onMouseLeave={e=>e.currentTarget.style.borderColor=VI.border}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontWeight:600,fontSize:14,color:VI.carvao}}>{s.name}</div>
              {q.active>0?<div style={{fontSize:11,color:VI.muted,marginTop:2,display:"flex",alignItems:"center",gap:4}}><span style={{width:5,height:5,borderRadius:"50%",background:VI.green,display:"inline-block"}}/>{q.active} em turno · desde {fmtTime(q.startedAt)}</div>
                :<div style={{fontSize:11,color:VI.muted,marginTop:2}}>Sem atividade</div>}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              {q.svc>0&&<div style={{display:"flex",gap:14}}>{[{v:q.svc,l:"Atend."},{v:q.sales,l:"Vendas",c:VI.green},{v:`${q.conv}%`,l:"Conv.",c:qc}].map(({v,l,c})=><div key={l} style={{textAlign:"center"}}><div style={{fontSize:18,fontWeight:700,color:c||VI.carvao,letterSpacing:"-0.02em"}}>{v}</div><div style={{fontSize:10,color:VI.muted,textTransform:"uppercase"}}>{l}</div></div>)}</div>}
              {c.atrasadas>0&&<span style={{fontSize:11,fontWeight:700,padding:"3px 9px",borderRadius:5,background:VI.redBg,color:VI.red}}>{c.atrasadas} atrasada{c.atrasadas>1?"s":""}</span>}
              <span style={{fontSize:12,color:VI.muted}}>{c.pendentes} pendente{c.pendentes!==1?"s":""}</span>
              <Icon name="chevR" size={15} color={VI.border}/>
            </div>
          </div>
        </div>);
      })}
    </div>
    {showNew&&<NewDemandModal stores={stores} storeId={newStoreId} setStoreId={setNewStoreId}
      quickIdx={quickIdx} onPickQuick={pickQuick}
      title={title} setTitle={setTitle} description={description} setDescription={setDescription}
      dueDate={dueDate} setDueDate={setDueDate} dueTime={dueTime} setDueTime={setDueTime}
      assignTo={assignTo} setAssignTo={setAssignTo}
      saving={saving} onCancel={()=>setShowNew(false)} onCreate={createDemand}/>}
  </AppShell>);
}

function NewDemandModal({stores,storeId,setStoreId,quickIdx,onPickQuick,title,setTitle,description,setDescription,dueDate,setDueDate,dueTime,setDueTime,assignTo,setAssignTo,saving,onCancel,onCreate}) {
  const selectedStore=stores.find(s=>s.id===storeId);
  const roster=selectedStore?.roster||[];
  return(<Modal onClose={onCancel}>
    <MIcon name="bell"/>
    <h2 style={{fontSize:17,fontWeight:600,color:VI.carvao,marginBottom:5}}>Nova demanda</h2>
    <p style={{color:VI.muted,fontSize:13,marginBottom:16}}>Envie uma tarefa avulsa para a loja — montagem de vitrine, organização de seção, reposição direcionada etc. As 4 tarefas principais (limpeza, caixa, parcial e fechamento) já são automáticas.</p>

    <div style={{fontSize:11,color:VI.muted,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.05em"}}>Loja</div>
    <select value={storeId} onChange={e=>{setStoreId(e.target.value);setAssignTo("");}}
      style={{display:"block",width:"100%",background:VI.cream,border:`1px solid ${VI.border}`,borderRadius:8,padding:"11px 14px",fontSize:14,fontFamily:"inherit",marginBottom:14,cursor:"pointer",color:storeId?VI.carvao:VI.muted}}>
      <option value="">Selecione a loja</option>
      {stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
    </select>

    <div style={{fontSize:11,color:VI.muted,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.05em"}}>Designar a (opcional)</div>
    <select value={assignTo} onChange={e=>setAssignTo(e.target.value)} disabled={!storeId}
      style={{display:"block",width:"100%",background:VI.cream,border:`1px solid ${VI.border}`,borderRadius:8,padding:"11px 14px",fontSize:14,fontFamily:"inherit",marginBottom:14,cursor:storeId?"pointer":"not-allowed",color:assignTo?VI.carvao:VI.muted}}>
      <option value="">Aberta à equipe da loja</option>
      {roster.map(m=><option key={m.id} value={m.name}>{m.name}</option>)}
    </select>
    {storeId&&roster.length===0&&<p style={{color:VI.muted,fontSize:12,marginTop:-8,marginBottom:14}}>Esta loja ainda não tem equipe cadastrada.</p>}

    <div style={{fontSize:11,color:VI.muted,marginBottom:7,textTransform:"uppercase",letterSpacing:"0.05em"}}>Tipo rápido</div>
    <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:14}}>
      {QUICK_TASKS.map((q,i)=>(
        <button key={q.title} onClick={()=>onPickQuick(i)}
          style={{background:quickIdx===i?`${VI.terra}18`:"transparent",border:`1px solid ${quickIdx===i?VI.terra:VI.border}`,borderRadius:20,padding:"6px 12px",color:quickIdx===i?VI.terra:VI.muted,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
          {q.title}
        </button>
      ))}
    </div>

    <Inp placeholder="Título da tarefa" value={title} onChange={e=>setTitle(e.target.value)}/>
    <Inp placeholder="Descrição (opcional)" value={description} onChange={e=>setDescription(e.target.value)}/>

    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:6}}>
      <div><div style={{fontSize:11,color:VI.muted,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.05em"}}>Prazo — data</div>
        <input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)} style={{width:"100%",background:VI.cream,border:`1px solid ${VI.border}`,borderRadius:7,padding:"10px 12px",color:VI.carvao,fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
      <div><div style={{fontSize:11,color:VI.muted,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.05em"}}>Prazo — hora</div>
        <input type="time" value={dueTime} onChange={e=>setDueTime(e.target.value)} style={{width:"100%",background:VI.cream,border:`1px solid ${VI.border}`,borderRadius:7,padding:"10px 12px",color:VI.carvao,fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
    </div>

    <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:16}}>
      <Btn variant="ghost" onClick={onCancel}>Cancelar</Btn>
      <Btn variant="accent" disabled={!storeId||!title.trim()||!dueDate||!dueTime||saving} onClick={onCreate}>{saving?"Enviando…":"Enviar demanda"}</Btn>
    </div>
  </Modal>);
}

function exportPDF(storeName,queue,services,startedAt,demands=[]){
  const nS=services.filter(s=>!s.isSale);
  const tDone=demands.filter(d=>d.status==="CONCLUIDA_NO_PRAZO"||d.status==="CONCLUIDA_ATRASADA");
  const tPend=demands.filter(d=>d.status==="PENDENTE").length;
  const tLate=demands.filter(d=>d.status==="ATRASADA"||d.status==="ESCALADA").length;
  const tPoints=tDone.reduce((a,d)=>a+(d.pointsAwarded||0),0);
  const pointsByPerson={};
  tDone.forEach(d=>{if(!d.completedBy)return;if(!pointsByPerson[d.completedBy])pointsByPerson[d.completedBy]={name:d.completedBy,tasks:0,points:0};pointsByPerson[d.completedBy].tasks++;pointsByPerson[d.completedBy].points+=d.pointsAwarded||0;});
  const sortedTaskPoints=Object.values(pointsByPerson).sort((a,b)=>b.points-a.points);
  const tV=services.length,tSa=services.filter(s=>s.isSale).length;
  const cr=tV>0?Math.round((tSa/tV)*100):0;
  const dur=services.filter(s=>s.startTime&&s.endTime).map(s=>new Date(s.endTime)-new Date(s.startTime));
  const aD=dur.length?Math.round(dur.reduce((a,b)=>a+b,0)/dur.length/60000):0;
  const hC={};for(let h=8;h<=21;h++)hC[h]=0;
  services.forEach(s=>{const h=new Date(s.startTime).getHours();if(h>=8&&h<=21)hC[h]=(hC[h]||0)+1;});
  const hD=Object.entries(hC).sort((a,b)=>parseInt(a)-parseInt(b));
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
  const wD=cap(ref.toLocaleDateString("pt-BR",{weekday:"long"}));

  const cc=p=>(p>=60?"#2D7A4F":p>=40?"#A07820":"#B83232");
  const bar=(v,max,bg)=>`<div style="height:100%;width:${Math.round((v/max)*100)}%;background:${bg};border-radius:99px"></div>`;

  const html=`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Relatório — ${storeName}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;color:#2C2020;font-size:13px;line-height:1.5;background:#fff}
.pg{max-width:860px;margin:0 auto;padding:48px}
.rh{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:18px;border-bottom:2px solid #F2B5C0;margin-bottom:28px}
.brand{font-family:Georgia,serif;font-size:12px;font-weight:300;color:#B5706A;letter-spacing:.12em;text-transform:uppercase;margin-bottom:3px}
.rh h1{font-size:21px;font-weight:600;letter-spacing:-.01em}
.meta{text-align:right;color:#9E7E78;font-size:12px;line-height:1.8}
.meta strong{color:#2C2020;font-size:14px;display:block;font-weight:600}
.sec{margin-bottom:26px}
.sec-t{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:#9E7E78;margin-bottom:11px;padding-bottom:6px;border-bottom:1px solid #EDD9D3}
.k4{display:grid;grid-template-columns:repeat(4,1fr);gap:11px}
.k2{display:grid;grid-template-columns:repeat(2,1fr);gap:11px;margin-top:11px}
.kp{border:1px solid #EDD9D3;border-radius:10px;padding:14px;background:#FDF0EC;text-align:center}
.kp.gr{background:#E8F5EE;border-color:#2D7A4F44}
.kp.dk{background:#2C2020;border-color:#2C2020}
.kp.am{background:#FDF6E3;border-color:#C9A84C44}
.kn{font-size:26px;font-weight:700;color:#2C2020;letter-spacing:-.03em;line-height:1}
.kp.gr .kn{color:#2D7A4F}.kp.dk .kn{color:#F5EDE8}
.kl{font-size:10px;color:#9E7E78;margin-top:4px;font-weight:600;text-transform:uppercase;letter-spacing:.05em}
.ks{font-size:11px;color:#9E7E78;margin-top:2px}
table{width:100%;border-collapse:collapse}
thead th{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#9E7E78;padding:7px 9px;text-align:left;border-bottom:1px solid #EDD9D3}
tbody td{padding:8px 9px;border-bottom:1px solid #F5EDE8;vertical-align:middle}
tbody tr:last-child td{border-bottom:none}
.tn{font-weight:500;color:#2C2020}.tg{color:#2D7A4F;font-weight:600}.td{color:#9E7E78;font-size:11px}.tc{text-align:center}
.bar-wrap{display:flex;align-items:center;gap:6px}
.bar-track{flex:1;height:5px;background:#EDD9D3;border-radius:99px;overflow:hidden;min-width:50px}
.bar-lbl{font-size:11px;font-weight:700;width:30px;text-align:right}
.rb{display:flex;align-items:center;gap:9px;margin-bottom:7px}
.rn{flex:0 0 155px;font-size:12px;color:#2C2020}
.rt{flex:1;height:7px;background:#EDD9D3;border-radius:99px;overflow:hidden}
.rf{height:100%;background:#B5706A;border-radius:99px}
.rq{flex:0 0 22px;font-weight:700;font-size:12px;text-align:right}
.rp{flex:0 0 34px;font-size:11px;color:#9E7E78;text-align:right}
.hcont{display:flex;align-items:flex-end;gap:4px;height:76px;margin-bottom:5px}
.hcol{display:flex;flex-direction:column;align-items:center;gap:2px;flex:1}
.hbar{width:100%;border-radius:2px 2px 0 0;min-height:2px}
.hl{font-size:8px;color:#9E7E78}
.hv{font-size:8px;font-weight:700;color:#9E7E78}
.hi{display:flex;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid #F5EDE8;font-size:12px}
.hi:last-child{border-bottom:none}
.ht{color:#9E7E78;flex:0 0 40px}.hname{flex:1;font-weight:500}.hout{flex:0 0 150px;text-align:right;font-size:11px;font-weight:500}
.badge{display:inline-block;padding:1px 7px;border-radius:20px;font-size:9px;font-weight:700;background:#FDF6E3;color:#A07820;border:1px solid #C9A84C44}
.ft{margin-top:36px;padding-top:12px;border-top:1px solid #EDD9D3;display:flex;justify-content:space-between;color:#9E7E78;font-size:11px}
.nb{page-break-inside:avoid}
@media print{.pg{padding:28px};body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="pg">

<div class="rh">
  <div><div class="brand">Via Íntima</div><h1>Relatório de Atendimentos</h1></div>
  <div class="meta"><strong>${gD}</strong>${wD}<br>${storeName} · ${gT}</div>
</div>

<div class="sec nb"><div class="sec-t">Resumo Executivo</div>
<div class="k4">
  <div class="kp"><div class="kn">${tV}</div><div class="kl">Atendimentos</div></div>
  <div class="kp gr"><div class="kn">${tSa}</div><div class="kl">Vendas</div><div class="ks">${nS.length} sem conversão</div></div>
  <div class="kp dk"><div class="kn" style="color:${cr>=60?"#86efac":cr>=40?"#fde68a":"#fca5a5"}">${cr}%</div><div class="kl" style="color:#9E7E78">Conversão</div><div class="ks">${cr>=60?"Meta atingida":cr>=40?"Próximo da meta":"Abaixo da meta"}</div></div>
  <div class="kp"><div class="kn">${aD>0?aD+"'":"—"}</div><div class="kl">Tempo Médio</div></div>
</div>
${(pk&&pk[1]>0)||best?`<div class="k2">
  ${pk&&pk[1]>0?`<div class="kp am"><div class="kl" style="text-align:left">Horário de Pico</div><div style="font-size:15px;font-weight:700;margin-top:5px">${pk[0]}h – ${parseInt(pk[0])+1}h</div><div class="ks">${pk[1]} atendimento${pk[1]>1?"s":""}</div></div>`:"<div></div>"}
  ${best?`<div class="kp am"><div class="kl" style="text-align:left">Destaque do Dia <span class="badge">★</span></div><div style="font-size:15px;font-weight:700;margin-top:5px">${best.name}</div><div class="ks">${best.pS} venda${best.pS!==1?"s":""} · ${best.pC}%</div></div>`:"<div></div>"}
</div>`:""}
</div>

<div class="sec nb"><div class="sec-t">Performance por Funcionária</div>
<table><thead><tr><th>Funcionária</th><th>Entrada</th><th>Saída</th><th>Expediente</th><th>Pausas</th><th class="tc">Atend.</th><th class="tc">Vendas</th><th>Conversão</th></tr></thead>
<tbody>${st.map(p=>`<tr>
  <td class="tn">${p.name}${p.pS===mSS&&mSS>0?" <span class='badge'>★</span>":""}</td>
  <td class="td">${fmtTime(p.entryTime)}</td><td class="td">${p.exitTime?fmtTime(p.exitTime):"—"}</td>
  <td class="td">${p.wS}</td><td class="td">${p.bS}</td>
  <td class="tc" style="font-weight:600">${p.ps.length}</td><td class="tc tg">${p.pS}</td>
  <td><div class="bar-wrap"><div class="bar-track">${bar(p.pC,100,cc(p.pC))}</div><span class="bar-lbl" style="color:${cc(p.pC)}">${p.pC}%</span></div></td>
</tr>`).join("")}</tbody></table></div>

${demands.length>0?`<div class="sec nb"><div class="sec-t">Tarefas do Dia</div>
<div class="k4">
  <div class="kp gr"><div class="kn">${tDone.length}</div><div class="kl">Concluídas</div></div>
  <div class="kp"><div class="kn">${tPend}</div><div class="kl">Pendentes</div></div>
  <div class="kp" style="${tLate?'background:#FBEAEA;border-color:#B8323244':''}"><div class="kn" style="${tLate?'color:#B83232':''}">${tLate}</div><div class="kl">Atrasadas</div></div>
  <div class="kp am"><div class="kn">${tPoints}</div><div class="kl">Pontos</div></div>
</div>
${sortedTaskPoints.length>0?`<table style="margin-top:14px"><thead><tr><th>Funcionária</th><th class="tc">Tarefas</th><th class="tc">Pontos</th></tr></thead>
<tbody>${sortedTaskPoints.map(p=>`<tr><td class="tn">${p.name}</td><td class="tc">${p.tasks}</td><td class="tc tg">${p.points}</td></tr>`).join("")}</tbody></table>`:""}
</div>`:""}

${services.length>0?`<div class="sec nb"><div class="sec-t">Movimento por Hora</div>
<div class="hcont">${hD.map(([h,c])=>{const ip=parseInt(h)===parseInt(pk?.[0])&&c>0;const bh=mH>0?Math.max((c/mH)*64,c>0?3:0):0;return`<div class="hcol"><div class="hv" style="opacity:${c>0?1:0}">${c>0?c:""}</div><div style="flex:1;display:flex;align-items:flex-end;width:100%"><div class="hbar" style="height:${bh}px;background:${ip?"#B5706A":c>0?"#F2B5C0":"#EDD9D3"}"></div></div><div class="hl" style="color:${ip?"#B5706A":"#9E7E78"}">${h}h</div></div>`;}).join("")}</div>
</div>`:""}

<div class="sec nb"><div class="sec-t">Motivos de Não Venda</div>
${sR.length===0?'<p style="color:#9E7E78;font-size:13px">Todos os atendimentos resultaram em venda.</p>'
:sR.map(([l,c])=>`<div class="rb"><div class="rn">${l}</div><div class="rt"><div class="rf" style="width:${Math.round((c/mR)*100)}%"></div></div><div class="rq">${c}</div><div class="rp">${nS.length?Math.round((c/nS.length)*100):0}%</div></div>`).join("")}
</div>

<div class="sec"><div class="sec-t">Histórico — ${services.length} registro${services.length!==1?"s":""}</div>
${services.length===0?'<p style="color:#9E7E78">Nenhum atendimento.</p>'
:services.map(s=>`<div class="hi"><span class="ht">${fmtTime(s.startTime)}</span><span class="hname">${s.salespersonName}</span><span class="hout" style="color:${s.isSale?"#2D7A4F":"#B83232"}">${s.outcomeLabel}</span></div>`).join("")}
</div>

<div class="ft"><span>Via Íntima · ${storeName} · ${gD}</span><span>Sistema de Atendimento · ${gT}</span></div>
</div></body></html>`;

  const w=window.open("","_blank");
  if(w){w.document.write(html);w.document.close();setTimeout(()=>w.print(),800);}
}

function exportPontoPDF(storeName,personName,from,to,days,totalWorkedMin){
  const gT=new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
  const fD=d=>d.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric"});
  const wH=(m)=>Math.floor(m/60)>0?`${Math.floor(m/60)}h ${m%60}m`:`${m}m`;
  const html=`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Folha de Ponto — ${personName}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;color:#2C2020;font-size:13px;line-height:1.5;background:#fff}
.pg{max-width:860px;margin:0 auto;padding:48px}
.rh{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:18px;border-bottom:2px solid #F2B5C0;margin-bottom:28px}
.brand{font-family:Georgia,serif;font-size:12px;font-weight:300;color:#B5706A;letter-spacing:.12em;text-transform:uppercase;margin-bottom:3px}
.rh h1{font-size:21px;font-weight:600;letter-spacing:-.01em}
.meta{text-align:right;color:#9E7E78;font-size:12px;line-height:1.8}
.meta strong{color:#2C2020;font-size:14px;display:block;font-weight:600}
.sec{margin-bottom:26px}
.sec-t{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:#9E7E78;margin-bottom:11px;padding-bottom:6px;border-bottom:1px solid #EDD9D3}
.k2{display:grid;grid-template-columns:repeat(2,1fr);gap:11px}
.kp{border:1px solid #EDD9D3;border-radius:10px;padding:14px;background:#FDF0EC;text-align:center}
.kn{font-size:26px;font-weight:700;color:#2C2020;letter-spacing:-.03em;line-height:1}
.kl{font-size:10px;color:#9E7E78;margin-top:4px;font-weight:600;text-transform:uppercase;letter-spacing:.05em}
table{width:100%;border-collapse:collapse}
thead th{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#9E7E78;padding:7px 9px;text-align:left;border-bottom:1px solid #EDD9D3}
tbody td{padding:8px 9px;border-bottom:1px solid #F5EDE8;vertical-align:middle}
tbody tr:last-child td{border-bottom:none}
.tn{font-weight:500;color:#2C2020;text-transform:capitalize}.tg{color:#2D7A4F;font-weight:600}.td{color:#9E7E78;font-size:11px}.tc{text-align:center}
.ft{margin-top:36px;padding-top:12px;border-top:1px solid #EDD9D3;display:flex;justify-content:space-between;color:#9E7E78;font-size:11px}
.sign{margin-top:56px;display:flex;justify-content:space-between;gap:40px}
.sign div{flex:1;border-top:1px solid #2C2020;padding-top:6px;text-align:center;font-size:11px;color:#9E7E78}
@media print{.pg{padding:28px};body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="pg">

<div class="rh">
  <div><div class="brand">Via Íntima</div><h1>Folha de Ponto</h1></div>
  <div class="meta"><strong>${personName}</strong>${storeName}<br>${fD(from)} – ${fD(to)}</div>
</div>

<div class="sec nb"><div class="sec-t">Resumo do Período</div>
<div class="k2">
  <div class="kp"><div class="kn">${days.length}</div><div class="kl">Dias registrados</div></div>
  <div class="kp"><div class="kn">${wH(totalWorkedMin)}</div><div class="kl">Total de horas</div></div>
</div>
</div>

<div class="sec"><div class="sec-t">Registros diários</div>
<table><thead><tr><th>Data</th><th>Entrada</th><th>Pausas</th><th>Saída</th><th class="tc">Horas</th></tr></thead>
<tbody>${days.length===0?'<tr><td colspan="5" style="color:#9E7E78;padding:14px 9px">Nenhum registro no período.</td></tr>':days.slice().sort((a,b)=>new Date(a.date)-new Date(b.date)).map(d=>`<tr>
  <td class="tn">${fmtShort(d.date)}</td>
  <td class="td">${fmtTime(d.entryTime)}</td>
  <td class="td">${d.breaks.length===0?"—":d.breaks.map(b=>`${fmtTime(b.start)}–${b.end?fmtTime(b.end):"…"}`).join(", ")}</td>
  <td class="td">${d.exitTime?fmtTime(d.exitTime):"—"}</td>
  <td class="tc tg">${wH(d.workedMin)}</td>
</tr>`).join("")}</tbody></table>
</div>

<div class="sign">
  <div>${personName}</div>
  <div>Supervisão / Administração</div>
</div>

<div class="ft"><span>Via Íntima · ${storeName} · ${fD(from)} – ${fD(to)}</span><span>Folha de Ponto · gerado às ${gT}</span></div>
</div></body></html>`;

  const w=window.open("","_blank");
  if(w){w.document.write(html);w.document.close();setTimeout(()=>w.print(),800);}
}

                        
