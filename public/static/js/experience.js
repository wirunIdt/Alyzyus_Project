/* การตั้งค่าหน้าตาเก็บบนอุปกรณ์นี้เท่านั้น รูปพื้นหลังไม่ถูกส่งขึ้นเซิร์ฟเวอร์ */
(() => {
  'use strict';
  const S = window.Shop;
  if (!S) return;
  const ROOT = document.documentElement;
  const KEY = 'alyzyus-appearance-v1';
  const DEFAULTS = Object.freeze({palette:'iris', mode:'system', readable:false, motion:true});
  const PALETTES = Object.freeze({
    iris: {name:['ม่วงไอริส','Iris','鸢尾紫'], light:['#5f43b2','#eee9fb'], dark:['#c2adff','#342b4b']},
    ocean: {name:['ฟ้ามหาสมุทร','Ocean','海洋蓝'], light:['#155b92','#e4f1fb'], dark:['#8bc7ff','#1c354b']},
    forest: {name:['เขียวป่า','Forest','森林绿'], light:['#286044','#e7f2e9'], dark:['#98d4af','#233c2d']},
    rose: {name:['กุหลาบ','Rose','玫瑰色'], light:['#9a3657','#f9e8ef'], dark:['#f5a6c1','#482b38']},
    amber: {name:['อำพัน','Amber','琥珀色'], light:['#80500b','#fbefd9'], dark:['#eac480','#433725']},
    slate: {name:['เทาหิน','Slate','岩石灰'], light:['#45536b','#e9edf4'], dark:['#bac9e4','#303849']}
  });
  const COPY = {
    title:['แต่งแอปในแบบคุณ','Make it yours','打造您的专属风格'],
    lead:['สีที่ชอบ อ่านสบาย และเป็นส่วนตัว','Your colours. Your comfort. Your space.','喜欢的颜色，舒适的阅读，私人的空间。'],
    close:['ปิดการตั้งค่าหน้าตา','Close appearance settings','关闭外观设置'],
    palette:['โทนสี','Colour palette','配色'], theme:['รูปแบบหน้าจอ','Display mode','显示模式'],
    light:['สว่าง','Light','浅色'], dark:['มืด','Dark','深色'], system:['ตามอุปกรณ์','Device setting','跟随系统'],
    background:['ภาพพื้นหลัง','Your background','背景图片'],
    local:['รูปจะอยู่บนอุปกรณ์นี้เท่านั้น ไม่อัปโหลดและไม่แชร์ให้ร้าน','Your photo stays on this device. It is never uploaded or shared with the store.','图片仅保存在此设备上，不会上传或分享给商店。'],
    choose:['เลือกรูปจากอุปกรณ์','Choose a photo','选择照片'], remove:['นำรูปออก','Remove photo','移除图片'],
    imageHelp:['JPEG, PNG หรือ WebP ไม่เกิน 12 MB ระบบย่อรูปให้โดยอัตโนมัติ','JPEG, PNG or WebP, up to 12 MB. Photos are resized automatically.','支持 JPEG、PNG 或 WebP，最大 12 MB，图片会自动缩小。'],
    hasPhoto:['ใช้รูปพื้นหลังของคุณแล้ว','Your photo is ready','背景图片已设置'],
    noPhoto:['พื้นหลังเรียบ ดูสบายตา','A calm, simple background','简洁舒适的背景'],
    comfort:['อ่านและใช้งานสบายขึ้น','Everyday comfort','舒适体验'],
    readable:['ตัวหนังสืออ่านสบาย','Comfortable text','舒适阅读'],
    readableHelp:['ขยายตัวหนังสือและระยะห่างในส่วนที่อ่านเป็นประจำ','Larger text and more space in everyday controls.','放大常用文字并增加间距。'],
    motion:['เปิดการเคลื่อนไหวเล็กน้อย','Gentle animations','轻柔动效'],
    motionHelp:['เคารพการตั้งค่าลดการเคลื่อนไหวของอุปกรณ์เสมอ','Always respects your device’s reduced motion setting.','始终遵循设备的减少动态效果设置。'],
    reset:['คืนค่าหน้าตาเริ่มต้น','Reset appearance','恢复默认外观'],
    saved:['บันทึกอัตโนมัติบนอุปกรณ์นี้','Saved automatically on this device','自动保存在此设备'],
    loading:['กำลังเตรียมรูป…','Preparing your photo…','正在处理图片…'],
    error:['ใช้รูปนี้ไม่ได้ กรุณาลองรูป JPEG, PNG หรือ WebP อีกครั้ง','This photo could not be used. Please try another JPEG, PNG or WebP image.','无法使用此图片，请尝试其他 JPEG、PNG 或 WebP 图片。'],
    tooLarge:['กรุณาเลือกรูปไม่เกิน 12 MB และ 20 ล้านพิกเซล','Choose a photo under 12 MB and 20 megapixels.','请选择小于 12 MB、2000 万像素的图片。'],
    unavailable:['เบราว์เซอร์นี้บันทึกรูปบนอุปกรณ์ไม่ได้ ลองใช้เบราว์เซอร์ปกติที่ไม่ใช่โหมดส่วนตัว','This browser cannot save photos locally. Try a regular browser window.','此浏览器无法在本地保存图片，请尝试普通浏览窗口。'],
    storeFail:['เปลี่ยนหน้าตาได้แล้ว แต่เบราว์เซอร์ไม่อนุญาตให้บันทึกการตั้งค่า','Appearance updated. Your browser could not save the preference.','外观已更新，但浏览器未允许保存设置。'],
    done:['เรียบร้อย','Done','完成']
  };
  const locale = () => ({th:0,en:1,zh:2}[S.locale] ?? 0);
  const tr = key => COPY[key][locale()];
  const name = palette => PALETTES[palette].name[locale()];
  const esc = S.escape;
  let prefs = {...DEFAULTS, mode:S.theme};
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && typeof saved === 'object') prefs = {
      palette:Object.hasOwn(PALETTES,saved.palette)?saved.palette:DEFAULTS.palette,
      mode:['light','dark','system'].includes(saved.mode)?saved.mode:DEFAULTS.mode,
      readable:saved.readable===true, motion:saved.motion!==false
    };
  } catch { /* โหมดส่วนตัวอาจไม่ให้ใช้พื้นที่จัดเก็บ */ }
  const darkQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
  const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let syncing = false;
  let dialog, lastFocus, dbPromise, wallpaperURL = '', wallpaperBlob = null, imageBusy = false;
  let revealObserver;

  function persist() {
    try { localStorage.setItem(KEY,JSON.stringify(prefs)); return true; }
    catch { return false; }
  }

  function refreshPalette() {
    const dark = S.theme === 'dark';
    const palette = PALETTES[prefs.palette];
    const colors = palette[dark?'dark':'light'];
    ROOT.style.setProperty('--accent',colors[0]);
    ROOT.style.setProperty('--accent-soft',colors[1]);
    ROOT.style.setProperty('--accent-contrast',dark?'#17171d':'#ffffff');
    ROOT.style.setProperty('--exp-accent-light',palette.light[0]);
    ROOT.dataset.palette=prefs.palette;
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.content=dark?'#15151a':'#fcfbf8';
  }

  function syncDialog() {
    if (!dialog) return;
    dialog.querySelectorAll('[data-exp-palette]').forEach(button => {
      const selected = button.dataset.expPalette===prefs.palette;
      button.setAttribute('aria-pressed',String(selected));
      button.querySelector('.exp-palette-check').textContent=selected?'✓':'';
    });
    dialog.querySelectorAll('[name="exp-theme"]').forEach(input=>{input.checked=input.value===prefs.mode;});
    dialog.querySelector('#exp-readable').checked=prefs.readable;
    dialog.querySelector('#exp-motion').checked=prefs.motion;
    const photo=dialog.querySelector('.exp-photo-preview');
    photo.classList.toggle('has-photo',!!wallpaperURL);
    photo.style.backgroundImage=wallpaperURL?`url("${wallpaperURL}")`:'';
    photo.querySelector('span').textContent=tr(wallpaperURL?'hasPhoto':'noPhoto');
    dialog.querySelector('[data-exp-remove]').disabled=!wallpaperBlob||imageBusy;
    dialog.querySelector('#exp-photo').disabled=imageBusy;
    dialog.querySelector('[data-exp-reset]').disabled=imageBusy;
    dialog.querySelector('.exp-photo-label').classList.toggle('exp-busy',imageBusy);
  }

  function status(key,error=false) {
    if(!dialog)return;
    const node=dialog.querySelector('#exp-status');
    node.textContent=tr(key);
    node.classList.toggle('exp-status-error',error);
  }

  function motionAllowed() { return prefs.motion && !motionQuery?.matches; }

  function apply({save=false}={}) {
    const theme=prefs.mode==='system'?(darkQuery?.matches?'dark':'light'):prefs.mode;
    syncing=true;
    try { if(S.theme!==theme)S.setTheme(theme); }
    finally { syncing=false; }
    refreshPalette();
    ROOT.dataset.readable=String(prefs.readable);
    ROOT.dataset.motion=motionAllowed()?'on':'off';
    if(!motionAllowed())document.getElementById('cinematic-intro')?.setAttribute('hidden','');
    // การเผยเนื้อหาไม่ซ่อนข้อความไว้ จึงยังอ่านได้แม้ JavaScript หยุดทำงาน
    if(!motionAllowed()){
      revealObserver?.disconnect();
      document.querySelectorAll('.exp-arrived').forEach(node=>node.classList.remove('exp-arrived'));
    } else setupReveals();
    if(save&&!persist())status('storeFail',true);
    syncDialog();
    window.dispatchEvent(new CustomEvent('alyzyus:appearance',{detail:{...prefs,effectiveMotion:motionAllowed()}}));
  }

  // IndexedDB เก็บ Blob แทนการยัดรูป Base64 ขนาดใหญ่ไว้ใน localStorage
  function database() {
    if(!window.indexedDB)return Promise.reject(new Error('LOCAL_STORAGE_UNAVAILABLE'));
    if(dbPromise)return dbPromise;
    dbPromise=new Promise((resolve,reject)=>{
      let request;
      try { request=indexedDB.open('alyzyus-device',1); } catch(error){reject(error);return;}
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('appearance'))request.result.createObjectStore('appearance');};
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};
      request.onerror=()=>reject(request.error||new Error('LOCAL_STORAGE_UNAVAILABLE'));
      request.onblocked=()=>reject(new Error('LOCAL_STORAGE_BLOCKED'));
    });
    return dbPromise;
  }

  async function storePhoto(blob) {
    const db=await database();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('appearance',blob===undefined?'readonly':'readwrite');
      const store=tx.objectStore('appearance');
      const request=blob===undefined?store.get('wallpaper'):blob===null?store.delete('wallpaper'):store.put(blob,'wallpaper');
      let value;
      request.onsuccess=()=>{value=request.result;};
      tx.oncomplete=()=>resolve(value);
      tx.onerror=()=>reject(tx.error||new Error('LOCAL_STORAGE_UNAVAILABLE'));
      tx.onabort=()=>reject(tx.error||new Error('LOCAL_STORAGE_UNAVAILABLE'));
    });
  }

  function displayPhoto(blob) {
    if(wallpaperURL)URL.revokeObjectURL(wallpaperURL);
    wallpaperBlob=blob;
    wallpaperURL=blob?URL.createObjectURL(blob):'';
    if(wallpaperURL)ROOT.style.setProperty('--exp-wallpaper',`url("${wallpaperURL}")`);
    else ROOT.style.removeProperty('--exp-wallpaper');
    ROOT.classList.toggle('has-wallpaper',!!wallpaperURL);
    syncDialog();
  }

  async function decodeImage(file) {
    if(window.createImageBitmap){
      try { const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});return {image:bitmap,width:bitmap.width,height:bitmap.height,cleanup:()=>bitmap.close()}; }
      catch { /* Safari บางรุ่นใช้ Image ได้ แม้ createImageBitmap ไม่รองรับชนิดนี้ */ }
    }
    const url=URL.createObjectURL(file);
    return new Promise((resolve,reject)=>{
      const image=new Image();
      image.onload=()=>resolve({image,width:image.naturalWidth,height:image.naturalHeight,cleanup:()=>URL.revokeObjectURL(url)});
      image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('IMAGE_INVALID'));};
      image.src=url;
    });
  }

  // อ่านขนาดจากส่วนหัวก่อนถอดรหัสรูป เพื่อตัดไฟล์ภาพขนาดใหญ่มากก่อนใช้หน่วยความจำ
  async function imageDimensions(file) {
    const data=new Uint8Array(await file.slice(0,512*1024).arrayBuffer());
    const view=new DataView(data.buffer);
    if(file.type==='image/png'&&data.length>=24&&view.getUint32(0)===0x89504e47)
      return {width:view.getUint32(16),height:view.getUint32(20)};
    if(file.type==='image/jpeg'&&data[0]===0xff&&data[1]===0xd8){
      let offset=2;
      const frames=new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
      while(offset+8<data.length){
        if(data[offset]!==0xff)break;
        while(data[offset]===0xff)offset++;
        const marker=data[offset++];
        if(marker===0xda||marker===0xd9)break;
        if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
        if(offset+2>data.length)break;
        const size=view.getUint16(offset);
        if(size<2||offset+size>data.length)break;
        if(frames.has(marker)&&size>=7)return {height:view.getUint16(offset+3),width:view.getUint16(offset+5)};
        offset+=size;
      }
    }
    if(file.type==='image/webp'&&data.length>=30&&view.getUint32(0)===0x52494646&&view.getUint32(8)===0x57454250){
      const chunk=view.getUint32(12);
      if(chunk===0x56503858)return {width:1+data[24]+(data[25]<<8)+(data[26]<<16),height:1+data[27]+(data[28]<<8)+(data[29]<<16)};
      if(chunk===0x5650384c&&data[20]===0x2f)return {width:1+data[21]+((data[22]&63)<<8),height:1+(data[22]>>6)+(data[23]<<2)+((data[24]&15)<<10)};
      if(chunk===0x56503820&&data[23]===0x9d&&data[24]===0x01&&data[25]===0x2a)return {width:view.getUint16(26,true)&0x3fff,height:view.getUint16(28,true)&0x3fff};
    }
    throw new Error('IMAGE_INVALID');
  }

  async function compressPhoto(file) {
    if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('IMAGE_INVALID');
    if(file.size>12*1024*1024)throw new Error('IMAGE_TOO_LARGE');
    const dimensions=await imageDimensions(file);
    if(!dimensions.width||!dimensions.height||dimensions.width*dimensions.height>20000000)throw new Error('IMAGE_TOO_LARGE');
    let decoded;
    try {decoded=await decodeImage(file);}catch{throw new Error('IMAGE_INVALID');}
    const canvas=document.createElement('canvas');
    try {
      if(!decoded.width||!decoded.height||decoded.width*decoded.height>20000000)throw new Error('IMAGE_TOO_LARGE');
      const ratio=Math.min(1,1400/Math.max(decoded.width,decoded.height));
      canvas.width=Math.max(1,Math.round(decoded.width*ratio));
      canvas.height=Math.max(1,Math.round(decoded.height*ratio));
      const context=canvas.getContext('2d',{alpha:false});
      if(!context)throw new Error('IMAGE_INVALID');
      context.fillStyle='#f6f4f0';context.fillRect(0,0,canvas.width,canvas.height);
      context.drawImage(decoded.image,0,0,canvas.width,canvas.height);
      const encode=quality=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('IMAGE_INVALID')),'image/jpeg',quality));
      let blob=await encode(.8);
      if(blob.size>600*1024)blob=await encode(.6);
      if(blob.size>600*1024)blob=await encode(.42);
      if(blob.size>600*1024)throw new Error('IMAGE_TOO_LARGE');
      return blob;
    } finally { decoded.cleanup();canvas.width=canvas.height=1; }
  }

  function renderDialog() {
    if(!dialog)return;
    dialog.innerHTML=`<div class="exp-dialog-header"><div><p class="exp-eyebrow">ALYZYUS / YOUR SPACE</p><h2 id="exp-title">${esc(tr('title'))}</h2><p>${esc(tr('lead'))}</p></div><button type="button" class="exp-close icon-button" data-exp-close aria-label="${esc(tr('close'))}">${S.icon('close',20)}</button></div>
      <div class="exp-dialog-body"><fieldset class="exp-fieldset"><legend>${esc(tr('palette'))}</legend><div class="exp-palettes">${Object.keys(PALETTES).map(key=>`<button type="button" class="exp-palette" data-exp-palette="${key}" aria-pressed="${key===prefs.palette}"><span class="exp-palette-dot" style="background:${PALETTES[key].light[0]}"><span class="exp-palette-check" aria-hidden="true">${key===prefs.palette?'✓':''}</span></span><span>${esc(name(key))}</span></button>`).join('')}</div></fieldset>
      <fieldset class="exp-fieldset"><legend>${esc(tr('theme'))}</legend><div class="exp-theme-options">${['light','dark','system'].map(mode=>`<label><input type="radio" name="exp-theme" value="${mode}" ${mode===prefs.mode?'checked':''}><span>${esc(tr(mode))}</span></label>`).join('')}</div></fieldset>
      <section class="exp-photo-section" aria-labelledby="exp-photo-title"><h3 id="exp-photo-title">${esc(tr('background'))}</h3><p class="exp-description">${esc(tr('local'))}</p><div class="exp-photo-preview"><span>${esc(tr('noPhoto'))}</span></div><div class="exp-photo-actions"><label class="exp-photo-label" for="exp-photo">${S.icon('plus',16)}${esc(tr('choose'))}</label><input type="file" id="exp-photo" class="exp-file" accept="image/jpeg,image/png,image/webp" aria-describedby="exp-photo-help"><button type="button" class="exp-text-button" data-exp-remove>${esc(tr('remove'))}</button></div><p class="exp-description" id="exp-photo-help">${esc(tr('imageHelp'))}</p></section>
      <fieldset class="exp-fieldset"><legend>${esc(tr('comfort'))}</legend><label class="exp-toggle-row"><span><strong>${esc(tr('readable'))}</strong><small>${esc(tr('readableHelp'))}</small></span><input id="exp-readable" type="checkbox" ${prefs.readable?'checked':''}></label><label class="exp-toggle-row"><span><strong>${esc(tr('motion'))}</strong><small>${esc(tr('motionHelp'))}</small></span><input id="exp-motion" type="checkbox" ${prefs.motion?'checked':''}></label></fieldset>
      <p id="exp-status" class="exp-status" role="status" aria-live="polite">${esc(tr('saved'))}</p></div><div class="exp-dialog-footer"><button type="button" class="exp-text-button" data-exp-reset>${esc(tr('reset'))}</button><button type="button" class="button exp-done" data-exp-close>${esc(tr('done'))}${S.icon('arrow',16)}</button></div>`;
    syncDialog();
  }

  function dialogIsOpen() {return !!dialog&&(dialog.open||dialog.hasAttribute('open'));}

  function closeDialog() {
    if(!dialogIsOpen())return;
    if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');
    document.body.classList.remove('exp-dialog-open');
    lastFocus?.focus?.();
  }

  function openDialog() {
    if(!dialog){
      dialog=document.createElement('dialog');dialog.id='appearance-dialog';dialog.className='exp-dialog';
      dialog.setAttribute('aria-labelledby','exp-title');document.body.append(dialog);renderDialog();
      dialog.addEventListener('click',async event=>{
        if(event.target===dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)closeDialog();return;}
        if(event.target.closest('[data-exp-close]')){closeDialog();return;}
        const chip=event.target.closest('[data-exp-palette]');
        if(chip){prefs.palette=chip.dataset.expPalette;apply({save:true});return;}
        const remove=event.target.closest('[data-exp-remove]');
        const reset=event.target.closest('[data-exp-reset]');
        if((remove||reset)&&!imageBusy){
          imageBusy=true;syncDialog();
          try { await storePhoto(null);displayPhoto(null);if(reset){prefs={...DEFAULTS};apply({save:true});}status('saved'); }
          catch {if(!wallpaperBlob&&reset){prefs={...DEFAULTS};apply({save:true});}else status('unavailable',true);}
          finally {imageBusy=false;syncDialog();}
        }
      });
      dialog.addEventListener('change',async event=>{
        const input=event.target;
        if(input.name==='exp-theme'){prefs.mode=input.value;apply({save:true});return;}
        if(input.id==='exp-readable'){prefs.readable=input.checked;apply({save:true});return;}
        if(input.id==='exp-motion'){prefs.motion=input.checked;apply({save:true});return;}
        if(input.id==='exp-photo'&&input.files?.length&&!imageBusy){
          imageBusy=true;syncDialog();status('loading');
          try {const blob=await compressPhoto(input.files[0]);await storePhoto(blob);displayPhoto(blob);status('saved');}
          catch(error){status(error.message==='IMAGE_TOO_LARGE'?'tooLarge':error.message?.startsWith('IMAGE_')?'error':'unavailable',true);}
          finally {input.value='';imageBusy=false;syncDialog();}
        }
      });
      dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
      dialog.addEventListener('close',()=>{document.body.classList.remove('exp-dialog-open');});
      dialog.addEventListener('keydown',event=>{
        if(event.key==='Escape'){event.preventDefault();closeDialog();return;}
        if(event.key!=='Tab')return;
        const items=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter(item=>item.getClientRects().length);
        if(!items.length)return;
        if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1).focus();}
        else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0].focus();}
      });
    }
    if(dialogIsOpen())return;
    lastFocus=document.activeElement;
    if(typeof dialog.showModal==='function')dialog.showModal();
    else {dialog.setAttribute('open','');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.classList.add('exp-fallback');}
    document.body.classList.add('exp-dialog-open');
    dialog.querySelector('[data-exp-close]').focus();
  }

  function setupReveals() {
    if(!motionAllowed()||!window.IntersectionObserver)return;
    if(!revealObserver)revealObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{
      if(!entry.isIntersecting)return;
      entry.target.classList.add('exp-arrived');revealObserver.unobserve(entry.target);
    }),{threshold:.1});
    document.querySelectorAll('.selected-section,.collections-section,.brand-story,.customer-page-heading,.adm-metric,.account-panel').forEach(node=>{
      if(node.dataset.expObserved)return;node.dataset.expObserved='true';revealObserver.observe(node);
    });
  }

  document.addEventListener('click',event=>{if(event.target.closest('[data-open-appearance]'))openDialog();});
  document.addEventListener('focusin',event=>{if(dialogIsOpen()&&dialog.classList.contains('exp-fallback')&&!dialog.contains(event.target))dialog.querySelector('[data-exp-close]').focus();});
  S.onChange(event=>{
    if(event.detail.type==='theme'){
      if(!syncing){prefs.mode=S.theme;persist();}
      refreshPalette();syncDialog();
    }
    if(event.detail.type==='locale'&&dialog){renderDialog();if(dialogIsOpen())dialog.querySelector('[data-exp-close]').focus();}
  });
  const mediaListener=(query,handler)=>{if(query?.addEventListener)query.addEventListener('change',handler);else query?.addListener?.(handler);};
  mediaListener(darkQuery,()=>{if(prefs.mode==='system')apply();});
  mediaListener(motionQuery,()=>apply());
  apply();
  storePhoto().then(blob=>{if(blob instanceof Blob&&['image/jpeg','image/png','image/webp'].includes(blob.type)&&blob.size<=600*1024)displayPhoto(blob);}).catch(()=>{});
  window.addEventListener('pagehide',event=>{if(!event.persisted&&wallpaperURL){URL.revokeObjectURL(wallpaperURL);wallpaperURL='';}});
  window.AlyzyusExperience=Object.freeze({open:openDialog,get settings(){return {...prefs,effectiveMotion:motionAllowed(),hasWallpaper:!!wallpaperBlob};}});
})();
