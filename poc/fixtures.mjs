export const files = {
 '/index.tsx': `import React from 'react'; import {createRoot} from 'react-dom/client'; import {App} from './App'; createRoot(document.getElementById('root')!).render(<App/>);`,
 '/App.tsx': `import React,{useState} from 'react'; import {Table} from './Table'; import {rows} from './data'; export function App(){const [filter,setFilter]=useState(''); return <main><input value={filter} onChange={e=>setFilter(e.target.value)}/><Table rows={rows.filter(r=>r.name.includes(filter))}/></main>}`,
 '/Table.tsx': `import React from 'react'; import type {Row} from './data'; export function Table({rows}:{rows:Row[]}){return <table><tbody>{rows.map(r=><tr key={r.id}><td>{r.name}</td><td>{r.amount.toLocaleString()}</td></tr>)}</tbody></table>}`,
 '/data.ts': `export type Row={id:number,name:string,amount:number}; export const rows:Row[]=${JSON.stringify(Array.from({length:100},(_,i)=>({id:i,name:'User '+i,amount:i*1000})))};`
};
export const external=['react','react/jsx-runtime','react-dom/client'];
export function resolve(id, importer='') {
 if(external.includes(id)) return {id,external:true};
 const base=id.startsWith('/')?id:importer.slice(0,importer.lastIndexOf('/')+1)+id;
 const out=[];for(const part of base.split('/')){if(part==='..')out.pop();else if(part&&part!=='.')out.push(part)}
 const p='/'+out.join('/');for(const suffix of ['','.tsx','.ts','/index.tsx'])if((p+suffix) in files)return {id:p+suffix};
 throw new Error('Unregistered import '+id);
}
export function esPlugin(vfs){return {name:'memory-vfs',setup(b){b.onResolve({filter:/.*/},a=>{const r=resolve(a.path,a.importer);return r.external?{path:r.id,external:true}:{path:r.id,namespace:'vfs'}});b.onLoad({filter:/.*/,namespace:'vfs'},a=>({contents:vfs[a.path],loader:a.path.endsWith('.tsx')?'tsx':'ts'}));}}}
export function rollPlugin(vfs){return {name:'memory-vfs',resolveId(id,importer){return resolve(id,importer)},load(id){return vfs[id]}}}
export function esOptions(vfs){return {entryPoints:['/index.tsx'],bundle:true,write:false,format:'esm',jsx:'automatic',platform:'browser',plugins:[esPlugin(vfs)],logLevel:'silent'}}
