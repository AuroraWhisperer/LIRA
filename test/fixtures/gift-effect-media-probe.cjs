'use strict';

const fs = require('node:fs');
const path = require('node:path');

module.exports = async function verifyMedia(win) {
  // Fixed synthetic media keeps this lifecycle check independent of recorder startup.
  const bytes = fs.readFileSync(path.join(__dirname, 'gift-effect-alpha.webm'));
  const protocol = win.webContents.session.protocol;
  await protocol.handle('https', (request) => {
    if (new URL(request.url).hostname !== 'i0.hdslb.com') return new Response('', { status: 404 });
    return new Response(bytes, { headers: { 'Content-Type': 'video/webm', 'Access-Control-Allow-Origin': '*' } });
  });
  try {
    return await win.webContents.executeJavaScript(`(async () => {
      const { createGiftEffectPlayer } = await import('/js/overlays/gift-effect-player.js');
      const stage = document.createElement('div'); document.body.append(stage);
      const videos = []; const contexts = []; const errors = [];
      const nativeCreate = document.createElement.bind(document);
      document.createElement = function(tag, options) {
        const node = nativeCreate(tag, options);
        if (tag === 'video') videos.push(node);
        if (tag === 'canvas') {
          const nativeGet = node.getContext.bind(node);
          node.getContext = function(kind, options) {const gl = nativeGet(kind,options);if(kind==='webgl'&&gl)contexts.push(gl);return gl;};
        }
        return node;
      };
      const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
      const wait = async predicate => {const until=Date.now()+5000;while(!predicate()){if(Date.now()>until)throw Error('media checkpoint timed out');await delay(20);}};
      const effect = {mp4Url:'https://i0.hdslb.com/lira-synthetic.mp4',layout:{videoWidth:64,videoHeight:32,rgbFrame:[0,0,32,32],alphaFrame:[32,0,32,32]}};
      const player = createGiftEffectPlayer({stage,onError:error=>errors.push(error.message)});
      player.setEnabled(true);
      try {
        for (let index=0;index<5;index++) {
          const count=contexts.length;
          const errorCount=errors.length;
          player.enqueue({type:'gift:effect',source:'danmaku',eventId:'synthetic-'+index,effect});
          await wait(()=>contexts.length>count || errors.length>errorCount);
          if(errors.length>errorCount)throw Error(JSON.stringify({errors,clipBytes:${bytes.length},mediaError:videos.at(-1).error?.message,code:videos.at(-1).error?.code}));
          if(index===3) contexts.at(-1).getExtension('WEBGL_lose_context').loseContext();
          if(index===4) player.dispose();
          await wait(()=>stage.children.length===0 && videos.at(-1).getAttribute('src')===null);
          await delay(30);
        }
        return {clipBytes:${bytes.length},videos:videos.length,contexts:contexts.length,allVideosPaused:videos.every(v=>v.paused),allSourcesRemoved:videos.every(v=>!v.hasAttribute('src')),allContextsLost:contexts.every(gl=>gl.isContextLost()),remainingCanvas:stage.children.length,expectedContextLossErrors:errors.length};
      } finally {player.dispose();document.createElement=nativeCreate;stage.remove();}
    })()`);
  } finally {
    protocol.unhandle('https');
  }
};
