const THEMES = {
  midnight: {
    dark: ['#0b0d12', '#11141b', '#181c24', '#202532', '#f4f5f8', '#8c95aa', 'rgba(255,255,255,.08)', '0 24px 70px rgba(0,0,0,.35)', '#8b7cf6', '#635bdb', 'rgba(114,102,223,.2)', 'rgba(139,124,246,.25)', '#fff', 'rgba(11,13,18,.9)', '#181c25', '#262b38', 'rgba(255,255,255,.06)', 'rgba(255,255,255,.12)', 'rgba(255,255,255,.14)', 'rgba(255,255,255,.26)', 'rgba(139,124,246,.16)'],
    light: ['#f5f6fb', '#ffffff', '#eef0f6', '#e5e8f1', '#1a1d28', '#6f788e', 'rgba(21,25,42,.1)', '0 24px 70px rgba(43,47,76,.16)', '#6d5ee0', '#5a4fc4', 'rgba(93,80,205,.18)', 'rgba(109,94,224,.22)', '#fff', 'rgba(255,255,255,.92)', '#ffffff', '#ffffff', 'rgba(21,25,42,.05)', 'rgba(21,25,42,.09)', 'rgba(21,25,42,.18)', 'rgba(21,25,42,.32)', 'rgba(109,94,224,.14)']
  },
  ocean: {
    dark: ['#081014', '#0d161b', '#122229', '#19313a', '#eef8fa', '#7da6af', 'rgba(255,255,255,.08)', '0 24px 70px rgba(0,0,0,.38)', '#37c3d4', '#1d97ab', 'rgba(55,195,212,.2)', 'rgba(55,195,212,.24)', '#04272c', 'rgba(8,16,20,.9)', '#122229', '#0f2229', 'rgba(255,255,255,.06)', 'rgba(255,255,255,.12)', 'rgba(255,255,255,.14)', 'rgba(255,255,255,.26)', 'rgba(55,195,212,.16)'],
    light: ['#eef7f9', '#ffffff', '#e2f1f4', '#d2e8ec', '#0f242a', '#567a83', 'rgba(15,36,42,.1)', '0 24px 70px rgba(24,58,66,.14)', '#1198ad', '#0c7d8f', 'rgba(17,152,173,.18)', 'rgba(17,152,173,.2)', '#fff', 'rgba(255,255,255,.94)', '#ffffff', '#ffffff', 'rgba(15,36,42,.05)', 'rgba(15,36,42,.09)', 'rgba(15,36,42,.16)', 'rgba(15,36,42,.3)', 'rgba(17,152,173,.14)']
  },
  ember: {
    dark: ['#150c08', '#1c120d', '#291a12', '#38271c', '#fdf3ec', '#c89a83', 'rgba(255,255,255,.08)', '0 24px 70px rgba(0,0,0,.4)', '#ff8a4d', '#e2502c', 'rgba(255,138,77,.2)', 'rgba(255,138,77,.22)', '#fff', 'rgba(21,12,8,.9)', '#291a12', '#241811', 'rgba(255,255,255,.06)', 'rgba(255,255,255,.11)', 'rgba(255,255,255,.14)', 'rgba(255,255,255,.26)', 'rgba(255,138,77,.16)'],
    light: ['#fdf4ec', '#ffffff', '#f9e4d5', '#f3d4c0', '#3a1f10', '#8a6a57', 'rgba(58,31,16,.1)', '0 24px 70px rgba(93,45,25,.15)', '#e05f24', '#bd4a1d', 'rgba(224,95,36,.18)', 'rgba(224,95,36,.2)', '#fff', 'rgba(255,255,255,.94)', '#ffffff', '#ffffff', 'rgba(58,31,16,.05)', 'rgba(58,31,16,.09)', 'rgba(58,31,16,.16)', 'rgba(58,31,16,.3)', 'rgba(224,95,36,.14)']
  },
  aurora: {
    dark: ['#09110d', '#0e1813', '#14241c', '#1b2f25', '#eefcf6', '#83b9a2', 'rgba(255,255,255,.08)', '0 24px 70px rgba(0,0,0,.38)', '#38d9a1', '#17ad7d', 'rgba(56,217,161,.2)', 'rgba(56,217,161,.24)', '#04301f', 'rgba(9,17,13,.9)', '#14241c', '#10241b', 'rgba(255,255,255,.06)', 'rgba(255,255,255,.12)', 'rgba(255,255,255,.14)', 'rgba(255,255,255,.26)', 'rgba(56,217,161,.16)'],
    light: ['#effaf4', '#ffffff', '#dcf2e7', '#c8e9d7', '#0d2a1e', '#587d6c', 'rgba(13,42,30,.1)', '0 24px 70px rgba(24,72,52,.15)', '#0fa570', '#0b855c', 'rgba(15,165,112,.18)', 'rgba(15,165,112,.2)', '#fff', 'rgba(255,255,255,.94)', '#ffffff', '#ffffff', 'rgba(13,42,30,.05)', 'rgba(13,42,30,.09)', 'rgba(13,42,30,.16)', 'rgba(13,42,30,.3)', 'rgba(15,165,112,.14)']
  },
  rose: {
    dark: ['#140b11', '#1b1118', '#281924', '#352530', '#fdf0f6', '#c69aa9', 'rgba(255,255,255,.08)', '0 24px 70px rgba(0,0,0,.4)', '#f26bae', '#cd4c8c', 'rgba(242,107,174,.2)', 'rgba(242,107,174,.24)', '#fff', 'rgba(20,11,17,.9)', '#281924', '#211522', 'rgba(255,255,255,.06)', 'rgba(255,255,255,.12)', 'rgba(255,255,255,.14)', 'rgba(255,255,255,.26)', 'rgba(242,107,174,.16)'],
    light: ['#fcf1f7', '#ffffff', '#f8e1ed', '#f1d0e0', '#351524', '#845d6c', 'rgba(53,21,36,.1)', '0 24px 70px rgba(94,41,64,.15)', '#d3508d', '#b13c74', 'rgba(211,80,141,.18)', 'rgba(211,80,141,.2)', '#fff', 'rgba(255,255,255,.94)', '#ffffff', '#ffffff', 'rgba(53,21,36,.05)', 'rgba(53,21,36,.09)', 'rgba(53,21,36,.16)', 'rgba(53,21,36,.3)', 'rgba(211,80,141,.14)']
  },
  gold: {
    dark: ['#140e05', '#1a1308', '#271c0f', '#352a17', '#fdf7e7', '#cdb284', 'rgba(255,255,255,.08)', '0 24px 70px rgba(0,0,0,.4)', '#f0b13c', '#c88a1e', 'rgba(240,177,60,.2)', 'rgba(240,177,60,.24)', '#241a00', 'rgba(20,14,5,.9)', '#271c0f', '#1f1711', 'rgba(255,255,255,.06)', 'rgba(255,255,255,.11)', 'rgba(255,255,255,.14)', 'rgba(255,255,255,.26)', 'rgba(240,177,60,.16)'],
    light: ['#fdf7e8', '#ffffff', '#f7ecd4', '#efe0b9', '#36260c', '#8a774e', 'rgba(54,38,12,.1)', '0 24px 70px rgba(88,62,18,.15)', '#c98a1f', '#a97116', 'rgba(201,138,31,.18)', 'rgba(201,138,31,.2)', '#fff', 'rgba(255,255,255,.94)', '#ffffff', '#ffffff', 'rgba(54,38,12,.05)', 'rgba(54,38,12,.09)', 'rgba(54,38,12,.16)', 'rgba(54,38,12,.3)', 'rgba(201,138,31,.14)']
  }
};
const V = ['--bg', '--panel', '--card', '--card2', '--text', '--muted', '--line', '--shadow', '--accent', '--accent2', '--accent-glow', '--accent-soft', '--accent-ink', '--composer', '--modal', '--toast', '--soft', '--soft-hover', '--scroll', '--scroll-hover', '--ring'];

