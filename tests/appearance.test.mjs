import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../public/static/js/experience.js',import.meta.url),'utf8');
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const key=id=>'alyzyus-appearance-member-v2:'+id;
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};

function harness(saved={}){
  const events=new Map(),reads=[],writes=[],photoReads=[],photoWrites=[],apiCalls=[];
  const classes=new Set(),style=new Map(),photos=new Map();
  let createdDialog;
  const root={dataset:{},style:{setProperty:(k,v)=>style.set(k,v),removeProperty:k=>style.delete(k)},classList:{toggle:(k,v)=>v?classes.add(k):classes.delete(k)}};
  const listeners=new Map();
  let theme='light';
  const shop={locale:'en',escape:String,icon:()=>'',get theme(){return theme;},setTheme(value){theme=value;},onChange:callback=>listeners.set('shop',callback),api:(url,options)=>new Promise((resolve,reject)=>apiCalls.push({url,options,resolve,reject}))};
  const window={Shop:shop,matchMedia:()=>({matches:false,addEventListener:()=>{}}),addEventListener:(name,callback)=>{const list=events.get(name)||[];list.push(callback);events.set(name,list);},dispatchEvent:event=>(events.get(event.type)||[]).forEach(fn=>fn(event))};
  const db={objectStoreNames:{contains:()=>true},transaction:(_,mode)=>{
    const tx={};
    tx.objectStore=()=>({get:k=>operation(k,undefined),put:(blob,k)=>operation(k,blob),delete:k=>operation(k,null)});
    function operation(k,value){
      const request={};
      if(mode==='readonly')photoReads.push(k);else photoWrites.push(k);
      queueMicrotask(()=>{
        if(mode==='readonly')request.result=photos.get(k);
        else if(value===null)photos.delete(k);else photos.set(k,value);
        request.onsuccess?.();tx.oncomplete?.();
      });
      return request;
    }
    return tx;
  }};
  const indexedDB={open:()=>{const request={};queueMicrotask(()=>{request.result=db;request.onsuccess?.();});return request;}};
  window.indexedDB=indexedDB;
  const context={window,document:{documentElement:root,body:{classList:{add:()=>{},remove:()=>{}},append:()=>{}},activeElement:{focus:()=>{}},createElement:()=>{
    createdDialog={open:false,innerHTML:'',setAttribute:()=>{},hasAttribute:()=>false,addEventListener:()=>{},querySelector:selector=>selector==='[data-exp-close]'?{focus:()=>{}}:null,querySelectorAll:()=>[],classList:{contains:()=>false},showModal(){this.open=true;},close(){this.open=false;}};
    return createdDialog;
  },querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null,visibilityState:'visible',addEventListener:(name,callback)=>events.set('document:'+name,[callback])},localStorage:{getItem:k=>{reads.push(k);return saved[k]??null;},setItem:(k,v)=>{writes.push(k);saved[k]=v;}},indexedDB,location:{pathname:'/install'},Blob,URL:{createObjectURL:()=> 'blob:local-photo',revokeObjectURL:()=>{}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},console};
  vm.runInNewContext(source,context,{filename:'experience.js'});
  return {root,style,classes,reads,writes,photoReads,photoWrites,photos,apiCalls,saved,
    get settings(){return window.AlyzyusExperience.settings;},
    get html(){return createdDialog?.innerHTML||'';},
    open(){return window.AlyzyusExperience.open();},
    event(name,detail){window.dispatchEvent({type:name,detail});},
    storage(newValue){window.dispatchEvent({type:'storage',key:'alyzyus-auth-sync',newValue});},
    pageshow(){window.dispatchEvent({type:'pageshow',persisted:true});},
    pagehide(){window.dispatchEvent({type:'pagehide',persisted:true});},
    visible(){events.get('document:visibilitychange')[0]();},
  };
}

test('guest never reads legacy or forged local member preferences and does not open the photo database',async()=>{
  const h=harness({'alyzyus-appearance-v1':JSON.stringify({palette:'rose'}),'alyzyus-user':JSON.stringify({id:A,role:'admin'}),[key(A)]:JSON.stringify({palette:'ocean'})});
  assert.equal(h.settings.member,false);
  assert.equal(h.style.has('--accent'),false);
  assert.deepEqual(h.reads,[]);
  assert.deepEqual(h.photoReads,[]);
  h.apiCalls[0].reject(Object.assign(new Error('not signed in'),{status:401,code:'UNAUTHORIZED'}));
  await settle();
  assert.equal(h.settings.member,false);
  assert.deepEqual(h.reads,[]);
  assert.deepEqual(h.photoReads,[]);
});

