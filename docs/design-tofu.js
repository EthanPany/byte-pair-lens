/* Motion and colour for the second design (index.html?design=tofu). Loaded only there.
   The page stays black and white; a script shows its colour while the pointer is on it.
   The app hands over geometry through window.BPL and calls TofuFX.over / cell / clear / sync. */
(function(){
  'use strict';
  if(document.documentElement.dataset.design!=='tofu')return;
  const calm=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine=matchMedia('(pointer: fine)').matches;
  const PAL={ascii:'#ffd23f',latin:'#ff9f1c',greek:'#2ec4b6',cyrillic:'#3a86ff',hebrew:'#8338ec',arabic:'#06d6a0',devanagari:'#ef476f',bengali:'#f78c6b',thai:'#9b5de5',kana:'#ff70a6',hangul:'#00bbf9',han:'#ff5a36',hanA:'#ffa630',emoji:'#fee440',hanB:'#7bd389'};
  const colour=(id,lo)=>PAL[id]||`hsl(${(lo*47>>>4)%360} 85% 58%)`;
  const tint=(c,p)=>`color-mix(in srgb, ${c} ${p}%, #fff)`;
  const back=t=>{const c=1.70158+1;return t<=0?0:t>=1?1:1+c*Math.pow(t-1,3)+1.70158*Math.pow(t-1,2);}; // ease out, a little past the end
  const $=s=>document.querySelector(s);

  /* ---- overlay on the map ---- */
  const map=$('#map'), fx=document.createElement('canvas'); fx.id='mapfx'; fx.setAttribute('aria-hidden','true');
  map.after(fx);
  let ctx=fx.getContext('2d'), cur=null, raf=0;
  function sync(){
    fx.width=map.width; fx.height=map.height; fx.style.width=map.style.width; fx.style.height=map.style.height;
    fx.style.left=map.offsetLeft+'px'; fx.style.top=map.offsetTop+'px';
    const dpr=map.width/(parseFloat(map.style.width)||map.width||1);
    ctx=fx.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0); cur=null; cancelAnimationFrame(raf);
  }
  function wipe(){const dpr=ctx.getTransform().a||1;ctx.clearRect(0,0,fx.width/dpr,fx.height/dpr);}
  function rr(x,y,w,h,r){ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x,y,w,h,r);else ctx.rect(x,y,w,h);ctx.fill();}
  function frame(){
    if(!cur){wipe();return;}
    const now=performance.now(); let busy=false; wipe();
    if(cur.kind==='block'){
      const {cells,cell,c,x0,y0}=cur, r=Math.max(2,cell*.22);
      for(const [x,y,f] of cells){
        const d=Math.min(260,(Math.abs(x-x0)+Math.abs(y-y0))/cell*9);
        const t=calm?1:(now-cur.t0-d)/220; if(t<=0){busy=true;continue;} if(t<1)busy=true;
        const p=Math.min(1,t), s=back(Math.min(1,t));
        ctx.globalAlpha=p; ctx.fillStyle=tint(c,26); rr(x,y,cell,cell,r);
        const side=Math.max(0,(cell-3)*Math.sqrt(f))*s;
        if(side>0.5){ctx.fillStyle=c; rr(x+(cell-side)/2,y+(cell-side)/2,side,side,Math.max(1.5,side*.22));}
      }
      ctx.globalAlpha=1;
      // the script's name rides on its cells while they are lit
      const t=calm?1:(now-cur.t0)/220, k=back(Math.min(1,Math.max(0,t)));
      if(k>0){
        ctx.font=`600 12px ${cur.font}`; const tw=ctx.measureText(cur.name).width, w=tw+24, h=24;
        let cx=(cur.bx0+cur.bx1)/2, cy=(cur.by0+cur.by1)/2; if(cur.by1-cur.by0<h+6)cy=cur.by0-h/2-4;
        cx=Math.max(w/2+2,cx);
        ctx.globalAlpha=Math.min(1,k); ctx.fillStyle='#000'; rr(cx-w*k/2,cy-h*k/2,w*k,h*k,h/2);
        ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle'; if(k>.6)ctx.fillText(cur.name,cx,cy+1); ctx.globalAlpha=1;
      }
    }else{
      const {x,y,cell,ch,c,font}=cur, t=calm?1:(now-cur.t0)/200; if(t<1)busy=true;
      const s=cell*(1+0.9*back(Math.min(1,t))), cx=x+cell/2, cy=y+cell/2;
      ctx.fillStyle='#000'; rr(cx-s/2-2,cy-s/2+1,s+4,s+5,s*.26);           // a hard shadow, like the cards
      ctx.fillStyle=c; rr(cx-s/2,cy-s/2-2,s,s,s*.24);
      ctx.fillStyle='#000'; ctx.font=`${Math.round(s*.62)}px ${font}`; ctx.textAlign='center'; ctx.textBaseline='middle';
      if(ch)ctx.fillText(ch,cx,cy-1,s);
    }
    if(busy)raf=requestAnimationFrame(frame);
  }
  function go(){cancelAnimationFrame(raf);raf=requestAnimationFrame(frame);}
  const FX={
    sync,
    over(g){
      const b=window.BPL&&window.BPL.over(g); if(!b){FX.clear();return;}
      if(cur&&cur.kind==='block'&&cur.id===b.id+':'+b.lo)return;
      const mine=b.cells.find(q=>q[3]===g)||b.cells[0];
      const xs=b.cells.map(q=>q[0]), ys=b.cells.map(q=>q[1]);
      cur={kind:'block',id:b.id+':'+b.lo,name:b.name,cells:b.cells,cell:b.cell,c:colour(b.id,b.lo),x0:mine?mine[0]:0,y0:mine?mine[1]:0,t0:performance.now(),
        bx0:Math.min(...xs),bx1:Math.max(...xs)+b.cell,by0:Math.min(...ys),by1:Math.max(...ys)+b.cell,font:getComputedStyle(document.documentElement).getPropertyValue('--sans')};
      paint(cur.c); go();
    },
    cell(cp){
      const q=window.BPL&&window.BPL.cell(cp); if(!q){FX.clear();return;}
      if(cur&&cur.kind==='cell'&&cur.cp===cp)return;
      cur={kind:'cell',cp,x:q.x,y:q.y,cell:q.cell,ch:q.ch,c:colour(q.id,q.lo),font:getComputedStyle(document.documentElement).getPropertyValue('--sans'),t0:performance.now()};
      paint(cur.c); go();
    },
    clear(){if(!cur)return;cur=null;paint(null);go();}
  };
  window.TofuFX=FX;

  /* ---- the block of tofu that follows the pointer ---- */
  let dot=null, tx=0, ty=0, px=0, py=0, seen=false;
  function paint(c){if(dot){if(c)dot.style.setProperty('--c',c);else dot.style.removeProperty('--c');}}
  if(fine&&!calm){
    dot=document.createElement('div'); dot.id='tofucur'; dot.setAttribute('aria-hidden','true'); document.body.append(dot);
    const hot='button,a,canvas,.tok,label,select,textarea,input,td.v,tr[data-id]';
    addEventListener('pointermove',e=>{
      tx=e.clientX+14; ty=e.clientY+16; if(!seen){seen=true;px=tx;py=ty;dot.classList.add('on');}
      dot.classList.toggle('over',!!(e.target.closest&&e.target.closest(hot)));
    },{passive:true});
    addEventListener('pointerdown',()=>dot.classList.add('down'),{passive:true});
    addEventListener('pointerup',()=>dot.classList.remove('down'),{passive:true});
    document.documentElement.addEventListener('pointerleave',()=>{dot.classList.remove('on');seen=false;});
    (function follow(){px+=(tx-px)*.2;py+=(ty-py)*.2;const lean=Math.max(-18,Math.min(18,(tx-px)*.9));dot.style.transform=`translate(${px}px,${py}px) rotate(${lean}deg)`;requestAnimationFrame(follow);})();
  }

  /* ---- the wordmark's eyes look at the pointer ---- */
  const face=$('h1 .tofu');
  if(face&&!calm)addEventListener('pointermove',e=>{
    const r=face.getBoundingClientRect(), dx=e.clientX-(r.left+r.width/2), dy=e.clientY-(r.top+r.height/2), n=Math.hypot(dx,dy)||1, k=Math.min(1,n/160);
    face.style.setProperty('--ex',(dx/n*k).toFixed(2)); face.style.setProperty('--ey',(dy/n*k).toFixed(2));
  },{passive:true});

  /* ---- a script's button shows that script's colour under the pointer ---- */
  document.addEventListener('mouseover',e=>{
    const b=e.target.closest&&e.target.closest('button[data-b]'); if(!b||b.style.getPropertyValue('--c'))return;
    const id=b.dataset.b; if(PAL[id])b.style.setProperty('--c',tint(PAL[id],70));
  });
  sync();
})();