const GRADIENTS = {
  violet: { d: 'linear-gradient(150deg,rgba(139,124,246,.30),rgba(80,70,160,.14) 45%,transparent 75%)', dg: 'rgba(255,255,255,.06)', l: 'linear-gradient(150deg,rgba(139,124,246,.24),rgba(206,201,255,.12) 45%,transparent 75%)', lg: 'rgba(139,124,246,.12)' },
  ocean: { d: 'linear-gradient(150deg,rgba(55,195,212,.26),rgba(25,120,140,.12) 45%,transparent 75%)', dg: 'rgba(255,255,255,.05)', l: 'linear-gradient(150deg,rgba(164,226,236,.5),rgba(200,238,245,.3) 45%,transparent 75%)', lg: 'rgba(55,195,212,.12)' },
  sunset: { d: 'linear-gradient(150deg,rgba(255,138,77,.28),rgba(150,60,40,.12) 45%,transparent 75%)', dg: 'rgba(255,255,255,.05)', l: 'linear-gradient(150deg,rgba(252,201,166,.6),rgba(247,224,198,.35) 45%,transparent 75%)', lg: 'rgba(224,95,36,.12)' },
  aurora: { d: 'linear-gradient(150deg,rgba(56,217,161,.24),rgba(30,120,90,.12) 45%,transparent 75%)', dg: 'rgba(255,255,255,.05)', l: 'linear-gradient(150deg,rgba(173,235,206,.55),rgba(205,240,224,.3) 45%,transparent 75%)', lg: 'rgba(15,165,112,.12)' },
  rose: { d: 'linear-gradient(150deg,rgba(242,107,174,.26),rgba(150,60,100,.12) 45%,transparent 75%)', dg: 'rgba(255,255,255,.05)', l: 'linear-gradient(150deg,rgba(248,196,219,.55),rgba(248,224,235,.3) 45%,transparent 75%)', lg: 'rgba(211,80,141,.12)' },
  gold: { d: 'linear-gradient(150deg,rgba(240,177,60,.26),rgba(140,100,30,.12) 45%,transparent 75%)', dg: 'rgba(255,255,255,.05)', l: 'linear-gradient(150deg,rgba(248,222,166,.6),rgba(249,236,200,.35) 45%,transparent 75%)', lg: 'rgba(201,138,31,.12)' }
};

