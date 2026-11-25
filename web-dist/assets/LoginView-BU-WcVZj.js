import{p as createIcon,d as defineComponent,o as onMounted,S as onUnmounted,c as createElementBlock,a as createElementVNode,b as createVNode,u as unref,w as withModifiers,e as withDirectives,v as vModelText,f as createTextVNode,g as withCtx,F as Fragment,x as renderList,y as toDisplayString,z as createBlock,n as normalizeClass,h as createCommentVNode,r as ref,i as useRouter,j as useRoute,k as openBlock,l as api,s as setToken,t as toast,m as nextTick}from"./index-DwZEqr4A.js";
import{_ as UiButton}from"./UiButton.vue_vue_type_script_setup_true_lang-B6_iRLwp.js";
import{C as CpuIcon}from"./cpu-DXhH09MM.js";
import{K as KeyRoundIcon}from"./key-round-DrCfjuHl.js";
import{STYLE_META,getStyle,getTheme,setStyle,toggleTheme,onThemeChange,applyPrefs}from"./theme-store.js";

const SunIcon=createIcon({name:"sun",size:24,node:[["circle",{cx:"12",cy:"12",r:"4"}],["path",{d:"M12 2v2"}],["path",{d:"M12 20v2"}],["path",{d:"m4.93 4.93 1.41 1.41"}],["path",{d:"m17.66 17.66 1.41 1.41"}],["path",{d:"M2 12h2"}],["path",{d:"M20 12h2"}],["path",{d:"m6.34 17.66-1.41 1.41"}],["path",{d:"m19.07 4.93-1.41 1.41"}]]});
const MoonIcon=createIcon({name:"moon",size:24,node:[["path",{d:"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"}]]});

