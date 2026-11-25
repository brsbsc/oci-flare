import{p as createIcon,d as defineComponent,o as onMounted,q as watch,c as createElementBlock,a as createElementVNode,b as createVNode,g as withCtx,y as toDisplayString,z as createBlock,h as createCommentVNode,u as unref,F as Fragment,x as renderList,r as ref,D as resolveComponent,k as openBlock,f as createTextVNode,n as normalizeClass,j as useRoute,J as computed,l as api,t as toast}from"./index-DwZEqr4A.js";
import{u as useCfgScope}from"./useCfgScope-B5eFeo1q.js";
import{_ as UiBadge}from"./UiBadge.vue_vue_type_script_setup_true_lang-BnzI1Z_L.js";
import{_ as UiButton}from"./UiButton.vue_vue_type_script_setup_true_lang-B6_iRLwp.js";
import{R as RefreshIcon}from"./refresh-cw-1ggkkG3g.js";
import{C as CopyIcon}from"./copy-Bv3ljlPt.js";

const ArrowLeftIcon=createIcon({name:"arrow-left",size:24,node:[["path",{d:"m12 19-7-7 7-7",key:"1l729n"}],["path",{d:"M19 12H5",key:"x3x0zl"}]]});

const ye=defineComponent({
  __name:"CfgDetailView",
  setup(){
    const route=useRoute();
    const cfgId=computed(()=>String(route.params.cfgId??""));
    const cfg=ref(null);
    const loading=ref(!1);
    const{region,compartment,regions,compartments,ensureScope,setRegion,setCompartment}=useCfgScope(cfgId);
    const tabs=[
      {name:"cfgTenant",label:"租户管理"},
      {name:"cfgInstances",label:"实例详情"},
      {name:"cfgBootVolumes",label:"引导卷"},
      {name:"cfgNetwork",label:"虚拟云网络"},
      {name:"cfgTraffic",label:"流量统计"},
      {name:"cfgLimits",label:"配额查询"},
      {name:"cfgCost",label:"成本分析"}
    ];

    async function loadCfg(){
      if(!cfgId.value)return;
      loading.value=!0;
      try{
        const{item}=await api.cfg(cfgId.value);
        cfg.value=item;
        await ensureScope(item.region,item.compartmentId||"");
      }catch(err){toast(err.message,"error")}
      finally{loading.value=!1}
    }

    async function copyOcid(){
      const val=cfg.value?.tenancyOcid;
      if(!val)return;
      try{await navigator.clipboard.writeText(val);toast("已复制 Tenancy OCID","success")}
      catch{toast("复制失败，请手动复制","error")}
    }

    onMounted(loadCfg);
    watch(cfgId,loadCfg);
    function statusTone(st){return st==="active"?"green":st==="invalid"?"red":"slate"}

    return()=>{
      const RouterLink=resolveComponent("RouterLink");
      const RouterView=resolveComponent("RouterView");
      const cur=cfg.value;
      const multiCount=cur?.regions?.length??0;
      return(openBlock(),createElementBlock("div",{class:"space-y-4"},[
        createElementVNode("section",{class:"panel cfg-context-card"},[
          createElementVNode("div",{class:"cfg-context-top"},[
            createVNode(RouterLink,{to:{name:"cfgs"},class:"header-icon-btn",title:"返回配置列表","aria-label":"返回配置列表"},{default:withCtx(()=>[createVNode(unref(ArrowLeftIcon),{class:"size-4"})]),_:1}),
            createElementVNode("div",{class:"min-w-0 flex-1"},[
              createElementVNode("div",{class:"flex flex-wrap items-center gap-2"},[
                createElementVNode("span",{class:"truncate text-base font-semibold text-white"},toDisplayString(cur?.name??"加载中…"),1),
                cur?(openBlock(),createBlock(UiBadge,{key:0,tone:statusTone(cur.status)},{default:withCtx(()=>[createTextVNode(toDisplayString(cur.status==="active"?"已连接":cur.status),1)]),_:1},8,["tone"])):createCommentVNode("",!0),
                createElementVNode("span",{class:"font-mono text-xs text-slate-400"},toDisplayString(cur?.region??""),1),
                multiCount>1?(openBlock(),createElementBlock("span",{key:1,class:"ui-badge ui-badge-sky"},"订阅 "+toDisplayString(multiCount)+" 个区域",1)):createCommentVNode("",!0)
              ]),
              cur?.tenancyOcid?(openBlock(),createElementBlock("div",{key:0,class:"cfg-context-ocid"},[
                createElementVNode("span",{class:"truncate",title:cur.tenancyOcid},toDisplayString(cur.tenancyOcid),9,["title"]),
                createElementVNode("button",{type:"button",class:"shrink-0 rounded p-1 text-slate-400 hover:text-white",title:"复制 Tenancy OCID","aria-label":"复制 Tenancy OCID",onClick:copyOcid},[createVNode(unref(CopyIcon),{class:"size-3"})])
              ])):createCommentVNode("",!0)
            ]),
            createVNode(UiButton,{size:"sm",variant:"secondary",loading:loading.value,title:"刷新账号配置","aria-label":"刷新账号配置",onClick:loadCfg},{default:withCtx(()=>[createVNode(unref(RefreshIcon),{class:"size-3.5"}),createElementVNode("span",{class:"hidden sm:inline"},"刷新配置")]),_:1},8,["loading"])
          ]),
          createElementVNode("div",{class:"cfg-context-scope"},[
            createElementVNode("span",{class:"text-xs font-medium text-slate-400"},"作用范围"),
            createElementVNode("label",{class:"inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-slate-500"},[
              createTextVNode("区域"),
              createElementVNode("select",{class:"field h-8 w-44 py-0 text-xs",value:unref(region),title:"区域（Region）",onChange:e=>unref(setRegion)(e.target.value)},[
                (openBlock(!0),createElementBlock(Fragment,null,renderList(unref(regions),r=>(openBlock(),createElementBlock("option",{key:r,value:r},toDisplayString(r),9,["value"]))),128))
              ],40,["value"])
            ]),
            createElementVNode("label",{class:"inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-slate-500"},[
              createTextVNode("区间"),
              createElementVNode("select",{class:"field h-8 w-56 py-0 text-xs",value:unref(compartment),title:"区间（Compartment）",onChange:e=>unref(setCompartment)(e.target.value)},[
                (openBlock(!0),createElementBlock(Fragment,null,renderList(unref(compartments),c=>(openBlock(),createElementBlock("option",{key:c.id,value:c.id},toDisplayString(c.path),9,["value"]))),128))
              ],40,["value"])
            ]),
            createElementVNode("span",{class:"hidden text-[11px] text-slate-500 sm:inline"},"切换后全部子标签同步生效")
          ])
        ]),
        createElementVNode("nav",{class:"cfg-tabs","aria-label":"租户子页面"},[
          (openBlock(),createElementBlock(Fragment,null,renderList(tabs,tab=>createVNode(RouterLink,{
            key:tab.name,
            to:{name:tab.name,params:{cfgId:cfgId.value}},
            class:normalizeClass(["cfg-tab",unref(route).name===tab.name?"is-active":""])
          },{default:withCtx(()=>[createTextVNode(toDisplayString(tab.label),1)]),_:2},1032,["to","class"])),64))
        ]),
        createVNode(RouterView)
      ]))
    };
  }
});
export{ye as default};
