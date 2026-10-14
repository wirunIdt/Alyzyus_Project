/* Cookie-based account forms. No demo identities or client-side sessions. */
(() => {
  'use strict';
  const S=window.Shop,root=document.getElementById('account-panel');if(!S||!root)return;
  const e=S.escape,L=(th,en,zh)=>S.t({th,en,zh}),query=new URLSearchParams(location.search);
  const destination=query.get('next'),next=['/checkout','/tracking','/admin'].includes(destination)?destination:'/tracking';
  let mode=query.get('recovery')==='1'?'recovery':'login',user=null,checking=true,busy=false,email='',name='',password='',showPassword=false,error=null,notice=null,authConfigured=S.configured;
  const messages={
    preview:{th:'ขณะนี้เป็นตัวอย่างร้าน ระบบบัญชีจะเปิดเมื่อร้านพร้อมให้บริการ',en:'This is a store preview. Accounts become available when the store is ready.',zh:'当前为商店预览，商店准备就绪后即可使用账户功能。'},
    unavailable:{th:'ระบบบัญชียังไม่เปิดให้บริการ กรุณาลองใหม่ภายหลัง',en:'Accounts are not available yet. Please check back shortly.',zh:'账户功能暂未开放，请稍后再试。'},
    reset:{th:'หากมีบัญชีนี้ในระบบ เราจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้ กรุณาตรวจสอบกล่องอีเมลและจดหมายขยะ',en:'If an account exists for this email, you will receive a password reset link. Check your inbox and spam folder.',zh:'如果该邮箱已注册，您将收到重设密码链接。请检查收件箱和垃圾邮件。'},
    confirm:{th:'ตรวจสอบอีเมลเพื่อยืนยันบัญชี หากเคยสมัครแล้วสามารถเข้าสู่ระบบหรือขอรหัสผ่านใหม่ได้',en:'Check your email to confirm your account. If you already have an account, sign in or reset your password.',zh:'请检查邮箱以确认账户。如果已注册，请登录或重设密码。'},
    updated:{th:'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว',en:'Your password has been updated.',zh:'密码已更新。'}
  };
  function friendly(err){const code=String(err?.code||'').toLowerCase();
    if(code.includes('credential'))return {th:'อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาลองอีกครั้ง',en:'Your email or password is incorrect. Please try again.',zh:'邮箱或密码不正确，请重试。'};
    if(code.includes('email_not_confirmed'))return {th:'กรุณายืนยันอีเมลจากลิงก์ในกล่องข้อความก่อนเข้าสู่ระบบ',en:'Please confirm your email using the link in your inbox before signing in.',zh:'请先点击收件箱中的链接验证邮箱，再登录。'};
    if(code.includes('rate'))return {th:'ส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',en:'Too many requests. Please wait a moment and try again.',zh:'请求过于频繁，请稍后重试。'};
    if(code.includes('password'))return {th:'ใช้รหัสผ่านใหม่อย่างน้อย 12 ตัวอักษรที่ไม่ซ้ำกับรหัสเดิม',en:'Choose a new password with at least 12 characters, different from your previous password.',zh:'请设置至少12个字符且与原密码不同的新密码。'};
    if(code.includes('not_configured'))return messages.preview;
    return {th:'ดำเนินการไม่สำเร็จ กรุณาตรวจสอบข้อมูลและการเชื่อมต่อแล้วลองใหม่',en:'We could not complete your request. Check your details and connection, then try again.',zh:'操作未完成，请检查信息和网络后重试。'};
  }
  const feedback=()=>`${error?`<div class="customer-error" role="alert">${e(S.t(error))}</div>`:''}${notice?`<div class="customer-notice" role="status">${e(S.t(notice))}</div>`:''}`;
  function render(){
    if(checking){root.innerHTML=`<div class="customer-loading" role="status">${e(L('กำลังตรวจสอบบัญชี…','Checking your account…','正在检查账户…'))}</div>`;return;}
    if(user&&mode!=='recovery'){
      root.innerHTML=`<div class="customer-icon-badge">${S.icon('user',26)}</div><p class="customer-eyebrow">${e(L('พื้นที่ของคุณ','YOUR PERSONAL SPACE','您的个人空间'))}</p><h2>${e(L('พร้อมสำหรับวันดี ๆ','You are right at home.','欢迎来到您的空间。'))}</h2><p class="account-email">${e(user.email)}</p>${feedback()}<div class="account-actions"><a href="${e(next)}" class="button">${e(next==='/checkout'?L('ดำเนินการสั่งซื้อต่อ','Continue to checkout','继续结账'):next==='/admin'?L('เปิดพื้นที่ผู้ดูแล','Open store studio','打开商店管理'):L('ดูคำสั่งซื้อของฉัน','View my orders','查看我的订单'))}${S.icon('arrow')}</a><a href="/shop" class="button secondary">${e(L('เลือกซื้อสินค้า','Explore the collection','浏览商品'))}</a>${user.role==='admin'&&next!=='/admin'?`<a href="/admin" class="customer-text-button">${e(L('จัดการร้านค้า','Manage your store','管理商店'))}</a>`:''}<button type="button" class="customer-text-button" data-action="logout" ${busy?'disabled':''}>${e(L('ออกจากระบบ','Sign out','退出登录'))}</button></div>`;return;
    }
    const reset=mode==='reset',recovery=mode==='recovery',signup=mode==='signup',disabled=busy||!authConfigured;
    const title=signup?L('เริ่มต้นสิ่งดี ๆ ด้วยกัน','Make yourself at home.','开启美好购物体验。'):reset?L('ลืมรหัสผ่าน? ไม่เป็นไร','Let us get you back in.','找回您的账户。'):recovery?L('ตั้งรหัสผ่านใหม่','A fresh start.','设置新密码。'):L('ยินดีต้อนรับกลับมา','Good to see you again.','欢迎回来。');
    const action=signup?L('สร้างบัญชี','Create account','注册账户'):reset?L('ส่งลิงก์ตั้งรหัสผ่านใหม่','Send reset link','发送重设链接'):recovery?L('บันทึกรหัสผ่านใหม่','Save new password','保存新密码'):L('เข้าสู่ระบบ','Sign in','登录');
    root.innerHTML=`<div class="customer-icon-badge">${S.icon('user',26)}</div><h2>${e(title)}</h2><p class="account-intro">${e(reset?L('กรอกอีเมลที่ใช้สมัครเพื่อรับลิงก์ตั้งรหัสผ่านใหม่','Enter your account email to receive a reset link.','输入注册邮箱以接收重设密码链接。'):recovery?L('ใช้รหัสผ่านที่ปลอดภัยอย่างน้อย 12 ตัวอักษร','Choose a unique password with at least 12 characters.','请设置至少12个字符的独立密码。'):L('เข้าสู่บัญชีเพื่อสั่งซื้อและติดตามสินค้าของคุณ','Your orders, deliveries, and next good find await.','登录以购买商品并追踪您的订单。'))}</p>${!authConfigured?`<div class="customer-notice">${e(S.t(S.configured?messages.unavailable:messages.preview))}</div>`:''}${!reset&&!recovery?`<div class="account-tabs"><button type="button" data-mode="login" class="${!signup?'active':''}" aria-pressed="${!signup}">${e(L('เข้าสู่ระบบ','Sign in','登录'))}</button><button type="button" data-mode="signup" class="${signup?'active':''}" aria-pressed="${signup}">${e(L('สร้างบัญชี','Create account','注册'))}</button></div>`:''}<form class="account-form" id="account-form">${signup?`<label class="field" for="account-name">${e(L('ชื่อของคุณ','Your name','您的姓名'))}<input id="account-name" name="name" class="input" autocomplete="name" value="${e(name)}" maxlength="120" minlength="2" required ${disabled?'disabled':''}></label>`:''}${!recovery?`<label class="field" for="account-email">${e(L('อีเมล','Email address','邮箱'))}<input id="account-email" name="email" class="input" type="email" autocomplete="email" value="${e(email)}" placeholder="you@example.com" maxlength="254" required ${disabled?'disabled':''}></label>`:''}${!reset?`<label class="field" for="account-password">${e(recovery?L('รหัสผ่านใหม่','New password','新密码'):L('รหัสผ่าน','Password','密码'))}<div class="customer-password"><input id="account-password" name="password" class="input" type="${showPassword?'text':'password'}" autocomplete="${mode==='login'?'current-password':'new-password'}" value="${e(password)}" ${mode!=='login'?'minlength="12"':''} maxlength="128" required ${disabled?'disabled':''}><button type="button" data-action="password" aria-label="${e(showPassword?L('ซ่อนรหัสผ่าน','Hide password','隐藏密码'):L('แสดงรหัสผ่าน','Show password','显示密码'))}">${showPassword?'◉':'◎'}</button></div>${signup?`<small>${e(L('อย่างน้อย 12 ตัวอักษร','At least 12 characters','至少12个字符'))}</small>`:''}</label>`:''}${mode==='login'?`<button type="button" data-mode="reset" class="customer-text-button forgot-password">${e(L('ลืมรหัสผ่าน?','Forgot password?','忘记密码？'))}</button>`:''}${recovery&&!user?`<div class="customer-error">${e(L('ลิงก์ตั้งรหัสผ่านอาจหมดอายุ กรุณาขอลิงก์ใหม่ทางอีเมล','Your reset link may have expired. Please request a new email link.','重设密码链接可能已失效，请重新申请。'))}</div>`:''}${feedback()}<button class="button customer-wide" type="submit" ${disabled||(recovery&&!user)?'disabled':''}>${e(busy?L('กำลังดำเนินการ…','Working…','处理中…'):action)}${S.icon('arrow',17)}</button>${reset||recovery?`<button type="button" class="customer-text-button" data-mode="${recovery&&!user?'reset':'login'}">${e(recovery&&!user?L('ขอลิงก์ใหม่','Request a new link','申请新链接'):L('กลับไปเข้าสู่ระบบ','Back to sign in','返回登录'))}</button>`:''}</form><p class="account-footnote">${S.icon('user',14)}${e(L('ข้อมูลคำสั่งซื้อแสดงเฉพาะเจ้าของบัญชี','Only you can access your account orders.','仅您本人可查看账户中的订单。'))}</p>`;
  }
  root.addEventListener('input',event=>{const input=event.target;if(input.name==='email')email=input.value;if(input.name==='password')password=input.value;if(input.name==='name')name=input.value;});
  root.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button||busy)return;
    if(button.dataset.mode){mode=button.dataset.mode;password='';error=null;notice=null;render();return;}
    if(button.dataset.action==='password'){showPassword=!showPassword;const input=root.querySelector('#account-password');if(input)input.type=showPassword?'text':'password';button.setAttribute('aria-label',showPassword?L('ซ่อนรหัสผ่าน','Hide password','隐藏密码'):L('แสดงรหัสผ่าน','Show password','显示密码'));button.textContent=showPassword?'◉':'◎';return;}
    if(button.dataset.action==='logout'){busy=true;error=null;render();try{await S.api('/api/auth/logout',{method:'POST',body:{}});user=null;mode='login';notice=null;password='';}catch(err){error=friendly(err);}finally{busy=false;render();}}
  });
  root.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!authConfigured)return;const action=mode;busy=true;error=null;notice=null;render();
    try{const endpoint=action==='recovery'?'update-password':action;const body=action==='reset'?{email:email.trim()}:action==='recovery'?{password}:{email:email.trim(),password,...(action==='signup'?{name:name.trim()}:{})};const result=await S.api(`/api/auth/${endpoint}`,{method:'POST',body});
      if(action==='reset')notice=messages.reset;
      else if(action==='recovery'){password='';mode='login';notice=messages.updated;history.replaceState(null,'','/account');if(result.user)user=result.user;}
      else{user=result.user||null;password='';if(action==='signup'&&!user)notice=messages.confirm;}
    }catch(err){error=friendly(err);}finally{busy=false;render();}
  });
  S.onChange(event=>{if(event.detail.type==='locale')render();});
  async function check(){try{const data=await S.api('/api/auth/me',{cache:'no-store'});user=data.user||null;authConfigured=!!data.configured;}catch(err){error=friendly(err);}finally{checking=false;render();}}
  check();
})();


