/* Web dashboard SDK — intentionally separate from the native Desktop SDK. */
(function () {
  'use strict';
  const {React, components: {Button, Input}, fetchJSON} = window.__HERMES_PLUGIN_SDK__;
  const {createElement: h, useState, useEffect, useRef} = React;
  const valid = name => name.trim().length > 0 && name.length <= 80 && !/[\u0000-\u001f\u007f\[\]]/.test(name);
  const profileNow = () => new URLSearchParams(window.location.search).get('profile') || window.__HERMES_INITIAL_PROFILE__ || window.__HERMES_DASHBOARD_PROFILE__ || '';
  const row = {display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'};
  const muted = {fontSize:13,color:'var(--color-muted-foreground)',lineHeight:1.6};
  const card = {padding:20,border:'1px solid var(--color-border)',borderRadius:'var(--radius, 8px)',background:'var(--color-card)'};
  function Person({person, save, busy}) {
    const [editing, edit] = useState(false);
    const [name, setName] = useState(person.display_name);
    useEffect(() => setName(person.display_name), [person.display_name]);
    async function submit(e) {
      e.preventDefault();
      if (valid(name) && !busy && await save(person.id,name)) edit(false);
    }
    return h('li',{style:{...row,padding:'14px 0',borderBottom:'1px solid var(--color-border)'}},
      h('span',{'aria-hidden':true,style:{display:'grid',placeItems:'center',width:34,height:34,borderRadius:6,background:'var(--color-muted)',fontWeight:600}},person.display_name.slice(0,1).toUpperCase()),
      editing ? h('form',{onSubmit:submit,style:{...row,flex:1}},
        h('label',{htmlFor:`name-${person.id}`,style:muted},'Display name'),
        h(Input,{id:`name-${person.id}`,'aria-label':`Name for ${person.id}`,autoFocus:true,value:name,maxLength:80,onChange:e=>setName(e.target.value),style:{flex:1,minWidth:100}}),
        h(Button,{type:'submit',disabled:busy||!valid(name)},'Save'),
        h(Button,{type:'button',ghost:true,size:'sm',disabled:busy,onClick:()=>{edit(false);setName(person.display_name);}},'Cancel'))
      : h(React.Fragment,null,
        h('span',{style:{flex:1,minWidth:0,overflowWrap:'anywhere',fontWeight:500}},person.display_name),
        h(Button,{ghost:true,size:'sm','aria-label':`Edit ${person.display_name}`,disabled:busy,onClick:()=>edit(true)},'Rename')));
  }
  function People() {
    // The host remounts routed pages on a management-profile change. Explicit
    // query scope is necessary: fetchJSON does not auto-scope /api/plugins/*.
    const [profile] = useState(profileNow);
    const [people,setPeople] = useState([]);
    const [name,setName] = useState('');
    const [status,setStatus] = useState('Connecting…');
    const [error,setError] = useState('');
    const [busy,setBusy] = useState(false);
    const alive = useRef(true), sequence = useRef(0), saving = useRef(false);
    const current = () => alive.current && profile === profileNow();
    const endpoint = path => `/api/plugins/purikura${path}${profile?'?profile='+encodeURIComponent(profile):''}`;
    async function refresh() {
      const ticket = ++sequence.current;
      try {
        const data = await fetchJSON(endpoint('/state'));
        if (!Array.isArray(data.identities)) throw Error('Invalid People response');
        if (current() && ticket === sequence.current) {
          setPeople(data.identities.filter(p=>p.enabled!==false));
          setStatus('Shared roster · synced automatically');
          setError('');
        }
      } catch (e) { if (current() && ticket === sequence.current) {setStatus('Roster unavailable');setError(e.message);} }
    }
    useEffect(() => {
      alive.current = true;
      refresh();
      const timer = setInterval(()=>{if(!saving.current)refresh();},5000);
      return () => {alive.current=false;sequence.current++;clearInterval(timer);};
    },[]);
    async function save(id,value) {
      if (!current() || saving.current || !valid(value)) return false;
      saving.current=true;setBusy(true);setError('');sequence.current++;
      try {
        await fetchJSON(endpoint('/identities/'+encodeURIComponent(id)),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({display_name:value.trim()})});
        if (!current()) return false;
        await refresh();
        return true;
      } catch(e) { if(current())setError(`Save failed: ${e.message}`);return false; }
      finally {saving.current=false;if(current())setBusy(false);}
    }
    async function add(e) {
      e.preventDefault();
      if (await save('person:'+crypto.randomUUID().replaceAll('-',''),name)) setName('');
    }
    return h('section',{'aria-label':'People settings',style:{maxWidth:680,margin:'0 auto',padding:'32px 20px',color:'var(--color-foreground)'}},
      h('p',{style:{...muted,margin:'0 0 6px'}},'Purikura'),
      h('h1',{style:{fontSize:28,fontWeight:600,letterSpacing:'-.025em',margin:'0 0 8px'}},'People'),
      h('p',{style:{...muted,margin:'0 0 24px'}},'A shared roster. Your own voice.'),
      h('div',{style:card},
        h('h2',{style:{fontSize:15,fontWeight:600,margin:0}},'Shared people'),
        h('p',{style:{...muted,margin:'4px 0 6px'}},'Add names here, then choose who’s speaking in Desktop.'),
        h('ul',{style:{listStyle:'none',margin:0,padding:0}},...people.map(person=>h(Person,{key:person.id,person,save,busy}))),
        !people.length && status!=='Connecting…' ? h('p',{style:muted},'No people loaded. Add a person or refresh to retry.') : null,
        h('div',{style:{...row,...muted,justifyContent:'space-between',marginTop:12}},
          h('span',{role:'status'},status),
          h(Button,{ghost:true,size:'sm',disabled:busy,onClick:refresh},'Refresh'))),
      h('form',{onSubmit:add,style:{...card,marginTop:16}},
        h('h2',{style:{fontSize:15,fontWeight:600,margin:'0 0 16px'}},'Add a person'),
        h('label',{htmlFor:'purikura-new-person',style:{display:'block',fontSize:13,marginBottom:6}},'Display name'),
        h('div',{style:row},
          h(Input,{id:'purikura-new-person','aria-label':'New person name',placeholder:'e.g. Alice',value:name,maxLength:80,onChange:e=>setName(e.target.value),style:{flex:1,minWidth:120}}),
          h(Button,{type:'submit',disabled:busy||!valid(name)},busy?'Saving…':'Add person'))),
      error ? h('p',{role:'alert',style:muted},error) : null,
      h('p',{style:{...muted,marginTop:18}},'Names sync across clients. Selection is not sign-in or memory separation.'));
  }
  window.__HERMES_PLUGINS__.register('purikura',People);
})();