const se=defineComponent({
  __name:"LoginView",
  setup(){
    const password=ref("");
    const code=ref("");
    const loading=ref(!1);
    const clientId=ref("");
    const googleLoading=ref(!1);
    const googleHost=ref(null);
    const style=ref(getStyle());
    const theme=ref(getTheme());
    const router=useRouter();
    const route=useRoute();

    function redirectTarget(){return route.query.redirect||"/cfgs"}

    function loadGsi(){
      var s,e;
      return(e=(s=window.google)==null?void 0:s.accounts)!=null&&e.id?Promise.resolve():new Promise((resolve,reject)=>{
        const existing=document.querySelector('script[data-gis="1"]');
        if(existing){existing.addEventListener("load",()=>resolve());existing.addEventListener("error",()=>reject(new Error("Google SDK 加载失败")));return}
        const script=document.createElement("script");
        script.src="https://accounts.google.com/gsi/client";
        script.async=!0;
        script.defer=!0;
        script.dataset.gis="1";
        script.onload=()=>resolve();
        script.onerror=()=>reject(new Error("Google SDK 加载失败"));
        document.head.appendChild(script);
      });
    }

    async function initGoogle(){
      var s,e,o,n;
      if(!clientId.value)return;
      try{
        await loadGsi();
        let tries=0;
        for(;!((e=(s=window.google)==null?void 0:s.accounts)!=null&&e.id)&&tries++<60;)await new Promise(r=>setTimeout(r,100));
        if(!((n=(o=window.google)==null?void 0:o.accounts)!=null&&n.id))return;
        window.google.accounts.id.initialize({client_id:clientId.value,callback:onGoogleCredential,auto_select:!1,cancel_on_tap_outside:!0});
        await nextTick();
        if(!googleHost.value)return;
        window.google.accounts.id.renderButton(googleHost.value,{theme:"outline",size:"large",type:"standard",width:320});
      }catch{}
    }

    async function onGoogleCredential(resp){
      if(!resp.credential)return;
      googleLoading.value=!0;
      try{
        const{token}=await api.googleLogin(resp.credential);
        setToken(token);
        toast("Google 登录成功","success");
        router.replace(redirectTarget());
      }catch(err){toast(err.message,"error")}
      finally{googleLoading.value=!1}
    }

    let unsub=null;
    onMounted(async()=>{
      applyPrefs();
      unsub=onThemeChange(d=>{style.value=d.style;theme.value=d.theme});
      route.query.expired&&toast("登录已过期，请重新登录","error");
      try{
        const resp=await api.googleClientId();
        resp.clientId&&(clientId.value=resp.clientId,await initGoogle());
      }catch{}
    });
    onUnmounted(()=>{if(unsub)unsub()});

    async function submit(){
      if(!password.value)return;
      loading.value=!0;
      try{
        const{token}=await api.login(password.value,code.value||void 0);
        setToken(token);
        toast("登录成功","success");
        router.replace(redirectTarget());
      }catch(err){toast(err.message,"error")}
      finally{loading.value=!1}
    }

    return()=>(openBlock(),createElementBlock("div",{class:"grid min-h-screen place-items-center px-4"},[
      createElementVNode("div",{class:"login-theme-bar"},[
        createElementVNode("div",{class:"segmented-group",role:"group","aria-label":"切换风格主题"},[
          (openBlock(),createElementBlock(Fragment,null,renderList(STYLE_META,item=>createElementVNode("button",{
            key:item.id,
            type:"button",
            class:normalizeClass(["segmented-btn",style.value===item.id?"is-active":""]),
            "aria-pressed":String(style.value===item.id),
            onClick:()=>setStyle(item.id)
          },toDisplayString(item.shortName),11,["aria-pressed","onClick"])),64))
        ]),
        createElementVNode("button",{
          type:"button",
          class:"header-icon-btn panel",
          title:theme.value==="dark"?"切换到浅色模式":"切换到深色模式",
          "aria-label":theme.value==="dark"?"切换到浅色模式":"切换到深色模式",
          onClick:toggleTheme
        },[
          theme.value==="dark"?(openBlock(),createBlock(unref(SunIcon),{key:0,class:"size-4"})):(openBlock(),createBlock(unref(MoonIcon),{key:1,class:"size-4"}))
        ],8,["title","aria-label"])
      ]),
      createElementVNode("div",{class:"panel w-full max-w-sm p-6"},[
        createElementVNode("div",{class:"mb-6 flex items-center gap-3"},[
          createElementVNode("div",{class:"brand-mark size-10"},[createVNode(unref(CpuIcon),{class:"size-5"})]),
          createElementVNode("div",null,[
            createElementVNode("h1",{class:"text-base font-semibold text-white"},"OCI Flare"),
            createElementVNode("p",{class:"text-xs text-slate-500"},"Cloudflare Workers + D1")
          ])
        ]),
        createElementVNode("form",{class:"space-y-3",onSubmit:withModifiers(submit,["prevent"])},[
          createElementVNode("label",{class:"block"},[
            createElementVNode("span",{class:"mb-1.5 block text-xs font-medium text-slate-300"},"访问密码"),
            createElementVNode("div",{class:"relative"},[
              createVNode(unref(KeyRoundIcon),{class:"pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500"}),
              withDirectives(createElementVNode("input",{"onUpdate:modelValue":v=>{password.value=v},type:"password",class:"field pl-9",placeholder:"请输入访问密码",autocomplete:"current-password"},null,512),[[vModelText,password.value]])
            ])
          ]),
          createElementVNode("label",{class:"block"},[
            createElementVNode("span",{class:"mb-1.5 block text-xs font-medium text-slate-300"},[
              createTextVNode(" 动态验证码 "),
              createElementVNode("span",{class:"font-normal text-slate-500"},"（已开启二次验证时必填）")
            ]),
            withDirectives(createElementVNode("input",{"onUpdate:modelValue":v=>{code.value=v},inputmode:"numeric",maxlength:"6",class:"field text-center font-mono text-lg tracking-[0.4em]",placeholder:"000000",autocomplete:"one-time-code"},null,512),[[vModelText,code.value]])
          ]),
          createVNode(UiButton,{type:"submit",variant:"primary",block:"",loading:loading.value},{default:withCtx(()=>[createTextVNode("登录")]),_:1},8,["loading"])
        ],32),
        clientId.value?(openBlock(),createElementBlock(Fragment,{key:0},[
          createElementVNode("div",{class:"my-4 flex items-center gap-3"},[
            createElementVNode("div",{class:"h-px flex-1 bg-white/10"}),
            createElementVNode("span",{class:"text-[11px] text-slate-500"},"或"),
            createElementVNode("div",{class:"h-px flex-1 bg-white/10"})
          ]),
          createElementVNode("div",{class:normalizeClass(["flex min-h-11 justify-center",googleLoading.value?"opacity-50 pointer-events-none":""])},[
            createElementVNode("div",{ref_key:"googleHost",ref:googleHost,class:"google-signin-host"},null,512)
          ],2)
        ],64)):createCommentVNode("",!0)
      ])
    ]))
  }
});
export{se as default};
