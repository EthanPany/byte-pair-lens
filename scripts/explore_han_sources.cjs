/* How robust is "share of running Han text that is whole tokens"? Recounts it on other corpora.
   Sources: OpenSubtitles 2018 word lists from github.com/hermitdave/FrequencyWords (zh_cn, zh_tw, ja),
   next to the Wikipedia counts in docs/freq.json.
   Usage:  mkdir -p /tmp/cov && cd /tmp/cov
           for l in zh_cn zh_tw ja; do curl -sSO https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/$l/${l}_full.txt; done
           node <repo>/scripts/explore_han_sources.cjs
   Rows: isolated = each character on its own, weighted by frequency (the Coverage tab's old default);
         in-context = the same after really encoding each word; types = share of the distinct characters. */
const fs=require('fs'), D=require('path').join(__dirname,'..','docs')+'/';
const BPE=require(D+'bpe.js'); globalThis.BPE=BPE; const ByteMap=require(D+'bytemap.js');
const ENC=['r50k_base','cl100k_base','o200k_base','llama3.1','qwen3','deepseek-v3','gemma3','mistral-v0.3'];
const utf8=new TextEncoder();
const isHan=cp=>cp>=0x4E00&&cp<=0x9FFF;
const src={};
for(const l of ['zh_cn','zh_tw','ja']){
  const words=[];let n=0;
  for(const line of fs.readFileSync(l+'_full.txt','utf8').split('\n')){const i=line.lastIndexOf(' ');if(i<0)continue;const w=line.slice(0,i),c=+line.slice(i+1);if(!c)continue;if([...w].some(ch=>isHan(ch.codePointAt(0))))words.push([w,c]);}
  src[l]=words;
}
const wiki=JSON.parse(fs.readFileSync(D+'freq.json','utf8')).scripts.han;
const out={};
for(const e of ENC){
  const V=BPE.load(JSON.parse(fs.readFileSync(D+e+'.json','utf8')));
  if(V.kind==='sp')V.setMerges(JSON.parse(fs.readFileSync(D+e+'.merges.json','utf8')));
  const keys=ByteMap.vocabKeys(V);
  const whole=ch=>{const b=utf8.encode(ch);return keys.has(BPE.key(b,0,b.length));};
  const r={};
  {let t=0,w=0;for(const [cp,c] of wiki.chars){t+=c;if(whole(String.fromCodePoint(cp)))w+=c;} r['wiki zh (simplified) isolated']=w/t;}
  for(const l in src){
    let t=0,w=0,ctxT=0,ctxFrag=0,types=new Map();
    const top=src[l].slice(0,60000);
    for(const [word,c] of src[l]){for(const ch of word){if(!isHan(ch.codePointAt(0)))continue;t+=c;const k=whole(ch);if(k)w+=c;types.set(ch,k);}}
    // in context: encode the word, count Han characters whose bytes end up in a fragment token
    for(const [word,c] of top){
      const ids=V.encode(word); let hasFrag=ids.some(id=>V.text[id]===null);
      const nh=[...word].filter(ch=>isHan(ch.codePointAt(0))).length; ctxT+=c*nh;
      if(hasFrag){ // attribute: decode which characters are covered by fragment tokens
        let off=0;const fragBytes=new Set();for(const id of ids){const L=V.bytes[id].length;if(V.text[id]===null)for(let k=0;k<L;k++)fragBytes.add(off+k);off+=L;}
        let bo=0;for(const ch of word){const L=utf8.encode(ch).length;if(isHan(ch.codePointAt(0))){let f=false;for(let k=0;k<L;k++)if(fragBytes.has(bo+k))f=true;if(f)ctxFrag+=c;}bo+=L;}
      }
    }
    r[l+' isolated']=w/t; r[l+' in-context whole']=1-ctxFrag/ctxT; r[l+' types']=[...types.values()].filter(x=>x).length/types.size; r[l+' ntypes']=types.size;
  }
  out[e]=r; console.error(e,'done');
}
const rows=Object.keys(out[ENC[0]]);
console.log(['metric',...ENC].join('\t'));
for(const k of rows)console.log([k,...ENC.map(e=>k.endsWith('ntypes')?out[e][k]:(100*out[e][k]).toFixed(1))].join('\t'));
