'use strict';

module.exports = async function verifyMedia(win) {
  // Generate an in-memory, synthetic clip; no platform media or user audio is read.
  const bytes = await win.webContents.executeJavaScript(`(async () => {
    const source = document.createElement('canvas'); source.width = 64; source.height = 32;
    const ctx = source.getContext('2d'); ctx.fillStyle = '#ff2060'; ctx.fillRect(0,0,32,32);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(32,0,32,32);
    const track = new MediaStreamTrackGenerator({kind:'video'});
    const writer = track.writable.getWriter();
    const stream = new MediaStream([track]); const parts = [];
    const recorder = new MediaRecorder(stream, {mimeType:'video/webm;codecs=vp8'});
    recorder.ondataavailable = e => parts.push(e.data);
    const done = new Promise(resolve => recorder.onstop = resolve);
    recorder.start();
    // Supply frames directly: hidden windows need not repaint a captured canvas.
    for(let i=0;i<8;i++){
      ctx.fillStyle=i%2?'#ff2060':'#ff4060';ctx.fillRect(0,0,32,32);
      const frame = new VideoFrame(source,{timestamp:i*60000,duration:60000});
      try { await writer.write(frame); } finally { frame.close(); }
      await new Promise(resolve=>setTimeout(resolve,60));
    }
    recorder.stop(); await done;
    await writer.close(); writer.releaseLock();
    stream.getTracks().forEach(track => track.stop());
    return [...new Uint8Array(await new Blob(parts).arrayBuffer())];
  })()`);
  const protocol = win.webContents.session.protocol;
  await protocol.handle('https', (request) => {
    if (new URL(request.url).hostname !== 'i0.hdslb.com') return new Response('', { status: 404 });
    return new Response(Buffer.from(bytes), { headers: { 'Content-Type': 'video/webm', 'Access-Control-Allow-Origin': '*' } });
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
