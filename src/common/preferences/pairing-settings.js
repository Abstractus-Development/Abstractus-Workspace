document.addEventListener('DOMContentLoaded',()=>{

  const input=document.getElementById('abstractus-pair-code');

  const status=document.getElementById('abstractus-pair-status');

  const connect=document.getElementById('abstractus-pair-connect');

  const native=document.getElementById('abstractus-pair-native');

  const disconnect=document.getElementById('abstractus-pair-disconnect');

  const run=async action=>{

    for(const button of [connect,native,disconnect])if(button)button.disabled=true;

    if(action==='native')status.textContent='Approve the connection in Abstractus Desktop…';

    try {

      // Chromium declares nativeMessaging up front (a runtime grant is not visible to the already
      // running service worker); Firefox still asks for it here.
      if(action==='native' && !await browser.permissions.contains({permissions:['nativeMessaging']}) && !await browser.permissions.request({permissions:['nativeMessaging']}))throw new Error('Connection permission was declined. You can still use a code.');

      const result=await browser.runtime.sendMessage({type:'abstractus-pair',action,code:input?.value});

      status.textContent=result.message || (result.connected?'Connected securely. Return to your article and click the Connector to save it.':'Not connected.');

      status.dataset.connected=String(!!result.connected);

      document.dispatchEvent(new CustomEvent('abstractus-connection-changed',{detail:result}));

      if(action==='connect' && input)input.value='';

    } catch(e) {status.textContent=String(e.message||e).replace(/^Uncaught (?:Error: )?/,'');status.dataset.connected='false';}

    finally {for(const button of [connect,native,disconnect])if(button)button.disabled=false;}

  };

  connect?.addEventListener('click',()=>run('connect'));

  native?.addEventListener('click',()=>run('native'));

  disconnect?.addEventListener('click',()=>run('disconnect'));

  document.getElementById('abstractus-open-settings')?.addEventListener('click',()=>browser.runtime.openOptionsPage());

  // Shows the transport's guidance line under the buttons (the status card above polls separately)
  run('status');

});

