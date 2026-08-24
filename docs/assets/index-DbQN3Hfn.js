async function o(r,e={},n){return window.__TAURI_INTERNALS__.invoke(r,e,n)}async function p(r,e){await o("plugin:shell|open",{path:r,with:e})}export{p as open};
