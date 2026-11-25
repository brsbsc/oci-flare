import{p as createIcon,d as defineComponent,r as ref,q as watch,o as onMounted,S as onUnmounted,c as createElementBlock,a as createElementVNode,n as normalizeClass,R as normalizeStyle,b as createVNode,u as unref,h as createCommentVNode,F as Fragment,x as renderList,y as toDisplayString,z as createBlock,g as withCtx,T as Transition,j as useRoute,A as logoutApi,B as clearToken,i as useRouter,k as openBlock,C as resolveDynamicComponent,X as XIcon,f as createTextVNode,D as resolveComponent,J as computed}from"./index-DwZEqr4A.js";
import{C as CpuIcon}from"./cpu-DXhH09MM.js";
import{C as ChevronLeft,a as ChevronRight,G as GlobeIcon}from"./globe-B50gmVkX.js";
import{C as CloudIcon}from"./cloud-CXwMDqrH.js";
import{L as ListTodoIcon}from"./list-todo-PMH-fdWU.js";
import{STYLE_META,getStyle,getTheme,getWidth,setStyle,setTheme,toggleTheme,setWidth,toggleWidth,onThemeChange,applyPrefs}from"./theme-store.js";

const LogOutIcon=createIcon({name:"log-out",size:24,node:[["path",{d:"m16 17 5-5-5-5",key:"1bji2h"}],["path",{d:"M21 12H9",key:"dn1m92"}],["path",{d:"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4",key:"1uf3rs"}]]});
const MenuIcon=createIcon({name:"menu",size:24,node:[["path",{d:"M4 5h16",key:"1tepv9"}],["path",{d:"M4 12h16",key:"1lakjw"}],["path",{d:"M4 19h16",key:"1djgab"}]]});
const MoonIcon=createIcon({name:"moon",size:24,node:[["path",{d:"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401",key:"kfwtm"}]]});
const SettingsIcon=createIcon({name:"settings",size:24,node:[["path",{d:"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",key:"1i5ecw"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]});
const SunIcon=createIcon({name:"sun",size:24,node:[["circle",{cx:"12",cy:"12",r:"4",key:"4exip2"}],["path",{d:"M12 2v2",key:"tus03m"}],["path",{d:"M12 20v2",key:"1lh1kg"}],["path",{d:"m4.93 4.93 1.41 1.41",key:"149t6j"}],["path",{d:"m17.66 17.66 1.41 1.41",key:"ptbguv"}],["path",{d:"M2 12h2",key:"1t8f8n"}],["path",{d:"M20 12h2",key:"1q8mjw"}],["path",{d:"m6.34 17.66-1.41 1.41",key:"1m8zz5"}],["path",{d:"m19.07 4.93-1.41 1.41",key:"1shlcs"}]]});
const PaletteIcon=createIcon({name:"palette",size:24,node:[["circle",{cx:"13.5",cy:"6.5",r:".5",fill:"currentColor"}],["circle",{cx:"17.5",cy:"10.5",r:".5",fill:"currentColor"}],["circle",{cx:"8.5",cy:"7.5",r:".5",fill:"currentColor"}],["circle",{cx:"6.5",cy:"12.5",r:".5",fill:"currentColor"}],["path",{d:"M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"}]]});
const ExpandIcon=createIcon({name:"maximize-2",size:24,node:[["polyline",{points:"15 3 21 3 21 9"}],["polyline",{points:"9 21 3 21 3 15"}],["line",{x1:"21",x2:"14",y1:"3",y2:"10"}],["line",{x1:"3",x2:"10",y1:"21",y2:"14"}]]});
const ShrinkIcon=createIcon({name:"minimize-2",size:24,node:[["polyline",{points:"4 14 10 14 10 20"}],["polyline",{points:"20 10 14 10 14 4"}],["line",{x1:"14",x2:"21",y1:"10",y2:"3"}],["line",{x1:"3",x2:"10",y1:"21",y2:"14"}]]});
const CheckIcon=createIcon({name:"check",size:24,node:[["path",{d:"M20 6 9 17l-5-5"}]]});

const Ve=defineComponent({
  __name:"AppShell",
  setup(){
    const route=useRoute();
    const router=useRouter();
    const navItems=[
      {name:"cfgs",label:"OCI 配置",icon:CloudIcon},
      {name:"tasks",label:"任务管理",icon:ListTodoIcon},
      {name:"cloudflare",label:"Cloudflare",icon:GlobeIcon},
      {name:"settings",label:"系统设置",icon:SettingsIcon}
    ];
    const collapsed=ref((()=>{try{return localStorage.getItem("oci_mini_sidebar")==="1"}catch{return!1}})());
    const style=ref(getStyle());
    const theme=ref(getTheme());
    const width=ref(getWidth());
    const mobileOpen=ref(!1);
    const themeMenuOpen=ref(!1);
    const popoverAnchor=ref(null);

    const activeStyleMeta=computed(()=>STYLE_META.find(s=>s.id===style.value)||STYLE_META[0]);

    watch(()=>route.fullPath,()=>{mobileOpen.value=!1;themeMenuOpen.value=!1});

    function toggleSidebar(){
      collapsed.value=!collapsed.value;
      try{localStorage.setItem("oci_mini_sidebar",collapsed.value?"1":"0")}catch{}
    }
    function pickStyle(id){setStyle(id)}
    function pickTheme(mode){setTheme(mode)}
    function onToggleTheme(){toggleTheme()}
    function pickWidth(w){setWidth(w)}
    function onToggleWidth(){toggleWidth()}

    function onDocPointerDown(e){
      if(!themeMenuOpen.value)return;
      const el=popoverAnchor.value;
      if(el&&!el.contains(e.target))themeMenuOpen.value=!1;
    }
    function onDocKeyDown(e){
      if(e.key==="Escape"&&themeMenuOpen.value){
        e.stopPropagation();
        themeMenuOpen.value=!1;
      }
    }

    let unsubTheme=null;
    onMounted(()=>{
      applyPrefs();
      unsubTheme=onThemeChange(d=>{
        style.value=d.style;
        theme.value=d.theme;
        width.value=d.width;
      });
      document.addEventListener("pointerdown",onDocPointerDown);
      document.addEventListener("keydown",onDocKeyDown);
    });
    onUnmounted(()=>{
      if(unsubTheme)unsubTheme();
      document.removeEventListener("pointerdown",onDocPointerDown);
      document.removeEventListener("keydown",onDocKeyDown);
    });

    async function logout(){await logoutApi();clearToken();router.push("/login")}
    function isNavActive(name){return name==="cfgs"?route.path.startsWith("/cfgs"):route.name===name}

    return()=>{
      const RouterLink=resolveComponent("RouterLink");
      const RouterView=resolveComponent("RouterView");
      return(openBlock(),createElementBlock("div",{class:"flex h-screen overflow-hidden"},[
        // Desktop Sidebar
        createElementVNode("aside",{class:normalizeClass(["shell-sidebar hidden shrink-0 flex-col overflow-y-auto transition-[width] duration-200 md:flex",collapsed.value?"w-[68px]":"w-56"])},[
          createElementVNode("div",{class:"px-3 py-5"},[
            createElementVNode("div",{class:normalizeClass(["flex items-center gap-2.5",collapsed.value?"justify-center":""])},[
              createElementVNode("div",{class:"brand-mark size-9"},[createVNode(unref(CpuIcon),{class:"size-5"})]),
              collapsed.value?createCommentVNode("",!0):(openBlock(),createElementBlock("div",{key:0,class:"min-w-0 flex-1"},[
                createElementVNode("div",{class:"truncate text-sm font-semibold tracking-wide text-white"},"OCI Flare"),
                createElementVNode("div",{class:"truncate text-[11px] text-slate-500"},"Edge Console")
              ])),
              collapsed.value?createCommentVNode("",!0):(openBlock(),createElementBlock("button",{key:1,type:"button",class:"header-icon-btn shrink-0",title:"收起侧边栏","aria-label":"收起侧边栏",onClick:toggleSidebar},[createVNode(unref(ChevronLeft),{class:"size-4"})]))
            ],2),
            collapsed.value?(openBlock(),createElementBlock("button",{key:0,type:"button",class:"header-icon-btn mt-3 w-full justify-center",title:"展开侧边栏","aria-label":"展开侧边栏",onClick:toggleSidebar},[createVNode(unref(ChevronRight),{class:"size-4"})])):createCommentVNode("",!0)
          ]),
          createElementVNode("nav",{class:"flex flex-1 flex-col gap-1 px-2","aria-label":"主导航"},[
            (openBlock(),createElementBlock(Fragment,null,renderList(navItems,item=>createVNode(RouterLink,{
              key:item.name,
              to:{name:item.name},
              class:normalizeClass(["flex items-center gap-3 rounded-lg py-2.5 text-sm transition-colors",[collapsed.value?"justify-center px-0":"px-3",isNavActive(item.name)?"nav-item-active":"nav-item-idle"]]),
              title:collapsed.value?item.label:void 0,
              "aria-label":collapsed.value?item.label:void 0
            },{
              default:withCtx(()=>[
                (openBlock(),createBlock(resolveDynamicComponent(item.icon),{class:"size-4 shrink-0"})),
                collapsed.value?createCommentVNode("",!0):(openBlock(),createElementBlock("span",{key:0,class:"flex-1 truncate"},toDisplayString(item.label),1))
              ]),
              _:2
            },1032,["to","class","title","aria-label"])),64))
          ])
        ],2),

        // Main Area
        createElementVNode("main",{class:"flex min-w-0 flex-1 flex-col overflow-hidden"},[
          createElementVNode("header",{class:"shell-header shrink-0 px-4 py-3 md:px-8"},[
            createElementVNode("div",{class:"shell-header-inner"},[
              createElementVNode("div",{class:"flex min-w-0 items-center gap-2"},[
                createElementVNode("button",{type:"button",class:"header-icon-btn shrink-0 md:hidden",title:"打开菜单","aria-label":"打开菜单",onClick:()=>{mobileOpen.value=!0}},[createVNode(unref(MenuIcon),{class:"size-5"})]),
                createElementVNode("div",{class:"min-w-0"},[
                  createElementVNode("h1",{class:"truncate text-base font-semibold text-white md:text-lg"},toDisplayString(unref(route).meta.title||"OCI Flare"),1),
                  createElementVNode("p",{class:"hidden truncate text-xs text-slate-500 sm:block"},toDisplayString(unref(route).meta.desc||""),1)
                ])
              ]),
              createElementVNode("div",{class:"flex shrink-0 items-center gap-1"},[
                // Theme Switcher Popover
                createElementVNode("div",{ref_key:"popoverAnchor",ref:popoverAnchor,class:"theme-popover-anchor"},[
                  createElementVNode("button",{
                    type:"button",
                    class:normalizeClass(["header-icon-btn",themeMenuOpen.value?"is-open":""]),
                    title:"切换风格主题",
                    "aria-label":"切换风格主题",
                    "aria-haspopup":"menu",
                    "aria-expanded":String(themeMenuOpen.value),
                    onClick:()=>{themeMenuOpen.value=!themeMenuOpen.value}
                  },[
                    createVNode(unref(PaletteIcon),{class:"size-4"}),
                    createElementVNode("span",{class:"hidden text-xs font-medium sm:inline"},toDisplayString(activeStyleMeta.value.shortName),1)
                  ],10,["aria-expanded"]),
                  createVNode(Transition,{name:"fade"},{
                    default:withCtx(()=>[
                      themeMenuOpen.value?(openBlock(),createElementBlock("div",{key:0,class:"theme-popover",role:"menu","aria-label":"风格主题设置"},[
                        createElementVNode("div",{class:"theme-popover-title"},"界面风格主题"),
                        createElementVNode("div",{class:"theme-option-list"},[
                          (openBlock(),createElementBlock(Fragment,null,renderList(STYLE_META,item=>createElementVNode("button",{
                            key:item.id,
                            type:"button",
                            role:"menuitemradio",
                            "aria-checked":String(style.value===item.id),
                            class:normalizeClass(["theme-option",style.value===item.id?"is-active":""]),
                            onClick:()=>pickStyle(item.id)
                          },[
                            createElementVNode("span",{class:"theme-swatches"},[
                              (openBlock(),createElementBlock(Fragment,null,renderList(item.swatches[theme.value]||item.swatches.dark,(hex,idx)=>createElementVNode("span",{key:idx,class:"theme-swatch-dot",style:normalizeStyle({backgroundColor:hex})},null,4)),64))
                            ]),
                            createElementVNode("span",{class:"min-w-0 flex-1"},[
                              createElementVNode("span",{class:"block truncate text-xs font-medium text-white"},toDisplayString(item.name),1),
                              createElementVNode("span",{class:"block truncate text-[11px] text-slate-500"},toDisplayString(item.desc),1)
                            ]),
                            style.value===item.id?(openBlock(),createBlock(unref(CheckIcon),{key:0,class:"size-4 shrink-0 text-sky-300"})):createCommentVNode("",!0)
                          ],10,["aria-checked","onClick"])),64))
                        ]),
                        createElementVNode("div",{class:"theme-popover-footer"},[
                          createElementVNode("div",{class:"segmented-group",role:"group","aria-label":"明暗模式"},[
                            createElementVNode("button",{type:"button",class:normalizeClass(["segmented-btn flex-1",theme.value==="dark"?"is-active":""]),"aria-pressed":String(theme.value==="dark"),onClick:()=>pickTheme("dark")},"深色",10,["aria-pressed"]),
                            createElementVNode("button",{type:"button",class:normalizeClass(["segmented-btn flex-1",theme.value==="light"?"is-active":""]),"aria-pressed":String(theme.value==="light"),onClick:()=>pickTheme("light")},"浅色",10,["aria-pressed"])
                          ]),
                          createElementVNode("div",{class:"segmented-group",role:"group","aria-label":"页面宽度"},[
                            createElementVNode("button",{type:"button",class:normalizeClass(["segmented-btn flex-1",width.value==="boxed"?"is-active":""]),"aria-pressed":String(width.value==="boxed"),onClick:()=>pickWidth("boxed")},"居中",10,["aria-pressed"]),
                            createElementVNode("button",{type:"button",class:normalizeClass(["segmented-btn flex-1",width.value==="wide"?"is-active":""]),"aria-pressed":String(width.value==="wide"),onClick:()=>pickWidth("wide")},"宽屏",10,["aria-pressed"])
                          ])
                        ])
                      ])):createCommentVNode("",!0)
                    ]),
                    _:1
                  })
                ],512),

                // Width Toggle (Desktop)
                createElementVNode("button",{
                  type:"button",
                  class:"header-icon-btn hidden md:flex",
                  title:width.value==="boxed"?"切换为宽屏布局":"切换为居中布局",
                  "aria-label":width.value==="boxed"?"切换为宽屏布局":"切换为居中布局",
                  onClick:onToggleWidth
                },[
                  width.value==="boxed"?(openBlock(),createBlock(unref(ExpandIcon),{key:0,class:"size-4"})):(openBlock(),createBlock(unref(ShrinkIcon),{key:1,class:"size-4"}))
                ],8,["title","aria-label"]),

                // Quick Dark/Light Toggle
                createElementVNode("button",{
                  type:"button",
                  class:"header-icon-btn",
                  title:theme.value==="dark"?"切换到浅色模式":"切换到深色模式",
                  "aria-label":theme.value==="dark"?"切换到浅色模式":"切换到深色模式",
                  onClick:onToggleTheme
                },[
                  theme.value==="dark"?(openBlock(),createBlock(unref(SunIcon),{key:0,class:"size-4"})):(openBlock(),createBlock(unref(MoonIcon),{key:1,class:"size-4"}))
                ],8,["title","aria-label"]),

                // Logout
                createElementVNode("button",{type:"button",class:"header-icon-btn",title:"退出登录","aria-label":"退出登录",onClick:logout},[createVNode(unref(LogOutIcon),{class:"size-4"})])
              ])
            ])
          ]),

          // Centered Scrollable Page Content
          createElementVNode("div",{class:"min-h-0 flex-1 overflow-y-auto px-4 py-5 pb-20 md:px-8 md:py-6 md:pb-6"},[
            createElementVNode("div",{class:"shell-container"},[
              createVNode(RouterView)
            ])
          ])
        ]),

        // Mobile Bottom Nav
        createElementVNode("nav",{class:"shell-mobile-nav fixed inset-x-0 bottom-0 z-40 flex items-stretch pb-[env(safe-area-inset-bottom)] md:hidden","aria-label":"移动端导航"},[
          (openBlock(),createElementBlock(Fragment,null,renderList(navItems,item=>createVNode(RouterLink,{
            key:item.name,
            to:{name:item.name},
            class:normalizeClass(["flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition-colors",isNavActive(item.name)?"text-sky-300 font-medium":"text-slate-500"])
          },{
            default:withCtx(()=>[
              (openBlock(),createBlock(resolveDynamicComponent(item.icon),{class:"size-5 shrink-0"})),
              createElementVNode("span",{class:"truncate"},toDisplayString(item.label),1)
            ]),
            _:2
          },1032,["to","class"])),64))
        ]),

        // Mobile Slide Drawer
        createVNode(Transition,{name:"fade"},{
          default:withCtx(()=>[
            mobileOpen.value?(openBlock(),createElementBlock("div",{key:0,class:"fixed inset-0 z-50 md:hidden"},[
              createElementVNode("div",{class:"ui-dialog-backdrop",onClick:()=>{mobileOpen.value=!1}}),
              createElementVNode("div",{class:"panel absolute inset-y-0 left-0 w-[78%] max-w-xs overflow-y-auto rounded-none p-4 shadow-2xl"},[
                createElementVNode("div",{class:"mb-5 flex items-center justify-between"},[
                  createElementVNode("div",{class:"flex items-center gap-2.5"},[
                    createElementVNode("div",{class:"brand-mark size-9"},[createVNode(unref(CpuIcon),{class:"size-5"})]),
                    createElementVNode("div",null,[
                      createElementVNode("div",{class:"text-sm font-semibold text-white"},"OCI Flare"),
                      createElementVNode("div",{class:"text-[11px] text-slate-500"},"Edge Console")
                    ])
                  ]),
                  createElementVNode("button",{type:"button",class:"header-icon-btn",title:"关闭菜单","aria-label":"关闭菜单",onClick:()=>{mobileOpen.value=!1}},[createVNode(unref(XIcon),{class:"size-4"})])
                ]),
                createElementVNode("nav",{class:"flex flex-col gap-1"},[
                  (openBlock(),createElementBlock(Fragment,null,renderList(navItems,item=>createVNode(RouterLink,{
                    key:item.name,
                    to:{name:item.name},
                    class:normalizeClass(["flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors",isNavActive(item.name)?"nav-item-active":"nav-item-idle"])
                  },{
                    default:withCtx(()=>[
                      (openBlock(),createBlock(resolveDynamicComponent(item.icon),{class:"size-4 shrink-0"})),
                      createElementVNode("span",{class:"flex-1 truncate"},toDisplayString(item.label),1)
                    ]),
                    _:2
                  },1032,["to","class"])),64))
                ]),
                createElementVNode("div",{class:"mt-5 space-y-3 border-t border-white/[0.06] pt-4"},[
                  createElementVNode("div",null,[
                    createElementVNode("div",{class:"theme-popover-title"},"界面风格主题"),
                    createElementVNode("div",{class:"segmented-group w-full"},[
                      (openBlock(),createElementBlock(Fragment,null,renderList(STYLE_META,item=>createElementVNode("button",{
                        key:item.id,
                        type:"button",
                        class:normalizeClass(["segmented-btn flex-1",style.value===item.id?"is-active":""]),
                        "aria-pressed":String(style.value===item.id),
                        onClick:()=>pickStyle(item.id)
                      },toDisplayString(item.shortName),11,["aria-pressed","onClick"])),64))
                    ])
                  ]),
                  createElementVNode("button",{type:"button",class:"flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-400 hover:bg-white/[0.04]",onClick:onToggleTheme},[
                    theme.value==="dark"?(openBlock(),createBlock(unref(SunIcon),{key:0,class:"size-4"})):(openBlock(),createBlock(unref(MoonIcon),{key:1,class:"size-4"})),
                    createTextVNode(" "+toDisplayString(theme.value==="dark"?"切换到浅色模式":"切换到深色模式"),1)
                  ]),
                  createElementVNode("button",{type:"button",class:"flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-rose-300 hover:bg-rose-500/10",onClick:logout},[
                    createVNode(unref(LogOutIcon),{class:"size-4"}),
                    createTextVNode(" 退出登录 ")
                  ])
                ])
              ])
            ])):createCommentVNode("",!0)
          ]),
          _:1
        })
      ]))
    };
  }
});
export{Ve as default};