let out = '\n/* ==== Global Appearance System: themes, gradients, surface mapping ==== */\n';
out += ':root{--gd:none;--gd-glow:transparent;--panel:#11141b;--card:#181c24;--card2:#202532;--text:#f4f5f8;--muted:#8c95aa;--line:rgba(255,255,255,.08);--accent:#8b7cf6;--accent2:#635bdb;--accent-glow:rgba(114,102,223,.2);--accent-soft:rgba(139,124,246,.25);--accent-ink:#fff;--composer:rgba(11,13,18,.9);--modal:#181c25;--toast:#262b38;--soft:rgba(255,255,255,.06);--soft-hover:rgba(255,255,255,.12);--scroll:rgba(255,255,255,.14);--scroll-hover:rgba(255,255,255,.26);--ring:rgba(139,124,246,.16)}\n';
for (const [id, t] of Object.entries(THEMES)) {
  for (const [mode, vals] of Object.entries(t)) {
    const sel = mode === 'dark' ? `body[data-theme="${id}"]` : `body[data-theme="${id}"].light`;
    out += sel + '{' + vals.map((v, i) => `${V[i]}:${v}`).join(';') + `;--auth-base:${t.dark[0]};--auth-deep:${t.dark[1]}}\n`;
  }
}
for (const [id, g] of Object.entries(GRADIENTS)) {
  out += `body[data-gradient="${id}"]{--gd:${g.d};--gd-glow:${g.dg}}\n`;
  out += `body[data-gradient="${id}"].light{--gd:${g.l};--gd-glow:${g.lg}}\n`;
}
out += `body[data-gradient="none"]{--gd:none;--gd-glow:transparent}\n`;
out += `body[data-gradient="none"].light{--gd:none;--gd-glow:transparent}\n`;

