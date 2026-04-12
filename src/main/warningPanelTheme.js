/* SPDX-License-Identifier: GPL-3.0-or-later; Copyright (c) 2026 Thomas Michael Weissel; Licensed under GPLv3+ (see http://www.gnu.org/licenses/). */
// Single flat blue panel for warning-mode lockscreen and bonus-time window (no nested card layers).

export const WARNING_PANEL_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
:root{--wp-bg:#ffffff;--wp-line:rgba(0,0,0,0.12)}
html,body{min-height:100%;height:100%;overflow:auto;background:var(--wp-bg);
  font-family:system-ui,sans-serif;color:#1e293b;display:flex;align-items:center;justify-content:center;padding:28px 24px}
.card{max-width:520px;width:100%;text-align:center;padding:0}
.icon{font-size:64px;margin-bottom:18px;user-select:none;line-height:1}
h1{font-size:22px;font-weight:700;margin-bottom:14px;color:#ff6b6b}
h2{font-size:20px;font-weight:700;margin-bottom:12px;color:#ff6b6b;text-align:left}
.info{color:#475569;font-size:14px;line-height:1.7;margin-bottom:16px;text-align:left}
.info strong{color:#1e293b}
.divider{border:none;border-top:1px solid var(--wp-line);margin:22px 0}
label{display:block;text-align:left;font-size:12px;font-weight:600;color:#64748b;margin-bottom:6px}
.row{display:flex;gap:8px;align-items:stretch;margin-bottom:4px}
.row .pw-wrap{flex:1;min-width:0}
.row select,.row .sel{flex:0 0 min(132px,34vw);width:auto;min-width:100px;max-width:160px}
.form-stack{display:flex;flex-direction:column;gap:14px;align-items:stretch;width:100%;margin-top:2px}
.field-block{width:100%}
.field-group{display:flex;flex-direction:column;gap:4px;align-items:stretch;width:100%}
.field-group label{margin-bottom:0}
input[type=password],input[type=text]{padding:12px 16px;background:#f8fafc;border:1px solid var(--wp-line);
  border-radius:8px;color:#1e293b;font-size:15px;outline:none;transition:border-color .2s;width:100%}
input:focus{border-color:#3b82f6}
select{padding:12px 14px;background:#f8fafc;border:1px solid var(--wp-line);border-radius:8px;
  color:#1e293b;font-size:15px;outline:none;min-width:0;width:100%}
select.sel-narrow{max-width:160px;width:100%}
button{padding:12px 20px;background:#1d4ed8;color:#fff;border:none;border-radius:8px;
  font-size:15px;font-weight:600;cursor:pointer;transition:background .2s}
button:hover{background:#1e40af}
button:disabled{background:#cbd5e1;color:#94a3b8;cursor:default}
.btn-block{width:100%;margin-top:8px}
.btn-row{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end;margin-top:18px}
.btn-row button{width:auto}
.btn-outline{background:transparent;color:#475569;border:1px solid var(--wp-line)}
.btn-outline:hover{background:rgba(0,0,0,0.04)}
.pw-wrap{position:relative;display:block;width:100%}
.pw-wrap input{padding-right:36px;width:100%}
.eye{position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:0;color:#94a3b8;font-size:15px;line-height:1}
.eye:hover{color:#1e293b}
.err{color:#f87171;font-size:13px;min-height:18px;margin-top:8px;text-align:left}
`