test('verified accounts get only their own palette and photo; logout clears display without deleting preferences',async()=>{
  const h=harness({[key(A)]:JSON.stringify({palette:'ocean',mode:'dark'}),[key(B)]:JSON.stringify({palette:'rose',mode:'light'})});
  h.photos.set('wallpaper:'+A,new Blob(['sample'],{type:'image/jpeg'}));
  h.apiCalls[0].resolve({allowed:true,userId:A});await settle();
  assert.equal(h.settings.member,true);
  assert.equal(h.settings.palette,'ocean');
  assert.equal(h.settings.hasWallpaper,true);
  assert.deepEqual(h.reads,[key(A)]);
  assert.deepEqual(h.photoReads,['wallpaper:'+A]);
  h.event('alyzyus:auth',{authenticated:false,reason:'logout'});
  assert.equal(h.settings.member,false);
  assert.equal(h.settings.hasWallpaper,false);
  assert.equal(h.style.has('--accent'),false);
  assert.equal(h.classes.has('has-wallpaper'),false);
  assert.ok(h.saved[key(A)]);
  assert.equal(h.photos.has('wallpaper:'+A),true);
  h.event('alyzyus:auth',{authenticated:true,user:{id:A}});
  h.apiCalls.at(-1).resolve({allowed:true,userId:B});await settle();
  assert.equal(h.settings.palette,'rose');
  assert.equal(h.settings.hasWallpaper,false);
  assert.deepEqual(h.reads,[key(A),key(B)]);
  assert.deepEqual(h.photoReads,['wallpaper:'+A,'wallpaper:'+B]);
  assert.deepEqual(h.photoWrites,[]);
});

test('an old permission response cannot reapply a member palette after logout',async()=>{
  const h=harness({[key(A)]:JSON.stringify({palette:'forest'})});
  h.event('alyzyus:auth',{authenticated:false,reason:'logout'});
  h.apiCalls[0].resolve({allowed:true,userId:A});await settle();
  assert.equal(h.settings.member,false);
  assert.deepEqual(h.reads,[]);
  assert.deepEqual(h.photoReads,[]);
});

test('cross-tab logout hides personal settings without racing still-present auth cookies',async()=>{
  const h=harness({[key(A)]:JSON.stringify({palette:'forest'})});
  h.apiCalls[0].resolve({allowed:true,userId:A});await settle();
  h.storage('logout:123:nonce');
  assert.equal(h.settings.member,false);
  assert.equal(h.style.has('--accent'),false);
  assert.equal(h.apiCalls.length,1,'logout must not immediately revalidate cookies pending removal');
  h.storage('login:124:nonce');
  assert.equal(h.apiCalls.length,2,'another login must get identity from the server');
  h.apiCalls[1].resolve({allowed:true,userId:A});await settle();
  assert.equal(h.settings.member,true);
});

test('visibility and restored pages reverify identity; provider failure always removes custom appearance',async()=>{
  const h=harness({[key(A)]:JSON.stringify({palette:'amber'})});
  h.apiCalls[0].resolve({allowed:true,userId:A});await settle();
  h.visible();
  assert.equal(h.apiCalls.length,2);
  h.apiCalls[1].reject(new Error('network unavailable'));await settle();
  assert.equal(h.settings.member,false);
  assert.equal(h.style.has('--accent'),false);
  h.pageshow();
  assert.equal(h.settings.member,false);
  assert.equal(h.apiCalls.length,3);
  h.apiCalls[2].reject(Object.assign(new Error('unconfirmed'),{status:403,code:'EMAIL_NOT_VERIFIED'}));await settle();
  assert.equal(h.settings.member,false);
  assert.equal(h.style.has('--accent'),false);
});

test('back-forward cache snapshots are cleared before parking a personalised page',async()=>{
  const h=harness({[key(A)]:JSON.stringify({palette:'ocean'})});
  h.photos.set('wallpaper:'+A,new Blob(['sample'],{type:'image/jpeg'}));
  h.apiCalls[0].resolve({allowed:true,userId:A});await settle();
  assert.equal(h.settings.hasWallpaper,true);
  h.pagehide();
  assert.equal(h.settings.member,false);
  assert.equal(h.settings.hasWallpaper,false);
  assert.equal(h.classes.has('has-wallpaper'),false);
  h.pageshow();
  assert.equal(h.settings.member,false);
  h.apiCalls[1].reject(Object.assign(new Error('signed out'),{status:401,code:'UNAUTHORIZED'}));await settle();
  assert.equal(h.settings.hasWallpaper,false);
  assert.equal(h.photos.has('wallpaper:'+A),true);
});

test('email confirmation invitation is distinct; real auth-event-before-401 order resets stale denial copy',async()=>{
  const h=harness();
  h.apiCalls[0].reject(Object.assign(new Error('unconfirmed'),{status:403,code:'EMAIL_NOT_VERIFIED'}));await settle();
  let opened=h.open();
  h.apiCalls.at(-1).reject(Object.assign(new Error('unconfirmed'),{status:403,code:'EMAIL_NOT_VERIFIED'}));await opened;
  assert.match(h.html,/Confirm your email to personalise/);
  assert.doesNotMatch(h.html,/Create an account/);
  opened=h.open();
  // app.js ส่งสัญญาณหมดเซสชันก่อนโยน error401 กลับให้ verifyMember
  h.event('alyzyus:auth',{authenticated:false,reason:'expired'});
  h.apiCalls.at(-1).reject(Object.assign(new Error('signed out'),{status:401,code:'UNAUTHORIZED'}));await opened;
  assert.match(h.html,/Your space starts with an account/);
  assert.match(h.html,/Create an account/);
  assert.match(h.html,/next=%2Finstall/);
  assert.doesNotMatch(h.html,/data-exp-palette|id="exp-photo"/);
});