out += `\n/* surface mapping — always wins because it is appended last */\n`;
out += `body{background-color:var(--bg);background-image:var(--gd,none);background-attachment:fixed;transition:background-color .3s var(--ease)}\n`;
out += `.app-shell{background:var(--bg)}\n`;
out += `.sidebar{background-color:var(--panel);background-image:var(--gd,none)}\n`;
out += `.chat-panel{background-color:var(--bg);background-image:radial-gradient(circle at 82% -10%,var(--gd-glow,transparent) 0,transparent 32%),var(--gd,none)}\n`;
out += `.chat-header{background-color:var(--panel)}\n`;
out += `.modal{background:var(--modal)!important}\n`;
out += `.bubble{background:var(--soft)}\n`;
out += `.mine .bubble{background:var(--accent);border-color:var(--accent-soft);color:var(--accent-ink)}\n`;
out += `.primary{background:linear-gradient(135deg,var(--accent),var(--accent2));color:var(--accent-ink);box-shadow:0 9px 25px var(--accent-glow)}\n`;
out += `.brand-mark{background:linear-gradient(135deg,var(--accent),var(--accent2))}\n`;
out += `.secondary{background:var(--soft);color:var(--text)}\n`;
out += `.round-btn,.icon-btn,.emoji-btn{background:var(--soft);color:var(--text)}\n`;
out += `.round-btn:hover,.icon-btn:hover,.emoji-btn:hover,.nav-btn:hover{background:var(--soft-hover);color:var(--text)}\n`;
out += `.welcome-icon{background:var(--accent-soft);border:1px solid var(--accent-soft);color:var(--accent)}\n`;
out += `.toast{background:var(--toast)}\n`;
out += `.message-form{background:var(--composer)}\n`;
out += `.badge,.section-badge{color:var(--accent-ink)}\n`;
out += `input:focus,textarea:focus,select:focus{border-color:var(--accent)!important;box-shadow:0 0 0 3px var(--ring)!important;outline:none}\n`;
out += `.tab.active:after,.dot-online .tab-dot,.typing-dot,.progress-bar{background:var(--accent)}\n`;
out += `*{scrollbar-width:thin;scrollbar-color:var(--scroll,transparent) transparent}\n`;
out += `::-webkit-scrollbar{width:10px;height:10px}\n`;
out += `::-webkit-scrollbar-track{background:transparent}\n`;
out += `::-webkit-scrollbar-thumb{background:var(--scroll,transparent);border-radius:9px;border:2px solid transparent;background-clip:padding-box}\n`;
out += `::-webkit-scrollbar-thumb:hover{background:var(--scroll-hover,var(--scroll));border-radius:9px;border:2px solid transparent;background-clip:padding-box}\n`;
out += `body.light .chat-panel{background-color:var(--bg);background-image:radial-gradient(circle at 82% -10%,var(--gd-glow,transparent) 0,transparent 32%),var(--gd,none)}\n`;
out += `body.light .mine .bubble{background:var(--accent);border-color:var(--accent-soft);color:var(--accent-ink)}\n`;
out += `@media(prefers-reduced-motion:no-preference){body,.chat-panel,.sidebar{transition:background-color .35s var(--ease),background-image .35s var(--ease)}}\n`;
out += `\n/* appearance modal */\n`;
out += `.appearance-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:4px 0 16px}\n`;
out += `.theme-swatch,.grad-swatch{display:flex;align-items:center;gap:7px;padding:8px 9px;border:1px solid var(--line);border-radius:12px;background:var(--soft);color:var(--text);font-size:12px;cursor:pointer;transition:.15s var(--ease);min-width:0}\n`;
out += `.theme-swatch i{width:16px;height:16px;border-radius:50%;flex:0 0 auto;box-shadow:inset 0 1px 2px rgba(0,0,0,.25)}\n`;
out += `.grad-swatch i{width:24px;height:16px;border-radius:6px;flex:0 0 auto;border:1px solid var(--line)}\n`;
out += `.theme-swatch span,.grad-swatch span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n`;
out += `.theme-swatch:hover,.grad-swatch:hover{border-color:var(--accent);background:var(--soft-hover)}\n`;
out += `.theme-swatch.active,.grad-swatch.active{border-color:var(--accent);box-shadow:0 0 0 2px var(--ring);background:var(--soft-hover)}\n`;
out += `.theme-swatch.active i,.grad-swatch.active i{outline:2px solid var(--accent);outline-offset:1px}\n`;
out += `.appearance-seg{display:flex;gap:8px;margin:4px 0 16px}.appearance-seg button{flex:1;padding:9px;border:1px solid var(--line);border-radius:11px;background:var(--soft);color:var(--muted);font-size:12px;cursor:pointer;transition:.15s}.appearance-seg button.active{background:linear-gradient(135deg,var(--accent),var(--accent2));color:var(--accent-ink);border-color:transparent}\n`;
out += `.auth-art{background:radial-gradient(circle at 75% 25%,var(--accent-soft) 0,transparent 34%),linear-gradient(145deg,var(--auth-base,#17162a),var(--auth-deep,#0b0d12) 70%)}\n`;
require('fs').writeFileSync('public/theme.css', out);
console.log('theme.css generated:', out.length, 'bytes');