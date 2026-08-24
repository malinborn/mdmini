import{V as $,D as f,R as z,c as B,W as q,r as A,b as U}from"./mermaid-pFY79eek.js";import{H as L,p as Q,m as x,J as _,K as X,M as b,O as j,P as ee,S as te,T as ne}from"./editor-demo-r3K5I51n.js";import"./index-CMzo2fhN.js";const oe=["sk-","pk-","ghp_","ghs_","eyJ","xox","AKIA","token-","secret-"],se=[/^https?:\/\//i,/^localhost$/i,/^true$/i,/^false$/i,/^\d+$/],ie=[/password/i,/secret/i,/token/i,/key$/i,/api_key/i,/apikey/i,/auth/i,/credential/i,/private/i];function H(e,t){if(!e)return!1;if(t){for(const o of ie)if(o.test(t))return!0}for(const o of oe)if(e.startsWith(o))return!0;if(e.length>20&&/[A-Za-z]/.test(e)&&/[0-9]/.test(e)){for(const o of se)if(o.test(e))return!1;return!0}return!1}function F(e){return e.length<20||e.length-6<14?"••••••":e.slice(0,3)+"…"+e.slice(-3)}function P(e){return e.startsWith('"')&&e.endsWith('"')||e.startsWith("'")&&e.endsWith("'")?e.slice(1,-1):e}class re extends q{constructor(t,o,n,s){super(),this.key=t,this.rawValue=o,this.lineFrom=n,this.lineTo=s}eq(t){return this.key===t.key&&this.rawValue===t.rawValue&&this.lineFrom===t.lineFrom&&this.lineTo===t.lineTo}toDOM(){const t=P(this.rawValue),o=!t,n=!o&&H(t,this.key),s=o?"EMPTY":n?F(t):t,i=document.createElement("span");i.className="cm-env-line";const a=document.createElement("span");a.className="cm-env-key",a.textContent=this.key;const c=document.createElement("span");c.className="cm-env-eq",c.textContent="=";const d=o?"cm-env-value cm-env-value-empty":n?"cm-env-value cm-env-value-masked":"cm-env-value",r=document.createElement("span");r.className=d,r.textContent=s;const u=document.createElement("button");return u.className="cm-env-copy",u.textContent="Copy",u.addEventListener("mousedown",p=>{p.preventDefault(),p.stopPropagation(),navigator.clipboard.writeText(t).then(()=>{u.textContent="Copied!",setTimeout(()=>{u.textContent="Copy"},1500)}).catch(()=>{})}),i.appendChild(a),i.appendChild(c),i.appendChild(r),i.appendChild(u),i}ignoreEvent(){return!1}}const ae=/^(\s*)(#.*)$/,le=/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;function M(e){const t=new z,{doc:o}=e.state;for(let n=1;n<=o.lines;n++){const s=o.line(n),i=s.text;if(!i.trim())continue;if(ae.test(i)){t.add(s.from,s.from,f.line({class:"cm-env-comment"}));continue}const a=le.exec(i);if(a){if(B(e,s.from,s.to))continue;const c=a[2],d=a[3],r=new re(c,d,s.from,s.to);t.add(s.from,s.to,f.replace({widget:r}))}}return t.finish()}const ce=$.fromClass(class{decorations;constructor(e){try{this.decorations=M(e)}catch(t){console.warn("Env preview decoration error:",t),this.decorations=f.none}}update(e){if(e.docChanged||e.viewportChanged||e.selectionSet)try{this.decorations=M(e.view)}catch(t){console.warn("Env preview decoration error:",t),this.decorations=f.none}}},{decorations:e=>e.decorations}),de=/^(\s*)(?:(?:export|declare|typeset|local|readonly)\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;function ue(e){const t=de.exec(e);if(!t)return null;const o=t[2],n=t[3],s=e.length-n.length;if(!n)return null;let i;const a=n[0];if(a==='"'){let r=1;for(;r<n.length;){if(n[r]==="\\"){r+=2;continue}if(n[r]==='"'){r+=1;break}r++}i=r}else if(a==="'"){const r=n.indexOf("'",1);i=r===-1?n.length:r+1}else{let r=0;for(;r<n.length&&n[r]!==" "&&n[r]!=="	"&&n[r]!=="#";)r++;i=r}const c=n.slice(0,i);if(!c)return null;const d=P(c);return!d||d.startsWith("$")||d.startsWith("`")||!H(d,o)?null:{key:o,rawValue:c,valueFrom:s,valueTo:s+i}}class he extends q{constructor(t,o,n,s){super(),this.key=t,this.rawValue=o,this.from=n,this.to=s}eq(t){return this.key===t.key&&this.rawValue===t.rawValue&&this.from===t.from&&this.to===t.to}toDOM(){const t=P(this.rawValue),o=F(t),n=document.createElement("span");n.className="cm-shell-secret",n.textContent=o;const s=document.createElement("button");s.className="cm-shell-secret-copy",s.textContent="Copy",s.addEventListener("mousedown",a=>{a.preventDefault(),a.stopPropagation(),navigator.clipboard.writeText(t).then(()=>{s.textContent="Copied!",setTimeout(()=>{s.textContent="Copy"},1500)}).catch(()=>{})});const i=document.createElement("span");return i.className="cm-shell-secret-wrapper",i.appendChild(n),i.appendChild(s),i}ignoreEvent(){return!1}}function R(e){const t=new z,{doc:o}=e.state;for(let n=1;n<=o.lines;n++){const s=o.line(n);if(B(e,s.from,s.to))continue;const i=ue(s.text);if(!i)continue;const a=s.from+i.valueFrom,c=s.from+i.valueTo;t.add(a,c,f.replace({widget:new he(i.key,i.rawValue,a,c)}))}return t.finish()}const me=$.fromClass(class{decorations;constructor(e){try{this.decorations=R(e)}catch(t){console.warn("Shell secret decoration error:",t),this.decorations=f.none}}update(e){if(e.docChanged||e.viewportChanged||e.selectionSet)try{this.decorations=R(e.view)}catch(t){console.warn("Shell secret decoration error:",t),this.decorations=f.none}}},{decorations:e=>e.decorations}),K={".zshrc":"Shell",".zshenv":"Shell",".zprofile":"Shell",".zlogin":"Shell",".zlogout":"Shell",".zsh_aliases":"Shell",".bashrc":"Shell",".bash_profile":"Shell",".bash_login":"Shell",".bash_logout":"Shell",".bash_aliases":"Shell",".profile":"Shell",".aliases":"Shell",".functions":"Shell",".exports":"Shell"};function fe(e){return e.toLowerCase()in K}function pe(e,t){const o=K[e.toLowerCase()],n=o?L.find(i=>i.name===o):void 0;if(n)return n;const s=t.toLowerCase();return L.find(i=>i.extensions.includes(s))??null}const S=`flowchart LR
  A[Draft] --> B[Review]
  B --> C[Ship]
  C --> D[Watch]
  D --> E[Done]`,E={filename:"README.md",kind:"markdown",mermaid:S,body:`# Deploy runway

## Before you ship

Confirm the build is **reproducible** and matches the tag in \`CHANGELOG.md\`. Any heading folds its section away with a click — collapse this one once it's done.
- [x] Bump the version in \`package.json\`
- [ ] Draft the release notes

| Step | Owner | Status |
| --- | --- | --- |
| Build | CI | done |
| Notarize | CI | pending |

\`\`\`bash
npm run build:dev && open dist/md-mini-dev.app
\`\`\`

---

## Once it's out the door

The rollout is *gradual*, never **instant**, and it is ~~definitely not~~ absolutely not something we push on a Friday. Watch the crash rate in \`metrics.dashboard\`, and keep the [release notes](https://github.com/malinborn/mdmini/releases) open in a second window.

1. Announce the build
2. Watch the first hour of crash reports
3. Close the loop once it stays quiet

> If anything looks wrong, roll back first and investigate after.

\`\`\`ts
export function mountDemoEditor(parent: HTMLElement, options: DemoEditorOptions): DemoEditor {
  const view = new EditorView({ state, parent });
  return { view, destroy: () => view.destroy() };
}
\`\`\`

\`\`\`mermaid
${S}
\`\`\`

---

## While you wait

Drop this file on the Dock icon and it opens in its own window, same for a folder full of them. Quit and relaunch and every window comes back where you left it, caret included. Edit it from another terminal and mdmini notices, reloading without asking — nothing here was saved on purpose, it already was. Dark got old an hour ago; one keypress and it's light again.

---`},N={filename:".env",kind:"env",body:`# mdmini — local dev

NODE_ENV=development
PORT=4173
DATABASE_URL=postgres://localhost:5432/mdmini

# third-party
STRIPE_SECRET_KEY=example-value-not-a-real-key
GITHUB_TOKEN=example-value-not-a-real-token
OPENAI_API_KEY=example-value-not-a-real-key
JWT_SECRET=example-value-not-a-real-secret

# flags
ENABLE_ANALYTICS=false
LOG_LEVEL=info`},ge={filename:".zshrc",kind:"shell",body:`# ~/.zshrc

export PATH="$HOME/bin:$PATH"
export EDITOR="mdmini"

export OPENAI_API_KEY="example-value-not-a-real-key"

alias gs="git status"
alias ll="ls -lah"
alias md="mdmini"

function mkcd() {
  mkdir -p "$1" && cd "$1"
}

if [[ -f ~/.zshrc.local ]]; then
  source ~/.zshrc.local
fi`},v=[E,N,ge],G=26,ve=700,Ee=6;function C(e){const t=`${e}

${e}`;return t.endsWith(`

`)?t:`${t}

`}function D(e,t,o){if(t.kind==="markdown"){e.dispatch({effects:[_.reconfigure(X({base:ee,codeLanguages:L,extensions:[te,ne]})),b.reconfigure(j)]}),o();return}if(t.kind==="env"){e.dispatch({effects:[_.reconfigure([]),b.reconfigure(ce)]}),o();return}const n=pe(t.filename,t.filename.replace(/^\./,""));if(!n){o();return}n.load().then(s=>{e.dispatch({effects:[_.reconfigure(s),b.reconfigure(fe(t.filename)?me:[])]}),o()})}function we(e){return e.closest(".demo")?.querySelector(".demo-name")??null}function V(e,t){e&&(e.textContent=`${t} — md-mini`)}function W(e,t){e.scrollPos+=G*t;const o=e.view.scrollDOM.scrollHeight/2;o>0&&e.scrollPos>=o&&(e.scrollPos-=o),e.view.scrollDOM.scrollTop=e.scrollPos}function ye(e){const t=e.view.scrollDOM.scrollHeight/2;return Math.max(Ee,t/G)}function Ae(e){if(Q()){const{view:l}=x(e,{doc:C(E.body)});A(l,S);return}const t=document.createElement("div");t.className="showcase-stage",e.appendChild(t);const o=document.createElement("div");o.className="showcase-lane is-active";const n=document.createElement("div");n.className="showcase-lane",t.appendChild(o),t.appendChild(n);const s=we(e);V(s,E.filename);const{view:i}=x(o,{doc:C(E.body)}),{view:a}=x(n,{doc:C(N.body)}),c={el:o,view:i,scrollPos:i.scrollDOM.scrollTop,actIndex:0,ready:!1},d={el:n,view:a,scrollPos:a.scrollDOM.scrollTop,actIndex:1,ready:!1};D(i,E,()=>{c.ready=!0}),D(a,N,()=>{d.ready=!0}),A(i,S);let r=!0,u=!1,p=0,w=0,k=2%v.length,T=!1,O=!0;e.addEventListener("pointerenter",()=>{T=!0}),e.addEventListener("pointerleave",()=>{T=!1}),new IntersectionObserver(l=>{for(const h of l)O=h.isIntersecting},{threshold:0}).observe(e);function Y(l,h,m){const y=C(h.body);l.view.dispatch({changes:{from:0,to:l.view.state.doc.length,insert:y},selection:{anchor:y.length},annotations:U.addToHistory.of(!1)}),l.scrollPos=0,l.view.scrollDOM.scrollTop=0,l.actIndex=m,l.ready=!1,D(l.view,h,()=>{l.ready=!0}),h.mermaid&&A(l.view,h.mermaid)}function Z(){u=!0;const l=r?d:c,h=r?c:d;l.el.classList.add("is-active"),h.el.classList.remove("is-active"),V(s,v[l.actIndex].filename),window.setTimeout(()=>{r=!r,u=!1,p=0,w=0;const m=v[k];k=(k+1)%v.length,Y(h,m,v.indexOf(m))},ve)}let g=null;function I(l){if(requestAnimationFrame(I),!(O&&!T&&!document.hidden)){g=null;return}if(g===null){g=l;return}const m=(l-g)/1e3;if(g=l,W(c,m),W(d,m),u)return;const y=r?c:d,J=r?d:c;w=Math.max(w,ye(y)),p+=m,p>=w&&J.ready&&Z()}requestAnimationFrame(I)}export{Ae as mount};
